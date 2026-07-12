"use strict";

const express            = require("express");
const router             = express.Router();
const Student            = require("../../models/Student");
const CertificateRequest = require("../../models/CertificateRequest");

// ── Coordinator auth middleware ──
async function requireCoordinator(req, res, next) {
    try {
        const auth = req.headers["authorization"] || req.headers["Authorization"] || "";
        if (auth && (auth.startsWith("Bearer coord_") || auth.startsWith("Bearer hr_"))) {
            req.coordinatorUser = { token: auth };
            return next();
        }
        const coordId = req.headers["x-coordinator-id"] || req.body.coordinatorId;
        if (coordId) {
            req.coordinatorUser = { id: coordId };
            return next();
        }
        return res.status(401).json({ success: false, message: "Coordinator authentication required" });
    } catch (_) {
        return res.status(500).json({ success: false, message: "Auth error" });
    }
}

// POST /api/v2/coordinator/approve-certificates
router.post("/coordinator/approve-certificates", requireCoordinator, async (req, res) => {
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
