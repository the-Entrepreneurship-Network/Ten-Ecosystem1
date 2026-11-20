'use strict';

/**
 * @jest-environment node
 *
 * A generated certificate is a file on disk, and a Student document does not
 * carry a copy of it.
 *
 * Every certificate used to be stored twice — a PDF under uploads/ and the
 * same bytes as base64 on the Student — and the second copy was the reason a
 * single record ran to megabytes, blew the 100MB in-memory sort limit on the
 * HR lists, and needed sort indexes to work around itself. The backfill
 * (scripts/migrate-cert-pdfs.js) moved every student onto the file and dropped
 * the five columns from the schema.
 *
 * This holds that end state. Re-declaring any of these fields brings the whole
 * problem back one `new Student({...})` at a time, and nothing else in the
 * suite would notice — the download route and isIssued keep a read-only
 * fallback that names the old columns, so the names still appear in the code.
 * The schema is the one place the absence is load-bearing, so it is the place
 * the absence is pinned.
 */

const Student = require('../../models/Student');

const B64_FIELDS = ['locPdfBase64', 'lorPdfBase64', 'starPdfBase64', 'lopPdfBase64', 'offerPdfBase64'];

describe('the base64 certificate columns are gone from the schema', () => {
    it.each(B64_FIELDS)('%s is not a schema path', (field) => {
        expect(Student.schema.path(field)).toBeUndefined();
    });

    it('a new document never materialises one, even set explicitly', () => {
        // Mongoose silently drops a key the schema does not know, so a stray
        // write of locPdfBase64 cannot sneak a megabyte back onto the record.
        const doc = new Student({
            name: 'Check', email: 'check@example.com', employeeId: 'TEN/WEB DEVELOPMENT/1001',
            locPdfBase64: 'JVBERi0=', offerPdfBase64: 'JVBERi0='
        });
        const obj = doc.toObject();
        for (const f of B64_FIELDS) expect(obj[f]).toBeUndefined();
    });

    it('keeps the status field that replaced each one', () => {
        // The status is what now answers "does this document exist?", set in
        // the same write that produces the PDF. Removing a base64 column must
        // not take its status with it.
        for (const f of ['locStatus', 'lorStatus', 'starStatus', 'lopStatus', 'offerLetterStatus']) {
            expect(Student.schema.path(f)).toBeDefined();
        }
    });
});
