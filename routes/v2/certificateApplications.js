"use strict";

/**
 * Certificate applications: the student side (apply, see status) and the HR
 * side (one queue per certificate type, approve/reject, bulk generate+send).
 *
 * Eligibility is never trusted from the client. The portal asks
 * GET /eligibility only to decide whether to enable a button; the apply route
 * re-evaluates from the database, and the approve route evaluates a third time
 * before a PDF is produced — so a student whose attendance has since dropped
 * cannot be issued a letter that says otherwise.
 */

const express = require("express");
const router  = express.Router();

const Student                = require("../../models/Student");
const CertificateApplication = require("../../models/new/CertificateApplication");
const Notification           = require("../../models/Notification");
const { broadcastNotification } = require("../../utils/sseHub");
const { requireStudent, requireHR } = require("../../middleware/sessionAuth");
const eligibility = require("../../services/certificateEligibility");

const TYPES = ["LOC", "LOR", "STAR"];
const LABELS = {
    LOC:  "Letter of Completion",
    LOR:  "Letter of Recommendation",
    STAR: "Star Performer Certificate"
};

/** Statuses that mean "already in flight" — a student must not apply twice. */
const LIVE = ["pending", "approved", "issued"];

function notifyStudent(student, title, message, type) {
    // Never allowed to fail the action it reports on.
    return (async () => {
        try {
            const notif = new Notification({
                title, message, type: type || "info", from: "HR",
                targetType: "student",
                targetEmployeeId: student.employeeId,
                targetDomain: student.domain
            });
            await notif.save();
            broadcastNotification(student.domain, student.employeeId, notif);
        } catch (err) {
            console.error("[cert-apply] notify failed:", err.message);
        }
    })();
}

// ════════════════════════════════════════════════════════════
// STUDENT
// ════════════════════════════════════════════════════════════

/**
 * GET /api/v2/certificate-applications/eligibility
 * What this student may apply for, why not when they may not, and what they
 * have already applied for.
 */
router.get("/eligibility", requireStudent, async (req, res) => {
    try {
        const result = await eligibility.evaluate(req.student);
        const apps = await CertificateApplication
            .find({ studentId: req.student._id })
            .sort({ appliedAt: -1 })
            .lean();

        const latestByType = {};
        for (const app of apps) {
            if (!latestByType[app.certificateType]) latestByType[app.certificateType] = app;
        }

        const payload = {};
        for (const type of TYPES) {
            const app = latestByType[type];
            payload[type] = {
                label: LABELS[type],
                eligible: result[type].eligible,
                reason: result[type].reason,
                // `applied` drives the button: eligible + not applied → enabled.
                applied: !!(app && LIVE.includes(app.status)),
                applicationStatus: app ? app.status : null,
                appliedAt: app ? app.appliedAt : null,
                reviewNote: app ? app.reviewNote : null
            };
        }

        res.json({ success: true, measured: result.measured, certificates: payload });
    } catch (err) {
        console.error("[cert-apply] eligibility failed:", err.message);
        res.status(500).json({ success: false, message: "Could not check eligibility: " + err.message });
    }
});

/**
 * POST /api/v2/certificate-applications/apply  { certificateType }
 */
router.post("/apply", requireStudent, async (req, res) => {
    try {
        const type = String(req.body && req.body.certificateType || "").toUpperCase();
        if (!TYPES.includes(type)) {
            return res.status(400).json({ success: false, message: `Unknown certificate type: ${type || "(none)"}` });
        }

        const existing = await CertificateApplication.findOne({
            studentId: req.student._id,
            certificateType: type,
            status: { $in: LIVE }
        });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: existing.status === "issued"
                    ? `Your ${LABELS[type]} has already been issued.`
                    : `You have already applied for the ${LABELS[type]}. It is ${existing.status}.`,
                status: existing.status
            });
        }

        // Re-check server-side. The button state is a hint, not a permission.
        const verdict = await eligibility.evaluateOne(req.student, type);
        if (!verdict.eligible) {
            return res.status(403).json({ success: false, message: verdict.reason });
        }

        const measured = (await eligibility.evaluate(req.student)).measured;
        const app = await CertificateApplication.create({
            studentId: req.student._id,
            employeeId: req.student.employeeId,
            studentName: req.student.name || req.student.fullName || "",
            domain: req.student.domain || "",
            certificateType: type,
            status: "pending",
            snapshot: {
                attendancePercentage: measured.attendancePercentage,
                performanceScore: measured.performanceScore,
                internshipCompleted: measured.internshipCompleted,
                taskCompletionPercent: measured.taskCompletionPercent
            }
        });

        // Tell HR's queue there is something new.
        try {
            const notif = new Notification({
                title: `New ${LABELS[type]} application`,
                message: `${app.studentName || app.employeeId} (${app.employeeId}) applied for their ${LABELS[type]}.`,
                type: "info", from: "Student",
                targetType: "domain", targetDomain: app.domain
            });
            await notif.save();
            broadcastNotification(app.domain, null, notif);
        } catch (err) {
            console.error("[cert-apply] HR notify failed:", err.message);
        }

        res.json({ success: true, message: `Applied for your ${LABELS[type]}. HR will review it.`, application: app });
    } catch (err) {
        console.error("[cert-apply] apply failed:", err.message);
        res.status(500).json({ success: false, message: "Could not submit the application: " + err.message });
    }
});

// ════════════════════════════════════════════════════════════
// HR
// ════════════════════════════════════════════════════════════

/**
 * GET /api/v2/certificate-applications/hr/queues
 * One bucket per certificate type, so HR works a single kind at a time and can
 * generate them in bulk — rather than one mixed list of everything.
 */
router.get("/hr/queues", requireHR, async (req, res) => {
    try {
        const status = ["pending", "approved", "rejected", "issued"].includes(req.query.status)
            ? req.query.status : "pending";

        const rows = await CertificateApplication
            .find({ status })
            .sort({ appliedAt: 1 })
            .limit(500)
            .lean();

        const queues = {};
        for (const type of TYPES) {
            queues[type] = { label: LABELS[type], applications: [] };
        }
        for (const row of rows) {
            if (queues[row.certificateType]) queues[row.certificateType].applications.push(row);
        }

        const counts = {};
        for (const type of TYPES) counts[type] = queues[type].applications.length;

        res.json({ success: true, status, counts, total: rows.length, queues });
    } catch (err) {
        console.error("[cert-apply] queues failed:", err.message);
        res.status(500).json({ success: false, message: "Could not load the queues: " + err.message });
    }
});

/**
 * POST /api/v2/certificate-applications/hr/review
 * { applicationIds: [...], action: 'approve'|'reject', note }
 *
 * Approving generates the certificate and emails it. Bulk is the point: HR
 * selects a whole queue and issues it in one action, and each result is
 * reported individually so one failure does not hide the rest.
 */
router.post("/hr/review", requireHR, async (req, res) => {
    try {
        const { applicationIds, action, note } = req.body || {};
        if (!Array.isArray(applicationIds) || !applicationIds.length) {
            return res.status(400).json({ success: false, message: "Select at least one application." });
        }
        if (!["approve", "reject"].includes(action)) {
            return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'." });
        }

        const reviewer = (req.hrUser && (req.hrUser.name || req.hrUser.username)) || "HR";
        // certificates.js exports the router with the helper attached, not a
        // plain object — destructuring it works only because of that.
        const generateAndSaveCert = require("./certificates").generateAndSaveCert;

        const results = [];
        for (const id of applicationIds.slice(0, 200)) {
            try {
                const app = await CertificateApplication.findById(id);
                if (!app) { results.push({ id, ok: false, message: "Application not found" }); continue; }
                if (app.status !== "pending") {
                    results.push({ id, ok: false, employeeId: app.employeeId, message: `Already ${app.status}` });
                    continue;
                }

                const student = await Student.findById(app.studentId);
                if (!student) { results.push({ id, ok: false, message: "Student no longer exists" }); continue; }

                if (action === "reject") {
                    app.status = "rejected";
                    app.reviewedAt = new Date();
                    app.reviewedBy = reviewer;
                    app.reviewNote = note || "";
                    await app.save();
                    await notifyStudent(student,
                        `${LABELS[app.certificateType]} not approved`,
                        `Your ${LABELS[app.certificateType]} application was not approved.${note ? " Reason: " + note : ""}`,
                        "warning");
                    results.push({ id, ok: true, employeeId: app.employeeId, action: "rejected" });
                    continue;
                }

                // Approving: the bar must still be met at issue time, not just
                // at apply time. Attendance can fall between the two.
                const verdict = await eligibility.evaluateOne(student, app.certificateType);
                if (!verdict.eligible) {
                    results.push({ id, ok: false, employeeId: app.employeeId, message: `No longer eligible: ${verdict.reason}` });
                    continue;
                }

                const cert = await generateAndSaveCert(
                    String(app.studentId), app.certificateType, student, reviewer
                );

                app.status = "issued";
                app.reviewedAt = new Date();
                app.reviewedBy = reviewer;
                app.reviewNote = note || "";
                app.issuedAt = new Date();
                if (cert && cert.documentNumber) app.documentNumber = cert.documentNumber;
                await app.save();

                await notifyStudent(student,
                    `${LABELS[app.certificateType]} issued`,
                    `Your ${LABELS[app.certificateType]} has been issued${app.documentNumber ? ` (${app.documentNumber})` : ""} and emailed to you. You can download and verify it under My Documents.`,
                    "success");

                results.push({ id, ok: true, employeeId: app.employeeId, action: "issued", documentNumber: app.documentNumber });
            } catch (err) {
                console.error("[cert-apply] review item failed:", err.message);
                results.push({ id, ok: false, message: err.message });
            }
        }

        const succeeded = results.filter(r => r.ok).length;
        res.json({
            success: true,
            processed: results.length,
            succeeded,
            failed: results.length - succeeded,
            results
        });
    } catch (err) {
        console.error("[cert-apply] review failed:", err.message);
        res.status(500).json({ success: false, message: "Review failed: " + err.message });
    }
});

module.exports = router;
