'use strict';

const mongoose = require('mongoose');

const expertiseSchema = new mongoose.Schema({
  area:     { type: String, trim: true },
  yearsExp: { type: Number, default: 0 },
  level:    { type: String, trim: true }
}, { _id: false });

const pastCompanySchema = new mongoose.Schema({
  name:     { type: String, trim: true },
  role:     { type: String, trim: true },
  duration: { type: String, trim: true }
}, { _id: false });

const testimonialSchema = new mongoose.Schema({
  mentee:  { type: String, trim: true },
  text:    { type: String, trim: true, maxlength: 500 },
  rating:  { type: Number, min: 1, max: 5 }
}, { _id: false });

const mentorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EcosystemUser',
    required: true,
    unique: true,
    index: true
  },
  headline:              { type: String, trim: true, maxlength: 120, default: '' },
  bio:                   { type: String, trim: true, maxlength: 2000, default: '' },
  expertise:             { type: [expertiseSchema], default: [] },
  industries:            [{ type: String, trim: true }],
  totalMentoringHours:   { type: Number, default: 0 },
  menteeCount:           { type: Number, default: 0 },
  sessionRate:           { type: Number, default: 0 },
  sessionType: [{
    type: String,
    enum: ['free','paid','equity']
  }],
  availability: {
    type: String,
    enum: ['actively_mentoring','limited','not_available'],
    default: 'actively_mentoring'
  },
  sessionDuration: { type: Number, default: 60 },
  linkedinUrl:     { type: String, trim: true, default: '' },
  twitterUrl:      { type: String, trim: true, default: '' },
  website:         { type: String, trim: true, default: '' },
  pastCompanies:   { type: [pastCompanySchema], default: [] },
  testimonials:    { type: [testimonialSchema], default: [] },
  rating:          { type: Number, default: 0, min: 0, max: 5 },
  reviewCount:     { type: Number, default: 0 },
  verificationStatus: {
    type: String,
    enum: ['pending','approved','rejected'],
    default: 'pending'
  },
  verifiedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', default: null },
  verifiedAt:      { type: Date },
  rejectionReason: { type: String, trim: true, default: '' },
  profileViews:    { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('MentorProfile', mentorProfileSchema);
