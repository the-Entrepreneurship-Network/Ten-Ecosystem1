const mongoose = require("mongoose");

/*
 * One interview in the Interview Room (services/aiMeeting.js): the level the
 * student chose, the AI that ran it, the topics it was built from, the questions the AI asked, the student's answers,
 * each score, the camera totals the page reported, and the report at the end.
 * The student sees past reports on the page and gets each by email; the AI
 * reads the transcript so far to ask the next question.
 */
const turnSchema = new mongoose.Schema({
    question: { type: String, default: "" },
    answer:   { type: String, default: "" },
    score:    { type: Number, default: null },
    feedback: { type: String, default: "" },
    seconds:  { type: Number, default: 0 },
    at:       { type: Date, default: Date.now }
}, { _id: false });

const meetingSessionSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    employeeId: { type: String, default: "" },
    domain:     { type: String, default: "" },
    mode:       { type: String, enum: ["interview"], default: "interview" },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    engine:     { type: String, enum: ["gemini", "claude"], default: "gemini" },
    claudeModel:{ type: String, default: "" },
    // Taken while INTERVIEW_OPEN=always: repeatable, and not the student's one attempt.
    trial:      { type: Boolean, default: false },
    topics:     { type: [String], default: [] },
    turns:      { type: [turnSchema], default: [] },
    // The page's running camera totals (checker, attentiveMs, awayMs, noFaceMs,
    // awayEpisodes, multiFaceEpisodes, cameraOffEpisodes), as last reported.
    proctor:    { type: mongoose.Schema.Types.Mixed, default: null },
    overall:    { type: Number, default: null },
    summary:    { type: String, default: "" },
    emailed:    { type: Boolean, default: false },
    startedAt:  { type: Date, default: Date.now },
    endedAt:    { type: Date, default: null }
});

meetingSessionSchema.index({ studentId: 1, startedAt: -1 });
meetingSessionSchema.index({ engine: 1, startedAt: -1 });

module.exports = mongoose.models.MeetingSession || mongoose.model("MeetingSession", meetingSessionSchema);
