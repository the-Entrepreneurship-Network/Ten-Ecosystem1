'use strict';

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('[seedPhase2] Connected to MongoDB');

  const EcosystemUser  = require('../models/EcosystemUser');
  const FounderProfile = require('../models/FounderProfile');
  const MentorProfile  = require('../models/MentorProfile');

  const founderUser = await EcosystemUser.findOne({ email: 'founder@ten.com' });
  const mentorUser  = await EcosystemUser.findOne({ email: 'mentor@ten.com'  });

  if (!founderUser) {
    console.log('[seedPhase2] founder@ten.com not found. Run seedAdmin.js first.');
  } else {
    const existing = await FounderProfile.findOne({ userId: founderUser._id });
    if (existing) {
      console.log('[seedPhase2] FounderProfile already exists for founder@ten.com');
    } else {
      await FounderProfile.create({
        userId:             founderUser._id,
        startupName:        'EduVerse',
        tagline:            'Making quality education accessible to every student',
        industry:           'EdTech',
        stage:              'mvp',
        teamSize:           4,
        fundingStatus:      'pre_seed',
        location:           'Bangalore, India',
        foundedYear:        2024,
        lookingFor:         ['developers','investors','interns'],
        verificationStatus: 'approved',
        verifiedAt:         new Date()
      });
      console.log('[seedPhase2] Created FounderProfile for founder@ten.com');
    }
  }

  if (!mentorUser) {
    console.log('[seedPhase2] mentor@ten.com not found. Run seedAdmin.js first.');
  } else {
    const existing = await MentorProfile.findOne({ userId: mentorUser._id });
    if (existing) {
      console.log('[seedPhase2] MentorProfile already exists for mentor@ten.com');
    } else {
      await MentorProfile.create({
        userId:             mentorUser._id,
        headline:           'Ex-Google SWE | Helping developers level up',
        expertise:          [{ area: 'Full Stack Development', yearsExp: 10, level: 'expert' }],
        industries:         ['Technology','EdTech','SaaS'],
        availability:       'actively_mentoring',
        sessionRate:        0,
        sessionType:        ['free'],
        rating:             4.8,
        reviewCount:        23,
        verificationStatus: 'approved',
        verifiedAt:         new Date()
      });
      console.log('[seedPhase2] Created MentorProfile for mentor@ten.com');
    }
  }

  await mongoose.disconnect();
  console.log('[seedPhase2] Done.');
}

main().catch(err => { console.error('[seedPhase2] Error:', err.message); process.exit(1); });
