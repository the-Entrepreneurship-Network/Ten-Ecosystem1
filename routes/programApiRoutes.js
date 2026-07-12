'use strict';

const express = require('express');
const router  = express.Router();

const PROGRAMS_DATA = [
  {
    id: 'prog_001', title: 'TEN Summer Internship 2025', type: 'internship',
    duration: '3 Months', stipend: '₹10,000/month', seats: 50, seatsLeft: 23,
    deadline: '2025-08-15', startDate: '2025-09-01',
    description: 'Real-world experience with top startups across tech, design, and business.',
    tags: ['Engineering','Marketing','Design','Business'], difficulty: 'Beginner',
    status: 'open', company: 'TEN Network', logo: null
  },
  {
    id: 'prog_002', title: 'Full Stack Web Development Bootcamp', type: 'bootcamp',
    duration: '6 Weeks', stipend: 'Certificate + ₹5,000', seats: 30, seatsLeft: 8,
    deadline: '2025-07-30', startDate: '2025-08-15',
    description: 'Intensive training in React, Node.js, MongoDB. Build 3 real projects.',
    tags: ['React','Node.js','MongoDB','JavaScript'], difficulty: 'Intermediate',
    status: 'open', company: 'TEN Tech Hub', logo: null
  },
  {
    id: 'prog_003', title: 'Founder Accelerator Cohort 4.0', type: 'bootcamp',
    duration: '8 Weeks', stipend: '₹25,000 Seed Grant', seats: 20, seatsLeft: 5,
    deadline: '2025-07-01', startDate: '2025-07-15',
    description: 'Launch and validate your startup idea with guidance from serial entrepreneurs.',
    tags: ['Startup','Product','Fundraising','GTM'], difficulty: 'Advanced',
    status: 'closing_soon', company: 'TEN Accelerator', logo: null
  },
  {
    id: 'prog_004', title: 'TEN Research Fellowship', type: 'fellowship',
    duration: '6 Months', stipend: '₹15,000/month', seats: 10, seatsLeft: 4,
    deadline: '2025-09-01', startDate: '2025-10-01',
    description: 'Deep research in AI, EdTech, and social impact with academic partners.',
    tags: ['AI','Research','EdTech','Academia'], difficulty: 'Advanced',
    status: 'open', company: 'TEN Research', logo: null
  },
  {
    id: 'prog_005', title: 'Digital Marketing Internship', type: 'internship',
    duration: '2 Months', stipend: '₹8,000/month', seats: 25, seatsLeft: 12,
    deadline: '2025-08-01', startDate: '2025-08-20',
    description: 'Run real campaigns for TEN partner brands. Learn SEO, paid ads, content.',
    tags: ['Marketing','SEO','Content','Analytics'], difficulty: 'Beginner',
    status: 'open', company: 'TEN Marketing', logo: null
  },
  {
    id: 'prog_006', title: 'Leadership Excellence Fellowship', type: 'fellowship',
    duration: '4 Months', stipend: '₹20,000/month', seats: 15, seatsLeft: 9,
    deadline: '2025-09-15', startDate: '2025-10-15',
    description: 'Executive leadership development with C-suite mentors and live challenges.',
    tags: ['Leadership','Management','Strategy','Communication'], difficulty: 'Advanced',
    status: 'open', company: 'TEN Leadership', logo: null
  }
];

router.get('/programs', (req, res) => {
  let data = [...PROGRAMS_DATA];
  if (req.query.type && req.query.type !== 'all') {
    data = data.filter(p => p.type === req.query.type);
  }
  if (req.query.status) {
    data = data.filter(p => p.status === req.query.status);
  }
  res.status(200).json({ success: true, data, total: data.length });
});

router.post('/programs/:id/apply', (req, res) => {
  const program = PROGRAMS_DATA.find(p => p.id === req.params.id);
  if (!program) return res.status(404).json({ success: false, error: 'Program not found.' });
  return res.status(200).json({ success: true, message: 'Application submitted successfully!', programId: req.params.id });
});

router.get('/founder-os/stats', (req, res) => {
  res.status(200).json({ success: true, data: { internships: 0, students: 0, revenue: 0, mentors: 0 } });
});

router.get('/talent-network/featured', async (req, res) => {
  try {
    const TalentProfile = require('../models/TalentProfile');
    const profiles = await TalentProfile.find({ visibility: 'public' })
      .sort({ profileScore: -1 })
      .limit(6)
      .lean();
    res.status(200).json({ success: true, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/talent-network/trending-skills', async (req, res) => {
  try {
    const TalentProfile = require('../models/TalentProfile');
    const result = await TalentProfile.aggregate([
      { $unwind: '$skills' },
      { $group: { _id: '$skills.name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
