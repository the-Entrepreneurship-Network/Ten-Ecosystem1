// NEW FEATURE: Quiz System
"use strict";

const express = require("express");
const router = express.Router();
const Student = require("../../models/Student");
const quizEngine = require("../../services/v2/quizEngine");

// NEW FEATURE: Quiz System (auth mirror for V2)
async function requireStudent(req, res, next) {
    try {
        const employeeId = req.headers["x-employee-id"] || req.body.employeeId || req.query.employeeId;
        if (!employeeId) return res.status(401).json({ success: false, message: "Authentication required" });
        const student = await Student.findOne({ employeeId: String(employeeId) });
        if (!student) return res.status(401).json({ success: false, message: "Student not found" });
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
