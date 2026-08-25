#!/usr/bin/env node
'use strict';

/**
 * Ask, right now, whether email is reaching anybody.
 *
 * services/automationCron.js runs this check at 08:00 IST from inside the
 * server process, where mongoose is already connected. Running the same
 * function from a standalone `node -e` does not work — there is no connection,
 * so the query buffers and dies after ten seconds with
 * "Operation `mailhistories.countDocuments()` buffering timed out". That is
 * what a hand-run of it does today, and it looks exactly like a broken check
 * rather than a missing connection.
 *
 * So the connection lives here, in the script, and the cron function stays
 * connection-agnostic — the same split as scripts/check-email.js.
 *
 *   node scripts/check-mail-health.js
 *
 * Reads only. Sends nothing: the 08:00 job is what mails HR, and a hand-run
 * that also fired an alert would train everyone to ignore the alert.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Run this from the deployment directory.');
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const MailHistory = require('../models/MailHistory');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, failed] = await Promise.all([
        MailHistory.countDocuments({ sentAt: { $gte: since } }),
        MailHistory.countDocuments({ sentAt: { $gte: since }, status: 'failed' })
    ]);

    console.log('\nLast 24 hours\n' + '='.repeat(46));
    console.log('  sent attempts        ' + total);
    console.log('  failed               ' + failed);

    if (!total) {
        console.log('\n  Nothing was sent at all. That points at the trigger, not the mailer —');
        console.log('  no registration, approval or certificate happened in 24h.\n');
    } else {
        const pct = Math.round((failed / total) * 100);
        console.log('  failure rate         ' + pct + '%');
        if (failed) {
            const rows = await MailHistory.find({ sentAt: { $gte: since }, status: 'failed' })
                .select('errorMessage').limit(200).lean();
            const reasons = new Map();
            for (const r of rows) {
                const key = String(r.errorMessage || 'unknown').slice(0, 120);
                reasons.set(key, (reasons.get(key) || 0) + 1);
            }
            console.log('\n  why:');
            [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
                .forEach(([reason, n]) => console.log(`    ${n}x  ${reason}`));
        }
        console.log(pct >= 25
            ? '\n  \x1b[31mBroken.\x1b[0m Run: node scripts/check-email.js --to you@example.com\n'
            : '\n  \x1b[32mHealthy.\x1b[0m\n');
    }

    // What has gone out lately, by kind — the quickest way to see that a
    // particular path (welcome, certificates, notifications) is silent.
    const byType = await MailHistory.aggregate([
        { $match: { sentAt: { $gte: since } } },
        { $group: { _id: { type: '$mailType', status: '$status' }, n: { $sum: 1 } } }
    ]);
    if (byType.length) {
        console.log('  by type:');
        byType.sort((a, b) => b.n - a.n).forEach((r) =>
            console.log(`    ${String(r._id.type || '?').padEnd(20)} ${r._id.status.padEnd(7)} ${r.n}`));
        console.log('');
    }

    await mongoose.disconnect();
}

main().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; });
