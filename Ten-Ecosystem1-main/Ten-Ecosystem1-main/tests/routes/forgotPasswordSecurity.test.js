'use strict';

/**
 * The forgot-password endpoint, pinned against the four ways it was unsafe.
 *
 * These are source-level assertions rather than HTTP tests because the handler
 * lives inside server.js, which opens a database and a mail transport on
 * require. The properties being protected are structural — a fallback lookup
 * that must not exist, a create that must not exist, one response shape, and
 * two limits — and a well-meaning edit that reintroduces any of them changes
 * this file's subject matter, not its plumbing.
 *
 * What was here before, and what each test exists to stop coming back:
 *
 *   1. If the address was unknown, the handler loaded the newest student in
 *      the database, put a reset token on that student's account, and mailed
 *      the working link to the address the caller typed. Account takeover for
 *      anyone who can read a form.
 *   2. If no student existed at all, it created one from the request body —
 *      unauthenticated writes from a public endpoint.
 *   3. A different reply for known and unknown addresses turns the endpoint
 *      into a membership oracle; 800 student addresses are enumerable.
 *   4. A per-account cap alone leaves an attacker free to walk a list of
 *      addresses, so there is a ceiling on the caller as well.
 */

const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const mailer = fs.readFileSync(path.join(__dirname, '../../utils/mailer.js'), 'utf8');

/** The body of the forgot-password handler, isolated from the rest of server.js. */
function forgotPasswordHandler() {
  const start = server.indexOf('app.post("/auth/forgot-password"');
  expect(start).toBeGreaterThan(-1);
  const end = server.indexOf('app.post("/auth/reset-password"', start);
  expect(end).toBeGreaterThan(start);
  return server.slice(start, end);
}

describe('forgot password cannot hand over somebody else\'s account', () => {
  it('never falls back to another user when the address is unknown', () => {
    const body = forgotPasswordHandler();
    // The exact shape of the takeover: newest row in the collection, used as
    // the reset target for an address that did not match it.
    expect(body).not.toMatch(/Student\.findOne\(\{\s*\}\)/);
    expect(body).not.toMatch(/sort\(\s*\{\s*createdAt:\s*-1\s*\}\s*\)/);
  });

  it('returns early instead of continuing with no user', () => {
    const body = forgotPasswordHandler();
    expect(body).toMatch(/if\s*\(!user\)\s*return/);
  });

  it('never creates an account from an unauthenticated request', () => {
    const body = forgotPasswordHandler();
    expect(body).not.toMatch(/new Student\(/);
    expect(body).not.toMatch(/Test Student/);
  });
});

describe('forgot password does not reveal who is registered', () => {
  it('answers with one response on every path', () => {
    const body = forgotPasswordHandler();
    expect(body).toMatch(/uniformResponse/);
    // "If that account exists" is the whole point: it must not be paired with
    // a second, different message for the not-found case.
    expect(body).not.toMatch(/not\s+registered|no account with that email|user not found/i);
  });

  it('sends the same wording whether or not the account exists', () => {
    const body = forgotPasswordHandler();
    const occurrences = (body.match(/If that account exists/g) || []).length;
    // Exactly one literal, reached from every branch via uniformResponse().
    expect(occurrences).toBe(1);
  });
});

describe('forgot password is capped twice over', () => {
  it('caps each account at two links a day, counted from mail history', () => {
    const body = forgotPasswordHandler();
    expect(body).toMatch(/mailType:\s*"password_reset"/);
    expect(body).toMatch(/sentToday\s*>=\s*2/);
  });

  it('caps the caller as well as the account', () => {
    expect(server).toMatch(/const forgotPasswordLimiter = rateLimit\(/);
    expect(server).toMatch(/app\.post\("\/auth\/forgot-password",\s*forgotPasswordLimiter/);
  });
});

describe('the From address exists', () => {
  it('is exported, because seven call sites already import it', () => {
    expect(mailer).toMatch(/EMAIL_FROM/);
    expect(mailer).toMatch(/module\.exports\s*=\s*\{[^}]*EMAIL_FROM/s);
  });

  it('is in scope where the password reset uses it', () => {
    expect(server).toMatch(/const \{ createEmailTransporter, EMAIL_FROM \} = require\("\.\/utils\/mailer"\)/);
  });
});
