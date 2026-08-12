// NEW FEATURE: Academics — one row per student per domain.
//
// Attempts are stored as a ledger of timestamps rather than a counter, because
// the 24-hour rule is measured from the FIRST attempt of a group of three, and
// a counter cannot answer "when does the next one unlock" after the fact.
const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema({
  at:      { type: Date,   default: Date.now },
  score:   { type: Number, default: 0 },      // 0-100
  passed:  { type: Boolean, default: false },
  covered: { type: [String], default: [] },   // rubric points the answer hit
  missed:  { type: [String], default: [] },   // and the ones it did not
}, { _id: false });

const moduleProgressSchema = new mongoose.Schema({
  moduleKey:   { type: String, required: true },
  lessonsDone: { type: [String], default: [] },
  projectDone: { type: Boolean, default: false },
  projectSkipped: { type: Boolean, default: false },
  passed:      { type: Boolean, default: false },
  bestScore:   { type: Number, default: 0 },
  attempts:    { type: [attemptSchema], default: [] },
}, { _id: false });

const academicProgressSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, index: true },
  domain:     { type: String, required: true },

  // Paid state. A student may study a whole domain unpaid; the certificate is
  // what payment releases, not the lessons. See the spec, section 2.2.
  paid:        { type: Boolean, default: false },
  paidAt:      { type: Date },
  deferredAt:  { type: Date },   // when they chose "continue to modules"

  modules:     { type: [moduleProgressSchema], default: [] },

  certificateIssued:   { type: Boolean, default: false },
  certificateIssuedAt: { type: Date },

  startedAt:   { type: Date, default: Date.now },
  completedAt: { type: Date },
}, { timestamps: true });

academicProgressSchema.index({ employeeId: 1, domain: 1 }, { unique: true });

module.exports = mongoose.model('AcademicProgress', academicProgressSchema);
