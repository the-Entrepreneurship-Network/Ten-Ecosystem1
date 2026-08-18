const mongoose = require("mongoose");

const tenureRequestSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    currentTenure: { type: String, required: true },
    requestedTenure: { type: String, required: true },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
    reason: { type: String, default: "" },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    rejectedBy: { type: String, default: null },
    rejectionReason: { type: String, default: "" }
});

module.exports = mongoose.model("TenureRequest", tenureRequestSchema);
