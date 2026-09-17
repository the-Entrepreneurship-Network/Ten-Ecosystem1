'use strict';

jest.mock('../../../services/v2/attendanceSettings', () => ({
  fromDb: jest.fn(() => ''),
  cronFromTime: jest.fn(() => ''),
}));

const attendanceSettings = require('../../../services/v2/attendanceSettings');
const fr = require('../../../services/v2/formResponses');

/* The real form: DATE and TIME are questions of their own, the timestamp is
   when Google received it, and the domain has fixed options plus "Other". */
const CSV = [
  'Timestamp,Email Address,DATE,TIME,NAME,EMPLOYEE ID,DOMAIN,Attach screenshot of daily job posting done by you{Mandatory for HR people}',
  '18/09/2026 00:10:31,shounak@x.com,17/09/2026,9:56:00 PM,SHOUNAK SINHA,TEN-STU-004,SOFTWARE ENGINEERING,',
  '17/09/2026 09:05:12,asha@x.com,17/09/2026,09:05:00,Asha Rao,TEN-STU-001,TECH,',
  '17/09/2026 18:40:00,asha@x.com,,,Asha Rao,TEN-STU-001,TECH,',
  '16/09/2026 08:00:00,b@x.com,16/09/2026,8:00:00 AM,Bikram Das,TEN-STU-002,HR,https://drive.google.com/file/d/abc',
].join('\r\n');

function csvReply(text) { return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(text) }); }

describe('services/v2/formResponses with the form\'s own DATE and TIME', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    delete process.env.ATTENDANCE_SHEET_URL; delete process.env.ATTENDANCE_SHEET_ID; delete process.env.ATTENDANCE_SHEET_CSV_URL;
    delete process.env.ATTENDANCE_REQUIRED_PER_DAY;
    attendanceSettings.fromDb.mockReset().mockReturnValue('');
    fr.clearCache();
    global.fetch = jest.fn(() => csvReply(CSV));
  });
  afterEach(() => { global.fetch = realFetch; });

  it('reads the clock the form uses', () => {
    expect(fr.parseClock('9:56:00 PM')).toBe('21:56');
    expect(fr.parseClock('12:10:00 AM')).toBe('00:10');
    expect(fr.parseClock('21:56')).toBe('21:56');
    expect(fr.parseClock('09:05:00')).toBe('09:05');
    expect(fr.parseClock('later')).toBe('');
  });

  it('finds the DATE and TIME columns beside the timestamp', () => {
    expect(fr.columnsOf(['Timestamp', 'Email Address', 'DATE', 'TIME', 'NAME'])).toEqual({ ts: 0, date: 2, time: 3 });
    expect(fr.columnsOf(['Timestamp', 'Full Name'])).toEqual({ ts: 0, date: -1, time: -1 });
  });

  it('files a form submitted after midnight under the day it was for, at the time it says', async () => {
    process.env.ATTENDANCE_SHEET_ID = 'sheet1';
    const day = await fr.responsesForDay('2026-09-17');
    expect(day.uniqueRespondents).toBe(2);
    expect(day.respondents.map((r) => `${r.firstClock} ${r.line}`)).toEqual([
      '09:05 Asha Rao (TEN-STU-001) - TECH',
      '21:56 SHOUNAK SINHA (TEN-STU-004) - SOFTWARE ENGINEERING',
    ]);
    /* The second Asha row left DATE and TIME blank: the submission stamp stands in. */
    expect(day.respondents[0]).toMatchObject({ count: 2, lastClock: '18:40' });
    expect((await fr.responsesForDay('2026-09-18')).uniqueRespondents).toBe(0);
  });

  it('counts per person per day by the DATE column', async () => {
    process.env.ATTENDANCE_SHEET_ID = 'sheet1';
    const out = await fr.byPerson({ from: '2026-09-16', to: '2026-09-18' });
    expect(out.dates).toEqual(['2026-09-16', '2026-09-17']);
    const asha = out.people.find((p) => p.employeeId === 'TEN-STU-001');
    expect(asha.days).toEqual({ '2026-09-17': 2 });
    expect(asha.daysComplete).toBe(1);
  });

  it('takes the sheet link HR saved in the portal when the environment has none', async () => {
    attendanceSettings.fromDb.mockImplementation((k) => (k === 'sheetUrl' ? 'https://docs.google.com/spreadsheets/d/FROMDB/edit#gid=7' : ''));
    expect(fr.isConfigured()).toBe(true);
    expect(fr.exportUrl()).toBe('https://docs.google.com/spreadsheets/d/FROMDB/export?format=csv&gid=7');
    process.env.ATTENDANCE_SHEET_ID = 'FROMENV';
    expect(fr.exportUrl()).toBe('https://docs.google.com/spreadsheets/d/FROMENV/export?format=csv&gid=0');
  });

  it('serves a plain CSV link saved in the portal as it is', () => {
    attendanceSettings.fromDb.mockImplementation((k) => (k === 'sheetUrl' ? 'https://example.com/att.csv' : ''));
    expect(fr.exportUrl()).toBe('https://example.com/att.csv');
  });

  it('takes the required count from the portal when the environment has none', () => {
    attendanceSettings.fromDb.mockImplementation((k) => (k === 'requiredPerDay' ? 3 : ''));
    expect(fr.requiredPerDay()).toBe(3);
    process.env.ATTENDANCE_REQUIRED_PER_DAY = '1';
    expect(fr.requiredPerDay()).toBe(1);
  });
});
