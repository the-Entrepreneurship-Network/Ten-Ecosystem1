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
    // A phone number, for the public (no-login) entrants who have no account.
    // The hackathon portal is deliberately separate from the student login, so a
    // team's only contact handle is what the lead typed on the form.
    leadPhone: { type: String, default: "", trim: true, maxlength: 20 },

    status: {
        type: String,
        enum: ["registered", "confirmed", "withdrawn", "disqualified"],
        default: "registered",
        index: true
    },

    // Payment lives on the team, not in the student Payment collection, so the
    // hackathon stays self-contained and an entrant needs no student account.
    // An admin (not HR) verifies the UPI reference before a team is confirmed.
    //   unpaid   — a logged-in student team that skipped the fee (legacy path)
    //   pending  — public entrant paid by UPI and is waiting on admin approval
    //   confirmed— admin verified the reference; the team is in
    //   rejected — admin could not find the payment; the entrant may retry
    paymentStatus: {
        type: String,
        enum: ["unpaid", "pending", "confirmed", "rejected"],
        default: "unpaid",
        index: true
    },
    paymentRef:    { type: String, default: "", trim: true, maxlength: 60 },  // the UTR
    paymentAmount: { type: Number, default: 0 },                              // set server-side from entryFee
    paidAt:        { type: Date,   default: null },
    verifiedBy:    { type: String, default: "" },
    verifiedAt:    { type: Date,   default: null },
    rejectionReason: { type: String, default: "", maxlength: 500 },

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
