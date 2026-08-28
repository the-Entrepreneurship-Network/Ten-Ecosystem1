const mongoose = require("mongoose");

// HR member account (DB-backed). Used after promotion-flow registration.
// Legacy hardcoded HR logins (HR_ACCOUNTS in server.js) keep working alongside
// this for backward compatibility — see /hr-login route.

const HRSchema = new mongoose.Schema({
    // For DB-backed accounts the canonical login key is `email` (Requirement 4).
    // `username` is kept for backward compatibility with legacy hardcoded HR.
    username: { type: String, default: "", index: true },
    email:    { type: String, default: "", lowercase: true, trim: true, unique: true, sparse: true },
    password: { type: String, required: true },   // bcrypt-hashed
    name:     { type: String, required: true },
    role:     { type: String, default: "hr" },
    employeeId: { type: String, default: "" },
    promotedFrom: { type: String, default: "" },  // e.g. "coordinator"
    /*
     * 1–8, matching HR_ROSTER in server.js: Jr HR Associate through Vice
     * President. /hr-login already reads `dbHR.level` and the portal already
     * switches on it — but the field was never on this schema, so every
     * DB-backed HR account (a promoted coordinator) came back as level 1 and
     * could not open anything gated above it.
     */
    level:    { type: Number, default: 1, min: 1, max: 8 },
    failedLoginAttempts: { type: Number, default: 0 },
    // When the most recent failure was, so the attempt counter decays.
    // Without it, failures accumulated forever between successful logins.
    lastFailedLoginAt:   { type: Date, default: null },
    lockoutUntil: { type: Date, default: null },
    isLockedOut: { type: Boolean, default: false },
    // Forgot password (Feature 9)
    passwordResetToken:  { type: String, default: null, index: true },
    passwordResetExpiry: { type: Date,   default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("HR", HRSchema);
