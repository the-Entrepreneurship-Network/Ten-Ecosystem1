#!/usr/bin/env node
'use strict';

/**
 * Turn a username → cleartext-password map into the bcrypt-hashed JSON that
 * HR_CREDENTIALS / COORDINATOR_CREDENTIALS expect.
 *
 * The output contains only one-way hashes, so it is safe to paste into a
 * deployment dashboard, a secrets manager, or a .env file on the server. The
 * cleartext passwords never leave the machine you run this on.
 *
 * Usage — interactive-ish, from a file you delete afterwards:
 *
 *   1. Write a temporary JSON file, e.g. /tmp/hr.json:
 *        {
 *          "jrhr@ten.com":       "TEN@JrHR2026",
 *          "hrdirector@ten.com": "TEN@HRDir2026"
 *        }
 *
 *   2. node scripts/generate-credentials-env.js --in /tmp/hr.json --var HR_CREDENTIALS
 *
 *   3. Copy the printed line into your production environment, then
 *        shred -u /tmp/hr.json    (or: rm /tmp/hr.json)
 *
 * Options:
 *   --in <file>     JSON file of { "username": "cleartext-password", ... }
 *                   Values may also be objects: { "password": "...", ...meta }
 *   --var <NAME>    Env var name to print (default HR_CREDENTIALS)
 *   --rounds <n>    bcrypt cost (default 12)
 *   --json-only     Print just the JSON, without the VAR= prefix
 */

const fs = require('fs');
const bcrypt = require('bcryptjs');

function parseArgs(argv) {
  const args = { in: null, var: 'HR_CREDENTIALS', rounds: 12, jsonOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--var') args.var = argv[++i];
    else if (a === '--rounds') args.rounds = parseInt(argv[++i], 10);
    else if (a === '--json-only') args.jsonOnly = true;
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { console.error(`Unknown argument: ${a}`); printUsage(); process.exit(1); }
  }
  return args;
}

function printUsage() {
  console.log(fs.readFileSync(__filename, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(' *') || l.startsWith('/**'))
    .map((l) => l.replace(/^\s*\/?\*+\/?/, ''))
    .join('\n'));
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.in) {
    console.error('Error: --in <file> is required.\n');
    printUsage();
    process.exit(1);
  }
  if (!Number.isInteger(args.rounds) || args.rounds < 10 || args.rounds > 15) {
    console.error('Error: --rounds must be an integer between 10 and 15.');
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(args.in, 'utf8'));
  } catch (err) {
    console.error(`Error: could not read ${args.in}: ${err.message}`);
    process.exit(1);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    console.error('Error: input must be a JSON object keyed by username.');
    process.exit(1);
  }

  const out = {};
  const weak = [];

  for (const [username, value] of Object.entries(input)) {
    const isObject = value && typeof value === 'object';
    const cleartext = isObject ? value.password : value;

    if (typeof cleartext !== 'string' || !cleartext) {
      console.error(`Error: ${username} has no password string.`);
      process.exit(1);
    }
    if (cleartext.length < 12) weak.push(username);

    const meta = isObject ? { ...value } : {};
    delete meta.password;
    delete meta.passwordHash;

    out[username] = { ...meta, passwordHash: bcrypt.hashSync(cleartext, args.rounds) };
  }

  const json = JSON.stringify(out);
  console.log(args.jsonOnly ? json : `${args.var}=${json}`);

  if (weak.length) {
    console.error(
      `\n[warning] ${weak.length} password(s) are under 12 characters: ${weak.join(', ')}\n` +
      '          Short, patterned passwords are guessable. Consider rotating them.'
    );
  }
  console.error(
    `\n[reminder] Delete ${args.in} now — it holds the cleartext passwords.\n` +
    '           The line printed above contains only one-way hashes.'
  );
}

main();
