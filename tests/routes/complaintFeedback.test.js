/**
 * The complaints@ auto-reply ends "Did this answer your question?". Its links
 * open /complaint-feedback, which posts the answer to routes/complaintFeedback.
 * A "no" is the only way to the WhatsApp group; HR sees the 30-day totals.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const WA = 'https://chat.whatsapp.com/TestInviteCode';
const root = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

function mount({ session = {}, create = jest.fn().mockResolvedValue({}), count = jest.fn() } = {}) {
  jest.resetModules();
  jest.doMock('../../models/ComplaintFeedback', () => ({ create, countDocuments: count }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/complaint-feedback', require('../../routes/complaintFeedback'));
  return { app, create, count };
}

afterEach(() => { delete process.env.COMPLAINTS_WHATSAPP_URL; });

describe('POST /api/complaint-feedback', () => {
  test('"yes" is recorded and gets no WhatsApp link', async () => {
    process.env.COMPLAINTS_WHATSAPP_URL = WA;
    const { app, create } = mount();
    const res = await request(app).post('/api/complaint-feedback').send({ answer: 'yes' });
    expect(res.status).toBe(200);
    expect(res.body.whatsapp).toBeNull();
    expect(create).toHaveBeenCalledWith({ answer: 'yes' });
  });

  test('"no" is recorded and gets the WhatsApp group from the server settings', async () => {
    process.env.COMPLAINTS_WHATSAPP_URL = `  ${WA}\n`;
    const { app, create } = mount();
    const res = await request(app).post('/api/complaint-feedback').send({ answer: 'no' });
    expect(res.status).toBe(200);
    expect(res.body.whatsapp).toBe(WA);
    expect(create).toHaveBeenCalledWith({ answer: 'no' });
  });

  test('with no group set, a "no" is pointed at the complaints address instead', async () => {
    const { app } = mount();
    const res = await request(app).post('/api/complaint-feedback').send({ answer: 'no' });
    expect(res.body.whatsapp).toBeNull();
    expect(res.body.email).toBe('complaints@entrepreneurshipnetwork.net');
  });

  test('a failed save still hands an unhappy person the group', async () => {
    process.env.COMPLAINTS_WHATSAPP_URL = WA;
    const { app } = mount({ create: jest.fn().mockRejectedValue(new Error('db down')) });
    const res = await request(app).post('/api/complaint-feedback').send({ answer: 'no' });
    expect(res.status).toBe(200);
    expect(res.body.whatsapp).toBe(WA);
  });

  test('anything but yes or no is refused and not recorded', async () => {
    const { app, create } = mount();
    for (const body of [{}, { answer: 'maybe' }, { answer: ['no'] }]) {
      const res = await request(app).post('/api/complaint-feedback').send(body);
      expect(res.status).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });
});

describe('GET /api/complaint-feedback/summary', () => {
  test('is for HR only', async () => {
    const { app, count } = mount({ session: {} });
    const res = await request(app).get('/api/complaint-feedback/summary');
    expect(res.status).toBe(401);
    expect(count).not.toHaveBeenCalled();
  });

  test('counts each answer over the last 30 days', async () => {
    const count = jest.fn(({ answer }) => Promise.resolve(answer === 'yes' ? 7 : 2));
    const { app } = mount({ session: { hr: { username: 'hr1' } }, count });
    const res = await request(app).get('/api/complaint-feedback/summary');
    expect(res.body).toEqual({ success: true, days: 30, yes: 7, no: 2 });
    const since = count.mock.calls[0][0].createdAt.$gte;
    const days = (Date.now() - since.getTime()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});

describe('what people see', () => {
  test('every email says it is auto-generated and names the complaints address', () => {
    jest.resetModules();
    const { renderEmail } = require('../../utils/mailer');
    const html = renderEmail({ heading: 'Hello', bodyHtml: '<p>Body</p>' });
    expect(html).toContain('auto-generated');
    expect(html).toContain('mailto:complaints@entrepreneurshipnetwork.net');
  });

  test('the feedback page never carries the WhatsApp link itself', () => {
    const page = root('public/complaint-feedback.html');
    expect(page).not.toMatch(/chat\.whatsapp\.com/);
    expect(page).toContain("fetch('/api/complaint-feedback'");
  });

  test('the complaints address is on the landing page, the dashboard and the registration page', () => {
    for (const file of ['public/index.html', 'public/student-dashboard.html', 'public/registration-success.html']) {
      expect(root(file)).toContain('mailto:complaints@entrepreneurshipnetwork.net');
    }
  });
});
