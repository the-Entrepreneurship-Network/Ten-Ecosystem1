const mongoose = require("mongoose");

// DB-backed Coordinator account, populated after a student is promoted to
// coordinator and finishes registration. Legacy hardcoded coordinators in
// server.js's COORDINATORS map keep working alongside this — see
// /coordinator-login.

const CoordinatorSchema = new mongoose.Schema({
    // Canonical login key for DB-backed coordinators is `email`.
    username:   { type: String, default: "", index: true },
    email:      { type: String, default: "", lowercase: true, trim: true, unique: true, sparse: true },
    password:   { type: String, required: true },   // bcrypt-hashed
    name:       { type: String, required: true },
    domain:     { type: String, required: true },
    employeeId: { type: String, unique: true, sparse: true, default: "" },
    promotedFrom: { type: String, default: "" },    // e.g. "student"
    verificationStatus: { type: String, default: "pending", enum: ["pending", "approved", "rejected"] },
    resumePdf: { type: String, default: "" },
    experience: { type: String, default: "" },
    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date, default: null },
    isLockedOut: { type: Boolean, default: false },
    // Forgot password (Feature 9)
    passwordResetToken:  { type: String, default: null, index: true },
    passwordResetExpiry: { type: Date,   default: null },
    createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model("Coordinator", CoordinatorSchema);
