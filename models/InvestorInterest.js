const mongoose = require("mongoose");

/**
 * An investor registering interest in a startup on the network.
 *
 * The dashboard's "Express Venture Interest" told the investor that "matched
 * interest ledger for {startup} logged in central databases" and then prepended
 * a div. No founder was ever notified, and the row vanished on refresh. Both
 * halves of that sentence are now true: the interest is stored, and the founder
 * is notified.
 */
const investorInterestSchema = new mongoose.Schema({
    investorId:   { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser",  required: true, index: true },
    investorName: { type: String, default: "" },

    // A startup on the network, when the investor picked one from the directory.
    startupId:    { type: mongoose.Schema.Types.ObjectId, ref: "StartupProfile", default: null, index: true },
    // Always set, including for startups that are not on the network yet.
    startupName:  { type: String, required: true, trim: true, maxlength: 200 },

    founderId:    { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser", default: null, index: true },

    message: { type: String, default: "", maxlength: 2000 },

    status: {
        type: String,
        enum: ["pending", "accepted", "declined", "meeting_scheduled", "closed"],
        default: "pending",
        index: true
    },

    // Set when the founder responds, so neither side has to guess whether the
    // silence means "not seen" or "not interested".
    respondedAt:  { type: Date,   default: null },
    founderNote:  { type: String, default: "", maxlength: 2000 },
    meetingAt:    { type: Date,   default: null },

    createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// One investor cannot spam the same startup with duplicate interest rows.
investorInterestSchema.index({ investorId: 1, startupName: 1 }, { unique: true });

module.exports = mongoose.model("InvestorInterest", investorInterestSchema);
