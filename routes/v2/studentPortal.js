// NEW FEATURE: Student Portal V2 API Routes
"use strict";

const express      = require("express");
const router       = express.Router();
const Student      = require("../../models/Student");

const {
  validate,
  studentRegisterSchema,
  studentLoginSchema,
  studentProfileUpdateSchema,
  mongoIdParamSchema
} = require("../../middleware/validationSchemas");

const rateLimit = require("express-rate-limit");
const authenticatedLimiter = rateLimit({
    windowMs: process.env.RATE_AUTH_USER_WINDOW_MS
      ? parseInt(process.env.RATE_AUTH_USER_WINDOW_MS)
      : 15 * 60 * 1000,
    max: process.env.RATE_AUTH_USER_MAX
      ? parseInt(process.env.RATE_AUTH_USER_MAX)
      : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please slow down." }
});
router.use(authenticatedLimiter);

const mongoose = require("mongoose");
if (!Student.schema.path("v2Onboarded"))           Student.schema.add({ v2Onboarded:           { type: Boolean, default: false } });
if (!Student.schema.path("v2DurationType"))        Student.schema.add({ v2DurationType:        { type: String,  default: null  } });
if (!Student.schema.path("onboardingPopupSeen"))   Student.schema.add({ onboardingPopupSeen:   { type: Boolean, default: false } });
if (!Student.schema.path("joinerTypeSelected"))    Student.schema.add({ joinerTypeSelected:    { type: Boolean, default: false } });
if (!Student.schema.path("joinerType"))            Student.schema.add({ joinerType:            { type: String,  default: null  } });

const StudentTaskProgress = require("../../models/new/StudentTaskProgress");
const DomainTask   = require("../../models/new/DomainTask");
const Notification = require("../../models/Notification");
const { broadcastNotification } = require("../../utils/sseHub");

/**
 * Tell a student their submission was reviewed.
 *
 * Approve and reject both updated the row and returned, so the only way a
 * student learned the outcome — including a rejection they need to act on —
 * was to reopen the Task Journey and notice the badge had changed. The
 * coordinator's decision is the one event in the loop the student most needs
 * pushed to them.
 *
 * Never allowed to fail the review it is reporting on: a notification problem
 * must not turn a successful approval into a 500.
 */
async function notifyTaskDecision(student, taskId, decision, feedback, coinsAwarded) {
    try {
        const task  = taskId ? await DomainTask.findById(taskId).lean() : null;
        const title = (task && task.title) || "your task";
        const approved = decision === "approved";

        let message = approved
            ? `Your submission for "${title}" was approved.`
            : `Your submission for "${title}" needs another look.`;
        if (approved && coinsAwarded) message += ` You earned ${coinsAwarded} coins.`;
        if (feedback) message += ` Coordinator feedback: ${feedback}`;

        const notif = new Notification({
            title: approved ? "Task approved" : "Task sent back",
            message,
            type: approved ? "success" : "warning",
            from: "Coordinator",
            targetType: "student",
            targetEmployeeId: student.employeeId,
            targetDomain: student.domain
        });
        await notif.save();
        broadcastNotification(student.domain, student.employeeId, notif);
    } catch (err) {
        console.error("[V2] task decision notify failed:", err.message);
    }
}

/**
 * Tell the domain's coordinator that work is waiting for them.
 *
 * The submit handler wrote the progress row and a legacy Submission row and
 * stopped, so the only way a coordinator discovered a new submission was to
 * open the review queue and look. That makes turnaround time a function of how
 * often someone remembers to check.
 */
async function notifyCoordinatorOfSubmission(student, taskId) {
    try {
        const task  = taskId ? await DomainTask.findById(taskId).lean() : null;
        const title = (task && (task.taskTitle || task.title)) || "a task";

        const notif = new Notification({
            title: "New submission to review",
            message: `${student.name || student.employeeId} (${student.employeeId}) submitted "${title}" for review.`,
            type: "info",
            from: "Student",
            targetType: "coordinator-domain",
            targetDomain: student.domain
        });
        await notif.save();
        // employeeId omitted on purpose: this goes to the coordinator channel
        // for the domain, not back to the student who just submitted.
        broadcastNotification(student.domain, null, notif);
    } catch (err) {
        console.error("[V2] submission notify failed:", err.message);
    }
}
const taskEngine   = require("../../services/v2/taskEngine");
const coinService  = require("../../services/v2/coinService");

// ============================================================
// TASK FALLBACK POOL — used only when Gemini API call fails
// ============================================================
const TASK_FALLBACK_POOLS = {
  default: {
    easy: [
      { title: "Introduction to Core Concepts", 
        description: "Research and document the fundamental concepts of your domain. Create a structured summary with examples.",
        deliverables: "1. Detailed PDF/Markdown summary document.\n2. Code snippets demonstrating core principles." },
      { title: "Environment Setup & Configuration",
        description: "Set up your local development environment. Document each step with screenshots and notes.",
        deliverables: "1. Environment setup guide with screenshots.\n2. Verification script output." },
      { title: "Hello World Project",
        description: "Build a minimal working project demonstrating the basic structure of your domain's tech stack.",
        deliverables: "1. GitHub repository link.\n2. Working application demo." },
      { title: "Reading & Summarizing Documentation",
        description: "Read the official documentation for the primary tool in your domain. Write a 300-word summary of key features.",
        deliverables: "1. 300-word summary document.\n2. Key features diagram or mindmap." },
      { title: "Basic Syntax & Pattern Practice",
        description: "Complete 5 basic syntax exercises relevant to your domain. Share your code with comments explaining each line.",
        deliverables: "1. Commented code files.\n2. Execution logs or test output." }
    ],
    medium: [
      { title: "Build a Mini Project",
        description: "Create a small functional project using the core tools of your domain. Include error handling and basic tests.",
        deliverables: "1. GitHub repository link with clean commits.\n2. Unit test reports." },
      { title: "API Integration Exercise",
        description: "Integrate a public API relevant to your domain. Handle responses, errors, and edge cases.",
        deliverables: "1. Working integration code.\n2. API response handling documentation." },
      { title: "Debugging Challenge",
        description: "Analyze the provided buggy code, identify issues, fix them, and document your debugging process.",
        deliverables: "1. Bug fix pull request / diff.\n2. Root cause analysis write-up." },
      { title: "Refactoring Exercise",
        description: "Take an existing piece of code and refactor it for better readability, performance, and maintainability.",
        deliverables: "1. Before/After code comparison.\n2. Performance benchmark result." },
      { title: "Database & Data Model Task",
        description: "Design a data schema for a real-world use case in your domain. Explain your design decisions.",
        deliverables: "1. ER diagram or schema definition.\n2. Design decision write-up." }
    ],
    hard: [
      { title: "Full Feature Implementation",
        description: "Implement a complete feature end-to-end including frontend, backend logic, and data persistence.",
        deliverables: "1. End-to-end working feature code.\n2. Video walkthrough demonstration." },
      { title: "Performance Optimization",
        description: "Profile an application and implement at least 3 measurable performance improvements. Document before/after metrics.",
        deliverables: "1. Profiling analysis report.\n2. Optimized codebase with benchmark comparison." },
      { title: "Security Audit & Hardening",
        description: "Conduct a security review of a sample codebase, identify vulnerabilities, and implement fixes with explanation.",
        deliverables: "1. Vulnerability assessment report.\n2. Security patches with tests." },
      { title: "System Architecture Design",
        description: "Design a scalable system architecture for a high-traffic use case. Create diagrams and justify your choices.",
        deliverables: "1. Architecture design specification.\n2. Component interaction diagrams." },
      { title: "Automated Testing Suite",
        description: "Write a comprehensive test suite covering unit, integration, and edge case scenarios for a given module.",
        deliverables: "1. Test suite codebase.\n2. Code coverage report (>80%)." }
    ],
    expert: [
      { title: "Production-Grade Application",
        description: "Build a production-ready application with CI/CD pipeline, monitoring, logging, and deployment documentation.",
        deliverables: "1. Live deployed application URL.\n2. CI/CD pipeline config and deployment guide." },
      { title: "Architecture Decision Record (ADR)",
        description: "Write a formal ADR for a complex technical decision in your domain with proof-of-concept code.",
        deliverables: "1. Formal ADR document.\n2. Proof-of-concept codebase." },
      { title: "Open Source Contribution",
        description: "Identify a relevant open-source project, fix a bug or add a feature, and document your contribution process.",
        deliverables: "1. Link to merged or submitted Pull Request.\n2. Contribution journey write-up." },
      { title: "Technical Specification & Plan",
        description: "Create a technical specification document for a new feature, including API design, data models, and implementation plan.",
        deliverables: "1. Comprehensive RFC / Spec document.\n2. Prototype implementation." },
      { title: "Innovation Proof of Concept",
        description: "Identify a problem in your domain, propose a novel solution, build a proof-of-concept, and present findings.",
        deliverables: "1. Working POC application.\n2. Presentation deck or video." }
    ]
  }
};

function getFallbackTask(domain, difficulty, recentTitles = []) {
  const pool = TASK_FALLBACK_POOLS[domain] || TASK_FALLBACK_POOLS.default;
  const diffPool = pool[difficulty] || pool.medium || TASK_FALLBACK_POOLS.default.medium;
  const available = diffPool.filter(t => !recentTitles.includes(t.title));
  const source = available.length > 0 ? available : diffPool;
  return source[Math.floor(Math.random() * source.length)];
}

// FEATURE 7 — Fallback video map (domain → week → YouTube URL)
const FALLBACK_VIDEOS = {
    "Python Development": {
        1: "https://www.youtube.com/watch?v=rfscVS0vtbw",
        2: "https://www.youtube.com/watch?v=t8pPdKYpowI",
        3: "https://www.youtube.com/watch?v=HGOBQPFzWKo",
        4: "https://www.youtube.com/watch?v=kqtD5dpn9C8"
    },
    "Web Development": {
        1: "https://www.youtube.com/watch?v=mU6anWqZJcc",
        2: "https://www.youtube.com/watch?v=G3e-cpL7ofc",
        3: "https://www.youtube.com/watch?v=Oe421EPjeBE",
        4: "https://www.youtube.com/watch?v=EerdGm-ehJQ"
    },
    "MERN Stack Development": {
        1: "https://www.youtube.com/watch?v=7CqJlxBYj-M",
        2: "https://www.youtube.com/watch?v=mrHNSanmqQ4",
        3: "https://www.youtube.com/watch?v=98BzS5Oz5E4",
        4: "https://www.youtube.com/watch?v=Oe421EPjeBE"
    },
    "Java Development": {
        1: "https://www.youtube.com/watch?v=eIrMbAQSU34",
        2: "https://www.youtube.com/watch?v=GoXwIVyNvX0",
        3: "https://www.youtube.com/watch?v=grEKMHGYyns",
        4: "https://www.youtube.com/watch?v=UmnCZ7-9yDY"
    },
    "DevOps with AWS": {
        1: "https://www.youtube.com/watch?v=9psmcSEWGGU",
        2: "https://www.youtube.com/watch?v=k1RI5locZE4",
        3: "https://www.youtube.com/watch?v=RLTfFyVe6u4",
        4: "https://www.youtube.com/watch?v=XrX5GFt468s"
    },
    "Artificial Intelligence": {
        1: "https://www.youtube.com/watch?v=a0_lo_GDcFw",
        2: "https://www.youtube.com/watch?v=JMUxmLyrhSk",
        3: "https://www.youtube.com/watch?v=GwIo3gDZCVQ",
        4: "https://www.youtube.com/watch?v=I74ymkoNTnw"
    },
    "Data Science": {
        1: "https://www.youtube.com/watch?v=ua-CiDNNj30",
        2: "https://www.youtube.com/watch?v=vmEHCJofslg",
        3: "https://www.youtube.com/watch?v=GPVsHOlRBBI",
        4: "https://www.youtube.com/watch?v=7eh4d6sabA0"
    },
    "Cyber Security": {
        1: "https://www.youtube.com/watch?v=inWWhr5tnEA",
        2: "https://www.youtube.com/watch?v=qiQR5rTSshw",
        3: "https://www.youtube.com/watch?v=3Kq1MIfTWCE",
        4: "https://www.youtube.com/watch?v=Dk-ZqQ-bfy4"
    },
    "Software Engineering": {
        1: "https://www.youtube.com/watch?v=O753uuutqH8",
        2: "https://www.youtube.com/watch?v=FkHjG759ab8",
        3: "https://www.youtube.com/watch?v=I6jB0nM9SKU",
        4: "https://www.youtube.com/watch?v=WpkDN78P884"
    },
    "Flutter Development": {
        1: "https://www.youtube.com/watch?v=1ukSR1GRtMU",
        2: "https://www.youtube.com/watch?v=C-fKAzdTrLU",
        3: "https://www.youtube.com/watch?v=x0uinJvhNxI",
        4: "https://www.youtube.com/watch?v=IfUjHNODRoM"
    },
    "HR Management": {
        1: "https://www.youtube.com/watch?v=XcFABjHIxtI",
        2: "https://www.youtube.com/watch?v=9wMDVSzMqoU",
        3: "https://www.youtube.com/watch?v=TDH0zHKtHOU",
        4: "https://www.youtube.com/watch?v=kN7g0cjyNFE"
    },
    "Venture Capital": {
        1: "https://www.youtube.com/watch?v=TpTt6LMSACs",
        2: "https://www.youtube.com/watch?v=GvZ03MEzH5Q",
        3: "https://www.youtube.com/watch?v=i94LMpDkjO4",
        4: "https://www.youtube.com/watch?v=xF_UiVFq2dU"
    },
    "Vibe Coding": {
        1: "https://www.youtube.com/watch?v=gd1lqiPNxWI",
        2: "https://www.youtube.com/watch?v=Oe421EPjeBE",
        3: "https://www.youtube.com/watch?v=G3e-cpL7ofc",
        4: "https://www.youtube.com/watch?v=EerdGm-ehJQ"
    },
    "Space Research": {
        1: "https://www.youtube.com/watch?v=lizvFTYXX3E",
        2: "https://www.youtube.com/watch?v=vkgZHMSbIAs",
        3: "https://www.youtube.com/watch?v=StwE0jj3bD4",
        4: "https://www.youtube.com/watch?v=N_c9pD1BdLU"
    },
    "Business Analyst": {
        1: "https://www.youtube.com/watch?v=yalIhONmXaY",
        2: "https://www.youtube.com/watch?v=s3euyoMZP1E",
        3: "https://www.youtube.com/watch?v=obhBuH3XCUQ",
        4: "https://www.youtube.com/watch?v=ZC3xT8W7Rbk"
    },
    "HR": {
        1: "https://www.youtube.com/watch?v=XcFABjHIxtI",
        2: "https://www.youtube.com/watch?v=9wMDVSzMqoU",
        3: "https://www.youtube.com/watch?v=TDH0zHKtHOU",
        4: "https://www.youtube.com/watch?v=kN7g0cjyNFE"
    }
};

// Auth middleware — session-derived.
//
// This used to read the employeeId from an `x-employee-id` header, the body or
// the query string, so any caller could act as any student simply by naming
// their employee ID. It also crashed on GET requests (`req.body.employeeId`
// with no body parsed), which surfaced as a 500 "Auth error".
const { requireStudent, requireStaff, sessionEmployeeId } = require("../../middleware/sessionAuth");
const { normalizeTenure, getTenureLabel } = require("../../utils/tenure");
const { requireTenurePaid } = require("../../middleware/tenurePaymentGate");

// ────────────────────────────────────────────────
// FEATURE 2 — GET /api/v2/student/me
// Validates the student session (used for auto-login)
// ────────────────────────────────────────────────
router.get("/student/me", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const { totalCoins, rupeeValue } = await coinService.getBalance(student._id);
        const me = student;

        // Auto-heal and sync multiple domains for the same student email on-the-fly
        const emailLc = String(me.email || "").trim().toLowerCase();
        let currentLinked = me.linkedDomains || [];
        if (emailLc) {
            const escapedEmail = emailLc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const emailRegex = new RegExp("^" + escapedEmail + "$", "i");
            const allForEmail = await Student.find({ email: { $regex: emailRegex } });
            if (allForEmail.length >= 2) {
                const updatedLinked = allForEmail.map(s => ({
                    domain:     s.domain,
                    studentId:  s._id,
                    employeeId: s.employeeId
                }));
                // If links are stale or count mismatch, push correct linkedDomains to DB
                if (!currentLinked || currentLinked.length !== updatedLinked.length) {
                    await Student.updateMany({ email: { $regex: emailRegex } }, { linkedDomains: updatedLinked });
                    currentLinked = updatedLinked;
                }
            }
        }

        const { calculateAttendancePercentage, getTenureDays } = require("../../utils/attendanceUtils");
        const Attendance = require("../../models/Attendance");

        // Compute internship end date using getTenureDays helper
        let meEndDate = null;
        if (me.joiningDate) {
            const jd = new Date(me.joiningDate);
            if (!isNaN(jd.getTime())) {
                const days = getTenureDays(me.tenure || "1month");
                const end = new Date(jd); end.setDate(end.getDate() + days);
                meEndDate = end.toISOString();
            }
        }

        // Live attendance recomputation
        const attendanceRecords = await Attendance.find({ employeeId: me.employeeId });
        const startDate = me.internshipStartDate || me.joiningDate || me.createdAt;
        const tenure = me.tenure || '1month';
        const attResult = calculateAttendancePercentage(attendanceRecords, startDate, tenure);

        const currentPct = typeof attResult === 'object' ? attResult.percentage : attResult;
        const daysPresent = typeof attResult === 'object' ? attResult.daysPresent : 0;

        if (me.attendancePercentage !== currentPct) {
            await Student.updateOne(
                { _id: me._id },
                { 
                    $set: { 
                        attendancePercentage: currentPct,
                        calculatedAttendance: daysPresent,
                        attendanceLastCalculated: new Date()
                    }
                }
            );
        }

        res.json({
            success: true,
            student: {
                name:               `${me.firstName || ""} ${me.lastName || ""}`.trim(),
                firstName:          me.firstName,
                lastName:           me.lastName,
                email:              me.email || "",
                phone:              me.whatsapp || me.phone || "",
                college:            me.collegeName || me.college || "",
                collegeName:        me.collegeName || me.college || "",
                employeeId:         me.employeeId,
                domain:             me.domain,
                domains:            me.domains || [me.domain],
                tenure:             me.tenure,
                joiningDate:        me.joiningDate,
                internshipEnd:      meEndDate,
                endDate:            meEndDate,
                linkedDomains:      currentLinked,
                onboardingPopupSeen: me.onboardingPopupSeen || false,
                joinerTypeSelected:  me.joinerTypeSelected  || false,
                joinerType:          me.joinerType           || null,
                hasSeenWelcome:      me.hasSeenWelcome       || false,
                hasSeenOnboarding:   me.hasSeenOnboarding    || false,
                calculatedAttendance: daysPresent,
                attendancePercentage: currentPct,
                attendance: typeof attResult === 'object' ? attResult : {
                    percentage: currentPct,
                    daysPresent,
                    totalWorkingDays: 0,
                    requiredDays: 0,
                    isEligible: currentPct >= 75,
                    stillNeeds: 0
                }
            },
            totalCoins,
            rupeeValue
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// FEATURE 1 — POST /api/v2/student/mark-onboarding-seen
// Marks onboarding popup as seen — never shows again
// ────────────────────────────────────────────────
router.post("/student/mark-onboarding-seen", requireStudent, async (req, res) => {
    try {
        await Student.updateOne(
            { _id: req.student._id },
            { $set: { onboardingPopupSeen: true } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// FEATURE 1 — POST /api/v2/student/mark-welcome-seen
// Marks welcome modal as seen
// ────────────────────────────────────────────────
router.post("/student/mark-welcome-seen", requireStudent, async (req, res) => {
    try {
        await Student.updateOne(
            { _id: req.student._id },
            { $set: { hasSeenWelcome: true } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// FEATURE 1 — POST /api/v2/student/set-joiner-type
// Saves joiner type selection — never shows again
// ────────────────────────────────────────────────
router.post("/student/set-joiner-type", requireStudent, async (req, res) => {
    try {
        const { joinerType } = req.body;
        if (!["new", "whatsapp"].includes(joinerType)) {
            return res.status(400).json({ success: false, message: "Invalid joiner type" });
        }
        await Student.updateOne(
            { _id: req.student._id },
            { $set: { joinerTypeSelected: true, joinerType } }
        );
        res.json({ success: true, joinerType });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Helper for onboarding attendance calculation
function countDaysExcludingSundaysLocal(start, end) {
    let count = 0;
    const cur = new Date(start); cur.setHours(0,0,0,0);
    const e = new Date(end);     e.setHours(0,0,0,0);
    while (cur <= e) {
        if (cur.getDay() !== 0) count++; // 0 is Sunday
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

// ────────────────────────────────────────────────
// POST /api/v2/student/complete-onboarding
// Saves all onboarding fields, calculates attendance, and saves to MongoDB.
// ────────────────────────────────────────────────
router.post("/student/complete-onboarding", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const { joinerType, updatedEmployeeId, joiningDate } = req.body;

        const updates = {};
        
        let presentCount = 0;
        let totalTenureDays = 30;
        let daysNeededToAttendMore = 0;

        if (joinerType) {
            updates.joinerType = joinerType;
            updates.joinerTypeSelected = true;
        }

        if (joinerType === "whatsapp") {
            if (joiningDate) {
                const startDate = new Date(joiningDate);
                if (!isNaN(startDate.getTime())) {
                    // Only internshipStartDate moves. This used to overwrite
                    // joiningDate with the same value, which silently defeated
                    // the whole feature: the pre-portal credit is the gap
                    // BETWEEN the real start and the portal registration date,
                    // so making them equal left a gap of zero and the student
                    // was still marked absent for the WhatsApp months.
                    updates.internshipStartDate = startDate;

                    // Keep a portal-registration date to measure that gap from.
                    if (!student.joiningDate) {
                        updates.joiningDate = (student.createdAt || new Date()).toISOString().slice(0, 10);
                    }

                    // A start date in the future, or after the student already
                    // registered, is not a WhatsApp back-date.
                    const portalStart = new Date(updates.joiningDate || student.joiningDate || student.createdAt);
                    if (startDate > new Date()) {
                        return res.status(400).json({ success: false, message: "Your start date cannot be in the future." });
                    }
                    if (!isNaN(portalStart.getTime()) && startDate > portalStart) {
                        return res.status(400).json({
                            success: false,
                            message: "Your WhatsApp start date should be on or before the day you registered on the portal."
                        });
                    }
                }
            }

            if (updatedEmployeeId && updatedEmployeeId.trim() !== "" && updatedEmployeeId.trim() !== student.employeeId) {
                const targetEmpId = updatedEmployeeId.trim();
                const existing = await Student.findOne({ employeeId: targetEmpId });
                if (existing) {
                    return res.status(400).json({ success: false, message: "This Employee ID is already registered by another student." });
                }
                updates.employeeId = targetEmpId;
                updates.employeeIdOverride = targetEmpId;
            }

            const actualJoiningDate = joiningDate || student.joiningDate || student.createdAt;
            if (actualJoiningDate) {
                const Attendance = require("../../models/Attendance");
                const { calculateAttendancePercentage, getTenureDays } = require("../../utils/attendanceUtils");
                const emp = updates.employeeId || student.employeeId;
                const attendanceRecords = await Attendance.find({ employeeId: emp });
                
                const attResult = calculateAttendancePercentage(attendanceRecords, actualJoiningDate, student.tenure || student.v2DurationType);
                const calculatedPct = typeof attResult === 'object' ? attResult.percentage : attResult;
                const daysPresent = typeof attResult === 'object' ? attResult.daysPresent : attendanceRecords.filter(r => r.status === 'Present').length;

                updates.calculatedAttendance = daysPresent;
                updates.calculatedAttendancePercentage = calculatedPct;
                updates.attendancePercentage = calculatedPct;

                totalTenureDays = getTenureDays(student.tenure || student.v2DurationType);
                const requiredDays = Math.ceil(totalTenureDays * 0.75);
                daysNeededToAttendMore = Math.max(0, requiredDays - daysPresent);
            }
        } else {
            updates.calculatedAttendance = 0;
            updates.attendancePercentage = 0;
        }

        updates.onboardingPopupSeen = true;
        updates.hasSeenOnboarding = true;
        updates.hasSeenWelcome = true;

        const updatedStudent = await Student.findOneAndUpdate(
            { _id: student._id },
            { $set: updates },
            { new: true }
        );

        if (updates.employeeId && updates.employeeId !== student.employeeId) {
            try {
                const Attendance = require("../../models/Attendance");
                const Submission = require("../../models/Submission");
                await Attendance.updateMany({ employeeId: student.employeeId }, { $set: { employeeId: updates.employeeId } });
                await Submission.updateMany({ employeeId: student.employeeId }, { $set: { employeeId: updates.employeeId } });
            } catch (assocErr) {
                console.error("Correlated updates error:", assocErr);
            }
        }

        res.json({
            success: true,
            student: {
                name:               `${updatedStudent.firstName || ""} ${updatedStudent.lastName || ""}`.trim(),
                firstName:          updatedStudent.firstName,
                lastName:           updatedStudent.lastName,
                email:              updatedStudent.email || "",
                phone:              updatedStudent.whatsapp || updatedStudent.phone || "",
                college:            updatedStudent.collegeName || updatedStudent.college || "",
                collegeName:        updatedStudent.collegeName || updatedStudent.college || "",
                employeeId:         updatedStudent.employeeId,
                domain:             updatedStudent.domain,
                tenure:             updatedStudent.tenure,
                joiningDate:        updatedStudent.joiningDate,
                onboardingPopupSeen: updatedStudent.onboardingPopupSeen || false,
                joinerTypeSelected:  updatedStudent.joinerTypeSelected  || false,
                joinerType:          updatedStudent.joinerType           || null,
                calculatedAttendance: updatedStudent.calculatedAttendance,
                attendancePercentage: updatedStudent.attendancePercentage,
                presentCount,
                totalTenureDays,
                daysNeededToAttendMore
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Onboarding calculation failed" });
    }
});

// ────────────────────────────────────────────────
// FEATURE 7 — POST /api/v2/student/report-broken-video
// Auto-replaces broken YouTube video with fallback
// ────────────────────────────────────────────────
router.post("/student/report-broken-video", requireStudent, async (req, res) => {
    try {
        const { taskId, domain, weekNumber, taskTitle } = req.body;
        if (!taskId) return res.status(400).json({ success: false, message: "taskId required" });

        const week = parseInt(weekNumber) || 1;
        const domainFallbacks = FALLBACK_VIDEOS[domain] || {};
        const fallbackUrl = domainFallbacks[week];

        if (fallbackUrl) {
            await DomainTask.updateOne(
                { _id: taskId },
                { $set: { videoUrl: fallbackUrl, fallbackVideoUrl: fallbackUrl } }
            );
            return res.json({ success: true, newVideoUrl: fallbackUrl, replaced: true });
        }

        // No fallback in map — return YouTube search link
        const searchQuery = encodeURIComponent(`${domain || ""} ${taskTitle || "tutorial"} tutorial`);
        const searchUrl = `https://www.youtube.com/results?search_query=${searchQuery}`;
        return res.json({ success: true, searchUrl, replaced: false });
    } catch (err) {
        console.error("[V2] report-broken-video error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// FEATURE 6 — POST /api/v2/student/generate-quiz
// Returns 5 MCQ questions for domain+week (with fallback bank)
// ────────────────────────────────────────────────
const QUIZ_FALLBACK_BANK = {
    "Python Development": {
        1: [
            { question: "Which of the following is the correct way to declare a variable in Python?", options: ["var x = 5", "x = 5", "int x = 5", "declare x = 5"], answer: 1 },
            { question: "What is the output of print(type(3.14))?", options: ["<class 'int'>", "<class 'str'>", "<class 'float'>", "<class 'number'>"], answer: 2 },
            { question: "Which keyword is used to define a function in Python?", options: ["function", "define", "def", "func"], answer: 2 },
            { question: "What does len('hello') return?", options: ["4", "5", "6", "hello"], answer: 1 },
            { question: "Which of these is a valid Python comment?", options: ["// comment", "/* comment */", "# comment", "-- comment"], answer: 2 }
        ],
        2: [
            { question: "Which data structure in Python is immutable?", options: ["List", "Dictionary", "Set", "Tuple"], answer: 3 },
            { question: "What does the range(1, 5) produce?", options: ["1,2,3,4,5", "1,2,3,4", "0,1,2,3,4", "1,2,3,4,5,6"], answer: 1 },
            { question: "How do you open a file in Python?", options: ["openfile('x')", "file.open('x')", "open('x', 'r')", "read('x')"], answer: 2 },
            { question: "What is a lambda function in Python?", options: ["A loop", "An anonymous function", "A class method", "A module"], answer: 1 },
            { question: "Which method adds an element to a list?", options: ["add()", "insert()", "append()", "push()"], answer: 2 }
        ],
        3: [
            { question: "What does OOP stand for?", options: ["Object Oriented Programming", "Open Output Process", "Ordered Object Protocol", "Online Object Platform"], answer: 0 },
            { question: "Which keyword creates a class in Python?", options: ["object", "class", "struct", "define"], answer: 1 },
            { question: "What is inheritance in Python?", options: ["Copying a file", "One class using methods of another", "Deleting an object", "Creating a loop"], answer: 1 },
            { question: "What does __init__ do?", options: ["Deletes an object", "Initialises an object", "Returns a value", "Imports a module"], answer: 1 },
            { question: "Which Python library is used for data manipulation?", options: ["NumPy", "Pandas", "Matplotlib", "Flask"], answer: 1 }
        ]
    },
    "Web Development": {
        1: [
            { question: "What does HTML stand for?", options: ["HyperText Markup Language", "HighTech Markup Language", "HyperText Machine Language", "HyperText Making Language"], answer: 0 },
            { question: "Which tag creates a hyperlink?", options: ["<link>", "<a>", "<href>", "<url>"], answer: 1 },
            { question: "What does CSS stand for?", options: ["Computer Style Sheets", "Creative Style Sheets", "Cascading Style Sheets", "Colorful Style Sheets"], answer: 2 },
            { question: "Which property changes text color in CSS?", options: ["font-color", "text-color", "color", "foreground"], answer: 2 },
            { question: "What is the correct HTML element for the largest heading?", options: ["<h6>", "<head>", "<heading>", "<h1>"], answer: 3 }
        ],
        2: [
            { question: "Which JavaScript function is used to print to console?", options: ["print()", "console.log()", "log()", "output()"], answer: 1 },
            { question: "What does DOM stand for?", options: ["Document Object Model", "Data Object Model", "Document Oriented Model", "Dynamic Object Model"], answer: 0 },
            { question: "Which CSS property controls the layout type?", options: ["layout", "display", "position", "float"], answer: 1 },
            { question: "What does === mean in JavaScript?", options: ["Assignment", "Equality (loose)", "Equality (strict)", "Not equal"], answer: 2 },
            { question: "Which HTML tag embeds JavaScript?", options: ["<js>", "<script>", "<javascript>", "<code>"], answer: 1 }
        ],
        3: [
            { question: "What is a REST API?", options: ["A database", "An architectural style for APIs", "A programming language", "A web browser"], answer: 1 },
            { question: "What does async/await do in JavaScript?", options: ["Creates loops", "Handles asynchronous operations", "Deletes variables", "Imports modules"], answer: 1 },
            { question: "Which method sends data to a server in fetch?", options: ["GET only", "POST", "SEND", "TRANSFER"], answer: 1 },
            { question: "What is Flexbox used for?", options: ["Database queries", "Animations", "Layout alignment", "Server requests"], answer: 2 },
            { question: "Which framework is built on top of React?", options: ["Angular", "Vue", "Next.js", "Ember"], answer: 2 }
        ]
    },
    "MERN Stack Development": {
        1: [
            { question: "What does MERN stand for?", options: ["MongoDB, Express, React, Node", "MySQL, Express, React, Node", "MongoDB, Electron, React, Node", "MongoDB, Express, Ruby, Node"], answer: 0 },
            { question: "Which language does Node.js use?", options: ["Python", "Java", "JavaScript", "C#"], answer: 2 },
            { question: "What is npm?", options: ["Node Package Manager", "New Programming Method", "Node Project Manager", "Network Protocol Module"], answer: 0 },
            { question: "What is MongoDB?", options: ["A SQL database", "A NoSQL document database", "A cloud service", "A programming language"], answer: 1 },
            { question: "What does Express.js provide?", options: ["A database", "A UI framework", "A web application framework for Node", "A testing tool"], answer: 2 }
        ],
        2: [
            { question: "Which React hook manages state?", options: ["useEffect", "useContext", "useState", "useRef"], answer: 2 },
            { question: "What is JSX?", options: ["A database query language", "JavaScript XML syntax for React", "A CSS framework", "A Node module"], answer: 1 },
            { question: "What does useEffect do in React?", options: ["Manages state", "Creates components", "Handles side effects", "Styles components"], answer: 2 },
            { question: "Which HTTP method retrieves data?", options: ["POST", "PUT", "DELETE", "GET"], answer: 3 },
            { question: "What is a Mongoose schema?", options: ["A CSS layout", "A MongoDB document structure", "A React component", "An Express route"], answer: 1 }
        ],
        3: [
            { question: "What is JWT used for?", options: ["Database queries", "Authentication tokens", "CSS animations", "File uploads"], answer: 1 },
            { question: "Which middleware parses JSON in Express?", options: ["express.json()", "express.parse()", "bodyParser.text()", "express.raw()"], answer: 0 },
            { question: "What is React Context used for?", options: ["Database connections", "Global state management", "HTTP requests", "File handling"], answer: 1 },
            { question: "Which Mongoose method finds all documents?", options: ["findAll()", "getAll()", "find()", "select()"], answer: 2 },
            { question: "What is CORS in web development?", options: ["A database", "Cross-Origin Resource Sharing", "A React hook", "A MongoDB feature"], answer: 1 }
        ]
    },
    "Java Development": {
        1: [
            { question: "Which keyword is used to create a class in Java?", options: ["object", "class", "struct", "type"], answer: 1 },
            { question: "What is JVM?", options: ["Java Visual Machine", "Java Virtual Machine", "Java Variable Method", "Java Version Manager"], answer: 1 },
            { question: "Which data type stores true/false in Java?", options: ["int", "char", "String", "boolean"], answer: 3 },
            { question: "How do you print in Java?", options: ["print()", "console.log()", "System.out.println()", "echo()"], answer: 2 },
            { question: "What does OOP stand for?", options: ["Object Oriented Programming", "Open Output Process", "Online Object Protocol", "Ordered Object Platform"], answer: 0 }
        ],
        2: [
            { question: "What is inheritance in Java?", options: ["Copying a file", "A class using properties of another", "Creating a loop", "Deleting an object"], answer: 1 },
            { question: "Which keyword prevents method overriding?", options: ["static", "private", "final", "abstract"], answer: 2 },
            { question: "What is an interface in Java?", options: ["A class with no methods", "A contract of methods a class must implement", "A database", "A loop structure"], answer: 1 },
            { question: "What does ArrayList store?", options: ["Fixed size arrays", "Dynamic list of objects", "Only integers", "Only strings"], answer: 1 },
            { question: "What is a constructor?", options: ["A method that destroys objects", "A special method to initialise objects", "A loop", "An interface"], answer: 1 }
        ],
        3: [
            { question: "What is a try-catch block used for?", options: ["Loops", "Exception handling", "Creating classes", "Database queries"], answer: 1 },
            { question: "What does the 'static' keyword mean?", options: ["The variable changes", "Belongs to the class, not instances", "Creates a new object", "Is abstract"], answer: 1 },
            { question: "Which collection allows duplicate values?", options: ["Set", "HashSet", "TreeSet", "ArrayList"], answer: 3 },
            { question: "What is polymorphism?", options: ["One interface, many implementations", "Multiple inheritance", "A design pattern", "A database concept"], answer: 0 },
            { question: "What is multithreading in Java?", options: ["Multiple loops", "Running multiple threads simultaneously", "Multiple classes", "Database transactions"], answer: 1 }
        ]
    },
    "DevOps with AWS": {
        1: [
            { question: "What does DevOps stand for?", options: ["Development and Operations", "Device Operations", "Developer Options", "Dynamic Operations"], answer: 0 },
            { question: "What is CI/CD?", options: ["Continuous Integration/Continuous Deployment", "Cloud Infrastructure/Cloud Deployment", "Code Integration/Code Deployment", "Container Integration/Container Delivery"], answer: 0 },
            { question: "What is Docker used for?", options: ["Version control", "Containerization of applications", "Network monitoring", "Database management"], answer: 1 },
            { question: "What is AWS EC2?", options: ["A database service", "A virtual server service", "A storage service", "A DNS service"], answer: 1 },
            { question: "What is Git?", options: ["A programming language", "A version control system", "A cloud service", "A testing tool"], answer: 1 }
        ],
        2: [
            { question: "What is Kubernetes used for?", options: ["Writing code", "Container orchestration", "Database management", "UI design"], answer: 1 },
            { question: "What is an S3 bucket in AWS?", options: ["A server", "Object storage service", "A database", "A networking tool"], answer: 1 },
            { question: "What does IaC stand for?", options: ["Infrastructure as Code", "Integration and Continuity", "Internet as Cloud", "Instance and Container"], answer: 0 },
            { question: "What is Jenkins used for?", options: ["UI development", "CI/CD automation", "Database queries", "Cloud storage"], answer: 1 },
            { question: "What is an AWS Lambda function?", options: ["A serverless compute function", "A database query", "A networking protocol", "A storage bucket"], answer: 0 }
        ],
        3: [
            { question: "What is Terraform used for?", options: ["Testing", "Infrastructure provisioning as code", "UI design", "Database management"], answer: 1 },
            { question: "What is a VPC in AWS?", options: ["Virtual Private Cloud", "Virtual Public Container", "Virtual Processor Core", "Very Private Computer"], answer: 0 },
            { question: "What is the purpose of Ansible?", options: ["UI framework", "Configuration management and automation", "Database admin", "Version control"], answer: 1 },
            { question: "What is blue-green deployment?", options: ["A CSS color scheme", "A deployment strategy with zero downtime", "A Docker feature", "An AWS storage class"], answer: 1 },
            { question: "What does EKS stand for in AWS?", options: ["Elastic Kubernetes Service", "Elastic Key Store", "Elastic Kernel System", "Extended Kubernetes Service"], answer: 0 }
        ]
    },
    "Artificial Intelligence": {
        1: [
            { question: "What is Machine Learning?", options: ["Programming computers explicitly", "Systems that learn from data", "Manual data entry", "A type of database"], answer: 1 },
            { question: "What is a neural network?", options: ["A computer network", "A model inspired by the human brain", "A database", "An internet protocol"], answer: 1 },
            { question: "What does NLP stand for?", options: ["Network Layer Protocol", "Natural Language Processing", "Neural Learning Program", "Node Learning Platform"], answer: 1 },
            { question: "What is supervised learning?", options: ["Learning without labels", "Learning from labelled data", "Learning from rewards", "Unsupervised training"], answer: 1 },
            { question: "What is overfitting in ML?", options: ["Model performs well on test data", "Model memorizes training data, poor on new data", "Model has too few parameters", "Model trains too quickly"], answer: 1 }
        ],
        2: [
            { question: "What is a training dataset used for?", options: ["Testing the model", "Teaching the model", "Deploying the model", "Cleaning data"], answer: 1 },
            { question: "What does CNN stand for?", options: ["Computer Neural Network", "Convolutional Neural Network", "Contextual Network Node", "Central Neural Node"], answer: 1 },
            { question: "What is the purpose of activation functions?", options: ["Load data", "Introduce non-linearity", "Store weights", "Reduce parameters"], answer: 1 },
            { question: "What is gradient descent?", options: ["A data storage method", "An optimization algorithm", "A type of neural network", "A dataset format"], answer: 1 },
            { question: "What is transfer learning?", options: ["Sending files between servers", "Using a pre-trained model for a new task", "Training from scratch", "Copying neural networks"], answer: 1 }
        ],
        3: [
            { question: "What is a transformer model?", options: ["An electrical component", "An attention-based deep learning architecture", "A decision tree", "A clustering algorithm"], answer: 1 },
            { question: "What does GAN stand for?", options: ["Generative Adversarial Network", "General Artificial Node", "Global AI Network", "Generative Analysis Node"], answer: 0 },
            { question: "What is reinforcement learning?", options: ["Learning from labelled data", "Learning through rewards and penalties", "Learning from images", "Supervised classification"], answer: 1 },
            { question: "What is precision in ML classification?", options: ["True positives / total positives predicted", "All correct predictions / total", "True negatives / negatives predicted", "Recall score"], answer: 0 },
            { question: "What is feature engineering?", options: ["Designing hardware features", "Creating input variables for ML models", "Setting model hyperparameters", "Deploying models"], answer: 1 }
        ]
    },
    "Data Science": {
        1: [
            { question: "What is the primary language used in Data Science?", options: ["Java", "C++", "Python", "PHP"], answer: 2 },
            { question: "What does EDA stand for?", options: ["Exploratory Data Analysis", "Extended Data Access", "External Data Algorithm", "Effective Data Aggregation"], answer: 0 },
            { question: "Which Python library is used for data visualisation?", options: ["NumPy", "Pandas", "Matplotlib", "Scikit-learn"], answer: 2 },
            { question: "What is a DataFrame in Pandas?", options: ["A list", "A 2D tabular data structure", "A dictionary", "A database"], answer: 1 },
            { question: "What does mean() calculate?", options: ["Most common value", "Middle value", "Average value", "Maximum value"], answer: 2 }
        ],
        2: [
            { question: "What is a correlation coefficient?", options: ["The sum of values", "A measure of relationship between variables", "The count of values", "A data cleaning step"], answer: 1 },
            { question: "What is missing data imputation?", options: ["Deleting rows", "Filling missing values", "Adding new columns", "Sorting data"], answer: 1 },
            { question: "What is a histogram used for?", options: ["Comparing categories", "Showing distribution of data", "Tracking trends over time", "Showing relationships"], answer: 1 },
            { question: "What is feature scaling?", options: ["Increasing dataset size", "Normalizing feature ranges", "Removing features", "Adding features"], answer: 1 },
            { question: "What does train-test split mean?", options: ["Splitting code files", "Dividing data for training and evaluation", "Creating databases", "Cleaning data"], answer: 1 }
        ],
        3: [
            { question: "What is a decision tree?", options: ["A data structure", "A tree-based ML algorithm for classification/regression", "A database query", "A sorting algorithm"], answer: 1 },
            { question: "What is cross-validation?", options: ["Checking code", "Technique to evaluate model performance on unseen data", "Data cleaning", "Feature selection"], answer: 1 },
            { question: "What is SQL used for in data science?", options: ["Machine learning", "Querying and managing databases", "Data visualisation", "Model deployment"], answer: 1 },
            { question: "What is dimensionality reduction?", options: ["Adding more features", "Reducing number of variables while preserving information", "Increasing dataset size", "Normalizing data"], answer: 1 },
            { question: "What is the purpose of a confusion matrix?", options: ["Data cleaning", "Evaluating classification model performance", "Feature engineering", "Data imputation"], answer: 1 }
        ]
    },
    "Cyber Security": {
        1: [
            { question: "What is a firewall?", options: ["A physical wall", "A network security system", "An operating system", "A programming language"], answer: 1 },
            { question: "What does SSL/TLS provide?", options: ["Faster internet", "Encrypted communication", "Data storage", "User authentication"], answer: 1 },
            { question: "What is phishing?", options: ["A sport", "A social engineering attack to steal credentials", "A firewall rule", "A type of malware"], answer: 1 },
            { question: "What is a VPN used for?", options: ["Speeding up internet", "Secure, encrypted connection over internet", "Virus protection", "Data backup"], answer: 1 },
            { question: "What is SQL Injection?", options: ["A database backup", "An attack that manipulates SQL queries", "A SQL command", "A database type"], answer: 1 }
        ],
        2: [
            { question: "What is penetration testing?", options: ["Speed testing", "Authorised simulated cyberattack to find vulnerabilities", "Network monitoring", "Code review"], answer: 1 },
            { question: "What is a zero-day exploit?", options: ["A bug fixed immediately", "An unknown vulnerability with no patch", "A scheduled attack", "A daily security check"], answer: 1 },
            { question: "What does XSS stand for?", options: ["Extended Security System", "Cross-Site Scripting", "External Security Scanner", "Cross-System Security"], answer: 1 },
            { question: "What is multi-factor authentication?", options: ["Using only a password", "Using multiple verification methods", "Storing passwords", "Bypassing login"], answer: 1 },
            { question: "What is a DDoS attack?", options: ["A malware", "Distributed Denial of Service attack", "A phishing attack", "A SQL attack"], answer: 1 }
        ],
        3: [
            { question: "What is ethical hacking?", options: ["Illegal system access", "Authorised testing of security systems", "Creating malware", "Monitoring networks"], answer: 1 },
            { question: "What is encryption?", options: ["Deleting data", "Converting data to unreadable format", "Backing up data", "Compressing data"], answer: 1 },
            { question: "What is a digital certificate?", options: ["An academic certificate", "A document verifying the identity of a website", "A password", "A security camera"], answer: 1 },
            { question: "What is network forensics?", options: ["Building networks", "Capturing and analysing network traffic for investigation", "Network design", "Speed testing"], answer: 1 },
            { question: "What is a honeypot in cybersecurity?", options: ["A food storage", "A decoy system to attract and detect attackers", "A firewall rule", "An encryption key"], answer: 1 }
        ]
    },
    "Software Engineering": {
        1: [
            { question: "What is SDLC?", options: ["Software Design Language Cycle", "Software Development Life Cycle", "System Development Language Code", "Software Deployment Language Cycle"], answer: 1 },
            { question: "What is Agile methodology?", options: ["A waterfall process", "Iterative, flexible software development", "A programming language", "A testing framework"], answer: 1 },
            { question: "What is version control?", options: ["Database versioning", "Tracking and managing code changes", "User interface updates", "Hardware upgrades"], answer: 1 },
            { question: "What is a software requirement?", options: ["Hardware spec", "Description of what the software must do", "A code library", "A testing checklist"], answer: 1 },
            { question: "What does API stand for?", options: ["Application Programming Interface", "Automated Program Input", "Advanced Programming Integration", "Application Process Interface"], answer: 0 }
        ],
        2: [
            { question: "What is unit testing?", options: ["Testing the whole system", "Testing individual functions or modules", "Performance testing", "Security testing"], answer: 1 },
            { question: "What is refactoring?", options: ["Rewriting from scratch", "Restructuring code without changing behaviour", "Deleting old code", "Adding new features"], answer: 1 },
            { question: "What is a design pattern?", options: ["A UI design", "A reusable solution to common software problems", "A database schema", "A network topology"], answer: 1 },
            { question: "What is continuous integration?", options: ["Merging code changes frequently", "Continuous monitoring", "Continuous testing only", "Continuous deployment only"], answer: 0 },
            { question: "What does MVC stand for?", options: ["Multiple View Controller", "Model View Controller", "Module View Component", "Model Variable Class"], answer: 1 }
        ],
        3: [
            { question: "What is technical debt?", options: ["Money owed for software", "Cost of not fixing suboptimal code now", "Hardware costs", "Team salary"], answer: 1 },
            { question: "What is a microservices architecture?", options: ["One large application", "Small, independently deployable services", "A database type", "A UI pattern"], answer: 1 },
            { question: "What is test-driven development (TDD)?", options: ["Writing tests after code", "Writing tests before code", "Skipping tests", "Automated deployment"], answer: 1 },
            { question: "What is a code review?", options: ["Reviewing requirements", "Examining code for quality and issues", "Customer review", "Performance testing"], answer: 1 },
            { question: "What is scalability?", options: ["Code readability", "System's ability to handle growing load", "Database size", "Team size"], answer: 1 }
        ]
    },
    "Flutter Development": {
        1: [
            { question: "What language does Flutter use?", options: ["Java", "Swift", "Dart", "JavaScript"], answer: 2 },
            { question: "What is a Widget in Flutter?", options: ["A database", "The basic building block of Flutter UI", "A server", "A test framework"], answer: 1 },
            { question: "What does StatelessWidget mean?", options: ["Has mutable state", "No mutable state", "Connects to internet", "Has animations"], answer: 1 },
            { question: "What is Flutter used for?", options: ["Backend only", "Cross-platform mobile app development", "Database management", "Web servers only"], answer: 1 },
            { question: "What is pubspec.yaml?", options: ["A Dart file", "Flutter project configuration and dependencies", "A database file", "An asset folder"], answer: 1 }
        ],
        2: [
            { question: "What is setState() used for?", options: ["Fetching data", "Triggering UI rebuild with new state", "Creating widgets", "Routing pages"], answer: 1 },
            { question: "What is a FutureBuilder in Flutter?", options: ["A layout widget", "A widget that builds based on async operations", "A navigation tool", "A state manager"], answer: 1 },
            { question: "Which widget creates a scrollable list?", options: ["Container", "Column", "ListView", "Stack"], answer: 2 },
            { question: "What is Navigator in Flutter?", options: ["A GPS tool", "The routing/navigation system", "A database connector", "A state manager"], answer: 1 },
            { question: "What is Provider used for?", options: ["Network requests", "State management", "Database queries", "Animations"], answer: 1 }
        ],
        3: [
            { question: "What is Bloc pattern in Flutter?", options: ["A UI widget", "Business Logic Component for state management", "A database", "A navigation pattern"], answer: 1 },
            { question: "What does hot reload do in Flutter?", options: ["Restarts the app", "Updates UI without losing state", "Clears the database", "Rebuilds from scratch"], answer: 1 },
            { question: "What is a Stream in Flutter?", options: ["Video streaming", "Async sequence of data", "A list widget", "A navigation tool"], answer: 1 },
            { question: "Which widget is used for HTTP requests in Flutter?", options: ["FutureBuilder with http package", "ListView", "Column", "Stack"], answer: 0 },
            { question: "What is the purpose of keys in Flutter widgets?", options: ["Accessing APIs", "Uniquely identifying widgets and preserving state", "Styling widgets", "Creating animations"], answer: 1 }
        ]
    }
};

// Generic fallback questions for domains not in the bank
function getGenericQuestions(domain, week) {
    return [
        { question: `What is the primary goal of ${domain}?`, options: ["Code writing", "Problem solving through technology", "Database management", "Network design"], answer: 1 },
        { question: `Which skill is most important in ${domain}?`, options: ["Typing speed", "Analytical thinking", "Memorization", "Physical strength"], answer: 1 },
        { question: "What is version control?", options: ["Controlling app versions", "Tracking and managing code changes", "Hardware versioning", "Database backups"], answer: 1 },
        { question: "What does debugging mean?", options: ["Adding features", "Finding and fixing errors in code", "Writing documentation", "Deploying apps"], answer: 1 },
        { question: "What is an algorithm?", options: ["A computer program", "A step-by-step procedure to solve a problem", "A hardware component", "A database"], answer: 1 }
    ];
}

router.post("/student/generate-quiz", requireStudent, async (req, res) => {
    try {
        const { taskId, domain, weekNumber } = req.body;
        const week = parseInt(weekNumber) || 1;

        // Try to get domain-specific questions
        const domainBank = QUIZ_FALLBACK_BANK[domain] || {};
        const weekQuestions = domainBank[week] || domainBank[1] || getGenericQuestions(domain, week);

        // Pick 5 questions
        const questions = weekQuestions.slice(0, 5);

        res.json({
            success: true,
            questions,
            quizSettings: {
                questionCount: 5,
                durationMinutes: 10,
                passScore: 3
            }
        });
    } catch (err) {
        console.error("[V2] generate-quiz error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/student/onboard
// ────────────────────────────────────────────────
router.post("/student/onboard", requireStudent, requireTenurePaid, async (req, res) => {
    try {
        const { durationType } = req.body;
        const student = req.student;

        const requested = normalizeTenure(durationType);
        if (!requested) {
            return res.status(400).json({ success: false, message: "Please choose a valid internship length." });
        }

        // The popup must not be able to change what a student is enrolled on.
        // It previously wrote v2DurationType with no cross-check, so a student
        // on the paid 1-Month track could pick "6months" here and be assigned
        // the full six-month task set. The registered tenure wins.
        const registered = student.tenure ? normalizeTenure(student.tenure) : null;
        if (registered && registered !== requested) {
            return res.status(409).json({
                success: false,
                message: `Your internship is registered as ${getTenureLabel(registered)}. ` +
                         `Ask your coordinator if this is wrong — it cannot be changed here.`,
                registeredTenure: registered
            });
        }

        const durationToStore = registered || requested;

        // Idempotent: onboarding is a one-time event, so a repeated submit must
        // not re-award the bonus or reassign tasks.
        if (student.v2Onboarded) {
            return res.json({
                success: true,
                message: "You have already set up your task journey.",
                alreadyOnboarded: true,
                durationType: student.v2DurationType || durationToStore
            });
        }

        await Student.updateOne(
            { _id: student._id },
            { $set: { v2Onboarded: true, v2DurationType: durationToStore } }
        );
        student.v2Onboarded    = true;
        student.v2DurationType = durationToStore;

        const result = await taskEngine.assignTasksForStudent(student);
        const coinResult = await coinService.awardCoins(student._id, "ONBOARD_BONUS");

        res.json({
            success: true,
            message: "Onboarding complete",
            tasksAssigned: result.total || 0,
            coinsAwarded:  coinResult.awarded,
            totalCoins:    coinResult.totalCoins
        });
    } catch (err) {
        console.error("[V2] onboard error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// GET /api/v2/student/status
// ────────────────────────────────────────────────
/**
 * Onboard a student who already has a tenure but has never pressed the setup
 * button, and report whether this call did it.
 *
 * The setup popup asks for an internship length the student cannot choose:
 * tenure is fixed at registration, the popup disables every other option, and
 * POST /student/onboard rejects anything else with a 409. Its only real effect
 * is writing v2Onboarded, and it wrote that only when the button was pressed —
 * so a student who opened the page and navigated away met the same dialog on
 * every visit, forever.
 *
 * This runs on the SERVER for a reason. The same fix on the page could not
 * reach anyone: public/ was served with maxAge '7d', so browsers held week-old
 * markup and kept rendering the popup no matter what shipped. Deciding it here
 * means even a stale page is told v2Onboarded is true and never opens the
 * dialog — the fix does not depend on a browser fetching new JavaScript.
 *
 * The popup still opens for a student with no tenure on file, which is the case
 * it was actually built for: older records and WhatsApp joiners.
 */
async function ensureOnboarded(student) {
    if (!student || student.v2Onboarded) return false;

    // Resolve the duration exactly the way the rest of the portal does.
    //
    // The first version of this required student.tenure and gave up otherwise,
    // and that is why the popup survived the fix. Some records have no tenure
    // stored at all, and the two helpers disagree about them:
    //
    //   toDurationType(null)  -> "1month"   (a default)
    //   normalizeTenure(null) -> null
    //
    // The page preselects "1 Month" from the first, so the popup looked like it
    // knew the answer, while this function read the second, saw null, and left
    // the dialog up. Every screenshot of the popup that survived is one of
    // these students.
    //
    // resolveStudentDuration is what assigns the tasks and drives the
    // attendance target, so onboarding on the same value cannot introduce a
    // disagreement — it is already the duration this student is being taught
    // and marked on.
    const duration = taskEngine.resolveStudentDuration(student);
    if (!duration) return false;

    // A missing tenure is a data defect, not something to paper over. The
    // record is left untouched so scripts/audit-domain-tenure.js can still find
    // it, and it is logged once, at the moment it matters, with the ID needed
    // to correct it in the admin panel.
    if (!student.tenure) {
        console.warn(
            "[V2] " + student.employeeId + " has no tenure on record; " +
            "onboarding on the resolved default (" + duration + "). " +
            "Set the correct tenure in the admin panel."
        );
    }

    // Claim the transition conditionally. Two page loads racing each other
    // would otherwise both assign tasks and both award the welcome bonus.
    const claim = await Student.updateOne(
        { _id: student._id, v2Onboarded: { $ne: true } },
        { $set: { v2Onboarded: true, v2DurationType: duration } }
    );

    student.v2Onboarded    = true;
    student.v2DurationType = duration;

    // modifiedCount is 0 when another request won the race; it is undefined on
    // the JSON fallback engine, which has no such guarantee to offer.
    if (claim && claim.modifiedCount === 0) return false;

    // Tasks and coins are the reward half. If either fails the student is still
    // onboarded — the popup must not come back — and the failure is logged
    // rather than turned into an error on a page that only asked for status.
    try {
        await taskEngine.assignTasksForStudent(student);
        await coinService.awardCoins(student._id, "ONBOARD_BONUS");
    } catch (err) {
        console.error("[V2] auto-onboard follow-up failed for " + student.employeeId + ":", err.message);
    }
    return true;
}

router.get("/student/status", requireStudent, async (req, res) => {
    const student = req.student;

    // Onboard first, so the task counts below include anything just assigned.
    try {
        await ensureOnboarded(student);
    } catch (err) {
        console.error("[V2] ensureOnboarded failed for " + student.employeeId + ":", err.message);
    }

    // ── The fields the task-journey page cannot work without ────────────────
    //
    // Built from the student document and two pure helpers, so no database
    // call can take them out. They come FIRST because of what happened when
    // they did not:
    //
    // One throw anywhere in this handler produced a 500 whose body carried no
    // v2Onboarded and no durationType. The page read `!status.v2Onboarded` as
    // true and opened the setup dialog; durationType arrived undefined and fell
    // through to the '1month' default, so a 45-day student was shown "1 Month"
    // highlighted; pressing it POSTed 1month and the server answered 409,
    // "Your internship is registered as 45 Days". The popup that would not go
    // away, the wrong preselected tenure and the error on clicking it were all
    // one 500 in this handler.
    const durationType     = taskEngine.resolveStudentDuration(student);
    const registeredTenure = student.tenure ? normalizeTenure(student.tenure) : null;

    const payload = {
        success:             true,
        v2Onboarded:         !!student.v2Onboarded,
        domain:              student.domain,
        durationType,
        registeredTenure,
        onboardingPopupSeen: student.onboardingPopupSeen || false,
        joinerTypeSelected:  student.joinerTypeSelected  || false,
        joinerType:          student.joinerType          || null,
        totalCoins:          0,
        rupeeValue:          "0.00",
        taskStats: { locked: 0, available: 0, in_progress: 0, submitted: 0, approved: 0 }
    };

    // ── Everything else is a bonus ──────────────────────────────────────────
    //
    // The coin balance and the task counts are worth showing but not worth
    // failing over. If they throw, the student sees zeros and their task
    // journey still opens. The previous catch turned any failure into a bare
    // 500 and logged NOTHING, which is why `pm2 logs | grep` produced nothing
    // to explain two days of reports.
    try {
        let domain = student.domain;
        if (domain === "HR") domain = "HR Management";
        if (domain === "Business Development") domain = "Business Analyst";
        if (domain === "Space Intern") domain = "Space Research";
        if (domain === "Artificial Intelligence" || domain === "AI") domain = "Data Science";
        if (domain === "Finance" || domain === "Finance and Accounts" || domain === "Finance & Accounts") domain = "Venture Capital";

        const domainTasks = await DomainTask.find({ domain }).select("_id").lean();
        const taskIds = domainTasks.map(t => t._id);

        const [progressStats, coinData] = await Promise.all([
            StudentTaskProgress.aggregate([
                { $match: { studentId: student._id, taskId: { $in: taskIds } } },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]),
            coinService.getBalance(student._id)
        ]);

        for (const row of progressStats) {
            if (Object.prototype.hasOwnProperty.call(payload.taskStats, row._id)) {
                payload.taskStats[row._id] = row.count;
            }
        }

        if (coinData) {
            payload.totalCoins = coinData.totalCoins || 0;
            payload.rupeeValue = coinData.rupeeValue || ((coinData.totalCoins || 0) * 0.5).toFixed(2);
        }
    } catch (err) {
        console.error("[V2] /student/status extras failed for " + student.employeeId + ":", err.message);
        console.error(err.stack);
    }

    res.json(payload);
});

// ────────────────────────────────────────────────
// GET /api/v2/tasks/my-tasks
// ────────────────────────────────────────────────
router.get("/tasks/my-tasks", requireStudent, requireTenurePaid, async (req, res) => {
    try {
        const student = req.student;

        // Also here, not only in /student/status: a student who reaches the task
        // list by any other route — a bookmark, a link from the dashboard —
        // gets onboarded the same way rather than landing on an empty list.
        try {
            await ensureOnboarded(student);
        } catch (err) {
            console.error("[V2] ensureOnboarded failed:", err.message);
        }

        let domain = student.domain;
        if (domain === "HR") domain = "HR Management";
        if (domain === "Business Development") domain = "Business Analyst";
        if (domain === "Space Intern") domain = "Space Research";
        if (domain === "Artificial Intelligence" || domain === "AI") domain = "Data Science";
        if (domain === "Finance" || domain === "Finance and Accounts" || domain === "Finance & Accounts") domain = "Venture Capital";

        const domainTasks = await DomainTask.find({ domain }).select("_id").lean();
        const taskIds = domainTasks.map(t => t._id);
        const progressCount = await StudentTaskProgress.countDocuments({ studentId: student._id, taskId: { $in: taskIds } });

        // Only auto-assign for a student who has actually completed onboarding.
        // This used to run unconditionally, which — combined with v2Onboarded
        // being inferred from the existence of progress rows — meant merely
        // opening the task list marked a student as onboarded and the tenure
        // popup never appeared for them again.
        if (progressCount === 0 && student.v2Onboarded) {
            await taskEngine.assignTasksForStudent(student);
        } else {
            // Self-healing: Force Week 1 tasks to be available if they are currently locked
            try {
                const week1Tasks = await DomainTask.find({ domain, weekNumber: 1 }).select("_id").lean();
                const week1Ids = week1Tasks.map(t => t._id);
                if (week1Ids.length > 0) {
                    await StudentTaskProgress.updateMany(
                        { studentId: student._id, taskId: { $in: week1Ids }, status: "locked" },
                        { $set: { status: "available" } }
                    );
                }
            } catch (healErr) {
                console.error("V2 self-healing error:", healErr.message);
            }
        }

        const data = await taskEngine.getStudentTasks(student);
        const { totalCoins, rupeeValue } = await coinService.getBalance(student._id);

        res.json({ success: true, ...data, totalCoins, rupeeValue });
    } catch (err) {
        console.error("[V2] my-tasks error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/tasks/:taskId/start
// ────────────────────────────────────────────────
router.post("/tasks/:taskId/start", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const taskId  = req.params.taskId;

        const progress = await StudentTaskProgress.findOne({ studentId: student._id, taskId });
        if (!progress) return res.status(404).json({ success: false, message: "Task not assigned" });
        if (!["available"].includes(progress.status)) {
            return res.json({ success: true, status: progress.status });
        }

        progress.status    = "in_progress";
        progress.startedAt = new Date();
        await progress.save();

        res.json({ success: true, status: "in_progress" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/tasks/:taskId/submit
// ────────────────────────────────────────────────
router.post("/tasks/:taskId/submit", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const taskId  = req.params.taskId;
        const { submissionUrl, submissionNotes } = req.body;

        if (!submissionUrl && !submissionNotes) {
            return res.status(400).json({ success: false, message: "Submission URL or notes required" });
        }

        const progress = await StudentTaskProgress.findOne({ studentId: student._id, taskId });
        if (!progress) return res.status(404).json({ success: false, message: "Task not assigned to you" });
        if (!["available", "in_progress", "rejected"].includes(progress.status)) {
            return res.status(400).json({ success: false, message: `Cannot submit: task is ${progress.status}` });
        }

        progress.status          = "submitted";
        progress.submissionUrl   = submissionUrl  || progress.submissionUrl;
        progress.submissionNotes = submissionNotes || progress.submissionNotes;
        progress.submittedAt     = new Date();
        if (!progress.startedAt) progress.startedAt = new Date();
        await progress.save();

        try {
            const Submission = require("../../models/Submission");
            const DomainTask = require("../../models/new/DomainTask");
            const taskDoc = await DomainTask.findById(taskId);
            
            if (taskDoc) {
                let legSub = await Submission.findOne({
                    employeeId: student.employeeId,
                    task: taskDoc.taskTitle
                });
                
                if (legSub) {
                    legSub.githubLink = submissionUrl || "";
                    legSub.note = submissionNotes || "";
                    legSub.status = "Pending";
                    legSub.reviewedOnce = false;
                    legSub.submittedAt = new Date();
                    await legSub.save();
                } else {
                    await Submission.create({
                        employeeId: student.employeeId,
                        domain: student.domain,
                        task: taskDoc.taskTitle,
                        githubLink: submissionUrl || "",
                        note: submissionNotes || "",
                        status: "Pending",
                        submittedAt: new Date()
                    });
                }
            }
        } catch (subErr) {
            console.error("V2 Sync Submission Create error:", subErr.message);
        }

        await notifyCoordinatorOfSubmission(student, taskId);

        res.json({ success: true, message: "Task submitted successfully", status: "submitted" });
    } catch (err) {
        console.error("[V2] submit error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// PATCH /api/v2/tasks/:taskId/video-progress
// ────────────────────────────────────────────────
router.patch("/tasks/:taskId/video-progress", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const taskId  = req.params.taskId;
        const percent = Math.min(100, Math.max(0, parseInt(req.body.percent) || 0));

        const progress = await StudentTaskProgress.findOne({ studentId: student._id, taskId });
        if (!progress) return res.status(404).json({ success: false, message: "Task not assigned" });

        const wasWatched = progress.videoWatchedPercent >= 80;
        progress.videoWatchedPercent = Math.max(progress.videoWatchedPercent, percent);

        let coinsAwarded = 0;
        if (!wasWatched && progress.videoWatchedPercent >= 80) {
            const result = await coinService.awardCoins(student._id, "VIDEO_WATCHED");
            coinsAwarded = result.awarded;
        }

        await progress.save();
        res.json({ success: true, videoWatchedPercent: progress.videoWatchedPercent, coinsAwarded });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/tasks/:progressId/approve  (coordinator)
// ────────────────────────────────────────────────
router.post("/tasks/:progressId/approve", requireStaff, validate(mongoIdParamSchema), async (req, res) => {
    try {

        const { feedback, studentEmployeeId } = req.body;
        if (!studentEmployeeId) return res.status(400).json({ success: false, message: "studentEmployeeId required" });

        const student = await Student.findOne({ employeeId: studentEmployeeId });
        if (!student) return res.status(404).json({ success: false, message: "Student not found" });

        const progressDoc = await StudentTaskProgress.findById(req.params.progressId).lean();

        const result = await taskEngine.approveTask(student, req.params.progressId, null, feedback);
        if (result.error) return res.status(400).json({ success: false, message: result.error });

        await notifyTaskDecision(student, progressDoc && progressDoc.taskId, "approved", feedback, result.coinsAwarded);

        res.json({ success: true, ...result });
    } catch (err) {
        console.error("[V2] approve error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/tasks/:progressId/reject  (coordinator)
// ────────────────────────────────────────────────
router.post("/tasks/:progressId/reject", requireStaff, validate(mongoIdParamSchema), async (req, res) => {
    try {

        const { feedback, studentEmployeeId } = req.body;
        if (!studentEmployeeId) return res.status(400).json({ success: false, message: "studentEmployeeId required" });

        const student = await Student.findOne({ employeeId: studentEmployeeId });
        if (!student) return res.status(404).json({ success: false, message: "Student not found" });

        const progress = await StudentTaskProgress.findById(req.params.progressId);
        if (!progress) return res.status(404).json({ success: false, message: "Progress not found" });
        if (progress.studentId.toString() !== student._id.toString()) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        progress.status              = "rejected";
        progress.coordinatorFeedback = feedback || "";
        await progress.save();

        await notifyTaskDecision(student, progress.taskId, "rejected", feedback, 0);

        res.json({ success: true, message: "Task rejected" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// GET /api/v2/coordinator/submissions
// ────────────────────────────────────────────────
router.get("/coordinator/submissions", requireStaff, async (req, res) => {
    try {
        let domain = req.query.domain;
        if (!domain) return res.status(400).json({ success: false, message: "domain query param required" });
        if (domain === "Artificial Intelligence" || domain === "AI") domain = "Data Science";
        if (domain === "Finance" || domain === "Finance and Accounts" || domain === "Finance & Accounts") domain = "Venture Capital";

        const tasks = await DomainTask.find({ domain }).lean();
        const taskIds = tasks.map(t => t._id);
        const taskMap = {};
        for (const t of tasks) taskMap[t._id.toString()] = t;

        const submissions = await StudentTaskProgress.find({
            taskId: { $in: taskIds },
            status: "submitted"
        }).populate("studentId", "firstName lastName employeeId email domain").lean();

        const result = submissions.map(s => ({
            progressId:      s._id,
            studentName:     s.studentId ? `${s.studentId.firstName} ${s.studentId.lastName}`.trim() : "Unknown",
            employeeId:      s.studentId ? s.studentId.employeeId : "",
            studentEmail:    s.studentId ? s.studentId.email : "",
            taskTitle:       taskMap[s.taskId.toString()]?.taskTitle || "Unknown Task",
            weekNumber:      taskMap[s.taskId.toString()]?.weekNumber || 0,
            coinReward:      taskMap[s.taskId.toString()]?.coinReward || 0,
            submissionUrl:   s.submissionUrl,
            submissionNotes: s.submissionNotes,
            submittedAt:     s.submittedAt
        }));

        res.json({ success: true, submissions: result });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// GET /api/v2/coins/balance
// ────────────────────────────────────────────────
router.get("/coins/balance", requireStudent, async (req, res) => {
    try {
        const data = await coinService.getBalance(req.student._id);
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// GET /api/v2/coins/history
// ────────────────────────────────────────────────
router.get("/coins/history", requireStudent, async (req, res) => {
    try {
        const data = await coinService.getBalance(req.student._id);
        res.json({ success: true, history: data.coinsHistory, totalCoins: data.totalCoins, rupeeValue: data.rupeeValue });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// GET /api/v2/leaderboard
// ────────────────────────────────────────────────
router.get("/leaderboard", requireStudent, async (req, res) => {
    try {
        const top = await require("../../models/new/StudentCoin").find()
            .sort({ totalCoins: -1 })
            .limit(20)
            .populate("studentId", "firstName lastName domain")
            .lean();

        const board = top.map((entry, i) => ({
            rank:       i + 1,
            name:       entry.studentId ? `${entry.studentId.firstName} ${entry.studentId.lastName}`.trim() : "Anonymous",
            domain:     entry.studentId?.domain || "",
            totalCoins: entry.totalCoins,
            rupeeValue: (entry.totalCoins * 0.5).toFixed(2)
        }));

        res.json({ success: true, leaderboard: board });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/student/quiz-result
// Called from quiz-portal.html after submission
// ────────────────────────────────────────────────
router.post("/student/quiz-result", requireStudent, async (req, res) => {
    try {
        const { taskId, score, total, passed, coins, violations, autoSubmit } = req.body;
        const student = req.student;

        // Award coins if passed
        let awarded = 0;
        if (passed && coins > 0) {
            const result = await coinService.awardCoins(
                student._id,
                coins === 50 ? "QUIZ_PASSED_FIRST" : "QUIZ_PASSED_RETRY"
            );
            awarded = result.awarded;
        }

        // Mark task as approved if passed and taskId provided
        if (passed && taskId) {
            try {
                await StudentTaskProgress.updateOne(
                    { studentId: student._id, taskId },
                    { $set: { status: "approved", quizPassed: true, approvedAt: new Date(), coinsAwarded: coins || 0 } }
                );
            } catch(e) { /* silent */ }
        }

        const { totalCoins, rupeeValue } = await coinService.getBalance(student._id);
        res.json({ success: true, awarded, totalCoins, rupeeValue });
    } catch (err) {
        console.error("[V2] quiz-result error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/automated-tasks/generate
// ────────────────────────────────────────────────
router.post("/automated-tasks/generate", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const { GoogleGenAI, Type } = require("@google/genai");

        const Submission = require("../../models/Submission");
        const domain = student.domain || "Web Development";
        const durationMap = { "1 Month": "1month", "3 Months": "3months", "6 Months": "6months" };
        const durationType = durationMap[student.tenure] || student.v2DurationType || "3months";

        // Count approved tasks from V2 and legacy system
        const v2Approved = await StudentTaskProgress.countDocuments({ studentId: student._id, status: "approved" });
        const legacyApproved = await Submission.countDocuments({ employeeId: student.employeeId, status: "Approved" });
        const approvedCount = v2Approved + legacyApproved;

        let difficultyLevel = req.body.difficultyLevel;
        if (!difficultyLevel) {
            difficultyLevel = approvedCount >= 15 ? "expert" : approvedCount >= 9 ? "hard" : approvedCount >= 4 ? "medium" : "easy";
        }

        // Fetch recent task titles for this student to avoid duplicates
        const recentProgress = await StudentTaskProgress.find({ studentId: student._id })
            .sort({ updatedAt: -1 })
            .limit(5)
            .populate('taskId', 'taskTitle');
        const recentTitles = recentProgress.map(p => p.taskId?.taskTitle).filter(Boolean);

        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });

        const prompt = `Generate a highly professional, domain-specific, resume-building internship task.
Domain: ${domain}
Skill level: ${difficultyLevel} (easy, medium, hard, expert).

You MUST return a JSON object following the format below. Create a realistic, challenging, and detailed real-world scenario.`;

        let generated;
        try {
            const geminiRes = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            deliverables: { type: Type.STRING },
                            complexity: { type: Type.STRING },
                            learningVideos: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING },
                                        description: { type: Type.STRING },
                                        url: { type: Type.STRING }
                                    },
                                    required: ["title", "description", "url"]
                                },
                                required: ["title", "description", "url"]
                            }
                        },
                        required: ["title", "description", "deliverables", "complexity", "learningVideos"]
                    }
                }
            });
            generated = JSON.parse(geminiRes.text);
        } catch(e) {
            console.warn("[V2] Gemini task generation failed or quota exceeded, using rotating fallback pool:", e.message);
            const fbTask = getFallbackTask(domain, difficultyLevel, recentTitles);
            generated = {
                title: fbTask.title,
                description: fbTask.description,
                deliverables: fbTask.deliverables || "1. Working repository link.\n2. Architecture & design notes.",
                complexity: difficultyLevel,
                learningVideos: [
                    { title: "Industrial Software Layouts", description: "Design principles of production systems.", url: "https://www.youtube.com/watch?v=mU6anWqZJcc" },
                    { title: "System Execution & Scaling", description: "Techniques for managing enterprise data loads safely.", url: "https://www.youtube.com/watch?v=G3e-cpL7ofc" },
                    { title: "Defensive Coding and Coverage", description: "Formulating proper unit regression plans.", url: "https://www.youtube.com/watch?v=Oe421EPjeBE" }
                ]
            };
        }

        const maxTask = await DomainTask.findOne({ domain, durationType }).sort({ weekNumber: -1 });
        const nextWeek = maxTask ? maxTask.weekNumber + 1 : 1;

        const newTask = new DomainTask({
            domain,
            durationType,
            weekNumber: nextWeek,
            taskTitle: generated.title,
            taskDescription: `${generated.description}\n\nDeliverables:\n${generated.deliverables}`,
            videoUrl: generated.learningVideos?.[0]?.url || "https://www.youtube.com/watch?v=mU6anWqZJcc",
            fallbackVideoUrl: generated.learningVideos?.[1]?.url || "https://www.youtube.com/watch?v=G3e-cpL7ofc",
            coinReward: 20,
            difficultyLevel: generated.complexity || difficultyLevel
        });

        newTask.set("learningVideos", generated.learningVideos || [], { strict: false });
        await newTask.save();

        const newProgress = new StudentTaskProgress({
            studentId: student._id,
            taskId: newTask._id,
            status: "available",
            videoWatchedPercent: 0
        });
        await newProgress.save();

        try {
            const Notification = require("../../models/Notification");
            await Notification.notifyStudent(student, {
                title: "New Automated Task Assigned",
                message: `An automated ${difficultyLevel} task: "${generated.title}" has been added to your curriculum space!`,
                type: "success"
            });
        } catch(e) { /* silent */ }

        res.json({
            success: true,
            taskId: newTask._id,
            task: {
                title: newTask.taskTitle,
                description: newTask.taskDescription,
                weekNumber: newTask.weekNumber,
                difficultyLevel: newTask.difficultyLevel,
                learningVideos: generated.learningVideos || []
            }
        });

    } catch(err) {
        console.error("[V2] automated-tasks generator error:", err.message);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/coding-challenges/generate
// ────────────────────────────────────────────────
router.post("/coding-challenges/generate", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const { GoogleGenAI, Type } = require("@google/genai");

        const domain = student.domain || "Web Development";
        const approvedCount = await StudentTaskProgress.countDocuments({ studentId: student._id, status: "approved" });
        const level = approvedCount >= 5 ? "Hard" : approvedCount >= 2 ? "Medium" : "Easy";

        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });

        const prompt = `Generate a modern algorithmic programming problem targeting ${domain} concepts.
Difficulty: ${level} (choose from Easy, Medium, Hard).
Output strict schema JSON format with input/output cases.`;

        let generated;
        try {
            const geminiRes = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            problemStatement: { type: Type.STRING },
                            inputFormat: { type: Type.STRING },
                            outputFormat: { type: Type.STRING },
                            sampleInput: { type: Type.STRING },
                            sampleOutput: { type: Type.STRING },
                            testCases: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        input: { type: Type.STRING },
                                        output: { type: Type.STRING }
                                    },
                                    required: ["input", "output"]
                                }
                            }
                        },
                        required: ["title", "problemStatement", "inputFormat", "outputFormat", "sampleInput", "sampleOutput", "testCases"]
                    }
                }
            });
            generated = JSON.parse(geminiRes.text);
        } catch(e) {
            console.warn("[V2] Gemini coding challange generation failed or quota exceeded, using fallback:", e.message);
            generated = {
                title: `Resource Tuning Optimization in ${domain}`,
                problemStatement: `Develop a runtime solver to eliminate redundant payload latency overhead in ${domain}. All logic must adhere to clean modular execution patterns.`,
                inputFormat: "An array of integers specifying query durations.",
                outputFormat: "Minimum aggregate resource delay value.",
                sampleInput: "4 8 1 2",
                sampleOutput: "15",
                testCases: [
                    { input: "4 8 1 2", output: "15" },
                    { input: "1 2 3", output: "6" }
                ]
            };
        }

        const CodingQuestion = mongoose.model("CodingQuestion");
        const parsedCases = (generated.testCases || []).map(tc => ({
            input: tc.input || "",
            expectedOutput: tc.output || "",
            isHidden: false
        }));

        const newQuestion = new CodingQuestion({
            domain,
            title: generated.title,
            description: `${generated.problemStatement}\n\nInput Format:\n${generated.inputFormat}\n\nOutput Format:\n${generated.outputFormat}`,
            inputFormat: generated.inputFormat,
            outputFormat: generated.outputFormat,
            sampleInput: generated.sampleInput,
            sampleOutput: generated.sampleOutput,
            difficulty: level,
            testCases: parsedCases
        });
        await newQuestion.save();

        try {
            const Notification = require("../../models/Notification");
            await Notification.notifyStudent(student, {
                title: "New Automated Coding Challenge",
                message: `The dynamic custom coding exercise: "${newQuestion.title}" is ready on your dashboard!`,
                type: "info"
            });
        } catch(e) { /* silent */ }

        res.json({
            success: true,
            challengeId: newQuestion._id,
            challenge: {
                title: newQuestion.title,
                problemStatement: generated.problemStatement,
                inputFormat: newQuestion.inputFormat,
                outputFormat: newQuestion.outputFormat,
                sampleInput: newQuestion.sampleInput,
                sampleOutput: newQuestion.sampleOutput,
                difficulty: newQuestion.difficulty,
                testCasesCount: parsedCases.length
            }
        });

    } catch(err) {
        console.error("[V2] coding-challenges dynamic generation error:", err.message);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/quizzes/generate
// ────────────────────────────────────────────────
router.post("/quizzes/generate", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const { taskId } = req.body;
        const { GoogleGenAI, Type } = require("@google/genai");

        let targetTaskId = taskId;
        if (!targetTaskId) {
            const activeProgress = await StudentTaskProgress.findOne({ studentId: student._id, status: { $in: ["available", "in_progress"] } });
            if (activeProgress) targetTaskId = activeProgress.taskId;
        }

        if (!targetTaskId) {
            return res.status(400).json({ success: false, message: "No active task found to generate quiz questions for." });
        }

        const task = await DomainTask.findById(targetTaskId);
        if (!task) return res.status(404).json({ success: false, message: "Reference task not found." });

        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });

        const prompt = `Generate exactly 5 highly technical, distinct multiple-choice questions matching domain: ${task.domain} and topic: ${task.taskTitle || ""}.
For each question, formulate very clear conceptual options, specify the single correct choice (A, B, C, or D), and write a robust, diagnostic explanation explaining why the correct and incorrect answers behave the way they do (to serve as diagnostic learning feedback for students).`;

        let generatedQuestions;
        try {
            const geminiRes = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                question: { type: Type.STRING },
                                options: {
                                    type: Type.OBJECT,
                                    properties: {
                                        A: { type: Type.STRING },
                                        B: { type: Type.STRING },
                                        C: { type: Type.STRING },
                                        D: { type: Type.STRING }
                                    },
                                    required: ["A", "B", "C", "D"]
                                },
                                correct: { type: Type.STRING, description: "A, B, C, or D" },
                                explanation: { type: Type.STRING, description: "In-depth explanation with diagnostic details" }
                            },
                            required: ["question", "options", "correct", "explanation"]
                        }
                    }
                }
            });
            generatedQuestions = JSON.parse(geminiRes.text);
        } catch(e) {
            console.warn("[V2] Gemini quiz generation failed or quota exceeded, using high quality local fallback:", e.message);
            generatedQuestions = [
                {
                    question: `Which pattern is ideal for managing asynchronous state changes in highly concurrent ${task.domain} components?`,
                    options: {
                        A: "Synchronous blocking wrappers",
                        B: "Stateless queue pipelines (Idempotent worker style)",
                        C: "Poll loops with fixed sleep intervals",
                        D: "Global absolute registers with strict mutex"
                    },
                    correct: "B",
                    explanation: "B is correct because stateless pipelines allow massive scaling without concurrent locking deadlocks or memory leak overhead."
                },
                {
                    question: `What is the primary benefit of deploying modularized microservice patterns in ${task.domain} environments?`,
                    options: {
                        A: "Guaranteed absolute execution lockouts",
                        B: "Strict linear call constraints",
                        C: "Independent horizontal scaling capabilities",
                        D: "Complete elimination of interface structures"
                    },
                    correct: "C",
                    explanation: "C is correct as microservices decoupled along domain boundaries allow targeted scaling of heavily loaded segments without scaling the entire architecture."
                },
                {
                    question: `How does a custom throttle debouncer secure resource interfaces on high-frequency visual user events?`,
                    options: {
                        A: "By multiplying state transitions exponentially",
                        B: "By pooling API invocations into a delayed single execution trigger",
                        C: "By converting visual UI components into static images",
                        D: "By disabling user interactions completely"
                    },
                    correct: "B",
                    explanation: "B is correct. Debouncing groups rapid sequential calls into one delayed invocation to reduce redundant payload performance bottlenecks."
                },
                {
                    question: `Which mechanism handles thread/process safety best in non-blocking asynchronous runtimes?`,
                    options: {
                        A: "Single-threaded event loops with event queue architectures",
                        B: "Continuous busy-wait spinlocks",
                        C: "Direct hardware level interrupts on client machines",
                        D: "Manual register swapping on runtime engines"
                    },
                    correct: "A",
                    explanation: "A is correct. An event-loop style processes visual and network callbacks sequentially, preventing concurrent write clashes on the single main execution thread."
                },
                {
                    question: `In production application architecture, what is the core purpose of a circuit breaker pattern?`,
                    options: {
                        A: "To increase structural hardware electric impedance",
                        B: "To prevent a single trailing downstream API failure from cascading across system layers",
                        C: "To format diagnostic logs to visual panels",
                        D: "To lock user accounts upon incorrect credential checks"
                    },
                    correct: "B",
                    explanation: "B is correct. Short-circuiting dead services shields upstream system threads from indefinitely blocking on non-responsive external dependencies."
                }
            ];
        }

        const QuizQuestion = require("../../models/new/QuizQuestion");
        const inserted = [];
        for (const item of generatedQuestions) {
            const newQ = new QuizQuestion({
                task_id: task._id,
                domain: task.domain,
                week_number: task.weekNumber,
                duration_type: task.durationType,
                question_text: item.question,
                options: {
                    A: item.options.A,
                    B: item.options.B,
                    C: item.options.C,
                    D: item.options.D
                },
                correct_answer: item.correct,
                explanation: item.explanation,
                difficulty: "hard"
            });
            await newQ.save();
            inserted.push(newQ);
        }

        res.json({
            success: true,
            taskId: task._id,
            generatedCount: inserted.length,
            questions: inserted.map(q => ({
                question_text: q.question_text,
                options: q.options,
                difficulty: q.difficulty
            }))
        });

    } catch(err) {
        console.error("[V2] quizzes generator error:", err.message);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ────────────────────────────────────────────────
// POST /api/v2/daily-learning/generate
// ────────────────────────────────────────────────
router.post("/daily-learning/generate", requireStudent, async (req, res) => {
    try {
        const student = req.student;
        const { GoogleGenAI, Type } = require("@google/genai");

        const domain = student.domain || "Web Development";

        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });

        const prompt = `Formulate a short 5-minute micro-learning topic card with real practical guidance and a miniature diagnostic quiz question for the domain: ${domain}.
The response MUST follow the strict JSON format matching the schema rules. Make sure the technical tips are actionable.`;

        let generated;
        try {
            const geminiRes = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            conceptTitle: { type: Type.STRING },
                            quickTipBody: { type: Type.STRING, description: "Highly actionable paragraph with technical implementation snippet or architectural best practice." },
                            quickQuiz: {
                                type: Type.OBJECT,
                                properties: {
                                    question: { type: Type.STRING },
                                    options: {
                                        type: Type.OBJECT,
                                        properties: {
                                            A: { type: Type.STRING },
                                            B: { type: Type.STRING },
                                            C: { type: Type.STRING },
                                            D: { type: Type.STRING }
                                        },
                                        required: ["A", "B", "C", "D"]
                                    },
                                    answer: { type: Type.STRING },
                                    explanation: { type: Type.STRING }
                                },
                                required: ["question", "options", "answer", "explanation"]
                            }
                        },
                        required: ["conceptTitle", "quickTipBody", "quickQuiz"]
                    }
                }
            });
            generated = JSON.parse(geminiRes.text);
        } catch(e) {
            console.warn("[V2] Gemini daily-learning generation failed or quota exceeded, using fallback:", e.message);
            generated = {
                conceptTitle: "Idempotent API Design",
                quickTipBody: "Always implement a unique Client-Request-Id header in state-mutating requests (POST/PUT) to shield backend systems against multi-submit duplication during retry pipelines.",
                quickQuiz: {
                    question: "Which HTTP verb is natively idempotent in the HTTP specification?",
                    options: {
                        A: "POST",
                        B: "PATCH",
                        C: "GET",
                        D: "NONE"
                    },
                    answer: "C",
                    explanation: "GET requests are defined as safe and completely idempotent as they only query backend representation without mutation."
                }
            };
        }

        // Trigger in-app notification with micro-learning info!
        try {
            const Notification = require("../../models/Notification");
            await Notification.notifyStudent(student, {
                title: `Daily Micro-Learning: ${generated.conceptTitle}`,
                message: `Morning boost is live! Tip of the day: ${generated.conceptTitle}. Tap card to expand!`,
                type: "info"
            });
        } catch(e) { /* silent */ }

        res.json({
            success: true,
            conceptTitle: generated.conceptTitle,
            quickTipBody: generated.quickTipBody,
            quickQuiz: generated.quickQuiz
        });

    } catch(err) {
        console.error("[V2] daily-learning generator error:", err.message);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// POST /api/v2/register
router.post("/register", validate(studentRegisterSchema), async (req, res) => {
    res.json({ success: true, message: "Register validation successful" });
});

// POST /api/v2/login
router.post("/login", validate(studentLoginSchema), async (req, res) => {
    res.json({ success: true, message: "Login validation successful" });
});

// PUT /api/v2/profile
router.put("/profile", validate(studentProfileUpdateSchema), async (req, res) => {
    res.json({ success: true, message: "Profile update validation successful" });
});

module.exports = router;
