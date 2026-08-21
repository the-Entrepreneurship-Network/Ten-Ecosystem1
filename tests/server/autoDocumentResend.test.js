'use strict';

/**
 * The auto-document loop must not mail the same student twice.
 *
 * models/Student.js declares `documentsAutoSent`. runAutoDocumentCheck filters
 * on it. Nothing in the codebase ever set it to true — the one write set it to
 * FALSE. So every student past their internship end date stayed eligible
 * forever, and the check runs 30 seconds after each boot and every 6 hours
 * after that, sending three documents each pass. Production has restarted 151
 * times.
 *
 * That is what got the sending account suspended for "suspicious activity":
 * the same three attachments to the same addresses, repeatedly, including
 * every dead test row in the database.
 *
 * These pin the three parts of the fix — the flag is written, a student who
 * already has a DocumentHistory row is marked rather than re-mailed, and a
 * dead address is not mailed at all.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const loop = server.slice(
    server.indexOf('async function runAutoDocumentCheck()'),
    server.indexOf('setTimeout(runAutoDocumentCheck')
);

const { isSendableAddress } = require('../../utils/mailer');

describe('auto-document loop', () => {
    it('marks a student as sent — the write that never existed', () => {
        expect(server).toMatch(/documentsAutoSent:\s*true/);
        expect(server).toMatch(/async function markAutoDocumentsSent/);
    });

    it('marks them in the same pass as the send, not somewhere else later', () => {
        const send = loop.indexOf('sendAutoDocumentsToStudent');
        const mark = loop.indexOf('markAutoDocumentsSent(student._id)', send);
        expect(send).toBeGreaterThan(-1);
        expect(mark).toBeGreaterThan(send);
    });

    it('heals the backlog instead of mailing it one more time', () => {
        // Every existing student has the flag unset, so without this the first
        // pass after the fix would re-send to all of them.
        expect(loop).toMatch(/DocumentHistory\.exists\(\{ studentId: student\._id \}\)/);
        const heal = loop.indexOf('if (already)');
        const send = loop.indexOf('sendAutoDocumentsToStudent');
        expect(heal).toBeGreaterThan(-1);
        expect(heal).toBeLessThan(send);
    });

    it('does not mail an address that cannot receive', () => {
        expect(loop).toContain('isSendableAddress(student.email)');
    });
});

describe('isSendableAddress', () => {
    it('accepts real addresses', () => {
        for (const a of ['a@b.com', 'student.name@gmail.com', 'x+y@sub.domain.co.in']) {
            expect(isSendableAddress(a)).toBe(true);
        }
    });

    it('rejects what cannot be a mailbox', () => {
        for (const a of ['', null, undefined, 'no-at-sign', 'a@b', 'a b@c.com']) {
            expect(isSendableAddress(a)).toBe(false);
        }
    });

    it('rejects the domains RFC 2606 reserves', () => {
        for (const a of ['x@example.com', 'x@localhost', 'x@foo.test', 'x@a.invalid']) {
            expect(isSendableAddress(a)).toBe(false);
        }
    });

    it('does NOT guess from the local part', () => {
        // Real people are called Test, and abc.com is a registered domain.
        // Junk rows are HR's to delete, not a regex's to decide about — a false
        // positive silently denies a student their certificate.
        expect(isSendableAddress('test@abc.com')).toBe(true);
        expect(isSendableAddress('asdads@gmail.com')).toBe(true);
    });
});

describe('both send funnels use the guard', () => {
    it('the certificate mailer', () => {
        expect(fs.readFileSync(path.join(root, 'routes/v2/certificates.js'), 'utf8'))
            .toContain('isSendableAddress(toEmail)');
    });

    it('the notification mirror', () => {
        expect(fs.readFileSync(path.join(root, 'services/notificationEmail.js'), 'utf8'))
            .toContain('isSendableAddress(to)');
    });
});
