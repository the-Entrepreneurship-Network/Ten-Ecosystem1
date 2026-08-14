'use strict';

/**
 * One notification feed, assembled from what the portal already stores.
 *
 * Three separate notification systems grew up here — the legacy `Notification`
 * collection with its SSE stream, `EcosystemNotification`, and a `Notice` model
 * that is bypassed in favour of a JSON file. Rather than add a fourth, this
 * reads the ones that actually hold data and merges them into a single
 * chronological list, with unread direct messages folded in as their own rows:
 * a message someone sent you is a notification whatever table it lives in.
 *
 * Identity comes from the session. Nothing here accepts a user id from the
 * caller — otherwise anyone could read anyone's notifications.
 */

const express = require('express');
const router  = express.Router();

const Notification = require('../models/Notification');
const Message      = require('../models/Message');
const ChatRead     = require('../models/ChatRead');
const Student      = require('../models/Student');

// The same identity the chat inbox uses, so a conversation that appears there
// also appears here. This file had its own copy with its own id rules; when
// they disagreed, an HR user's unread messages were counted by one and missed
// by the other.
const chatIdentity = require('../services/chatIdentity');

function identityOf(req) {
  return chatIdentity.identityFromSession(req.session);
}

function requireUser(req, res, next) {
  const me = identityOf(req);
  if (!me || !me.id) {
    return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
  }
  req.me = me;
  next();
}

/**
 * GET /api/notifications/feed
 *
 * Everything addressed to this person, newest first, each marked read or not.
 */
router.get('/feed', requireUser, async (req, res) => {
  try {
    const me = req.me;
    const items = [];

    // The student's live domain, in case the session predates a domain change.
    let domain = me.domain;
    if (me.role === 'student') {
      const student = await Student.findOne({ employeeId: me.id }).select('domain domains').lean();
      if (student) domain = student.domain || domain;
    }

    // ── portal notifications ────────────────────────────────────────────
    const targeting = me.role === 'student'
      ? [
          { targetType: 'all' },
          { targetType: 'student', targetEmployeeId: me.id },
          { targetType: 'domain', targetDomain: domain }
        ]
      : me.role === 'coordinator'
        ? [
            { targetType: 'all' },
            { targetType: 'coordinator' },
            { targetType: 'coordinator-domain', targetDomain: domain },
            { targetType: 'coordinator', targetUsername: me.id }
          ]
        : [{ targetType: 'all' }];

    const notes = await Notification.find({ $or: targeting })
      .sort({ createdAt: -1 }).limit(100).lean();

    for (const n of notes) {
      items.push({
        id: String(n._id),
        kind: 'portal',
        type: n.type || 'info',
        title: n.title || 'Notification',
        body: n.message || '',
        from: n.from || '',
        at: n.createdAt,
        read: Array.isArray(n.readBy) && n.readBy.indexOf(me.id) !== -1,
        url: null
      });
    }

    // ── unread direct messages, one row per conversation ────────────────
    // Grouped by conversation rather than one row per message: forty messages
    // from one person is one thing to look at, not forty.
    const myIds = chatIdentity.matchIds(me);
    const rooms = await Message.distinct('chatRoom', chatIdentity.dmRoomFilterFor(me));

    if (rooms.length) {
      const readMap = await ChatRead.mapFor(me.id, rooms);
      for (const room of rooms) {
        const since = readMap[room] || new Date(0);
        const unread = await Message.find({
          chatRoom: room,
          senderId: { $nin: myIds },
          timestamp: { $gt: since }
        }).sort({ timestamp: -1 }).limit(1).lean();

        if (!unread.length) continue;
        const last = unread[0];
        const count = await Message.countDocuments({
          chatRoom: room,
          senderId: { $nin: myIds },
          timestamp: { $gt: since }
        });

        items.push({
          id: 'dm:' + room,
          kind: 'message',
          type: 'info',
          title: count > 1
            ? `${count} new messages from ${last.senderName || last.senderId}`
            : `New message from ${last.senderName || last.senderId}`,
          body: last.imageUrl && !last.message ? 'Sent a photo' : (last.message || '').slice(0, 160),
          from: last.senderName || last.senderId,
          at: last.timestamp,
          read: false,
          url: '/messages?to=' + encodeURIComponent(last.senderId)
        });
      }
    }

    items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

    res.json({
      success: true,
      me: { id: me.id, role: me.role },
      unread: items.filter((i) => !i.read).length,
      items: items.slice(0, 120)
    });
  } catch (err) {
    console.error('[notifications] feed failed:', err.message);
    res.status(500).json({ success: false, message: err.message, items: [] });
  }
});

/**
 * POST /api/notifications/read-all
 *
 * Marks portal notifications read, and every conversation read up to now.
 *
 * The dashboard used to POST /notifications/mark-all-read, which does not
 * exist — it 404'd inside an empty catch, so the badge cleared on screen and
 * the count came back on the next load.
 */
router.post('/read-all', requireUser, async (req, res) => {
  try {
    const me = req.me;

    await Notification.updateMany(
      { readBy: { $ne: me.id } },
      { $addToSet: { readBy: me.id } }
    );

    const rooms = await Message.distinct('chatRoom', chatIdentity.dmRoomFilterFor(me));
    const now = new Date();
    for (const room of rooms) await ChatRead.markRead(me.id, room, now);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/notifications/unread-count
 *
 * The number behind the notification orb, split by kind, plus where the newest
 * thing lives.
 *
 * The breakdown is what lets the orb say "2 new messages" rather than "2", and
 * `latest.url` is what lets a click land in the actual conversation instead of
 * a list the reader then has to search. Both come from the same pass, so one
 * cheap call every 45 seconds covers the whole widget.
 */
router.get('/unread-count', requireUser, async (req, res) => {
  try {
    const me = req.me;
    const notes = await Notification.countDocuments({
      $and: [
        { readBy: { $ne: me.id } },
        { $or: me.role === 'student'
          ? [{ targetType: 'all' }, { targetType: 'student', targetEmployeeId: me.id }, { targetType: 'domain', targetDomain: me.domain }]
          : [{ targetType: 'all' }] }
      ]
    });

    // Newest unread portal notification, so the orb can rank it against the
    // newest message and send the reader to whichever actually came last.
    const newestNote = await Notification.findOne({
      $and: [
        { readBy: { $ne: me.id } },
        { $or: me.role === 'student'
          ? [{ targetType: 'all' }, { targetType: 'student', targetEmployeeId: me.id }, { targetType: 'domain', targetDomain: me.domain }]
          : [{ targetType: 'all' }] }
      ]
    }).sort({ createdAt: -1 }).select('title createdAt').lean();

    // Every id this person is known by — see services/chatIdentity. Matching
    // the canonical id alone hid conversations started under their other
    // spelling, which is the same fault that made the inbox answer "Forbidden".
    const myIds = chatIdentity.matchIds(me);
    const rooms = await Message.distinct('chatRoom', chatIdentity.dmRoomFilterFor(me));
    const readMap = rooms.length ? await ChatRead.mapFor(me.id, rooms) : {};

    let dms = 0;
    let newestMessage = null;
    for (const room of rooms) {
      const since = readMap[room] || new Date(0);
      const last = await Message.find({
        chatRoom: room,
        senderId: { $nin: myIds },
        timestamp: { $gt: since }
      }).sort({ timestamp: -1 }).limit(1).lean();

      if (!last.length) continue;
      dms++;    // conversations with something unread, not messages
      if (!newestMessage || last[0].timestamp > newestMessage.timestamp) newestMessage = last[0];
    }

    // Where a click should go. A message wins when it is the more recent of
    // the two, because that is what the reader is being told about.
    let latest = { kind: 'none', url: '/notifications', title: '' };
    const noteAt = newestNote && newestNote.createdAt ? new Date(newestNote.createdAt).getTime() : 0;
    const msgAt = newestMessage && newestMessage.timestamp ? new Date(newestMessage.timestamp).getTime() : 0;
    if (msgAt && msgAt >= noteAt) {
      latest = {
        kind: 'message',
        url: '/messages?to=' + encodeURIComponent(String(newestMessage.senderId || '')),
        title: newestMessage.senderName || newestMessage.senderId || 'New message'
      };
    } else if (noteAt) {
      latest = { kind: 'portal', url: '/notifications', title: newestNote.title || 'Notification' };
    }

    res.json({
      success: true,
      me: { id: me.id, role: me.role },
      unread: notes + dms,
      notifications: notes,
      messages: dms,
      latest
    });
  } catch (err) {
    console.error('[notifications] unread-count failed:', err.message);
    // Never an error to the caller: a failed count must not put a broken badge
    // on every page in the portal.
    res.json({ success: true, unread: 0, notifications: 0, messages: 0, latest: { kind: 'none', url: '/notifications', title: '' } });
  }
});

module.exports = router;
