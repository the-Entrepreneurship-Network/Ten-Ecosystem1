const mongoose = require('mongoose');

/**
 * One answer to "Did our reply answer your question?", from the two links at
 * the foot of the complaints@ auto-reply. Anonymous on purpose: the auto-reply
 * lives in the mailbox, which cannot put a per-person token in its links.
 */
const ComplaintFeedbackSchema = new mongoose.Schema({
  answer: { type: String, enum: ['yes', 'no'], required: true }
}, { timestamps: true });

module.exports = mongoose.models.ComplaintFeedback
  || mongoose.model('ComplaintFeedback', ComplaintFeedbackSchema);
