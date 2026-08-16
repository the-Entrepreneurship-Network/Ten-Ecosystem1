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
