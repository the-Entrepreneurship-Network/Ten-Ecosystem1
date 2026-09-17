'use strict';

jest.mock('../../services/v2/attendanceAgent', () => ({
  config: jest.fn(),
  defaultDateKey: jest.fn(() => '2026-09-17'),
  runDaily: jest.fn(),
}));
jest.mock('../../services/v2/attendanceReport', () => ({
  buildDailyReport: jest.fn(async (dateKey) => ({ dateKey, totals: { uniqueUsers: 1 } })),
  formatWhatsApp: jest.fn(() => 'TEXT'),
}));
jest.mock('../../services/v2/loginEvents', () => ({ listByDay: jest.fn(async () => [{ userId: 'TEN001' }]) }));
jest.mock('../../services/v2/formResponses', () => {
  const real = jest.requireActual('../../services/v2/formResponses');
  return {
    isConfigured: jest.fn(() => true),
    settings: jest.fn(() => ({ columns: [] })),
    responsesForDay: jest.fn(async (dateKey) => ({ dateKey, uniqueRespondents: 2, totalResponses: 2, respondents: [] })),
    fetchSheet: jest.fn(async () => ({ url: 'https://docs.google.com/spreadsheets/d/x/export?format=csv&gid=0', header: ['Timestamp', 'Full Name', 'Employee ID'], rows: [['17/09/2026 09:00:00', 'A', 'TEN1']] })),
    pickColumns: jest.fn(() => [{ label: 'Full Name' }, { label: 'Employee ID' }]),
    detectDateFormat: jest.fn(() => 'DMY'),
    byPerson: jest.fn(async ({ from, to }) => ({
      from, to, required: 2, dates: ['2026-09-15', '2026-09-16'], responses: 4,
      people: [
        { employeeId: 'TEN001', name: 'Asha Rao', domain: 'Python', email: 'asha@x.com', days: { '2026-09-15': 2, '2026-09-16': 1 }, daysMarked: 2, daysComplete: 1, responses: 3 },
        { employeeId: 'TEN003', name: 'Chitra', domain: 'Software Engineering', email: 'c@x.com', days: { '2026-09-16': 1 }, daysMarked: 1, daysComplete: 0, responses: 1 },
      ],
    })),
    matchesPerson: real.matchesPerson,
    personFor: real.personFor,
  };
});
jest.mock('../../config/domains', () => ({ DOMAIN_NAMES: ['Python Development', 'Software Engineering'] }), { virtual: true });

const http = require('http');
const express = require('express');
const agent = require('../../services/v2/attendanceAgent');
const loginEvents = require('../../services/v2/loginEvents');
const formResponses = require('../../services/v2/formResponses');
const router = require('../../routes/v2/attendanceAgent');

let server; let base;
beforeAll((done) => {
  const app = express();
  app.use(express.json());
  /* Identity is the session's alone. The test seeds one from a header the
     real middleware never reads; a request without it has no session. */
  app.use((req, res, next) => {
    const as = req.headers['x-test-session'];
    if (as === 'hr') req.session = { hr: { username: 'hr1', email: 'hr1@ten.com', name: 'HR One' } };
    else if (as === 'coordinator') req.session = { coordinator: { username: 'py_admin', domain: 'Python' } };
    else if (as && as.startsWith('student:')) req.session = { student: { employeeId: as.slice(8), email: `${as.slice(8).toLowerCase()}@x.com` } };
    next();
  });
  app.use('/api/v2/attendance-agent', router);
  server = http.createServer(app).listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api/v2/attendance-agent`; done(); });
});
afterAll((done) => { server.close(done); });

const HR = { 'x-test-session': 'hr' };
const COORD = { 'x-test-session': 'coordinator' };
const student = (id) => ({ 'x-test-session': `student:${id}` });
const get = (p, headers = {}) => fetch(base + p, { headers });
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('routes/v2/attendanceAgent', () => {
  beforeEach(() => {
    agent.config.mockReturnValue({ enabled: true, cron: '5 23 * * *', day: 'today', tz: 'Asia/Kolkata', transport: 'meta', retentionDays: 90, recipients: ['918317873609'] });
    agent.runDaily.mockReset().mockResolvedValue({ ok: true, delivered: 1, dateKey: '2026-09-17', results: [], text: 'TEXT', report: { big: true } });
    loginEvents.listByDay.mockClear();
    formResponses.isConfigured.mockReturnValue(true);
  });

  it('needs a session: HR for the controls, staff for the tables, and a header names nobody', async () => {
    for (const p of ['/config', '/logins', '/report', '/report/text', '/form', '/form/check', '/all', '/all.csv', '/my', '/my.csv']) {
      expect((await get(p)).status).toBe(401);
      expect((await get(p, { Authorization: 'Bearer hr_anything', 'x-employee-id': 'TEN001' })).status).toBe(401);
    }
    expect((await post('/report/send', {})).status).toBe(401);
    /* A coordinator sees the tables and the form, not the agent's controls. */
    expect((await get('/all', COORD)).status).toBe(200);
    expect((await get('/form/check', COORD)).status).toBe(200);
    expect((await get('/config', COORD)).status).toBe(401);
    expect((await post('/report/send', {}, COORD)).status).toBe(401);
  });

  it('shows the configuration with the recipient masked', async () => {
    const res = await get('/config', HR);
    expect(res.status).toBe(200);
    const { config } = await res.json();
    expect(config.recipients).toEqual(['91******3609']);
    expect(config.recipientCount).toBe(1);
    expect(config.formConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('918317873609');
  });

  it("lists the day's sign-ins with filters", async () => {
    const res = await get('/logins?date=2026-09-16&role=student&success=true&domain=Python', HR);
    expect(res.status).toBe(200);
    expect(loginEvents.listByDay).toHaveBeenCalledWith('2026-09-16', { userType: 'student', success: true, domain: 'Python' });
    expect(await res.json()).toMatchObject({ dateKey: '2026-09-16', count: 1 });
  });

  it("falls back to the agent's default day on a bad date", async () => {
    await get('/logins?date=yesterday', HR);
    expect(loginEvents.listByDay).toHaveBeenCalledWith('2026-09-17', {});
  });

  it("returns the day's form responses, and says when no sheet is configured", async () => {
    const res = await get('/form?date=2026-09-16', HR);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, dateKey: '2026-09-16', uniqueRespondents: 2 });

    formResponses.isConfigured.mockReturnValue(false);
    const none = await get('/form', HR);
    expect(none.status).toBe(400);
    expect((await none.json()).message).toMatch(/ATTENDANCE_SHEET_URL/);
  });

  it('checks the sheet is readable and reports its columns', async () => {
    const res = await get('/form/check', HR);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, rowCount: 1, header: ['Timestamp', 'Full Name', 'Employee ID'], columns: ['Full Name', 'Employee ID'], dateFormat: 'DMY' });
  });

  it('previews exactly the WhatsApp text', async () => {
    const res = await get('/report/text?date=2026-09-17', HR);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await res.text()).toBe('TEXT');
  });

  it('sends on demand, forwarding force and the day, without echoing the whole report', async () => {
    const res = await post('/report/send', { date: '2026-09-16', force: true }, HR);
    expect(res.status).toBe(200);
    expect(agent.runDaily).toHaveBeenCalledWith({ dateKey: '2026-09-16', force: true, trigger: 'manual', by: 'HR' });
    const body = await res.json();
    expect(body).toMatchObject({ success: true, delivered: 1, text: 'TEXT' });
    expect(body.report).toBeUndefined();
  });

  describe('the tables', () => {
    it('gives a student their own days, identified by their session', async () => {
      const res = await get('/my?from=2026-09-15&to=2026-09-16', student('ten001'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ employeeId: 'TEN001', name: 'Asha Rao', domain: 'Python', required: 2, totals: { daysMarked: 2, daysComplete: 1, responses: 3 } });
      expect(body.days).toEqual([
        { date: '2026-09-15', count: 2, complete: true, status: 'complete' },
        { date: '2026-09-16', count: 1, complete: false, status: 'partial' },
      ]);
    });

    it('shows a student with no responses an empty sheet rather than an error', async () => {
      const body = await (await get('/my', student('TEN999'))).json();
      expect(body.days.map((d) => d.count)).toEqual([0, 0]);
      expect(body.totals).toEqual({ daysMarked: 0, daysComplete: 0, responses: 0 });
    });

    it('downloads a student CSV', async () => {
      const res = await get('/my.csv?from=2026-09-15&to=2026-09-16', student('TEN001'));
      expect(res.headers.get('content-type')).toMatch(/text\/csv/);
      expect(res.headers.get('content-disposition')).toMatch(/attendance-TEN001-2026-09-15-to-2026-09-16\.csv/);
      /* fetch strips the UTF-8 BOM the file carries for Excel. */
      expect(await res.text()).toBe('Date,Responses,Required,Status\r\n2026-09-15,2,2,complete\r\n2026-09-16,1,2,partial\r\n');
    });

    it('lists everyone for staff, with the domain list for the filter', async () => {
      expect((await get('/all')).status).toBe(401);
      const res = await get('/all?from=2026-09-15&to=2026-09-16', HR);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ total: 2, totalPeople: 2, responses: 4, dates: ['2026-09-15', '2026-09-16'] });
      expect(body.domains).toEqual(['Python Development', 'Software Engineering', 'Python']);
      expect(body.people[0]).toMatchObject({ employeeId: 'TEN001', days: { '2026-09-15': 2, '2026-09-16': 1 } });
    });

    it('narrows by domain only: picked exactly, or as typed', async () => {
      expect((await (await get('/all?domain=python', HR)).json()).people.map((p) => p.employeeId)).toEqual(['TEN001']);
      expect((await (await get('/all?q=s', HR)).json()).people.map((p) => p.employeeId)).toEqual(['TEN003']);
      expect((await (await get('/all?q=softe', HR)).json()).people.map((p) => p.employeeId)).toEqual(['TEN003']);
      /* A name or an employee id is not a filter. */
      expect((await (await get('/all?q=asha', HR)).json()).people).toEqual([]);
      expect((await (await get('/all?employeeId=TEN003', HR)).json()).people.map((p) => p.employeeId)).toEqual(['TEN001', 'TEN003']);
    });

    it('downloads the staff CSV with one column per day', async () => {
      const res = await get('/all.csv?from=2026-09-15&to=2026-09-16&q=pyth', HR);
      expect(res.headers.get('content-type')).toMatch(/text\/csv/);
      expect(await res.text()).toBe('Name,Employee ID,Domain,2026-09-15,2026-09-16,Days marked,Days complete,Responses\r\nAsha Rao,TEN001,Python,2,1,2,1,3\r\n');
    });
  });

  it('answers 502 when delivery failed', async () => {
    agent.runDaily.mockResolvedValue({ ok: false, delivered: 0, dateKey: '2026-09-17', results: [{ ok: false, error: 'not in allowed list' }] });
    const res = await post('/report/send', {}, HR);
    expect(res.status).toBe(502);
    expect((await res.json()).results[0].error).toMatch(/allowed list/);
  });
});
