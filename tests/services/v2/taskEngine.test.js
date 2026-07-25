'use strict';

const { tenureToDurationType } = require('../../../services/v2/taskEngine');

describe('services/v2/taskEngine', () => {
  describe('tenureToDurationType', () => {
    it('returns "1month" for null/undefined/empty', () => {
      expect(tenureToDurationType(null)).toBe('1month');
      expect(tenureToDurationType(undefined)).toBe('1month');
      expect(tenureToDurationType('')).toBe('1month');
    });

    it('maps 45-day variants to "45days"', () => {
      expect(tenureToDurationType('45 days')).toBe('45days');
      expect(tenureToDurationType('45days')).toBe('45days');
      expect(tenureToDurationType('45')).toBe('45days');
    });

    it('maps 6-month variants to "6months"', () => {
      expect(tenureToDurationType('6 months')).toBe('6months');
      expect(tenureToDurationType('6months')).toBe('6months');
      expect(tenureToDurationType('6m')).toBe('6months');
      expect(tenureToDurationType('6month')).toBe('6months');
    });

    it('maps 3-month variants to "3months"', () => {
      expect(tenureToDurationType('3 months')).toBe('3months');
      expect(tenureToDurationType('3months')).toBe('3months');
      expect(tenureToDurationType('3m')).toBe('3months');
      expect(tenureToDurationType('3month')).toBe('3months');
    });

    it('defaults unrecognized strings to "1month"', () => {
      expect(tenureToDurationType('2 weeks')).toBe('1month');
      expect(tenureToDurationType('unknown')).toBe('1month');
      expect(tenureToDurationType('1 year')).toBe('1month');
    });

    it('handles numeric input', () => {
      expect(tenureToDurationType(45)).toBe('45days');
    });

    it('is case-insensitive', () => {
      expect(tenureToDurationType('6 MONTHS')).toBe('6months');
      expect(tenureToDurationType('3M')).toBe('3months');
    });
  });
});
