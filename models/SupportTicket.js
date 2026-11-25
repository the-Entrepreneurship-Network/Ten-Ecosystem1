'use strict';

/**
 * What the help desk did with one email to complaints@.
 *
 * Written BEFORE anything is sent: `gmailId` is unique, so a second process,
 * or the next run, cannot answer the same email twice. Kept 90 days; it holds
 * a student's address, the start of their message and the reply it sent.
 */
const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    gmailId:    { type: String, required: true },
    threadId:   { type: String, default: '' },
    from:       { type: String, default: '' },
    fromName:   { type: String, default: '' },
    subject:    { type: String, default: '', maxlength: 300 },
    excerpt:    { type: String, default: '', maxlength: 600 },
    // The reply as the help desk sent or drafted it, for HR to check on the Help Desk page.
    reply:      { type: String, default: '', maxlength: 5000 },
    action:     { type: String, enum: ['working', 'sent', 'drafted', 'held', 'human', 'skipped', 'failed'], default: 'working' },
    reason:     { type: String, default: '' },
    answers:    { type: [{ _id: false, answerId: String, question: String, score: Number }], default: [] },
    student:    { type: Boolean, default: false },
    verified:   { type: Boolean, default: false }
}, { timestamps: true });

supportTicketSchema.index({ gmailId: 1 }, { unique: true });
supportTicketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
supportTicketSchema.index({ from: 1, createdAt: -1 });

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
