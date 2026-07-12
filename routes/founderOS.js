'use strict';

const express         = require('express');
const path            = require('path');
const { requireRole } = require('../middleware/roleGuard');
const { ROLES }       = require('../config/roles');

// Import models for live metric calculations
const Student         = require('../models/Student');
const Payment         = require('../models/Payment');
const MentorProfile   = require('../models/MentorProfile');
const FounderProfile  = require('../models/FounderProfile');
const InvestorProfile = require('../models/InvestorProfile');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'founder-os.html'));
});

router.get('/stats', requireRole(ROLES.FOUNDER, ROLES.ADMIN), async (req, res) => {
  try {
    const [internships, mentors, applications, revenueResult] = await Promise.all([
      Student.countDocuments(),
      MentorProfile.countDocuments({ verificationStatus: 'approved' }),
      Promise.all([
        FounderProfile.countDocuments({ verificationStatus: 'pending' }),
        MentorProfile.countDocuments({ verificationStatus: 'pending' }),
        InvestorProfile.countDocuments({ verificationStatus: 'pending' })
      ]).then(([f, m, i]) => f + m + i),
      Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const revenue = revenueResult && revenueResult[0] ? Math.round(revenueResult[0].total) : 0;

    return res.status(200).json({
      success: true,
      internships,
      revenue,
      mentors,
      applications
    });
  } catch (err) {
    console.error('[founderOS.js - stats]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch stats.' });
  }
});

module.exports = router;
