'use strict';

const {
  PREFIX,
  generateDocumentNumber,
  normalizeDocumentNumber,
  docTypeKeyFromLabel,
} = require('../../services/documentNumber');

describe('services/documentNumber', () => {
  describe('PREFIX', () => {
    it('contains expected document type prefixes', () => {
      expect(PREFIX.offer_letter).toBe('TEN-OL');
      expect(PREFIX.lor).toBe('TEN-LOR');
      expect(PREFIX.expert).toBe('TEN-EXP');
      expect(PREFIX.nano_degree).toBe('TEN-ND');
      expect(PREFIX.fellowship).toBe('TEN-FEL');
    });

    it('has exactly 5 entries', () => {
      expect(Object.keys(PREFIX)).toHaveLength(5);
    });
  });

  describe('generateDocumentNumber', () => {
    it('returns correct format for each known type', () => {
      const year = new Date().getFullYear();
      for (const type of Object.keys(PREFIX)) {
        const result = generateDocumentNumber(type);
        expect(result).toMatch(new RegExp(`^${PREFIX[type]}-${year}-[A-Z0-9]{6}$`));
      }
    });

    it('returns empty string for unknown type', () => {
      expect(generateDocumentNumber('unknown')).toBe('');
      expect(generateDocumentNumber(null)).toBe('');
      expect(generateDocumentNumber(undefined)).toBe('');
    });

    it('generates unique numbers', () => {
      const results = new Set(Array.from({ length: 20 }, () => generateDocumentNumber('lor')));
      expect(results.size).toBe(20);
    });
  });

  describe('normalizeDocumentNumber', () => {
    it('trims and uppercases', () => {
      expect(normalizeDocumentNumber('  abc-123  ')).toBe('ABC-123');
    });

    it('handles falsy values', () => {
      expect(normalizeDocumentNumber(null)).toBe('');
      expect(normalizeDocumentNumber(undefined)).toBe('');
      expect(normalizeDocumentNumber('')).toBe('');
      expect(normalizeDocumentNumber(0)).toBe('');
    });
  });

  describe('docTypeKeyFromLabel', () => {
    it('maps offer-related labels to offer_letter', () => {
      expect(docTypeKeyFromLabel('Offer Letter')).toBe('offer_letter');
      expect(docTypeKeyFromLabel('offer')).toBe('offer_letter');
      expect(docTypeKeyFromLabel('OFFER')).toBe('offer_letter');
    });

    it('maps LOR / recommendation labels', () => {
      expect(docTypeKeyFromLabel('lor')).toBe('lor');
      expect(docTypeKeyFromLabel('LOR')).toBe('lor');
      expect(docTypeKeyFromLabel('Letter of Recommendation')).toBe('lor');
    });

    it('maps expert labels', () => {
      expect(docTypeKeyFromLabel('expert')).toBe('expert');
      expect(docTypeKeyFromLabel('Expert Certificate')).toBe('expert');
    });

    it('maps nano degree labels', () => {
      expect(docTypeKeyFromLabel('nano_degree')).toBe('nano_degree');
      expect(docTypeKeyFromLabel('Nano Degree')).toBe('nano_degree');
    });

    it('maps fellowship labels', () => {
      expect(docTypeKeyFromLabel('fellowship')).toBe('fellowship');
      expect(docTypeKeyFromLabel('FELLOWSHIP')).toBe('fellowship');
    });

    it('returns null for unrecognized labels', () => {
      expect(docTypeKeyFromLabel('random')).toBeNull();
      expect(docTypeKeyFromLabel('')).toBeNull();
      expect(docTypeKeyFromLabel(null)).toBeNull();
      expect(docTypeKeyFromLabel(undefined)).toBeNull();
    });
  });
});
