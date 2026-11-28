'use strict';

/**
 * The student's application tracker, on the server.
 *
 * Mounted under both agents (/api/v2/jobs/tracker and /api/v2/resume/tracker)
 * behind their own Career Studio gates, so a student with either portal sees
 * the same rows: a job tracked from a listing, applied to from the resume
 * portal, reminded about on the phone.
 */

const express = require('express');
const JobTrack = require('../../models/JobTrack');

const router = express.Router();
const STATUSES = JobTrack.schema.path('status').enumValues;
/* Sending the application, by the portal or by mail, starts the follow-up clock. */
const SENT = ['applied', 'emailed'];

const who = (req) => {
    const s = req.studioSubject || {};
    return { subject: String(s._id || s.employeeId || ''), employeeId: String(s.employeeId || '') };
};
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** The row as the screen wants it. */
const shape = (r) => ({
    date: (r.createdAt ? new Date(r.createdAt) : new Date()).toISOString().slice(0, 10),
    url: r.url, company: r.company, role: r.role, fit: r.fit, status: r.status, notes: r.notes, to: r.to,
    followUps: r.followUps || [], appliedAt: r.appliedAt || null, followUpsSent: r.followUpsSent || [],
});

router.get('/', async (req, res) => {
    const { subject } = who(req);
    if (!subject) return res.status(401).json({ ok: false, error: 'Please sign in.' });
    try {
        const rows = await JobTrack.find({ subject }).sort({ updatedAt: -1 }).limit(200).lean();
        res.json({ ok: true, rows: rows.map(shape) });
    } catch (e) {
        res.status(503).json({ ok: false, error: 'Could not load your tracker just now.' });
    }
});

/* Add or update one row, by its URL. */
router.put('/', async (req, res) => {
    const { subject, employeeId } = who(req);
    const b = req.body || {};
    const url = str(b.url, 600);
    if (!subject) return res.status(401).json({ ok: false, error: 'Please sign in.' });
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ ok: false, error: 'A tracked job needs its link.' });
    if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
    try {
        const set = { employeeId };
        ['company', 'role', 'notes', 'to'].forEach((k) => { if (b[k] !== undefined) set[k] = str(b[k], k === 'notes' ? 1000 : 200); });
        if (b.fit !== undefined) set.fit = Math.max(0, Math.min(5, Number(b.fit) || 0));
        if (b.status !== undefined) set.status = b.status;
        if (Array.isArray(b.followUps)) {
            set.followUps = b.followUps.slice(0, 4).map((f) => ({
                afterDays: Math.max(1, Math.min(60, Number(f && f.afterDays) || 0)), subject: str(f && f.subject, 200), body: str(f && f.body, 3000),
            })).filter((f) => f.afterDays && f.body);
        }
        const update = { $set: set, $setOnInsert: { subject, url } };
        if (Array.isArray(b.followUpsSent)) update.$addToSet = { followUpsSent: { $each: b.followUpsSent.map(Number).filter((n) => n > 0) } };
        let row = await JobTrack.findOneAndUpdate({ subject, url }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
        if (SENT.includes(row.status) && !row.appliedAt) {
            row = await JobTrack.findOneAndUpdate({ _id: row._id, appliedAt: null }, { $set: { appliedAt: new Date() } }, { new: true }) || row;
        }
        res.json({ ok: true, row: shape(row) });
    } catch (e) {
        res.status(503).json({ ok: false, error: 'Could not save that just now.' });
    }
});

router.delete('/', async (req, res) => {
    const { subject } = who(req);
    if (!subject) return res.status(401).json({ ok: false, error: 'Please sign in.' });
    try {
        await JobTrack.deleteOne({ subject, url: str(req.query.url, 600) });
        res.json({ ok: true });
    } catch (e) {
        res.status(503).json({ ok: false, error: 'Could not remove that just now.' });
    }
});

/* Rows this browser kept before the tracker moved to the server, brought across once. */
router.post('/import', async (req, res) => {
    const { subject, employeeId } = who(req);
    if (!subject) return res.status(401).json({ ok: false, error: 'Please sign in.' });
    const rows = (Array.isArray((req.body || {}).rows) ? req.body.rows : []).slice(0, 100)
        .filter((r) => r && /^https?:\/\//.test(String(r.url || '')));
    try {
        await Promise.all(rows.map((r) => JobTrack.updateOne({ subject, url: str(r.url, 600) }, {
            $setOnInsert: {
                subject, employeeId, url: str(r.url, 600), company: str(r.company, 200), role: str(r.role, 200),
                fit: Math.max(0, Math.min(5, Number(r.fit) || 0)), notes: str(r.notes, 1000),
                status: STATUSES.includes(r.status) ? r.status : 'found',
            },
        }, { upsert: true })));
        res.json({ ok: true, imported: rows.length });
    } catch (e) {
        res.status(503).json({ ok: false, error: 'Could not bring your saved jobs across just now.' });
    }
});

module.exports = router;
