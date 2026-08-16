'use strict';

/**
 * Sending job applications through Instantly.ai.
 *
 * The agent already writes the cold email. This is what puts it in front of a
 * human: a campaign per student, one lead per company they are applying to,
 * and the personalised text carried as a lead variable so each recipient gets
 * the letter written for their posting rather than a mail merge.
 *
 * Talks to the REST API directly rather than shelling out to instantly-cli.
 * The CLI is installed and is the right tool at a terminal, but spawning a
 * process per request to parse its stdout would be slower, harder to error
 * check, and would put the API key on a command line where it can be read out
 * of the process list.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO
 *
 * It does not activate a campaign by default. Creating one is reversible;
 * sending cold email to a real company is not, and an agent that mails
 * strangers the moment a button is clicked is how a domain gets a spam
 * reputation it cannot undo. Sending is a separate, explicit call.
 */

const INSTANTLY_API = 'https://api.instantly.ai/api/v2';

/** Every request carries the workspace key; without it nothing is possible. */
function apiKey() {
  return process.env.INSTANTLY_API_KEY || '';
}

function configured() {
  return Boolean(apiKey());
}

async function call(path, options) {
  const opts = options || {};
  const res = await fetch(`${INSTANTLY_API}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json'
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 15000)
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }

  if (!res.ok) {
    /* The provider's own message is far more useful than a generic failure —
       "no sending account" and "invalid key" need different fixes. */
    const message = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(String(message).slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * The mailboxes Instantly can send from.
 *
 * Checked before anything else is attempted: a workspace with no connected
 * account accepts campaigns and leads perfectly happily and then sends
 * nothing, which looks like a silent failure rather than the setup step it is.
 */
async function sendingAccounts() {
  const data = await call('/accounts');
  return (data.items || []).map((a) => ({
    email: a.email,
    status: a.status,
    warmup: a.warmup_status
  }));
}

/** Rejects the obvious non-addresses before they reach the provider. */
function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

/**
 * A campaign holding one student's applications.
 *
 * The sequence body is a single variable. Instantly substitutes it per lead,
 * which is what lets one campaign carry a differently-written letter for every
 * company instead of the same template with a name swapped in.
 */
async function createCampaign({ name, senderEmails, dailyLimit }) {
  if (!Array.isArray(senderEmails) || !senderEmails.length) {
    throw new Error('No sending mailbox is connected to the Instantly workspace.');
  }

  const sequences = [{
    steps: [{
      type: 'email',
      delay: 0,
      variants: [{
        subject: '{{applicationSubject}}',
        body: '{{applicationBody}}'
      }]
    }]
  }];

  const campaign = await call('/campaigns', {
    method: 'POST',
    body: {
      name,
      email_list: senderEmails,
      sequences,
      /* A job application is a personal letter. Tracking pixels and rewritten
         links make it look like marketing, which is what spam filters and
         recruiters both punish. */
      text_only: true,
      open_tracking: false,
      link_tracking: false,
      stop_on_reply: true,
      stop_on_auto_reply: true,
      /* Deliberately low. This is one person applying for jobs, not a sales
         blast, and a new mailbox sending hundreds a day gets burned. */
      daily_limit: dailyLimit || 20
    }
  });

  return { id: campaign.id, name: campaign.name, status: campaign.status };
}

/**
 * Add one company to a campaign, carrying the letter written for that posting.
 */
async function addRecipient({ campaignId, email, firstName, companyName, website, subject, body, jobTitle, jobUrl }) {
  if (!isEmail(email)) throw new Error('That does not look like an email address.');
  if (!subject || !body) throw new Error('The email needs a subject and a body.');

  const lead = await call('/leads', {
    method: 'POST',
    body: {
      campaign: campaignId,
      email: String(email).trim(),
      first_name: firstName || '',
      company_name: companyName || '',
      website: website || '',
      custom_variables: {
        applicationSubject: subject,
        applicationBody: body,
        /* Kept so a reply can be traced back to the posting it came from. */
        jobTitle: jobTitle || '',
        jobUrl: jobUrl || ''
      }
    }
  });

  return { id: lead.id, email: lead.email, campaignId };
}

/**
 * Start sending.
 *
 * Separate from creation on purpose — see the note at the top of this file.
 * Everything above is a draft nobody has received; this is the step that puts
 * mail in a stranger's inbox.
 */
async function activateCampaign(campaignId) {
  await call(`/campaigns/${encodeURIComponent(campaignId)}/activate`, { method: 'POST' });
  return { campaignId, status: 'active' };
}

/** What happened to what was sent. */
async function campaignStatus(campaignId) {
  const campaign = await call(`/campaigns/${encodeURIComponent(campaignId)}`);
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status
  };
}

module.exports = {
  configured,
  sendingAccounts,
  createCampaign,
  addRecipient,
  activateCampaign,
  campaignStatus,
  isEmail,
  INSTANTLY_API
};
