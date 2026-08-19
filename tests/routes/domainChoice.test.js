'use strict';

/**
 * Choosing a domain, and then choosing a route into it.
 *
 * /domains sent every visitor straight to the intern registration form. That is
 * one of two real routes: some arrivals already have the fundamentals and want
 * the internship, and some want the course in TEN Career Studio first and to
 * move across when they are ready. Asking costs one tap and stops the second
 * group registering for something they are not ready for.
 *
 * The other half of this is the name. "Student Portal" was the label on two
 * different paid things — the course app at /student-portal/ and the internship
 * funnel at /student-portal.html — which is a large part of why anyone was
 * confused about what they were paying for.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const domains = fs.readFileSync(path.join(root, 'public/domains.html'), 'utf8');
const register = fs.readFileSync(path.join(root, 'public/register.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

describe('the choice step', () => {
  it('is a dialog that only opens on a choice, not on page load', () => {
    expect(domains).toContain('id="sheet"');
    expect(domains).toContain('role="dialog"');
    expect(domains).toContain('aria-modal="true"');
    // `.on` is what shows it, and only openChoice() adds it.
    expect(domains).toMatch(/\.sheet\{[^}]*display:none;/);
    expect(domains).toContain('.sheet.on{display:flex;}');
    expect(domains).toContain('SHEET.classList.add("on")');
  });

  it('offers exactly the two routes the student was asked about', () => {
    expect(domains).toContain('id="pickIntern"');
    expect(domains).toContain('id="pickCourse"');
  });

  it('sends the internship answer to the intern registration form', () => {
    expect(domains).toContain('"/register.html" + q');
  });

  it('sends the course answer to TEN Career Studio', () => {
    expect(domains).toContain('setAttribute("href", "/student-portal/")');
  });

  it('carries the chosen domain into the registration form', () => {
    // Making somebody scroll back through fourteen cards to say it again is
    // how a two-minute registration becomes an abandoned one.
    expect(domains).toContain('"?role=student&domain=" + encodeURIComponent(domain)');
    expect(register).toContain('function prefillFromQuery()');
    expect(register).toContain("q.get('domain')");
    expect(register).toContain('selectDomainCard(domain)');
  });

  it('ignores a domain the registration form does not offer', () => {
    // A crafted ?domain= must not invent a card or enrol anyone anywhere.
    const at = register.indexOf('function applyDomain()');
    const fn = register.slice(at, register.indexOf('}', register.indexOf('if (card)', at)));
    expect(fn).toContain('if (card) selectDomainCard(domain);');
  });

  it('does not fire before the page is ready', () => {
    expect(register).toContain("document.addEventListener('DOMContentLoaded', prefillFromQuery);");
  });
});

describe('the dialog is usable without a mouse', () => {
  it('closes on Escape', () => {
    expect(domains).toContain('if (e.key === "Escape" && SHEET.classList.contains("on")) closeChoice();');
  });

  it('moves focus in, and puts it back on close', () => {
    expect(domains).toContain('LAST_AT = document.activeElement;');
    expect(domains).toContain('if (LAST_AT && LAST_AT.focus) LAST_AT.focus();');
  });

  it('does not let the card toggle swallow the button\'s Enter key', () => {
    expect(domains).toContain('if (e.target.closest("[data-start]") || e.target.closest("a")) return;');
  });

  it('still respects a reader who asked for less movement', () => {
    expect(domains).toContain('prefers-reduced-motion');
  });
});

describe('the paid course area has a name of its own', () => {
  const studio = fs.readFileSync(path.join(root, 'public/student-portal/index.html'), 'utf8');
  /*
   * Vite renames the bundle on every build, so naming the hash here meant the
   * suite failed the next time anyone rebuilt the portal — a red test that
   * says nothing about the thing it is guarding. Resolve it the way a browser
   * does instead, from the script tag.
   */
  const bundleName = (studio.match(/src="[^"]*assets\/(index-[^"]+\.js)"/) || [])[1];
  if (!bundleName) throw new Error('student-portal/index.html has no bundle script tag');
  const bundle = fs.readFileSync(path.join(root, 'public/student-portal/assets', bundleName), 'utf8');
  const funnel = fs.readFileSync(path.join(root, 'public/student-portal.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8');

  it('is called TEN Career Studio, in the app itself', () => {
    expect(studio).toContain('TEN Career Studio');
    expect(studio).not.toContain('TEN Student Portal');
    expect(bundle).not.toContain('Student Portal');
  });

  it('keeps its URL, so every existing link still works', () => {
    // The name changed. The address did not — it is printed in emails and was
    // given as the destination for the course answer above.
    expect(domains).toContain('/student-portal/');
    expect(home).toContain('href="student-portal/"');
  });

  it('is called that on the pages that link to it', () => {
    expect(home).toContain('<h3>TEN Career Studio</h3>');
    expect(home).not.toMatch(/>Student Portal</);
  });

  it('no longer shares its name with the internship funnel', () => {
    // Two different paid things both called "Student Portal" is the confusion.
    expect(funnel).not.toContain('<title>TEN — Student Portal</title>');
    // It used to be identified by its "Internship Program Access" pay card.
    // That card has been removed along with the paygate on every portal, so the
    // page's own title carries the distinction now — same intent, evidence that
    // still exists.
    expect(funnel).toContain('<title>TEN — Internship Portal</title>');
  });

  it('leaves the intern dashboard alone', () => {
    // The signed-in internship portal is a different product from the course
    // app, and renaming it would be renaming the wrong thing.
    expect(dashboard).toContain('Student Portal');
  });
});

describe('the home page still points at /domains', () => {
  it('does not send a visitor into the middle of the signup funnel', () => {
    expect(home).toContain('href="/domains"');
    expect(home).not.toContain('href="student-journeys.html"');
  });
});
