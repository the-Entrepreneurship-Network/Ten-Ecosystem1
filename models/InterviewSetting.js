const mongoose = require("mongoose");

/*
 * Which AI runs the Interview Room (services/aiMeeting.js): one document,
 * _id "interview", changed from the admin portal's Interview Room section.
 *
 *   engine            gemini (free) or claude (paid per interview);
 *   claudeModel       which Claude model, when engine is claude;
 *   claudeMonthlyCap  Claude interviews a calendar month; past it Gemini takes
 *                     the new ones, so the bill stops at the cap.
 */
const interviewSettingSchema = new mongoose.Schema({
    _id:              { type: String },
    engine:           { type: String, enum: ["gemini", "claude"], default: "gemini" },
    claudeModel:      { type: String, enum: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"], default: "claude-opus-5-5" },
    claudeMonthlyCap: { type: Number, default: 50, min: 0, max: 100000 },
    updatedBy:        { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.models.InterviewSetting || mongoose.model("InterviewSetting", interviewSettingSchema);
