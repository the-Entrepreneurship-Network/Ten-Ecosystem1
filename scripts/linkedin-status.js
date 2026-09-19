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
 *
 *     node scripts/linkedin-status.js --live
 *
 * With --live it goes further and asks LinkedIn. Having the variables set is
 * not the same as having them work: a token can be expired, revoked, issued
 * for the wrong app, or held by somebody who is not an administrator of the
 * page, and every one of those looks identical from inside this process until
 * the first post fails at two in the morning. The live check spends one API
 * call to find out now, and prints the numeric id of every page the token can
 * actually post as — which is the value LINKEDIN_ORG_ID has to be set to.
 *
 * Neither mode prints the token, and neither writes anything.
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

  const wantsLive = process.argv.indexOf('--live') >= 0;

  /* The verdict is taken from the client rather than recomputed here, so this
     script cannot drift from what publish() will actually decide. */
  if (cfg.configured) {
    console.log(c(GREEN, c(BOLD, '  CONFIGURED — posts will be sent to the company page.')));
    console.log(`  Posting as ${cfg.orgName || cfg.orgUrn} ${c(DIM, `(${cfg.source})`)}`);
    if (cfg.warning) console.log(c(YELLOW, `  ${cfg.warning}`));
    console.log();
    if (wantsLive) await liveCheck(cfg);
    else console.log(`  ${c(DIM, 'Add --live to ask LinkedIn whether the token really works.')}\n`);
    return;
  }

  if (wantsLive && envToken) {
    /* A token with no LINKEDIN_ORG_ID is the most common half-configured
       state, and it is also the one the live check can fix outright: the
       answer names the ids to choose from. */
    await liveCheck(cfg);
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

/**
 * Ask LinkedIn whether the token works, and which pages it may post as.
 *
 * `organizationAcls?q=roleAssignee&role=ADMINISTRATOR` is the right question
 * because it is the same thing LinkedIn checks when a post is created: not
 * "is this token valid" but "does whoever holds it administer this page".
 * A perfectly valid token belonging to somebody who was removed as an admin
 * fails at post time and nowhere earlier.
 *
 * Prints ids, never the token.
 */
async function liveCheck(cfg) {
  console.log(c(BOLD, '  Asking LinkedIn…'));

  let result;
  try {
    result = await client.probe();
  } catch (e) {
    console.log(c(RED, `  The call failed: ${e && e.message ? e.message : e}\n`));
    process.exitCode = 1;
    return;
  }

  if (!result.ok) {
    process.exitCode = 1;
    console.log(c(YELLOW, `  Nothing to check — ${result.reason}.\n`));
    return;
  }
  const orgs = result.orgs || [];

  if (!orgs.length) {
    process.exitCode = 1;
    console.log(c(RED, '  LinkedIn returned no administered pages.\n'));
    console.log('  That is one of four things, in the order worth checking:\n');
    console.log(`    1. The app does not have ${c(BOLD, 'Community Management API')} approved.`);
    console.log('       Developer portal -> your app -> Products. This is the usual one,');
    console.log('       and LinkedIn reviews the request by hand.');
    console.log(`    2. The token is missing the ${c(BOLD, 'rw_organization_admin')} scope.`);
    console.log('    3. Whoever authorised it is not an ADMINISTRATOR of the page.');
    console.log('    4. The token has expired or been revoked.\n');
    return;
  }

  console.log(c(GREEN, `  The token works. It administers ${orgs.length} page${orgs.length === 1 ? '' : 's'}:\n`));
  orgs.forEach((o) => {
    const id = String(o.orgUrn).replace(/^urn:li:organization:/, '');
    const current = cfg.orgUrn && cfg.orgUrn === o.orgUrn;
    console.log(`    ${c(BOLD, id)}  ${c(DIM, o.orgUrn)}${current ? c(GREEN, '   <- currently selected') : ''}`);
  });
  console.log();

  if (!cfg.orgUrn) {
    console.log(`  ${c(YELLOW, 'Set LINKEDIN_ORG_ID to one of the ids above and restart.')}\n`);
    process.exitCode = 1;
  } else if (!orgs.some((o) => o.orgUrn === cfg.orgUrn)) {
    process.exitCode = 1;
    console.log(c(RED, `  LINKEDIN_ORG_ID is ${cfg.orgUrn}, which is not in that list.`));
    console.log('  Posts will be rejected. Use one of the ids above.\n');
  } else {
    console.log(c(GREEN, c(BOLD, '  LIVE — the next post will reach the page.\n')));
  }
}

main().catch((e) => {
  console.error(`\n${c(RED, 'linkedin-status failed:')} ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
});
