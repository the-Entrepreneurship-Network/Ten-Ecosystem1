const mongoose = require("mongoose");

/**
 * Billable hours a contractor logged.
 *
 * The dashboard called this "Logged timesheets ledger — submit and audit
 * billable time modules for direct HR payroll tracking". No ledger existed and
 * HR payroll never received anything; the entry lived in a dialog and died with
 * it. Hours are money, so this is the one place on the contractor side where
 * losing a write is not survivable.
 */
const contractorTimesheetSchema = new mongoose.Schema({
    contractorId: { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser",     required: true, index: true },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: "ContractorProject", default: null, index: true },

    contractorName: { type: String, default: "" },
    projectTitle:   { type: String, default: "" },

    title: { type: String, required: true, trim: true, maxlength: 300 },
    hours: { type: Number, required: true, min: 0.25, max: 24 },

    // The rate is copied in at the moment of logging rather than read from the
    // profile at payout time. A contractor who renegotiates their rate must not
    // silently reprice work they already did.
    hourlyRate: { type: Number, required: true, min: 0 },
    amount:     { type: Number, required: true, min: 0 },

    workedOn: { type: Date, default: Date.now, index: true },

    status: {
        type: String,
        enum: ["logged", "approved", "rejected", "paid"],
        default: "logged",
        index: true
    },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date,   default: null },
    payoutNote: { type: String, default: "", maxlength: 1000 }
}, { timestamps: true });

contractorTimesheetSchema.index({ contractorId: 1, workedOn: -1 });
contractorTimesheetSchema.index({ status: 1, workedOn: -1 });

module.exports = mongoose.model("ContractorTimesheet", contractorTimesheetSchema);
