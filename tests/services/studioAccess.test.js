'use strict';

/**
 * Who may open the Course, the Resume Portal and the Job Portal.
 *
 * These three were being given away: express.static("public") serves
 * /job-portal and /resume-portal to anyone with the URL. One rule decides it
 * now, and everything asks that rule — the middleware in front of the files,
 * the pricing screen, and the certificate route deciding whether a fee is
 * still owed.
 */

jest.mock('../../models/Payment', () => ({ find: jest.fn() }));

const Payment = require('../../models/Payment');
const { getStudioAccess, canOpen } = require('../../services/studioAccess');
const studioPricing = require('../../config/studioPricing');

/** Payment.find(...).select(...).lean() */
const rows = (list) => Payment.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(list) }) });

const student = (over = {}) => ({ _id: 'stu1', employeeId: 'TEN/WEB/1', tenure: '6 Months', ...over });
/** A paid track, settled — utils/premium reads shortCoursePaid. */
const paidTrack = () => student({ tenure: '1 Week', shortCoursePaid: true });

beforeEach(() => { Payment.find.mockReset(); rows([]); });

describe('a student who has bought nothing', () => {
  it('opens none of the three', async () => {
    const { portals } = await getStudioAccess(student());
    expect(portals.course.granted).toBe(false);
    expect(portals.resume.granted).toBe(false);
    expect(portals.job.granted).toBe(false);
  });

  it('is refused by the check the middleware uses', async () => {
    await expect(canOpen(student(), 'job')).resolves.toBe(false);
  });

  it('owes nothing', async () => {
    expect((await getStudioAccess(student())).feeDue).toBeNull();
  });
});

describe('a single purchase', () => {
  it('opens only what it covers', async () => {
    rows([{ purpose: 'studio_resume', status: 'success', metadata: {} }]);
    const { portals } = await getStudioAccess(student());
    expect(portals.resume).toEqual({ granted: true, via: 'purchase' });
    expect(portals.course.granted).toBe(false);
    expect(portals.job.granted).toBe(false);
  });

  // The money has arrived; an admin has simply not looked yet. Making them wait
  // is how a paying student ends up in a support queue.
  it('does NOT count a reference the student typed and nobody checked', async () => {
    /*
     * This used to assert the opposite. 'pending_verification' is the state a
     * payment is in when a student has typed a transaction number into the box
     * and no human has looked at it, and it counted as settled — so anyone
     * could open every paid portal by typing anything at all.
     *
     * Rows written before the grandfather cutoff still count, so nobody using
     * the Studio today loses it; a row with no date never does.
     */
    rows([{ purpose: 'studio_job', status: 'pending_verification', metadata: {}, createdAt: new Date() }]);
    expect((await getStudioAccess(student())).portals.job.granted).toBe(false);
  });

  it('but keeps the students who already had access on one', async () => {
    const { UNVERIFIED_UNTIL } = require('../../services/studioAccess');
    const before = new Date(UNVERIFIED_UNTIL.getTime() - 86400000);
    rows([{ purpose: 'studio_job', status: 'pending_verification', metadata: {}, createdAt: before }]);
    expect((await getStudioAccess(student())).portals.job.granted).toBe(true);
  });

  it('ignores a failed one', async () => {
    rows([{ purpose: 'studio_job', status: 'failed', metadata: {} }]);
    expect((await getStudioAccess(student())).portals.job.granted).toBe(false);
  });
});

describe('the combo', () => {
  it('opens all three', async () => {
    rows([{ purpose: 'studio_combo', status: 'success', metadata: {} }]);
    const { portals } = await getStudioAccess(student());
    studioPricing.PORTALS.forEach((p) => expect(portals[p]).toEqual({ granted: true, via: 'purchase' }));
  });

  it('is cheaper than the three singles, which is what the screen claims', () => {
    const t = studioPricing.getPricingTable();
    expect(t.combo.price).toBeLessThan(t.combo.insteadOf);
    expect(t.combo.saving).toBe(t.combo.insteadOf - t.combo.price);
    expect(t.combo.insteadOf).toBe(t.singles.reduce((s, p) => s + p.price, 0));
  });
});

describe('a paid internship track', () => {
  /*
   * They have already paid ₹1,000–₹2,000. Meeting a second ₹500 paywall on
   * day one is how a paying student decides the product is a series of tolls.
   */
  it('includes all three, with nothing bought', async () => {
    const { portals, premium } = await getStudioAccess(paidTrack());
    expect(premium).toBe(true);
    studioPricing.PORTALS.forEach((p) => expect(portals[p]).toEqual({ granted: true, via: 'tenure' }));
  });

  it('does not include them for a free track', async () => {
    const { portals, premium } = await getStudioAccess(student({ tenure: '6 Months' }));
    expect(premium).toBe(false);
    expect(portals.course.granted).toBe(false);
  });
});

describe('pay after completion', () => {
  // Approved by HR. The request on its own grants nothing — that is the case
  // directly below, and the whole reason the queue exists.
  const deferred = [{ purpose: 'studio_combo', status: 'pending',
                      metadata: { payMode: 'after', deferApprovedAt: new Date('2026-08-02') },
                      amount: 600, createdAt: new Date('2026-08-01') }];

  it('opens the portals once HR approves — the learning is not what waits', async () => {
    rows(deferred);
    const { portals } = await getStudioAccess(student());
    studioPricing.PORTALS.forEach((p) => expect(portals[p].granted).toBe(true));
    expect(portals.course.via).toBe('deferred');
  });

  // The request is with HR. Opening the portal on the click would make the
  // approval a rubber stamp on a door already open.
  it('opens nothing while the request is still waiting on HR', async () => {
    rows([{ purpose: 'studio_combo', status: 'pending',
            metadata: { payMode: 'after', reason: 'stipend comes next month' } }]);
    const { portals, feeDue } = await getStudioAccess(student());
    studioPricing.PORTALS.forEach((p) => expect(portals[p].granted).toBe(false));
    expect(feeDue).toBeNull();
  });

  it('records what is owed, so the certificate can be held', async () => {
    rows(deferred);
    const { feeDue } = await getStudioAccess(student());
    // What the row says, which for a deferral is the deferred price.
    expect(feeDue).toMatchObject({ product: 'combo', amount: 600 });
  });

  // A pending row WITHOUT the deferred flag is just an abandoned checkout.
  it('does not open anything for an order that was never chosen as pay-later', async () => {
    rows([{ purpose: 'studio_combo', status: 'pending', metadata: {} }]);
    const { portals, feeDue } = await getStudioAccess(student());
    expect(portals.course.granted).toBe(false);
    expect(feeDue).toBeNull();
  });

  it('stops asking once the fee is settled', async () => {
    rows([...deferred, { purpose: 'studio_combo', status: 'success', metadata: {} }]);
    const { portals, feeDue } = await getStudioAccess(student());
    expect(feeDue).toBeNull();
    expect(portals.course.via).toBe('purchase');
  });
});

describe('when the database is unhappy', () => {
  /*
   * Fail closed for buying, open for what the track already includes: a blip
   * must not lock a paying student out of what they own, and must not hand the
   * Studio to somebody who never bought it.
   */
  it('does not hand the Studio to a stranger', async () => {
    Payment.find.mockReturnValue({ select: () => ({ lean: () => Promise.reject(new Error('mongo down')) }) });
    const { portals } = await getStudioAccess(student());
    expect(portals.course.granted).toBe(false);
  });

  it('does not lock out a paid-track student, who needs no payment row', async () => {
    Payment.find.mockReturnValue({ select: () => ({ lean: () => Promise.reject(new Error('mongo down')) }) });
    const { portals } = await getStudioAccess(paidTrack());
    expect(portals.course).toEqual({ granted: true, via: 'tenure' });
  });

  it('refuses politely when there is no student at all', async () => {
    const { portals, feeDue } = await getStudioAccess(null);
    expect(portals.job.granted).toBe(false);
    expect(feeDue).toBeNull();
  });
});

describe('the purpose codes', () => {
  it('round-trip', () => {
    expect(studioPricing.purposeFor('combo')).toBe('studio_combo');
    expect(studioPricing.productKeyFromPurpose('studio_combo')).toBe('combo');
  });

  // A tenure payment must never be mistaken for a Studio one.
  it('do not collide with the internship fee', () => {
    expect(studioPricing.productKeyFromPurpose('tenure_1month')).toBeNull();
    expect(studioPricing.productKeyFromPurpose('cert_fellowship')).toBeNull();
    expect(studioPricing.allPurposes().every((p) => p.startsWith('studio_'))).toBe(true);
  });

  it('open nothing for a product that does not exist', () => {
    expect(studioPricing.unlocksFor('everything')).toEqual([]);
  });
});
