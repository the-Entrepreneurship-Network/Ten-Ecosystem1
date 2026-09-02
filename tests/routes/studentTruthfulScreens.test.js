'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('My Internships shows the internship the student actually has', () => {
  const page = strip(read('public/my-internships.html'));
  const portal = strip(read('routes/v2/studentPortal.js'));

  /*
   * The page asked /api/student/my-internships. No such route has ever been
   * registered — server.js only serves the PAGE at /my-internships. The 404 was
   * swallowed by an empty catch, so `internships` stayed [] and every student
   * with a live internship was told "No internships yet" and invited to go and
   * apply for one.
   */
  it('calls a route that exists', () => {
    expect(page).not.toContain("fetch('/api/student/my-internships'");
    expect(page).toContain("fetch('/api/v2/student/status'");
  });

  it('and that route is really registered', () => {
    expect(portal).toContain('router.get("/student/status", requireStudent');
  });

  it('sends the session cookie, since the route requires a student', () => {
    expect(page).toContain("credentials: 'same-origin'");
  });

  it('the status payload carries what the page needs', () => {
    // Rather than stand up a second endpoint describing the same internship.
    ['startDate:', 'endDate:', 'internshipComplete:'].forEach((field) => {
      expect(portal).toContain(field);
    });
    expect(portal).toContain('isInternshipComplete(student)');
  });

  it('reuses the existing finished-or-running helper', () => {
    // utils/internshipStatus.js already answers this from joiningDate + tenure.
    expect(portal).toContain('require("../../utils/internshipStatus")');
  });

  it('does not print a stipend TEN does not pay', () => {
    // "Stipend: —" on every card raises a question with no answer.
    expect(page).not.toContain('Stipend');
  });

  it('the empty state no longer sends a current intern off to apply again', () => {
    expect(page).not.toContain('No internships yet');
    expect(page).toContain('/student-dashboard');
  });
});

describe('a domain with no notice is not given invented meetings', () => {
  const server = strip(read('server.js'));

  /*
   * GET /get-notice/:domain was `notices[domain] || notices["default"]`, and
   * notice.json holds entries for two domains out of fifteen. So thirteen
   * domains were served the default's "09:45 AM (Daily Alignment)" and a Google
   * Meet link — https://meet.google.com/ten-ecosystem — that nobody runs. A
   * student clicked it, arrived in an empty room, and drew the obvious
   * conclusion about whether TEN is a real organisation.
   */
  it('never falls through to the default meeting link', () => {
    expect(server).not.toContain('const notice = notices[domain] || notices["default"];');
    expect(server).toContain('const own = notices[domain];');
  });

  it('blanks the times and the link rather than borrowing them', () => {
    const at = server.indexOf('const shared = notices["default"] || {};');
    expect(at).toBeGreaterThan(-1);
    const block = server.slice(at, at + 400);
    expect(block).toContain('morningMeeting:  ""');
    expect(block).toContain('eveningMeeting:  ""');
    expect(block).toContain('meetingLink:     ""');
    // The shared welcome text is true for everyone, so it is kept.
    expect(block).toContain('shared.importantNotice');
  });

  it('says whether the notice belongs to this domain', () => {
    expect(server).toContain('isDomainSpecific: false');
    expect(server).toContain('{ isDomainSpecific: true }');
  });

  it('the dashboard still hides the button when the link is empty', () => {
    // The fix relies on this guard already being there.
    const dash = read('public/student-dashboard.html');
    expect(dash).toContain('if(data.meetingLink && data.meetingLink.trim() !== "")');
  });

  it('notice.json genuinely covers only a fraction of the domains', () => {
    // If somebody later fills it in, this test is the reminder that the
    // fallback above is what the rest of them still get.
    const notices = JSON.parse(read('notice.json'));
    const domains = require(path.join(root, 'config/domains.js'));
    const names = (domains.SELECTABLE_DOMAIN_NAMES || domains.SELECTABLE || []).length
      || Object.keys(domains).length;
    const covered = Object.keys(notices).filter((k) => k !== 'default').length;
    expect(covered).toBeLessThan(names);
  });
});
