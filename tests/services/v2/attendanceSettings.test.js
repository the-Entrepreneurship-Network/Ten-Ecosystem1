'use strict';

jest.mock('mongoose', () => ({ connection: { readyState: 1 } }));

/* An in-memory stand-in for the one settings document. */
let mockDoc = null;
jest.mock('../../../models/AttendanceSettings', () => ({
  findOne: jest.fn(() => ({ lean: async () => mockDoc })),
  updateOne: jest.fn(async (q, u) => { mockDoc = { key: 'default', ...(mockDoc || {}), ...u.$set }; return { acknowledged: true }; }),
}), { virtual: true });

const mongoose = require('mongoose');
const Model = require('../../../models/AttendanceSettings');
const settings = require('../../../services/v2/attendanceSettings');

const ENV = ['ATTENDANCE_SHEET_URL', 'ATTENDANCE_SHEET_ID', 'ATTENDANCE_SHEET_CSV_URL', 'ATTENDANCE_REPORT_TO', 'ATTENDANCE_REPORT_CRON',
  'ATTENDANCE_REQUIRED_PER_DAY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'N8N_ATTENDANCE_WEBHOOK_URL'];

describe('services/v2/attendanceSettings', () => {
  beforeEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    mockDoc = null;
    mongoose.connection.readyState = 1;
    settings._reset();
    Model.findOne.mockClear();
    Model.updateOne.mockClear();
  });

  it('starts empty and reports every field as unset', () => {
    const { values, source } = settings.effective();
    expect(values).toEqual({ sheetUrl: '', reportTo: '', reportTime: '', requiredPerDay: 0, whatsappToken: '', phoneNumberId: '', n8nWebhookUrl: '' });
    expect(Object.values(source).every((s) => s === 'none')).toBe(true);
  });

  it('saves what HR entered, validated and normalised, and loads it back', async () => {
    const seen = [];
    settings.onChange((v) => seen.push(v.reportTo));
    const out = await settings.save({
      sheetUrl: ' https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0 ',
      reportTo: '+91 83178 73609, +91 98765 43210',
      reportTime: '23:05',
      requiredPerDay: '2',
      whatsappToken: 'EAAtoken1234',
      phoneNumberId: '1243779175483305',
    }, 'hr1');
    expect(out).toMatchObject({ sheetUrl: 'https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0', reportTo: '918317873609,919876543210', reportTime: '23:05', requiredPerDay: 2 });
    expect(Model.updateOne.mock.calls[0][1].$set).toMatchObject({ updatedBy: 'hr1', whatsappToken: 'EAAtoken1234' });
    expect(seen).toEqual(['918317873609,919876543210']);
    expect(settings.fromDb('reportTo')).toBe('918317873609,919876543210');
  });

  it('refuses bad values without touching the database', async () => {
    await expect(settings.save({ reportTime: '25:00' })).rejects.toMatchObject({ status: 400, errors: ['reportTime must be HH:MM (24-hour)'] });
    await expect(settings.save({ sheetUrl: 'not a link' })).rejects.toMatchObject({ status: 400 });
    await expect(settings.save({ reportTo: '12' })).rejects.toMatchObject({ status: 400 });
    await expect(settings.save({ requiredPerDay: 11 })).rejects.toMatchObject({ status: 400 });
    await expect(settings.save({ phoneNumberId: 'abc' })).rejects.toMatchObject({ status: 400 });
    expect(Model.updateOne).not.toHaveBeenCalled();
  });

  it('accepts a direct CSV link and an empty sheet link', async () => {
    await settings.save({ sheetUrl: 'https://example.com/att.csv?x=1' });
    expect(settings.fromDb('sheetUrl')).toBe('https://example.com/att.csv?x=1');
    await settings.save({ sheetUrl: '' });
    expect(settings.fromDb('sheetUrl')).toBe('');
  });

  it('lets the environment win over the document, field by field', async () => {
    await settings.save({ reportTo: '918317873609', reportTime: '23:05', sheetUrl: 'https://docs.google.com/spreadsheets/d/db/edit' });
    process.env.ATTENDANCE_REPORT_TO = '919999999999';
    process.env.ATTENDANCE_REPORT_CRON = '0 21 * * *';
    const { values, source } = settings.effective();
    expect(values.reportTo).toBe('919999999999');
    expect(source.reportTo).toBe('env');
    expect(values.reportTime).toBe('21:00');
    expect(source.reportTime).toBe('env');
    expect(values.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/db/edit');
    expect(source.sheetUrl).toBe('db');
  });

  it('cannot save while the database is down, but still reads', async () => {
    mongoose.connection.readyState = 0;
    await expect(settings.save({ reportTo: '918317873609' })).rejects.toMatchObject({ status: 503 });
    expect(await settings.load()).toEqual(settings.current());
  });

  it('converts between a clock time and a cron line', () => {
    expect(settings.cronFromTime('23:05')).toBe('5 23 * * *');
    expect(settings.cronFromTime('9:00')).toBe('0 9 * * *');
    expect(settings.cronFromTime('24:00')).toBe('');
    expect(settings.timeFromCron('5 23 * * *')).toBe('23:05');
    expect(settings.timeFromCron('*/30 * * * *')).toBe('');
  });

  it('masks a secret down to its last four characters', () => {
    expect(settings.mask('EAAb96mMcLvoBSiBRp')).toMatch(/^\*+BRp$|^\*+iBRp$/);
    expect(settings.mask('')).toBe('');
  });
});
