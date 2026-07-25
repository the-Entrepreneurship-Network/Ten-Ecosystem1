const mongoose = require("mongoose");

const StudentProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EcosystemUser",
    required: true,
    unique: true,
    index: true
  },
  fullName: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  mobile: { type: String, default: "" },
  country: { type: String, default: "" },
  state: { type: String, default: "" },
  city: { type: String, default: "" },
  university: { type: String, default: "" },
  degree: { type: String, default: "" },
  graduationYear: { type: String, default: "" },
  skills: { type: [String], default: [] },
  resume: { type: String, default: "" },
  linkedin: { type: String, default: "" },
  portfolio: { type: String, default: "" },
  verificationStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("StudentProfile", StudentProfileSchema);
