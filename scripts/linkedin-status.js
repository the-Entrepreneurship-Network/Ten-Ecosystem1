#!/usr/bin/env node
'use strict';

/**
 * Answer one question: will the LinkedIn agent actually post, or is it writing
 * posts to the database and throwing them away?
 *
 *     node scripts/linkedin-status.js
 *
 * This exists because the answer used to be invisible. With no credentials the
 * agent does exactly what it does with them — builds the post, renders the
 * poster, saves the row, logs "queued Python Development" — and then does not
 * send it. Every log line looks like success. The only place the difference
 * showed was a small badge in the dashboard, which is not where anyone looks
 * when they are wondering why the company page is empty.
 *
 * Exits 0 when the agent is live, 1 when it is not, so it can be a deploy
 * check rather than something somebody has to remember to run.
 */

require('dotenv').config();

const client = require('../services/v2/linkedin/linkedinClient');

const BOLD = '[1m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const DIM = '[2m';
const OFF = '[0m';

/* Only colour a real terminal — a redirected log full of escape codes is
   worse than a plain one. */
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? code + s + OFF : s);

function has(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '';
}

function line(label, ok, detail) {
  const mark = ok ? c(GREEN, 'yes') : c(RED, 'NO ');
  console.log(`  ${mark}  ${label}${detail ? c(DIM, `  ${detail}`) : ''}`);
}

async function main() {
  console.log(`\n${c(BOLD, 'LinkedIn agent — will it post?')}\n`);

  let cfg = {};
  try {
    cfg = client.config() || {};
  } catch (e) {
    console.log(c(RED, `  Could not read the configuration: ${e.message}`));
    process.exitCode = 1;
    return;
  }

  console.log(c(BOLD, 'Credentials'));
  const envToken = has('LINKEDIN_ACCESS_TOKEN');
  const orgId = has('LINKEDIN_ORG_ID');
  line('LINKEDIN_ACCESS_TOKEN', envToken, envToken ? '' : 'not set');
  line('LINKEDIN_ORG_ID', orgId, orgId ? process.env.LINKEDIN_ORG_ID : 'not set — the page to post as');
  console.log();

  console.log(c(BOLD, 'Or, the OAuth route'));
  const cid = has('LINKEDIN_CLIENT_ID');
  const secret = has('LINKEDIN_CLIENT_SECRET');
  const redirect = has('LINKEDIN_REDIRECT_URI');
  line('LINKEDIN_CLIENT_ID', cid, cid ? '' : 'not set');
  line('LINKEDIN_CLIENT_SECRET', secret, secret ? c(DIM, 'set') : 'not set');
  line('LINKEDIN_REDIRECT_URI', redirect, redirect ? process.env.LINKEDIN_REDIRECT_URI : 'not set');
  line('a page connected through OAuth', cfg.source === 'db', cfg.source === 'db' ? cfg.orgName || '' : 'nobody has completed /api/v2/linkedin/oauth/start');
  console.log();

  console.log(c(BOLD, 'Switches'));
  line('autopilot enabled', !has('LINKEDIN_AUTOPILOT_DISABLED'), has('LINKEDIN_AUTOPILOT_DISABLED') ? 'LINKEDIN_AUTOPILOT_DISABLED is set' : '');
  line('publisher enabled', !has('LINKEDIN_SCHEDULER_DISABLED'), has('LINKEDIN_SCHEDULER_DISABLED') ? 'LINKEDIN_SCHEDULER_DISABLED is set' : '');
  console.log();

  /* The verdict is taken from the client rather than recomputed here, so this
     script cannot drift from what publish() will actually decide. */
  if (cfg.configured) {
    console.log(c(GREEN, c(BOLD, '  LIVE — posts will reach the company page.')));
    console.log(`  Posting as ${cfg.orgName || cfg.orgUrn} ${c(DIM, `(${cfg.source})`)}`);
    if (cfg.warning) console.log(c(YELLOW, `  ${cfg.warning}`));
    console.log();
    return;
  }

  process.exitCode = 1;
  console.log(c(RED, c(BOLD, '  DRY RUN — the agent is building posts and NOT sending them.')));
  console.log(`  ${c(DIM, 'Every post is saved to the database and shown in the dashboard')}`);
  console.log(`  ${c(DIM, 'badged "Not on LinkedIn yet". Nothing reaches the company page.')}\n`);

  console.log(c(BOLD, '  To make it live, either:'));
  console.log(`  ${c(BOLD, 'A.')} Put a token straight in the environment — fastest:`);
  console.log(`       ${c(DIM, 'LINKEDIN_ACCESS_TOKEN=...')}`);
  console.log(`       ${c(DIM, 'LINKEDIN_ORG_ID=...        the numeric id of the company page')}`);
  console.log(`     then restart. Nothing else is needed.\n`);
  console.log(`  ${c(BOLD, 'B.')} Set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and`);
  console.log(`     LINKEDIN_REDIRECT_URI, then have an HR or admin account open`);
  console.log(`     ${c(DIM, '/api/v2/linkedin/oauth/start')} and grant access.\n`);
  console.log(`  ${c(YELLOW, 'Either way')}, the LinkedIn app needs the ${c(BOLD, 'Community Management API')}`);
  console.log(`  product approved, the ${c(BOLD, 'w_organization_social')} scope, and whoever`);
  console.log(`  authorises it must be an ADMINISTRATOR of the page. LinkedIn`);
  console.log(`  reviews that product request — it is not instant.\n`);
}

main().catch((e) => {
  console.error(`\n${c(RED, 'linkedin-status failed:')} ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
});
