'use strict';

const {
  isSunday,
  countWorkingDays,
  getEffectiveStartDate,
  getTotalWorkingDaysForTenure,
  getElapsedWorkingDays,
  getPreportalCreditedDays,
  getAttendanceSummary,
  buildAttendanceHistory,
  has75PercentAttendance
} = require('../../utils/attendanceUtils');

// 2026-07-01 is a Wednesday. Freeze "today" so elapsed-day maths is stable.
const TODAY = new Date('2026-07-15T12:00:00');

beforeAll(() => { jest.useFakeTimers().setSystemTime(TODAY); });
afterAll(() => { jest.useRealTimers(); });

const present = (dateKey, markedBy = 'coordinator') => ({ dateKey, status: 'Present', markedBy });

function student(overrides = {}) {
  return {
    employeeId: 'TEN/WEB/1001',
    tenure: '45 Days',
    joiningDate: '2026-07-01',
    joinerType: 'new',
    internshipStartDate: null,
    ...overrides
  };
}

describe('utils/attendanceUtils', () => {
  describe('isSunday', () => {
    it('identifies Sunday and nothing else', () => {
      expect(isSunday(new Date('2026-07-05'))).toBe(true);  // Sunday
      expect(isSunday(new Date('2026-07-04'))).toBe(false); // Saturday
      expect(isSunday(new Date('2026-07-06'))).toBe(false); // Monday
    });
    it('accepts a date string', () => {
      expect(isSunday('2026-07-05')).toBe(true);
    });
  });

  describe('countWorkingDays', () => {
    it('excludes Sundays', () => {
      // Wed 1 Jul → Tue 7 Jul is 7 calendar days containing one Sunday (5 Jul)
      expect(countWorkingDays('2026-07-01', '2026-07-07')).toBe(6);
    });
    it('counts a single non-Sunday day as 1', () => {
      expect(countWorkingDays('2026-07-01', '2026-07-01')).toBe(1);
    });
    it('counts a single Sunday as 0', () => {
      expect(countWorkingDays('2026-07-05', '2026-07-05')).toBe(0);
    });
    it('never counts days in the future', () => {
      // Range runs to the end of August but today is 15 July.
      const capped = countWorkingDays('2026-07-01', '2026-08-31');
      const toToday = countWorkingDays('2026-07-01', '2026-07-15');
      expect(capped).toBe(toToday);
    });
    it('returns 0 when the range is inverted', () => {
      expect(countWorkingDays('2026-07-10', '2026-07-01')).toBe(0);
    });
  });

  describe('getEffectiveStartDate', () => {
    it('uses joiningDate for a normal joiner', () => {
      const s = student({ joiningDate: '2026-07-01', internshipStartDate: '2026-05-01' });
      expect(getEffectiveStartDate(s).toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    // The section 2 fix: a WhatsApp joiner attended before they registered.
    it('uses the earlier internshipStartDate for a WhatsApp joiner', () => {
      const s = student({ joinerType: 'whatsapp', joiningDate: '2026-07-01', internshipStartDate: '2026-06-01' });
      expect(getEffectiveStartDate(s).toISOString().slice(0, 10)).toBe('2026-06-01');
    });

    it('falls back to joiningDate when a WhatsApp joiner has no start date set', () => {
      const s = student({ joinerType: 'whatsapp', internshipStartDate: null });
      expect(getEffectiveStartDate(s).toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    it('returns null when there is no usable date at all', () => {
      expect(getEffectiveStartDate({ joinerType: 'new' })).toBeNull();
      expect(getEffectiveStartDate(null)).toBeNull();
    });
  });

  describe('tenure length is honoured', () => {
    // Before utils/tenure.js, "45 Days" never matched the lookup key "45days"
    // and every student was treated as a 30-day student.
    it('gives a 45-day student more working days than a 1-month student', () => {
      const fortyFive = getTotalWorkingDaysForTenure('2026-07-01', '45 Days');
      const oneMonth  = getTotalWorkingDaysForTenure('2026-07-01', '1 Month');
      expect(fortyFive).toBeGreaterThan(oneMonth);
    });
    it('counts the full span including future days', () => {
      // 45 calendar days from 1 Jul, minus the Sundays in that span.
      expect(getTotalWorkingDaysForTenure('2026-07-01', '45 Days')).toBe(39);
    });
    it('elapsed days stop at today', () => {
      // 1 Jul → 15 Jul inclusive = 15 days, minus Sundays 5 and 12 = 13
      expect(getElapsedWorkingDays('2026-07-01', '45 Days')).toBe(13);
    });
  });

  describe('getPreportalCreditedDays', () => {
    it('is zero for a normal joiner', () => {
      expect(getPreportalCreditedDays(student())).toBe(0);
    });

    it('credits the working days a WhatsApp joiner attended before registering', () => {
      const s = student({ joinerType: 'whatsapp', internshipStartDate: '2026-06-01', joiningDate: '2026-07-01' });
      // 1 Jun → 30 Jun, Sundays excluded
      expect(getPreportalCreditedDays(s)).toBe(countWorkingDays('2026-06-01', '2026-06-30'));
    });

    it('is zero when the start date is not actually earlier', () => {
      const s = student({ joinerType: 'whatsapp', internshipStartDate: '2026-07-01', joiningDate: '2026-07-01' });
      expect(getPreportalCreditedDays(s)).toBe(0);
    });

    it('honours a coordinator absence adjustment', () => {
      const s = student({
        joinerType: 'whatsapp', internshipStartDate: '2026-06-01', joiningDate: '2026-07-01',
        preportalAbsentDays: 5
      });
      const full = countWorkingDays('2026-06-01', '2026-06-30');
      expect(getPreportalCreditedDays(s)).toBe(full - 5);
    });

    it('never goes negative if the adjustment exceeds the period', () => {
      const s = student({
        joinerType: 'whatsapp', internshipStartDate: '2026-06-28', joiningDate: '2026-07-01',
        preportalAbsentDays: 999
      });
      expect(getPreportalCreditedDays(s)).toBe(0);
    });
  });

  describe('getAttendanceSummary', () => {
    it('measures against elapsed working days, not the whole tenure', () => {
      const s = student();
      const summary = getAttendanceSummary([], s);
      expect(summary.workingDaysElapsed).toBe(13);
      expect(summary.totalWorkingDays).toBe(39);
      expect(summary.requiredDays).toBe(Math.ceil(13 * 0.75));
    });

    it('counts a day once even when marked by both self and coordinator', () => {
      const records = [present('2026-07-02', 'self'), present('2026-07-02', 'coordinator')];
      expect(getAttendanceSummary(records, student()).daysPresent).toBe(1);
    });

    it('ignores Absent rows', () => {
      const records = [present('2026-07-02'), { dateKey: '2026-07-03', status: 'Absent', markedBy: 'coordinator' }];
      expect(getAttendanceSummary(records, student()).daysPresent).toBe(1);
    });

    it('reports 100% for a student present every elapsed working day', () => {
      const records = [];
      for (const d of ['01','02','03','04','06','07','08','09','10','11','13','14','15']) {
        records.push(present(`2026-07-${d}`));
      }
      const summary = getAttendanceSummary(records, student());
      expect(summary.daysPresent).toBe(13);
      expect(summary.percentage).toBe(100);
      expect(summary.isEligible).toBe(true);
    });

    // Screenshot 2: the "0/6 days present — need 5 more" panel.
    it('reports how many more days are needed to reach 75%', () => {
      const summary = getAttendanceSummary([], student());
      expect(summary.daysPresent).toBe(0);
      expect(summary.stillNeeds).toBe(summary.requiredDays);
      expect(summary.isEligible).toBe(false);
    });

    // Section 3: "Day 12 of 45".
    it('reports calendar day progress for the panel', () => {
      const summary = getAttendanceSummary([], student());
      expect(summary.dayNumber).toBe(15);        // 1 Jul → 15 Jul inclusive
      expect(summary.totalCalendarDays).toBe(45);
      expect(summary.daysRemaining).toBe(30);
    });

    // Section 2: the headline fix.
    it('does not penalise a WhatsApp joiner for the pre-portal period', () => {
      const whatsapp = student({
        joinerType: 'whatsapp', internshipStartDate: '2026-06-01', joiningDate: '2026-07-01'
      });
      // Present every tracked working day since joining the portal.
      const records = ['01','02','03','04','06','07','08','09','10','11','13','14','15']
        .map((d) => present(`2026-07-${d}`));

      const summary = getAttendanceSummary(records, whatsapp);
      expect(summary.preportalCreditedDays).toBeGreaterThan(0);
      expect(summary.percentage).toBe(100);
      expect(summary.isEligible).toBe(true);
    });

    it('credited days can never exceed the elapsed window', () => {
      const whatsapp = student({
        joinerType: 'whatsapp', internshipStartDate: '2026-06-01', joiningDate: '2026-07-01'
      });
      const summary = getAttendanceSummary([], whatsapp);
      expect(summary.daysPresent).toBeLessThanOrEqual(summary.workingDaysElapsed);
      expect(summary.percentage).toBeLessThanOrEqual(100);
    });

    it('returns a safe zeroed summary when there is no start date', () => {
      const summary = getAttendanceSummary([], { tenure: '45 Days' });
      expect(summary.percentage).toBe(0);
      expect(summary.startDate).toBeNull();
    });
  });

  describe('buildAttendanceHistory', () => {
    it('never emits a row for a Sunday', () => {
      const rows = buildAttendanceHistory([], student());
      const sundays = rows.filter((r) => isSunday(r.date));
      expect(sundays).toEqual([]);
      expect(rows.some((r) => r.dateKey === '2026-07-05')).toBe(false);
    });

    it('returns newest first', () => {
      const rows = buildAttendanceHistory([], student());
      expect(rows[0].dateKey).toBe('2026-07-15');
      expect(rows[rows.length - 1].dateKey).toBe('2026-07-01');
    });

    it('marks days with no record as Absent for a normal joiner', () => {
      const rows = buildAttendanceHistory([present('2026-07-02', 'self')], student());
      const jul2 = rows.find((r) => r.dateKey === '2026-07-02');
      const jul3 = rows.find((r) => r.dateKey === '2026-07-03');
      expect(jul2.self).toBe('Present');
      expect(jul3.self).toBe('Absent');
    });

    it('shows the WhatsApp pre-portal period as attended, not absent', () => {
      const whatsapp = student({
        joinerType: 'whatsapp', internshipStartDate: '2026-06-01', joiningDate: '2026-07-01'
      });
      const rows = buildAttendanceHistory([], whatsapp);
      const june = rows.find((r) => r.dateKey === '2026-06-15');
      expect(june.isPreportal).toBe(true);
      expect(june.self).toBe('Present');
      expect(june.coordinator).toBe('Present');
    });

    it('has one row per elapsed working day', () => {
      const rows = buildAttendanceHistory([], student());
      expect(rows).toHaveLength(getElapsedWorkingDays('2026-07-01', '45 Days'));
    });
  });

  describe('has75PercentAttendance', () => {
    it('is false with no attendance', () => {
      expect(has75PercentAttendance([], student())).toBe(false);
    });
    it('is true at full attendance', () => {
      const records = ['01','02','03','04','06','07','08','09','10','11','13','14','15']
        .map((d) => present(`2026-07-${d}`));
      expect(has75PercentAttendance(records, student())).toBe(true);
    });
  });
});
