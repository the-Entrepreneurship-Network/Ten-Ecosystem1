'use strict';

/*
 * Who can see the LinkedIn section: everyone who signs in.
 *
 * This file used to assert the opposite — four staff dashboards carry it,
 * students and investors must not — and the reversal is the point of the
 * change it now pins. When the section was a composer, keeping students away
 * from it was the whole safety story. It is not a composer any more, and it is
 * not an agent either: it lists the fourteen internship openings so a person
 * can copy the words and download the poster and post them from their own
 * account. It has nothing to operate and nothing to leak, and the people it
 * advertises for are both the most entitled to read it and the best placed to
 * spread it — an intern posting an opening outreaches the company page.
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
   * /openings, which is the only endpoint this feature still has.
   */
  it('reads the openings and nothing else', () => {
    expect(src).toContain("'/openings'");
    expect(src).not.toMatch(/\/autopilot/);
    expect(src).not.toMatch(/\/status/);
    expect(src).not.toMatch(/\/stats/);
    expect(src).not.toMatch(/\/feed/);
  });

  /*
   * It writes nothing at all, and that is the change this file now pins.
   *
   * There used to be a /connect form here that put a LinkedIn access token
   * into the server, because the server posted to the company page by itself.
   * Both are gone: automated posting is what gets a page restricted, so the
   * whole posting path was removed rather than guarded. A section that only
   * reads cannot be talked into publishing, and there is no longer a
   * credential for it to carry.
   */
  it('writes nothing — every request it makes is a read', () => {
    const called = src.match(/API \+ '\/[a-z/]+'/g) || [];
    const routes = called.map((m) => m.replace(/.*'\/(.+)'/, '$1'));
    expect(routes.length).toBeGreaterThan(0);
    routes.forEach((route) => {
      expect(route.split('/')[0]).toBe('openings');
    });
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|DELETE|PATCH)['"]/);
    expect(src).not.toMatch(/\bbody:\s/);
  });
});
