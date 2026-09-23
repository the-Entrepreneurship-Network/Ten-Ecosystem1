'use strict';

/**
 * Sending a campaign.
 *
 * Runs in the background, not inside the HTTP request: 1,470 recipients at the
 * throttle below is roughly an hour, and no browser waits that long. The
 * dashboard polls the campaign document, which is updated as the loop goes, so
 * progress survives a page refresh — and a server restart mid-send leaves an
 * honest record of how far it got rather than a campaign stuck at "sending"
 * with no numbers.
 *
 * The quota is re-checked before EVERY message, not once at the start. The
 * Monday cron and a hand-sent campaign can overlap, and the check that ran
 * five minutes ago does not know about the mail the other one has sent since.
 */

const {
    createEmailTransporter, renderEmail, escapeHtml, isSendableAddress, EMAIL_FROM
} = require('../utils/mailer');
const MailHistory = require('../models/MailHistory');
const GrowthCampaign = require('../models/GrowthCampaign');
const quota = require('./growthQuota');
const segments = require('./growthSegments');
const tracking = require('./growthTracking');
const { greetingNameFor } = require('../utils/studentName');

/** Milliseconds between messages. Matches the existing weekly mailer. */
const THROTTLE_MS = parseInt(process.env.GROWTH_SEND_THROTTLE_MS, 10) || 2000;

let transporter = null;
function getTransporter() {
    // Built on first use: this module is required at boot, before .env is
    // guaranteed to have been read by everything that needs it.
    if (!transporter) transporter = createEmailTransporter({ pool: true });
    return transporter;
}

/*
 * Who to greet.
 *
 * This used to fall back to the literal word "Intern" for anyone without a
 * name on record. `greetingNameFor` does better where it honestly can —
 * "anita.rao@" becomes "Anita Rao" — and returns '' where it cannot, so the
 * mail opens on its first sentence instead of on a mangled mailbox name.
 * renderEmail already omits the whole "Dear …" line for an empty name.
 */
const nameOf = greetingNameFor;

/** For MailHistory, where a blank recipient name is just an unhelpful row. */
const logNameOf = (s) => greetingNameFor(s) || String(s.email || '').split('@')[0] || '';

/**
 * The HTML for one recipient.
 *
 * Every link is per-person, so a click can be attributed to a student and the
 * unsubscribe can only ever remove the person who clicked it.
 */
function buildHtml(campaign, student) {
    const cid = String(campaign._id);
    const uid = String(student._id);
    const paragraphs = String(campaign.bodyText || '')
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');

    const html = renderEmail({
        heading: campaign.heading || campaign.subject,
        name: nameOf(student),
        bodyHtml: paragraphs,
        cta: campaign.ctaUrl ? { label: campaign.ctaLabel || 'Open my portal', url: tracking.clickUrl(cid, uid) } : null,
        // `note` is the one slot renderEmail does not escape, so the
        // unsubscribe link can be a real link without touching the shell.
        note: `Not interested in these? <a href="${tracking.unsubscribeUrl(uid)}" style="color:#cdb24a;">Unsubscribe</a> — you will still receive your certificates and offer letters.`,
        footerWhy: 'You are receiving this because you registered for a TEN internship.'
    });

    return html.replace('</body>',
        `<img src="${tracking.openUrl(cid, uid)}" width="1" height="1" alt="" style="display:none">\n</body>`);
}

/** Send one message and record it. Returns 'sent' | 'failed'. */
async function sendOne(campaign, student) {
    let status = 'sent';
    let error = '';
    try {
        await getTransporter().sendMail({
            from: EMAIL_FROM,
            to: student.email,
            subject: campaign.subject,
            html: buildHtml(campaign, student)
        });
    } catch (err) {
        status = 'failed';
        error = (err && err.message) ? String(err.message).slice(0, 400) : 'unknown error';
    }
    try {
        await MailHistory.create({
            recipientEmail: student.email,
            recipientName: logNameOf(student),
            studentId: student._id,
            subject: campaign.subject,
            // This is what makes the send count against the marketing quota.
            mailType: 'campaign',
            sentAt: new Date(),
            status,
            errorMessage: error
        });
    } catch (_) { /* the mail went out; a missing log row must not stop the run */ }
    return status;
}

/**
 * Run a campaign to completion. Not awaited by the route that starts it.
 */
async function run(campaignId) {
    const campaign = await GrowthCampaign.findById(campaignId);
    if (!campaign || campaign.status !== 'draft') return;

    let recipients;
    try {
        recipients = await segments.recipientsForCampaign(campaign);
    } catch (err) {
        await GrowthCampaign.findByIdAndUpdate(campaignId, {
            status: 'failed', error: `Segment failed: ${err.message}`
        });
        return;
    }

    await GrowthCampaign.findByIdAndUpdate(campaignId, {
        status: 'sending',
        startedAt: new Date(),
        recipientCount: recipients.length,
        sentCount: 0, failedCount: 0, skippedCount: 0
    });

    let sent = 0, failed = 0, skipped = 0;

    for (let i = 0; i < recipients.length; i++) {
        const student = recipients[i];

        // Someone may have unsubscribed after the segment was resolved, and a
        // long run gives them time to. Cheapest possible re-check.
        if (!isSendableAddress(student.email)) { skipped++; continue; }

        const { allowed } = await quota.canSend(1);
        if (!allowed) {
            // Everyone left is skipped, not lost: the count below is what the
            // dashboard shows as "N not sent — quota exhausted".
            skipped += recipients.length - i;
            break;
        }

        const result = await sendOne(campaign, student);
        if (result === 'sent') sent++; else failed++;

        // Write progress every 25 so the dashboard moves without one update
        // per message.
        if (i % 25 === 0) {
            await GrowthCampaign.findByIdAndUpdate(campaignId, { sentCount: sent, failedCount: failed, skippedCount: skipped });
        }
        if (i < recipients.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    await GrowthCampaign.findByIdAndUpdate(campaignId, {
        status: 'sent', sentAt: new Date(),
        sentCount: sent, failedCount: failed, skippedCount: skipped
    });
}

module.exports = { run, buildHtml, sendOne, THROTTLE_MS };
