'use strict';

/*
 * public/my-documents.html: on Android, a PDF picked from Drive, WhatsApp or
 * another app is read by the browser only while it is being sent. When that
 * read fails, fetch() throws like a network error, and students with small
 * files on a good connection were told "Could not reach the server" on every
 * try. The page now reads the file first, says plainly when the phone will
 * not let it be read, and retries a dropped send once.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE = fs.readFileSync(path.join(__dirname, '../../public/my-documents.html'), 'utf8');

function loadUpload({ readFails = false, fetchImpl }) {
    const start = PAGE.indexOf('async function uploadFile(');
    expect(start).toBeGreaterThan(-1);
    const src = PAGE.slice(start, PAGE.indexOf('\nfunction animateBar(', start));
    const el = () => ({ style: {}, classList: { add() {} } });
    const ctx = {
        EMP_ID: 'X', uploaded: {}, locked: false, currentStatus: '',
        Swal: { fire: jest.fn() },
        document: { getElementById: el },
        animateBar() {}, showFilePreview() {}, updateSubmitBtn() {}, showBanner() {}, lockZones() {},
        Blob, FormData,
        fetch: jest.fn(fetchImpl),
    };
    vm.runInNewContext(src + '\nthis.uploadFile = uploadFile;', ctx);
    const file = {
        name: 'marksheet.pdf', type: 'application/pdf', size: 1024,
        arrayBuffer: readFails ? () => Promise.reject(new Error('NotReadableError')) : () => Promise.resolve(new ArrayBuffer(8)),
    };
    return { ctx, run: () => ctx.uploadFile('marksheet', file) };
}

const ok = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ success: true }) });

test('a file the phone will not let the browser read gets its own message, not "Could not reach the server"', async () => {
    const { ctx, run } = loadUpload({ readFails: true, fetchImpl: ok });
    await run();
    expect(ctx.fetch).not.toHaveBeenCalled();
    const msg = ctx.Swal.fire.mock.calls[0][0];
    expect(msg.text).not.toMatch(/reach the server/);
    expect(msg.text).toMatch(/Save it to your phone first/);
});

test('the file is read before sending, and a dropped send is retried once', async () => {
    let calls = 0;
    const { ctx, run } = loadUpload({ fetchImpl: () => (++calls === 1 ? Promise.reject(new TypeError('Failed to fetch')) : ok()) });
    await run();
    expect(ctx.fetch).toHaveBeenCalledTimes(2);
    expect(ctx.uploaded.marksheet).toBe(true);
    expect(ctx.fetch.mock.calls[0][1].body.get('file')).toBeInstanceOf(Blob);
});

test('a connection that fails twice still says so', async () => {
    const { ctx, run } = loadUpload({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
    await run();
    expect(ctx.fetch).toHaveBeenCalledTimes(2);
    expect(ctx.Swal.fire.mock.calls[0][0].text).toMatch(/Could not reach the server/);
});
