'use strict';

/**
 * Why an active student was suddenly told their account did not exist.
 *
 * Students who had been marking attendance and submitting tasks for weeks would
 * try to sign in and be refused. Nothing was wrong with their accounts — the
 * lookup could not find them. Each case below is one of the ways that happened,
 * and each would silently return "Invalid Employee ID" or "Invalid credentials"
 * for a perfectly good account.
 */

const {
  normalizeEmployeeId,
  looksLikeEmail,
  findStudentByEmployeeId,
  findStudentByEmail,
  nextFailedAttemptCount
} = require('../../services/loginIdentity');

/** A stand-in Student model backed by a plain array. */
function modelOf(rows) {
  const matches = (stored, filterValue) =>
    filterValue instanceof RegExp ? filterValue.test(stored) : stored === filterValue;

  const find = (filter) => rows.filter(r =>
    Object.keys(filter).every(k => matches(r[k], filter[k])));

  return {
    calls: [],
    findOne(filter) {
      this.calls.push(filter);
      return Promise.resolve(find(filter)[0] || null);
    },
    find(filter) {
      this.calls.push(filter);
      const result = find(filter);
      const q = {
        sort: (spec) => {
          const key = Object.keys(spec)[0];
          result.sort((a, b) => (spec[key] > 0 ? 1 : -1) * (new Date(a[key]) - new Date(b[key])));
          return q;
        },
        limit: () => q,
        then: (res, rej) => Promise.resolve(result).then(res, rej)
      };
      return q;
    }
  };
}

const STUDENT = { _id: 's1', employeeId: 'TEN/WEB/1005', email: 'aisha@example.com' };

describe('an employee ID identifies a person, not a keystroke sequence', () => {
  let model;
  beforeEach(() => { model = modelOf([STUDENT]); });

  it('finds the exact ID, and does it on the first query', async () => {
    const found = await findStudentByEmployeeId(model, 'TEN/WEB/1005');
    expect(found).toBe(STUDENT);
    // The common path must stay a single indexed lookup.
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]).toEqual({ employeeId: 'TEN/WEB/1005' });
  });

  it.each([
    ['ten/web/1005',   'a phone keyboard that lowercases'],
    ['Ten/Web/1005',   'autocapitalised words'],
    ['TEN/WEB/1005 ',  'a trailing space from autocomplete'],
    ['  TEN/WEB/1005', 'a leading space from a paste'],
    ['TEN-WEB-1005',   'the separator used in document numbers'],
    ['ten-web-1005',   'both at once'],
    ['TEN WEB 1005',   'spaces read off a certificate'],
    ['TEN_WEB_1005',   'an underscore'],
  ])('finds it typed as %p — %s', async (typed) => {
    expect(await findStudentByEmployeeId(model, typed)).toBe(STUDENT);
  });

  it('still refuses an ID that is genuinely not there', async () => {
    expect(await findStudentByEmployeeId(model, 'TEN/WEB/9999')).toBeNull();
  });

  it('does not match a DIFFERENT student whose ID merely looks similar', async () => {
    // The tolerance must not become a wildcard.
    const two = modelOf([STUDENT, { _id: 's2', employeeId: 'TEN/WEB/10050' }]);
    const found = await findStudentByEmployeeId(two, 'ten/web/1005');
    expect(found._id).toBe('s1');
  });

  it.each(['', '   ', null, undefined])('refuses an empty identifier (%p)', async (v) => {
    expect(await findStudentByEmployeeId(model, v)).toBeNull();
  });
});

describe('email lookup is case-insensitive', () => {
  it('finds a row stored with the old mixed-case convention', async () => {
    // The exact-lowercase match this replaced could never find these, so a
    // student with no EcosystemUser record could not sign in by email at all.
    const legacy = { _id: 's9', email: 'Aisha@Gmail.com' };
    const model = modelOf([legacy]);
    expect(await findStudentByEmail(model, 'aisha@gmail.com')).toBe(legacy);
  });

  it('finds a lowercase row from a mixed-case entry', async () => {
    const model = modelOf([STUDENT]);
    expect(await findStudentByEmail(model, 'Aisha@Example.com')).toBe(STUDENT);
  });

  it('picks the same record every time for a dual-domain student', async () => {
    // Two rows, one password. Whichever is chosen must be stable between
    // sign-ins, or the session token lands on a different row each time.
    const first  = { _id: 'a', email: 'dual@x.com', createdAt: '2026-01-01' };
    const second = { _id: 'b', email: 'Dual@X.com', createdAt: '2026-05-01' };
    const model = modelOf([second, first]);
    expect((await findStudentByEmail(model, 'DUAL@x.com'))._id).toBe('a');
  });

  it('returns nothing for an unknown address', async () => {
    expect(await findStudentByEmail(modelOf([STUDENT]), 'nobody@x.com')).toBeNull();
  });
});

describe('normalizeEmployeeId', () => {
  it.each([
    ['TEN/WEB/1005', 'TEN/WEB/1005'],
    ['ten-web-1005', 'TEN/WEB/1005'],
    ['  TEN WEB 1005  ', 'TEN/WEB/1005'],
    ['TEN//WEB//1005', 'TEN/WEB/1005'],
    ['/TEN/WEB/1005/', 'TEN/WEB/1005']
  ])('%p → %p', (input, expected) => {
    expect(normalizeEmployeeId(input)).toBe(expected);
  });
});

describe('looksLikeEmail', () => {
  it.each([
    ['aisha@example.com', true],
    ['TEN/WEB/1005', false],
    ['', false]
  ])('%p → %p', (v, expected) => expect(looksLikeEmail(v)).toBe(expected));
});

describe('the lockout counter decays', () => {
  const WINDOW = 30 * 60 * 1000;

  it('starts at one for an account that has never failed', () => {
    expect(nextFailedAttemptCount({}, WINDOW)).toBe(1);
  });

  it('counts up within the window', () => {
    expect(nextFailedAttemptCount(
      { failedLoginAttempts: 2, lastFailedLoginAt: new Date(Date.now() - 60 * 1000) },
      WINDOW
    )).toBe(3);
  });

  it('starts over once the window has passed', () => {
    // The bug this fixes: two mistyped passwords in June plus three in August
    // used to add up to a lockout, and nothing told the student why.
    expect(nextFailedAttemptCount(
      { failedLoginAttempts: 4, lastFailedLoginAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      WINDOW
    )).toBe(1);
  });

  it('still locks a real burst of guesses', () => {
    // Five in quick succession must reach the threshold — the decay must not
    // weaken the protection it exists for.
    let user = {};
    let n = 0;
    for (let i = 0; i < 5; i++) {
      n = nextFailedAttemptCount(user, WINDOW);
      user = { failedLoginAttempts: n, lastFailedLoginAt: new Date() };
    }
    expect(n).toBe(5);
  });

  it('counts up when the timestamp is missing, rather than resetting', () => {
    // Rows written before lastFailedLoginAt existed must not become immune.
    expect(nextFailedAttemptCount({ failedLoginAttempts: 4 }, WINDOW)).toBe(5);
  });
});
