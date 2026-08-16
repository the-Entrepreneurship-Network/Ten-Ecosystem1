"use strict";

const express            = require("express");
const router             = express.Router();
const Student            = require("../../models/Student");
const CertificateRequest = require("../../models/CertificateRequest");
const { validate, coordinatorApproveCertificatesSchema } = require("../../middleware/validationSchemas");

// ── Coordinator auth middleware ── session-derived.
//
// This previously accepted any Authorization header starting with
// "Bearer coord_" or "Bearer hr_", and failing that accepted an
// `x-coordinator-id` header naming whichever coordinator the caller liked.
// Coordinators approve certificates and mark attendance, so both were a direct
// route to acting as staff. HR may act here too, matching the old behaviour.
const { requireStaff } = require("../../middleware/sessionAuth");

function requireCoordinator(req, res, next) {
    return requireStaff(req, res, () => {
        req.coordinatorUser = req.coordinator || req.hrUser || null;
        next();
    });
}

// POST /api/v2/coordinator/approve-certificates
router.post("/coordinator/approve-certificates", requireCoordinator, validate(coordinatorApproveCertificatesSchema), async (req, res) => {
    try {
        const { studentId, approved, notes } = req.body;
        if (!studentId) return res.status(400).json({ success: false, message: "studentId is required" });

        const certReq = await CertificateRequest.findOne({
            studentId: studentId,
            status:    "awaiting_coordinator"
        });

        if (!certReq) {
            return res.status(404).json({ success: false, message: "No pending certificate request found for this student" });
        }

        if (approved === false) {
            certReq.status              = "failed";
            certReq.coordinatorNotes    = notes || "";
            certReq.coordinatorApproved = false;
            await certReq.save();
            await Student.findByIdAndUpdate(studentId, { certificateStatus: "not_initiated" });
            return res.json({ success: true, message: "Certificate request rejected" });
        }

        certReq.coordinatorApproved   = true;
        certReq.coordinatorApprovedAt = new Date();
        certReq.coordinatorNotes      = notes || "";
        certReq.hrDeadline            = new Date(Date.now() + 24 * 60 * 60 * 1000);
        certReq.status                = "awaiting_hr";
        await certReq.save();

        await Student.findByIdAndUpdate(studentId, { certificateStatus: "awaiting_hr" });

        res.json({
            success: true,
            message: "Certificate request approved and forwarded to HR",
            requestId: certReq._id,
            hrDeadline: certReq.hrDeadline
        });
    } catch (err) {
        console.error("[COORD] approve-certificates error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// GET /api/v2/coordinator/pending-certificates
router.get("/coordinator/pending-certificates", requireCoordinator, async (req, res) => {
    try {
        const pending = await CertificateRequest.find({ status: "awaiting_coordinator" })
            .populate("studentId", "name employeeId domain college collegeName joiningDate tenure")
            .sort({ requestedAt: 1 })
            .lean();

        const result = pending.map(p => ({
            requestId:           p._id,
            student:             p.studentId,
            domain:              p.domain,
            requestedAt:         p.requestedAt,
            coordinatorDeadline: p.coordinatorDeadline,
            daysUntilDeadline:   Math.ceil((new Date(p.coordinatorDeadline) - Date.now()) / (1000 * 60 * 60 * 24))
        }));

        res.json({ success: true, count: result.length, requests: result });
    } catch (err) {
        console.error("[COORD] pending-certificates error:", err.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router;
