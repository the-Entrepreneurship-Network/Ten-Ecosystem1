'use strict';

/**
 * Programmes, applications, and the ecosystem counters.
 *
 * This file used to open with PROGRAMS_DATA — six programmes written as an
 * array literal. "TEN Summer Internship 2025", deadline 2025-08-15, "23 of 50
 * seats left". The deadlines expired, the seat counts never moved because
 * nothing could move them, and POST /programs/:id/apply answered "Application
 * submitted successfully!" while writing nothing at all: everyone who applied
 * through it is unrecorded and unreachable.
 *
 * /founder-os/stats was the same shape of lie in miniature — a literal
 * { internships: 0, students: 0, revenue: 0, mentors: 0 } served to three
 * different pages as though it had been counted.
 *
 * Everything here now reads the database. Where there is no data yet, the
 * response says so with an empty list rather than a sample.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const Program            = require('../models/Program');
const ProgramApplication = require('../models/ProgramApplication');
const TalentProfile      = require('../models/TalentProfile');

const { requireRole } = require('../middleware/roleGuard');
const { ROLES } = require('../config/roles');

const staffOnly = requireRole(ROLES.HR, ROLES.ADMIN);

// server.js mounts express.json() app-wide but not urlencoded, and the public
// application form posts a form body.
router.use(express.urlencoded({ extended: true }));

// Applying is public, so it is the one endpoint here a stranger can write to.
const applyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many applications from this address. Please try again later.' }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Seats left, counted rather than stored.
 *
 * The old array claimed "seatsLeft: 23" as a fact nobody maintained. A count of
 * live applications cannot drift from the truth because it IS the truth.
 */
function seatsLeft(program, applied) {
    if (!program.seats) return null;
    return Math.max(0, program.seats - applied);
}

function publicProgram(doc, applied) {
    return {
        id: String(doc._id),
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        type: doc.type,
        difficulty: doc.difficulty,
        duration: doc.duration,
        stipend: doc.stipend,
        company: doc.company,
        tags: doc.tags || [],
        seats: doc.seats || 0,
        seatsLeft: seatsLeft(doc, applied),
        applied,
        deadline: doc.deadline,
        startDate: doc.startDate,
        status: doc.isOpen() ? doc.status : 'closed',
        open: doc.isOpen()
    };
}

// ── Programmes ──────────────────────────────────────────────────────────────

router.get('/programs', async (req, res) => {
    try {
        const filter = { published: true };
        if (req.query.type && req.query.type !== 'all') filter.type = req.query.type;
        if (req.query.status) filter.status = req.query.status;

        const programs = await Program.find(filter).sort({ deadline: 1, createdAt: -1 }).limit(100);
        if (!programs.length) return res.json({ success: true, data: [], total: 0 });

        const counts = await ProgramApplication.aggregate([
            {
                $match: {
                    programId: { $in: programs.map((p) => p._id) },
                    status: { $ne: 'withdrawn' }
                }
            },
            { $group: { _id: '$programId', n: { $sum: 1 } } }
        ]);
        const byId = new Map(counts.map((c) => [String(c._id), c.n]));

        const data = programs.map((p) => publicProgram(p, byId.get(String(p._id)) || 0));
        res.json({ success: true, data, total: data.length });
    } catch (err) {
        console.error('[programs] list failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not load programmes.', data: [] });
    }
});

router.post('/programs/:id/apply', applyLimiter, async (req, res) => {
    try {
        const program = await Program.findById(req.params.id);
        if (!program || !program.published) {
            return res.status(404).json({ success: false, error: 'Program not found.' });
        }
        if (!program.isOpen()) {
            return res.status(409).json({
                success: false,
                error: 'Applications for this programme have closed.'
            });
        }

        const body = req.body || {};
        const name  = String(body.name || '').trim();
        const email = String(body.email || '').toLowerCase().trim();

        if (name.length < 2) {
            return res.status(400).json({ success: false, error: 'Please give your name.' });
        }
        if (!EMAIL_RE.test(email)) {
            return res.status(400).json({ success: false, error: 'Please give a valid email address.' });
        }

        // A full programme stops taking applications, rather than overbooking
        // quietly and disappointing people later.
        if (program.seats) {
            const applied = await ProgramApplication.countDocuments({
                programId: program._id,
                status: { $ne: 'withdrawn' }
            });
            if (applied >= program.seats) {
                return res.status(409).json({ success: false, error: 'This programme is full.' });
            }
        }

        let application;
        try {
            application = await ProgramApplication.create({
                programId: program._id,
                programTitle: program.title,
                studentId: (req.student && req.student._id) || null,
                employeeId: (req.student && req.student.employeeId) || '',
                name: name.slice(0, 200),
                email,
                phone: String(body.phone || '').slice(0, 40),
                college: String(body.college || '').slice(0, 200),
                message: String(body.message || '').slice(0, 2000)
            });
        } catch (err) {
            if (err && err.code === 11000) {
                return res.status(409).json({
                    success: false,
                    error: 'You have already applied to this programme.'
                });
            }
            throw err;
        }

        res.json({
            success: true,
            message: 'Application received.',
            applicationId: String(application._id),
            programId: String(program._id)
        });
    } catch (err) {
        console.error('[programs] apply failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not submit that application.' });
    }
});

// ── Staff ───────────────────────────────────────────────────────────────────

router.post('/programs', staffOnly, async (req, res) => {
    try {
        const body = req.body || {};
        const title = String(body.title || '').trim();
        if (!title) return res.status(400).json({ success: false, error: 'A programme needs a title.' });

        const slug = String(body.slug || title)
            .toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);

        const program = await Program.create({
            title: title.slice(0, 200),
            slug,
            description: String(body.description || '').slice(0, 4000),
            type: body.type || 'internship',
            difficulty: body.difficulty || 'beginner',
            duration: String(body.duration || '').slice(0, 100),
            stipend: String(body.stipend || '').slice(0, 200),
            company: String(body.company || 'TEN Network').slice(0, 200),
            tags: Array.isArray(body.tags) ? body.tags.slice(0, 20).map(String) : [],
            seats: Number(body.seats) || 0,
            deadline: body.deadline ? new Date(body.deadline) : null,
            startDate: body.startDate ? new Date(body.startDate) : null,
            status: body.status || 'draft',
            published: body.published === true,
            publishedAt: body.published === true ? new Date() : null,
            createdBy: String((req.user && req.user._id) || '')
        });

        res.json({ success: true, program });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ success: false, error: 'A programme with that slug already exists.' });
        }
        console.error('[programs] create failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not create that programme.' });
    }
});

router.patch('/programs/:id', staffOnly, async (req, res) => {
    try {
        const body = req.body || {};
        const update = {};

        ['title', 'description', 'duration', 'stipend', 'company', 'type', 'difficulty', 'status']
            .forEach((f) => { if (typeof body[f] === 'string') update[f] = body[f].slice(0, 4000); });
        if (Array.isArray(body.tags)) update.tags = body.tags.slice(0, 20).map(String);
        if (body.seats !== undefined) update.seats = Number(body.seats) || 0;
        if (body.deadline)  update.deadline  = new Date(body.deadline);
        if (body.startDate) update.startDate = new Date(body.startDate);
        if (typeof body.published === 'boolean') {
            update.published = body.published;
            update.publishedAt = body.published ? new Date() : null;
        }

        if (!Object.keys(update).length) {
            return res.status(400).json({ success: false, error: 'Nothing to update.' });
        }

        const program = await Program.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (!program) return res.status(404).json({ success: false, error: 'Program not found.' });

        res.json({ success: true, program });
    } catch (err) {
        console.error('[programs] update failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not update that programme.' });
    }
});

router.get('/programs/:id/applications', staffOnly, async (req, res) => {
    try {
        const applications = await ProgramApplication.find({ programId: req.params.id })
            .sort({ appliedAt: -1 })
            .limit(500)
            .lean();
        res.json({ success: true, data: applications, total: applications.length });
    } catch (err) {
        console.error('[programs] applications failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not load applications.' });
    }
});

// ── Ecosystem counters ──────────────────────────────────────────────────────

/**
 * GET /api/founder-os/stats — counted, not asserted.
 *
 * Three pages draw these numbers. Serving four zeros made them all wrong at
 * once and made growth invisible. Revenue comes from Payment rows that actually
 * cleared, so it can only ever understate — which is the correct direction for
 * a number shown on a public page.
 */
router.get('/founder-os/stats', async (req, res) => {
    try {
        const Student   = require('../models/Student');
        const Payment   = require('../models/Payment');
        const EcosystemUser = require('../models/EcosystemUser');

        const [students, mentors, investors, founders, internships, revenueAgg] = await Promise.all([
            Student.estimatedDocumentCount(),
            EcosystemUser.countDocuments({ role: ROLES.MENTOR }),
            EcosystemUser.countDocuments({ role: ROLES.INVESTOR }),
            EcosystemUser.countDocuments({ role: ROLES.FOUNDER }),
            Student.countDocuments({ internshipCompleted: true }),
            // "success" is the only settled state in the Payment status enum;
            // pending_verification money has not arrived and must not be counted.
            Payment.aggregate([
                { $match: { status: 'success' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ])
        ]);

        res.status(200).json({
            success: true,
            available: true,
            data: {
                students,
                mentors,
                investors,
                founders,
                internships,
                revenue: (revenueAgg[0] && revenueAgg[0].total) || 0
            }
        });
    } catch (err) {
        /*
         * Three public pages draw these numbers, so a database blip must not
         * take them down — but nor should it produce four zeros that read as
         * counted facts, which is exactly what the old hardcoded response did.
         * `available: false` lets the page hide the strip instead of
         * announcing that the network has no members.
         */
        console.error('[stats] founder-os stats failed:', err.message);
        res.status(200).json({
            success: true,
            available: false,
            error: 'Stats are temporarily unavailable.',
            data: null
        });
    }
});

router.get('/talent-network/featured', async (req, res) => {
    try {
        const profiles = await TalentProfile.find({ visibility: 'public' })
            .sort({ profileScore: -1 })
            .limit(6)
            .lean();
        res.status(200).json({ success: true, data: profiles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/talent-network/trending-skills', async (req, res) => {
    try {
        const result = await TalentProfile.aggregate([
            { $unwind: '$skills' },
            { $group: { _id: '$skills.name', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
