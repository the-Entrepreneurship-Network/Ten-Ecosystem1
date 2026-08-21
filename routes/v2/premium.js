'use strict';

/**
 * The premium section: what a paying student gets that a free-track student
 * does not.
 *
 * Mounted at /api/v2/premium.
 *
 * Two audiences share this file because they share one collection and one
 * definition of "premium" (utils/premium.js). Keeping the coordinator's write
 * side next to the student's read side is what stops the two drifting into
 * different ideas of who may see what.
 *
 * The student routes answer 402 rather than 403 when the fee is outstanding —
 * "there is a price on this", not "you may never have this" — and the page uses
 * that to show the upsell instead of an error.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const Student = require('../../models/Student');
const PremiumAssignment = require('../../models/PremiumAssignment');
const BadgeAward = require('../../models/BadgeAward');

const { requireStudent, requireCoordinator } = require('../../middleware/sessionAuth');
const { getPremiumStatus, requirePremium } = require('../../utils/premium');
const tenurePaymentConfig = require('../../config/tenurePayment');

const router = express.Router();
router.use(express.json());

const writeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again shortly.' }
});

/** The shape the premium page renders. Never leaks another student's rows. */
function publicAssignment(a) {
    return {
        id: String(a._id),
        kind: a.kind,
        title: a.title,
        body: a.body || '',
        dueAt: a.dueAt,
        status: a.status,
        submissionUrl: a.submissionUrl || '',
        submittedAt: a.submittedAt,
        feedback: a.feedback || '',
        from: a.createdBy || 'Your coordinator',
        createdAt: a.createdAt
    };
}

// ── Student ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/premium/me — status, badges, notes and projects.
 *
 * Deliberately answers 200 for a NON-premium student too, with
 * `premium: false` and the plan they could buy. The section is shown to
 * everyone; it is only unlocked for those who paid, and a page that 402s here
 * could not render the locked state at all.
 */
router.get('/me', requireStudent, async (req, res) => {
    try {
        const employeeId = req.student.employeeId;
        const student = await Student.findOne({ employeeId }).lean();
        const status = getPremiumStatus(student);

        // What they would get, for the locked state's upsell.
        const bundle = tenurePaymentConfig.getBenefitsFor(status.durationType);

        if (!status.premium) {
            return res.json({
                success: true,
                premium: false,
                onPaidTrack: status.onPaidTrack,
                reason: status.reason,
                plan: bundle ? bundle.name : '',
                bundle,
                assignments: [],
                badges: []
            });
        }

        const [assignments, badges] = await Promise.all([
            PremiumAssignment.find({ employeeId }).sort({ createdAt: -1 }).limit(100).lean(),
            BadgeAward.find({ employeeId }).sort({ awardedAt: -1 }).limit(50).lean()
        ]);

        // Opening the section is what marks it read.
        PremiumAssignment.updateMany({ employeeId, readAt: null }, { $set: { readAt: new Date() } })
            .catch((err) => console.error('[premium] read-mark failed:', err.message));

        res.json({
            success: true,
            premium: true,
            onPaidTrack: true,
            plan: status.plan,
            grantedAt: status.grantedAt,
            bundle,
            benefits: student.tenureBenefits || null,
            assignments: assignments.map(publicAssignment),
            badges: badges.map((b) => ({
                id: b.badgeId, name: b.badgeName, icon: b.badgeIcon, awardedAt: b.awardedAt
            }))
        });
    } catch (err) {
        console.error('[premium] me failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your premium section.' });
    }
});

/** GET /api/v2/premium/unread — the dot on the dashboard tile. */
router.get('/unread', requireStudent, async (req, res) => {
    try {
        const student = await Student.findOne({ employeeId: req.student.employeeId }).lean();
        if (!getPremiumStatus(student).premium) return res.json({ success: true, count: 0 });
        const count = await PremiumAssignment.countDocuments({
            employeeId: req.student.employeeId, readAt: null
        });
        res.json({ success: true, count });
    } catch (err) {
        res.status(500).json({ success: false, count: 0 });
    }
});

/**
 * POST /api/v2/premium/projects/:id/submit — hand in an assigned project.
 *
 * The row is looked up by id AND the session's employeeId, so a guessed id
 * cannot submit against somebody else's project.
 */
router.post('/projects/:id/submit', requireStudent, requirePremium, writeLimiter, async (req, res) => {
    try {
        const item = await PremiumAssignment.findOne({
            _id: req.params.id, employeeId: req.student.employeeId, kind: 'project'
        });
        if (!item) return res.status(404).json({ success: false, message: 'Project not found.' });
        if (item.status === 'approved') {
            return res.status(409).json({ success: false, message: 'This project is already approved.' });
        }

        const raw = String((req.body && req.body.submissionUrl) || '').trim();
        let parsed;
        try { parsed = new URL(raw); } catch (_e) { parsed = null; }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            return res.status(400).json({ success: false, message: 'Give a link starting with http:// or https://' });
        }

        item.submissionUrl = parsed.toString().slice(0, 2000);
        item.submittedAt = new Date();
        item.status = 'submitted';
        await item.save();

        res.json({ success: true, message: 'Submitted. Your coordinator will review it.', assignment: publicAssignment(item) });
    } catch (err) {
        console.error('[premium] submit failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not record that submission.' });
    }
});

// ── Coordinator ─────────────────────────────────────────────────────────────

/**
 * GET /api/v2/premium/students — the premium students a coordinator can write to.
 *
 * Scoped to the coordinator's own domain, and filtered through the same
 * getPremiumStatus every other surface uses, so this list and the student's own
 * unlocked state can never disagree.
 */
router.get('/students', requireCoordinator, async (req, res) => {
    try {
        const domain = req.coordinator && req.coordinator.domain;
        const filter = domain && domain !== 'all' ? { domain } : {};
        const students = await Student.find(filter)
            .select('name employeeId email domain tenure shortCoursePaid isExistingStudent createdAt tenureBenefits')
            .limit(500).lean();

        const premium = students
            .map((s) => ({ s, p: getPremiumStatus(s) }))
            .filter((x) => x.p.premium)
            .map((x) => ({
                employeeId: x.s.employeeId,
                name: x.s.name,
                domain: x.s.domain || '',
                tenure: x.s.tenure || '',
                plan: x.p.plan
            }));

        res.json({ success: true, students: premium, total: premium.length });
    } catch (err) {
        console.error('[premium] student list failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load students.', students: [] });
    }
});

/**
 * POST /api/v2/premium/assign — send a note, or assign a project.
 *
 * Refuses a non-premium recipient rather than creating a row nobody can see:
 * a coordinator writing into a void is worse than being told no.
 */
router.post('/assign', requireCoordinator, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const employeeId = String(b.employeeId || '').trim();
        const kind = b.kind === 'project' ? 'project' : 'note';
        const title = String(b.title || '').trim();
        const body = String(b.body || '').trim();

        if (!employeeId) return res.status(400).json({ success: false, message: 'Pick a student.' });
        if (title.length < 3) return res.status(400).json({ success: false, message: 'Give it a title.' });

        const student = await Student.findOne({ employeeId }).lean();
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        const status = getPremiumStatus(student);
        if (!status.premium) {
            return res.status(409).json({
                success: false,
                message: `${student.name || employeeId} is not on a paid track, so they cannot see this section.`
            });
        }

        const item = await PremiumAssignment.create({
            studentId: student._id,
            employeeId,
            kind,
            title: title.slice(0, 200),
            body: body.slice(0, 5000),
            dueAt: kind === 'project' && b.dueAt ? new Date(b.dueAt) : null,
            status: kind === 'project' ? 'assigned' : 'sent',
            createdBy: (req.coordinator && req.coordinator.username) || 'Coordinator',
            createdByDomain: (req.coordinator && req.coordinator.domain) || ''
        });

        // Best effort — the row exists whether or not the bell rings.
        try {
            const Notification = require('../../models/Notification');
            if (Notification && typeof Notification.notifyStudent === 'function') {
                await Notification.notifyStudent(student, {
                    title: kind === 'project' ? 'New project assigned' : 'A note from your coordinator',
                    message: title,
                    type: 'info'
                });
            }
        } catch (notifyErr) {
            console.error('[premium] notify failed:', notifyErr.message);
        }

        res.json({ success: true, message: 'Sent.', assignment: publicAssignment(item) });
    } catch (err) {
        console.error('[premium] assign failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not send that.' });
    }
});

/** GET /api/v2/premium/assignments?employeeId= — what a coordinator has sent. */
router.get('/assignments', requireCoordinator, async (req, res) => {
    try {
        const filter = {};
        const employeeId = String(req.query.employeeId || '').trim();
        if (employeeId) filter.employeeId = employeeId;
        else if (req.coordinator && req.coordinator.domain && req.coordinator.domain !== 'all') {
            filter.createdByDomain = req.coordinator.domain;
        }
        if (req.query.status) filter.status = String(req.query.status);

        const rows = await PremiumAssignment.find(filter).sort({ createdAt: -1 }).limit(200).lean();
        res.json({
            success: true,
            assignments: rows.map((a) => ({ ...publicAssignment(a), employeeId: a.employeeId }))
        });
    } catch (err) {
        console.error('[premium] assignment list failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load assignments.', assignments: [] });
    }
});

/** POST /api/v2/premium/projects/:id/review — approve, or ask for changes. */
router.post('/projects/:id/review', requireCoordinator, writeLimiter, async (req, res) => {
    try {
        const item = await PremiumAssignment.findOne({ _id: req.params.id, kind: 'project' });
        if (!item) return res.status(404).json({ success: false, message: 'Project not found.' });
        if (!item.submittedAt) {
            return res.status(409).json({ success: false, message: 'Nothing has been submitted yet.' });
        }

        const action = String((req.body && req.body.action) || '');
        const feedback = String((req.body && req.body.feedback) || '').trim();

        if (action === 'approve') {
            item.status = 'approved';
        } else if (action === 'changes') {
            if (feedback.length < 5) {
                return res.status(400).json({ success: false, message: 'Say what needs changing (at least 5 characters).' });
            }
            item.status = 'changes_requested';
        } else {
            return res.status(400).json({ success: false, message: 'Unknown action.' });
        }

        item.feedback = feedback.slice(0, 2000);
        item.reviewedAt = new Date();
        // The student has not seen this verdict yet.
        item.readAt = null;
        await item.save();

        res.json({ success: true, assignment: publicAssignment(item) });
    } catch (err) {
        console.error('[premium] review failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not save that review.' });
    }
});

module.exports = router;
