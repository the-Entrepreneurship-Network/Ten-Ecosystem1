'use strict';

/**
 * Scanning the coordinator's meeting QR must be able to mark attendance.
 *
 * The route looked the student up by { employeeId, password }, matching the
 * typed password against the bcrypt hash stored in that column, so it never
 * found anyone: every scan answered "Invalid Employee ID or Password".
 */
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const start = server.indexOf('app.post("/qr-attendance/mark"');
const route = server.slice(start, server.indexOf('\n});', start));

test('the password is checked against the hash, not looked up as a value', () => {
  expect(route).not.toMatch(/Student\.findOne\(\{\s*employeeId,\s*password\s*\}\)/);
  expect(route).toMatch(/Student\.findOne\(\{ employeeId \}\)/);
  expect(route).toMatch(/bcrypt\.compare\(String\(password\), student\.password/);
});

test('it is a sign-in in all but name: rate limited, with lockout', () => {
  expect(route).toMatch(/^app\.post\("\/qr-attendance\/mark", loginIpLimiter, loginLimiter,/);
  expect(route).toMatch(/checkLockout\(res, student, Student\)/);
  expect(route).toMatch(/recordFailedAttempt\(res, student, Student,/);
});
