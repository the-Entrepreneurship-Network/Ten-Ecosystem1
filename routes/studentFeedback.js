'use strict';

/**
 * Student feedback — submission (students) and review (all HR).
 *
 * Mounted at /api/feedback.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const StudentFeedback = require('../models/StudentFeedback');
const EcosystemNotification = require('../models/EcosystemNotification');
const HR = require('../models/HR');
const { requireStudent, requireHR } = require('../middleware/sessionAuth');

// Feedback is a considered piece of writing, not a chat message.
const submitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'You have submitted several times recently. Please try again later.' }
});

/**
 * Notify every HR user that new feedback has arrived, so it appears in their
 * portal without anyone refreshing or polling a separate screen.
 * Best-effort: a notification failure must never lose the feedback itself.
 */
async function notifyAllHR(feedback) {
    try {
        const hrUsers = await HR.find({}).select('_id').lean();
        if (!hrUsers.length) return;
        await EcosystemNotification.insertMany(hrUsers.map((hr) => ({
            userId: hr._id,
            type: 'system_announcement',
            title: 'New student feedback',
            message: `${feedback.studentName || feedback.employeeId} shared feedback about their internship.`,
            link: '/hr-portal.html#feedback',
            data: { feedbackId: String(feedback._id), employeeId: feedback.employeeId }
        })));
    } catch (err) {
        console.error('[feedback] Could not notify HR:', err.message);
    }
}

// ── Student side ────────────────────────────────────────────────────────────

/** Can this student leave feedback, and have they already? */
router.get('/my-status', requireStudent, async (req, res) => {
    try {
        const student = req.student;
        // `internshipCompleted` exists twice on the Student schema — a Boolean
        // at the top level and a Date inside `milestones`, written by different
        // code paths. The Boolean is the gate.
        const eligible = !!student.internshipCompleted;

        const previous = await StudentFeedback.find({ studentId: student._id })
            .sort({ submittedAt: -1 })
            .select('message rating submittedAt status')
            .lean();

        res.json({
            success: true,
            eligible,
            reason: eligible ? null : 'Feedback opens once your internship is marked complete.',
            feedback: previous
        });
    } catch (err) {
        console.error('[feedback] my-status failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your feedback.' });
    }
});

router.post('/submit', requireStudent, submitLimiter, async (req, res) => {
    try {
        const student = req.student;

        if (!student.internshipCompleted) {
            return res.status(403).json({
                success: false,
                message: 'Feedback opens once your internship is marked complete.'
            });
        }

        const message = String((req.body && req.body.message) || '').trim();
        if (message.length < 10) {
            return res.status(400).json({ success: false, message: 'Please write at least a sentence or two.' });
        }
        if (message.length > 4000) {
            return res.status(400).json({ success: false, message: 'Please keep your feedback under 4000 characters.' });
        }

        let rating = null;
        if (req.body && req.body.rating !== undefined && req.body.rating !== null && req.body.rating !== '') {
            rating = Number.parseInt(req.body.rating, 10);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
            }
        }

        const feedback = await StudentFeedback.create({
            studentId:   student._id,
            employeeId:  student.employeeId,
            studentName: student.name || `${student.firstName || ''} ${student.lastName || ''}`.trim(),
            domain:      student.domain || '',
            tenure:      student.tenure || '',
            college:     student.collegeName || student.college || '',
            message,
            rating,
            submittedAt: new Date()
        });

        await notifyAllHR(feedback);

        res.json({ success: true, message: 'Thank you — your feedback has been sent to the TEN team.', feedback });
    } catch (err) {
        console.error('[feedback] submit failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not save your feedback. Please try again.' });
    }
});

// ── HR side ─────────────────────────────────────────────────────────────────
// Every HR account sees every piece of feedback — never scoped to one account.

router.get('/hr/all', requireHR, async (req, res) => {
    try {
        const page  = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));

        const filter = {};
        if (req.query.status && ['new', 'read', 'actioned'].includes(req.query.status)) {
            filter.status = req.query.status;
        }
        if (req.query.domain) filter.domain = req.query.domain;

        const [items, total, unread] = await Promise.all([
            StudentFeedback.find(filter).sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            StudentFeedback.countDocuments(filter),
            StudentFeedback.countDocuments({ status: 'new' })
        ]);

        res.json({ success: true, data: items, total, unread, page, totalPages: Math.ceil(total / limit) || 1 });
    } catch (err) {
        console.error('[feedback] hr list failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load feedback.' });
    }
});

router.patch('/hr/:id', requireHR, async (req, res) => {
    try {
        const update = {};
        if (req.body && ['read', 'actioned', 'new'].includes(req.body.status)) {
            update.status = req.body.status;
            update.readBy = (req.hrUser && (req.hrUser.username || req.hrUser.email)) || 'hr';
            update.readAt = new Date();
        }
        if (req.body && typeof req.body.hrNote === 'string') {
            update.hrNote = req.body.hrNote.slice(0, 2000);
        }

        // Publishing is a separate, deliberate act — see the note on
        // StudentFeedback.published. Nothing a student writes appears on the
        // public site until an HR user turns this on for that specific entry.
        if (req.body && typeof req.body.published === 'boolean') {
            update.published   = req.body.published;
            update.publishedAt = req.body.published ? new Date() : null;
            update.publishedBy = req.body.published
                ? ((req.hrUser && (req.hrUser.username || req.hrUser.email)) || 'hr')
                : '';
        }
        if (req.body && typeof req.body.displayName === 'string') {
            // "Rahul S." rather than a full name, at the student's preference.
            update.displayName = req.body.displayName.trim().slice(0, 60);
        }
        if (!Object.keys(update).length) {
            return res.status(400).json({ success: false, message: 'Nothing to update.' });
        }

        const feedback = await StudentFeedback.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!feedback) return res.status(404).json({ success: false, message: 'Feedback not found.' });

        res.json({ success: true, feedback });
    } catch (err) {
        console.error('[feedback] hr update failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not update that feedback.' });
    }
});

/**
 * GET /api/feedback/public — published testimonials, for the landing page.
 *
 * Unauthenticated on purpose: this is the one part of the feedback system a
 * visitor is meant to see. It returns ONLY entries an HR user has explicitly
 * published, and only four fields — no employeeId, no email, no college, no
 * studentName, nothing that identifies a student beyond the display name HR
 * chose. `.lean()` with an explicit projection rather than a document, so a
 * field added to the model later cannot start leaking by default.
 */
router.get('/public', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 6, 20);

        const rows = await StudentFeedback
            .find({ published: true })
            .select('displayName studentName domain rating message publishedAt -_id')
            .sort({ publishedAt: -1 })
            .limit(limit)
            .lean();

        res.json({
            success: true,
            testimonials: rows.map(r => ({
                name:    r.displayName || 'TEN Intern',
                domain:  r.domain || '',
                rating:  r.rating || null,
                // Long enough to be worth reading, short enough to stay a card.
                message: String(r.message || '').slice(0, 400)
            }))
        });
    } catch (err) {
        console.error('[feedback] public list failed:', err.message);
        res.json({ success: false, testimonials: [] });
    }
});

module.exports = router;
