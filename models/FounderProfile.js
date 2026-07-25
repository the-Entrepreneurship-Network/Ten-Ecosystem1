'use strict';

const mongoose = require('mongoose');

const coFounderSchema = new mongoose.Schema({
  name:        { type: String, trim: true },
  role:        { type: String, trim: true },
  linkedinUrl: { type: String, trim: true }
}, { _id: false });

const socialLinksSchema = new mongoose.Schema({
  twitter:  { type: String, trim: true, default: '' },
  linkedin: { type: String, trim: true, default: '' },
  github:   { type: String, trim: true, default: '' }
}, { _id: false });

const founderProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EcosystemUser',
    required: true,
    unique: true,
    index: true
  },
  startupName:   { type: String, required: true, trim: true, maxlength: 100 },
  tagline:       { type: String, trim: true, maxlength: 160, default: '' },
  description:   { type: String, trim: true, maxlength: 2000, default: '' },
  industry: {
    type: String,
    enum: ['EdTech','FinTech','HealthTech','AgriTech','CleanTech','Logistics','E-Commerce','SaaS','Gaming','Media','Other']
  },
  stage: {
    type: String,
    enum: ['idea','validation','mvp','early_revenue','growth','scaling']
  },
  teamSize:      { type: Number, min: 1, default: 1 },
  fundingStatus: {
    type: String,
    enum: ['bootstrapped','pre_seed','seed','series_a','series_b','profitable'],
    default: 'bootstrapped'
  },
  fundingAmount:   { type: Number, default: 0 },
  website:         { type: String, trim: true, default: '' },
  pitchDeckUrl:    { type: String, trim: true, default: '' },
  logoUrl:         { type: String, trim: true, default: '' },
  location:        { type: String, trim: true, default: '' },
  foundedYear:     { type: Number },
  coFounders:      { type: [coFounderSchema], default: [] },
  socialLinks:     { type: socialLinksSchema, default: () => ({}) },
  lookingFor: [{
    type: String,
    enum: ['co_founder','developers','designers','marketers','investors','mentors','interns']
  }],
  verificationStatus: {
    type: String,
    enum: ['pending','approved','rejected'],
    default: 'pending'
  },
  verifiedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', default: null },
  verifiedAt:      { type: Date },
  rejectionReason: { type: String, trim: true, default: '' },
  isActive:        { type: Boolean, default: true },
  profileViews:    { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('FounderProfile', founderProfileSchema);
