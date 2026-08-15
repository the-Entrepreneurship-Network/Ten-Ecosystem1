"use strict";

/**
 * Someone who helped build the portal, shown on the home page.
 *
 * The point is recognition: a student who contributed sees their own name on
 * the site they contributed to. So the row is denormalised on purpose — name,
 * domain and photo are COPIED from the student record at the moment HR posts
 * it, not looked up on every page load. Three reasons, and the third is the
 * one that matters:
 *
 *   1. The home page is the busiest request in the product; it should not
 *      join against Student to draw a strip.
 *   2. A contributor may leave, change domain, or have their record deleted —
 *      what they contributed does not stop being true.
 *   3. It is public. A live join would put whatever Student happens to hold
 *      today on a page anyone can read; a copy only ever exposes the four
 *      fields HR deliberately posted.
 */

const mongoose = require("mongoose");

const ContributorSchema = new mongoose.Schema({
    /** Kept so HR can find the row again, never used to re-read the student. */
    employeeId: { type: String, default: "", index: true },
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },

    name:   { type: String, required: true, trim: true, maxlength: 120 },
    domain: { type: String, default: "", maxlength: 120 },

    /** One line about what they did. This is the whole reason for the strip. */
    contribution: { type: String, default: "", maxlength: 240 },

    /** A path under /uploads, or empty for the fallback avatar. */
    photoUrl: { type: String, default: "" },

    /** Off until HR presses Post, so a half-filled row never reaches the page. */
    published: { type: Boolean, default: false, index: true },

    /** Lower sorts first; HR can pin someone to the front. */
    order: { type: Number, default: 0 },

    postedBy: { type: String, default: "" }
}, { timestamps: true });

ContributorSchema.index({ published: 1, order: 1, createdAt: -1 });

module.exports = mongoose.models.Contributor
    || mongoose.model("Contributor", ContributorSchema);
