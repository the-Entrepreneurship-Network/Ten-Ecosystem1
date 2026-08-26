'use strict';

const mongoose = require('mongoose');

/**
 * Somebody who typed their address into the box on the Career Studio page.
 *
 * They are not a student yet — no account, no employee id, nothing to attach
 * this to — so it is its own small record rather than a field bolted onto
 * Student. It exists for two reasons: so the eligibility mail can be sent
 * once rather than every time the button is pressed, and so there is a list of
 * people who asked.
 */
const StudioLeadSchema = new mongoose.Schema({
    // Stored lowercased and trimmed. The unique index is what makes "one mail
    // per person" true even when two requests arrive at the same moment.
    email:      { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    source:     { type: String, default: 'student-portal' },
    mailStatus: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
    mailError:  { type: String, default: '' },
    mailedAt:   { type: Date, default: Date.now },
    // Where they came from, for whoever eventually reads this list.
    referrer:   { type: String, default: '' },
    converted:  { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.models.StudioLead || mongoose.model('StudioLead', StudioLeadSchema);
