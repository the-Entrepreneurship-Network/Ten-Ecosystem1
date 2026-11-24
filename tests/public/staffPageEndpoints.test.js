'use strict';

/**
 * Found by signing in as each role on a local copy and opening every section:
 * these pages called APIs their own role is not allowed to read, or a function
 * that was never written.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
/** Live code only, so a comment quoting the old call does not count. */
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the coordinator mentor list reads a route coordinators may use', () => {
  // /api/ecosystem/users is HR and admin only, so the dropdown was always empty.
  const page = read('public/coordinator-dashboard.html');
  expect(page).toContain("fetch('/api/ecosystem/mentors')");
  expect(page).not.toContain("fetch('/api/ecosystem/users')");
  expect(read('server.js')).toMatch(/app\.get\("\/api\/ecosystem\/mentors", requireStaff,/);
});

test('the mentor dashboard reads only the mentor\'s own profile', () => {
  const page = read('public/mentor-dashboard.html');
  expect(page).toContain("fetch('/api/mentor/profile/me')");
  expect(page).not.toContain('/api/ecosystem/users');
});

test('every HR portal nav button calls a function the page defines', () => {
  const page = read('public/hr-portal.html');
  const called = [...page.matchAll(/class="nav-btn"[^>]*onclick="(\w+)\(/g)].map((m) => m[1]);
  expect(called.length).toBeGreaterThan(5);
  for (const fn of called) expect(page).toMatch(new RegExp(`function ${fn}\\(|${fn} *= *(async *)?(function|\\()`));
});
