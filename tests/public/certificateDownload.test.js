'use strict';

/**
 * The Download PDF button on the certificate reveal overlay.
 *
 * It called downloadCurrentCert(), which opened `currentPdfUrl` and did
 * nothing whatsoever when that was null. Two of the three ways a student
 * reaches that overlay never set it:
 *
 *   claimCert()     -> "payment coming soon" branch -> triggerRevealAnimation()
 *   checkTriggers() -> EXPERT/NANO_CERT_UNLOCKED    -> triggerRevealAnimation()
 *
 * Payments are off, so the first of those is the normal path. The button was
 * dead for most students who saw it, and dead in silence.
 *
 * These tests run the real functions out of the page rather than grepping its
 * source: a button that does nothing is exactly the bug a source assertion
 * cannot see.
 */

const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(
    path.join(__dirname, '../..', 'public/my-certificates.html'), 'utf8');

/**
 * Lift one function out of the page by counting braces.
 *
 * Deliberately not a regex over the whole body: a regex either stops at the
 * first `}` inside the function or needs to be clever enough to be its own
 * bug. Counting is boring and survives reformatting.
 */
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
    lift('async function downloadCert'),
    lift('function downloadCurrentCert'),
].join('\n');

/**
 * Build the three functions over a fake browser.
 *
 * Returns the functions plus the spy state, so a test asserts on what the
 * page actually did: which URL was opened, whether the server was called,
 * and whether the student was told anything when it failed.
 */
function load({ pdfUrl = null, type = 'expert', reply, popupBlocked = false } = {}) {
    const seen = { opened: [], navigated: [], fetched: [], alerts: [] };

    const win = {
        open: (url) => { seen.opened.push(url); return popupBlocked ? null : {}; },
        get location() { return { set href(u) { seen.navigated.push(u); } }; },
    };
    // `window.location.href = u` and a bare `location.href = u` are the same
    // thing in a page; the harness has to offer both or the fallback looks
    // broken when it is not.
    const loc = { set href(u) { seen.navigated.push(u); } };

    const fetchStub = async (url, opts) => {
        seen.fetched.push({ url, opts });
        if (reply instanceof Error) throw reply;
        return { json: async () => reply };
    };

    const Swal = { fire: (o) => seen.alerts.push(o) };

    const make = new Function(
        'window', 'location', 'fetch', 'Swal', 'EMP_ID',
        'currentPdfUrl', 'currentRevealType',
        `${SOURCE}
         return { openPdf, downloadCert, downloadCurrentCert,
                  peek: () => currentPdfUrl };`
    );

    return { fns: make(win, loc, fetchStub, Swal, 'EMP-1', pdfUrl, type), seen };
}

const OK = { success: true, pdfUrl: 'https://cdn.example/cert-expert.pdf' };

describe('the Download PDF button on the reveal overlay', () => {
    test('THE BUG: with no PDF yet it generates one instead of doing nothing', async () => {
        const { fns, seen } = load({ pdfUrl: null, reply: OK });

        await fns.downloadCurrentCert();

        expect(seen.fetched).toHaveLength(1);
        expect(seen.fetched[0].url).toBe('/api/v2/certificates/generate-pdf/expert');
        expect(seen.fetched[0].opts.method).toBe('POST');
        expect(seen.opened).toEqual([OK.pdfUrl]);
    });

    test('it asks for the certificate the overlay is actually showing', async () => {
        const { fns, seen } = load({ pdfUrl: null, type: 'nano_degree', reply: OK });

        await fns.downloadCurrentCert();

        expect(seen.fetched[0].url).toBe('/api/v2/certificates/generate-pdf/nano_degree');
        expect(fns.peek()).toBe(OK.pdfUrl);   // remembered, so a second click is free
    });

    test('an already-made PDF opens straight away, with no second round trip', async () => {
        const { fns, seen } = load({ pdfUrl: 'https://cdn.example/old.pdf' });

        await fns.downloadCurrentCert();

        expect(seen.fetched).toHaveLength(0);
        expect(seen.opened).toEqual(['https://cdn.example/old.pdf']);
    });
});

describe('downloadCert, which the certificate list calls directly', () => {
    test("the string 'null' from the template counts as no PDF", async () => {
        // The list renders onclick="downloadCert('${record.pdfUrl}', ...)", so a
        // missing URL arrives as the four characters n-u-l-l, which is truthy.
        const { fns, seen } = load({ reply: OK });

        await fns.downloadCert('null', 'expert');

        expect(seen.fetched).toHaveLength(1);
        expect(seen.opened).toEqual([OK.pdfUrl]);
    });

    test('a blocked popup falls back to navigating, not to nothing', async () => {
        const { fns, seen } = load({ reply: OK, popupBlocked: true });

        await fns.downloadCert(null, 'expert');

        expect(seen.opened).toEqual([OK.pdfUrl]);        // it tried
        expect(seen.navigated).toEqual([OK.pdfUrl]);     // and recovered
    });

    test('a refused generation tells the student, and does not throw', async () => {
        const { fns, seen } = load({ reply: { success: false, message: 'Not eligible yet.' } });

        await expect(fns.downloadCert(null, 'expert')).resolves.toBeUndefined();

        expect(seen.opened).toHaveLength(0);
        expect(seen.alerts).toHaveLength(1);
        expect(seen.alerts[0].text).toBe('Not eligible yet.');
        expect(seen.alerts[0].icon).toBe('error');
    });

    test('a success with no URL is still a failure, and says so', async () => {
        const { fns, seen } = load({ reply: { success: true } });

        await fns.downloadCert(null, 'expert');

        expect(seen.opened).toHaveLength(0);
        expect(seen.alerts).toHaveLength(1);
    });

    test('a dropped network connection reaches the student too', async () => {
        const { fns, seen } = load({ reply: new Error('Failed to fetch') });

        await fns.downloadCert(null, 'expert');

        expect(seen.alerts).toHaveLength(1);
        expect(seen.alerts[0].text).toBe('Failed to fetch');
    });
});
