'use strict';

/**
 * Meeting attendance by QR.
 *
 * There are two codes, the same for every domain. The portal code opens
 * /qr-attendance.html: the student picks their domain and signs in with
 * Employee ID and password. Only when the password is right and the domain is
 * one they hold is the day marked on both sides, and then the Google Form
 * opens. The form code opens the Google Form directly, with no sign-in.
 *
 * The route once looked the student up by { employeeId, password }, matching
 * the typed password against the bcrypt hash stored in that column, so it
 * never found anyone: every scan answered "Invalid Employee ID or Password".
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const server = read('server.js')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const routeOf = (head) => {
  const start = server.indexOf(head);
  return start < 0 ? '' : server.slice(start, server.indexOf('\n});', start));
};
const route = routeOf('app.post("/qr-attendance/mark"');

test('the password is checked against the hash, not looked up as a value', () => {
  expect(route).not.toMatch(/Student\.findOne\(\{\s*employeeId,\s*password\s*\}\)/);
  expect(route).toMatch(/Student\.findOne\(\{ employeeId: String\(employeeId\) \}\)/);
  expect(route).toMatch(/bcrypt\.compare\(String\(password\), student\.password/);
  expect(route).toMatch(/checkLockout\(res, student, Student\)/);
  expect(route).toMatch(/recordFailedAttempt\(res, student, Student,/);
});

test('every scan signs in: a domain, Employee ID and password, through the sign-in limiters', () => {
  expect(route).toMatch(/^app\.post\("\/qr-attendance\/mark", loginIpLimiter, loginLimiter,/);
  expect(route).toMatch(/if\(!domain\)/);
  expect(route).toMatch(/if\(!employeeId \|\| !password\)/);
  expect(route).not.toMatch(/findSessionStudent/);
});

test('the chosen domain must be one the student holds, checked after the password and before marking', () => {
  const password = route.indexOf('clearFailedAttempts(student, Student)');
  const domain = route.indexOf('attendanceDomain.holdsDomain(student, domain)');
  expect(password).toBeGreaterThan(-1);
  expect(domain).toBeGreaterThan(password);
  expect(route.indexOf('new Attendance(')).toBeGreaterThan(domain);
});

test('one scan marks both sides, the self side exactly like the dashboard button', () => {
  expect(route).toMatch(/markedBy:"coordinator"/);
  expect(route).toMatch(/await markSelfAttendance\(student, domain\)/);
  expect(routeOf('app.post("/attendance/self"')).toMatch(/await markSelfAttendance\(student,/);
});

test('it hands back the day’s Google Form', () => {
  expect(route).toMatch(/const formUrl = attendanceFormLink\(student, dateKey\)/);
  expect(route).toMatch(/res\.json\(\{ success:true, formUrl,/);
});

test('one portal code for every domain, and a separate code for the form', () => {
  const codes = routeOf('app.get("/attendance/qr"');
  expect(codes).toMatch(/portal: await code\(host \+ "\/qr-attendance\.html"\)/);
  expect(codes).toMatch(/form: await code\(ATTENDANCE_FORM\)/);
});

test('the pages call routes that exist', () => {
  expect(server).toMatch(/app\.get\("\/attendance\/qr",/);
  expect(server).toMatch(/app\.get\("\/qr-attendance\/domains",/);
  expect(read('public/coordinator-dashboard.html')).toMatch(/fetch\("\/attendance\/qr"\)/);
  const page = read('public/qr-attendance.html');
  expect(page).toMatch(/fetch\("\/qr-attendance\/domains"\)/);
  expect(page).toMatch(/fetch\("\/qr-attendance\/mark"/);
});
