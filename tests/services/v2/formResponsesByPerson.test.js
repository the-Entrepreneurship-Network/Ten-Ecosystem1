'use strict';

const fr = require('../../../services/v2/formResponses');

const CSV = [
  'Timestamp,Email Address,Full Name,Employee ID,Domain',
  '15/09/2026 09:05:12,asha@x.com,Asha Rao,TEN001,Python',
  '15/09/2026 18:40:00,asha@x.com,Asha Rao,TEN001,Python',
  '16/09/2026 09:00:00,asha@x.com,Asha  Rao,TEN001,Python',
  '15/09/2026 08:00:00,b@x.com,Bikram Das,TEN002,Web Development',
  '17/09/2026 10:15:00,b@x.com,Bikram Das,TEN002,Web Development',
  '17/09/2026 10:16:00,b@x.com,Bikram Das,TEN002,Web Development',
  '01/09/2026 10:00:00,c@x.com,Chitra,TEN003,Software Engineering',
].join('\n');

function csvReply(text) {
  return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(text) });
}

describe('services/v2/formResponses.byPerson', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.ATTENDANCE_SHEET_ID = 'sheet1';
    delete process.env.ATTENDANCE_REQUIRED_PER_DAY;
    delete process.env.ATTENDANCE_SHEET_CACHE_SECONDS;
    fr.clearCache();
    global.fetch = jest.fn(() => csvReply(CSV));
  });
  afterEach(() => { global.fetch = realFetch; delete process.env.ATTENDANCE_SHEET_ID; });

  it('counts submissions per person per day across a range', async () => {
    const out = await fr.byPerson({ from: '2026-09-15', to: '2026-09-17' });
    expect(out).toMatchObject({ from: '2026-09-15', to: '2026-09-17', required: 2, responses: 6, dates: ['2026-09-15', '2026-09-16', '2026-09-17'] });
    expect(out.people.map((p) => p.employeeId)).toEqual(['TEN001', 'TEN002']);
    expect(out.people[0]).toMatchObject({
      name: 'Asha  Rao', domain: 'Python', email: 'asha@x.com',
      days: { '2026-09-15': 2, '2026-09-16': 1 }, daysMarked: 2, daysComplete: 1, responses: 3,
    });
    expect(out.people[1]).toMatchObject({ days: { '2026-09-15': 1, '2026-09-17': 2 }, daysMarked: 2, daysComplete: 1 });
  });

  it('honours the required-per-day setting', async () => {
    process.env.ATTENDANCE_REQUIRED_PER_DAY = '1';
    const out = await fr.byPerson({ from: '2026-09-15', to: '2026-09-17' });
    expect(out.required).toBe(1);
    expect(out.people[0].daysComplete).toBe(2);
  });

  it('serves the sheet from cache within the window, and refetches when asked', async () => {
    await fr.byPerson({});
    await fr.byPerson({});
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await fr.byPerson({ fresh: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    process.env.ATTENDANCE_SHEET_CACHE_SECONDS = '0';
    await fr.byPerson({});
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('narrows by domain only, picked or typed', async () => {
    const { people } = await fr.byPerson({});
    const ids = (f) => people.filter((p) => fr.matchesPerson(p, f)).map((p) => p.employeeId);
    expect(ids({ domain: 'python' })).toEqual(['TEN001']);
    expect(ids({ q: 's' })).toEqual(['TEN003']);
    expect(ids({ q: 'd' })).toEqual(['TEN002']);
    expect(ids({ q: 'softe' })).toEqual(['TEN003']);
    /* Names and employee ids are not filters. */
    expect(ids({ q: 'das' })).toEqual([]);
    expect(ids({ q: 'ten002' })).toEqual([]);
  });

  it('ranks suggestions: whole-name prefix, word prefix, substring, then in-order characters', () => {
    expect(fr.domainRank('s', 'Software Engineering')).toBe(0);
    expect(fr.domainRank('d', 'Web Development')).toBe(1);
    expect(fr.domainRank('velop', 'Web Development')).toBe(2);
    expect(fr.domainRank('softe', 'Software Engineering')).toBe(3);
    expect(fr.domainRank('x', 'Python Development')).toBe(-1);
    expect(fr.domainMatches('web dev', 'Web Development')).toBe(true);
  });

  it('finds one person by employee id, then by email', async () => {
    const { people } = await fr.byPerson({});
    expect(fr.personFor(people, { employeeId: 'ten001' }).name).toBe('Asha  Rao');
    expect(fr.personFor(people, { employeeId: 'nope', email: 'B@x.com' }).employeeId).toBe('TEN002');
    expect(fr.personFor(people, { employeeId: 'nope' })).toBeNull();
  });
});
