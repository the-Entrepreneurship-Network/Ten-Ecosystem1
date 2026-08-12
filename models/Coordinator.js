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
    employeeId: { type: String, default: "" },
    promotedFrom: { type: String, default: "" },    // e.g. "student"
    verificationStatus: { type: String, default: "pending", enum: ["pending", "approved", "rejected"] },

    // Who decided, when, and why — so a rejected applicant can be told
    // something more useful than "no", and HR can see who signed off.
    reviewedBy:        { type: String, default: "" },
    reviewedAt:        { type: Date,   default: null },
    reviewNote:        { type: String, default: "" },

    // How this coordinator shares their domain.
    //
    // "sole"   — the only coordinator for the domain. Approving a sole
    //            coordinator suspends anyone else already holding it.
    // "shared" — works alongside the existing coordinator(s); both keep access.
    //
    // Set by HR at approval time, and only meaningful once approved.
    domainMode:        { type: String, default: "sole", enum: ["sole", "shared"] },

    // Set when another coordinator is approved as "sole" for the same domain.
    // Kept separate from verificationStatus so the record still shows they were
    // once approved, and by whom, rather than looking like a rejected applicant.
    supersededAt:      { type: Date,   default: null },
    supersededBy:      { type: String, default: "" },
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
