'use strict';

/**
 * My Documents' "Download Offer Letter" button opened a 404 for every student.
 *
 * GET /documents/my-status handed back the stored file path
 * (/uploads/offer-letters/<id>_offer_letter.pdf) as the link, and server.js
 * keeps that folder private, answering 404. The student must be given the
 * signed-in download route instead.
 */

const fs = require('fs');
const path = require('path');

const ROUTE = path.join(__dirname, '../../routes/v2/documents.js');
const PRIVATE = /\/uploads\/(offer-letters|certificates|loc)\//;

let studentDownloadLinks;
beforeAll(() => {
    jest.resetModules();
    ({ studentDownloadLinks } = require(ROUTE));
});

const student = { employeeId: 'TEN/AI/1' };

it('gives the signed-in download route for an issued offer letter', () => {
    const links = studentDownloadLinks({ offerLetterUrl: '/uploads/offer-letters/TEN-AI-1_offer_letter.pdf' }, student);
    expect(links.offer).toBe('/api/v2/certificates/download/OFFER?employeeId=TEN%2FAI%2F1');
    expect(links.offer).not.toMatch(PRIVATE);
});

it('does the same for the LOR and LOC, and nothing for letters not issued', () => {
    const links = studentDownloadLinks({
        lorUrl: '/uploads/certificates/TEN-AI-1_lor.pdf',
        locUrl: '/uploads/loc/TEN-AI-1_loc.pdf'
    }, student);
    expect(links.offer).toBeNull();
    expect(links.lor).toBe('/api/v2/certificates/download/LOR?employeeId=TEN%2FAI%2F1');
    expect(links.loc).toBe('/api/v2/certificates/download/LOC?employeeId=TEN%2FAI%2F1');
});

it('my-status sends those links, never the stored private path', () => {
    const src = fs.readFileSync(ROUTE, 'utf8');
    const start = src.indexOf('router.get("/documents/my-status"');
    const body = src.slice(start, src.indexOf('\n});\n', start));
    expect(body).toContain('studentDownloadLinks(doc, req.student)');
    expect(body).not.toMatch(/doc\.(offerLetterUrl|lorUrl|locUrl)\s*\|\|/);
});
