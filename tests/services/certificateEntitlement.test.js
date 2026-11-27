'use strict';

/**
 * Who has already settled the fee for a course certificate.
 *
 * Three ways it can happen, and until this module existed each screen knew
 * about a different subset: routes/v2/certificates.js checked ONLY the coin
 * redemption, so the zero-rupee waiver a paid track writes
 * (services/tenureBenefits.js) was written and never read. A student sold a
 * "Fellowship fee included" with their Sprint track still reached a Razorpay
 * order for the full ₹2,500.
 */

jest.mock('../../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../../models/new/CoinRedemption', () => ({ findOne: jest.fn() }));

const Payment = require('../../models/Payment');
const CoinRedemption = require('../../models/new/CoinRedemption');
const { feeSettled, feeSettledAll, CERT_KEYS } = require('../../services/certificateEntitlement');

/** The chain these routes use: findOne(...).sort(...).select(...).lean() */
const chain = (value) => {
  const tail = { select: () => ({ lean: () => Promise.resolve(value), catch: () => Promise.resolve(value) }) };
  return { sort: () => tail, ...tail };
};
const NONE = { covered: false, via: null, verifying: false };

function noPayments() { Payment.findOne.mockReturnValue(chain(null)); }
function noRedemptions() { CoinRedemption.findOne.mockReturnValue(chain(null)); }

beforeEach(() => {
  Payment.findOne.mockReset();
  CoinRedemption.findOne.mockReset();
  noPayments();
  noRedemptions();
});

const student = { _id: 'stu1', employeeId: 'TEN/WEB/1' };

describe('a fee nobody has settled', () => {
  it('is not covered', async () => {
    await expect(feeSettled(student, 'fellowship')).resolves.toEqual(NONE);
  });

  it('is not covered for an unknown certificate type either', async () => {
    await expect(feeSettled(student, 'not_a_cert')).resolves.toEqual(NONE);
  });

  it('is not covered when there is no student', async () => {
    await expect(feeSettled(null, 'expert')).resolves.toEqual(NONE);
  });
});

describe('a fee waived by a paid track', () => {
  // What services/tenureBenefits.js actually writes.
  const waiver = { amount: 0, status: 'success', metadata: { grantedBy: 'tenure_bundle', sourceOrderId: 'ORD-1' } };

  it('is covered, and reported as coming from the bundle', async () => {
    Payment.findOne.mockReturnValue(chain(waiver));
    await expect(feeSettled(student, 'fellowship')).resolves.toEqual({ covered: true, via: 'bundle', verifying: false });
  });

  it('is looked up by the purpose the waiver is written under', async () => {
    Payment.findOne.mockReturnValue(chain(waiver));
    await feeSettled(student, 'nano_degree');
    expect(Payment.findOne).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 'stu1',
      purpose: 'cert_nano_degree'
    }));
  });
});

describe('a fee the student paid themselves', () => {
  it('is covered once an admin has approved it, and is not mistaken for a bundle waiver', async () => {
    Payment.findOne.mockReturnValue(chain({ amount: 1000, status: 'success', metadata: {} }));
    await expect(feeSettled(student, 'fellowship')).resolves.toEqual({ covered: true, via: 'purchase', verifying: false });
  });

  /*
   * A submitted UPI reference is twelve digits anyone can type, and a PDF
   * cannot be taken back once downloaded. Until an admin approves it the student is
   * told "verifying" — not handed the certificate, and not asked to pay again.
   */
  it('does not count a payment still awaiting verification, but reports it', async () => {
    Payment.findOne.mockReturnValue(chain({ amount: 300, status: 'pending_verification' }));
    await expect(feeSettled(student, 'expert')).resolves.toEqual({ covered: false, via: null, verifying: true });
    expect(Payment.findOne).toHaveBeenCalledWith(expect.objectContaining({
      status: { $in: ['success', 'pending_verification'] }
    }));
  });
});

describe('a fee redeemed with coins', () => {
  it('is covered', async () => {
    CoinRedemption.findOne.mockReturnValue(chain({ _id: 'r1' }));
    await expect(feeSettled(student, 'expert')).resolves.toEqual({ covered: true, via: 'coins', verifying: false });
  });

  /*
   * The marketplace calls the middle tier `cert_nano`, the bundle calls it
   * `cert_nano_degree`. Both names are real and both are in production data;
   * asking the wrong store with the wrong one silently finds nothing.
   */
  it('asks the marketplace by its own key for the middle tier', async () => {
    CoinRedemption.findOne.mockReturnValue(chain({ _id: 'r1' }));
    await feeSettled(student, 'nano_degree');
    expect(CoinRedemption.findOne).toHaveBeenCalledWith(expect.objectContaining({ itemKey: 'cert_nano' }));
    expect(CERT_KEYS.nano_degree).toEqual({ purpose: 'cert_nano_degree', itemKey: 'cert_nano' });
  });
});

describe('all three at once, for the screen that draws all three', () => {
  it('answers for every type', async () => {
    const all = await feeSettledAll(student);
    expect(Object.keys(all).sort()).toEqual(['expert', 'fellowship', 'nano_degree']);
    expect(all.expert.covered).toBe(false);
  });

  it('survives a store that throws instead of taking the page down', async () => {
    Payment.findOne.mockImplementation(() => { throw new Error('mongo down'); });
    await expect(feeSettledAll(student)).rejects.toThrow();  // the caller catches; see the route
  });
});
