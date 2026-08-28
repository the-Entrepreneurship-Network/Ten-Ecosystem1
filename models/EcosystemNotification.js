'use strict';

const mongoose = require('mongoose');

const ecosystemNotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EcosystemUser',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'profile_approved','profile_rejected',
      'application_received','application_status',
      'payment_confirmed','payment_failed',
      'mentor_request','mentor_approved',
      'founder_approved','investor_approved',
      // An investor asking about a startup, and the founder's answer. These
      // were both filed as 'system_announcement', which is also what every
      // unrelated broadcast uses, so neither could be filtered or counted.
      'investor_interest','investor_response',
      // Contractor work: assigned a project, and a reviewed milestone or
      // timesheet.
      'project_assigned','work_reviewed',
      'new_message','system_announcement'
    ],
    required: true
  },
  title:   { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  data:    { type: Map, of: mongoose.Schema.Types.Mixed },
  isRead:  { type: Boolean, default: false },
  readAt:  { type: Date },
  link:    { type: String, trim: true, default: '' }
}, { timestamps: true });

ecosystemNotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('EcosystemNotification', ecosystemNotificationSchema);
