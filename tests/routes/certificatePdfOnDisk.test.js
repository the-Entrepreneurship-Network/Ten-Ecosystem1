'use strict';

/**
 * @jest-environment node
 *
 * The parts of the move that cannot be run here.
 *
 * services/certificateFile.js is covered properly in
 * tests/services/certificateFile.test.js — it is exercised, not read. What is
 * left are a 1600-line route file that pulls in mongoose and node-cron on
 * require, and a script that wants a live database. These assertions bound the
 * exact function or loop they are about and check the one property that would
 * silently lose a student's document if it were undone.
 */

const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const CERTS = read('routes/v2/certificates.js');
const DOCS  = read('routes/v2/documents.js');
const MIGRATE = read('scripts/migrate-cert-pdfs.js');
const ADMIN = read('routes/adminPortal.js');

/** A named function's body, bounded by the next top-level declaration. */
function fnBody(src, signature) {
    const at = src.indexOf(signature);
    expect(at).toBeGreaterThan(-1);
    const after = src.slice(at + signature.length);
    const end = after.search(/\n(async function |function |router\.(get|post|put|delete|patch)\(|cron\.schedule\()/);
    return after.slice(0, end === -1 ? after.length : end);
}

describe('issuing a certificate writes one copy, to disk', () => {
    const body = fnBody(CERTS, 'async function generateAndSaveCert(');

    it('no longer stores the bytes on the Student document', () => {
        expect(body).not.toMatch(/pdfBuffer\.toString\('base64'\)/);
        expect(body).not.toMatch(/PdfBase64/);
    });

    it('writes through the one module that knows where documents go', () => {
        expect(body).toMatch(/certFile\.save\(student, certType, pdfBuffer\)/);
    });

    it('refuses to record an issue it could not write', () => {
        /*
         * This used to be a try/catch that logged and carried on, which was
         * survivable while the base64 column held a second copy. With the file
         * as the only copy, carrying on means a student whose record says
         * "issued" and who has nothing to download.
         */
        const save = body.indexOf('certFile.save(');
        const update = body.indexOf('Student.findByIdAndUpdate(');
        expect(save).toBeGreaterThan(-1);
        expect(update).toBeGreaterThan(save);          // write first, then record it
        expect(body).toMatch(/if \(!destPath\) throw new Error\(/);
    });
});

describe('one bad record does not stop the queue behind it', () => {
    /*
     * Both cron loops had a single try around the whole batch. That was fine
     * while issuing could not throw; now that it can, the first failure would
     * abandon every student after it — and they would stay unissued until
     * somebody noticed.
     */
    it.each([
        ['CertCron-2', 'checkAndIssueCerts(s._id.toString())'],
        ['CertCron-3', "generateAndSaveCert(s._id.toString(), 'OFFER', s, \"System Automation\")"]
    ])('%s catches per student', (tag, call) => {
        const at = CERTS.indexOf(call);
        expect(at).toBeGreaterThan(-1);
        const loopStart = CERTS.lastIndexOf('for (const s of list) {', at);
        expect(loopStart).toBeGreaterThan(-1);
        const loop = CERTS.slice(loopStart, at);
        expect(loop).toContain('try {');
        expect(CERTS.slice(at, at + 400)).toMatch(new RegExp(`catch \\(one\\)[\\s\\S]*${tag}`));
    });
});

describe('the auto-generated letters stopped duplicating themselves too', () => {
    it('documents.js writes the file and records only the status', () => {
        expect(DOCS).not.toMatch(/PdfBase64/);
        // Both of these wrote the file first and then read it straight back
        // just to base64 it onto the student.
        expect(DOCS).not.toMatch(/readFileSync\(outPath\)/);
        expect(DOCS).not.toMatch(/readFileSync\(pdfPath\)/);
    });
});

describe('revoking takes the document away', () => {
    it('deletes the file, not just the column', () => {
        // Clearing the column was the whole revoke while the column was what
        // downloads read. It is not any more.
        const at = ADMIN.indexOf("if (f && row.studentId) {");
        expect(at).toBeGreaterThan(-1);
        const block = ADMIN.slice(at, ADMIN.indexOf('row.revokedAt =', at));
        expect(block).toMatch(/certFile\.remove\(/);
        expect(block).toMatch(/row\.certificateType/);
    });
});

describe('the backfill cannot clear a column before the file is safe', () => {
    const body = fnBody(MIGRATE, 'async function run(');

    it('defaults to changing nothing', () => {
        expect(MIGRATE).toMatch(/const APPLY = args\.includes\('--apply'\)/);
        expect(body).toMatch(/DRY RUN/);
    });

    it('writes, then verifies the size, then unsets — in that order', () => {
        const save   = body.indexOf('certFile.save(doc, type, buf)');
        const verify = body.indexOf('fs.statSync(written).size');
        const unset  = body.indexOf('$unset');
        expect(save).toBeGreaterThan(-1);
        expect(verify).toBeGreaterThan(save);
        expect(unset).toBeGreaterThan(verify);
    });

    it('removes a short write rather than counting it', () => {
        expect(body).toMatch(/if \(onDisk !== buf\.length\)/);
        expect(body).toMatch(/fs\.unlinkSync\(written\)/);
    });

    it('skips the unset for anything it could not place', () => {
        // Every failure path has to leave the loop before the $unset.
        const failures = [...body.matchAll(/totals\.failed\.push\(/g)].map((m) => m.index);
        expect(failures.length).toBeGreaterThanOrEqual(3);
        const unset = body.indexOf('$unset');
        for (const at of failures) {
            expect(body.slice(at, unset)).toContain('continue;');
        }
    });

    it('streams one record at a time instead of loading the collection', () => {
        // Selecting five base64 columns across every student is the ~781MB
        // this is meant to remove, materialised in one process.
        expect(body).toMatch(/\.cursor\(\)/);
        expect(body).toMatch(/\.select\(`employeeId \$\{col\}`\)/);
        expect(body).not.toMatch(/await Student\.find\([^)]*\)\s*;/);
    });
});
