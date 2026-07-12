'use strict';

const express         = require('express');
const path            = require('path');
const { requireRole } = require('../middleware/roleGuard');
const { ALL_ROLES }   = require('../config/roles');
const TalentProfile   = require('../models/TalentProfile');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'talent-network.html'));
});

router.get('/featured', requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const profiles = await TalentProfile.find({ visibility: 'public' })
      .sort({ profileScore: -1 })
      .limit(6)
      .select('userId headline skills availability profileScore isVerified')
      .lean();

    return res.status(200).json({ success: true, profiles });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not fetch featured talents.' });
  }
});

router.get('/trending-skills', requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const agg = await TalentProfile.aggregate([
      { $match: { visibility: 'public' } },
      { $unwind: '$skills' },
      { $group: { _id: '$skills.name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, skill: '$_id', count: 1 } },
    ]);

    return res.status(200).json({ success: true, skills: agg });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not fetch trending skills.' });
  }
});

module.exports = router;
