'use strict';

const mongoose = require('mongoose');

const investmentRangeSchema = new mongoose.Schema({
  min:      { type: Number, default: 0 },
  max:      { type: Number, default: 0 },
  currency: { type: String, default: 'INR' }
}, { _id: false });

const portfolioItemSchema = new mongoose.Schema({
  startupName:  { type: String, trim: true },
  website:      { type: String, trim: true },
  stage:        { type: String, trim: true },
  investedYear: { type: Number }
}, { _id: false });

const investorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EcosystemUser',
    required: true,
    unique: true,
    index: true
  },
  fundName:      { type: String, trim: true, default: '' },
  investorType: {
    type: String,
    enum: ['angel','vc','family_office','corporate','accelerator','govt_fund','individual']
  },
  bio:     { type: String, trim: true, maxlength: 2000, default: '' },
  thesis:  { type: String, trim: true, maxlength: 1000, default: '' },
  investmentRange: { type: investmentRangeSchema, default: () => ({}) },
  stagePreference: [{
    type: String,
    enum: ['pre_seed','seed','series_a','series_b']
  }],
  sectorFocus:    [{ type: String, trim: true }],
  geographyFocus: [{ type: String, trim: true }],
  portfolioSize:  { type: Number, default: 0 },
  portfolio:      { type: [portfolioItemSchema], default: [] },
  linkedinUrl:    { type: String, trim: true, default: '' },
  website:        { type: String, trim: true, default: '' },
  contactEmail:   { type: String, trim: true, default: '' },
  isVisible:      { type: Boolean, default: true },
  verificationStatus: {
    type: String,
    enum: ['pending','approved','rejected'],
    default: 'pending'
  },
  verifiedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', default: null },
  verifiedAt:   { type: Date },
  profileViews: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('InvestorProfile', investorProfileSchema);
