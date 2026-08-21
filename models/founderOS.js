"use strict";

/**
 * The Founder OS data model.
 *
 * Six collections in one file because they only ever make sense together: a
 * job post has applications, a round has documents and investor conversations,
 * a startup has team members, and a founder books mentors. Splitting them into
 * six files would mean six requires and one more place to look.
 *
 * Everything here is scoped by `founderId` — the EcosystemUser _id from the
 * session. No route accepts a founderId from the client; that is what keeps one
 * founder out of another's deal room.
 */

const mongoose = require("mongoose");

const oid = mongoose.Schema.Types.ObjectId;

/* ── Hiring ──────────────────────────────────────────────────────────────── */

const JobPostSchema = new mongoose.Schema({
    founderId:  { type: oid, ref: "EcosystemUser", required: true, index: true },
    startupName:{ type: String, default: "" },

    title:       { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: "", maxlength: 8000 },
    domain:      { type: String, default: "", index: true },
    skills:      { type: [String], default: [] },

    employmentType: {
        type: String,
        enum: ["internship", "full_time", "part_time", "contract", "co_founder"],
        default: "internship"
    },
    workMode:  { type: String, enum: ["remote", "hybrid", "onsite"], default: "remote" },
    location:  { type: String, default: "" },

    // Stipend/salary as a range. Strings, because "equity + ₹10k" is a real
    // answer and a Number field would force a lie.
    compensationMin: { type: Number, default: 0 },
    compensationMax: { type: Number, default: 0 },
    compensationNote:{ type: String, default: "" },
    equityOffered:   { type: String, default: "" },

    openings:  { type: Number, default: 1, min: 1 },
    experienceLevel: { type: String, enum: ["fresher", "0-1", "1-3", "3-5", "5+"], default: "fresher" },

    status: { type: String, enum: ["draft", "open", "paused", "closed"], default: "open", index: true },
    closesAt: { type: Date, default: null },

    views: { type: Number, default: 0 },
    applicationCount: { type: Number, default: 0 }
}, { timestamps: true });

JobPostSchema.index({ founderId: 1, status: 1, createdAt: -1 });

/* ── Applications, and the pipeline they move through ────────────────────── */

/**
 * The stages are the pipeline. Order matters — the board renders columns in
 * this order and the analytics count conversions between adjacent stages.
 */
const APPLICATION_STAGES = ["applied", "shortlisted", "interview", "offer", "hired", "rejected"];

const JobApplicationSchema = new mongoose.Schema({
    jobId:     { type: oid, ref: "JobPost", required: true, index: true },
    founderId: { type: oid, ref: "EcosystemUser", required: true, index: true },

    // Applicants are TEN students; the Student record is the source of truth
    // for name, domain and employee ID, and is denormalised here so a closed
    // pipeline still reads correctly if the student record changes later.
    studentId:  { type: oid, ref: "Student", index: true },
    employeeId: { type: String, default: "" },
    name:       { type: String, default: "" },
    email:      { type: String, default: "" },
    domain:     { type: String, default: "" },

    stage:  { type: String, enum: APPLICATION_STAGES, default: "applied", index: true },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    notes:  { type: String, default: "", maxlength: 4000 },

    coverNote:  { type: String, default: "", maxlength: 4000 },
    resumeUrl:  { type: String, default: "" },
    portfolioUrl: { type: String, default: "" },

    /** Every stage change, so "why is this person still in interview" is answerable. */
    history: [{
        from: String,
        to: String,
        by: String,
        at: { type: Date, default: Date.now },
        note: String
    }],

    /** Set when the founder sources a candidate rather than the student applying. */
    sourcedByFounder: { type: Boolean, default: false },

    appliedAt: { type: Date, default: Date.now }
}, { timestamps: true });

JobApplicationSchema.index({ founderId: 1, stage: 1 });
JobApplicationSchema.index({ jobId: 1, studentId: 1 }, { unique: true, sparse: true });

/* ── Fundraising ─────────────────────────────────────────────────────────── */

const INVESTOR_STAGES = ["researching", "contacted", "meeting", "diligence", "committed", "passed"];

const FundraisingRoundSchema = new mongoose.Schema({
    founderId: { type: oid, ref: "EcosystemUser", required: true, index: true },

    name:  { type: String, required: true, trim: true, maxlength: 120 },
    stage: {
        type: String,
        enum: ["pre_seed", "seed", "series_a", "series_b", "bridge", "grant", "other"],
        default: "pre_seed"
    },

    targetAmount:  { type: Number, default: 0 },
    raisedAmount:  { type: Number, default: 0 },
    valuation:     { type: Number, default: 0 },
    currency:      { type: String, default: "INR" },

    status:   { type: String, enum: ["planning", "raising", "closed", "abandoned"], default: "planning", index: true },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },

    notes: { type: String, default: "", maxlength: 8000 },

    /**
     * The investor conversations for this round. Embedded rather than a
     * separate collection: they are never read except through their round, and
     * a round rarely has more than a few dozen.
     */
    investors: [{
        name:    { type: String, default: "" },
        firm:    { type: String, default: "" },
        email:   { type: String, default: "" },
        /** Set when the conversation is with an investor already on TEN. */
        investorUserId: { type: oid, ref: "EcosystemUser", default: null },
        stage:   { type: String, enum: INVESTOR_STAGES, default: "researching" },
        checkSize: { type: Number, default: 0 },
        committed: { type: Boolean, default: false },
        lastContactAt: { type: Date, default: null },
        nextStep: { type: String, default: "" },
        notes:   { type: String, default: "", maxlength: 2000 },
        addedAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

/* ── The data room ───────────────────────────────────────────────────────── */

/**
 * A document in the deal room.
 *
 * `visibility` is the whole point of the collection: a pitch deck is shared,
 * a cap table is not. Nothing here stores the file itself — `url` points at an
 * already-uploaded document — because the upload path already exists and
 * duplicating it here would mean two places to get file validation wrong.
 */
const DataRoomDocumentSchema = new mongoose.Schema({
    founderId: { type: oid, ref: "EcosystemUser", required: true, index: true },
    roundId:   { type: oid, ref: "FundraisingRound", default: null, index: true },

    title:    { type: String, required: true, trim: true, maxlength: 200 },
    category: {
        type: String,
        enum: ["pitch_deck", "financials", "cap_table", "legal", "product", "metrics", "other"],
        default: "other"
    },
    url:      { type: String, default: "" },
    note:     { type: String, default: "", maxlength: 2000 },

    visibility: { type: String, enum: ["private", "shared"], default: "private" },

    /** Counted when a shared link is opened, so "who looked at the deck" exists. */
    viewCount: { type: Number, default: 0 },
    lastViewedAt: { type: Date, default: null }
}, { timestamps: true });

/* ── The team ────────────────────────────────────────────────────────────── */

const StartupTeamMemberSchema = new mongoose.Schema({
    founderId: { type: oid, ref: "EcosystemUser", required: true, index: true },

    name:  { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, default: "", lowercase: true, trim: true },
    role:  { type: String, default: "", maxlength: 120 },

    type: {
        type: String,
        enum: ["cofounder", "employee", "intern", "advisor", "contractor"],
        default: "employee"
    },
    equity: { type: Number, default: 0 },   // percent
    status: { type: String, enum: ["invited", "active", "alumni"], default: "active", index: true },

    /** Set when the member came out of the hiring pipeline. */
    fromApplicationId: { type: oid, ref: "JobApplication", default: null },
    studentId: { type: oid, ref: "Student", default: null },

    joinedAt: { type: Date, default: Date.now },
    leftAt:   { type: Date, default: null },
    notes:    { type: String, default: "", maxlength: 2000 }
}, { timestamps: true });

/* ── Mentor bookings ─────────────────────────────────────────────────────── */

const MentorBookingSchema = new mongoose.Schema({
    founderId: { type: oid, ref: "EcosystemUser", required: true, index: true },
    mentorId:  { type: oid, ref: "EcosystemUser", required: true, index: true },

    mentorName: { type: String, default: "" },
    topic:   { type: String, required: true, trim: true, maxlength: 200 },
    agenda:  { type: String, default: "", maxlength: 4000 },

    requestedFor: { type: Date, required: true },
    durationMins: { type: Number, default: 30 },

    status: {
        type: String,
        enum: ["requested", "confirmed", "declined", "completed", "cancelled"],
        default: "requested",
        index: true
    },
    /** Written by the mentor when confirming, so the founder knows where to go. */
    meetingLink: { type: String, default: "" },
    mentorNote:  { type: String, default: "", maxlength: 2000 },

    /** After the session. */
    founderRating: { type: Number, min: 0, max: 5, default: 0 },
    founderFeedback: { type: String, default: "", maxlength: 2000 }
}, { timestamps: true });

MentorBookingSchema.index({ founderId: 1, requestedFor: -1 });

/* ── exports ─────────────────────────────────────────────────────────────── */

function model(name, schema) {
    return mongoose.models[name] || mongoose.model(name, schema);
}

module.exports = {
    JobPost:            model("JobPost", JobPostSchema),
    JobApplication:     model("JobApplication", JobApplicationSchema),
    FundraisingRound:   model("FundraisingRound", FundraisingRoundSchema),
    DataRoomDocument:   model("DataRoomDocument", DataRoomDocumentSchema),
    StartupTeamMember:  model("StartupTeamMember", StartupTeamMemberSchema),
    MentorBooking:      model("MentorBooking", MentorBookingSchema),
    APPLICATION_STAGES,
    INVESTOR_STAGES
};
