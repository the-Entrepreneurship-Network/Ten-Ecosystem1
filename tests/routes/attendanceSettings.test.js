'use strict';

jest.mock('../../services/v2/attendanceAgent', () => ({
  config: jest.fn(),
  defaultDateKey: jest.fn(() => '2026-09-17'),
  runDaily: jest.fn(),
}));
jest.mock('../../services/v2/attendanceReport', () => ({ buildDailyReport: jest.fn(), formatWhatsApp: jest.fn() }));
jest.mock('../../services/v2/loginEvents', () => ({ listByDay: jest.fn(async () => []) }));
jest.mock('../../services/v2/whatsappSender', () => {
  const real = jest.requireActual('../../services/v2/whatsappSender');
  return { ...real, send: jest.fn(), resolveTransport: jest.fn(() => 'meta') };
});
jest.mock('../../services/v2/formResponses', () => ({
  isConfigured: jest.fn(() => false),
  clearCache: jest.fn(),
}));
jest.mock('../../services/v2/attendanceSettings', () => {
  const real = jest.requireActual('../../services/v2/attendanceSettings');
  return { ...real, load: jest.fn(async () => ({})), save: jest.fn(), effective: jest.fn() };
});
jest.mock('../../models/AuditLog', () => ({ create: jest.fn(async (d) => d) }), { virtual: true });

const http = require('http');
const express = require('express');
const agent = require('../../services/v2/attendanceAgent');
const sender = require('../../services/v2/whatsappSender');
const attendanceSettings = require('../../services/v2/attendanceSettings');
const AuditLog = require('../../models/AuditLog');
const router = require('../../routes/v2/attendanceAgent');

let server; let base;
beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const as = req.headers['x-test-session'];
    if (as === 'hr') req.session = { hr: { username: 'hr1', email: 'hr1@ten.com' } };
    else if (as === 'coordinator') req.session = { coordinator: { username: 'py_admin' } };
    next();
  });
  app.use('/api/v2/attendance-agent', router);
  server = http.createServer(app).listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api/v2/attendance-agent`; done(); });
});
afterAll((done) => { server.close(done); });

const HR = { 'x-test-session': 'hr' };
const COORD = { 'x-test-session': 'coordinator' };
const call = (method, p, body, headers) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('routes/v2/attendanceAgent settings', () => {
  beforeEach(() => {
    agent.config.mockReturnValue({ enabled: true, cron: '5 23 * * *', day: 'today', tz: 'Asia/Kolkata', transport: 'meta', retentionDays: 90, recipients: ['918317873609'] });
    attendanceSettings.effective.mockReturnValue({
      values: { sheetUrl: 'https://docs.google.com/spreadsheets/d/x/edit', reportTo: '918317873609', reportTime: '23:05', requiredPerDay: 2, whatsappToken: 'EAAsecret9876', phoneNumberId: '1243779175483305', n8nWebhookUrl: '' },
      source: { sheetUrl: 'db', reportTo: 'db', reportTime: 'db', requiredPerDay: 'none', whatsappToken: 'env', phoneNumberId: 'env', n8nWebhookUrl: 'none' },
    });
    attendanceSettings.save.mockReset().mockResolvedValue({});
    attendanceSettings.load.mockClear();
    sender.send.mockReset().mockResolvedValue({ ok: true, transport: 'meta', id: 'wamid.t' });
    AuditLog.create.mockClear();
  });

  it('is for HR only', async () => {
    expect((await call('GET', '/settings')).status).toBe(401);
    expect((await call('GET', '/settings', undefined, COORD)).status).toBe(401);
    expect((await call('PUT', '/settings', {}, COORD)).status).toBe(401);
    expect((await call('POST', '/settings/test-send', undefined, COORD)).status).toBe(401);
  });

  it('shows the settings with the token masked and each source named', async () => {
    const res = await call('GET', '/settings', undefined, HR);
    expect(res.status).toBe(200);
    const { settings } = await res.json();
    expect(settings.values.whatsappToken).toMatch(/^\*+9876$/);
    expect(JSON.stringify(settings)).not.toContain('EAAsecret9876');
    expect(settings).toMatchObject({ tokenSet: true, recipients: ['91******3609'], reportTime: '23:05', tz: 'Asia/Kolkata', source: { whatsappToken: 'env', sheetUrl: 'db' } });
    expect(attendanceSettings.load).toHaveBeenCalled();
  });

  it('saves what HR typed, ignoring a token that came back masked or blank', async () => {
    const res = await call('PUT', '/settings', { sheetUrl: 'https://docs.google.com/spreadsheets/d/new/edit', reportTo: '918317873609', reportTime: '23:05', whatsappToken: '********9876' }, HR);
    expect(res.status).toBe(200);
    expect(attendanceSettings.save).toHaveBeenCalledWith({ sheetUrl: 'https://docs.google.com/spreadsheets/d/new/edit', reportTo: '918317873609', reportTime: '23:05' }, 'hr1');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'ATTENDANCE_SETTINGS_UPDATED', performedBy: 'hr1' }));

    await call('PUT', '/settings', { whatsappToken: '' }, HR);
    expect(attendanceSettings.save).toHaveBeenLastCalledWith({}, 'hr1');
    await call('PUT', '/settings', { whatsappToken: 'EAAnewtoken' }, HR);
    expect(attendanceSettings.save).toHaveBeenLastCalledWith({ whatsappToken: 'EAAnewtoken' }, 'hr1');
    await call('PUT', '/settings', { whatsappToken: null }, HR);
    expect(attendanceSettings.save).toHaveBeenLastCalledWith({ whatsappToken: null }, 'hr1');
  });

  it('passes validation errors through as 400', async () => {
    const e = new Error('reportTime must be HH:MM (24-hour)'); e.status = 400; e.errors = [e.message];
    attendanceSettings.save.mockRejectedValue(e);
    const res = await call('PUT', '/settings', { reportTime: '25:00' }, HR);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, errors: ['reportTime must be HH:MM (24-hour)'] });
  });

  it('sends one test message to the configured number', async () => {
    const res = await call('POST', '/settings/test-send', undefined, HR);
    expect(res.status).toBe(200);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0]).toMatchObject({ to: '918317873609' });
    expect(sender.send.mock.calls[0][0].text).toMatch(/test message.*23:05 \(Asia\/Kolkata\)/);
    expect(await res.json()).toMatchObject({ success: true, results: [{ to: '91******3609', ok: true }] });

    agent.config.mockReturnValue({ cron: '5 23 * * *', tz: 'Asia/Kolkata', transport: 'meta', recipients: [] });
    expect((await call('POST', '/settings/test-send', undefined, HR)).status).toBe(400);
  });

  it('reports a refused send as 502 with the reason', async () => {
    sender.send.mockResolvedValue({ ok: false, transport: 'meta', status: 401, error: 'Authentication Error' });
    const res = await call('POST', '/settings/test-send', undefined, HR);
    expect(res.status).toBe(502);
    expect((await res.json()).results[0].error).toBe('Authentication Error');
  });
});
