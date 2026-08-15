const mongoose = require("mongoose");

/**
 * A programme TEN runs — internship, bootcamp, fellowship.
 *
 * routes/programApiRoutes.js served six of these from a PROGRAMS_DATA array
 * hardcoded at the top of the file: "TEN Summer Internship 2025" with a
 * 2025-08-15 deadline, "23 of 50 seats left", and so on. The deadlines expired
 * a year ago and the seat counts never moved, because nothing could move them.
 *
 * Seat counts are derived from ProgramApplication rather than stored, so the
 * number a visitor reads is the number of people who actually applied.
 */
const programSchema = new mongoose.Schema({
    title:       { type: String, required: true, trim: true, maxlength: 200 },
    slug:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "", maxlength: 4000 },

    type: {
        type: String,
        enum: ["internship", "bootcamp", "fellowship", "workshop", "other"],
        default: "internship",
        index: true
    },
    difficulty: {
        type: String,
        enum: ["beginner", "intermediate", "advanced"],
        default: "beginner"
    },

    duration: { type: String, default: "", maxlength: 100 },
    stipend:  { type: String, default: "", maxlength: 200 },
    company:  { type: String, default: "TEN Network", maxlength: 200 },
    tags:     { type: [String], default: [] },

    seats:     { type: Number, default: 0, min: 0 },
    deadline:  { type: Date, default: null, index: true },
    startDate: { type: Date, default: null },

    /*
     * Publication is explicit. A half-written programme must not appear on a
     * public page because somebody saved a draft, and the previous array had no
     * way to express "not ready yet" at all.
     */
    published:   { type: Boolean, default: false, index: true },
    publishedAt: { type: Date, default: null },

    status: {
        type: String,
        enum: ["open", "closing_soon", "closed", "draft"],
        default: "draft",
        index: true
    },

    createdBy: { type: String, default: "" }
}, { timestamps: true });

programSchema.index({ published: 1, status: 1, deadline: 1 });

/**
 * Is this programme still accepting applications right now?
 * A deadline in the past closes it regardless of what `status` says, so a
 * forgotten row cannot keep collecting applications for an event that is over.
 */
programSchema.methods.isOpen = function isOpen() {
    if (!this.published) return false;
    if (this.status === "closed" || this.status === "draft") return false;
    if (this.deadline && this.deadline.getTime() < Date.now()) return false;
    return true;
};

module.exports = mongoose.model("Program", programSchema);
