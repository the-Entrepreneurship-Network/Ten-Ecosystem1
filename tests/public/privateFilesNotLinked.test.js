'use strict';

/**
 * No student page links straight into the private document folders.
 *
 * Certificates, offer letters and letters of completion are private: server.js
 * answers 404 for /uploads/certificates, /uploads/offer-letters and
 * /uploads/loc, because the files carry names and dates and their paths are
 * guessable. They are served only by signed-in routes (for the course
 * certificates, /api/v2/certificates/course-pdf/:type).
 *
 * My Certificates linked straight to /uploads/certificates/<id>_expert.pdf,
 * so every Download was a 404 for every student. This keeps any page from
 * doing that again.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const PRIVATE_LINK = /['"`]\/uploads\/(certificates|offer-letters|loc)\//;

function pages(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return /-portal$/.test(e.name) ? [] : pages(full);   // built React bundles
        return /\.(html|js)$/.test(e.name) ? [full] : [];
    });
}

it('no page links to a private document file', () => {
    const offenders = pages(PUBLIC)
        .filter((f) => PRIVATE_LINK.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(PUBLIC, f));
    expect(offenders).toEqual([]);
});

it('the server still keeps those folders private', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    expect(server).toContain('const UPLOADS_PRIVATE = /(^|\\/)(local_db|\\.env|certificates|offer-letters|loc|documents)(\\/|$)/i;');
});

it('the old My Certificates link would have been caught', () => {
    // The exact line that made every Download a 404.
    expect(PRIVATE_LINK.test("const pdfUrl = `/uploads/certificates/${path.basename(outPath)}`;")).toBe(true);
});

/*
 * The broken link did not come from a page: the server built it and the page
 * opened what it was given. So the two places that hand a student a document
 * link are held to the same rule.
 */
const src = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const handler = (code, start) => {
    const at = code.indexOf(start);
    expect(at).toBeGreaterThan(-1);
    return code.slice(at, code.indexOf('\nrouter.', at + 1));
};

it('a course certificate is handed out as the signed-in route', () => {
    const code = src('routes/v2/certificates.js');
    const issuer = code.slice(code.indexOf('async function issueCoursePdf('), code.indexOf('// CERTIFICATE ROUTES'));
    expect(issuer).not.toMatch(PRIVATE_LINK);
    expect(issuer).toContain('const pdfUrl = `/api/v2/certificates/course-pdf/${type}`;');
});

it('the documents API hands out signed-in download links, and finds the real files', () => {
    const h = handler(src('routes/v2/documents.js'), 'router.get("/documents/my-certificates"');
    expect(h).not.toMatch(PRIVATE_LINK);
    expect(h).toContain('/api/v2/certificates/download/${type}?employeeId=');
    // The raw Employee ID has slashes; certificateFile knows the real file names.
    expect(h).toContain('certFile.findFor(student, "LOC")');
});
