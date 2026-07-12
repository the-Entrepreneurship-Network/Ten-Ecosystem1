const mongoose = require("mongoose");

const HRActivityLogSchema = new mongoose.Schema({
  hrId: { type: String, required: true },
  action: {
    type: String,
    enum: ["view", "edit", "approve", "reject", "suspend", "delete", "assign_mentor", "assign_student"],
    required: true
  },
  targetUserId: { type: String, required: true },
  targetRole: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("HRActivityLog", HRActivityLogSchema);
