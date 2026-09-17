'use strict';

jest.mock('mongoose', () => ({ connection: { readyState: 1 } }));
jest.mock('../../../services/v2/loginEvents', () => ({ listByDay: jest.fn() }));
jest.mock('../../../services/v2/attendanceSources', () => ({
  selfMarksFor: jest.fn(),
  studentsByEmployeeIds: jest.fn(),
}));
jest.mock('../../../services/v2/formResponses', () => ({
  isConfigured: jest.fn(() => false),
  responsesForDay: jest.fn(),
}));

const mongoose = require('mongoose');
const loginEvents = require('../../../services/v2/loginEvents');
const sources = require('../../../services/v2/attendanceSources');
const formResponses = require('../../../services/v2/formResponses');
const { buildDailyReport, formatWhatsApp } = require('../../../services/v2/attendanceReport');

const DAY = '2026-09-17';
const TZ = { tz: 'Asia/Kolkata' };
const ev = (o) => ({ dateKey: DAY, success: true, ip: '1.2.3.4', ...o });

describe('services/v2/attendanceReport', () => {
  beforeEach(() => {
    delete process.env.ATTENDANCE_INCLUDE_PORTAL_LOGINS;
    mongoose.connection.readyState = 1;
    loginEvents.listByDay.mockReset().mockResolvedValue([]);
    sources.selfMarksFor.mockReset().mockResolvedValue([]);
    sources.studentsByEmployeeIds.mockReset().mockResolvedValue([]);
    formResponses.isConfigured.mockReset().mockReturnValue(false);
    formResponses.responsesForDay.mockReset();
  });

  describe('the attendance form', () => {
    const FORM = {
      dateKey: DAY, totalResponses: 4, uniqueRespondents: 3, columns: ['Full Name', 'Employee ID', 'Domain'], dateFormat: 'DMY',
      respondents: [
        { line: 'Bikram Das (TEN002) - MERN', firstClock: '08:00', lastClock: '08:00', count: 1 },
        { line: 'Asha Rao (TEN001) - Python', firstClock: '09:05', lastClock: '14:40', count: 2 },
        { line: 'Dev - Java', firstClock: '10:15', lastClock: '10:15', count: 1 },
      ],
    };

    it('leads the report, one line per person in order of first submission', async () => {
      formResponses.isConfigured.mockReturnValue(true);
      formResponses.responsesForDay.mockResolvedValue(FORM);

      const r = await buildDailyReport(DAY, TZ);
      expect(formResponses.responsesForDay).toHaveBeenCalledWith(DAY);
      expect(r.totals).toMatchObject({ formResponses: 4, formRespondents: 3 });

      const text = formatWhatsApp(r);
      expect(text).toBe([
        '*TEN Attendance*',
        'Thu, 17 Sep 2026 (Asia/Kolkata)',
        '',
        '*Attendance form*',
        'Filled: *3* people (4 responses)',
        '',
        '08:00  Bikram Das (TEN002) - MERN',
        '09:05  Asha Rao (TEN001) - Python x2, last 14:40',
        '10:15  Dev - Java',
      ].join('\n'));
    });

    it('says so when nobody filled it', async () => {
      formResponses.isConfigured.mockReturnValue(true);
      formResponses.responsesForDay.mockResolvedValue({ ...FORM, totalResponses: 0, uniqueRespondents: 0, respondents: [] });
      expect(formatWhatsApp(await buildDailyReport(DAY, TZ))).toContain('Nobody filled the form.');
    });

    it('reports a sheet it could not read instead of pretending zero attendance', async () => {
      formResponses.isConfigured.mockReturnValue(true);
      formResponses.responsesForDay.mockRejectedValue(new Error("share it as 'Anyone with the link: Viewer'"));
      const r = await buildDailyReport(DAY, TZ);
      expect(r.form).toBeNull();
      expect(formatWhatsApp(r)).toContain("Form sheet could not be read: share it as 'Anyone with the link: Viewer'");
    });

    it('adds the portal sign-ins underneath only when asked', async () => {
      formResponses.isConfigured.mockReturnValue(true);
      formResponses.responsesForDay.mockResolvedValue(FORM);
      loginEvents.listByDay.mockResolvedValue([ev({ userType: 'hr', userId: 'hrdirector', label: 'HR Director', loginAt: '2026-09-17T04:00:00Z' })]);

      expect(formatWhatsApp(await buildDailyReport(DAY, TZ))).not.toContain('Portal sign-ins');
      process.env.ATTENDANCE_INCLUDE_PORTAL_LOGINS = 'true';
      const text = formatWhatsApp(await buildDailyReport(DAY, TZ));
      expect(text).toContain('*Portal sign-ins*\nSigned in: *1* person, 1 sign-in\nHR 1\n\n*HR (1)*\n09:30  HR Director (hrdirector)');
    });

    it('caps rows and total length so a busy day still fits one message', async () => {
      formResponses.isConfigured.mockReturnValue(true);
      const respondents = Array.from({ length: 300 }, (_, i) => ({ line: `Student Number ${i} (TEN${String(i).padStart(3, '0')}) - Web Development`, firstClock: `09:${String(i % 60).padStart(2, '0')}`, lastClock: '09:00', count: 1 }));
      formResponses.responsesForDay.mockResolvedValue({ ...FORM, totalResponses: 300, uniqueRespondents: 300, respondents });
      const text = formatWhatsApp(await buildDailyReport(DAY, TZ), { maxRows: 25 });
      expect(text).toContain('+275 more');
      expect(text.length).toBeLessThanOrEqual(3900);
    });
  });

  describe('portal sign-ins (no form configured)', () => {
    it('collapses repeat sign-ins into one row with first and last time', async () => {
      loginEvents.listByDay.mockResolvedValue([
        ev({ userType: 'student', userId: 'TEN001', label: 'Asha Rao', domain: 'Python', loginAt: '2026-09-17T03:35:00Z', portal: '/student-login' }),
        ev({ userType: 'student', userId: 'TEN001', label: 'Asha Rao', domain: 'Python', loginAt: '2026-09-17T09:10:00Z', portal: '/login' }),
        ev({ userType: 'hr', userId: 'hrdirector', label: 'HR Director', loginAt: '2026-09-17T04:00:00Z', portal: '/hr-login' }),
      ]);
      const r = await buildDailyReport(DAY, TZ);

      expect(r.totals).toMatchObject({ logins: 3, uniqueUsers: 2, byRole: { student: 1, hr: 1 }, failedAttempts: 0 });
      const asha = r.byRole.student[0];
      expect(asha).toMatchObject({ count: 2, firstClock: '09:05', lastClock: '14:40' });
      expect(asha.portals.sort()).toEqual(['/login', '/student-login']);

      const text = formatWhatsApp(r);
      expect(text).toContain('*Portal sign-ins*\nSigned in: *2* people, 3 sign-ins\nStudents 1 | HR 1');
      expect(text).toContain('*Students (1)*\n09:05  Asha Rao (TEN001) - Python x2, last 14:40');
      expect(text).toContain('*HR (1)*\n09:30  HR Director (hrdirector)');
    });

    it('flags students who marked present without signing in, and the reverse', async () => {
      loginEvents.listByDay.mockResolvedValue([ev({ userType: 'student', userId: 'TEN001', label: 'Asha Rao', loginAt: '2026-09-17T03:35:00Z' })]);
      sources.selfMarksFor.mockResolvedValue([{ employeeId: 'TEN002' }]);
      sources.studentsByEmployeeIds.mockResolvedValue([{ employeeId: 'TEN002', firstName: 'Bikram', lastName: 'Das', domains: ['MERN'] }]);

      const r = await buildDailyReport(DAY, TZ);
      expect(sources.studentsByEmployeeIds).toHaveBeenCalledWith(['TEN002']);
      expect(r.anomalies.markedWithoutLogin).toEqual([{ employeeId: 'TEN002', label: 'Bikram Das', domain: 'MERN' }]);
      expect(r.anomalies.loginWithoutMark).toEqual([{ employeeId: 'TEN001', label: 'Asha Rao', domain: '', firstClock: '09:05' }]);
      const text = formatWhatsApp(r);
      expect(text).toContain('*Marked present, no sign-in (1)*\n- Bikram Das (TEN002) - MERN');
      expect(text).toContain('*Signed in, attendance not marked (1)*\n- Asha Rao (TEN001)');
    });

    it('counts failed attempts by the account tried', async () => {
      loginEvents.listByDay.mockResolvedValue([
        ev({ userType: 'student', userId: 'TEN009', success: false, loginAt: '2026-09-17T03:00:00Z' }),
        ev({ userType: 'student', userId: 'TEN009', success: false, loginAt: '2026-09-17T03:01:00Z' }),
        ev({ userType: 'hr', email: 'x@ten.com', success: false, loginAt: '2026-09-17T03:02:00Z' }),
      ]);
      const r = await buildDailyReport(DAY, TZ);
      expect(r.totals.uniqueUsers).toBe(0);
      expect(r.failures).toEqual({ count: 3, top: [{ who: 'TEN009', count: 2 }, { who: 'x@ten.com', count: 1 }] });
      expect(formatWhatsApp(r)).toContain('No one signed in.\nFailed attempts: 3');
    });

    it('says the database is unavailable rather than reporting an empty day', async () => {
      mongoose.connection.readyState = 0;
      const r = await buildDailyReport(DAY, TZ);
      expect(loginEvents.listByDay).not.toHaveBeenCalled();
      expect(r.portalError).toBe('database not connected');
      expect(formatWhatsApp(r)).toContain('Unavailable: database not connected');
    });
  });
});
