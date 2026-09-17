const mongoose = require("mongoose");

// ================= ATTENDANCE SETTINGS MODEL =================
// One document. What the attendance agent needs that used to live only in the
// server's environment: where the form's responses are, where the report goes
// and when. Environment variables still win when they are set, so a server
// configured the old way keeps working unchanged; this lets HR configure it
// from the portal when nobody can reach the server's .env.

const attendanceSettingsSchema = new mongoose.Schema({
    key:            { type: String, default: "default", unique: true },
    sheetUrl:       { type: String, default: "" },
    reportTo:       { type: String, default: "" },   // digits with country code, comma-separated
    reportTime:     { type: String, default: "" },   // "HH:MM" in the report timezone
    requiredPerDay: { type: Number, default: 0 },    // 0 = not set (defaults to 2)
    whatsappToken:  { type: String, default: "" },
    phoneNumberId:  { type: String, default: "" },
    n8nWebhookUrl:  { type: String, default: "" },
    updatedBy:      { type: String, default: "" },
    updatedAt:      { type: Date, default: Date.now },
});

module.exports = mongoose.model("AttendanceSettings", attendanceSettingsSchema);
