const mongoose = require("mongoose");

/**
 * A position an investor holds — their portfolio row.
 *
 * "Capital Share Capture Record" on the investor dashboard collected a startup
 * name, an allocation in rupees and an equity percentage, then added a table
 * row to the DOM. Refresh and the portfolio was empty again.
 *
 * The investor owns these rows and is the only one who can write them: this is
 * their private record of what they put in, not a TEN-verified cap table.
 */
const investorHoldingSchema = new mongoose.Schema({
    investorId: { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser",  required: true, index: true },
    startupId:  { type: mongoose.Schema.Types.ObjectId, ref: "StartupProfile", default: null },

    startupName: { type: String, required: true, trim: true, maxlength: 200 },

    // Rupees. Stored as a number so a portfolio total is a sum rather than a
    // string-parsing exercise; formatted for display at the edge.
    amount:      { type: Number, required: true, min: 0 },
    equityPct:   { type: Number, default: null, min: 0, max: 100 },

    stage: {
        type: String,
        enum: ["pre_seed", "seed", "series_a", "series_b", "later", "other"],
        default: "seed"
    },

    investedOn: { type: Date, default: Date.now, index: true },
    notes:      { type: String, default: "", maxlength: 2000 },

    status: {
        type: String,
        enum: ["active", "exited", "written_off"],
        default: "active",
        index: true
    }
}, { timestamps: true });

investorHoldingSchema.index({ investorId: 1, investedOn: -1 });

module.exports = mongoose.model("InvestorHolding", investorHoldingSchema);
