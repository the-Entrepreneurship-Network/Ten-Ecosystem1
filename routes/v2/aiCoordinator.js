'use strict';

/**
 * /api/v2/ai-coordinator — what coordinators see of the AI Coordinator.
 *
 *   GET  /summary?domain=   today's summary (the AI Assistant tab). A
 *                           coordinator always gets their own domain; HR and
 *                           admins name one.
 *   POST /precheck/:id      run a submission's AI pre-check again, e.g. after
 *                           the student made their repository public.
 */

const express = require('express');
const mongoose = require('mongoose');
const { requireStaff } = require('../../middleware/sessionAuth');
const jobs = require('../../services/aiCoordinatorJobs');
const precheck = require('../../services/submissionPrecheck');

const router = express.Router();

/** The domains this person may look at: a coordinator's own; anyone's for HR and admins. */
function domainFor(req, asked) {
    const wanted = String(asked || '').trim();
    if (req.coordinator) {
        const mine = [].concat(req.coordinator.domain || []).map((d) => String(d).trim()).filter(Boolean);
        if (!mine.length) return null;
        return mine.find((d) => d.toLowerCase() === wanted.toLowerCase()) || mine[0];
    }
    return wanted || null;
}

router.get('/summary', requireStaff, async (req, res) => {
    try {
        const domain = domainFor(req, req.query.domain);
        if (!domain) return res.status(400).json({ success: false, message: 'Which domain? Add ?domain=' });
        res.json(await jobs.buildSummary(domain));
    } catch (err) {
        console.error('[ai-coordinator] summary failed:', err.message);
        res.status(500).json({ success: false, message: 'The summary could not be built. Please try again.' });
    }
});

router.post('/precheck/:id', requireStaff, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ success: false, message: 'That is not a submission.' });
        const sub = await mongoose.model('Submission').findById(id).select('domain image reviewedOnce aiCheck').lean();
        if (!sub) return res.status(404).json({ success: false, message: 'That submission no longer exists.' });
        const allowed = domainFor(req, sub.domain);
        if (!allowed || allowed.toLowerCase() !== String(sub.domain || '').trim().toLowerCase()) {
            return res.status(403).json({ success: false, message: 'That submission is in another domain.' });
        }
        if (sub.reviewedOnce) return res.status(409).json({ success: false, message: 'It has already been reviewed.' });
        // Whether a screenshot belongs: as the first check knew it (a Task
        // Journey submission cannot carry one), else whether there is one.
        const before = sub.aiCheck && sub.aiCheck.screenshot;
        const check = await precheck.run(id, { screenshotExpected: before ? !!before.expected : !!sub.image, notify: false });
        if (!check) return res.status(503).json({ success: false, message: 'The AI Coordinator is switched off, or the check could not run.' });
        res.json({ success: true, aiCheck: check });
    } catch (err) {
        console.error('[ai-coordinator] re-check failed:', err.message);
        res.status(500).json({ success: false, message: 'The check could not run. Please try again.' });
    }
});

module.exports = router;
