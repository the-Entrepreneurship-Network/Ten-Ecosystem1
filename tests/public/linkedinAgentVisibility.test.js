'use strict';

/*
 * Who can see the LinkedIn agent, decided by which dashboard carries it.
 *
 * The section is one shared module, /linkedin-agent.js, mounted into a host
 * element by each dashboard that is allowed to show it. Access is enforced
 * twice — the API refuses anyone who is not HR, a coordinator, a mentor, a
 * founder or an admin — but the first line is the page itself: a student
 * must never see a "LinkedIn Agent" button that opens onto a 403.
 *
 * So this pins both halves. The four staff dashboards must load the module,
 * carry a host element and mount it with the right role; the student,
 * investor and contractor dashboards must not mention it at all. Somebody
 * copying a nav block between pages is exactly how a staff-only section ends
 * up in front of students, and this is where that copy would be caught.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

const CARRY = [
  ['hr-portal.html', 'hr'],
  ['coordinator-dashboard.html', 'coordinator'],
  ['mentor-dashboard.html', 'mentor'],
  ['founder-os.html', 'founder'],
];

const NEVER = ['student-dashboard.html', 'investor-dashboard.html', 'contractor-dashboard.html'];

describe('the LinkedIn agent section is on the staff dashboards and nowhere else', () => {
  describe.each(CARRY)('%s', (file, role) => {
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
       * agent and tells it which role is looking at it.
       */
      const call = new RegExp(`TENLinkedInAgent\\.mount\\(document\\.getElementById\\('linkedinAgentHost'\\)[\\s\\S]{0,160}?role:\\s*'${role}'`);
      expect(html).toMatch(call);
    });

    it('offers a way to open it', () => {
      /* Each page has its own navigation idiom — showView, openCoordModal,
         switchTab, data-v — so the assertion is only that the section is
         reachable, not how. */
      expect(html).toMatch(/showView\('linkedin-agent'\)|openCoordModal\('linkedin-agent'\)|switchTab\('linkedin'\)|data-v="linkedin"/);
    });
  });

  describe.each(NEVER)('%s', (file) => {
    const html = read(file);

    it('does not load the module, host it, or mount it', () => {
      expect(html).not.toContain('linkedin-agent.js');
      expect(html).not.toContain('TENLinkedInAgent');
      expect(html).not.toContain('linkedinAgentHost');
    });
  });
});

describe('the module itself', () => {
  it('exists and defines the mount the dashboards call', () => {
    const src = read('linkedin-agent.js');
    expect(src).toMatch(/window\.TENLinkedInAgent\s*=/);
    expect(src).toMatch(/\bmount\b/);
  });
});
