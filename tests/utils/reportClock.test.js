'use strict';

const clock = require('../../utils/reportClock');

describe('utils/reportClock', () => {
  const instant = new Date('2026-09-16T19:30:00Z'); // 01:00 on the 17th in Kolkata

  afterEach(() => { delete process.env.ATTENDANCE_TZ; });

  it('keys a day by the report timezone, not the server clock', () => {
    expect(clock.dateKeyFor(instant, 'Asia/Kolkata')).toBe('2026-09-17');
    expect(clock.dateKeyFor(instant, 'UTC')).toBe('2026-09-16');
  });

  it('prints the wall clock in that timezone', () => {
    expect(clock.clockFor(instant, 'Asia/Kolkata')).toBe('01:00');
    expect(clock.clockFor(instant, 'UTC')).toBe('19:30');
  });

  it('defaults to Asia/Kolkata and falls back to UTC on an unknown zone', () => {
    expect(clock.reportTimeZone()).toBe('Asia/Kolkata');
    process.env.ATTENDANCE_TZ = 'Mars/Olympus';
    expect(clock.reportTimeZone()).toBe('UTC');
  });

  it('shifts keys across month boundaries', () => {
    expect(clock.shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(clock.shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('recognises a key and renders it for a human, the same on every ICU build', () => {
    expect(clock.isDateKey('2026-09-17')).toBe(true);
    expect(clock.isDateKey('17/09/2026')).toBe(false);
    expect(clock.humanDate('2026-09-17')).toBe('Thu, 17 Sep 2026');
    expect(clock.humanDate('2026-03-01')).toBe('Sun, 1 Mar 2026');
  });
});
