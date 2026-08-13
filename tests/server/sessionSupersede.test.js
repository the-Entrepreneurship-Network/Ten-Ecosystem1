'use strict';

/**
 * The single-session guard must not lock a signed-in student out.
 *
 * A student signing in with their email has two records — an EcosystemUser and
 * a legacy Student — and the session identifies them by their STUDENT id. The
 * guard used to look the id up as an EcosystemUser, miss, fall through to the
 * Student, and compare the token that login had just written to the
 * EcosystemUser against whatever stale token the Student row still held. Every
 * /api call came back 401 SESSION_SUPERSEDED; the portal reads a 401 as a
 * sign-out, so the student was thrown back to the login page — on every
 * attempt, forever, because each retry reproduced the same mismatch. That is
 * the loop in the video the owner sent: sign in, "Access Granted", black
 * screen, sign-in page again.
 *
 * The rule is asserted against the function server.js actually runs, lifted
 * out of the file so the test cannot drift from the implementation.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

function lift(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server.js`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

// eslint-disable-next-line no-new-func
const { sessionIsSuperseded } = new Function(`
  ${lift('sessionIsSuperseded')}
  return { sessionIsSuperseded };
`)();

const FRESH = 'ten_sess_fresh';
const STALE = 'ten_sess_stale';

describe('the bug that locked students out', () => {
  it('accepts a session whose token matches EITHER record', () => {
    // The EcosystemUser has the token login just minted; the Student row is
    // still carrying one from an earlier sign-in. This is the exact state that
    // produced the loop.
    expect(sessionIsSuperseded(FRESH, [FRESH, STALE])).toBe(false);
  });

  it('accepts when only the Student row carries the current token', () => {
    expect(sessionIsSuperseded(FRESH, [null, FRESH])).toBe(false);
  });

  it('accepts when only the EcosystemUser carries it', () => {
    expect(sessionIsSuperseded(FRESH, [FRESH, null])).toBe(false);
  });
});

describe('nothing on record means nothing has superseded the session', () => {
  it.each([
    [[]],
    [[null, null]],
    [[undefined]],
    [['']]
  ])('%p', (known) => {
    expect(sessionIsSuperseded(FRESH, known)).toBe(false);
  });

  it('does not reject a request that carries no token at all', () => {
    // /student-login used not to set one. A request with no token is simply
    // outside this guard's remit, not a superseded session.
    expect(sessionIsSuperseded('', [FRESH])).toBe(false);
    expect(sessionIsSuperseded(undefined, [FRESH])).toBe(false);
  });
});

describe('a genuinely replaced session is still rejected', () => {
  it('rejects when both records moved on', () => {
    // Signed in from another device: both records hold the new token, this
    // request is still presenting the old one.
    expect(sessionIsSuperseded(STALE, [FRESH, FRESH])).toBe(true);
  });

  it('rejects when the only record on file moved on', () => {
    expect(sessionIsSuperseded(STALE, [FRESH])).toBe(true);
    expect(sessionIsSuperseded(STALE, [null, FRESH])).toBe(true);
  });
});
