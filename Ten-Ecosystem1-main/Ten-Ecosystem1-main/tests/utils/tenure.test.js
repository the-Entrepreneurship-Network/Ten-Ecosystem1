'use strict';

const {
  normalizeTenure,
  toDurationType,
  getTenureDays,
  getTenureLabel,
  isValidTenure,
  getInternshipEndDate,
  DURATION_TYPES,
  TENURE_DAYS
} = require('../../utils/tenure');

describe('utils/tenure', () => {
  describe('normalizeTenure', () => {
    // The registration form writes these exact strings (public/register.html).
    // The old lookup tables were keyed without spaces, so none of them matched
    // and every student silently became a 30-day student.
    it.each([
      ['1 Week',   '1week'],
      ['15 Days',  '15days'],
      ['1 Month',  '1month'],
      ['45 Days',  '45days'],
      ['3 Months', '3months'],
      ['6 Months', '6months']
    ])('maps the registration form value %p to %p', (input, expected) => {
      expect(normalizeTenure(input)).toBe(expected);
    });

    it.each(DURATION_TYPES)('is idempotent for the canonical key %p', (key) => {
      expect(normalizeTenure(key)).toBe(key);
    });

    it.each([
      ['45days',   '45days'],
      ['45-days',  '45days'],
      ['45_Days',  '45days'],
      ['45',       '45days'],
      ['  45 DAYS  ', '45days']
    ])('accepts %p as 45days', (input, expected) => {
      expect(normalizeTenure(input)).toBe(expected);
    });

    it.each([
      ['15days', '15days'],
      ['15 day', '15days'],
      ['15d',    '15days']
    ])('accepts %p as 15days', (input, expected) => {
      expect(normalizeTenure(input)).toBe(expected);
    });

    it.each([
      ['1week',  '1week'],
      ['1 week', '1week'],
      ['7 days', '1week'],
      ['7d',     '1week']
    ])('accepts %p as 1week', (input, expected) => {
      expect(normalizeTenure(input)).toBe(expected);
    });

    it.each([
      ['3months',  '3months'],
      ['3 month',  '3months'],
      ['3M',       '3months'],
      ['6months',  '6months'],
      ['6 Months', '6months'],
      ['6M',       '6months']
    ])('accepts %p as %p', (input, expected) => {
      expect(normalizeTenure(input)).toBe(expected);
    });

    it.each([
      ['1month',  '1month'],
      ['1 month', '1month'],
      ['30 days', '1month'],
      ['1M',      '1month']
    ])('accepts %p as 1month', (input, expected) => {
      expect(normalizeTenure(input)).toBe(expected);
    });

    // 45 must never be read as "4" or "5" months, and 15 must never collapse
    // to 1 week/month — these were the collisions in the old ad-hoc parsers.
    it('does not confuse 45 with a month count', () => {
      expect(normalizeTenure('45 Days')).toBe('45days');
      expect(normalizeTenure('45')).toBe('45days');
    });
    it('does not confuse 15 days with 1 month or 1 week', () => {
      expect(normalizeTenure('15 Days')).toBe('15days');
      expect(normalizeTenure('15days')).toBe('15days');
    });

    it.each([null, undefined, '', '   ', 'banana', {}, [], 0, false])(
      'returns null for unrecognised input %p',
      (input) => { expect(normalizeTenure(input)).toBeNull(); }
    );

    // A loose substring match reads "unknown" as a week, because the word
    // contains a "w". Matching must be anchored, not "does it contain a unit".
    it.each([
      'unknown', 'whatever', 'wednesday', 'nomad', 'summer', 'dummy', 'moment',
      '2 weeks', '1 year', '4 months', '10 days', '99', 'month1'
    ])('rejects %p rather than guessing', (input) => {
      expect(normalizeTenure(input)).toBeNull();
    });

    it('accepts written-out numbers', () => {
      expect(normalizeTenure('one month')).toBe('1month');
      expect(normalizeTenure('six months')).toBe('6months');
      expect(normalizeTenure('three months')).toBe('3months');
    });

    it('maps a bare day count to the tenure of that length', () => {
      expect(normalizeTenure('7')).toBe('1week');
      expect(normalizeTenure('30 days')).toBe('1month');
      expect(normalizeTenure('90')).toBe('3months');
      expect(normalizeTenure('180 days')).toBe('6months');
    });
  });

  describe('toDurationType', () => {
    it('falls back to 1month for unrecognised input', () => {
      expect(toDurationType('banana')).toBe('1month');
      expect(toDurationType(null)).toBe('1month');
    });
    it('honours an explicit fallback', () => {
      expect(toDurationType('banana', '45days')).toBe('45days');
    });
  });

  describe('getTenureDays', () => {
    it.each([
      ['1 Week',   7],
      ['15 Days',  15],
      ['1 Month',  30],
      ['45 Days',  45],
      ['3 Months', 90],
      ['6 Months', 180]
    ])('returns %p days for %p', (input, days) => {
      expect(getTenureDays(input)).toBe(days);
    });

    // The regression this whole module exists to prevent.
    it('does not return 30 for a 45-day student', () => {
      expect(getTenureDays('45 Days')).not.toBe(30);
      expect(getTenureDays('45 Days')).toBe(45);
    });

    it('every canonical key has a day count', () => {
      for (const key of DURATION_TYPES) {
        expect(typeof TENURE_DAYS[key]).toBe('number');
        expect(TENURE_DAYS[key]).toBeGreaterThan(0);
      }
    });
  });

  describe('getTenureLabel', () => {
    it('round-trips a normalised value back to its display label', () => {
      expect(getTenureLabel('45days')).toBe('45 Days');
      expect(getTenureLabel('45 Days')).toBe('45 Days');
      expect(getTenureLabel('6M')).toBe('6 Months');
    });
  });

  describe('isValidTenure', () => {
    it('accepts every form the registration UI can produce', () => {
      for (const label of ['1 Week', '15 Days', '1 Month', '45 Days', '3 Months', '6 Months']) {
        expect(isValidTenure(label)).toBe(true);
      }
    });
    it('rejects nonsense', () => {
      expect(isValidTenure('2 Years')).toBe(false);
      expect(isValidTenure('')).toBe(false);
    });
  });

  describe('getInternshipEndDate', () => {
    it('counts the start date as day 1', () => {
      // 1 July + 45 days inclusive = 14 August
      const end = getInternshipEndDate('2026-07-01', '45 Days');
      expect(end.toISOString().slice(0, 10)).toBe('2026-08-14');
    });

    it('handles a 1-week tenure', () => {
      const end = getInternshipEndDate('2026-07-01', '1 Week');
      expect(end.toISOString().slice(0, 10)).toBe('2026-07-07');
    });

    it('returns null for a missing or invalid start date', () => {
      expect(getInternshipEndDate(null, '1 Month')).toBeNull();
      expect(getInternshipEndDate('not-a-date', '1 Month')).toBeNull();
    });
  });
});
