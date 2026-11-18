'use strict';

/**
 * @jest-environment node
 *
 * The generated PDFs now live on disk and nowhere else.
 *
 * They were always written to uploads/ AND base64'd onto the Student document,
 * and the second copy is what made a student record megabytes long. Removing it
 * turns the file into the only copy, which changes what the rest of the code
 * has to get right: a path that cannot be derived means a document nobody can
 * download, a stale path means a revoked certificate that still serves, and a
 * directory left readable means every student's letters are a guessed URL away.
 *
 * These exercise the module rather than its source. The filesystem ones write
 * under a throwaway employee ID inside the real uploads/ tree — which is
 * gitignored — and clean up after themselves.
 */

const fs = require('fs');
const path = require('path');
const certFile = require('../../services/certificateFile');

const TEST_ID = 'ZZTEST/UNIT/0001';
const student = { employeeId: TEST_ID, _id: 'abc123def456' };

/** Everything this test could possibly have created. */
const litter = () => certFile.TYPES
    .flatMap((t) => certFile.candidates(student, t))
    .concat(path.join(certFile.UPLOADS, 'loc', `${student._id}_loc.pdf`));

const sweep = () => litter().forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });

beforeEach(sweep);
afterAll(sweep);

describe('where a document is written', () => {
    it('puts the offer letter apart from the certificates', () => {
        expect(certFile.pathFor(student, 'OFFER'))
            .toBe(path.join(certFile.UPLOADS, 'offer-letters', 'ZZTEST-UNIT-0001_offer_letter.pdf'));
        expect(certFile.pathFor(student, 'LOC'))
            .toBe(path.join(certFile.UPLOADS, 'certificates', 'ZZTEST-UNIT-0001_loc.pdf'));
    });

    it('matches the names the old code wrote, for all five types', () => {
        // These files already exist on the server by these exact names. A
        // different convention here would orphan every certificate issued so far.
        for (const t of ['LOC', 'LOR', 'STAR', 'LOP']) {
            expect(certFile.pathFor(student, t).endsWith(`ZZTEST-UNIT-0001_${t.toLowerCase()}.pdf`)).toBe(true);
        }
    });

    it('is case-insensitive about the type and refuses an unknown one', () => {
        expect(certFile.pathFor(student, 'loc')).toBe(certFile.pathFor(student, 'LOC'));
        expect(certFile.pathFor(student, 'NOPE')).toBeNull();
        expect(certFile.pathFor(student, '')).toBeNull();
        expect(certFile.pathFor(student, null)).toBeNull();
    });

    it('falls back to the _id when there is no employee ID', () => {
        expect(certFile.pathFor({ _id: 'xyz789' }, 'LOR'))
            .toBe(path.join(certFile.UPLOADS, 'certificates', 'xyz789_lor.pdf'));
    });
});

describe('an employee ID cannot walk out of the uploads directory', () => {
    /*
     * The ID reaches this as data, and it is interpolated straight into a
     * path. The slash replacement alone is not a defence — it turns
     * "../../etc/passwd" into "..-..-etc-passwd" only if it runs, and an ID
     * holding ".." with no slash would survive it untouched.
     */
    it.each([
        '../../etc/passwd',
        '..',
        '../secrets',
        'a/../../b',
        'has space',
        'null\0byte',
        '',
        null
    ])('refuses %p', (bad) => {
        expect(certFile.pathFor({ employeeId: bad }, 'LOC')).toBeNull();
    });

    it('keeps every path it does produce inside uploads/', () => {
        for (const id of ['TEN/WEB/1234', 'TEN-AI-9', 'abc_123', 'x.y']) {
            const p = certFile.pathFor({ employeeId: id }, 'LOC');
            expect(p).not.toBeNull();
            expect(path.resolve(p).startsWith(path.resolve(certFile.UPLOADS) + path.sep)).toBe(true);
        }
    });
});

describe('both places a LOC can already be', () => {
    /*
     * routes/v2/certificates.js writes uploads/certificates/<employeeId>_loc.pdf;
     * the auto-generate path in routes/v2/documents.js writes
     * uploads/loc/<_id>_loc.pdf. Both hold real students' letters.
     */
    it('looks in the legacy directory too, but only for LOC', () => {
        const loc = certFile.candidates(student, 'LOC');
        expect(loc).toHaveLength(2);
        expect(loc[1]).toBe(path.join(certFile.UPLOADS, 'loc', 'abc123def456_loc.pdf'));
        expect(certFile.candidates(student, 'LOR')).toHaveLength(1);
    });

    it('finds the legacy file when the current one is absent', () => {
        const legacy = path.join(certFile.UPLOADS, 'loc', `${student._id}_loc.pdf`);
        fs.mkdirSync(path.dirname(legacy), { recursive: true });
        fs.writeFileSync(legacy, 'legacy');
        expect(certFile.findFor(student, 'LOC')).toBe(legacy);
    });

    it('prefers the current location when both exist', () => {
        const legacy = path.join(certFile.UPLOADS, 'loc', `${student._id}_loc.pdf`);
        fs.mkdirSync(path.dirname(legacy), { recursive: true });
        fs.writeFileSync(legacy, 'legacy');
        certFile.save(student, 'LOC', Buffer.from('current'));
        expect(certFile.findFor(student, 'LOC')).toBe(certFile.pathFor(student, 'LOC'));
    });

    it('reports nothing when there is nothing', () => {
        expect(certFile.findFor(student, 'LOC')).toBeNull();
        expect(certFile.read(student, 'LOC')).toBeNull();
    });
});

describe('writing, reading back and removing', () => {
    it('round-trips the exact bytes', () => {
        const pdf = Buffer.from('%PDF-1.4\n\x00\x01\x02 binary \xff\xfe', 'binary');
        const written = certFile.save(student, 'STAR', pdf);
        expect(written).toBe(certFile.pathFor(student, 'STAR'));
        expect(certFile.read(student, 'STAR').equals(pdf)).toBe(true);
    });

    it('creates the directory rather than failing on a fresh server', () => {
        expect(() => certFile.save(student, 'LOP', Buffer.from('x'))).not.toThrow();
        expect(fs.existsSync(certFile.pathFor(student, 'LOP'))).toBe(true);
    });

    it('writes nothing for an empty buffer or an unusable ID', () => {
        expect(certFile.save(student, 'LOC', Buffer.alloc(0))).toBeNull();
        expect(certFile.save(student, 'LOC', null)).toBeNull();
        expect(certFile.save({ employeeId: '../x' }, 'LOC', Buffer.from('x'))).toBeNull();
    });

    it('removes every copy, so a revoked certificate stops serving', () => {
        // The revoke used to clear the column and leave the file. With the file
        // as the only copy that would have kept the document downloadable.
        const legacy = path.join(certFile.UPLOADS, 'loc', `${student._id}_loc.pdf`);
        fs.mkdirSync(path.dirname(legacy), { recursive: true });
        fs.writeFileSync(legacy, 'legacy');
        certFile.save(student, 'LOC', Buffer.from('current'));

        expect(certFile.remove(student, 'LOC')).toBe(2);
        expect(certFile.findFor(student, 'LOC')).toBeNull();
        expect(certFile.remove(student, 'LOC')).toBe(0);   // idempotent
    });
});

describe('whether a document has been issued', () => {
    /*
     * Answered from the status field, which is set in the same write that
     * produces the PDF. sanitizeStudent calls this for every student in every
     * HR list, so it must not touch the disk.
     */
    it('reads the status, without going near the filesystem', () => {
        // A student carrying a usable employee ID, so that a path COULD be
        // derived and stat()ed. Without one there is no path to check and the
        // assertion passes for the wrong reason.
        const spy = jest.spyOn(fs, 'existsSync');
        expect(certFile.isIssued({ ...student, locStatus: 'issued' }, 'LOC')).toBe(true);
        expect(certFile.isIssued({ ...student, locStatus: 'pending_hr' }, 'LOC')).toBe(false);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('counts an offer letter as issued when it is approved OR issued', () => {
        // documents.js sets 'approved' on generation, certificates.js 'issued'.
        expect(certFile.isIssued({ offerLetterStatus: 'approved' }, 'OFFER')).toBe(true);
        expect(certFile.isIssued({ offerLetterStatus: 'issued' }, 'OFFER')).toBe(true);
        expect(certFile.isIssued({ offerLetterStatus: 'under_review' }, 'OFFER')).toBe(false);
        expect(certFile.isIssued({ offerLetterStatus: 'rejected' }, 'OFFER')).toBe(false);
    });

    it('does not let one type answer for another', () => {
        expect(certFile.isIssued({ locStatus: 'issued' }, 'LOR')).toBe(false);
        expect(certFile.isIssued({ starStatus: 'approved' }, 'STAR')).toBe(false);
    });

    it('still says yes for a record the backfill has not reached', () => {
        // The column is gone from new writes but survives on old records until
        // scripts/migrate-cert-pdfs.js runs. Until then it is the answer.
        expect(certFile.isIssued({ lorPdfBase64: 'JVBERi0=' }, 'LOR')).toBe(true);
        expect(certFile.isIssued({ lorPdfBase64: null }, 'LOR')).toBe(false);
    });

    it('is false for nothing at all', () => {
        expect(certFile.isIssued(null, 'LOC')).toBe(false);
        expect(certFile.isIssued({}, 'LOC')).toBe(false);
        expect(certFile.isIssued({ locStatus: 'issued' }, 'NOPE')).toBe(false);
    });
});

describe('the uploads directory stops handing out documents', () => {
    /*
     * /uploads is served to anyone. While the base64 column existed a leak here
     * only duplicated what the authenticated route served; now the file IS the
     * document, and a certificate is named after the employee ID, so
     * /uploads/certificates/TEN-WEB-1234_loc.pdf is a guess away.
     *
     * The real guard is read out of server.js and run, rather than its text
     * being matched: a regex that is present but wrong passes a text check.
     */
    const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    const m = src.match(/const UPLOADS_PRIVATE = (\/.+?\/[gimsuy]*);/);
    const guard = (() => { expect(m).not.toBeNull(); return eval(m[1]); })();

    it.each([
        '/certificates/TEN-WEB-1234_loc.pdf',
        '/offer-letters/TEN-WEB-1234_offer_letter.pdf',
        '/loc/abc123_loc.pdf',
        '/documents/marksheet.pdf',
        '/local_db/db_Student.json',
        '/CERTIFICATES/x.pdf'
    ])('refuses %s', (p) => expect(guard.test(p)).toBe(true));

    it.each([
        '/logo.png',
        '/banner.jpg',
        '/certificates-guide.pdf',      // not the directory
        '/public/offer-letters-sample'  // not the directory
    ])('still serves %s', (p) => expect(guard.test(p)).toBe(false));
});
