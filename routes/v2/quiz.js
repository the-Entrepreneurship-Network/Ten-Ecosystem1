// NEW FEATURE: Quiz System
"use strict";

const express = require("express");
const router = express.Router();
const Student = require("../../models/Student");
const quizEngine = require("../../services/v2/quizEngine");

// NEW FEATURE: Quiz System (auth mirror for V2)
/**
 * Identity from the SESSION first — the same fix documents.js needed.
 *
 * Reading it from an `x-employee-id` header the page filled out of
 * localStorage builds a trap: session-guard.js clears that key whenever a call
 * 401s, so the next request has no header, 401s again, and the student is
 * bounced between the quiz and the login page forever. A browser value cannot
 * be the source of truth for who somebody is.
 */
const { findSessionStudent } = require("../../middleware/sessionAuth");

async function requireStudent(req, res, next) {
    try {
        let student = await findSessionStudent(req);

        // Kept for staff tooling that legitimately names a student.
        if (!student) {
            const employeeId = req.headers["x-employee-id"] || (req.body && req.body.employeeId) || (req.query && req.query.employeeId);
            if (employeeId) student = await Student.findOne({ employeeId: String(employeeId).trim() });
        }

        if (!student) {
            res.set("X-Session-Expired", "1");
            return res.status(401).json({ success: false, message: "Please sign in to continue." });
        }

        req.student = student;
        next();
    } catch (err) {
        res.status(500).json({ success: false, message: "Auth error" });
    }
}

// NEW FEATURE: Quiz System
router.get("/:taskId/status", requireStudent, async (req, res) => {
    try {
        const result = await quizEngine.getQuizStatus(req.student._id, req.params.taskId);
        if (result.error) return res.status(400).json({ success: false, message: result.error });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// NEW FEATURE: Quiz System
router.get("/:taskId/questions", requireStudent, async (req, res) => {
    try {
        const data = await quizEngine.getQuestionsForTask(req.student, req.params.taskId);
        if (data.error === "already_passed") return res.json({ success: true, already_passed: true });
        if (data.fallback) return res.json({ success: true, fallback: true, bank_count: data.bank_count || 0 });
        if (data.error) return res.status(400).json({ success: false, message: data.error, locked_until: data.locked_until });
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// NEW FEATURE: Quiz System
router.post("/:taskId/fallback-complete", requireStudent, async (req, res) => {
    try {
        const result = await quizEngine.completeTaskViaFallback(req.student, req.params.taskId);
        if (result.quiz_ready) return res.json({ success: true, quiz_ready: true });
        if (result.error) return res.status(400).json({ success: false, message: result.error });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// NEW FEATURE: Quiz System
router.post("/:taskId/submit", requireStudent, async (req, res) => {
    try {
        const answers = req.body && req.body.answers;
        const meta = req.body && req.body.meta;
        const result = await quizEngine.submitQuiz(req.student, req.params.taskId, answers, meta);
        if (result.error) return res.status(400).json({ success: false, message: result.error });
        if (result.locked) return res.status(403).json({ success: false, locked: true, locked_until: result.locked_until });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router;
