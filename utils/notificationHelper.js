'use strict';

const EcosystemNotification = require('../models/EcosystemNotification');

async function createNotification({ userId, type, title, message, data, link }) {
  try {
    const notif = await EcosystemNotification.create({
      userId, type, title, message, data, link
    });
    return notif;
  } catch (err) {
    console.error('[createNotification] Failed:', err.message);
  }
}

module.exports = { createNotification };
