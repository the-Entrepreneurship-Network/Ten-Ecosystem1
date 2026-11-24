'use strict';

/**
 * populate runs the populated model's query as exec(callback), which returns
 * undefined. The model wrapper in server.js chained .catch on that and threw,
 * so the mentor and founder directories answered 500 while MongoDB was up.
 */
const fs = require('fs');
const path = require('path');
const guardedExec = require('../../utils/guardedExec');

test('a callback call passes straight through, as populate makes it', () => {
    const exec = jest.fn(function (cb) { cb(null, ['row']); });
    const onError = jest.fn();
    const cb = jest.fn();
    expect(() => guardedExec(exec, {}, [cb], onError)).not.toThrow();
    expect(cb).toHaveBeenCalledWith(null, ['row']);
    expect(onError).not.toHaveBeenCalled();
});

test('a promise call still gets the fallback on error', async () => {
    const exec = () => Promise.reject(new Error('connection lost'));
    await expect(guardedExec(exec, {}, [], () => 'from the file store')).resolves.toBe('from the file store');
});

test('every wrapped exec in server.js goes through the guard', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
    expect(src).not.toMatch(/Exec\.apply\(this, arguments\)\.catch\(/);
    expect((src.match(/guardedExec\(originalExec, this, arguments,/g) || []).length).toBeGreaterThanOrEqual(6);
});
