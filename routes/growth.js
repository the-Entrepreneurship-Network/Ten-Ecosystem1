'use strict';

/**
 * The Growth OS API.
 *
 * Two routers, because they have opposite access rules:
 *
 *   api      — everything behind the Growth OS sign-in
 *   tracking — /g/* open, click and unsubscribe, which arrive from a mail
 *              client with no session and must stay public
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { requireGrowthAPI, verifyGrowthCredentials, GROWTH_USERNAME } = require('../middleware/growthAuth');
const quota = require('../services/growthQuota');
const segments = require('../services/growthSegments');
const sender = require('../services/growthSender');
const tracking = require('../services/growthTracking');
const GrowthCampaign = require('../models/GrowthCampaign');
const Student = require('../models/Student');
const Payment = require('../models/Payment');
const CollegeContact = require('../models/CollegeContact');
const collegeDiscovery = require('../services/collegeDiscovery');
const collegeOutreach = require('../services/collegeOutreach');
const { SEED_COLLEGES } = require('../config/collegeSeeds');
const templates = require('../config/growthTemplates');
const { greetingNameFor } = require('../utils/studentName');

const api = express.Router();
const trackingRouter = express.Router();

/** A payment this long after a click still counts as that campaign's. */
const ATTRIBUTION_DAYS = parseInt(process.env.GROWTH_ATTRIBUTION_DAYS, 10) || 30;

// Brute-force guard, keyed by IP. One account, so there is no per-account key
// to add and nobody else to lock out from a shared address.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' }
});

// ─── auth ────────────────────────────────────────────────────────────────────

api.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!(await verifyGrowthCredentials(username, password))) {
            console.warn('[Growth] authentication rejected.');
            return res.status(401).json({ success: false, error: 'Invalid username or password' });
        }
        /*
         * Regenerate the session id (that is what defeats fixation) but carry
         * the other roles across. One browser holds one cookie for the whole
         * product, so a bare regenerate() would sign the same person out of
         * the student, HR and admin portals they had open — the exact bug
         * routes/adminPortal.js documents at its own login.
         */
        const carried = {};
        for (const role of ['student', 'hr', 'coordinator', 'adminUser']) {
            if (req.session && req.session[role]) carried[role] = req.session[role];
        }
        for (const key of ['ecosystemUserId', 'ecosystemUserRole', 'ecosystemUserEmail', 'ecosystemUserName']) {
            if (req.session && req.session[key]) carried[key] = req.session[key];
        }
        const grant = () => {
            Object.assign(req.session, carried);
            req.session.growthUser = { username: GROWTH_USERNAME, lastActivity: Date.now() };
            res.json({ success: true });
        };
        if (req.session && typeof req.session.regenerate === 'function') {
            return req.session.regenerate((err) => {
                if (err) {
                    console.error('[Growth] session regeneration failed:', err.message);
                    return res.status(500).json({ success: false, error: 'Login failed' });
                }
                grant();
            });
        }
        return grant();
    } catch (err) {
        console.error('[Growth] login error:', err.message);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

api.post('/logout', requireGrowthAPI, (req, res) => {
    if (req.session) req.session.growthUser = null;
    res.json({ success: true });
});

api.get('/session-check', requireGrowthAPI, (req, res) => {
    res.json({ success: true, username: req.session.growthUser.username });
});

// ─── quota ───────────────────────────────────────────────────────────────────

api.get('/quota', requireGrowthAPI, async (req, res) => {
    try {
        res.json({ success: true, quota: await quota.usage() });
    } catch (err) {
        console.error('[Growth] quota read failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not read the quota' });
    }
});

api.post('/quota/extend', requireGrowthAPI, async (req, res) => {
    try {
        const result = await quota.grantExtension({
            amount: (req.body || {}).amount,
            grantedBy: req.session.growthUser.username,
            reason: (req.body || {}).reason || ''
        });
        if (!result.ok) return res.status(400).json({ success: false, error: result.error });
        console.log(`[Growth] ${req.session.growthUser.username} unlocked ${req.body.amount} extra emails.`);
        res.json({ success: true, quota: result.usage });
    } catch (err) {
        console.error('[Growth] extension failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not unlock more' });
    }
});

// ─── segments ────────────────────────────────────────────────────────────────

api.get('/segments', requireGrowthAPI, async (req, res) => {
    try {
        res.json({ success: true, segments: await segments.listWithCounts() });
    } catch (err) {
        console.error('[Growth] segment counts failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not count the segments' });
    }
});

// ─── campaigns ───────────────────────────────────────────────────────────────

/**
 * What a campaign earned.
 *
 * A join at read time rather than a counter written at click time: nothing to
 * keep in sync, and it stays correct for payments that land days later.
 */
async function revenueFor(campaign) {
    const ids = campaign.clickedStudentIds || [];
    if (!ids.length || !campaign.sentAt) return { count: 0, rupees: 0 };
    const until = new Date(campaign.sentAt.getTime() + ATTRIBUTION_DAYS * 864e5);
    const rows = await Payment.find({
        studentId: { $in: ids },
        status: 'success',
        createdAt: { $gte: campaign.sentAt, $lte: until }
    }).select('amount amountRupees').lean();
    const rupees = rows.reduce((sum, p) => sum + (Number(p.amountRupees) || Number(p.amount) || 0), 0);
    return { count: rows.length, rupees };
}

function publicCampaign(c, revenue) {
    return {
        _id: c._id, name: c.name, subject: c.subject, segment: c.segment,
        status: c.status,
        recipientCount: c.recipientCount, sentCount: c.sentCount,
        failedCount: c.failedCount, skippedCount: c.skippedCount,
        opened: (c.openedStudentIds || []).length,
        clicked: (c.clickedStudentIds || []).length,
        revenue: revenue || { count: 0, rupees: 0 },
        createdBy: c.createdBy, createdAt: c.createdAt, sentAt: c.sentAt, error: c.error
    };
}

api.get('/campaigns', requireGrowthAPI, async (req, res) => {
    try {
        const rows = await GrowthCampaign.find().sort({ createdAt: -1 }).limit(50);
        const out = await Promise.all(rows.map(async (c) => publicCampaign(c, await revenueFor(c))));
        res.json({ success: true, campaigns: out });
    } catch (err) {
        console.error('[Growth] campaign list failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not list campaigns' });
    }
});

api.get('/campaigns/:id', requireGrowthAPI, async (req, res) => {
    try {
        const c = await GrowthCampaign.findById(req.params.id);
        if (!c) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, campaign: publicCampaign(c, await revenueFor(c)) });
    } catch (err) {
        res.status(400).json({ success: false, error: 'Bad campaign id' });
    }
});

api.post('/campaigns', requireGrowthAPI, async (req, res) => {
    try {
        const { name, subject, heading, bodyText, ctaLabel, ctaUrl, segment, studentIds } = req.body || {};
        if (!name || !subject || !bodyText) {
            return res.status(400).json({ success: false, error: 'Name, subject and body are all required.' });
        }
        const picked = segment === segments.PICKED;
        if (!picked && !segments.isSegment(segment)) {
            return res.status(400).json({ success: false, error: 'Pick a segment.' });
        }
        // A hand-picked campaign with an empty list would otherwise save as a
        // draft that reaches nobody and reports success.
        const ids = picked ? [...new Set((studentIds || []).map(String).filter(Boolean))] : [];
        if (picked && !ids.length) {
            return res.status(400).json({ success: false, error: 'Tick at least one student.' });
        }
        const c = await GrowthCampaign.create({
            name: String(name).slice(0, 200),
            subject: String(subject).slice(0, 300),
            heading: String(heading || '').slice(0, 200),
            bodyText: String(bodyText).slice(0, 20000),
            ctaLabel: String(ctaLabel || '').slice(0, 80),
            ctaUrl: String(ctaUrl || '').slice(0, 500),
            segment,
            studentIds: ids,
            createdBy: req.session.growthUser.username
        });
        res.json({ success: true, campaign: publicCampaign(c) });
    } catch (err) {
        console.error('[Growth] campaign create failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not save the campaign' });
    }
});

/**
 * The pre-flight check: how many this would reach, and whether the quota covers
 * it. The dashboard calls this before showing the confirm dialog, so nobody
 * starts a send that cannot finish.
 */
api.get('/campaigns/:id/preflight', requireGrowthAPI, async (req, res) => {
    try {
        const c = await GrowthCampaign.findById(req.params.id);
        if (!c) return res.status(404).json({ success: false, error: 'Not found' });
        // countFor would throw on 'picked' — it is not a query. Resolving the
        // real rows is also more honest here: it re-applies the opt-out filter,
        // so the number shown is who would ACTUALLY be mailed right now.
        const recipients = c.segment === segments.PICKED
            ? (await segments.recipientsByIds(c.studentIds)).length
            : await segments.countFor(c.segment);
        const u = await quota.usage();
        res.json({
            success: true,
            recipients,
            quota: u,
            enough: u.remaining >= recipients,
            shortfall: Math.max(0, recipients - u.remaining)
        });
    } catch (err) {
        console.error('[Growth] preflight failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not run the check' });
    }
});

api.post('/campaigns/:id/send', requireGrowthAPI, async (req, res) => {
    try {
        const c = await GrowthCampaign.findById(req.params.id);
        if (!c) return res.status(404).json({ success: false, error: 'Not found' });
        if (c.status !== 'draft') {
            return res.status(409).json({ success: false, error: `This campaign is already ${c.status}.` });
        }
        const u = await quota.usage();
        if (u.remaining < 1) {
            return res.status(409).json({ success: false, error: 'No marketing quota left this period.', quota: u });
        }
        // Not awaited: the loop throttles between messages and takes far longer
        // than any request may. Progress lives on the campaign document.
        sender.run(c._id).catch((err) => {
            console.error('[Growth] campaign run failed:', err.message);
            GrowthCampaign.findByIdAndUpdate(c._id, { status: 'failed', error: String(err.message).slice(0, 400) }).catch(() => {});
        });
        res.json({ success: true, started: true });
    } catch (err) {
        console.error('[Growth] send failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not start the send' });
    }
});

// ─── templates, preview, hand-picking ────────────────────────────────────────

/* Relative paths become absolute here, so a template never hard-codes a
   domain that later moves. */
api.get('/templates', requireGrowthAPI, (req, res) => {
    const base = String(tracking.BASE || '').replace(/\/+$/, '');
    res.json({
        success: true,
        templates: templates.TEMPLATES.map((t) => ({
            key: t.key, label: t.label, description: t.description,
            suggestedSegment: t.suggestedSegment,
            subject: t.subject, heading: t.heading, bodyText: t.bodyText,
            ctaLabel: t.ctaLabel, ctaUrl: base + t.ctaPath
        }))
    });
});

/**
 * What the mail will look like, before it exists as a campaign.
 *
 * Takes the draft straight from the form rather than an id, because the whole
 * point is to look at it BEFORE saving. It renders through the same
 * `renderEmail` the sender uses, with the same paragraph splitting, so the
 * preview cannot drift from what is actually delivered.
 *
 * Nothing is written and nothing is sent.
 *
 * The sampled student lends their NAME and nothing else. Their real id never
 * reaches buildHtml, because buildHtml signs the unsubscribe and click links
 * with whatever id it is given — handing it a real one would put a working,
 * correctly-signed unsubscribe link for that student inside a preview, one
 * mis-click away from removing somebody who never asked to be removed.
 */
api.post('/preview', requireGrowthAPI, async (req, res) => {
    try {
        const { heading, bodyText, ctaLabel, ctaUrl, segment, studentIds } = req.body || {};
        if (!bodyText || !String(bodyText).trim()) {
            return res.status(400).json({ success: false, error: 'Write the body first.' });
        }

        /* A real recipient makes the preview honest about the greeting — it is
           the one part that differs per person. Falls back to a stand-in when
           the audience is empty or the database is unreachable. */
        let sample = null;
        try {
            const rows = segment === segments.PICKED
                ? await segments.recipientsByIds(studentIds, 1)
                : await segments.recipientsFor(segments.isSegment(segment) ? segment : 'all', 1);
            sample = rows[0] || null;
        } catch (_) { /* preview must still render without a database */ }

        const real = sample || { name: 'Anita Rao', email: 'anita.rao@example.com' };
        /* Name and address are real so the greeting is honest; the id is not,
           so every signed link in the preview points at nobody. */
        const student = { _id: 'preview', name: real.name, firstName: real.firstName,
                          lastName: real.lastName, email: real.email };
        const html = sender.buildHtml({
            _id: 'preview',
            heading: String(heading || '').slice(0, 200),
            subject: String(heading || 'Preview').slice(0, 300),
            bodyText: String(bodyText).slice(0, 20000),
            ctaLabel: String(ctaLabel || '').slice(0, 80),
            ctaUrl: String(ctaUrl || '').slice(0, 500)
        }, student);

        res.json({
            success: true,
            html,
            sampleEmail: real.email || '',
            greeting: greetingNameFor(real),
            usedRealStudent: !!sample
        });
    } catch (err) {
        console.error('[Growth] preview failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not render the preview' });
    }
});

/* The hand-pick list. Opted-out students are absent, not merely unselectable. */
api.get('/students', requireGrowthAPI, async (req, res) => {
    try {
        const rows = await segments.searchStudents(req.query.q, parseInt(req.query.limit, 10) || 40);
        res.json({
            success: true,
            count: rows.length,
            students: rows.map((r) => ({
                id: String(r._id),
                name: greetingNameFor(r) || String(r.email || '').split('@')[0],
                email: r.email,
                employeeId: r.employeeId || '',
                domain: r.domain || ''
            }))
        });
    } catch (err) {
        console.error('[Growth] student search failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not search students' });
    }
});

// ─── colleges ────────────────────────────────────────────────────────────────
//
// Institutional outreach. These are placement offices, not students, so they
// live in their own collection and never touch a segment — but they spend the
// same monthly allowance, which is why `collegeOutreach` checks the same quota.

/* Discovery makes outbound requests to somebody else's site, so it is metered
   harder than the rest of the dashboard. */
const discoverLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many lookups. Wait a minute and try again.' }
});

/**
 * Run the agent.
 *
 * Visits every college it knows about and stores the contact each one
 * publishes. Not awaited — a run is minutes long, so the request returns at
 * once and the dashboard polls `/colleges/agent/status`.
 *
 * The roster is the honest limit: it is a starting set of real institutions,
 * not every college in India. Importing the AICTE dataset is how the list
 * grows past it, and that needs no crawling at all.
 */
api.post('/colleges/agent/run', requireGrowthAPI, (req, res) => {
    const status = collegeDiscovery.runStatus();
    if (status.running) {
        return res.status(409).json({ success: false, error: 'The agent is already running.', status });
    }
    collegeDiscovery.runBulk(SEED_COLLEGES).catch((err) => {
        console.error('[Growth] agent run failed:', err.message);
    });
    res.json({ success: true, started: true, total: SEED_COLLEGES.length });
});

api.get('/colleges/agent/status', requireGrowthAPI, (req, res) => {
    res.json({ success: true, status: collegeDiscovery.runStatus() });
});

/**
 * The mail the colleges will get, rendered for review.
 *
 * Read-only and sends nothing. It renders through `collegeOutreach.buildHtml`,
 * the same function the send loop calls, so what is reviewed here cannot
 * differ from what goes out.
 *
 * The id handed to buildHtml is a placeholder, for the reason the campaign
 * preview uses one: buildHtml signs an unsubscribe link with whatever id it is
 * given, and a real one would put a working "remove me" link for that college
 * inside the review pane.
 */
api.get('/colleges/template', requireGrowthAPI, async (req, res) => {
    try {
        let sample = null;
        try {
            sample = await CollegeContact.findOne({ status: 'new', optOut: { $ne: true } })
                .select('college contactName email').lean();
        } catch (_) { /* the template must render without a database */ }

        const html = collegeOutreach.buildHtml({
            _id: 'preview',
            college: (sample && sample.college) || 'your college',
            contactName: (sample && sample.contactName) || '',
            email: (sample && sample.email) || ''
        });
        res.json({
            success: true,
            subject: collegeOutreach.SUBJECT,
            html,
            sampleCollege: (sample && (sample.college || sample.email)) || '',
            usedRealCollege: !!sample
        });
    } catch (err) {
        console.error('[Growth] college template failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not render the template' });
    }
});

api.get('/colleges', requireGrowthAPI, async (req, res) => {
    try {
        const [rows, counts] = await Promise.all([
            CollegeContact.find({}).sort({ createdAt: -1 }).limit(200).lean(),
            CollegeContact.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])
        ]);
        const byStatus = counts.reduce((a, c) => { a[c._id || 'new'] = c.n; return a; }, {});
        res.json({
            success: true,
            byStatus,
            total: Object.values(byStatus).reduce((a, b) => a + b, 0),
            colleges: rows.map((r) => ({
                id: String(r._id), email: r.email, college: r.college, state: r.state,
                contactName: r.contactName, contactRole: r.contactRole,
                sourceUrl: r.sourceUrl, via: r.via, status: r.status,
                optOut: !!r.optOut, mailCount: r.mailCount || 0, lastMailedAt: r.lastMailedAt
            }))
        });
    } catch (err) {
        console.error('[Growth] college list failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not load colleges' });
    }
});

api.post('/colleges/discover', requireGrowthAPI, discoverLimiter, async (req, res) => {
    const { website, college, state } = req.body || {};
    if (!website || !String(website).trim()) {
        return res.status(400).json({ success: false, error: 'A college website is required.' });
    }
    try {
        const rows = await collegeDiscovery.discoverFromSite(website, {
            college: String(college || '').trim(),
            state: String(state || '').trim()
        });
        if (!rows.length) {
            return res.json({
                success: true, added: 0, skipped: 0, found: 0,
                message: 'No published contact address found on that site. Try the placement page URL directly.'
            });
        }
        const { added, skipped } = await collegeDiscovery.saveContacts(rows);
        res.json({ success: true, found: rows.length, added, skipped, contacts: rows });
    } catch (err) {
        console.error('[Growth] college discovery failed:', err.message);
        res.status(500).json({ success: false, error: 'Lookup failed' });
    }
});

api.post('/colleges/send', requireGrowthAPI, async (req, res) => {
    try {
        const u = await quota.usage();
        if (u.remaining < 1) {
            return res.status(409).json({ success: false, error: 'No marketing quota left this period.', quota: u });
        }
        const ids = [...new Set(((req.body && req.body.ids) || []).map(String).filter(Boolean))];
        const limit = ids.length
            ? Math.min(500, ids.length)
            : Math.max(1, Math.min(500, parseInt(req.body && req.body.limit, 10) || collegeOutreach.DEFAULT_BATCH));

        /* Counted through the same filter the sender uses, so the number the
           dashboard reports is who would actually be mailed — a ticked college
           that has already been written to is not queued twice. */
        const pendingFilter = { status: 'new', optOut: { $ne: true } };
        if (ids.length) pendingFilter._id = { $in: ids };
        const pending = await CollegeContact.countDocuments(pendingFilter);
        if (!pending) {
            return res.status(409).json({ success: false, error: ids.length
                ? 'Those are all mailed already, or have opted out.'
                : 'No colleges are waiting to be mailed.' });
        }

        // Not awaited, for the same reason a campaign is not: the loop
        // throttles between messages and outlives any request.
        collegeOutreach.run({ limit, ids }).catch((err) => {
            console.error('[Growth] college outreach failed:', err.message);
        });
        res.json({ success: true, started: true, queued: Math.min(pending, limit) });
    } catch (err) {
        console.error('[Growth] college send failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not start the send' });
    }
});

/* The confirmation page both unsubscribe routes render. */
const unsubPage = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#0c1220;color:#f0eee8;font-family:Segoe UI,Arial,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;">
<div style="max-width:440px;"><div style="font-size:12px;letter-spacing:5px;color:#f5c542;font-weight:700;">
THE ENTREPRENEURSHIP NETWORK</div><h1 style="font-size:22px;margin:16px 0 12px;">${title}</h1>
<p style="color:#b9b4a8;line-height:1.6;font-size:15px;">${body}</p></div></body></html>`;

// ─── public tracking ─────────────────────────────────────────────────────────
//
// No session — these arrive from a mail client. Every one verifies the HMAC in
// the URL before touching the database, and each answers the same way whether
// the signature was good or bad, so nothing here can be used to probe which
// student ids exist.

/*
 * The last segment is `<sig>.gif`, taken as one param and split here rather
 * than written as `:sig.gif` in the path. Express 5 uses path-to-regexp v8,
 * where a suffix after a parameter no longer parses the way it did in v4 —
 * and a tracking pixel that 404s is a feature that silently reports nothing.
 */
trackingRouter.get('/o/:campaignId/:uid/:file', async (req, res) => {
    const { campaignId, uid } = req.params;
    const sig = String(req.params.file || '').replace(/\.gif$/i, '');
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private', 'Content-Length': tracking.PIXEL.length });
    res.end(tracking.PIXEL);
    if (!tracking.verify(sig, 'o', campaignId, uid)) return;
    try {
        await GrowthCampaign.findByIdAndUpdate(campaignId, { $addToSet: { openedStudentIds: uid } });
    } catch (_) { /* a tracking miss must never surface to the reader */ }
});

trackingRouter.get('/c/:campaignId/:uid/:sig', async (req, res) => {
    const { campaignId, uid, sig } = req.params;
    let target = tracking.BASE + '/student-dashboard.html';
    if (tracking.verify(sig, 'c', campaignId, uid)) {
        try {
            const c = await GrowthCampaign.findByIdAndUpdate(
                campaignId, { $addToSet: { clickedStudentIds: uid } }, { new: true }
            );
            // The destination comes off the campaign, never off the request.
            // A `?url=` parameter here would be an open redirect on a domain
            // students are being told to trust.
            if (c && c.ctaUrl) target = c.ctaUrl;
        } catch (_) {}
    }
    res.redirect(302, target);
});

trackingRouter.get('/u/:uid/:sig', async (req, res) => {
    const { uid, sig } = req.params;
    const page = unsubPage;

    if (!tracking.verify(sig, 'u', uid)) {
        return res.status(400).send(page('That link is not valid',
            'Please use the unsubscribe link from a recent email, or contact us and we will remove you.'));
    }
    try {
        await Student.updateMany({ _id: uid }, { $set: { emailOptOut: true, emailOptOutAt: new Date() } });
        /*
         * One person can hold several Student rows — one per domain — under a
         * single address. Unsubscribing only the row whose id was in the link
         * would leave the others mailing them, which reads as ignoring the
         * request. So the address is opted out everywhere it appears.
         */
        const me = await Student.findById(uid).select('email').lean();
        if (me && me.email) {
            await Student.updateMany({ email: me.email }, { $set: { emailOptOut: true, emailOptOutAt: new Date() } });
        }
    } catch (err) {
        console.error('[Growth] unsubscribe failed:', err.message);
        return res.status(500).send(page('Something went wrong',
            'We could not process that just now. Please try again, or reply to any of our emails and we will remove you by hand.'));
    }
    res.send(page('You have been unsubscribed',
        'You will not receive any more campaign emails from us.<br><br>'
        + 'Your certificates, offer letters and password resets are not affected — those still arrive as normal.'));
});

/*
 * A college asking not to be written to again.
 *
 * Deliberately a separate route from /u/ rather than a branch inside it. The
 * student one writes to the Student collection; if a college id ever reached
 * it, `updateMany({_id})` would match nothing and the page would still say
 * "you have been unsubscribed" — a silent lie to somebody who asked to be left
 * alone. Different collection, different signature kind, different route.
 */
trackingRouter.get('/cu/:id/:sig', async (req, res) => {
    const { id, sig } = req.params;
    if (!tracking.verify(sig, 'cu', id)) {
        return res.status(400).send(unsubPage('That link is not valid',
            'Please use the link from a recent email, or reply to it and we will remove you by hand.'));
    }
    try {
        const me = await CollegeContact.findById(id).select('email').lean();
        await CollegeContact.updateMany({ _id: id }, { $set: { optOut: true, optOutAt: new Date() } });
        // The same office can be listed for more than one campus, so the
        // address is removed everywhere it appears, not just on the row linked.
        if (me && me.email) {
            await CollegeContact.updateMany({ email: me.email }, { $set: { optOut: true, optOutAt: new Date() } });
        }
    } catch (err) {
        console.error('[Growth] college unsubscribe failed:', err.message);
        return res.status(500).send(unsubPage('Something went wrong',
            'We could not process that just now. Please reply to the email and we will remove you by hand.'));
    }
    res.send(unsubPage('Removed',
        'We will not write to this address again.<br><br>'
        + 'If a colleague would be the right contact instead, just reply to the original email and tell us who.'));
});

module.exports = { api, tracking: trackingRouter, revenueFor, ATTRIBUTION_DAYS };
