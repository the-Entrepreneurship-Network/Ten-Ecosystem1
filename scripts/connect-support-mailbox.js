#!/usr/bin/env node
'use strict';

/**
 * Connect the complaints@ mailbox to the help desk. Run once, on the server:
 *
 *   node scripts/connect-support-mailbox.js
 *
 * Needs SUPPORT_GMAIL_CLIENT_ID and SUPPORT_GMAIL_CLIENT_SECRET in .env: a
 * "Desktop app" OAuth client from a Google Cloud project that has the Gmail API
 * switched on and its consent screen set to Internal. (External would work for
 * seven days and then stop: Google expires those tokens while an app is "in
 * testing".)
 *
 * It prints a link. Open it, sign in as complaints@ and press Allow. Google then
 * sends the browser to an address on 127.0.0.1 that does not load. That is
 * expected: copy that address from the address bar and paste it here.
 *
 * The result goes into .env as SUPPORT_GMAIL_REFRESH_TOKEN. It is never printed.
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const querystring = require('querystring');
const readline = require('readline');
const { COMPLAINTS_EMAIL } = require('../utils/mailer');

const ENV_FILE = path.join(process.cwd(), '.env');
const REDIRECT = 'http://127.0.0.1:8765/';
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function call(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                let json = {};
                try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
                reject(new Error(`${res.statusCode} ${json.error_description || (json.error && (json.error.message || json.error)) || text.slice(0, 160)}`));
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

/** Replace or add one KEY=value line, leaving the rest of .env exactly as it was. */
function saveToEnv(key, value) {
    const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    const lines = text.split('\n').filter((l) => !l.startsWith(key + '='));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(key + '=' + value, '');
    fs.writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
}

async function main() {
    const clientId = String(process.env.SUPPORT_GMAIL_CLIENT_ID || '').trim();
    const secret = String(process.env.SUPPORT_GMAIL_CLIENT_SECRET || '').trim();
    if (!clientId || !secret) {
        console.log('\nAdd these two lines to .env first (from Google Cloud → Clients → your Desktop client):\n');
        console.log('  SUPPORT_GMAIL_CLIENT_ID=...');
        console.log('  SUPPORT_GMAIL_CLIENT_SECRET=...\n');
        process.exitCode = 1;
        return;
    }

    const verifier = b64url(crypto.randomBytes(48));
    const state = crypto.randomBytes(12).toString('hex');
    const link = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        login_hint: COMPLAINTS_EMAIL,
        state,
        code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256'
    });

    console.log('\n1. Open this link in your browser:\n\n' + link + '\n');
    console.log(`2. Sign in as ${COMPLAINTS_EMAIL} and press Allow.`);
    console.log('3. The browser then shows "This site can\'t be reached". That is expected.');
    console.log('   Copy the whole address from the address bar (it starts with http://127.0.0.1:8765/).\n');

    const pasted = String(await ask('4. Paste that address here and press Enter: ')).trim();
    let code = pasted;
    if (/^https?:\/\//i.test(pasted)) {
        const params = new URL(pasted).searchParams;
        if (params.get('error')) throw new Error('Google said: ' + params.get('error') + '. Run this again and press Allow.');
        if (params.get('state') && params.get('state') !== state) throw new Error('That address is from an earlier attempt. Use the link printed above.');
        code = params.get('code') || '';
    }
    if (!code) throw new Error('No code in what you pasted. Copy the full address from the address bar.');

    const form = querystring.stringify({
        code, client_id: clientId, client_secret: secret, redirect_uri: REDIRECT,
        grant_type: 'authorization_code', code_verifier: verifier
    });
    const tokens = await call({
        host: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }
    }, form);
    if (!tokens.refresh_token) throw new Error('Google sent no long-term permission. Run this again; the link asks for it.');

    const profile = await call({
        host: 'gmail.googleapis.com', path: '/gmail/v1/users/me/profile', method: 'GET',
        headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    saveToEnv('SUPPORT_GMAIL_REFRESH_TOKEN', tokens.refresh_token);

    console.log(`\n✓ Connected to ${profile.emailAddress}. The permission is saved in .env (not shown).`);
    if (String(profile.emailAddress).toLowerCase() !== COMPLAINTS_EMAIL) {
        console.log(`  Note: that is not ${COMPLAINTS_EMAIL}. If you signed in with the wrong account, run this again.`);
    }
    console.log('\nNow restart the portal so it picks this up:');
    console.log('  pm2 restart ecosystem.config.js --only ten-portal-production --update-env\n');
}

main().catch((err) => {
    console.error('\n✗ ' + err.message + '\n');
    process.exitCode = 1;
});
