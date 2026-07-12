'use strict';

const EcosystemNotification = require('../models/EcosystemNotification');

async function getMyNotifications(req, res) {
  try {
    const userId  = req.user._id || req.user.id;
    const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit   = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const skip    = (page - 1) * limit;
    const filter  = { userId };
    if (req.query.unreadOnly === 'true') filter.isRead = false;
    if (req.query.type) filter.type = req.query.type;

    const [data, total, unreadCount] = await Promise.all([
      EcosystemNotification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EcosystemNotification.countDocuments(filter),
      EcosystemNotification.countDocuments({ userId, isRead: false })
    ]);

    return res.status(200).json({ success: true, data, unreadCount, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[notificationController.getMyNotifications]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch notifications.' });
  }
}

async function markAsRead(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const notif  = await EcosystemNotification.findOne({ _id: req.params.id, userId });
    if (!notif) return res.status(404).json({ success: false, error: 'Notification not found.' });
    notif.isRead = true;
    notif.readAt = new Date();
    await notif.save();
    return res.status(200).json({ success: true, data: notif });
  } catch (err) {
    console.error('[notificationController.markAsRead]', err.message);
    return res.status(500).json({ success: false, error: 'Could not update notification.' });
  }
}

async function markAllAsRead(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const result = await EcosystemNotification.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return res.status(200).json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error('[notificationController.markAllAsRead]', err.message);
    return res.status(500).json({ success: false, error: 'Could not update notifications.' });
  }
}

async function deleteNotification(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const result = await EcosystemNotification.findOneAndDelete({ _id: req.params.id, userId });
    if (!result) return res.status(404).json({ success: false, error: 'Notification not found.' });
    return res.status(200).json({ success: true, message: 'Notification deleted.' });
  } catch (err) {
    console.error('[notificationController.deleteNotification]', err.message);
    return res.status(500).json({ success: false, error: 'Could not delete notification.' });
  }
}

module.exports = { getMyNotifications, markAsRead, markAllAsRead, deleteNotification };
