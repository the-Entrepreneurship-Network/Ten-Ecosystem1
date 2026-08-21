'use strict';

/**
 * Subscribe and unsubscribe a browser for push notifications.
 *
 * Identity comes from the session, never from the request body: a caller must
 * not be able to register their own device against someone else's account and
 * receive that person's message previews on their lock screen.
 */

const express = require('express');
const router  = express.Router();
const push    = require('../services/pushService');

/** Who is calling, from the session alone. Mirrors routes/chatModeration.js. */
function identityOf(req) {
  const s = req.session || {};
  if (s.adminUser)   return { role: 'admin',       id: s.adminUser.username || 'admin' };
  if (s.hr)          return { role: 'hr',          id: s.hr.email || s.hr.username };
  if (s.coordinator) return { role: 'coordinator', id: s.coordinator.email || s.coordinator.username };
  if (s.student)     return { role: 'student',     id: s.student.employeeId };
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

/**
 * GET /api/push/config
 *
 * The public VAPID key and whether push is switched on at all. Public by
 * design: the key is meant to be handed to browsers, and a signed-out visitor
 * asking is harmless. The client uses `enabled` to decide whether to show the
 * "turn on notifications" prompt rather than asking for permission and then
 * failing.
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    enabled: push.isEnabled(),
    publicKey: push.getPublicKey()
  });
});

/** POST /api/push/subscribe { subscription } */
router.post('/subscribe', requireUser, async (req, res) => {
  try {
    if (!push.isEnabled()) {
      return res.status(503).json({ success: false, message: 'Push notifications are not configured on this server.' });
    }
    const sub = req.body && req.body.subscription;
    await push.saveSubscription(req.me.id, req.me.role, sub, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/** POST /api/push/unsubscribe { endpoint } */
router.post('/unsubscribe', requireUser, async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    const removed = await push.removeSubscription(endpoint);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/push/test — send yourself one, to prove the whole chain works.
 *
 * Deliberately restricted to the caller's own devices. A "send a test to
 * anyone" endpoint is a spam cannon with a friendly name.
 */
router.post('/test', requireUser, async (req, res) => {
  try {
    const result = await push.sendToUser(req.me.id, {
      title: 'TEN Portal',
      body: 'Notifications are working on this device.',
      url: '/notifications',
      tag: 'ten-test'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
