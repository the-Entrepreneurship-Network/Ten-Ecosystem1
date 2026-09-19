#!/usr/bin/env node
'use strict';

/**
 * Connect the LinkedIn page, in one command, on the machine that will do the
 * posting.
 *
 *     npm run linkedin:connect
 *
 * The token is typed into a hidden prompt on the server itself. That is the
 * point of this script: a LinkedIn access token is a bearer credential good
 * for about sixty days, and the two easy ways to leak one are pasting it into
 * a chat window and putting it on a command line, where it lands in shell
 * history and in the process table for every other user on the box. Neither
 * happens here. Nothing is echoed, nothing is passed as an argument, and the
 * token is written only to .env, which is already gitignored.
 *
 * The script then asks LinkedIn which pages the token administers and offers
 * them by number, because LINKEDIN_ORG_ID has to be the numeric id of a page
 * the token can actually post as — and the most common half-configured state
 * is a valid token pointed at the wrong page, or at no page at all.
 *
 * Nothing is written until both values are known and LinkedIn has confirmed
 * them, so a run that is abandoned halfway leaves .env exactly as it was.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const client = require('../services/v2/linkedin/linkedinClient');

const ENV_PATH = path.join(__dirname, '..', '.env');

const BOLD = '[1m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const DIM = '[2m';
const OFF = '[0m';
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? code + s + OFF : s);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

/**
 * Read a secret without printing it.
 *
 * `output: process.stdout` is still passed so the prompt itself is visible;
 * the `_writeToOutput` override is what swallows the characters as they are
 * typed. Without it readline echoes the token to the terminal, where it stays
 * on screen for whoever walks past and in the scrollback of whatever captured
 * the session.
 */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = function write(s) {
      if (!muted) rl.output.write(s);
    };
    rl.question(question, (a) => {
      rl.close();
      process.stdout.write('\n');
      resolve(a.trim());
    });
    muted = true;
  });
}

/**
 * Set a key in .env without disturbing anything else in it.
 *
 * Rewrites the line if the key is present, appends if it is not, and leaves
 * every other line — including comments and blanks — byte for byte as it was.
 * A .env is hand-maintained and often the only record of how a box is set up;
 * regenerating it from parsed values would quietly drop the comments that
 * explain it.
 */
function setEnv(lines, key, value) {
  const re = new RegExp(`^\\s*#?\\s*${key}\\s*=`);
  const idx = lines.findIndex((l) => re.test(l));
  const next = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = next;
    return lines;
  }
  if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
  lines.push(next);
  return lines;
}

async function main() {
  console.log(`\n${c(BOLD, 'Connect the LinkedIn page')}\n`);
  console.log(`  Writing to ${c(DIM, ENV_PATH)}`);
  console.log(`  ${c(DIM, 'Run this on the server that does the posting, not on a laptop.')}\n`);

  if (!process.stdin.isTTY) {
    console.log(c(RED, '  This needs an interactive terminal — the token is typed, never piped.\n'));
    process.exitCode = 1;
    return;
  }

  const token = await askHidden(`  Paste the access token ${c(DIM, '(hidden)')}: `);
  if (!token) {
    console.log(c(YELLOW, '\n  Nothing entered. Nothing written.\n'));
    process.exitCode = 1;
    return;
  }
  if (token.length < 40) {
    console.log(c(RED, `\n  That is ${token.length} characters — too short for a LinkedIn token.`));
    console.log('  Nothing written.\n');
    process.exitCode = 1;
    return;
  }

  /* Check the token before writing it anywhere. A token that does not work is
     not worth putting in a file, and finding out now is the whole reason this
     script exists rather than a line of documentation. */
  console.log(`\n  ${c(BOLD, 'Asking LinkedIn which pages this token administers…')}`);
  process.env.LINKEDIN_ACCESS_TOKEN = token;

  let orgs = [];
  try {
    const result = await client.probe();
    orgs = (result && result.orgs) || [];
  } catch (e) {
    console.log(c(RED, `\n  The call failed: ${e && e.message ? e.message : e}`));
    console.log('  Nothing written.\n');
    process.exitCode = 1;
    return;
  }

  if (!orgs.length) {
    process.exitCode = 1;
    console.log(c(RED, '\n  LinkedIn returned no administered pages. Nothing written.\n'));
    console.log('  In the order worth checking:\n');
    console.log(`    1. The app does not have ${c(BOLD, 'Community Management API')} approved.`);
    console.log('       Developer portal -> your app -> Products. This is usually it,');
    console.log('       and LinkedIn reviews the request by hand over several days.');
    console.log(`    2. The token lacks the ${c(BOLD, 'rw_organization_admin')} scope.`);
    console.log('    3. Whoever authorised it is not an ADMINISTRATOR of the page.');
    console.log('    4. The token has expired or been revoked.\n');
    return;
  }

  console.log(c(GREEN, `\n  The token works. It administers ${orgs.length} page${orgs.length === 1 ? '' : 's'}:\n`));
  orgs.forEach((o, i) => {
    const id = String(o.orgUrn).replace(/^urn:li:organization:/, '');
    console.log(`    ${c(BOLD, String(i + 1))}. ${c(BOLD, id)}  ${c(DIM, o.orgUrn)}`);
  });
  console.log();

  let chosen = orgs[0];
  if (orgs.length > 1) {
    const pick = await ask(`  Which page should the agent post as? ${c(DIM, `[1-${orgs.length}]`)} `);
    const n = parseInt(pick, 10);
    if (!(n >= 1 && n <= orgs.length)) {
      console.log(c(YELLOW, '\n  Not one of those. Nothing written.\n'));
      process.exitCode = 1;
      return;
    }
    chosen = orgs[n - 1];
  }
  const orgId = String(chosen.orgUrn).replace(/^urn:li:organization:/, '');

  let lines = [];
  try {
    lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
  } catch (e) {
    console.log(c(RED, `\n  Could not read .env: ${e.message}\n`));
    process.exitCode = 1;
    return;
  }

  setEnv(lines, 'LINKEDIN_ACCESS_TOKEN', token);
  setEnv(lines, 'LINKEDIN_ORG_ID', orgId);

  try {
    /* 0600: the file now holds a credential that can post as the company. */
    fs.writeFileSync(ENV_PATH, lines.join('\n'), { mode: 0o600 });
    try { fs.chmodSync(ENV_PATH, 0o600); } catch (e) { /* Windows has no mode */ }
  } catch (e) {
    console.log(c(RED, `\n  Could not write .env: ${e.message}\n`));
    process.exitCode = 1;
    return;
  }

  console.log(c(GREEN, c(BOLD, `\n  Written. Posting as ${orgId}.\n`)));
  console.log('  Restart the server, then confirm with:');
  console.log(`    ${c(BOLD, 'node scripts/linkedin-status.js --live')}\n`);
  console.log(`  ${c(DIM, 'The first post goes out about fifteen seconds after start-up.')}\n`);
}

/*
 * Only prompt when this file is the thing being run.
 *
 * setEnv is the part that can quietly destroy a server's configuration, so it
 * has to be reachable from a test — and a script that starts prompting the
 * moment it is required cannot be. Exporting it is the plain way to do that;
 * the alternative, reading this file as text and evaluating a slice of it, is
 * how a test ends up being a code-execution primitive.
 */
if (require.main === module) {
  main().catch((e) => {
    console.error(`\n${c(RED, 'linkedin-connect failed:')} ${e && e.message ? e.message : e}\n`);
    process.exitCode = 1;
  });
}

module.exports = { setEnv };
