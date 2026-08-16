'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('[seedAdmin] Connected to MongoDB');

  const EcosystemUser = require('../models/EcosystemUser');

  const users = [
    { fullName: 'Test Founder', email: 'founder@ten.com', password: 'Founder@1234', role: 'founder' },
    { fullName: 'Test Mentor',  email: 'mentor@ten.com',  password: 'Mentor@1234',  role: 'mentor'  },
    { fullName: 'Test Investor',email: 'investor@ten.com',password: 'Investor@1234',role: 'investor' },
    { fullName: 'Test Student', email: 'student@ten.com', password: 'Student@1234', role: 'student'  },
  ];

  for (const u of users) {
    const existing = await EcosystemUser.findOne({ email: u.email });
    if (existing) {
      console.log(`[seedAdmin] Skipped (already exists): ${u.email}`);
    } else {
      const hashed = bcrypt.hashSync(u.password, 10);
      await EcosystemUser.create({ ...u, password: hashed });
      console.log(`[seedAdmin] Created: ${u.email} (role: ${u.role})`);
    }
  }

  await mongoose.disconnect();
  console.log('[seedAdmin] Done.');
}

main().catch(err => { console.error('[seedAdmin] Error:', err.message); process.exit(1); });
