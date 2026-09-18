'use strict';

/*
 * The Attendance Report section was removed from the dashboards, and it has to
 * stay removed.
 *
 * It was one shared module, /attendance-report.js, mounted by the student
 * dashboard (your own form attendance, by date) and by the HR and coordinator
 * dashboards (everybody's). All three are gone, along with the file itself.
 *
 * A test for something's absence earns its place when the thing left behind
 * half-wired pieces that still look correct in isolation. This one did: a nav
 * button whose view no longer exists opens onto nothing, a role's `views`
 * array naming a removed view silently grants nothing, and a <script> tag for
 * a deleted file is a 404 on every page load that nobody sees because the
 * dashboards still work. Each of those survives review on its own, so each is
 * checked here.
 *
 * What is NOT removed, and must not be: services/v2/attendanceReport.js and
 * /api/v2/attendance-agent. Those are the daily WhatsApp attendance report,
 * which shares a name with the deleted section and nothing else.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

const DASHBOARDS = ['student-dashboard.html', 'hr-portal.html', 'coordinator-dashboard.html'];

describe('the Attendance Report section is gone from every dashboard', () => {
  describe.each(DASHBOARDS)('%s', (file) => {
    const html = read(file);

    it('does not load the module or mount it', () => {
      expect(html).not.toContain('attendance-report.js');
      expect(html).not.toContain('TENAttendanceReport');
    });

    it('has no host element left behind', () => {
      expect(html).not.toContain('attendanceReportStudent');
      expect(html).not.toContain('attendanceReportStaff');
    });

    it('has no navigation pointing at it', () => {
      expect(html).not.toContain("'attendance-report'");
      expect(html).not.toContain('"attendance-report"');
      expect(html).not.toContain('stu-view-attendance-report');
    });
  });

  it('no longer ships the browser module', () => {
    expect(fs.existsSync(path.join(PUBLIC, 'attendance-report.js'))).toBe(false);
  });

  /*
   * Attendance itself stayed. Removing the report was asked for; removing the
   * daily attendance view, or the monitor, was not — and the two are one
   * careless search-and-replace apart.
   */
  it('leaves daily attendance and the attendance monitor alone', () => {
    expect(read('student-dashboard.html')).toContain('stu-view-attendance');
    expect(read('hr-portal.html')).toContain('view-attendance-monitor');
    expect(read('coordinator-dashboard.html')).toContain('tab-attendance');
  });

  it('leaves the WhatsApp daily report service and its route in place', () => {
    expect(fs.existsSync(path.join(ROOT, 'services', 'v2', 'attendanceReport.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'routes', 'v2', 'attendanceAgent.js'))).toBe(true);
  });
});
