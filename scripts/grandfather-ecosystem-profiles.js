'use strict';

/**
 * Stamp every founder, investor and contractor account that predates review.
 *
 * Registration used to write `verificationStatus: 'approved'` the moment
 * somebody signed up — while the signup wizard and the success page both told
 * them HR would review the application. So the verification queue was
 * permanently empty and nobody was ever actually checked.
 *
 * Signups are now `pending`. That fixes the future and does nothing for the
 * past: every account already in the database sits at `approved` with no way
 * to tell "a human looked at this" from "a human never could". This script
 * draws that line, once.
 *
 * It does NOT re-open those accounts. Suspending people who have been using
 * the portal for months, to review them against evidence we never collected,
 * would be a worse answer than marking them. HR can work the grandfathered
 * list at their own pace; the flag is what makes it a list.
 *
 * Run it once, after deploying:
 *
 *     node scripts/grandfather-ecosystem-profiles.js            # report only
 *     node scripts/grandfather-ecosystem-profiles.js --write    # actually stamp
 *
 * Safe to run twice — it only touches rows that are approved and not yet
 * stamped.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const TARGETS = [
    ['Founder',    '../models/FounderProfile'],
    ['Investor',   '../models/InvestorProfile'],
    ['Contractor', '../models/ContractorProfile']
];

async function main() {
    const write = process.argv.includes('--write');
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) {
        console.error('No MONGODB_URI in the environment. Nothing to connect to.');
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(uri);
    console.log(write ? 'Stamping grandfathered profiles…\n' : 'Dry run — nothing will be written.\n');

    let total = 0;
    for (const [label, path] of TARGETS) {
        const Model = require(path);
        // Approved, and not already stamped. Anything HR has decided since the
        // change carries verifiedBy/verifiedAt and must not be relabelled.
        const filter = { verificationStatus: 'approved', grandfathered: { $ne: true } };
        const count = await Model.countDocuments(filter);
        total += count;

        if (!count) { console.log(`${label.padEnd(11)} nothing to stamp`); continue; }
        if (!write) { console.log(`${label.padEnd(11)} ${count} would be stamped`); continue; }

        const res = await Model.updateMany(filter, {
            $set: {
                grandfathered: true,
                rejectionReason: '',
                verifiedBy: 'auto-approved before review existed'
            }
        });
        console.log(`${label.padEnd(11)} ${res.modifiedCount} stamped`);
    }

    console.log(`\n${total} profile(s) predate review.`);
    if (!write && total) console.log('Re-run with --write to stamp them.');
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
});
