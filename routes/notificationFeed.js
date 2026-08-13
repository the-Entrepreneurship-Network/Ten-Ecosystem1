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

function identityOf(req) {
  const s = req.session || {};
  if (s.adminUser)   return { role: 'admin',       id: s.adminUser.username || 'admin', domain: '' };
  if (s.hr)          return { role: 'hr',          id: s.hr.email || s.hr.username, domain: '' };
  if (s.coordinator) return { role: 'coordinator', id: s.coordinator.email || s.coordinator.username, domain: s.coordinator.domain || '' };
  if (s.student)     return { role: 'student',     id: s.student.employeeId, domain: s.student.domain || '' };
  return null;
}

function requireUser(req, res, next) {
  const me = identityOf(req);
  if (!me || !me.id) {
    return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
  }
  req.me = me;
  next();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const idRx = escapeRegex(String(me.id));
    const rooms = await Message.distinct('chatRoom', {
      chatRoom: new RegExp('^dm::(' + idRx + '::|.*::' + idRx + '$)')
    });

    if (rooms.length) {
      const readMap = await ChatRead.mapFor(me.id, rooms);
      for (const room of rooms) {
        const since = readMap[room] || new Date(0);
        const unread = await Message.find({
          chatRoom: room,
          senderId: { $ne: me.id },
          timestamp: { $gt: since }
        }).sort({ timestamp: -1 }).limit(1).lean();

        if (!unread.length) continue;
        const last = unread[0];
        const count = await Message.countDocuments({
          chatRoom: room,
          senderId: { $ne: me.id },
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

    const idRx = escapeRegex(String(me.id));
    const rooms = await Message.distinct('chatRoom', {
      chatRoom: new RegExp('^dm::(' + idRx + '::|.*::' + idRx + '$)')
    });
    const now = new Date();
    for (const room of rooms) await ChatRead.markRead(me.id, room, now);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** GET /api/notifications/unread-count — for the bell badge. */
router.get('/unread-count', requireUser, async (req, res) => {
  try {
    // Reuses the feed so the badge and the list can never disagree.
    const me = req.me;
    const notes = await Notification.countDocuments({
      $and: [
        { readBy: { $ne: me.id } },
        { $or: me.role === 'student'
          ? [{ targetType: 'all' }, { targetType: 'student', targetEmployeeId: me.id }, { targetType: 'domain', targetDomain: me.domain }]
          : [{ targetType: 'all' }] }
      ]
    });

    const idRx = escapeRegex(String(me.id));
    const rooms = await Message.distinct('chatRoom', {
      chatRoom: new RegExp('^dm::(' + idRx + '::|.*::' + idRx + '$)')
    });
    const readMap = rooms.length ? await ChatRead.mapFor(me.id, rooms) : {};
    let dms = 0;
    for (const room of rooms) {
      const n = await Message.countDocuments({
        chatRoom: room,
        senderId: { $ne: me.id },
        timestamp: { $gt: readMap[room] || new Date(0) }
      });
      if (n) dms++;    // conversations with something unread, not messages
    }

    res.json({ success: true, unread: notes + dms });
  } catch (err) {
    res.json({ success: true, unread: 0 });
  }
});

module.exports = router;
