'use strict';

/**
 * One answer the help desk can send to complaints@.
 *
 * `examples` are ways students ask for it; the matcher compares emails with
 * them. `personal` is the same answer filled in from the student's own account
 * ({{employeeId}}, {{documents}} …) and is used only when the sender is a
 * registered student whose address Gmail verified.
 *
 * Starter answers come from services/supportDesk/starterAnswers.js, keyed by
 * `starterKey`. Once HR edits one, `edited` stops a later release overwriting it.
 */
const mongoose = require('mongoose');

const supportAnswerSchema = new mongoose.Schema({
    question:   { type: String, required: true, trim: true, maxlength: 300 },
    examples:   { type: [String], default: [] },
    answer:     { type: String, required: true, maxlength: 5000 },
    personal:   { type: String, default: '', maxlength: 5000 },
    active:     { type: Boolean, default: true },
    source:     { type: String, enum: ['starter', 'taught', 'hr'], default: 'hr' },
    starterKey: { type: String, default: undefined },
    edited:     { type: Boolean, default: false },
    uses:       { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null }
}, { timestamps: true });

supportAnswerSchema.index({ starterKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.SupportAnswer || mongoose.model('SupportAnswer', supportAnswerSchema);
