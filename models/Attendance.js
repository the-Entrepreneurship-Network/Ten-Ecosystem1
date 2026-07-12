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

    createdAt:     { type: Date, default: Date.now }
});

// One record per student / per day / per source.
// This guarantees a student can self-mark only once per day,
// and a coordinator can have only one entry per student per day (edited via PUT).
attendanceSchema.index({ employeeId: 1, dateKey: 1, markedBy: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
