const mongoose = require('mongoose');

const documentHistorySchema = new mongoose.Schema({
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  studentName:    { type: String, default: '', trim: true },
  studentEmail:   { type: String, default: '', trim: true },
  employeeId:     { type: String, default: '', trim: true },
  college:        { type: String, default: 'Not provided', trim: true },
  domain:         { type: String, default: '', trim: true },
  documentType:   { type: String, required: true, trim: true },
  documentKey:    { type: String, default: '', trim: true },
  documentNumber: { type: String, default: '', trim: true },
  sentOn:         { type: Date, default: Date.now },
  sentAt:         { type: Date, default: Date.now },
  sentBy:         { type: String, default: 'System' },
  sentToEmail:    { type: String, default: '', trim: true },
  method:         { type: String, enum: ['manual', 'automation'], default: 'manual' },
  emailStatus:    { type: String, default: 'sent' }
}, { timestamps: true });

// Keep sentOn / sentAt in sync so both legacy and new consumers work,
// and infer send method from sentBy when not explicitly provided.
documentHistorySchema.pre('save', function (next) {
  if (this.sentAt && !this.sentOn) this.sentOn = this.sentAt;
  if (this.sentOn && !this.sentAt) this.sentAt = this.sentOn;
  if (this.isNew && this.$isDefault('method') && /auto|system|cron/i.test(this.sentBy || '')) {
    this.method = 'automation';
  }
  next();
});

documentHistorySchema.index({ sentAt: -1 });
documentHistorySchema.index({ employeeId: 1 });
documentHistorySchema.index({ documentNumber: 1 });

/**
 * Central helper to log a document send (manual or automation).
 * Used by all services/routes so the payload-building logic lives in one place.
 * Never throws — logging must not break the send flow.
 *
 * @param {Object} entry  - student / document info (accepts service-style aliases)
 * @param {string} method - 'manual' | 'automation'
 * @returns {Promise<Object|null>} created record or null on failure
 */
documentHistorySchema.statics.logSend = async function (entry = {}, method = 'manual') {
  try {
    const isAuto = method === 'automation';
    const when = entry.sentAt || entry.sentOn || new Date();
    return await this.create({
      studentId:      entry.studentId || null,
      studentName:    (entry.studentName || entry.name || '').trim(),
      studentEmail:   entry.studentEmail || entry.email || '',
      employeeId:     entry.employeeId || '',
      college:        entry.college || entry.collegeName || 'Not provided',
      domain:         entry.domain || '',
      documentType:   entry.documentType || entry.documentKey || 'Document',
      documentKey:    entry.documentKey || '',
      documentNumber: entry.documentNumber || '',
      sentOn:         when,
      sentAt:         when,
      sentBy:         entry.sentBy || (isAuto ? 'Auto System' : 'HR Portal'),
      sentToEmail:    entry.sentToEmail || entry.email || '',
      method:         isAuto ? 'automation' : 'manual',
      emailStatus:    entry.emailStatus || 'sent'
    });
  } catch (err) {
    console.error('[DocumentHistory] logSend failed:', err.message);
    return null;
  }
};

module.exports = mongoose.model('DocumentHistory', documentHistorySchema);
