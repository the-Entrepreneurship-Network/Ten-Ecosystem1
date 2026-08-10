#!/usr/bin/env node
'use strict';

/**
 * Find — and optionally fix — students whose domain / tenure / durationType /
 * offer letter disagree with each other. This is issue 6.1 in the task
 * document (the MD Kamrujjaman Al Kudrot case).
 *
 * DRY RUN BY DEFAULT. It prints what it would change and touches nothing.
 * Pass --apply to write.
 *
 *   node scripts/audit-domain-tenure.js                        # report everything
 *   node scripts/audit-domain-tenure.js --employee TEN/WEB/1630
 *   node scripts/audit-domain-tenure.js --employee TEN/WEB/1630 --set-domain "MERN Stack Development" --set-tenure "45 Days" --apply
 *   node scripts/audit-domain-tenure.js --apply                # fix every auto-fixable mismatch
 *
 * What counts as a mismatch:
 *   1. tenure does not parse            → the portal treats them as 1 Month
 *   2. v2DurationType != tenure         → task journey shows the wrong length
 *   3. domain is not a known domain     → task assignment finds nothing
 *   4. internshipEndDate missing/wrong  → attendance targets and the
 *                                         auto-mark cron skip them
 *   5. an offer letter was issued and domain/tenure changed since
 *      → FLAGGED ONLY. Regenerating a PDF is a decision for a person, and the
 *        letter is what the student was actually promised.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Student = require('../models/Student');
const { normalizeTenure, getTenureLabel, getInternshipEndDate } = require('../utils/tenure');
const { normalizeDomain } = require('../config/domains');

function parseArgs(argv) {
  const args = { apply: false, employee: null, setDomain: null, setTenure: null, limit: 0 };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--apply':       args.apply = true; break;
      case '--employee':    args.employee = argv[++i]; break;
      case '--set-domain':  args.setDomain = argv[++i]; break;
      case '--set-tenure':  args.setTenure = argv[++i]; break;
      case '--limit':       args.limit = parseInt(argv[++i], 10) || 0; break;
      case '--help': case '-h':
        console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }
  return args;
}

/** @returns {{problems: string[], fix: object}} */
function inspect(student, overrides) {
  const problems = [];
  const fix = {};

  // ── Domain ──
  const rawDomain = overrides.domain || student.domain;
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    problems.push(`domain "${rawDomain}" is not a recognised domain`);
  } else if (domain !== student.domain) {
    problems.push(`domain "${student.domain}" → "${domain}"`);
    fix.domain = domain;
  }

  // ── Tenure ──
  const rawTenure = overrides.tenure || student.tenure;
  const durationType = normalizeTenure(rawTenure);
  if (!durationType) {
    // This is the headline bug: an unparseable tenure silently became 30 days.
    problems.push(`tenure "${rawTenure}" does not parse — the portal treats this student as 1 Month`);
  } else {
    const label = getTenureLabel(durationType);
    if (label !== student.tenure) {
      problems.push(`tenure "${student.tenure}" → "${label}"`);
      fix.tenure = label;
    }
    if (student.v2DurationType !== durationType) {
      problems.push(`v2DurationType "${student.v2DurationType}" → "${durationType}" (task journey length)`);
      fix.v2DurationType = durationType;
    }

    // ── Internship end date ──
    const start = student.internshipStartDate || student.joiningDate || student.createdAt;
    const expectedEnd = getInternshipEndDate(start, durationType);
    if (expectedEnd) {
      const currentEnd = student.internshipEndDate ? new Date(student.internshipEndDate) : null;
      const differs = !currentEnd || Math.abs(currentEnd.getTime() - expectedEnd.getTime()) > 86400000;
      if (differs) {
        problems.push(`internshipEndDate ${currentEnd ? currentEnd.toISOString().slice(0,10) : 'unset'} → ${expectedEnd.toISOString().slice(0,10)}`);
        fix.internshipEndDate = expectedEnd;
      }
    }
  }

  // ── Offer letter ── flagged, never auto-changed.
  const hasIssuedOffer = !!student.offerPdfBase64 ||
    ['issued', 'approved'].includes(student.offerLetterStatus);
  if (hasIssuedOffer && (fix.domain || fix.tenure)) {
    problems.push('⚠ an offer letter has been ISSUED — it states the old domain/tenure. Regenerate it by hand after reviewing.');
  }

  return { problems, fix };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Point it at the database you want to audit.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected. Mode: ${args.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  const query = args.employee ? { employeeId: args.employee } : {};
  let students = await Student.find(query)
    .select('employeeId name domain tenure v2DurationType internshipStartDate joiningDate createdAt internshipEndDate offerLetterStatus offerPdfBase64')
    .lean();
  if (args.limit) students = students.slice(0, args.limit);

  if (args.employee && !students.length) {
    console.error(`No student found with employeeId "${args.employee}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const overrides = {};
  if (args.setDomain) overrides.domain = args.setDomain;
  if (args.setTenure) overrides.tenure = args.setTenure;
  if ((args.setDomain || args.setTenure) && !args.employee) {
    console.error('--set-domain / --set-tenure require --employee. Refusing to apply one value to everybody.');
    await mongoose.disconnect();
    process.exit(1);
  }

  let affected = 0;
  let written = 0;
  let needsLetterReview = 0;

  for (const student of students) {
    const { problems, fix } = inspect(student, overrides);
    if (!problems.length) continue;

    affected++;
    console.log(`${student.employeeId}  ${student.name || ''}`);
    for (const p of problems) console.log(`   - ${p}`);
    if (problems.some((p) => p.startsWith('⚠'))) needsLetterReview++;

    if (Object.keys(fix).length === 0) {
      console.log('   → nothing can be fixed automatically; needs a human decision\n');
      continue;
    }

    if (args.apply) {
      await Student.updateOne({ _id: student._id }, { $set: fix });
      written++;
      console.log(`   ✓ applied: ${Object.keys(fix).join(', ')}\n`);
    } else {
      console.log(`   → would set: ${Object.keys(fix).join(', ')}\n`);
    }
  }

  console.log('─'.repeat(60));
  console.log(`Scanned ${students.length} student(s)`);
  console.log(`  with mismatches       : ${affected}`);
  console.log(`  ${args.apply ? 'written' : 'would write'}: ${args.apply ? written : affected}`);
  console.log(`  offer letters to review: ${needsLetterReview}`);
  if (!args.apply && affected) {
    console.log('\nRe-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
