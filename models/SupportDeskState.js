'use strict';

/**
 * The bug agent's switch and Claude's health: one document, _id "bug-agent".
 *
 * engine, who handles students' reports of website problems:
 *   claude: the Claude scheduled task, woken through its API trigger;
 *   gemini: the server writes the first reply itself, with the free Gemini key;
 *   off:    neither, so the help desk leaves them to the team.
 * The rest is what the help desk has seen of Claude, for the Help Desk page's
 * banner and the alert email (services/supportDesk/bugAgent.js).
 */
const mongoose = require('mongoose');

const supportDeskStateSchema = new mongoose.Schema({
    _id:           { type: String },
    engine:        { type: String, enum: ['claude', 'gemini', 'off'], default: 'claude' },
    lastWokenAt:   { type: Date, default: null },
    awaitingSince: { type: Date, default: null },
    lastPassAt:    { type: Date, default: null },
    down:          { type: Boolean, default: false },
    downSince:     { type: Date, default: null },
    downReason:    { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.SupportDeskState || mongoose.model('SupportDeskState', supportDeskStateSchema);
