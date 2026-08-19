'use strict';

/**
 * @jest-environment node
 *
 * One rule, enforced: a student's identity comes from the SESSION.
 *
 * The same defect has now been found three times, in three different files:
 *
 *   routes/v2/documents.js     sign-in loop — the guard deleted the localStorage
 *                              key this endpoint read, so it could never recover
 *   routes/v2/quiz.js          a byte-for-byte copy of that guard
 *   routes/v2/certificates.js  a staff session hid the student's own identity,
 *                              so "My Certificates" demanded an employee ID
 *
 * Each was written independently, each looked reasonable, and each broke a real
 * student. The pattern is the problem, so this test pins the pattern rather
 * than the three bugs: in a student-facing route, findSessionStudent must be
 * consulted BEFORE any client-supplied identifier.
 *
 * A client value is a hint. It can be stale, cleared by session-guard.js, or
 * simply wrong — and if it is trusted first, a student can be locked out of
 * their own page while being perfectly signed in.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Student-facing routes: these serve a signed-in student their own data. */
const STUDENT_FACING = [
  'routes/v2/documents.js',
  'routes/v2/quiz.js',
  'routes/v2/marketplace.js',
  'routes/v2/certificates.js',
];

const CLIENT_ID = /req\.headers\[["']x-employee-id["']\]/;

describe('a student is identified by their session, not by their browser', () => {
  it.each(STUDENT_FACING)('%s asks the session first', (rel) => {
    const src = read(rel);
    expect(src).toContain('findSessionStudent');

    // If it still reads a client identifier at all, the session lookup has to
    // come first — otherwise the client value wins and the trap is back.
    const client = src.search(CLIENT_ID);
    if (client !== -1) {
      const session = src.indexOf('findSessionStudent(req)');
      expect(session).toBeGreaterThan(-1);
      expect(session).toBeLessThan(client);
    }
  });

  it('the resolver is one shared implementation', () => {
    const auth = read('middleware/sessionAuth.js');
    expect(auth).toMatch(/function findSessionStudent/);
    expect(auth).toMatch(/module\.exports[\s\S]*findSessionStudent/);
    STUDENT_FACING.forEach((rel) => {
      expect(read(rel)).toMatch(/require\(["']\.\.\/\.\.\/middleware\/sessionAuth["']\)/);
    });
  });

  it('every one of them marks a real session failure, so the guard can act', () => {
    STUDENT_FACING.forEach((rel) => {
      expect(read(rel)).toContain('X-Session-Expired');
    });
  });
});

describe('"My Certificates" shows MY certificates', () => {
  const certs = read('routes/v2/certificates.js');

  it('a staff session no longer hides the student half', () => {
    // Was: isStaff ? requestedId : sessionEmployeeId — so holding an admin
    // session in the same browser discarded your own student identity, and the
    // page asked you to name a student instead of showing yours.
    expect(certs).toMatch(/const targetId = \(isStaff && requestedId\) \? requestedId : \(sessionEmployeeId \|\| ""\)/);
    expect(certs).not.toMatch(/const targetId = isStaff \? requestedId : sessionEmployeeId/);
  });

  it('staff can still look a student up explicitly', () => {
    expect(certs).toMatch(/isStaff && requestedId/);
  });

  it('a non-staff visitor still only ever sees themselves', () => {
    // The requested id is honoured only when isStaff is true; a student naming
    // somebody else's employeeId gets their own record, not that one.
    const block = certs.slice(certs.indexOf('const targetId'), certs.indexOf('const student = await Student.findOne'));
    expect(block).not.toMatch(/requestedId \|\| sessionEmployeeId/);
  });
});
