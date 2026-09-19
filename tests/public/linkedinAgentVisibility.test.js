'use strict';

/*
 * Who can see the LinkedIn section: everyone who signs in.
 *
 * This file used to assert the opposite — four staff dashboards carry it,
 * students and investors must not — and the reversal is the point of the
 * change it now pins. When the section was a composer, keeping students away
 * from it was the whole safety story. It is not a composer any more. It shows
 * the posts the company page has already published, it has no controls, and
 * the people it advertises for are the ones most entitled to read it.
 *
 * So every portal a person lands on after signing in carries the section, and
 * the test that matters is that none of them was forgotten. Adding a portal to
 * this app and not to this list is exactly how one role ends up staring at a
 * menu everybody else has an extra item in.
 *
 * Access is still enforced twice. The page carries the section; the API
 * decides what it may answer, and refuses an anonymous request outright. The
 * route suite owns that half.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

/*
 * Every page a signed-in person lands on and navigates sections in, with the
 * role string that page passes to mount(). The four navigation idioms in this
 * list are not a style choice anybody made — the app has no shared nav
 * partial, so each portal hand-writes its own — which is why the test for
 * "is it reachable" below accepts all of them rather than one.
 */
const PORTALS = [
  ['student-dashboard.html', 'student'],
  ['hr-portal.html', 'hr'],
  ['coordinator-dashboard.html', 'coordinator'],
  ['mentor-dashboard.html', 'mentor'],
  ['founder-os.html', 'founder'],
  ['investor-dashboard.html', 'investor'],
  ['contractor-dashboard.html', 'contractor'],
  ['ten-admin.html', 'admin'],
];

describe('every portal carries the LinkedIn section', () => {
  describe.each(PORTALS)('%s', (file, role) => {
    const html = read(file);

    it('loads the shared module', () => {
      expect(html).toMatch(/<script src="\/linkedin-agent\.js"( defer)?><\/script>/);
    });

    it('has a host element for the section', () => {
      expect(html).toContain('id="linkedinAgentHost"');
    });

    it(`mounts it as ${role}`, () => {
      /*
       * The options object is matched loosely on purpose. The HR portal passes
       * a nested `headers: { Authorization: hrToken }` alongside the role, and
       * a pattern built from [^}]* stops dead at that inner brace — it failed
       * on the one dashboard whose call was richest, which is the opposite of
       * what a guard rail should do. What matters is that this page mounts the
       * section and tells it which role is looking at it.
       */
      const call = new RegExp(`TENLinkedInAgent\\.mount\\(document\\.getElementById\\('linkedinAgentHost'\\)[\\s\\S]{0,160}?role:\\s*'${role}'`);
      expect(html).toMatch(call);
    });

    it('offers a way to open it', () => {
      /* Each page has its own navigation idiom — showView, openCoordModal,
         switchTab, switchStudentView, openSectionModal, showSection, data-v —
         so the assertion is only that the section is reachable, not how. */
      expect(html).toMatch(
        /showView\('linkedin-agent'\)|openCoordModal\('linkedin-agent'\)|switchTab\('linkedin'\)|openSectionModal\('stu-view-linkedin'\)|showSection\('linkedin'\)|data-v="linkedin"/,
      );
    });

    it('names it so a reader knows what it is', () => {
      expect(html).toMatch(/LinkedIn Agent/);
    });
  });

  /*
   * A count, not a list, so that adding a portal without adding it here fails
   * loudly rather than passing quietly. If this number changes, the change was
   * either deliberate — add it to PORTALS above — or a page was missed.
   */
  it('is on every portal in public/ and no page was missed', () => {
    const carrying = fs.readdirSync(PUBLIC)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => read(f).indexOf('linkedinAgentHost') >= 0)
      .sort();
    expect(carrying).toEqual(PORTALS.map(([f]) => f).sort());
  });
});

describe('the module itself', () => {
  const src = read('linkedin-agent.js');

  it('exists and defines the mount the portals call', () => {
    expect(src).toMatch(/window\.TENLinkedInAgent\s*=/);
    expect(src).toMatch(/\bmount\b/);
  });

  /*
   * The section is in front of students and contractors, so it must ask for
   * nothing a staff-only route would answer. Everything it reads comes from
   * /feed.
   */
  it('reads the feed and nothing else', () => {
    expect(src).toContain("'/feed'");
    expect(src).not.toMatch(/\/autopilot/);
    expect(src).not.toMatch(/\/status/);
    expect(src).not.toMatch(/\/stats/);
  });

  /*
   * There is exactly one thing it writes: /connect, the form that puts the
   * access token in. The server refuses that to anyone but HR and admin, and
   * the payload that carries `canConnect` is only sent to those two roles, so
   * nobody else is even shown the form. Any OTHER write would be a way to
   * reach the company page that the rotation does not control.
   */
  it('writes only to the connect endpoints', () => {
    const posts = src.match(/API \+ '\/[a-z/]+'/g) || [];
    const written = posts.map((m) => m.replace(/.*'\/(.+)'/, '$1'));
    written.forEach((route) => {
      expect(['feed', 'connect', 'disconnect']).toContain(route.split('/')[0]);
    });
    expect(src).not.toMatch(/method:\s*['"](PUT|DELETE|PATCH)['"]/);
  });
});
