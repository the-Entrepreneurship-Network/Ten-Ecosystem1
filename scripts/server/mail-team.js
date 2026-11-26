'use strict';
/**
 * Emails what arrives on stdin to the team inbox (SUPPORT_COPY_TO, growth@),
 * from the help desk's mailbox. scripts/server/ops.sh sends the app's logs
 * this way: they hold students' data and must not appear in the public log of
 * a GitHub workflow.
 *
 * Usage: some-command | node scripts/server/mail-team.js "<subject>"
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const MailComposer = require('nodemailer/lib/mail-composer');
const gmail = require('../../services/supportDesk/gmail');

async function main() {
    const to = String(process.env.SUPPORT_COPY_TO || '').trim();
    if (!to || !gmail.configured()) throw new Error('This server has no SUPPORT_COPY_TO or help desk mailbox.');
    const text = require('fs').readFileSync(0, 'utf8').slice(-200000) || '(nothing)';
    const from = (await gmail.profile()).emailAddress;
    const raw = await new MailComposer({ from, to, subject: process.argv[2] || '[server] output', text }).compile().build();
    await gmail.send(raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

main().then(() => console.log('Emailed to the team inbox.'), (err) => {
    console.error('Could not email it:', String((err && err.message) || err).slice(0, 200));
    process.exit(1);
});
