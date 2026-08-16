const mongoose = require("mongoose");

// ================= ATTENDANCE MODEL =================
// New primary attendance system. Two independent sources:
//   - markedBy: "self"        -> marked by the student (once per calendar day)
//   - markedBy: "coordinator" -> marked by the coordinator (any date, editable)
// The old submission-based attendance (attendanceCount inside submissions)
// is kept only for historical reference and is NOT used for calculations.

const attendanceSchema = new mongoose.Schema({
    studentId:     { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
    employeeId:    { type: String, required: true, index: true },
    domain:        { type: String, default: "" },

    // The day this attendance belongs to
    date:          { type: Date, required: true },
    // Normalized YYYY-MM-DD key used to enforce one mark per day per source
    dateKey:       { type: String, required: true, index: true },

    status:        { type: String, enum: ["Present", "Absent"], default: "Present" },

    // Source of the mark
    markedBy:      { type: String, enum: ["self", "coordinator"], required: true },
    // Coordinator username (only set when markedBy === "coordinator")
    coordinatorId: { type: String, default: "" },

    // How the mark was made: "portal" (the default), "bulk", "qr", "auto".
    // The bulk and QR handlers already set this; without the field on the
    // schema Mongoose dropped it silently in strict mode.
    source:        { type: String, default: "portal" },

    createdAt:     { type: Date, default: Date.now }
});

// One record per student / per day / per source / PER DOMAIN.
//
// `domain` is part of the key because a student may hold two domains, and the
// two are separate internships — attending one says nothing about the other.
// The index used to be {employeeId, dateKey, markedBy}, which meant a student
// registered for two domains through the register-hub form (one Student
// document, one employeeId, `domains: [a, b]`) could mark attendance once per
// day TOTAL: the first mark made the second domain impossible. See
// utils/attendanceDomain.js for the read side.
//
// MIGRATION: adding this index does not remove the old one. Mongo will keep
// enforcing {employeeId, dateKey, markedBy} until it is dropped, and while it
// exists the second domain still cannot be marked. Run
// `node scripts/migrate-attendance-domain-index.js --apply` once after deploy.
attendanceSchema.index({ employeeId: 1, dateKey: 1, markedBy: 1, domain: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
