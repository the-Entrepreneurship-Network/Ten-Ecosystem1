const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const EcosystemUserSchema = new mongoose.Schema({
  role: {
    type: String,
    // "learner" is an LLM-portal account: a paying course-taker who is not
    // an intern — no employee id, no tenure, no attendance.
    enum: ["founder", "mentor", "investor", "contractor", "student", "learner"],
    required: true
  },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  phone: { type: String, default: "" },
  bio: { type: String, default: "" },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  failedLoginAttempts: { type: Number, default: 0 },
  // When the most recent failure was, so the attempt counter decays.
  // Without it, failures accumulated forever between successful logins.
  lastFailedLoginAt:   { type: Date, default: null },
  lockoutUntil: { type: Date, default: null },
  isLockedOut: { type: Boolean, default: false },
  activeSessionToken: { type: String, default: null },
  lastLoginAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("EcosystemUser", EcosystemUserSchema);
