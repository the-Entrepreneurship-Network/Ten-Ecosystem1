#!/usr/bin/env node
'use strict';

/**
 * Put the 30-day clock on direct messages that predate it.
 *
 * The retention policy is enforced by a TTL index on `Message.expiresAt`, and
 * that index ignores any document where the field is missing or null. Messages
 * written before the field existed therefore have no deadline and would be kept
 * forever — the opposite of the policy.
 *
 * This stamps each existing direct message with `timestamp + 30 days`, measured
 * from when it was SENT, not from now. So a conversation that has been sitting
 * in the database for two months is already past its deadline and MongoDB will
 * remove it on the next TTL sweep (roughly a minute), which is the correct
 * outcome — those messages should have been gone weeks ago.
 *
 * Group-room messages are not touched: they have no expiry by design.
 *
 * Dry run by default, and it prints how many messages are already past the
 * deadline BEFORE it writes anything, so the size of that deletion is a
 * decision rather than a surprise.
 *
 *   node scripts/backfill-dm-expiry.js
 *   node scripts/backfill-dm-expiry.js --apply
 */

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Run this on the server, where .env is.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const Message = require('../models/Message');
  const days = Message.DM_RETENTION_DAYS;
  const ms = days * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const needsStamp = {
    chatRoom: /^dm::/,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }]
  };

  const total = await Message.countDocuments(needsStamp);
  console.log(`Direct messages with no expiry: ${total}`);

  if (!total) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // How many are already older than the retention window, i.e. will be deleted
  // by the TTL monitor shortly after this runs.
  const cutoff = new Date(now - ms);
  const alreadyStale = await Message.countDocuments({
    ...needsStamp,
    timestamp: { $lt: cutoff }
  });

  console.log(`  → already older than ${days} days, so MongoDB will delete them: ${alreadyStale}`);
  console.log(`  → still inside the window, will simply get a deadline:        ${total - alreadyStale}\n`);

  // Group-room messages must keep a null expiry. Reported so the run can be
  // checked against the collection as a whole.
  const groupMessages = await Message.countDocuments({ chatRoom: { $not: /^dm::/ } });
  console.log(`Group-room messages (never expire, untouched): ${groupMessages}\n`);

  if (!APPLY) {
    console.log(`Nothing was written. Re-run with --apply to stamp ${total} messages.`);
    console.log(`Note: ${alreadyStale} of them are past the deadline and will be deleted within a minute or two of applying.`);
    await mongoose.disconnect();
    return;
  }

  // expiresAt = timestamp + retention, computed per document.
  const result = await Message.updateMany(needsStamp, [
    { $set: { expiresAt: { $add: ['$timestamp', ms] } } }
  ]);

  console.log(`Stamped ${result.modifiedCount} messages.`);
  console.log('MongoDB removes the expired ones on its next TTL sweep (about once a minute).');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
