'use strict';

/**
 * The quota arithmetic — the part that can be run for real.
 *
 * config/growthQuota.js has no dependencies, so unlike the rest of the Growth
 * OS it can be required and exercised directly rather than asserted against
 * its own source.
 */

const Q = require('../../config/growthQuota');

describe('the allowance adds up', () => {
  it('stage 1 plus the extension is the ceiling', () => {
    expect(Q.STAGE1_LIMIT + Q.EXTENSION_MAX).toBe(Q.MARKETING_CEILING);
  });

  it('the ceiling plus the portal reserve fits inside the provider cap', () => {
    /*
     * This is the whole point of the file. Marketing and the portal share one
     * 15,000/month allowance; if campaigns can consume more than
     * cap - reserve, a student stops receiving the certificate they earned
     * because somebody sent a newsletter.
     */
    expect(Q.MARKETING_CEILING + Q.PORTAL_RESERVE).toBeLessThanOrEqual(Q.PROVIDER_MONTHLY_CAP);
  });

  it('the defaults are the numbers that were agreed', () => {
    expect(Q.STAGE1_LIMIT).toBe(7500);
    expect(Q.EXTENSION_MAX).toBe(4000);
    expect(Q.MARKETING_CEILING).toBe(11500);
  });
});

describe('what counts against the quota', () => {
  it('counts campaign mail', () => {
    for (const t of ['inactive-reengagement', 'active-appreciation', 'promotion', 'campaign']) {
      expect(Q.MARKETING_TYPES).toContain(t);
    }
  });

  it('never counts a certificate, an offer letter or a password reset', () => {
    // These come out of the reserve. A marketing cap that blocks them would
    // stop a student receiving work they have already earned.
    for (const t of ['offer', 'loc', 'lor', 'star', 'welcome', 'password_reset', 'account_recovery']) {
      expect(Q.MARKETING_TYPES).not.toContain(t);
    }
  });
});

describe('the period boundary', () => {
  it('runs from the 1st to the 1st by default', () => {
    const mid = new Date(2026, 8, 15, 12, 0, 0); // 15 Sep 2026
    expect(Q.periodStart(mid).getDate()).toBe(1);
    expect(Q.periodStart(mid).getMonth()).toBe(8);
    expect(Q.periodEnd(mid).getMonth()).toBe(9);
    expect(Q.periodKey(mid)).toBe('2026-09');
  });

  it('honours a reset day that is not the 1st', () => {
    /*
     * A provider's free tier resets on the day the account was opened, not on
     * the 1st. With the wrong day the counter reads "0 used" while the
     * provider still counts 14,000 against you — and the first thing that
     * fails is a certificate.
     */
    const before = new Date(2026, 8, 5, 12, 0, 0);   // 5 Sep, reset day 12
    const after  = new Date(2026, 8, 20, 12, 0, 0);  // 20 Sep

    expect(Q.periodStart(before, 12).getMonth()).toBe(7);  // period began 12 Aug
    expect(Q.periodStart(before, 12).getDate()).toBe(12);
    expect(Q.periodStart(after, 12).getMonth()).toBe(8);   // period began 12 Sep
    expect(Q.periodStart(after, 12).getDate()).toBe(12);
  });

  it('a period is exactly one month long', () => {
    const now = new Date(2026, 8, 20, 12, 0, 0);
    const start = Q.periodStart(now, 12);
    const end = Q.periodEnd(now, 12);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getDate()).toBe(start.getDate());
    expect((end.getMonth() - start.getMonth() + 12) % 12).toBe(1);
  });

  it('clamps the reset day to 28 so February cannot move the boundary', () => {
    // new Date(2026, 1, 30) is 2 March. A reset day past 28 would silently
    // shift the period into the next month for short months only.
    expect(Q.periodStart(new Date(2026, 1, 15), 31).getDate()).toBeLessThanOrEqual(28);
    expect(Q.RESET_DAY).toBeLessThanOrEqual(28);
  });

  it('the key is stable inside a period and changes across one', () => {
    const a = new Date(2026, 8, 13, 0, 0, 0);
    const b = new Date(2026, 9, 11, 23, 0, 0);
    expect(Q.periodKey(a, 12)).toBe(Q.periodKey(b, 12));
    expect(Q.periodKey(a, 12)).not.toBe(Q.periodKey(new Date(2026, 9, 13), 12));
  });
});
