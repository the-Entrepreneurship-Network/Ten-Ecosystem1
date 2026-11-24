'use strict';

/**
 * Scanning the coordinator's meeting QR marks the day on both sides.
 *
 * The route used to look the student up by { employeeId, password }, matching
 * the typed password against the bcrypt hash stored in that column, so it
 * never found anyone: every scan answered "Invalid Employee ID or Password".
 * Now a signed-in student only taps; anyone else signs in with Employee ID and
 * password. One scan marks the class attendance and the student's own, then
 * hands over the day's Google Form.
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
  expect(route).toMatch(/checkLockout\(res, student, Student\)/);
  expect(route).toMatch(/recordFailedAttempt\(res, student, Student,/);
});

test('only a password check goes through the sign-in limiters', () => {
  const fnSrc = server.slice(server.indexOf('function limitPasswordTries'), start);
  const calls = [];
  // eslint-disable-next-line no-new-func
  const limit = new Function('loginIpLimiter', 'loginLimiter', `${fnSrc}; return limitPasswordTries;`)(
    (req, res, next) => { calls.push('network'); next(); },
    (req, res, next) => { calls.push('account'); next(); });
  const next = jest.fn();

  // A signed-in tap: no password, so nothing to guess and no cap to trip.
  limit({ body: { domain: 'Web Development' } }, {}, next);
  expect(calls).toEqual([]);
  expect(next).toHaveBeenCalledTimes(1);

  limit({ body: { employeeId: 'TEN/WEB/1001', password: 'x', domain: 'Web Development' } }, {}, next);
  expect(calls).toEqual(['network', 'account']);
  expect(next).toHaveBeenCalledTimes(2);
  expect(route).toMatch(/^app\.post\("\/qr-attendance\/mark", limitPasswordTries,/);
});

test('a scan with no password uses the phone’s own sign-in', () => {
  expect(route).toMatch(/student = await findSessionStudent\(req\)/);
  expect(route).toMatch(/needsSignIn:true/);
});

test('one scan marks both sides, the self side exactly like the dashboard button', () => {
  expect(route).toMatch(/markedBy:"coordinator"/);
  expect(route).toMatch(/await markSelfAttendance\(student, domain\)/);
  const selfRoute = server.slice(server.indexOf('app.post("/attendance/self"'));
  expect(selfRoute.slice(0, selfRoute.indexOf('\n});'))).toMatch(/await markSelfAttendance\(student,/);
});

test('it hands back the day’s Google Form', () => {
  expect(route).toMatch(/const formUrl = attendanceFormLink\(student, dateKey\)/);
  expect(route).toMatch(/res\.json\(\{ success:true, formUrl,/);
});
