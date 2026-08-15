const mongoose = require("mongoose");

/**
 * A team registered for a hackathon or ideathon — including a team of one.
 *
 * The portal promised two things this has to support: "REGISTER MY TEAM" for
 * people who arrive with one, and "Solo entry is fine. We pair you by stack and
 * timezone so nobody spends Saturday hunting for a backend." A solo entrant is
 * a team with `lookingForMembers` set, which is what makes the FIND MY TEAM
 * listing possible without a second collection.
 */
const teamMemberSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    employeeId: { type: String, default: "" },
    name:       { type: String, required: true, trim: true, maxlength: 200 },
    email:      { type: String, required: true, lowercase: true, trim: true, maxlength: 320 },
    role:       { type: String, default: "", maxlength: 100 },
    skills:     { type: [String], default: [] },
    isLead:     { type: Boolean, default: false }
}, { _id: false });

const hackathonTeamSchema = new mongoose.Schema({
    hackathonId: { type: mongoose.Schema.Types.ObjectId, ref: "Hackathon", required: true, index: true },
    eventTitle:  { type: String, default: "" },

    name:    { type: String, required: true, trim: true, maxlength: 120 },
    track:   { type: String, default: "", maxlength: 120 },
    pitch:   { type: String, default: "", maxlength: 2000 },

    members: { type: [teamMemberSchema], default: [] },

    // Set by the lead when the team has room. Drives the FIND MY TEAM board.
    lookingForMembers: { type: Boolean, default: false, index: true },
    wantedSkills:      { type: [String], default: [] },
    timezone:          { type: String, default: "IST", maxlength: 60 },

    leadEmail: { type: String, required: true, lowercase: true, trim: true, index: true },

    status: {
        type: String,
        enum: ["registered", "confirmed", "withdrawn", "disqualified"],
        default: "registered",
        index: true
    },

    // Filled in during the event, not at registration.
    submissionUrl:  { type: String, default: "", maxlength: 2000 },
    submittedAt:    { type: Date,   default: null },

    registeredAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// One team name per event, and one registration per lead per event.
hackathonTeamSchema.index({ hackathonId: 1, name: 1 },      { unique: true });
hackathonTeamSchema.index({ hackathonId: 1, leadEmail: 1 }, { unique: true });
hackathonTeamSchema.index({ hackathonId: 1, lookingForMembers: 1 });

module.exports = mongoose.model("HackathonTeam", hackathonTeamSchema);
