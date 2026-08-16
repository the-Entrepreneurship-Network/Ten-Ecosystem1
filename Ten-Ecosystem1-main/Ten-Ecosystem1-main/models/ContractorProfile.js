const mongoose = require("mongoose");

const ContractorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EcosystemUser",
    required: true,
    unique: true,
    index: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  mobile: { type: String, default: "" },
  skills: { type: [String], default: [] },
  experience: { type: String, default: "" },
  portfolio: { type: String, default: "" },
  hourlyRate: { type: Number, default: 0 },
  availability: { type: String, default: "" },
  verificationStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("ContractorProfile", ContractorProfileSchema);
