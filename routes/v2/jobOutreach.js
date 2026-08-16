'use strict';

/**
 * @fileoverview Sending the agent's job applications to real companies.
 *
 * The split across these routes is the important part. Preparing an
 * application is reversible and cheap, so it happens freely. Sending one is
 * neither — a cold email to a company cannot be recalled, and a burst of them
 * from a new domain costs a sending reputation that takes months to rebuild.
 *
 *   GET  /status            what is configured, what can actually send
 *   POST /prepare           draft: campaign + recipient, nothing delivered
 *   POST /send              the irreversible step, on its own
 *
 * So /prepare never sends, and /send does nothing except start something that
 * was already reviewed. A caller cannot do the second by accident while
 * meaning the first.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const outreach = require('../../services/v2/instantlyOutreach');
const { requireRole } = require('../../middleware/roleGuard');
const { ALL_ROLES } = require('../../config/roles');

const router = express.Router();

/*
 * Tight on purpose. This endpoint spends someone's sending reputation, so the
 * ceiling is what a person job-hunting plausibly needs in an hour, not what
 * the API would tolerate.
 */
const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many outreach requests this hour. Try again later.' }
});

/**
 * GET /api/v2/job-outreach/status
 * Whether sending is possible, and if not, precisely what is missing.
 */
router.get('/status', requireRole(...ALL_ROLES), async (req, res) => {
  if (!outreach.configured()) {
    return res.json({
      ok: true,
      configured: false,
      canSend: false,
      reason: 'INSTANTLY_API_KEY is not set on the server.'
    });
  }

  try {
    const accounts = await outreach.sendingAccounts();
    return res.json({
      ok: true,
      configured: true,
      canSend: accounts.length > 0,
      accounts: accounts.map((a) => a.email),
      /* Named rather than implied: a workspace with no mailbox accepts
         everything and delivers nothing, which reads as a silent bug. */
      reason: accounts.length
        ? null
        : 'No mailbox is connected to the Instantly workspace. Connect one with `instantly oauth` before sending.'
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v2/job-outreach/prepare
 * Draft an application to one company. Nothing is delivered here.
 */
router.post('/prepare', requireRole(...ALL_ROLES), sendLimiter, async (req, res) => {
  const b = req.body || {};

  if (!outreach.configured()) {
    return res.status(503).json({ ok: false, error: 'Email sending is not configured on this server.' });
  }
  if (!outreach.isEmail(b.to)) {
    return res.status(400).json({ ok: false, error: 'Enter the recipient email address.' });
  }
  if (!b.subject || !b.body) {
    return res.status(400).json({ ok: false, error: 'The email needs a subject and a body.' });
  }

  try {
    const accounts = await outreach.sendingAccounts();
    if (!accounts.length) {
      return res.status(409).json({
        ok: false,
        error: 'No mailbox is connected to the Instantly workspace, so nothing could be sent. ' +
          'Connect one with `instantly oauth` first.'
      });
    }

    let campaignId = b.campaignId;
    if (!campaignId) {
      /* One campaign per applicant keeps replies, stats and stop-on-reply
         scoped to that person rather than mixed across every student. */
      const campaign = await outreach.createCampaign({
        name: `TEN job applications — ${b.applicantName || req.user._id}`,
        senderEmails: accounts.filter((a) => a.status !== 'paused').map((a) => a.email),
        dailyLimit: 20
      });
      campaignId = campaign.id;
    }

    const lead = await outreach.addRecipient({
      campaignId,
      email: b.to,
      firstName: b.hiringManager || '',
      companyName: b.company || '',
      website: b.website || '',
      subject: b.subject,
      body: b.body,
      jobTitle: b.jobTitle || '',
      jobUrl: b.jobUrl || ''
    });

    return res.status(201).json({
      ok: true,
      prepared: true,
      sent: false,
      campaignId,
      leadId: lead.id,
      to: lead.email,
      note: 'Drafted, not sent. Review it, then send explicitly.'
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v2/job-outreach/send
 * Start the campaign. This is the step that reaches a real inbox.
 */
router.post('/send', requireRole(...ALL_ROLES), sendLimiter, async (req, res) => {
  const b = req.body || {};
  if (!b.campaignId) {
    return res.status(400).json({ ok: false, error: 'campaignId is required.' });
  }
  /* An explicit acknowledgement, so a mistyped call to /prepare can never
     fall through into delivering mail. */
  if (b.confirm !== true && b.confirm !== 'true') {
    return res.status(400).json({
      ok: false,
      error: 'Sending needs confirm:true — this delivers real email to real people.'
    });
  }

  try {
    const result = await outreach.activateCampaign(b.campaignId);
    return res.json({ ok: true, sent: true, ...result });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
