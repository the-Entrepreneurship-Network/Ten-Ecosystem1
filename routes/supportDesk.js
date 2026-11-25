'use strict';

/**
 * HR's side of the complaints@ help desk (public/hr-help-desk.html).
 *
 * Whether it is connected and what it did with recent emails, and the answers
 * it sends, which HR can edit, switch off and add to. HR and admins only.
 */
const express = require('express');
const mongoose = require('mongoose');
const { requireHR } = require('../middleware/sessionAuth');
const SupportAnswer = require('../models/SupportAnswer');
const SupportTicket = require('../models/SupportTicket');
const agent = require('../services/supportDesk/agent');
const gmail = require('../services/supportDesk/gmail');
const { PLACEHOLDERS } = require('../services/supportDesk/facts');

const router = express.Router();
router.use(requireHR);

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[help desk]', req.method, req.path, err.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

const lines = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split('\n'))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 40);

/** Only the editable fields, trimmed and capped. */
function fields(body) {
    const out = {};
    if (body.question !== undefined) out.question = String(body.question).trim().slice(0, 300);
    if (body.examples !== undefined) out.examples = lines(body.examples).map((s) => s.slice(0, 1500));
    if (body.answer !== undefined) out.answer = String(body.answer).trim().slice(0, 5000);
    if (body.personal !== undefined) out.personal = String(body.personal).trim().slice(0, 5000);
    if (body.active !== undefined) out.active = body.active === true || body.active === 'true';
    return out;
}

router.get('/status', wrap(async (req, res) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const last24h = {};
    for (const action of ['sent', 'drafted', 'held', 'human', 'skipped', 'failed']) {
        last24h[action] = await SupportTicket.countDocuments({ action, createdAt: { $gte: since } });
    }
    res.json({
        success: true,
        mode: agent.mode(),
        connected: gmail.configured(),
        lastRun: agent.lastRun,
        last24h,
        waiting: await SupportTicket.countDocuments({ action: 'drafted' }),
        labels: agent.LABEL,
        placeholders: PLACEHOLDERS
    });
}));

router.post('/send-drafts', wrap(async (req, res) => {
    if (!gmail.configured()) return res.status(400).json({ success: false, message: 'The help desk is not connected to complaints@ yet.' });
    res.json(Object.assign({ success: true }, await agent.sendAllDrafts()));
}));

router.get('/tickets', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ success: true, tickets: await SupportTicket.find({}).sort({ createdAt: -1 }).limit(limit) });
}));

router.get('/answers', wrap(async (req, res) => {
    await agent.seedStarters();
    res.json({ success: true, answers: await SupportAnswer.find({}).sort({ uses: -1 }) });
}));

router.post('/answers', wrap(async (req, res) => {
    const f = fields(req.body || {});
    if (!f.question || !f.answer) {
        return res.status(400).json({ success: false, message: 'Write both the question and the answer.' });
    }
    res.json({ success: true, answer: await SupportAnswer.create(Object.assign(f, { source: 'hr' })) });
}));

router.put('/answers/:id', wrap(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: 'Answer not found.' });
    const f = fields(req.body || {});
    if (f.question === '' || f.answer === '') {
        return res.status(400).json({ success: false, message: 'The question and the answer cannot be empty.' });
    }
    // `edited` keeps a starter answer as HR left it when a later release updates the starters.
    const answer = await SupportAnswer.findByIdAndUpdate(req.params.id, { $set: Object.assign(f, { edited: true }) }, { new: true });
    if (!answer) return res.status(404).json({ success: false, message: 'Answer not found.' });
    res.json({ success: true, answer });
}));

router.delete('/answers/:id', wrap(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: 'Answer not found.' });
    const answer = await SupportAnswer.findById(req.params.id);
    if (!answer) return res.status(404).json({ success: false, message: 'Answer not found.' });
    // A starter answer is switched off rather than deleted: deleted, the next
    // start would put it straight back.
    if (answer.starterKey) await SupportAnswer.updateOne({ _id: answer._id }, { $set: { active: false, edited: true } });
    else await SupportAnswer.deleteOne({ _id: answer._id });
    res.json({ success: true });
}));

router.post('/try', wrap(async (req, res) => {
    const text = String((req.body && req.body.text) || '').slice(0, 3000);
    if (!text.trim()) return res.status(400).json({ success: false, message: 'Type a question to try.' });
    res.json(Object.assign({ success: true }, await agent.tryQuestion(text)));
}));

module.exports = router;
