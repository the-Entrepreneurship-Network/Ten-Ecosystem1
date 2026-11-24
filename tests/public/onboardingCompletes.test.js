'use strict';

/**
 * A New Joiner's onboarding must finish without falling into its error path.
 *
 * Found by signing in as a brand-new sample student: "I Have Read &
 * Understood" reloaded the page and the "Congratulations on Joining TEN!"
 * welcome came back. updateDashboardAfterOnboarding assigned to `employeeId`,
 * a const, which threw; the catch reloaded, and the copy of the student it had
 * saved had lost hasSeenWelcome.
 *
 * The function is run here in a sandbox with the page's own const.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const page = fs.readFileSync(path.join(__dirname, '../../public/student-dashboard.html'), 'utf8');
const fnSrc = page.slice(page.indexOf('function updateDashboardAfterOnboarding'), page.indexOf('function applyJoinerTypeUI'));

function load(id) {
  const ctx = {
    stored: {},
    localStorage: { setItem(k, v) { ctx.stored[k] = v; }, getItem: () => '{}' },
    document: { getElementById: () => null },
    window: { location: { reload: jest.fn() } },
    updateGoogleLinksVisibility() {}, updateDomainWhatsAppLinks() {}, renderWhatsAppGroupCards() {},
  };
  vm.createContext(ctx);
  vm.runInContext(`const employeeId = ${JSON.stringify(id)};\n${fnSrc}\nfunction applyJoinerTypeUI() {}\nthis.run = updateDashboardAfterOnboarding;`, ctx);
  return ctx;
}

test('the same Employee ID: the dashboard updates, with no error and no reload', () => {
  const ctx = load('TEN/WEB/1001');
  expect(() => ctx.run({ employeeId: 'TEN/WEB/1001', joinerType: 'new' })).not.toThrow();
  expect(ctx.window.location.reload).not.toHaveBeenCalled();
  expect(ctx.stored.employeeId).toBe('TEN/WEB/1001');
});

test('a changed Employee ID is saved and the page reloads to use it', () => {
  const ctx = load('TEN/WEB/1001');
  expect(() => ctx.run({ employeeId: 'TEN/WEB/2002' })).not.toThrow();
  expect(ctx.stored.employeeId).toBe('TEN/WEB/2002');
  expect(ctx.window.location.reload).toHaveBeenCalled();
});

const ack = page.slice(page.indexOf('async function acknowledgeInstructions'), page.indexOf('function updateDashboardAfterOnboarding'));

test('the server’s reply is merged into the stored student, so hasSeenWelcome survives', () => {
  expect(ack).toMatch(/stu = Object\.assign\(stu, data\.student\)/);
  expect(ack).not.toMatch(/stu = data\.student;/);
});

test('"Onboarding Complete" does not replace a pop-up that is already open', () => {
  // A pre-paid plan's "Your track is unlocked" opens at page load and is
  // marked as seen when it opens; replacing it lost it for good.
  expect(ack).toMatch(/if \(!Swal\.isVisible\(\)\) Swal\.fire\(\{\s*icon: 'success',\s*title: 'Onboarding Complete!/);
});
