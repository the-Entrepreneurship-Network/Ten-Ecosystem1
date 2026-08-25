'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../public/js/resume-upload.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

// Load the browser module into a sandbox that looks enough like a page.
// `fetch` is swapped per-test so the response handling can be exercised for
// real rather than asserted against by reading the source.
function load(fetchImpl) {
    const sandbox = {
        window: {},
        fetch: fetchImpl,
        FormData: class { append() {} },
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        setTimeout,
        clearTimeout,
        console
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(SOURCE, sandbox);
    return sandbox.window.TENResumeUpload;
}

const file = (name, type, size) => ({ name, type, size: size === undefined ? 200 * 1024 : size });

// A response that is NOT JSON — an nginx error page, which is what actually
// arrives when a request is refused in front of the app.
const htmlResponse = (status) => ({
    ok: false,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))
});

describe('public/js/resume-upload.js — validate', () => {
    const api = load(() => Promise.reject(new Error('not used')));

    it('accepts a PDF the browser labels correctly', () => {
        expect(api.validate(file('resume.pdf', 'application/pdf'))).toBeNull();
    });

    /*
     * The reported bug. An Android file picker hands over a PDF from WhatsApp,
     * Drive or Gmail labelled `application/octet-stream`, and the old check
     * compared that label against 'application/pdf' and refused a real resume
     * before it ever left the phone.
     */
    it('accepts a PDF the phone labels application/octet-stream', () => {
        expect(api.validate(file('resume.pdf', 'application/octet-stream'))).toBeNull();
    });

    it('accepts a PDF the phone gives no label at all', () => {
        expect(api.validate(file('resume.pdf', ''))).toBeNull();
    });

    it('accepts an uppercase .PDF extension', () => {
        expect(api.validate(file('RESUME.PDF', 'application/pdf'))).toBeNull();
    });

    it('refuses a file that is not named .pdf', () => {
        expect(api.validate(file('resume.docx', 'application/msword'))).toMatch(/PDF/i);
    });

    it('refuses a file whose label contradicts the extension', () => {
        expect(api.validate(file('resume.pdf', 'image/png'))).toMatch(/not a PDF/i);
    });

    it('refuses an empty file', () => {
        expect(api.validate(file('resume.pdf', 'application/pdf', 0))).toMatch(/empty/i);
    });

    it('refuses a file over 5MB and says how big it is', () => {
        const msg = api.validate(file('resume.pdf', 'application/pdf', 6 * 1024 * 1024));
        expect(msg).toMatch(/5MB/);
        expect(msg).toMatch(/6\.0MB/);
    });
});

describe('public/js/resume-upload.js — upload', () => {
    const good = file('resume.pdf', 'application/pdf');

    it('returns the saved path on success', async () => {
        const api = load(() => Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ success: true, filePath: '/uploads/documents/resume-1.pdf' })
        }));
        await expect(api.upload(good)).resolves.toEqual({ ok: true, filePath: '/uploads/documents/resume-1.pdf' });
    });

    /*
     * This is what produced "Upload failed. Tap to retry." for every cause
     * alike: the old code did a bare `await res.json()`, so an HTML error page
     * threw inside the parse and the catch printed one generic line.
     */
    it('explains a 413 that arrives as an HTML page, not JSON', async () => {
        const api = load(() => Promise.resolve(htmlResponse(413)));
        const result = await api.upload(good);
        expect(result.ok).toBe(false);
        expect(result.status).toBe(413);
        expect(result.message).toMatch(/too large/i);
    });

    it('explains a rate limit rather than calling it a failure', async () => {
        const api = load(() => Promise.resolve(htmlResponse(429)));
        expect((await api.upload(good)).message).toMatch(/too many/i);
    });

    it('explains a restarting server', async () => {
        const api = load(() => Promise.resolve(htmlResponse(502)));
        expect((await api.upload(good)).message).toMatch(/busy or restarting/i);
    });

    it('passes the server’s own message through when it sends one', async () => {
        const api = load(() => Promise.resolve({
            ok: false, status: 400,
            json: () => Promise.resolve({ success: false, message: 'That file is not a real PDF.' })
        }));
        expect((await api.upload(good)).message).toBe('That file is not a real PDF.');
    });

    // A phone changing towers mid-upload is the ordinary condition this form is
    // filled in under, and one retry is the difference between a lost
    // registration and none.
    it('retries once when the connection drops, then succeeds', async () => {
        let calls = 0;
        const api = load(() => {
            calls++;
            if (calls === 1) return Promise.reject(new TypeError('Failed to fetch'));
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, filePath: '/p.pdf' }) });
        });
        await expect(api.upload(good)).resolves.toEqual({ ok: true, filePath: '/p.pdf' });
        expect(calls).toBe(2);
    });

    it('gives up after the second network failure, and says so', async () => {
        let calls = 0;
        const api = load(() => { calls++; return Promise.reject(new TypeError('Failed to fetch')); });
        const result = await api.upload(good);
        expect(calls).toBe(2);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/could not reach the server/i);
    });

    // A refusal is settled: asking again gets the same answer and only costs
    // the student time.
    it('does not retry a refusal', async () => {
        let calls = 0;
        const api = load(() => { calls++; return Promise.resolve(htmlResponse(413)); });
        await api.upload(good);
        expect(calls).toBe(1);
    });

    it('never reaches the network for a file it can reject on the device', async () => {
        let calls = 0;
        const api = load(() => { calls++; return Promise.resolve(htmlResponse(200)); });
        expect((await api.upload(file('resume.docx', 'application/msword'))).rejected).toBe(true);
        expect(calls).toBe(0);
    });
});

describe('server.js — /api/v2/upload-resume', () => {
    // Assert against the source with its comments stripped, so a sentence in a
    // comment cannot satisfy a test about the code.
    const code = SERVER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('accepts the mimetypes a phone actually sends for a PDF', () => {
        expect(code).toContain("type === 'application/octet-stream'");
        expect(code).toMatch(/!type \|\| type === 'application\/pdf'/);
    });

    it('still requires a .pdf extension', () => {
        expect(code).toMatch(/\/\\\.pdf\$\/i\.test\(file\.originalname/);
    });

    // The leading bytes are the one claim about an upload that cannot be
    // forged, and they are what lets the mimetype check above be lenient.
    it('verifies the saved file really begins %PDF-', () => {
        expect(code).toContain("head.toString('latin1') !== '%PDF-'");
    });

    it('deletes a file that is not a PDF instead of leaving it on disk', () => {
        expect(code).toMatch(/head\.toString\('latin1'\) !== '%PDF-'\)\s*\{\s*fs\.unlink\(req\.file\.path/);
    });

    // Without a success line, an upload that never reached the app looks
    // exactly like one the app refused.
    it('logs both outcomes so a failure can be located', () => {
        expect(code).toContain("console.log('[Resume] ✓ saved'");
        expect(code).toContain("console.warn('[Resume] rejected:'");
    });
});

describe('the registration pages use the shared uploader', () => {
    const pages = ['register.html', 'coordinator-register.html'];

    it.each(pages)('%s loads /js/resume-upload.js', (page) => {
        const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
        expect(html).toContain('<script src="/js/resume-upload.js"></script>');
    });

    it.each(pages)('%s validates and uploads through it', (page) => {
        const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
        expect(html).toContain('TENResumeUpload.validate(file)');
        expect(html).toContain('await TENResumeUpload.upload(file)');
    });

    // Both pages had their own copy of the mimetype check, and so had their own
    // copy of the bug. Neither should own one again.
    it.each(pages)('%s no longer compares file.type itself', (page) => {
        const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
        expect(html).not.toContain("file.type !== 'application/pdf'");
    });

    it.each(pages)('%s shows the reason instead of one generic line', (page) => {
        const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
        expect(html).not.toContain("'Upload failed. Tap to retry.'");
        expect(html).toContain('fail(result.message)');
    });

    /*
     * SweetAlert is a CDN script. A network that cannot reach jsdelivr — a
     * campus firewall, a bad DNS answer — makes `Swal.fire` throw, and when the
     * throw came before the message was written the form answered the student's
     * file by doing nothing at all.
     */
    it.each(pages)('%s writes the reason before it tries the popup', (page) => {
        const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
        const written = html.indexOf('fail(invalid);');
        const popup = html.indexOf("title: 'Resume Not Accepted'");
        expect(written).toBeGreaterThan(-1);
        expect(popup).toBeGreaterThan(written);
    });

    it.each(pages)('%s survives SweetAlert being unavailable', (page) => {
        const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
        expect(html).toMatch(/try \{\s+Swal\.fire\(\{[\s\S]*?\}\);\s+\} catch \(_\) \{\}/);
    });
});
