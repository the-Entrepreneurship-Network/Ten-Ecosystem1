'use strict';

/**
 * @fileoverview TalentProfile model — NEW collection: talentprofiles.
 * Does NOT touch or reference any existing collection.
 */

const mongoose = require('mongoose');

const skillSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  level: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'expert'], default: 'intermediate' },
}, { _id: false });

const experienceSchema = new mongoose.Schema({
  title:       { type: String, trim: true },
  company:     { type: String, trim: true },
  startDate:   { type: Date },
  endDate:     { type: Date },
  current:     { type: Boolean, default: false },
  description: { type: String, maxlength: 500 },
}, { _id: false });

const educationSchema = new mongoose.Schema({
  degree:      { type: String, trim: true },
  institution: { type: String, trim: true },
  year:        { type: Number },
  grade:       { type: String, trim: true },
}, { _id: false });

const portfolioSchema = new mongoose.Schema({
  title:       { type: String, trim: true },
  url:         { type: String, trim: true },
  description: { type: String, maxlength: 300 },
  tags:        [{ type: String, trim: true }],
}, { _id: false });

const socialLinksSchema = new mongoose.Schema({
  linkedin: { type: String, trim: true, default: '' },
  github:   { type: String, trim: true, default: '' },
  twitter:  { type: String, trim: true, default: '' },
  website:  { type: String, trim: true, default: '' },
}, { _id: false });

const talentProfileSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', required: true, unique: true, index: true },
  headline:     { type: String, trim: true, maxlength: 120, default: '' },
  bio:          { type: String, trim: true, maxlength: 1000, default: '' },
  skills:       { type: [skillSchema], default: [] },
  experience:   { type: [experienceSchema], default: [] },
  education:    { type: [educationSchema], default: [] },
  portfolio:    { type: [portfolioSchema], default: [] },
  socialLinks:  { type: socialLinksSchema, default: () => ({}) },
  availability: {
    type: String,
    enum: ['immediately', '2weeks', '1month', 'not-available'],
    default: 'immediately',
  },
  openTo: [{
    type: String,
    enum: ['internship', 'fulltime', 'parttime', 'freelance', 'mentorship', 'investment'],
  }],
  visibility:   { type: String, enum: ['public', 'network', 'private'], default: 'public' },
  profileScore: { type: Number, default: 0, min: 0, max: 100 },
  isVerified:   { type: Boolean, default: false },
  verifiedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', default: null },
}, { timestamps: true });

/** Auto-calculate profile completeness score before every save. */
talentProfileSchema.pre('save', function preSaveHook(next) {
  let score = 0;
  if (this.headline && this.headline.length > 0)   score += 20;
  if (this.bio && this.bio.length > 0)             score += 20;
  if (this.skills.length > 0)                      score += 20;
  if (this.experience.length > 0)                  score += 20;
  if (this.portfolio.length > 0)                   score += 20;
  this.profileScore = score;
  return next();
});

module.exports = mongoose.model('TalentProfile', talentProfileSchema);
