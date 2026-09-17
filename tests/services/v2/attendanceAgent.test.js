'use strict';

jest.mock('node-cron', () => ({ validate: jest.fn(() => true), schedule: jest.fn(() => ({ stop: jest.fn() })) }), { virtual: true });
jest.mock('../../../services/v2/whatsappSender', () => {
  const real = jest.requireActual('../../../services/v2/whatsappSender');
  return { ...real, send: jest.fn(), resolveTransport: jest.fn(() => 'meta') };
});
jest.mock('../../../services/v2/attendanceReport', () => ({
  buildDailyReport: jest.fn(),
  formatWhatsApp: jest.fn(() => 'REPORT TEXT'),
}));
jest.mock('../../../services/v2/loginEvents', () => ({ purgeOlderThan: jest.fn() }));
jest.mock('../../../models/AuditLog', () => ({
  create: jest.fn(async (d) => d),
  findOne: jest.fn(() => ({ lean: async () => null })),
}), { virtual: true });

const cron = require('node-cron');
const sender = require('../../../services/v2/whatsappSender');
const report = require('../../../services/v2/attendanceReport');
const AuditLog = require('../../../models/AuditLog');
const agent = require('../../../services/v2/attendanceAgent');

const REPORT = {
  dateKey: '2026-09-17',
  formConfigured: true,
  form: { uniqueRespondents: 23, totalResponses: 25 },
  totals: { formRespondents: 23, formResponses: 25, uniqueUsers: 3, logins: 4, failedAttempts: 1 },
};

describe('services/v2/attendanceAgent', () => {
  beforeEach(() => {
    ['ATTENDANCE_REPORT_TO', 'WHATSAPP_TEST_TO', 'ATTENDANCE_REPORT_CRON', 'ATTENDANCE_AGENT_ENABLED', 'ATTENDANCE_REPORT_DAY'].forEach((k) => delete process.env[k]);
    sender.send.mockReset().mockResolvedValue({ ok: true, transport: 'meta', id: 'wamid.1' });
    report.buildDailyReport.mockReset().mockResolvedValue(REPORT);
    AuditLog.create.mockClear();
    AuditLog.findOne.mockReset().mockReturnValue({ lean: async () => null });
    cron.schedule.mockClear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends to ATTENDANCE_REPORT_TO and to nothing else, whatever the test number is', async () => {
    process.env.ATTENDANCE_REPORT_TO = '+91 83178 73609';
    process.env.WHATSAPP_TEST_TO = '15556685196';

    const out = await agent.runDaily({ dateKey: '2026-09-17', trigger: 'manual', by: 'hr1' });

    expect(sender.send).toHaveBeenCalledTimes(1);
    const call = sender.send.mock.calls[0][0];
    expect(call).toMatchObject({ to: '918317873609', text: 'REPORT TEXT' });
    expect(call.payload).toMatchObject({ kind: 'attendance_daily', dateKey: '2026-09-17', trigger: 'manual' });
    expect(call.templateParams[1]).toBe('23 filled the form (25 responses)');
    expect(out).toMatchObject({ ok: true, delivered: 1, dateKey: '2026-09-17' });
    expect(out.results[0].to).toBe('91******3609');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      actionType: agent.ACTION_SENT, performedBy: 'hr1',
      newState: expect.objectContaining({ dateKey: '2026-09-17', ok: true }),
    }));
  });

  it('builds but does not send when no recipient is configured', async () => {
    const out = await agent.runDaily({ dateKey: '2026-09-17' });
    expect(sender.send).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, skipped: true, reason: 'no recipient', text: 'REPORT TEXT' });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ actionType: agent.ACTION_SKIPPED }));
  });

  it('sends once per day unless forced', async () => {
    process.env.ATTENDANCE_REPORT_TO = '918317873609';
    AuditLog.findOne.mockReturnValue({ lean: async () => ({ _id: 'x' }) });

    const first = await agent.runDaily({ dateKey: '2026-09-17' });
    expect(first).toMatchObject({ ok: true, skipped: true, reason: 'already sent' });
    expect(sender.send).not.toHaveBeenCalled();

    const again = await agent.runDaily({ dateKey: '2026-09-17', force: true });
    expect(again.ok).toBe(true);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('does not count a dry run as delivered', async () => {
    process.env.ATTENDANCE_REPORT_TO = '918317873609';
    sender.send.mockResolvedValue({ ok: true, transport: 'log', dryRun: true });
    const out = await agent.runDaily({ dateKey: '2026-09-17' });
    expect(out).toMatchObject({ ok: false, dryRun: true, delivered: 0 });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ actionType: agent.ACTION_SKIPPED }));
  });

  it('accepts several recipients and reports each delivery separately', async () => {
    process.env.ATTENDANCE_REPORT_TO = '918317873609, +91 98765 43210';
    sender.send
      .mockResolvedValueOnce({ ok: true, transport: 'meta', id: 'a' })
      .mockResolvedValueOnce({ ok: false, transport: 'meta', status: 400, error: 'not in allowed list' });
    const out = await agent.runDaily({ dateKey: '2026-09-17' });
    expect(sender.send.mock.calls.map((c) => c[0].to)).toEqual(['918317873609', '919876543210']);
    expect(out).toMatchObject({ ok: false, delivered: 1 });
    expect(out.results[1]).toMatchObject({ ok: false, error: 'not in allowed list' });
  });

  it('falls back to the portal summary when there is no form', async () => {
    process.env.ATTENDANCE_REPORT_TO = '918317873609';
    report.buildDailyReport.mockResolvedValue({ ...REPORT, formConfigured: false, form: null });
    await agent.runDaily({ dateKey: '2026-09-17' });
    expect(sender.send.mock.calls[0][0].templateParams[1]).toBe('3 signed in, 4 sign-ins, 1 failed');
  });

  it('schedules the report in the report timezone and can be switched off', () => {
    process.env.ATTENDANCE_REPORT_TO = '918317873609';
    process.env.ATTENDANCE_REPORT_CRON = '5 23 * * *';
    const jobs = agent.initAttendanceAgent();
    expect(jobs).toHaveLength(2);
    expect(cron.schedule.mock.calls[0][0]).toBe('5 23 * * *');
    expect(cron.schedule.mock.calls[0][2]).toEqual({ timezone: 'Asia/Kolkata' });
    agent.stop();

    process.env.ATTENDANCE_AGENT_ENABLED = 'false';
    expect(agent.initAttendanceAgent()).toEqual([]);
  });
});
