'use strict';

/**
 * Downloading a course certificate from My Certificates.
 *
 * Every Download button was a 404. The page opened the PDF's file path,
 * /uploads/certificates/<id>_expert.pdf, but certificate files are private:
 * server.js turns that whole directory away (they carry names and dates, and
 * the paths are guessable). The PDF now comes from the signed-in route,
 * GET /api/v2/certificates/course-pdf/:type, which checks the student earned
 * and paid for it and makes the PDF on first download.
 *
 * The reveal overlay's main button downloads a certificate the student owns,
 * and otherwise sends them to the checkout.
 *
 * These run the real functions out of the page rather than grepping its
 * source: a button that does nothing is exactly the bug a source assertion
 * cannot see.
 */

const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(
    path.join(__dirname, '../..', 'public/my-certificates.html'), 'utf8');

/** Lift one function out of the page by counting braces. */
function lift(name) {
    const start = PAGE.indexOf(name);
    if (start === -1) throw new Error(`${name} is gone from my-certificates.html`);
    let depth = 0;
    for (let i = PAGE.indexOf('{', start); i < PAGE.length; i += 1) {
        if (PAGE[i] === '{') depth += 1;
        else if (PAGE[i] === '}') {
            depth -= 1;
            if (depth === 0) return PAGE.slice(start, i + 1);
        }
    }
    throw new Error(`${name} never closes`);
}

const SOURCE = [
    lift('function openPdf'),
    lift('function downloadCert('),
    lift('function downloadCurrentCert'),
].join('\n');

function load({ type = 'expert', covered = false, popupBlocked = false } = {}) {
    const seen = { opened: [], navigated: [] };
    const win = {
        open: (url) => { seen.opened.push(url); return popupBlocked ? null : {}; },
        get location() { return { set href(u) { seen.navigated.push(u); } }; },
    };
    const loc = { set href(u) { seen.navigated.push(u); } };
    const certData = { feeSettled: { [type]: { covered } } };
    const make = new Function('window', 'location', 'certData', 'currentRevealType',
        `${SOURCE}
         return { downloadCert, downloadCurrentCert };`);
    return { fns: make(win, loc, certData, type), seen };
}

describe('the Download Certificate button', () => {
    test('THE BUG: it opens the signed-in route, never the private file path', () => {
        const { fns, seen } = load();
        fns.downloadCert('expert');
        expect(seen.opened).toEqual(['/api/v2/certificates/course-pdf/expert']);
        expect(PAGE).not.toMatch(/openPdf\([^)]*uploads\/certificates/);
    });

    test('a blocked popup falls back to navigating, not to nothing', () => {
        const { fns, seen } = load({ popupBlocked: true });
        fns.downloadCert('nano_degree');
        expect(seen.opened).toEqual(['/api/v2/certificates/course-pdf/nano_degree']);
        expect(seen.navigated).toEqual(['/api/v2/certificates/course-pdf/nano_degree']);
    });
});

describe('the reveal overlay button', () => {
    test('downloads a certificate the student owns', () => {
        const { fns, seen } = load({ type: 'fellowship', covered: true });
        fns.downloadCurrentCert();
        expect(seen.opened).toEqual(['/api/v2/certificates/course-pdf/fellowship']);
    });

    test('sends a student who has not paid to the checkout, which starts with the benefits', () => {
        const { fns, seen } = load({ type: 'expert', covered: false });
        fns.downloadCurrentCert();
        expect(seen.opened).toHaveLength(0);
        expect(seen.navigated).toEqual(['/certificate-checkout.html?type=expert']);
    });
});
