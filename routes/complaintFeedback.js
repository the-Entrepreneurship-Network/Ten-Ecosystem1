/**
 * The answer to "Did our reply answer your question?" at the foot of the
 * complaints@ auto-reply. Its two links open /complaint-feedback, and that
 * page posts the answer here.
 *
 * Recorded by the page, never by the link: mail security scanners fetch every
 * link in a message and would vote both ways on every reply.
 * ponytail: scanners that also run scripts can still count; tie answers to a
 *           person (and drop them) only if the portal ever sends the reply itself.
 *
 * The WhatsApp group link is handed out only with a "no", so it is in neither
 * the email nor the page, and it lives in the server's .env, not in this
 * public repository.
 */
const express = require('express');
const ComplaintFeedback = require('../models/ComplaintFeedback');
const { requireHR } = require('../middleware/sessionAuth');
const { COMPLAINTS_EMAIL } = require('../utils/mailer');

const router = express.Router();
const SUMMARY_DAYS = 30;

router.post('/', async (req, res) => {
  const answer = req.body && req.body.answer;
  if (answer !== 'yes' && answer !== 'no') {
    return res.status(400).json({ success: false, message: 'Answer yes or no.' });
  }
  try {
    await ComplaintFeedback.create({ answer });
  } catch (err) {
    // Getting an unhappy person to a human matters more than the count.
    console.error('[complaint-feedback] answer not saved:', err.message);
  }
  const whatsapp = answer === 'no' ? (process.env.COMPLAINTS_WHATSAPP_URL || '').trim() || null : null;
  res.json({ success: true, whatsapp, email: COMPLAINTS_EMAIL });
});

router.get('/summary', requireHR, async (req, res) => {
  const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 60 * 60 * 1000);
  try {
    const [yes, no] = await Promise.all(['yes', 'no'].map((answer) =>
      ComplaintFeedback.countDocuments({ answer, createdAt: { $gte: since } })));
    res.json({ success: true, days: SUMMARY_DAYS, yes, no });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not count the answers.' });
  }
});

module.exports = router;
