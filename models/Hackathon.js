const mongoose = require("mongoose");

/**
 * A hackathon or ideathon TEN runs.
 *
 * public/hackathon-portal/ advertised "FIND MY TEAM", "REGISTER MY TEAM",
 * team matching by stack and timezone, prize pools and "4 per team" — with no
 * hackathon, team or event record anywhere in the codebase. Both buttons went
 * to /register.html, the generic internship signup. A student who clicked
 * REGISTER MY TEAM registered for an internship instead.
 *
 * `mode` carries the ideathon distinction the portal makes: an ideathon is
 * 24 hours of shaping a problem, a hackathon builds it, and a team formed at
 * one carries into the other.
 */
const hackathonSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug:  { type: String, required: true, unique: true, lowercase: true, trim: true },

    mode: {
        type: String,
        enum: ["hackathon", "ideathon"],
        default: "hackathon",
        index: true
    },

    tagline:     { type: String, default: "", maxlength: 300 },
    description: { type: String, default: "", maxlength: 6000 },
    tracks:      { type: [String], default: [] },

    // Displayed as written — "₹50,000 pool", "Certificates + interview fast
    // track". A prize is not always a number and forcing one invites a fake one.
    prize:       { type: String, default: "", maxlength: 300 },

    maxTeamSize: { type: Number, default: 4, min: 1, max: 20 },
    minTeamSize: { type: Number, default: 1, min: 1, max: 20 },

    registrationOpensAt:  { type: Date, default: null },
    registrationClosesAt: { type: Date, default: null, index: true },
    startsAt:             { type: Date, default: null, index: true },
    endsAt:               { type: Date, default: null },

    venue:  { type: String, default: "Online", maxlength: 200 },

    status: {
        type: String,
        enum: ["draft", "announced", "registration_open", "in_progress", "judging", "completed", "cancelled"],
        default: "draft",
        index: true
    },
    published:   { type: Boolean, default: false, index: true },
    publishedAt: { type: Date, default: null },

    createdBy: { type: String, default: "" }
}, { timestamps: true });

hackathonSchema.index({ published: 1, startsAt: -1 });

/** Can a team register for this event right now? */
hackathonSchema.methods.registrationOpen = function registrationOpen() {
    if (!this.published) return false;
    if (this.status !== "registration_open" && this.status !== "announced") return false;
    const now = Date.now();
    if (this.registrationOpensAt  && this.registrationOpensAt.getTime()  > now) return false;
    if (this.registrationClosesAt && this.registrationClosesAt.getTime() < now) return false;
    return true;
};

module.exports = mongoose.model("Hackathon", hackathonSchema);
