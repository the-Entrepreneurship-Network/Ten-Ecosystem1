const mongoose = require("mongoose");

/**
 * A deliverable a contractor submitted against a project.
 *
 * The dashboard's "Submit Milestone" button used to collect a repository URL
 * and delivery notes, then show "Deliverable registered. Review has been routed
 * to client and HR administrators queues." without sending anything anywhere.
 * Nobody was ever routed anything. This is where that submission lands.
 */
const contractorMilestoneSchema = new mongoose.Schema({
    contractorId: { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser",     required: true, index: true },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: "ContractorProject", required: true, index: true },

    // Denormalised so the HR review queue reads without a second lookup per row.
    projectTitle:   { type: String, default: "" },
    contractorName: { type: String, default: "" },

    // The link is the deliverable. Validated as http(s) at the route, because a
    // reviewer clicks it and a javascript: URL there would be an XSS vector.
    deliverableUrl: { type: String, required: true, maxlength: 2000 },
    notes:          { type: String, default: "", maxlength: 4000 },

    status: {
        type: String,
        enum: ["submitted", "under_review", "approved", "changes_requested"],
        default: "submitted",
        index: true
    },

    reviewedBy:  { type: String, default: "" },
    reviewedAt:  { type: Date,   default: null },
    reviewNote:  { type: String, default: "", maxlength: 2000 },

    submittedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// The HR queue is "everything awaiting review, newest first".
contractorMilestoneSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model("ContractorMilestone", contractorMilestoneSchema);
