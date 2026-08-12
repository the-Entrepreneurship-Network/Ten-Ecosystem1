#!/usr/bin/env node
"use strict";

/**
 * Diagnose why /ten-admin/login says "Access denied. Check your credentials."
 *
 * Admin login has exactly two inputs — ADMIN_USERNAME and ADMIN_PASSWORD_HASH —
 * and half a dozen ways they can be wrong that all surface as the same message,
 * on purpose (the login endpoint must never reveal which factor failed). That
 * is correct for the internet and useless for the person running the server, so
 * this script says plainly which one it is.
 *
 * Usage, from the app directory on the server:
 *
 *   node scripts/check-admin-login.js
 *   node scripts/check-admin-login.js 'the-password-you-are-typing'
 *
 * The password argument is optional. It is compared in memory and never
 * logged, stored, or echoed. The hash is never printed in full.
 */

const fs   = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");

// dotenv v17 reads .env.local BEFORE .env and does NOT overwrite a value it has
// already set. A stale .env.local therefore silently wins over the .env someone
// just edited — with no warning anywhere.
const ENV_FILES = [".env.local", ".env"];

function ok(msg)   { console.log("  \x1b[32m✓\x1b[0m " + msg); }
function bad(msg)  { console.log("  \x1b[31m✗\x1b[0m " + msg); }
function warn(msg) { console.log("  \x1b[33m!\x1b[0m " + msg); }
function head(msg) { console.log("\n\x1b[1m" + msg + "\x1b[0m"); }

/** Show enough of a hash to identify it, never enough to use it. */
function fingerprint(value) {
    if (!value) return "(empty)";
    return `${value.slice(0, 7)}…${value.slice(-4)}  (${value.length} chars)`;
}

/** Read a key straight from a file, bypassing dotenv, to see the raw bytes. */
function rawValueFrom(file, key) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch (_) { return null; }
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        if (trimmed.slice(0, eq).trim() !== key) continue;
        return trimmed.slice(eq + 1);
    }
    return null;
}

const problems = [];

head("1. Which env files exist");
const present = [];
for (const name of ENV_FILES) {
    const full = path.join(APP_ROOT, name);
    if (fs.existsSync(full)) { present.push(name); ok(`${name} found`); }
    else                     { console.log(`    ${name} not present`); }
}
if (!present.length) {
    bad("No .env file at all. The app has nothing to read.");
    problems.push("Create a .env in " + APP_ROOT);
}
if (present.includes(".env.local") && present.includes(".env")) {
    warn(".env.local exists AND .env exists.");
    warn("dotenv reads .env.local FIRST and will not overwrite what it sets.");
    warn("If ADMIN_PASSWORD_HASH is in both, the .env.local one wins.");
}

head("2. What each file actually contains");
let winningFile = null;
for (const name of present) {
    const full = path.join(APP_ROOT, name);
    const user = rawValueFrom(full, "ADMIN_USERNAME");
    const hash = rawValueFrom(full, "ADMIN_PASSWORD_HASH");
    console.log(`  ${name}:`);
    console.log(`    ADMIN_USERNAME      = ${user === null ? "(not set)" : JSON.stringify(user)}`);
    console.log(`    ADMIN_PASSWORD_HASH = ${hash === null ? "(not set)" : fingerprint(hash)}`);
    if (hash !== null && !winningFile) winningFile = name;

    if (hash !== null) {
        if (/^["']|["']$/.test(hash)) {
            bad(`    The hash in ${name} is wrapped in quotes — remove them.`);
            problems.push(`Remove the surrounding quotes from ADMIN_PASSWORD_HASH in ${name}`);
        }
        if (/\s$/.test(hash)) {
            bad(`    The hash in ${name} has trailing whitespace.`);
            problems.push(`Strip trailing spaces after ADMIN_PASSWORD_HASH in ${name}`);
        }
        if (hash.includes("$$") || /^\$\d*\$?$/.test(hash)) {
            bad(`    The hash in ${name} looks mangled by the shell.`);
            bad(`    Writing it with  echo "...=$2b$12$..." >> .env  expands $2b and $12 to nothing.`);
            problems.push(`Rewrite ADMIN_PASSWORD_HASH in ${name} using single quotes, or edit the file with nano`);
        }
    }
}
if (winningFile && present.length > 1) {
    ok(`The value the app will use comes from: ${winningFile}`);
}

head("3. What the app sees after loading dotenv");
require("dotenv").config();
const ADMIN_USERNAME      = (process.env.ADMIN_USERNAME || "tenadmin").trim().toLowerCase();
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || "").trim();

console.log(`  ADMIN_USERNAME      = ${JSON.stringify(ADMIN_USERNAME)}`);
console.log(`  ADMIN_PASSWORD_HASH = ${fingerprint(ADMIN_PASSWORD_HASH)}`);

if (!ADMIN_PASSWORD_HASH) {
    bad("ADMIN_PASSWORD_HASH is empty — admin login is disabled by design.");
    problems.push("Set ADMIN_PASSWORD_HASH in .env");
} else if (!/^\$2[aby]\$\d{2}\$/.test(ADMIN_PASSWORD_HASH)) {
    bad("ADMIN_PASSWORD_HASH is not a bcrypt hash (must start with $2a$, $2b$ or $2y$).");
    bad("A plain password will never work here — it has to be the hash.");
    problems.push("Replace ADMIN_PASSWORD_HASH with a real bcrypt hash");
} else if (ADMIN_PASSWORD_HASH.length !== 60) {
    bad(`A bcrypt hash is 60 characters; this one is ${ADMIN_PASSWORD_HASH.length}. It is truncated or mangled.`);
    problems.push("Re-copy the full 60-character ADMIN_PASSWORD_HASH");
} else {
    ok("ADMIN_PASSWORD_HASH is a well-formed 60-character bcrypt hash.");
}

head("4. Does the password you are typing match?");
const candidate = process.argv[2];
if (!candidate) {
    console.log("  Skipped — re-run with the password to test it:");
    console.log("    node scripts/check-admin-login.js 'your-password'");
} else if (!ADMIN_PASSWORD_HASH) {
    bad("Cannot test: no hash configured.");
} else {
    let matches = false;
    try {
        matches = require("bcryptjs").compareSync(candidate, ADMIN_PASSWORD_HASH);
    } catch (err) {
        bad("bcrypt comparison threw: " + err.message);
    }
    if (matches) {
        ok("This password DOES match the configured hash.");
        ok(`Sign in with username "${ADMIN_USERNAME}" and this password.`);
    } else {
        bad("This password does NOT match the configured hash.");
        bad("Either the hash was made from a different password, or it was");
        bad("altered when it was pasted into .env.");
        problems.push("Regenerate the hash from the exact password you intend to type");
    }
}

head("5. Is the RUNNING server using this value?");
warn("This script reads .env from disk. PM2 keeps the environment it started");
warn("with — plain `pm2 restart` does NOT reload .env. After editing it, run:");
console.log("    pm2 restart ecosystem.config.js --only ten-portal-production --update-env");
console.log("  Then confirm the running process agrees:");
console.log("    pm2 env 0 | grep ADMIN_USERNAME");

head("Summary");
if (!problems.length) {
    ok("Configuration looks correct.");
    console.log("  If login still fails, the running process has stale env — restart with --update-env.");
} else {
    problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
}

console.log("\nTo generate a fresh hash (single quotes matter — they stop the shell");
console.log("expanding $ inside your password):");
console.log("  node -e \"console.log(require('bcryptjs').hashSync(process.argv[1],12))\" 'YourPassword'");
console.log("");
