const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const EcosystemUserSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["founder", "mentor", "investor", "contractor", "student"],
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
  lockoutUntil: { type: Date, default: null },
  isLockedOut: { type: Boolean, default: false },
  activeSessionToken: { type: String, default: null },
  lastLoginAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("EcosystemUser", EcosystemUserSchema);
