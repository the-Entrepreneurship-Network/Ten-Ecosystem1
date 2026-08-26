'use strict';

/**
 * The box on the Career Studio page.
 *
 * It set a flag and nothing else — no request, no record, no mail. Everybody
 * who typed their address in was told "You're on the list" and put on no list
 * at all.
 */

jest.mock('../../models/StudioLead', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../utils/mailer', () => {
  const actual = jest.requireActual('../../utils/mailer');
  return {
    ...actual,
    mailerReady: jest.fn(() => true),
    isSendableAddress: jest.fn(() => true),
    createEmailTransporter: jest.fn(() => ({ sendMail: jest.fn(() => Promise.resolve({ messageId: '1' })) }))
  };
});

const StudioLead = require('../../models/StudioLead');
const mailer = require('../../utils/mailer');
const { captureLead, sendEligibilityMail, WHAT_YOU_GET, STUDIO_URL } = require('../../services/studioLead');

const noLead = () => StudioLead.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
const hasLead = () => StudioLead.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'l1' }) }) });
const sent = () => mailer.createEmailTransporter.mock.results
  .flatMap((r) => r.value.sendMail.mock.calls).map((c) => c[0]);

beforeEach(() => {
  StudioLead.findOne.mockReset();
  StudioLead.create.mockReset().mockResolvedValue({});
  mailer.mailerReady.mockReset().mockReturnValue(true);
  mailer.isSendableAddress.mockReset().mockReturnValue(true);
  mailer.createEmailTransporter.mockClear();
  noLead();
});

describe('an address that is not one', () => {
  it.each(['', 'nope', 'a@b', '@example.com', 'two @spaces.com', 'x'.repeat(250) + '@e.com'])
    ('refuses %p without sending anything', async (bad) => {
      await expect(captureLead(bad)).resolves.toEqual({ ok: false, fresh: false, mail: 'invalid' });
      expect(mailer.createEmailTransporter).not.toHaveBeenCalled();
      expect(StudioLead.create).not.toHaveBeenCalled();
    });
});

describe('a new address', () => {
  it('gets the mail and gets recorded', async () => {
    const r = await captureLead('Bishal@Example.COM');
    expect(r).toEqual({ ok: true, fresh: true, mail: 'sent' });
    expect(sent()).toHaveLength(1);
    expect(StudioLead.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'bishal@example.com', mailStatus: 'sent'
    }));
  });

  it('is stored lowercased and trimmed, so it is the same person tomorrow', async () => {
    await captureLead('  MiXeD@Example.com  ');
    expect(StudioLead.create.mock.calls[0][0].email).toBe('mixed@example.com');
  });

  it('is sent a link back to the Studio, which is the front door to all of it', async () => {
    await captureLead('a@example.com');
    expect(STUDIO_URL).toMatch(/\/student-portal\/$/);
    expect(sent()[0].html).toContain(STUDIO_URL);
  });

  it('is told what is actually inside, not a slogan', async () => {
    await captureLead('a@example.com');
    const html = sent()[0].html;
    WHAT_YOU_GET.forEach(([title]) => expect(html).toContain(title));
    expect(WHAT_YOU_GET.length).toBeGreaterThanOrEqual(6);
  });

  // They have no account — the default footer line would be a lie to a stranger.
  it('is told truthfully why it arrived', async () => {
    await captureLead('a@example.com');
    const html = sent()[0].html;
    expect(html).toContain('you asked about the TEN Career Studio');
    expect(html).not.toContain('activity on your TEN internship account');
  });
});

describe('the same address twice', () => {
  it('is not mailed again', async () => {
    hasLead();
    const r = await captureLead('a@example.com');
    expect(r).toEqual({ ok: true, fresh: false, mail: 'already' });
    expect(mailer.createEmailTransporter).not.toHaveBeenCalled();
  });

  /*
   * The reply is the same whether the address is new or known. This endpoint is
   * public and unauthenticated, so an answer that differed would turn it into a
   * way to ask "is this person signed up?" about anybody.
   */
  it('cannot be used to find out who is already on the list', async () => {
    noLead();  const fresh = await captureLead('new@example.com');
    hasLead(); const known = await captureLead('old@example.com');
    expect(fresh.ok).toBe(known.ok);
    // `fresh` is for the caller's logging, not for the wire — the route sends
    // one fixed message either way.
    const route = require('fs').readFileSync(require('path').join(__dirname, '../../routes/v2/studio.js'), 'utf8');
    expect(route).not.toMatch(/result\.fresh/);
  });
});

describe('when things break', () => {
  it('still mails when the lead table cannot be read', async () => {
    // The worst case is a second copy, which beats the silence this replaces.
    StudioLead.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.reject(new Error('mongo down')) }) });
    await expect(captureLead('a@example.com')).resolves.toMatchObject({ ok: true, mail: 'sent' });
  });

  it('records the failure rather than pretending it went', async () => {
    mailer.createEmailTransporter.mockReturnValue({ sendMail: () => Promise.reject(new Error('550 rejected')) });
    const r = await captureLead('a@example.com');
    expect(r.mail).toBe('failed');
    expect(StudioLead.create.mock.calls[0][0]).toMatchObject({ mailStatus: 'failed' });
    expect(StudioLead.create.mock.calls[0][0].mailError).toContain('550');
  });

  it('does not throw when the mailer is not configured at all', async () => {
    mailer.mailerReady.mockReturnValue(false);
    await expect(sendEligibilityMail('a@example.com')).resolves.toEqual({ status: 'skipped', error: 'mail not configured' });
  });

  it('does not throw when the record cannot be written', async () => {
    StudioLead.create.mockRejectedValue(new Error('duplicate key'));
    await expect(captureLead('a@example.com')).resolves.toMatchObject({ ok: true });
  });
});

describe('the form that feeds it', () => {
  const hero = require('fs').readFileSync(
    require('path').join(__dirname, '../../student-portal-app/src/components/HeroSection.tsx'), 'utf8');

  it('actually calls the server now', () => {
    expect(hero).toContain("fetch('/api/v2/studio/lead'");
    expect(hero).toContain("method: 'POST'");
  });

  // Saying "you're on the list" when the request never left the device is the
  // bug this replaces.
  it('does not claim success until the server says so', () => {
    expect(hero).not.toContain('setSubmitted(true);');
    expect(hero).toContain("setStatus('done')");
    expect(hero).toContain("setStatus('error')");
  });

  it('leaves the form on screen when it failed, so it can be tried again', () => {
    expect(hero).toContain("status === 'done' ?");
    expect(hero).toContain("status === 'error' &&");
  });

  it('cannot be fired twice while it is in flight', () => {
    expect(hero).toContain("disabled={status === 'sending'}");
  });
});
