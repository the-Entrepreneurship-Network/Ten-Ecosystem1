const mongoose = require("mongoose");

/*
 * One mock interview in the AI Meeting Room (services/aiMeeting.js): the
 * questions the AI asked, the student's answers, each score and the report at
 * the end. The student sees their past reports on the page; the AI reads the
 * transcript so far to ask the next question.
 */
const turnSchema = new mongoose.Schema({
    question: { type: String, default: "" },
    answer:   { type: String, default: "" },
    score:    { type: Number, default: null },
    feedback: { type: String, default: "" },
    at:       { type: Date, default: Date.now }
}, { _id: false });

const meetingSessionSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    employeeId: { type: String, default: "" },
    domain:     { type: String, default: "" },
    mode:       { type: String, enum: ["interview"], default: "interview" },
    turns:      { type: [turnSchema], default: [] },
    overall:    { type: Number, default: null },
    summary:    { type: String, default: "" },
    startedAt:  { type: Date, default: Date.now },
    endedAt:    { type: Date, default: null }
});

meetingSessionSchema.index({ studentId: 1, startedAt: -1 });

module.exports = mongoose.models.MeetingSession || mongoose.model("MeetingSession", meetingSessionSchema);
