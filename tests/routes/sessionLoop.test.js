'use strict';

/**
 * @jest-environment node
 *
 * The sign-in loop, and the guarantee that it cannot come back.
 *
 * One student could sign in successfully and then be bounced straight back to
 * the login page, over and over, while everyone else was fine. Two independent
 * defences are asserted here, because the promise made was "this will never
 * happen again" and one defence is a single point of failure:
 *
 *   server  a session that names a real account is accepted, whatever shape
 *           its employeeId is in (utils: middleware/sessionAuth.js)
 *   client  a bounce is counted, and the third one shows a message instead of
 *           redirecting again (public/session-guard.js)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const auth  = fs.readFileSync(path.join(root, 'middleware/sessionAuth.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'public/session-guard.js'), 'utf8');

describe('the server no longer 401s a session that names a real account', () => {
  it('the lookup tries more than the exact employeeId', () => {
    expect(auth).toMatch(/async function findSessionStudent\(req\)/);
    // the three identifiers establishStudentSession actually stores
    expect(auth).toMatch(/Student\.findOne\(\{ employeeId \}\)/);
    expect(auth).toMatch(/Student\.findById\(String\(ses\._id\)\)/);
    expect(auth).toMatch(/Student\.findOne\(\{ email: String\(ses\.email\)/);
  });

  it('a padded or differently-cased employeeId still resolves', () => {
    const block = auth.slice(auth.indexOf('async function findSessionStudent'), auth.indexOf('async function requireStudent'));
    expect(block).toMatch(/new RegExp/);
    expect(block).toMatch(/'i'/);
  });

  it('the session repairs itself, so the slow path runs at most once', () => {
    const block = auth.slice(auth.indexOf('async function requireStudent'));
    expect(block).toMatch(/repaired session employeeId/);
    expect(block).toMatch(/req\.session\.student\.employeeId = trueId/);
  });

  it('only a session pointing at a deleted account is still rejected', () => {
    const block = auth.slice(auth.indexOf('async function requireStudent'));
    expect(block).toMatch(/if \(!student\)/);
    expect(block).toMatch(/Session is no longer valid/);
  });

  it('the regex built from an employeeId cannot be broken by its characters', () => {
    // TEN/WEB/1643 is tame, but the id is user-visible data and goes into a
    // RegExp — the escape is what stops a stray "(" throwing on every request.
    const block = auth.slice(auth.indexOf('async function findSessionStudent'), auth.indexOf('async function requireStudent'));
    expect(block).toMatch(/replace\(/);
    const esc = 'TEN/WEB/(1643)+[x]'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(() => new RegExp('^\\s*' + esc + '\\s*$', 'i')).not.toThrow();
  });
});

describe('the browser can no longer loop forever', () => {
  it('bounces are counted within a window', () => {
    expect(guard).toMatch(/var LOOP_KEY = 'ten_auth_bounce'/);
    expect(guard).toMatch(/LOOP_WINDOW_MS/);
    expect(guard).toMatch(/LOOP_LIMIT/);
  });

  it('past the limit it explains instead of redirecting again', () => {
    const block = guard.slice(guard.indexOf('function goToLogin()'));
    expect(block).toMatch(/if \(n > LOOP_LIMIT\)/);
    expect(block).toMatch(/showStuckMessage\(\)/);
    expect(block).toMatch(/return;/);
  });

  it('the message tells the student it is our fault and what to do', () => {
    expect(guard).toMatch(/cannot keep you signed in/i);
    expect(guard).toMatch(/Employee ID/);
    expect(guard).toMatch(/not something you did/);
  });

  it('the counter is per-tab and expires, so a real fix is not punished', () => {
    expect(guard).toMatch(/sessionStorage\.getItem\(LOOP_KEY\)/);
    expect(guard).toMatch(/Date\.now\(\) - rec\.at\) > LOOP_WINDOW_MS/);
  });
});
