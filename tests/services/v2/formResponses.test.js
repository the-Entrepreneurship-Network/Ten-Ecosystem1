'use strict';

const fr = require('../../../services/v2/formResponses');

const ENV = ['ATTENDANCE_SHEET_URL', 'ATTENDANCE_SHEET_ID', 'ATTENDANCE_SHEET_GID', 'ATTENDANCE_SHEET_CSV_URL', 'ATTENDANCE_SHEET_DATE_FORMAT', 'ATTENDANCE_SHEET_COLUMNS'];

const CSV = [
  'Timestamp,Email Address,Full Name,Employee ID,Domain,Any remarks?',
  '17/09/2026 09:05:12,asha@x.com,Asha Rao,TEN001,Python,',
  '17/09/2026 14:40:00,asha@x.com,Asha Rao,TEN001,Python,"second, ""late"" entry"',
  '17/09/2026 08:00:00,b@x.com,Bikram Das,TEN002,MERN,"multi',
  'line"',
  '16/09/2026 23:59:59,c@x.com,Chitra,TEN003,Web Dev,',
  '17/09/2026 10:15:00,,Dev,,Java,',
  '',
].join('\r\n');

function csvReply(text, status = 200) {
  return Promise.resolve({ status, ok: status < 300, text: () => Promise.resolve(text) });
}

describe('services/v2/formResponses', () => {
  const realFetch = global.fetch;
  beforeEach(() => { ENV.forEach((k) => delete process.env[k]); global.fetch = jest.fn(); });
  afterEach(() => { global.fetch = realFetch; });

  it('derives the CSV export URL from a shared sheet link', () => {
    process.env.ATTENDANCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit?usp=sharing#gid=987';
    expect(fr.exportUrl()).toBe('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=csv&gid=987');
    expect(fr.isConfigured()).toBe(true);
    delete process.env.ATTENDANCE_SHEET_URL;
    expect(fr.isConfigured()).toBe(false);
  });

  it('parses quoted commas, doubled quotes and newlines inside cells', () => {
    const rows = fr.parseCsv('a,"b,c","d""e"\r\n"multi\nline",x,\n');
    expect(rows).toEqual([['a', 'b,c', 'd"e'], ['multi\nline', 'x', '']]);
  });

  it('reads day-first and month-first stamps, ISO, and 12-hour clocks', () => {
    expect(fr.parseStamp('17/09/2026 21:05:33', 'DMY')).toEqual({ dateKey: '2026-09-17', clock: '21:05' });
    expect(fr.parseStamp('9/17/2026 21:05:33', 'MDY')).toEqual({ dateKey: '2026-09-17', clock: '21:05' });
    expect(fr.parseStamp('2026-09-17 09:05:00')).toEqual({ dateKey: '2026-09-17', clock: '09:05' });
    expect(fr.parseStamp('9/17/2026 9:05:00 PM', 'MDY')).toEqual({ dateKey: '2026-09-17', clock: '21:05' });
    expect(fr.parseStamp('9/17/2026 12:10:00 AM', 'MDY')).toEqual({ dateKey: '2026-09-17', clock: '00:10' });
    expect(fr.parseStamp('not a date')).toBeNull();
    expect(fr.parseStamp('17/09/2026', 'MDY')).toBeNull();
  });

  it('works out which slash order the sheet uses from the data, defaulting to day-first', () => {
    expect(fr.detectDateFormat([['17/09/2026 1:00:00']], 0)).toBe('DMY');
    expect(fr.detectDateFormat([['09/17/2026 1:00:00']], 0)).toBe('MDY');
    expect(fr.detectDateFormat([['03/04/2026 1:00:00']], 0)).toBe('DMY');
  });

  it('picks name, id and domain columns by their headings, or the configured ones', () => {
    const header = ['Timestamp', 'Email Address', 'Full Name', 'Employee ID', 'Domain', 'Any remarks?'];
    expect(fr.pickColumns(header, []).map((c) => c.label)).toEqual(['Full Name', 'Employee ID', 'Domain']);
    expect(fr.pickColumns(header, ['Employee ID', 'remarks']).map((c) => c.label)).toEqual(['Employee ID', 'Any remarks?']);
  });

  it("lists everyone who submitted on the day, once each, in order of first submission", async () => {
    process.env.ATTENDANCE_SHEET_ID = 'sheet1';
    global.fetch.mockReturnValue(csvReply(CSV));

    const day = await fr.responsesForDay('2026-09-17');
    expect(global.fetch.mock.calls[0][0]).toBe('https://docs.google.com/spreadsheets/d/sheet1/export?format=csv&gid=0');
    expect(day).toMatchObject({ dateKey: '2026-09-17', totalResponses: 4, uniqueRespondents: 3, dateFormat: 'DMY', columns: ['Full Name', 'Employee ID', 'Domain'] });
    expect(day.respondents.map((r) => `${r.firstClock} ${r.line}`)).toEqual([
      '08:00 Bikram Das (TEN002) - MERN',
      '09:05 Asha Rao (TEN001) - Python',
      '10:15 Dev - Java',
    ]);
    expect(day.respondents[1]).toMatchObject({ count: 2, lastClock: '14:40' });
  });

  it('explains a sheet that is not shared instead of reporting zero attendance', async () => {
    process.env.ATTENDANCE_SHEET_ID = 'private';
    global.fetch.mockReturnValue(csvReply('<!DOCTYPE html><html><body>Sign in</body></html>'));
    await expect(fr.responsesForDay('2026-09-17')).rejects.toThrow(/Anyone with the link/);
    global.fetch.mockReturnValue(csvReply('nope', 404));
    await expect(fr.responsesForDay('2026-09-17')).rejects.toThrow(/HTTP 404/);
  });

  it('refuses to run with no sheet configured', async () => {
    await expect(fr.responsesForDay('2026-09-17')).rejects.toThrow(/ATTENDANCE_SHEET_URL/);
  });
});
