'use strict';

/**
 * Contractor work desk — projects, milestone deliverables and timesheets.
 *
 * Mounted at /api/v2/contractor.
 *
 * public/contractor-dashboard.html shipped as a picture of a dashboard: the two
 * project cards were markup, "Submit Milestone" reported that the deliverable
 * had been "routed to client and HR administrators queues" without sending a
 * request, and the timesheet ledger claimed HR payroll tracking while storing
 * nothing. These are the endpoints that make each of those sentences true.
 *
 * Identity comes from the server session via attachEcosystemUser + requireRole,
 * never from the localStorage 'user' blob the page used to trust, so a
 * contractor cannot read or bill against another contractor's project.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const ContractorProject   = require('../../models/ContractorProject');
const ContractorMilestone = require('../../models/ContractorMilestone');
const ContractorTimesheet = require('../../models/ContractorTimesheet');
const ContractorProfile   = require('../../models/ContractorProfile');
const EcosystemNotification = require('../../models/EcosystemNotification');
const HR = require('../../models/HR');

const { requireRole } = require('../../middleware/roleGuard');
const { ROLES } = require('../../config/roles');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const onlyContractor = requireRole(ROLES.CONTRACTOR);
const staffOnly      = requireRole(ROLES.HR, ROLES.ADMIN);

// A deliverable is a considered submission, not a keystroke.
const writeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many submissions in the last hour. Please try again shortly.' }
});

/**
 * A reviewer clicks this link. Anything that is not plain http(s) — javascript:,
 * data:, vbscript: — is an attack on the person reviewing the work, so the URL
 * is parsed rather than pattern-matched.
 */
function safeHttpUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    let parsed;
    try { parsed = new URL(value); } catch (_e) { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().slice(0, 2000);
}

/** The contractor's own profile, for the name and the rate to bill at. */
async function profileOf(userId) {
    try {
        return await ContractorProfile.findOne({ userId }).lean();
    } catch (_e) {
        return null;
    }
}

/** Tell every HR account that something needs review. Never fatal. */
async function notifyHR(title, message, link, data) {
    try {
        const hrUsers = await HR.find({}).select('_id').lean();
        if (!hrUsers.length) return;
        await EcosystemNotification.insertMany(hrUsers.map((hr) => ({
            userId: hr._id,
            type: 'system_announcement',
            title,
            message,
            link,
            data: data || {}
        })));
    } catch (err) {
        console.error('[contractor] HR notification failed:', err.message);
    }
}

// ── Contractor side ─────────────────────────────────────────────────────────

/**
 * GET /api/v2/contractor/overview — everything the dashboard draws on load.
 *
 * One request rather than four: the page renders as a single view and four
 * round trips only bought four chances to half-render it.
 */
router.get('/overview', onlyContractor, async (req, res) => {
    try {
        const userId = req.user._id;
        const [profile, projects, milestones, timesheets] = await Promise.all([
            profileOf(userId),
            ContractorProject.find({ contractorId: userId }).sort({ createdAt: -1 }).limit(50).lean(),
            ContractorMilestone.find({ contractorId: userId }).sort({ submittedAt: -1 }).limit(50).lean(),
            ContractorTimesheet.find({ contractorId: userId }).sort({ workedOn: -1 }).limit(100).lean()
        ]);

        const billed = timesheets.reduce((sum, t) => sum + (t.amount || 0), 0);
        const paid   = timesheets.filter((t) => t.status === 'paid')
            .reduce((sum, t) => sum + (t.amount || 0), 0);
        const hours  = timesheets.reduce((sum, t) => sum + (t.hours || 0), 0);

        res.json({
            success: true,
            profile: profile ? {
                name: profile.name,
                email: profile.email,
                skills: profile.skills || [],
                hourlyRate: profile.hourlyRate || 0,
                availability: profile.availability || '',
                verificationStatus: profile.verificationStatus
            } : null,
            projects,
            milestones,
            timesheets,
            totals: {
                projects: projects.length,
                activeProjects: projects.filter((p) => p.status === 'active').length,
                hours: Math.round(hours * 100) / 100,
                billed,
                paid,
                outstanding: billed - paid
            }
        });
    } catch (err) {
        console.error('[contractor] overview failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your workspace.' });
    }
});

/** POST /api/v2/contractor/milestones — submit a deliverable against a project. */
router.post('/milestones', onlyContractor, writeLimiter, async (req, res) => {
    try {
        const userId = req.user._id;
        const body = req.body || {};

        const project = await ContractorProject.findOne({
            _id: body.projectId,
            contractorId: userId
        });
        if (!project) {
            return res.status(404).json({ success: false, message: 'That project is not assigned to you.' });
        }

        const deliverableUrl = safeHttpUrl(body.deliverableUrl);
        if (!deliverableUrl) {
            return res.status(400).json({
                success: false,
                message: 'Please give a repository or production link starting with http:// or https://'
            });
        }

        const notes = String(body.notes || '').trim();
        if (notes.length < 10) {
            return res.status(400).json({ success: false, message: 'Please describe what you delivered — a sentence or two.' });
        }

        const profile = await profileOf(userId);

        const milestone = await ContractorMilestone.create({
            contractorId: userId,
            projectId: project._id,
            projectTitle: project.title,
            contractorName: (profile && profile.name) || '',
            deliverableUrl,
            notes: notes.slice(0, 4000),
            submittedAt: new Date()
        });

        project.status = 'pending_review';
        await project.save();

        await notifyHR(
            'Contractor milestone submitted',
            `${(profile && profile.name) || 'A contractor'} submitted a deliverable for ${project.title}.`,
            '/hr-portal.html#contractors',
            { milestoneId: String(milestone._id), projectId: String(project._id) }
        );

        res.json({ success: true, message: 'Deliverable submitted for review.', milestone });
    } catch (err) {
        console.error('[contractor] milestone submit failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not submit that deliverable. Please try again.' });
    }
});

/** POST /api/v2/contractor/timesheets — log billable time. */
router.post('/timesheets', onlyContractor, writeLimiter, async (req, res) => {
    try {
        const userId = req.user._id;
        const body = req.body || {};

        const title = String(body.title || '').trim();
        if (title.length < 3) {
            return res.status(400).json({ success: false, message: 'Give the activity a title.' });
        }

        const hours = Number(body.hours);
        if (!Number.isFinite(hours) || hours < 0.25 || hours > 24) {
            return res.status(400).json({ success: false, message: 'Hours must be between 0.25 and 24.' });
        }

        const profile = await profileOf(userId);
        const hourlyRate = Number(profile && profile.hourlyRate) || 0;
        if (hourlyRate <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Your hourly rate has not been set yet. Ask HR to set it before logging billable time.'
            });
        }

        // The project is optional — not all contractor time belongs to one —
        // but if given it has to be theirs.
        let project = null;
        if (body.projectId) {
            project = await ContractorProject.findOne({ _id: body.projectId, contractorId: userId }).lean();
            if (!project) {
                return res.status(404).json({ success: false, message: 'That project is not assigned to you.' });
            }
        }

        const entry = await ContractorTimesheet.create({
            contractorId: userId,
            projectId: project ? project._id : null,
            projectTitle: project ? project.title : '',
            contractorName: (profile && profile.name) || '',
            title: title.slice(0, 300),
            hours,
            hourlyRate,
            amount: Math.round(hours * hourlyRate * 100) / 100,
            workedOn: body.workedOn ? new Date(body.workedOn) : new Date()
        });

        res.json({ success: true, message: 'Billable time recorded.', entry });
    } catch (err) {
        console.error('[contractor] timesheet failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not record that time entry.' });
    }
});

// ── HR side ─────────────────────────────────────────────────────────────────

/** POST /api/v2/contractor/projects — HR assigns work to a contractor. */
router.post('/projects', staffOnly, async (req, res) => {
    try {
        const body = req.body || {};
        const title = String(body.title || '').trim();
        if (!title) return res.status(400).json({ success: false, message: 'A project needs a title.' });
        if (!body.contractorId) {
            return res.status(400).json({ success: false, message: 'Choose a contractor to assign this to.' });
        }

        const project = await ContractorProject.create({
            contractorId: body.contractorId,
            title: title.slice(0, 200),
            client: String(body.client || '').slice(0, 200),
            description: String(body.description || '').slice(0, 4000),
            tech: String(body.tech || '').slice(0, 300),
            budget: body.budget === undefined || body.budget === null || body.budget === ''
                ? null : Number(body.budget),
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            createdBy: String((req.user && req.user._id) || '')
        });

        res.json({ success: true, project });
    } catch (err) {
        console.error('[contractor] project create failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not create that project.' });
    }
});

/** GET /api/v2/contractor/hr/queue — everything awaiting an HR decision. */
router.get('/hr/queue', staffOnly, async (req, res) => {
    try {
        const [milestones, timesheets] = await Promise.all([
            ContractorMilestone.find({ status: { $in: ['submitted', 'under_review'] } })
                .sort({ submittedAt: -1 }).limit(100).lean(),
            ContractorTimesheet.find({ status: 'logged' })
                .sort({ workedOn: -1 }).limit(200).lean()
        ]);

        const pendingValue = timesheets.reduce((sum, t) => sum + (t.amount || 0), 0);
        res.json({ success: true, milestones, timesheets, pendingValue });
    } catch (err) {
        console.error('[contractor] hr queue failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load the contractor queue.' });
    }
});

/** PATCH /api/v2/contractor/hr/milestones/:id — approve or send back. */
router.patch('/hr/milestones/:id', staffOnly, async (req, res) => {
    try {
        const status = String((req.body && req.body.status) || '');
        if (!['under_review', 'approved', 'changes_requested'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Unknown review status.' });
        }

        const milestone = await ContractorMilestone.findByIdAndUpdate(
            req.params.id,
            {
                status,
                reviewNote: String((req.body && req.body.reviewNote) || '').slice(0, 2000),
                reviewedBy: String((req.user && req.user._id) || 'hr'),
                reviewedAt: new Date()
            },
            { new: true }
        );
        if (!milestone) return res.status(404).json({ success: false, message: 'Milestone not found.' });

        if (status === 'approved') {
            await ContractorProject.findByIdAndUpdate(milestone.projectId, {
                status: 'completed',
                completedAt: new Date()
            });
        } else if (status === 'changes_requested') {
            await ContractorProject.findByIdAndUpdate(milestone.projectId, { status: 'active' });
        }

        res.json({ success: true, milestone });
    } catch (err) {
        console.error('[contractor] milestone review failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not update that milestone.' });
    }
});

/** PATCH /api/v2/contractor/hr/timesheets/:id — approve, reject or mark paid. */
router.patch('/hr/timesheets/:id', staffOnly, async (req, res) => {
    try {
        const status = String((req.body && req.body.status) || '');
        if (!['approved', 'rejected', 'paid'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Unknown timesheet status.' });
        }

        const entry = await ContractorTimesheet.findByIdAndUpdate(
            req.params.id,
            {
                status,
                payoutNote: String((req.body && req.body.payoutNote) || '').slice(0, 1000),
                approvedBy: String((req.user && req.user._id) || 'hr'),
                approvedAt: new Date()
            },
            { new: true }
        );
        if (!entry) return res.status(404).json({ success: false, message: 'Timesheet entry not found.' });

        res.json({ success: true, entry });
    } catch (err) {
        console.error('[contractor] timesheet review failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not update that time entry.' });
    }
});

module.exports = router;
