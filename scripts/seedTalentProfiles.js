'use strict';

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('[seedTalentProfiles] Connected to MongoDB');

  const EcosystemUser = require('../models/EcosystemUser');
  const TalentProfile = require('../models/TalentProfile');

  const count = await TalentProfile.countDocuments();
  if (count >= 3) {
    console.log('[seedTalentProfiles] Already have', count, 'profiles. Skipping seed.');
    await mongoose.disconnect();
    return;
  }

  const seedData = [
    {
      email: 'student@ten.com',
      profile: {
        headline:     'Full Stack Developer | React & Node.js Enthusiast',
        bio:          'Computer Science student passionate about building products',
        skills:       [
          { name: 'React',       level: 'intermediate' },
          { name: 'Node.js',     level: 'intermediate' },
          { name: 'MongoDB',     level: 'beginner'     },
          { name: 'JavaScript',  level: 'advanced'     },
          { name: 'Python',      level: 'beginner'     }
        ],
        availability: 'immediately',
        openTo:       ['internship','fulltime'],
        visibility:   'public'
      }
    },
    {
      email: 'founder@ten.com',
      profile: {
        headline:     'EdTech Founder | Building Future of Learning',
        bio:          'Serial entrepreneur with 2 exits. Currently building EdTech startup.',
        skills:       [
          { name: 'Product Management', level: 'expert'        },
          { name: 'Leadership',         level: 'advanced'      },
          { name: 'Python',             level: 'intermediate'  },
          { name: 'Growth Hacking',     level: 'advanced'      }
        ],
        availability: '2weeks',
        openTo:       ['mentorship','investment'],
        visibility:   'public'
      }
    },
    {
      email: 'mentor@ten.com',
      profile: {
        headline:     'Senior Software Engineer | 10+ Years | Open to Mentor',
        bio:          'Ex-Google engineer mentoring the next generation of developers.',
        skills:       [
          { name: 'System Design', level: 'expert'       },
          { name: 'JavaScript',    level: 'expert'       },
          { name: 'AWS',           level: 'advanced'     },
          { name: 'Docker',        level: 'advanced'     },
          { name: 'Leadership',    level: 'intermediate' }
        ],
        availability: '1month',
        openTo:       ['mentorship','parttime'],
        visibility:   'public'
      }
    }
  ];

  for (const item of seedData) {
    const user = await EcosystemUser.findOne({ email: item.email });
    if (!user) {
      console.log(`[seedTalentProfiles] User not found: ${item.email}. Run seedAdmin.js first.`);
      continue;
    }
    const existing = await TalentProfile.findOne({ userId: user._id });
    if (existing) {
      console.log(`[seedTalentProfiles] Profile already exists for: ${item.email}`);
    } else {
      await TalentProfile.create({ userId: user._id, ...item.profile });
      console.log(`[seedTalentProfiles] Created profile for: ${item.email}`);
    }
  }

  await mongoose.disconnect();
  console.log('[seedTalentProfiles] Done.');
}

main().catch(err => { console.error('[seedTalentProfiles] Error:', err.message); process.exit(1); });
