'use strict';

const { generateDocumentNumber, normalizeDocumentNumber } = require('../../utils/documentNumber');

describe('utils/documentNumber', () => {
  describe('generateDocumentNumber', () => {
    it('returns a string with the correct prefix for offer_letter', () => {
      const result = generateDocumentNumber('offer_letter');
      expect(result).toMatch(/^TEN-OL-\d{4}-[A-F0-9]{6}$/);
    });

    it('returns a string with the correct prefix for offer', () => {
      const result = generateDocumentNumber('offer');
      expect(result).toMatch(/^TEN-OL-\d{4}-[A-F0-9]{6}$/);
    });

    it('returns a string with the correct prefix for lor', () => {
      const result = generateDocumentNumber('lor');
      expect(result).toMatch(/^TEN-LOR-\d{4}-[A-F0-9]{6}$/);
    });

    it('returns a string with the correct prefix for loc / completion', () => {
      expect(generateDocumentNumber('loc')).toMatch(/^TEN-LOC-/);
      expect(generateDocumentNumber('completion')).toMatch(/^TEN-LOC-/);
    });

    it('returns a string with the correct prefix for expert types', () => {
      expect(generateDocumentNumber('expert')).toMatch(/^TEN-EXP-/);
      expect(generateDocumentNumber('expert_certificate')).toMatch(/^TEN-EXP-/);
    });

    it('returns a string with the correct prefix for nano_degree', () => {
      expect(generateDocumentNumber('nano_degree')).toMatch(/^TEN-ND-/);
    });

    it('returns a string with the correct prefix for fellowship', () => {
      expect(generateDocumentNumber('fellowship')).toMatch(/^TEN-FEL-/);
    });

    it('falls back to TEN-DOC for unknown types', () => {
      expect(generateDocumentNumber('unknown')).toMatch(/^TEN-DOC-/);
      expect(generateDocumentNumber(undefined)).toMatch(/^TEN-DOC-/);
    });

    it('includes the current year', () => {
      const year = new Date().getFullYear().toString();
      const result = generateDocumentNumber('lor');
      expect(result).toContain(year);
    });

    it('generates unique document numbers on successive calls', () => {
      const a = generateDocumentNumber('offer_letter');
      const b = generateDocumentNumber('offer_letter');
      expect(a).not.toBe(b);
    });
  });

  describe('normalizeDocumentNumber', () => {
    it('trims whitespace and uppercases the value', () => {
      expect(normalizeDocumentNumber('  ten-ol-2025-abc123  ')).toBe('TEN-OL-2025-ABC123');
    });

    it('handles null / undefined gracefully', () => {
      expect(normalizeDocumentNumber(null)).toBe('');
      expect(normalizeDocumentNumber(undefined)).toBe('');
    });

    it('handles empty string', () => {
      expect(normalizeDocumentNumber('')).toBe('');
    });

    it('converts numbers to string', () => {
      expect(normalizeDocumentNumber(12345)).toBe('12345');
    });
  });
});
