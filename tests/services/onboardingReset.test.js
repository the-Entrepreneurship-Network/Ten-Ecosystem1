'use strict';

/**
 * Undoing the joiner wizard.
 *
 * The wizard asks "new joiner or WhatsApp joiner?" and shows once. The WhatsApp
 * answer back-dates the internship start and credits every day before the
 * student had a portal account as attended — no daily records can exist for
 * days before they were in the system. So a mistaken tap hands out attendance
 * nobody earned and the student has no way back. HR level 3 holds the way back.
 */

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVICE = read('services/onboardingReset.js');
const HRROUTE = strip(read('routes/v2/hr.js'));
const DASH = read('public/student-dashboard.html');
const HRPAGE = read('public/hr-portal.html');

// `mock`-prefixed, because a jest.mock factory may not reach for anything else.
let mockUpdateArgs = null;
let mockRows = [];
jest.mock('../../models/Student', () => ({
  findOneAndUpdate: jest.fn(async (q, u) => { mockUpdateArgs = { q, u }; return { ...u.$set, onboardingResets: [{}] }; })
}));
jest.mock('../../models/Attendance', () => ({ find: async () => mockRows }));
jest.mock('../../utils/attendanceUtils', () => ({
  getAttendanceSummary: () => ({ daysPresent: 4, percentage: 13 }),
  // The reset anchors to the later of createdAt and joiningDate, and moves the
  // end date with the start date. Both come from here.
  getAccountAnchorDate: (s) => {
    const dates = [s && s.createdAt, s && s.joiningDate]
      .map((v) => (v ? new Date(v) : null))
      .filter((d) => d && !isNaN(d.getTime()));
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  },
  getTenureEndDate: (start) => {
    const d = new Date(start);
    d.setDate(d.getDate() + 29);
    return d;
  }
}));
const FAKE = {
  _id: 'abc', employeeId: 'TEN/DEVOPS/1003', name: 'Test',
  joinerType: 'whatsapp', joinerTypeSelected: true, onboardingPopupSeen: true,
  hasSeenOnboarding: true, hasSeenWelcome: true, v2Onboarded: true,
  joiningDate: '2026-06-01', createdAt: new Date('2026-06-01'),
  internshipStartDate: new Date('2026-01-05'), calculatedAttendance: 90
};

const { resetOnboarding, portalRegistrationDate } = require('../../services/onboardingReset');

beforeEach(() => { mockUpdateArgs = null; mockRows = []; });

describe('what a reset touches', () => {
  it('reopens the wizard — every flag, not one of them', async () => {
    await resetOnboarding({ ...FAKE });
    const set = mockUpdateArgs.u.$set;
    ['onboardingPopupSeen', 'hasSeenOnboarding', 'joinerTypeSelected', 'v2Onboarded', 'hasSeenWelcome']
      .forEach((f) => expect(set[f]).toBe(false));
    expect(set.joinerType).toBeNull();
  });

  /*
   * The whole point. Leaving the back-dated start would keep the unearned days
   * on the profile until the student happened to redo the wizard — which is
   * the state HR is trying to get out of.
   */
  it('takes the internship start back to the portal registration date', async () => {
    await resetOnboarding({ ...FAKE });
    expect(mockUpdateArgs.u.$set.internshipStartDate.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(mockUpdateArgs.u.$set.calculatedAttendance).toBe(4);   // recounted, not 90
  });

  it('falls back to the account creation date when there is no joining date', () => {
    const d = portalRegistrationDate({ createdAt: new Date('2026-03-09') });
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-09');
  });
});

describe('what a reset must never touch', () => {
  /*
   * "if that student do any task or something ... that should not be reset,
   * only that section should reset."
   */
  it('leaves the work, the money and the record alone', async () => {
    await resetOnboarding({ ...FAKE });
    const written = Object.keys(mockUpdateArgs.u.$set);
    ['tasks', 'coins', 'certificates', 'documents', 'submissions', 'employeeId',
     'employeeIdOverride', 'attendance', 'joiningDate', 'domain', 'tenure']
      .forEach((f) => expect(written).not.toContain(f));
    // The attendance ROWS themselves are read, never written.
    expect(SERVICE).not.toMatch(/Attendance\.(deleteMany|updateMany|findOneAndUpdate|create)/);
  });

  it('says so where the next person will read it', () => {
    expect(SERVICE).toContain('WHAT IT MUST NEVER TOUCH');
  });
});

describe('who can do it', () => {
  it('is level 3 and up, and an admin is above the hierarchy', () => {
    expect(HRROUTE).toContain('const RESET_MIN_LEVEL = 3;');
    expect(HRROUTE).toContain('requireHRLevel(RESET_MIN_LEVEL)');
    expect(HRROUTE).toContain('req.session.adminUser');
    // Reading is not changing: any HR can look.
    const look = HRROUTE.slice(HRROUTE.indexOf('router.get("/onboarding/:employeeId"'));
    expect(look.slice(0, 200)).not.toContain('requireHRLevel');
  });

  /*
   * /hr-login has always read `dbHR.level`, and models/HR.js never had the
   * field — so every promoted coordinator came back as level 1 and could not
   * open anything gated above it.
   */
  it('HR accounts can actually hold a level now', () => {
    const hr = read('models/HR.js');
    expect(hr).toMatch(/level:\s*\{ type: Number, default: 1, min: 1, max: 8 \}/);
    expect(read('server.js')).toContain('level:    dbHR.level || 1');
  });

  it('leaves a record of who reset what, and what it had been', async () => {
    await resetOnboarding({ ...FAKE }, { by: 'Jr HR Manager', byLevel: 3, reason: 'wrong tap' });
    const row = mockUpdateArgs.u.$push.onboardingResets;
    expect(row).toMatchObject({ by: 'Jr HR Manager', byLevel: 3, reason: 'wrong tap' });
    expect(row.previous).toMatchObject({ joinerType: 'whatsapp', calculatedAttendance: 90 });
  });
});

describe('the reset reaches the student', () => {
  /*
   * The gate reads localStorage, and localStorage says "answered" forever. The
   * reset reached the database and nothing else.
   */
  it('the server has the last word, not the cache', () => {
    expect(DASH).toContain('The server has the last word');
    expect(DASH).toContain("var reopened = (s.onboardingPopupSeen === false || s.hasSeenOnboarding === false);");
    // and one stale `true` no longer keeps the wizard shut
    expect(DASH).toContain('if (stu.onboardingPopupSeen === true && stu.hasSeenOnboarding !== false) {');
  });

  it('shows once, and once again after a reset — never twice for one answer', () => {
    // Finishing the wizard sets the flags; only a reset clears them.
    const portal = strip(read('routes/v2/studentPortal.js'));
    expect(portal).toContain('updates.onboardingPopupSeen = true;');
    expect(SERVICE).toContain('onboardingPopupSeen: false');
  });

  it('tells them why it came back', () => {
    expect(HRROUTE).toContain('Your joining details need re-confirming');
    expect(HRROUTE).toContain('exactly as you left them');
  });

  it('HR has a button for it, with the consequences on the dialog', () => {
    expect(HRPAGE).toContain('openJoinerReset(');
    expect(HRPAGE).toContain('/api/v2/hr/onboarding?employeeId=');
    expect(HRPAGE).toContain('are untouched');
    expect(HRPAGE).toContain('needs HR level ');
  });

  /*
   * Employee ids look like TEN/DEVOPS/1003 — three slashes. An id in the path
   * relies on %2F surviving every proxy in front of this app, and nginx
   * normalises it by default: the route would 404 in production and work
   * perfectly on a laptop.
   */
  it('never puts an employee id in the URL path', () => {
    expect(HRROUTE).toContain('router.get("/onboarding", requireHR');
    expect(HRROUTE).toContain('router.post("/onboarding/reset", requireHR');
    expect(HRROUTE).not.toContain('/onboarding/:employeeId');
    expect(HRPAGE).not.toContain("'/api/v2/hr/onboarding/' + encodeURIComponent");
  });
});
