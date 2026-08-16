const mongoose = require("mongoose");

// Promotion record (Requirement 1).
// Created when HR promotes a student -> coordinator, or coordinator -> HR.
// The temporary password is bcrypt-hashed (never stored in plaintext after
// the email goes out). Marked as completed once the user finishes registration
// at /promoted-register.html.

const promotionSchema = new mongoose.Schema({
    userId:                 { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
    employeeId:             { type: String, required: true, index: true },
    name:                   { type: String, required: true },
    email:                  { type: String, required: true, lowercase: true, trim: true, index: true },

    fromRole:               { type: String, enum: ["student","coordinator"], required: true },
    toRole:                 { type: String, enum: ["coordinator","hr"], required: true },

    hashedTempPassword:     { type: String, default: null },

    promotedAt:             { type: Date, default: Date.now },
    promotedByHRId:         { type: String, default: "" },

    registrationCompleted:  { type: Boolean, default: false },
    completedAt:            { type: Date },

    domain:                 { type: String, default: "" },

    // 48h expiry from promotedAt (also expires on first successful registration)
    tempPasswordExpiresAt:  { type: Date, required: true }
});

promotionSchema.index({ email: 1, registrationCompleted: 1 });

module.exports = mongoose.model("Promotion", promotionSchema);
