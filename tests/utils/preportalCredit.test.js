'use strict';

const fs = require('fs');
const path = require('path');
const A = require('../../utils/attendanceUtils');

const root = path.join(__dirname, '../..');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Days ago, as a YYYY-MM-DD string, so these tests do not rot. */
const daysAgo = (n) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const joiner = (extra) => Object.assign({
  joinerType: 'whatsapp',
  tenure: '3months',
  joiningDate: daysAgo(40),
  createdAt: new Date(daysAgo(40))
}, extra);

describe('the account anchor is the date nobody can edit', () => {
  /*
   * joiningDate is a plain string field. An admin sets it, and an older version
   * of the onboarding wizard used to overwrite it with the back-dated value.
   * createdAt is written by Mongoose and never touched.
   */
  it('ignores a joiningDate dragged behind the account', () => {
    const s = { joiningDate: '2026-03-01', createdAt: new Date('2026-07-20') };
    expect(iso(A.getAccountAnchorDate(s))).toBe('2026-07-20');
  });

  it('respects a joiningDate legitimately later than the account', () => {
    const s = { joiningDate: '2026-08-05', createdAt: new Date('2026-07-20') };
    expect(iso(A.getAccountAnchorDate(s))).toBe('2026-08-05');
  });

  it.each([
    [{ createdAt: new Date('2026-07-20') }, '2026-07-20', 'only createdAt'],
    [{ joiningDate: '2026-07-20' },         '2026-07-20', 'only joiningDate'],
    [{ joiningDate: 'not a date', createdAt: new Date('2026-07-20') }, '2026-07-20', 'unparseable joiningDate']
  ])('handles %#: %s', (s, expected) => {
    expect(iso(A.getAccountAnchorDate(s))).toBe(expected);
  });

  it('has nothing to anchor to on an empty record', () => {
    expect(A.getAccountAnchorDate({})).toBeNull();
    expect(A.getAccountAnchorDate(null)).toBeNull();
  });
});

describe('a start date can no longer buy an attendance record', () => {
  /*
   * THE BUG. The card said only "future dates are not allowed", so there was no
   * lower bound at all. Every working day between the typed date and the portal
   * registration was credited, and getAttendanceSummary caps the total at the
   * working days elapsed — which a date about one tenure back fills exactly. A
   * student with nothing recorded against them typed a date and read 100%,
   * eligible for a certificate.
   */
  it('a claim covering the whole requirement counts for nothing until a human says', () => {
    const s = joiner({ internshipStartDate: daysAgo(200) });
    expect(A.claimNeedsReview(s.internshipStartDate, s)).toBe(true);

    const held = A.getAttendanceSummary([], Object.assign({}, s, { preportalCreditNeedsReview: true }));
    expect(held.preportalCreditedDays).toBe(0);
    expect(held.percentage).toBe(0);
    expect(held.isEligible).toBe(false);
  });

  it('and counts in full once a human does', () => {
    const s = joiner({
      internshipStartDate: daysAgo(200),
      preportalCreditNeedsReview: true,
      preportalCreditConfirmedAt: new Date()
    });
    expect(A.getAttendanceSummary([], s).preportalCreditedDays).toBeGreaterThan(0);
  });

  /*
   * The line is the portal's own 75%, not a number somebody picked. Below it a
   * student still has to turn up for real days, so an inflated claim only
   * flatters a figure they cannot finish on.
   */
  it('an ordinary claim is counted without asking anyone', () => {
    const s = joiner({ internshipStartDate: daysAgo(60) });
    expect(A.claimNeedsReview(s.internshipStartDate, s)).toBe(false);
    const x = A.getAttendanceSummary([], s);
    expect(x.preportalCreditedDays).toBeGreaterThan(0);
    expect(x.percentage).toBeLessThan(75);
  });

  /*
   * Against the tenure's finish line, not the days elapsed so far.
   *
   * Measuring it against elapsed days sent the ordinary case to HR: a one-month
   * student who did five days on WhatsApp has six working days elapsed on their
   * first day in the portal, so five of them "satisfies 75%" on a technicality
   * — and that student is exactly who the feature exists for.
   */
  it.each(['1week', '15days', '1month', '45days', '3months', '6months'])(
    'no unreviewed claim covers a %s internship on its own', (tenure) => {
      const s = joiner({ tenure });
      const cutoff = A.getEarliestUnreviewedStartDate(s);
      const x = A.getAttendanceSummary([], Object.assign({}, s, { internshipStartDate: cutoff }));
      expect(A.claimNeedsReview(cutoff, s)).toBe(false);
      // The last claim waved through must still leave real days to attend.
      expect(x.preportalCreditedDays).toBeLessThan(x.requiredByEnd);
      expect(x.stillNeedsByEnd).toBeGreaterThan(0);

      // One day earlier crosses the line and is held.
      const over = new Date(cutoff);
      over.setDate(over.getDate() - 1);
      expect(A.claimNeedsReview(over, s)).toBe(true);
    });

  /*
   * The worked example, at every tenure: a handful of WhatsApp days before the
   * portal is an ordinary claim and is simply credited. This is the case the
   * review gate used to swallow.
   */
  it.each(['1week', '15days', '1month', '45days', '3months', '6months'])(
    'five WhatsApp days on a %s tenure are credited without asking HR', (tenure) => {
      const anchor = new Date();
      anchor.setHours(0, 0, 0, 0);
      const start = new Date(anchor);
      let working = 0;
      while (working < 5) {
        start.setDate(start.getDate() - 1);
        if (start.getDay() !== 0) working++;
      }
      const s = {
        joinerType: 'whatsapp', tenure,
        joiningDate: anchor.toISOString().slice(0, 10), createdAt: anchor,
        internshipStartDate: start.toISOString().slice(0, 10)
      };
      // A one-week tenure has only six working days in it, so five of them IS
      // the whole internship — that one is meant to be checked.
      const wholeInternship = tenure === '1week';
      expect(A.claimNeedsReview(s.internshipStartDate, s)).toBe(wholeInternship);
      if (!wholeInternship) {
        expect(A.getAttendanceSummary([], s).preportalCreditedDays).toBe(5);
      }
    });

  it('credits nothing for a start date on or after the account existed', () => {
    const s = joiner({ internshipStartDate: daysAgo(10) });
    expect(A.claimNeedsReview(s.internshipStartDate, s)).toBe(false);
    expect(A.getAttendanceSummary([], s).preportalCreditedDays).toBe(0);
  });

  it('never credits more days than the internship contains', () => {
    // Rows written before the guard existed are still in the database, and an
    // uncapped figure reads as a real number on every screen that shows it.
    const s = joiner({
      internshipStartDate: '2015-01-01',
      preportalCreditNeedsReview: true,
      preportalCreditConfirmedAt: new Date()
    });
    const x = A.getAttendanceSummary([], s);
    expect(x.preportalCreditedDays).toBeLessThanOrEqual(x.totalWorkingDays);
  });

  it('a coordinator can still subtract the days they were absent', () => {
    const s = joiner({ internshipStartDate: daysAgo(60) });
    const full = A.getAttendanceSummary([], s).preportalCreditedDays;
    const less = A.getAttendanceSummary([], Object.assign({}, s, { preportalAbsentDays: 5 })).preportalCreditedDays;
    expect(less).toBe(full - 5);
  });

  it('credits nothing at all for a student who is not a WhatsApp joiner', () => {
    const s = joiner({ joinerType: 'new', internshipStartDate: daysAgo(200) });
    expect(A.getAttendanceSummary([], s).preportalCreditedDays).toBe(0);
  });
});

describe('what the date picker refuses', () => {
  const s = joiner({});

  it('refuses a date in the future', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const r = A.checkStartDate(tomorrow, s);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/future/);
  });

  it('refuses text that is not a date', () => {
    expect(A.checkStartDate('last tuesday', s).ok).toBe(false);
  });

  /*
   * It refuses nothing else, deliberately. The floor on this field was "today
   * minus 90 days" once and eighteen months after that, and either way a date
   * input reports an EMPTY value for anything below `min` — so the student saw
   * the date they had typed while the page insisted none was chosen, on the
   * last card of onboarding with nothing else to click.
   */
  it('accepts a genuinely old date rather than stranding the student', () => {
    const r = A.checkStartDate(daysAgo(400), s);
    expect(r.ok).toBe(true);
    expect(r.needsReview).toBe(true);
  });

  it('the browser no longer sets a floor it would enforce alone', () => {
    const page = strip(fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8'));
    expect(page).toContain("dateInput.removeAttribute('min')");
    expect(page).not.toContain('floor.setMonth(floor.getMonth() - 18)');
  });
});

describe('the wizard endpoint', () => {
  const src = strip(fs.readFileSync(path.join(root, 'routes/v2/studentPortal.js'), 'utf8'));

  /*
   * "Asked once, and once more each time HR resets" lived ENTIRELY in the
   * browser: four flags on the student's own record, read by their own page.
   * The request could simply be sent again — re-picking the start date, and
   * changing the employee ID every Attendance row is keyed to, without HR
   * resetting anything.
   */
  it('refuses a second submission', () => {
    /*
     * On a field this wizard owns. Every other onboarding flag belongs to some
     * other feature as well, and each one strands the student on the last card:
     * v2Onboarded is set by GET /student/status on every page load (that guard
     * shipped, and blocked every student), joinerTypeSelected by the previous
     * card, onboardingPopupSeen by /mark-onboarding-seen.
     */
    expect(src).toContain('if (student.joinerWizardCompletedAt) {');
    expect(src).toContain('updates.joinerWizardCompletedAt = new Date();');
    expect(src).toContain('alreadyCompleted: true');
    expect(src).toContain('res.status(409)');
  });

  it('validates the date through the shared rule, not its own', () => {
    expect(src).toContain('checkStartDate(startDate, student)');
    expect(src).toContain('updates.preportalCreditNeedsReview = verdict.needsReview');
  });

  /*
   * The screen worked out its own requirement — 75% of the CALENDAR tenure.
   * Attendance skips Sundays, so a 90-day tenure holds 77 working days and the
   * card demanded 68 of them, measured against the whole tenure rather than the
   * part that had happened. A student one month in was told to attend 61 more
   * days when the real figure was 12. Nothing else counted it that way.
   */
  it('reports the figures the student is actually judged by', () => {
    expect(src).toContain('daysNeededToAttendMore = summary.stillNeeds');
    expect(src).not.toContain('Math.ceil(totalTenureDays * 0.75)');
    ['workingDaysElapsed', 'requiredSoFar', 'creditHeldForReview']
      .forEach((k) => expect(src).toContain(k + ':'));
  });

  it('recomputes the end date when it moves the start date', () => {
    expect(src).toContain('updates.internshipEndDate = derivedEnd');
  });

  it('the screen prints those figures rather than its own', () => {
    const page = strip(fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8'));
    expect(page).toContain('data.student.progress');
    expect(page).not.toContain("Math.ceil(totalTenure * 0.75)");
    expect(page).toContain('Sundays do not count');
  });
});

describe('HR can see and settle a held claim', () => {
  const hr = strip(fs.readFileSync(path.join(root, 'routes/v2/hr.js'), 'utf8'));
  const page = strip(fs.readFileSync(path.join(root, 'public/hr-portal.html'), 'utf8'));

  it('the lookup carries the claim', () => {
    expect(hr).toContain('preportalClaim: preportalClaim(student)');
  });

  it('settling it needs the same level as reopening the questions', () => {
    // Both decide how many days a student is credited for without a record.
    expect(hr).toContain('router.post("/onboarding/preportal", requireHR, requireHRLevel(RESET_MIN_LEVEL)');
  });

  it.each(['confirm', 'decline', 'adjust'])('offers "%s"', (action) => {
    expect(hr).toContain('"' + action + '"');
    expect(page).toContain("decidePreportal(employeeId, '" + action + "')");
  });

  it('recounts attendance the moment the decision is made', () => {
    // Otherwise the figure on their dashboard stays stale until something else
    // happens to touch the record.
    const at = hr.indexOf('router.post("/onboarding/preportal"');
    const next = hr.indexOf('\nrouter.', at + 1);
    const block = hr.slice(at, next === -1 ? undefined : next);
    expect(block).toContain('getAttendanceSummary(rows, updated)');
    expect(block).toContain('attendancePercentage: summary.percentage');
  });
});

describe('nothing writes the joiner fields around the back', () => {
  const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));

  /*
   * Three endpoints took the student from `req.body.employeeId ||
   * req.headers['x-employee-id']` with no session check at all. /save-start-date
   * was the joining-date card with none of its rules: no authentication, no
   * future-date check, no pre-portal review, no end-date recompute, no
   * attendance recount — on the field that drives attendance crediting and every
   * date printed on a certificate. All three had zero callers.
   */
  it.each(['/save-start-date', '/save-joiner-type', '/mark-onboarding-seen'])(
    'POST %s is gone', (route) => {
      expect(server).not.toContain('app.post(["' + route + '"');
    });

  it('the one that is still called takes its identity from the session', () => {
    const at = server.indexOf('app.post(["/mark-welcome-seen"');
    expect(at).toBeGreaterThan(-1);
    const block = server.slice(at, at + 700);
    expect(block).toContain('req.session && req.session.student && req.session.student.employeeId');
    expect(block).not.toContain("req.headers['x-employee-id']");
  });

  it('the internship start date is written by exactly one route', () => {
    // Two ways to set it is how one of them ends up without the rules.
    const writers = (server.match(/internshipStartDate:\s*startDate/g) || []).length;
    expect(writers).toBe(0);
  });
});

describe('the reset withdraws what the wrong answer created', () => {
  const { portalRegistrationDate } = require('../../services/onboardingReset');
  const src = strip(fs.readFileSync(path.join(root, 'services/onboardingReset.js'), 'utf8'));

  /*
   * This read joiningDate first, which quietly defeated the reset for the
   * students who most needed it: for a record whose joiningDate had already
   * been overwritten with the back-dated value, the reset "restored" the start
   * date to the very date it was meant to remove.
   */
  it.each([
    ['a healthy record',        { joiningDate: '2026-07-20', createdAt: new Date('2026-07-20') }, '2026-07-20'],
    ['one the old wizard broke',{ joiningDate: '2026-03-01', createdAt: new Date('2026-07-20') }, '2026-07-20'],
    ['one an admin back-dated', { joiningDate: '2025-03-01', createdAt: new Date('2026-07-20') }, '2026-07-20'],
    ['a legitimately later one',{ joiningDate: '2026-08-05', createdAt: new Date('2026-07-20') }, '2026-08-05']
  ])('anchors %s correctly', (_label, student, expected) => {
    expect(iso(portalRegistrationDate(student))).toBe(expected);
  });

  it('reopens the wizard on the server, not only in the browser', () => {
    // Without this the reset reopens the cards and the last one answers 409.
    expect(src).toContain('joinerWizardCompletedAt: null');
  });

  it('clears any confirmation with the claim it belonged to', () => {
    // A confirmation belongs to one claim; leaving it would pre-approve the next.
    expect(src).toContain('preportalCreditNeedsReview: false');
    expect(src).toContain('preportalCreditConfirmedAt: null');
  });

  it('moves the end date with the start date', () => {
    expect(src).toContain('updates.internshipEndDate = end');
  });

  it('still leaves the work alone', () => {
    // Tasks, submissions, coins, certificates and the Attendance rows.
    ['tasks', 'submissions', 'coins', 'certificates']
      .forEach((w) => expect(src.toLowerCase()).not.toContain('updates.' + w));
  });
});

describe('the one-off repair script', () => {
  const src = fs.readFileSync(path.join(root, 'scripts/recalculate-attendance.js'), 'utf8');

  it('writes nothing without --write', () => {
    expect(src).toContain("const write = process.argv.includes('--write')");
    expect(src).toContain('Dry run');
  });

  it('names the students whose figure will fall', () => {
    // They will open the portal and see a smaller number; somebody has to tell
    // them first.
    expect(src).toContain('WILL SEE A LOWER FIGURE');
  });

  it('holds large claims instead of deleting them', () => {
    // A real four-month WhatsApp joiner exists and the script cannot tell them
    // apart from someone who typed a number. That is what HR is for.
    expect(src).toContain('claimNeedsReview');
    expect(src).not.toContain('internshipStartDate: null');
  });
});

describe('how many more days do I actually have to attend', () => {
  const rows = (n, fromDaysAgo) => Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - fromDaysAgo + i);
    return { status: 'Present', date: d, dateKey: d.toISOString().slice(0, 10) };
  });

  /*
   * THE MISCALCULATION, reported from a phone.
   *
   * The card printed `requiredDays - present`, which is 75% of the days that
   * have ALREADY passed minus what you have — how far behind you are today.
   * Every screen labelled it "attend N more days to catch up", and that is a
   * different question with a much bigger answer: attending N more days TAKES
   * N more days, and the requirement grows by 0.75 of every one of them.
   */
  it('the number is not the gap you can see today', () => {
    const s = { joinerType: 'new', tenure: '3months',
                joiningDate: daysAgo(35), createdAt: new Date(daysAgo(35)) };
    const x = A.getAttendanceSummary(rows(8, 12), s);

    // The gap today, which is what used to be printed.
    expect(x.stillNeeds).toBe(Math.max(0, x.requiredDays - x.daysPresent));

    // Attending exactly that many more does NOT get you to 75%, because the
    // requirement moved while you were attending.
    const after = x.daysPresent + x.stillNeeds;
    const elapsedThen = x.workingDaysElapsed + x.stillNeeds;
    expect(after).toBeLessThan(Math.ceil(elapsedThen * 0.75));

    // The figure that means something is against the tenure's fixed finish
    // line, and it is the larger one.
    expect(x.stillNeedsByEnd).toBeGreaterThan(x.stillNeeds);
    expect(x.stillNeedsByEnd).toBe(x.requiredByEnd - x.daysPresent);
  });

  it('attending exactly stillNeedsByEnd more days finishes at 75%', () => {
    // The promise the sentence makes, checked.
    const s = { joinerType: 'new', tenure: '3months',
                joiningDate: daysAgo(35), createdAt: new Date(daysAgo(35)) };
    const x = A.getAttendanceSummary(rows(8, 12), s);
    const finalPresent = x.daysPresent + x.stillNeedsByEnd;
    expect(finalPresent).toBeGreaterThanOrEqual(Math.ceil(x.totalWorkingDays * 0.75));
  });

  /*
   * "which student tenure is how, that candidate can only go that much only,
   * not more than that" — every figure is bounded by the tenure.
   */
  it.each([
    ['1week',   6],
    ['15days',  12],
    ['1month',  25],
    ['45days',  38],
    ['3months', 77],
    ['6months', 154]
  ])('a %s student is judged on %i working days and no more', (tenure, workingDays) => {
    const s = { joinerType: 'new', tenure, joiningDate: daysAgo(400), createdAt: new Date(daysAgo(400)) };
    const x = A.getAttendanceSummary([], s);
    expect(x.totalWorkingDays).toBe(workingDays);
    // Long past the end, and still bounded by the tenure.
    expect(x.workingDaysElapsed).toBeLessThanOrEqual(x.totalWorkingDays);
    expect(x.requiredByEnd).toBe(Math.ceil(workingDays * 0.75));
    expect(x.stillNeedsByEnd).toBeLessThanOrEqual(workingDays);
    expect(x.workingDaysRemaining).toBe(0);
  });

  it('says when 75% has stopped being reachable', () => {
    // Nothing told a student this, so they could go on chasing a target that
    // had already gone.
    const gone = { joinerType: 'new', tenure: '1month',
                   joiningDate: daysAgo(40), createdAt: new Date(daysAgo(40)) };
    const x = A.getAttendanceSummary([], gone);
    expect(x.workingDaysRemaining).toBe(0);
    expect(x.stillNeedsByEnd).toBeGreaterThan(0);
    expect(x.canStillQualify).toBe(false);

    const fresh = { joinerType: 'new', tenure: '1month',
                    joiningDate: daysAgo(1), createdAt: new Date(daysAgo(1)) };
    expect(A.getAttendanceSummary([], fresh).canStillQualify).toBe(true);
  });

  /*
   * The worked example: one month of tenure, five days already done on
   * WhatsApp, then the portal. Those five working days are credited when the
   * date is entered, Sundays excluded.
   */
  it('credits exactly the WhatsApp working days, Sundays excluded', () => {
    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);

    // Walk back until five WORKING days have passed, whatever weekday today is.
    const start = new Date(anchor);
    let working = 0;
    while (working < 5) {
      start.setDate(start.getDate() - 1);
      if (start.getDay() !== 0) working++;
    }

    const s = {
      joinerType: 'whatsapp', tenure: '1month',
      joiningDate: anchor.toISOString().slice(0, 10), createdAt: anchor,
      internshipStartDate: start.toISOString().slice(0, 10)
    };
    const x = A.getAttendanceSummary([], s);

    expect(x.preportalCreditedDays).toBe(5);
    expect(x.daysPresent).toBe(5);
    expect(A.claimNeedsReview(s.internshipStartDate, s)).toBe(false);   // ordinary, no HR needed
    // And their one month is still one month: the WhatsApp stretch comes out
    // of it, it is not added on top.
    expect(x.totalWorkingDays).toBeLessThanOrEqual(26);
  });

  it('a Sunday in the WhatsApp stretch is not credited', () => {
    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    const start = new Date(anchor);
    start.setDate(start.getDate() - 14);          // two weeks: contains two Sundays

    const s = { joinerType: 'whatsapp', tenure: '1month',
                joiningDate: anchor.toISOString().slice(0, 10), createdAt: anchor,
                internshipStartDate: start.toISOString().slice(0, 10) };

    let sundays = 0;
    const cur = new Date(start);
    while (cur < anchor) { if (cur.getDay() === 0) sundays++; cur.setDate(cur.getDate() + 1); }

    expect(A.getAttendanceSummary([], s).preportalCreditedDays).toBe(14 - sundays);
  });
});

describe('every screen prints the figure that means something', () => {
  const page = strip(fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8'));
  const api = strip(fs.readFileSync(path.join(root, 'routes/v2/studentPortal.js'), 'utf8'));
  const srv = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));

  it('the joining-date card', () => {
    expect(api).toContain('daysNeededToAttendMore = summary.stillNeedsByEnd');
    expect(api).not.toContain('daysNeededToAttendMore = summary.stillNeeds;');
    expect(page).toContain('p.requiredByEnd');
    expect(page).toContain('p.canStillQualify === false');
    expect(page).not.toContain('more to catch up.');
  });

  it('the attendance banner on the dashboard', () => {
    expect(page).toContain('s.stillNeedsByEnd');
    expect(page).toContain('s.canStillQualify === false');
    expect(page).not.toContain('more to reach 75% (" + requiredDays + " days required)');
  });

  it('both server payloads carry it', () => {
    expect((srv.match(/stillNeedsByEnd: summary\.stillNeedsByEnd/g) || []).length).toBe(2);
    expect((srv.match(/canStillQualify: summary\.canStillQualify/g) || []).length).toBe(2);
  });
});
