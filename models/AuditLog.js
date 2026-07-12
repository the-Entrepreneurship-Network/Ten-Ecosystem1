const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema({
  userId: { type: String, required: false },
  actionType: { type: String, required: true },
  performedBy: { type: String, required: true },
  description: { type: String, default: "" },
  oldState: { type: mongoose.Schema.Types.Mixed, default: {} },
  newState: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("AuditLog", AuditLogSchema);
