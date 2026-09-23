#!/usr/bin/env node
'use strict';

/**
 * Load a college list into CollegeContact.
 *
 * Built for the AICTE approved-institutions dataset, which is published as a
 * download and needs no crawler at all — the whole list, with contact details,
 * from the regulator. Any CSV or XLSX with the same sort of columns works.
 *
 * DRY RUN BY DEFAULT. It prints what it would insert and writes nothing.
 * Pass --apply to write.
 *
 *   node scripts/import-colleges.js aicte.csv
 *   node scripts/import-colleges.js aicte.xlsx --apply
 *   node scripts/import-colleges.js aicte.csv --state Karnataka --limit 500 --apply
 *
 * Rows with no usable email are counted and skipped, not guessed at. An
 * invented `principal@<domain>` is how a sending domain earns a spam
 * reputation, and services/v2/recruiterContacts.js bans the same thing by name.
 * Feed those colleges' websites to the dashboard's Discover box instead, which
 * reads the address off the page the college actually published.
 */

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const CollegeContact = require('../models/CollegeContact');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};
const ONLY_STATE = flag('--state');
const LIMIT = parseInt(flag('--limit'), 10) || 0;

/* Government exports do not agree on column names, so match on meaning. */
const COLUMNS = {
    email:   /e-?mail|mail_?id/i,
    college: /institut|college|name_?of|^name$/i,
    state:   /state/i,
    website: /web|url|site/i,
    phone:   /phone|mobile|contact_?no|telephone/i
};

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;

/** Find the first header whose name means `key`, and read that cell. */
function pick(row, key) {
    const re = COLUMNS[key];
    const header = Object.keys(row).find((h) => re.test(String(h)));
    return header ? String(row[header] == null ? '' : row[header]).trim() : '';
}

function toRow(raw) {
    // A single cell often holds "Dr X, principal@c.edu, 0824-..." — take the
    // address out of it rather than rejecting the row.
    const emailCell = pick(raw, 'email');
    const m = emailCell.match(RE_EMAIL) || String(Object.values(raw).join(' ')).match(RE_EMAIL);
    if (!m) return null;

    return {
        email:     m[0].toLowerCase(),
        college:   pick(raw, 'college'),
        state:     pick(raw, 'state'),
        website:   pick(raw, 'website'),
        phone:     pick(raw, 'phone'),
        // The dataset itself is the evidence for these rows — there is no page
        // to point at, so the row records which import it came from.
        sourceUrl: 'aicte-dataset:' + path.basename(file || 'import'),
        via:       'aicte-import'
    };
}

async function main() {
    if (!file) {
        console.error('Usage: node scripts/import-colleges.js <file.csv|file.xlsx> [--state X] [--limit N] [--apply]');
        process.exit(1);
    }
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Point it at the database you want to import into.');
        process.exit(1);
    }

    const book = xlsx.readFile(file);
    const sheet = book.Sheets[book.SheetNames[0]];
    const raw = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    console.log(`Read ${raw.length} rows from ${file}`);
    if (raw.length) console.log('Columns:', Object.keys(raw[0]).join(' | '));

    const seen = new Set();
    let noEmail = 0, wrongState = 0;
    const rows = [];

    for (const r of raw) {
        if (LIMIT && rows.length >= LIMIT) break;
        const row = toRow(r);
        if (!row) { noEmail++; continue; }
        if (ONLY_STATE && !new RegExp(ONLY_STATE, 'i').test(row.state)) { wrongState++; continue; }
        if (seen.has(row.email)) continue;
        seen.add(row.email);
        rows.push(row);
    }

    console.log(`\nUsable: ${rows.length}   no email: ${noEmail}` + (ONLY_STATE ? `   other states: ${wrongState}` : ''));
    rows.slice(0, 5).forEach((r) => console.log(`  ${r.email.padEnd(38)} ${r.college.slice(0, 44)}`));
    if (rows.length > 5) console.log(`  … and ${rows.length - 5} more`);

    if (!APPLY) {
        console.log('\nDry run — nothing written. Re-run with --apply to insert.');
        return;
    }

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    let added = 0, existing = 0;
    for (const row of rows) {
        try {
            // $setOnInsert only: a re-import must never revive an address that
            // opted out or reset a status somebody set by hand.
            const res = await CollegeContact.updateOne({ email: row.email }, { $setOnInsert: row }, { upsert: true });
            if (res.upsertedCount) added++; else existing++;
        } catch (_) { existing++; }
    }
    console.log(`\nInserted ${added}, already present ${existing}.`);
    await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
