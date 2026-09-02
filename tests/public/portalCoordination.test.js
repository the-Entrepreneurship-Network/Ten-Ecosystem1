'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const server = strip(read('server.js'));

describe('every role can leave the page it shares with every other role', () => {
  const messages = strip(read('public/messages.html'));

  /*
   * server.js serves ONE messages.html to all eight roles, and it is the most
   * cross-linked page in the product — the HR portal, coordinator dashboard,
   * Founder OS, investor, contractor and mentor dashboards and the admin portal
   * all link to it. Its only exit was hardcoded:
   *
   *     onclick="window.location.href='/student-dashboard'"
   *
   * The student dashboard then finds no student in localStorage and forwards to
   * login.html, so every non-student appeared to be signed out of their own
   * portal for pressing the one back arrow on the page.
   */
  it('the exit is not hardcoded to one role', () => {
    expect(messages).not.toContain("window.location.href='/student-dashboard'");
    expect(messages).toContain('onclick="goBackToPortal()"');
  });

  it('it knows where each of the eight roles lives', () => {
    ['student', 'hr', 'coordinator', 'admin', 'founder', 'investor', 'contractor', 'mentor']
      .forEach((role) => expect(messages).toMatch(new RegExp(role + '\\s*:')));
  });

  it('and falls back to where they came from when the role is not loaded yet', () => {
    // The directory call may still be in flight, or have failed. Guessing one
    // dashboard is what caused the bug in the first place.
    expect(messages).toContain('window.history.back()');
  });
});

describe('no portal is a dead end', () => {
  it('a mentor can reach the rest of the product', () => {
    // This sidebar had three in-page tabs and a logout button. Nothing else in
    // the file linked anywhere, so the only way out of the mentor portal was to
    // sign out of it — including for the mentor whom students, HR and
    // coordinators can all message.
    const mentor = read('public/mentor-dashboard.html');
    expect(mentor).toContain('href="/messages"');
    expect(mentor).toContain('href="/notifications"');
    expect(mentor).toContain('href="/mentor/directory"');
  });

  it('every route the mentor sidebar points at is really served', () => {
    // /mentor-directory looked right and does not exist; the route is
    // /mentor/directory. A link that 404s is worse than no link.
    const mentor = read('public/mentor-dashboard.html');
    const hrefs = [...mentor.matchAll(/href="(\/[a-z0-9/-]+)"/g)].map((m) => m[1]);
    hrefs.forEach((href) => {
      expect(server).toContain(`app.get("${href}"`);
    });
  });
});

describe('the home page has a door for every audience that has a portal', () => {
  const index = read('public/index.html');

  it('mentors, investors and contractors can find their way in', () => {
    // Their portals are built and their login pages are routed and live. They
    // were linked from nowhere, so the only way in was to already know the URL:
    // three finished audiences no visitor could reach.
    ['mentor-login.html', 'investor-login.html', 'contractor-login.html']
      .forEach((page) => expect(index).toContain(`href="${page}"`));
  });

  it('and every door opens onto a page that exists', () => {
    [...index.matchAll(/href="([a-z0-9-]+-login\.html)"/g)]
      .map((m) => m[1])
      .forEach((page) => {
        expect(fs.existsSync(path.join(root, 'public', page))).toBe(true);
      });
  });
});

describe('the numbers on the front page are the real numbers', () => {
  it('the intern count is not inflated by default', () => {
    /*
     * PUBLIC_INTERNS_FLOOR defaulted to 5000 against a FLOOR_AT of 783, so the
     * most prominent figure on the site — under the words "INTERNS TRAINED" —
     * printed 5,000 for a real 783. A fixed +4,217.
     */
    expect(server).toContain('Number(process.env.PUBLIC_INTERNS_FLOOR ?? 0)');
    expect(server).not.toContain('PUBLIC_INTERNS_FLOOR ?? 5000');
  });

  it('the page does not ship a number as its own placeholder', () => {
    // Hardcoding "5000" meant the page stated a figure even when the API failed.
    const index = strip(read('public/index.html'));
    expect(index).not.toMatch(/id="statInterns">\s*\d/);
  });

  it('no invented students are quoted anywhere', () => {
    // Six fabricated testimonials shipped on the live, paid Career Studio page.
    // TEN's own brief: "fake testimonials are worse than none."
    const benefits = read('student-portal-app/src/components/BenefitsSection.tsx');
    expect(benefits).toContain('const VOICES: [string, string, string][] = [];');
    expect(benefits).toContain('{VOICES.length > 0 && (');
  });
});
