'use strict';

const {
  getFeeFor,
  isExempt,
  purposeFor,
  allPurposesFor,
  PAID_TENURES,
  PAYMENT_CUTOFF_DATE
} = require('../../config/tenurePayment');

const student = (tenure, extra = {}) => ({ tenure, createdAt: new Date('2026-08-01'), ...extra });

describe('config/tenurePayment', () => {
  describe('which tenures are charged', () => {
    // The confirmed rule from the task document (issue 6.2).
    it.each([
      ['1 Week',  2000],
      ['15 Days', 1500],
      ['1 Month', 1000]
    ])('charges a %s student ₹%i', (tenure, amount) => {
      const fee = getFeeFor(student(tenure));
      expect(fee.required).toBe(true);
      expect(fee.amount).toBe(amount);
    });

    // This is the student complaint in issue 6.2: asked to pay for a track
    // that is free.
    it.each(['45 Days', '3 Months', '6 Months'])('never charges a %s student', (tenure) => {
      const fee = getFeeFor(student(tenure));
      expect(fee.required).toBe(false);
      expect(fee.amount).toBe(0);
    });

    it('accepts the compact spellings too', () => {
      expect(getFeeFor(student('45days')).required).toBe(false);
      expect(getFeeFor(student('1month')).required).toBe(true);
    });

    it('does not charge a student with an unrecognised tenure', () => {
      expect(getFeeFor(student('banana')).required).toBe(false);
      expect(getFeeFor(student(null)).required).toBe(false);
      expect(getFeeFor(null).required).toBe(false);
    });
  });

  describe('the label shown on the payment screen', () => {
    // Screenshot 8: the dashboard wraps this label in its own "Internship
    // Program" sentence, so the label must be the tenure name ALONE. It used
    // to be "1 Month Internship Program", producing "the TEN 1 Month
    // Internship Program Internship Program".
    it.each([
      ['1 Week',  '1 Week'],
      ['15 Days', '15 Days'],
      ['1 Month', '1 Month']
    ])('labels a %s student as %p', (tenure, label) => {
      expect(getFeeFor(student(tenure)).label).toBe(label);
    });

    it.each(Object.keys(PAID_TENURES))('the %s label does not contain "Internship Program"', (key) => {
      const fee = getFeeFor(student(key));
      expect(fee.label).not.toMatch(/Internship Program/i);
    });
  });

  describe('exemptions', () => {
    it('exempts a student flagged as pre-existing', () => {
      expect(isExempt(student('1 Month', { isExistingStudent: true }))).toBe(true);
    });
    it('exempts a student who registered before the cutoff', () => {
      const before = new Date(PAYMENT_CUTOFF_DATE.getTime() - 86400000);
      expect(isExempt(student('1 Month', { createdAt: before }))).toBe(true);
    });
    it('does not exempt a student who registered after the cutoff', () => {
      const after = new Date(PAYMENT_CUTOFF_DATE.getTime() + 86400000);
      expect(isExempt(student('1 Month', { createdAt: after }))).toBe(false);
    });
    it('handles a missing student safely', () => {
      expect(isExempt(null)).toBe(false);
    });
  });

  describe('payment purpose', () => {
    it('writes the canonical purpose the admin queue matches on', () => {
      expect(purposeFor('1month')).toBe('tenure_1month');
      expect(purposeFor('1month')).toMatch(/^tenure_/);
    });

    // A student who paid through the v2 route was invisible to both the status
    // check and the admin queue, because the two systems wrote different
    // purpose strings. Lookups must find either.
    it('looks up every historical purpose string', () => {
      const purposes = allPurposesFor('1month');
      expect(purposes).toContain('tenure_1month');
      expect(purposes).toContain('TEN Internship Payment');
      expect(purposes).toContain('tenure_payment');
    });

    it('returns the legacy purposes even without a duration', () => {
      expect(allPurposesFor(null)).toContain('TEN Internship Payment');
    });

    it('has no duplicates', () => {
      const purposes = allPurposesFor('1month');
      expect(new Set(purposes).size).toBe(purposes.length);
    });
  });
});
