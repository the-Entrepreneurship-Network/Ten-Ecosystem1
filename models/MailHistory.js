const mongoose = require("mongoose");

const mailHistorySchema = new mongoose.Schema(
  {
    recipientEmail: { type: String, default: "", index: true },
    recipientName: { type: String, default: "" },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null, index: true },
    subject: { type: String, default: "" },
    mailType: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ["sent", "failed"], default: "sent", index: true },
    errorMessage: { type: String, default: "" }
  },
  { timestamps: true, minimize: true }
);

module.exports = mongoose.models.MailHistory || mongoose.model("MailHistory", mailHistorySchema);
