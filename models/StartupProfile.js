const mongoose = require("mongoose");

const StartupProfileSchema = new mongoose.Schema({
  founderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EcosystemUser",
    required: true,
    unique: true,
    index: true
  },
  startupName: { type: String, required: true },
  industry: { type: String, default: "" },
  stage: { type: String, default: "" },
  teamSize: { type: Number, default: 1 },
  website: { type: String, default: "" },
  linkedin: { type: String, default: "" },
  revenue: { type: String, default: "" },
  fundingStage: { type: String, default: "" },
  description: { type: String, default: "" },
  goals: { type: [String], default: [] },
  verificationStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("StartupProfile", StartupProfileSchema);
