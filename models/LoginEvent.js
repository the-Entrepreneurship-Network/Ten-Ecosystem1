const mongoose = require("mongoose");

// ================= LOGIN EVENT MODEL =================
// One row per sign-in attempt on any portal. The Attendance model records what
// a student or coordinator *claims* about a day; this records what the server
// *saw* — who authenticated, on which portal, at what time, from where. The
// daily attendance report is built from the two side by side.

const USER_TYPES = [
    "student", "hr", "coordinator", "admin",
    "founder", "mentor", "investor", "contractor",
    "ecosystem", "unknown",
];

const loginEventSchema = new mongoose.Schema({
    userType:  { type: String, enum: USER_TYPES, required: true, index: true },
    // employeeId for students, username for HR/coordinators, ObjectId string for ecosystem users
    userId:    { type: String, default: "" },
    label:     { type: String, default: "" },
    email:     { type: String, default: "" },
    domain:    { type: String, default: "" },
    // The route that authenticated them, e.g. "/student-login"
    portal:    { type: String, default: "" },

    success:   { type: Boolean, default: true, index: true },
    reason:    { type: String, default: "" },

    ip:        { type: String, default: "" },
    userAgent: { type: String, default: "" },
    sessionId: { type: String, default: "" },

    loginAt:   { type: Date, default: Date.now, index: true },
    // YYYY-MM-DD in the report timezone (utils/reportClock). Queried by day.
    dateKey:   { type: String, required: true, index: true },
});

loginEventSchema.index({ dateKey: 1, userType: 1, success: 1 });
loginEventSchema.index({ userType: 1, userId: 1, loginAt: -1 });

// Retention is a cron purge rather than a TTL index so the window can change
// without a migration (ATTENDANCE_LOGIN_RETENTION_DAYS).

const LoginEvent = mongoose.model("LoginEvent", loginEventSchema);
LoginEvent.USER_TYPES = USER_TYPES;
module.exports = LoginEvent;
