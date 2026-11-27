'use strict';

/**
 * /api/v2/meeting — the AI Meeting Room (public/meeting.html), for the
 * signed-in student only.
 *
 *   GET  /                    who they are, whether the room is on, past reports
 *   POST /ask                 { text } → the AI Coordinator's answer
 *   POST /interview/start     a new mock interview and its first question
 *   POST /interview/answer    { sessionId, answer } → score, feedback, next question or the report
 *   POST /interview/finish    { sessionId } → the report so far
 */

const express = require('express');
const { requireStudent } = require('../../middleware/sessionAuth');
const ai = require('../../services/aiCoordinator');
const meeting = require('../../services/aiMeeting');

const router = express.Router();
router.use(requireStudent);

const name = (s) => s.name || [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || 'there';
const off = (res) => res.status(503).json({ success: false, message: 'The AI Meeting Room is switched off on this server.' });

router.get('/', async (req, res) => {
    try {
        const s = req.student;
        res.json({
            success: true, enabled: ai.enabled(), name: name(s), domain: s.domain || '', assistant: ai.NAME,
            questions: meeting.QUESTIONS, reports: ai.enabled() ? await meeting.reports({ student: s }) : []
        });
    } catch (err) {
        console.error('[ai-meeting] me failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load the room.' });
    }
});

router.post('/ask', async (req, res) => {
    if (!ai.enabled()) return off(res);
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Ask something first.' });
    if (text.length > 2000) return res.status(400).json({ success: false, message: 'That is too long for one question.' });
    try {
        res.json(Object.assign({ success: true }, await meeting.ask({ student: req.student, text })));
    } catch (err) {
        console.error('[ai-meeting] ask failed:', err.message);
        res.status(500).json({ success: false, message: meeting._internal.BUSY });
    }
});

function answer(fn) {
    return async (req, res) => {
        if (!ai.enabled()) return off(res);
        try {
            const out = await fn(req);
            if (out.error) return res.status(out.error === meeting._internal.BUSY ? 503 : 400).json({ success: false, message: out.error });
            res.json(Object.assign({ success: true }, out));
        } catch (err) {
            console.error('[ai-meeting] interview failed:', err.message);
            res.status(500).json({ success: false, message: meeting._internal.BUSY });
        }
    };
}

router.post('/interview/start', answer((req) => meeting.startInterview({ student: req.student })));
router.post('/interview/answer', answer((req) => meeting.answerInterview({
    student: req.student, sessionId: req.body && req.body.sessionId, answer: req.body && req.body.answer
})));
router.post('/interview/finish', answer((req) => meeting.finishInterview({ student: req.student, sessionId: req.body && req.body.sessionId })));

module.exports = router;
