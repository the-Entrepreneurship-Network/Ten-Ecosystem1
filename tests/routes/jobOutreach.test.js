'use strict';

/**
 * These tests are mostly about one thing: that nothing sends email unless
 * somebody asked for that specifically. Everything else here is secondary.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/roleGuard', () => ({
  requireRole: () => (req, res, next) => {
    if (!req.headers['x-test-user']) return res.status(401).json({ ok: false });
    req.user = { _id: 'user-1' };
    next();
  }
}));

const mockAccounts = jest.fn();
const mockCreateCampaign = jest.fn();
const mockAddRecipient = jest.fn();
const mockActivate = jest.fn();

jest.mock('../../services/v2/instantlyOutreach', () => {
  const actual = jest.requireActual('../../services/v2/instantlyOutreach');
  return {
    isEmail: actual.isEmail,
    configured: () => Boolean(process.env.INSTANTLY_API_KEY),
    sendingAccounts: (...a) => mockAccounts(...a),
    createCampaign: (...a) => mockCreateCampaign(...a),
    addRecipient: (...a) => mockAddRecipient(...a),
    activateCampaign: (...a) => mockActivate(...a)
  };
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v2/job-outreach', require('../../routes/v2/jobOutreach'));
  return a;
}

const AUTH = { 'x-test-user': 'user-1' };
const DRAFT = {
  to: 'hiring@northwind.com',
  subject: 'Full Stack Developer — react + node',
  body: 'Hi,\n\nI saw the opening…',
  company: 'Northwind'
};

describe('job outreach', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INSTANTLY_API_KEY = 'test-key';
    mockAccounts.mockResolvedValue([{ email: 'me@ten.dev', status: 'active' }]);
    mockCreateCampaign.mockResolvedValue({ id: 'camp-1', name: 'x', status: 'draft' });
    mockAddRecipient.mockResolvedValue({ id: 'lead-1', email: DRAFT.to });
    mockActivate.mockResolvedValue({ campaignId: 'camp-1', status: 'active' });
  });

  describe('nothing sends by accident', () => {
    it('prepares without sending', async () => {
      const res = await request(app()).post('/api/v2/job-outreach/prepare').set(AUTH).send(DRAFT);
      expect(res.status).toBe(201);
      expect(res.body.sent).toBe(false);
      expect(mockActivate).not.toHaveBeenCalled();
    });

    it('refuses to send without an explicit confirmation', async () => {
      const res = await request(app())
        .post('/api/v2/job-outreach/send').set(AUTH).send({ campaignId: 'camp-1' });
      expect(res.status).toBe(400);
      expect(mockActivate).not.toHaveBeenCalled();
    });

    it('"write an email to HR" is a draft request, never a send', async () => {
      const { emailMode } = require('../../routes/v2/jobOutreach');
      expect(emailMode('write an email to HR')).toBe('draft');
      expect(emailMode('draft a mail to the recruiter')).toBe('draft');
      expect(emailMode('reply to their mail')).toBe('reply');
      expect(emailMode('send it')).toBe('send');
      expect(emailMode('go ahead and send')).toBe('send');
    });

    it('refuses to send when the sentence that asked only wanted a draft', async () => {
      const res = await request(app())
        .post('/api/v2/job-outreach/send').set(AUTH)
        .send({ campaignId: 'camp-1', confirm: true, intent: 'write an email to HR' });
      expect(res.status).toBe(400);
      expect(res.body.mode).toBe('draft');
      expect(mockActivate).not.toHaveBeenCalled();
    });

    it('sends only when confirm is true', async () => {
      const res = await request(app())
        .post('/api/v2/job-outreach/send').set(AUTH).send({ campaignId: 'camp-1', confirm: true });
      expect(res.body.sent).toBe(true);
      expect(mockActivate).toHaveBeenCalledWith('camp-1');
    });

    it('will not act for an anonymous caller', async () => {
      const res = await request(app()).post('/api/v2/job-outreach/prepare').send(DRAFT);
      expect(res.status).toBe(401);
      expect(mockCreateCampaign).not.toHaveBeenCalled();
    });
  });

  describe('refusing to pretend', () => {
    it('says so when no mailbox is connected instead of silently doing nothing', async () => {
      mockAccounts.mockResolvedValue([]);
      const res = await request(app()).post('/api/v2/job-outreach/prepare').set(AUTH).send(DRAFT);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/no mailbox is connected/i);
      expect(mockAddRecipient).not.toHaveBeenCalled();
    });

    it('reports missing configuration rather than failing obscurely', async () => {
      delete process.env.INSTANTLY_API_KEY;
      const res = await request(app()).get('/api/v2/job-outreach/status').set(AUTH);
      expect(res.body.canSend).toBe(false);
      expect(res.body.reason).toMatch(/INSTANTLY_API_KEY/);
    });

    it('reports canSend false when the workspace has no mailbox', async () => {
      mockAccounts.mockResolvedValue([]);
      const res = await request(app()).get('/api/v2/job-outreach/status').set(AUTH);
      expect(res.body.configured).toBe(true);
      expect(res.body.canSend).toBe(false);
    });
  });

  describe('validation', () => {
    it.each([
      ['not-an-email', 'nope'],
      ['empty', ''],
      ['missing @', 'hiring.northwind.com']
    ])('rejects a %s recipient', async (_label, to) => {
      const res = await request(app())
        .post('/api/v2/job-outreach/prepare').set(AUTH).send({ ...DRAFT, to });
      expect(res.status).toBe(400);
      expect(mockAddRecipient).not.toHaveBeenCalled();
    });

    it('requires a subject and a body', async () => {
      const res = await request(app())
        .post('/api/v2/job-outreach/prepare').set(AUTH).send({ to: DRAFT.to });
      expect(res.status).toBe(400);
    });

    it('carries the letter through as the lead personalisation', async () => {
      await request(app()).post('/api/v2/job-outreach/prepare').set(AUTH).send(DRAFT);
      expect(mockAddRecipient).toHaveBeenCalledWith(
        expect.objectContaining({ subject: DRAFT.subject, body: DRAFT.body, email: DRAFT.to })
      );
    });

    it('reuses a campaign when one is passed rather than making another', async () => {
      await request(app())
        .post('/api/v2/job-outreach/prepare').set(AUTH).send({ ...DRAFT, campaignId: 'camp-existing' });
      expect(mockCreateCampaign).not.toHaveBeenCalled();
      expect(mockAddRecipient).toHaveBeenCalledWith(
        expect.objectContaining({ campaignId: 'camp-existing' })
      );
    });
  });
});
