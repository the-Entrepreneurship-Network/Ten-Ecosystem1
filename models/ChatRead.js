'use strict';

/**
 * How far a person has read in a conversation.
 *
 * Kept in its own tiny collection rather than on Message, because "read" is a
 * fact about a *viewer*, not about a message: the same message is read by one
 * participant and unread by the other. One row per (user, room), holding the
 * timestamp of the newest message they have seen.
 *
 * Unread count for a room is then `messages newer than lastReadAt, not sent by
 * me` — no per-message write on open, and no growth with message volume.
 */

const mongoose = require('mongoose');

const chatReadSchema = new mongoose.Schema({
  // employeeId for students, email/username for staff — the same id the chat
  // identity uses everywhere else.
  userId:     { type: String, required: true },
  room:       { type: String, required: true },
  lastReadAt: { type: Date,   default: Date.now }
}, { timestamps: true });

// One row per person per room, and the lookup key for both reads and upserts.
chatReadSchema.index({ userId: 1, room: 1 }, { unique: true });

/** Mark everything up to `when` as read. Idempotent, never moves backwards. */
chatReadSchema.statics.markRead = async function (userId, room, when) {
  const at = when instanceof Date ? when : new Date();
  const existing = await this.findOne({ userId, room }).select('lastReadAt').lean();
  // Opening an old thread must not un-read the newer messages in it.
  if (existing && existing.lastReadAt && existing.lastReadAt >= at) return existing;
  return this.findOneAndUpdate(
    { userId, room },
    { $set: { lastReadAt: at } },
    { upsert: true, new: true }
  );
};

/** { room: lastReadAt } for every room this person has opened. */
chatReadSchema.statics.mapFor = async function (userId, rooms) {
  const filter = { userId };
  if (Array.isArray(rooms) && rooms.length) filter.room = { $in: rooms };
  const rows = await this.find(filter).select('room lastReadAt').lean();
  const out = {};
  for (const r of rows) out[r.room] = r.lastReadAt;
  return out;
};

module.exports = mongoose.model('ChatRead', chatReadSchema);
