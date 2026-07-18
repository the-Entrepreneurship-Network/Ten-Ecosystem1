const mongoose = require('mongoose');

// High-privilege accounts only — Founder and Admin.
// HR accounts (hr_1 through hr_8) live in models/HR.js.
const AdminUserSchema = new mongoose.Schema({
  username:     { type: String, unique: true, required: true },
  email:        { type: String, unique: true, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },  // bcrypt only
  role:         { type: String, enum: ['founder', 'admin'], required: true },
  isActive:     { type: Boolean, default: true },
  createdBy:    { type: String },  // username of whoever created this account
  lastLogin:    { type: Date },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('AdminUser', AdminUserSchema);
