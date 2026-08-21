const mongoose = require("mongoose");

/**
 * A piece of paid work assigned to a contractor.
 *
 * public/contractor-dashboard.html shipped with two projects written into the
 * HTML — "Interactive Canvas UI Rewrite" for AgroVedic Systems and "Auth Token
 * Migration Logic" for TEN Founders. Every contractor who signed in saw the
 * same two cards, because they were markup rather than data. This is the row
 * behind that card.
 *
 * Created by HR or an admin, who are the only people who know what a client
 * has actually commissioned; a contractor can read their own and submit
 * against them, never create one.
 */
const contractorProjectSchema = new mongoose.Schema({
    contractorId: { type: mongoose.Schema.Types.ObjectId, ref: "EcosystemUser", required: true, index: true },

    title:       { type: String, required: true, trim: true, maxlength: 200 },
    client:      { type: String, default: "", trim: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 4000 },

    // Free text rather than an enum: the stack of a project is not a closed set,
    // and an unknown value must never block HR from recording real work.
    tech:        { type: String, default: "", maxlength: 300 },

    status: {
        type: String,
        enum: ["active", "pending_review", "on_hold", "completed", "cancelled"],
        default: "active",
        index: true
    },

    // What the contractor is paid for this project, when it differs from the
    // hourly rate on their profile. Null means "use the profile rate".
    budget:      { type: Number, default: null, min: 0 },
    startedAt:   { type: Date, default: Date.now },
    dueAt:       { type: Date, default: null },
    completedAt: { type: Date, default: null },

    createdBy:   { type: String, default: "" }
}, { timestamps: true });

contractorProjectSchema.index({ contractorId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("ContractorProject", contractorProjectSchema);
