'use strict';

/**
 * Who is using the Career Studio on a transaction number nobody checked?
 *
 * The Studio used to treat 'pending_verification' as settled: a student typed
 * anything into the reference box and the paid portals opened. That is closed
 * now, but the students who got in that way before the cutoff keep their access
 * — some of them really did pay, and taking the portal away from them without
 * looking would punish the honest ones for a bug that was ours.
 *
 * This is the list to look at. For each row: the student, what they claimed to
 * pay for, how much, the reference they typed, and when. Check them against the
 * bank or UPI statement, mark the real ones 'success', and once the list is
 * clear move STUDIO_UNVERIFIED_GRANDFATHER_UNTIL forward in .env so nothing
 * unchecked keeps access.
 *
 *     node scripts/list-unverified-studio-access.js          # everyone
 *     node scripts/list-unverified-studio-access.js --csv    # for a spreadsheet
 *
 * Read-only. It changes nothing.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const studioPricing = require('../config/studioPricing');
const { UNVERIFIED_UNTIL } = require('../services/studioAccess');

const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

async function main() {
    const csv = process.argv.includes('--csv');
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('No MONGODB_URI in the environment — that is the thing to fix first.');
        process.exitCode = 1;
        return;
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

    const Payment = require('../models/Payment');
    const rows = await Payment.find({
        purpose: { $in: studioPricing.allPurposes() },
        status: 'pending_verification'
    })
        .populate('studentId', 'name email employeeId domain tenure')
        .sort({ createdAt: 1 })
        .lean();

    if (!rows.length) {
        console.log('Nobody holds Studio access on an unchecked transaction number. Nothing to do.');
        await mongoose.disconnect();
        return;
    }

    const grandfathered = rows.filter((r) => r.createdAt && new Date(r.createdAt) < UNVERIFIED_UNTIL);
    const blocked = rows.filter((r) => !grandfathered.includes(r));

    if (csv) {
        console.log('employeeId,name,email,product,amount,reference,paid_on,still_has_access');
        rows.forEach((r) => {
            const s = r.studentId || {};
            const kept = grandfathered.includes(r) ? 'yes' : 'no';
            console.log([
                s.employeeId || '', s.name || '', s.email || '',
                r.purpose || '', r.amount || '',
                (r.metadata && (r.metadata.utr || r.metadata.reference)) || '',
                r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
                kept
            ].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
        });
        await mongoose.disconnect();
        return;
    }

    console.log(`\n${rows.length} payment(s) are sitting on a transaction number nobody has checked.\n`);
    console.log(`Cutoff: ${UNVERIFIED_UNTIL.toISOString().slice(0, 10)}`);
    console.log(`  ${grandfathered.length} before it — these students STILL HAVE ACCESS.`);
    console.log(`  ${blocked.length} after it — these are already blocked.\n`);

    const show = (label, list) => {
        if (!list.length) return;
        console.log(label);
        list.forEach((r) => {
            const s = r.studentId || {};
            const ref = (r.metadata && (r.metadata.utr || r.metadata.reference)) || '(no reference given)';
            const when = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'unknown date';
            console.log(`  ${(s.employeeId || '—').padEnd(16)} ${(s.name || 'unknown').padEnd(26)} `
                + `${(r.purpose || '').padEnd(16)} ${rupees(r.amount).padStart(8)}  ${when}  ref ${ref}`);
        });
        console.log('');
    };

    show('STILL HAVE ACCESS — check these against the bank statement:', grandfathered);
    show('Already blocked (arrived after the cutoff):', blocked);

    console.log('To confirm a real payment, set its status to "success" in the admin payment queue.');
    console.log('Once this list is empty, move STUDIO_UNVERIFIED_GRANDFATHER_UNTIL forward in .env.');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
});
