'use strict';

const express = require('express');
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
} = require('../controllers/notificationController');
const { requireRole } = require('../middleware/roleGuard');
const { ALL_ROLES }   = require('../config/roles');

const router = express.Router();

router.get('/',                requireRole(...ALL_ROLES), getMyNotifications);
router.patch('/read-all',      requireRole(...ALL_ROLES), markAllAsRead);
router.patch('/:id/read',      requireRole(...ALL_ROLES), markAsRead);
router.delete('/:id',          requireRole(...ALL_ROLES), deleteNotification);

module.exports = router;
