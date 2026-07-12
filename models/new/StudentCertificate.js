// NEW FEATURE: Student Certificate Records
const mongoose = require("mongoose");

const studentCertificateSchema = new mongoose.Schema({
    studentId:       { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    certificateType: { type: String, enum: ["expert", "nano_degree", "fellowship"], required: true },
    certificateId:   { type: String, unique: true, sparse: true },
    documentNumber:  { type: String, unique: true, sparse: true },
    domain:          { type: String, default: null },
    issuedAt:        { type: Date, default: null },
    pdfUrl:          { type: String, default: null },
    paymentStatus:   { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    verificationUrl: { type: String, default: null },
    linkedinUrl:     { type: String, default: null },
    badgeSvgUrl:     { type: String, default: null },
    // Psychology: trigger has been shown to student
    triggerShownAt:  { type: Date, default: null },
    // Claim interaction
    claimedAt:       { type: Date, default: null }
}, { timestamps: true });

studentCertificateSchema.index({ studentId: 1, certificateType: 1 }, { unique: true });
studentCertificateSchema.index({ certificateId: 1 });

module.exports = mongoose.model("StudentCertificate", studentCertificateSchema);
