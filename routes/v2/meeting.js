'use strict';

/**
 * /api/v2/meeting — the Interview Room (public/meeting.html), for the
 * signed-in student only.
 *
 *   GET  /                    who they are, whether the room is on, when the
 *                             interview opens, today's state, past reports
 *   POST /interview/start     { difficulty } → a new interview (easy, medium or
 *                             hard) and its first question, or the question an
 *                             unfinished one stopped at
 *   POST /interview/answer    { sessionId, answer, seconds, proctor } → score,
 *                             feedback, next question or the report
 *   POST /interview/finish    { sessionId, proctor } → the report so far
 */

const express = require('express');
const { requireStudent } = require('../../middleware/sessionAuth');
const ai = require('../../services/aiCoordinator');
const meeting = require('../../services/aiMeeting');

const router = express.Router();
router.use(requireStudent);

const name = (s) => s.name || [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || 'there';
const off = (res) => res.status(503).json({ success: false, message: 'The Interview Room is switched off on this server.' });

router.get('/', async (req, res) => {
    try {
        const s = req.student;
        const on = ai.enabled();
        res.json(Object.assign({
            success: true, enabled: on, name: name(s), domain: s.domain || '', assistant: ai.NAME, questions: meeting.QUESTIONS
        }, on ? await meeting.status({ student: s }) : { schedule: meeting.schedule(), state: 'off', sessionId: null, levels: meeting.LEVELS, reports: [] }));
    } catch (err) {
        console.error('[ai-meeting] me failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load the room.' });
    }
});

function answer(fn) {
    return async (req, res) => {
        if (!ai.enabled()) return off(res);
        try {
            const out = await fn(req);
            if (out.error) {
                return res.status(out.closed ? 403 : out.error === meeting._internal.BUSY ? 503 : 400).json({ success: false, message: out.error, closed: !!out.closed });
            }
            res.json(Object.assign({ success: true }, out));
        } catch (err) {
            console.error('[ai-meeting] interview failed:', err.message);
            res.status(500).json({ success: false, message: meeting._internal.BUSY });
        }
    };
}

const body = (req) => req.body || {};
router.post('/interview/start', answer((req) => meeting.startInterview({ student: req.student, difficulty: String(body(req).difficulty || '').toLowerCase() })));
router.post('/interview/answer', answer((req) => meeting.answerInterview({
    student: req.student, sessionId: body(req).sessionId, answer: body(req).answer, seconds: body(req).seconds, proctor: body(req).proctor
})));
router.post('/interview/finish', answer((req) => meeting.finishInterview({ student: req.student, sessionId: body(req).sessionId, proctor: body(req).proctor })));

module.exports = router;
