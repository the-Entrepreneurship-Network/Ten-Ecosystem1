const mongoose = require("mongoose");

const ProgramRegistrationSchema = new mongoose.Schema({
  programId: { type: String, required: true, index: true },
  programTitle: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser", required: true },
  userRole: { type: String, required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  appliedAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  remarks: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("ProgramRegistration", ProgramRegistrationSchema);
