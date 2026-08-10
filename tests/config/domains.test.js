'use strict';

const {
  DOMAIN_NAMES,
  SELECTABLE_DOMAIN_NAMES,
  normalizeDomain,
  isValidDomain,
  getDomainShortCode
} = require('../../config/domains');

// Exactly what public/register.html offers on its domain cards.
const REGISTER_FORM_DOMAINS = [
  'DevOps with AWS', 'Python Development', 'Java Development', 'Web Development',
  'MERN Stack Development', 'Artificial Intelligence', 'Data Science', 'Cyber Security',
  'Software Engineering', 'Flutter Development', 'Business Development', 'HR',
  'Space Intern', 'Venture Capital', 'Finance'
];

// Domains held by existing students, from the old validator list.
const LEGACY_DOMAINS = ['HR Management', 'Vibe Coding', 'Space Research', 'Business Analyst'];

describe('config/domains', () => {
  // The whole point of this module: enabling validation must not reject a
  // choice the registration form actually offers.
  it.each(REGISTER_FORM_DOMAINS)('accepts %p, which the registration form offers', (domain) => {
    expect(isValidDomain(domain)).toBe(true);
  });

  it.each(REGISTER_FORM_DOMAINS)('offers %p as selectable', (domain) => {
    expect(SELECTABLE_DOMAIN_NAMES).toContain(domain);
  });

  // Existing students must not become invalid.
  it.each(LEGACY_DOMAINS)('still accepts the legacy domain %p', (domain) => {
    expect(isValidDomain(domain)).toBe(true);
  });

  it.each(LEGACY_DOMAINS)('does not offer the legacy domain %p to new students', (domain) => {
    expect(SELECTABLE_DOMAIN_NAMES).not.toContain(domain);
  });

  describe('normalizeDomain', () => {
    it('is case- and whitespace-insensitive', () => {
      expect(normalizeDomain('  web development ')).toBe('Web Development');
      expect(normalizeDomain('CYBER SECURITY')).toBe('Cyber Security');
    });
    it.each([null, undefined, '', '   ', 'Underwater Basket Weaving', 42, {}])(
      'returns null for %p',
      (value) => { expect(normalizeDomain(value)).toBeNull(); }
    );
  });

  describe('getDomainShortCode', () => {
    it('returns the employee-ID prefix', () => {
      expect(getDomainShortCode('Web Development')).toBe('WEB');
      expect(getDomainShortCode('MERN Stack Development')).toBe('MERN');
    });

    // TEN/SPACE/1005 used to be ambiguous — two domains shared the prefix.
    it('gives Space Intern and Space Research distinct prefixes', () => {
      expect(getDomainShortCode('Space Intern')).not.toBe(getDomainShortCode('Space Research'));
    });

    it('every domain has a prefix, and no two selectable domains collide', () => {
      const codes = SELECTABLE_DOMAIN_NAMES.map(getDomainShortCode);
      expect(codes.every(Boolean)).toBe(true);
      expect(new Set(codes).size).toBe(codes.length);
    });

    // An arbitrary request body used to become part of the employee ID via
    // `domain.toUpperCase()`.
    it('falls back to GEN rather than echoing unknown input', () => {
      expect(getDomainShortCode('../../etc/passwd')).toBe('GEN');
      expect(getDomainShortCode(null)).toBe('GEN');
    });
  });

  it('has no duplicate domain names', () => {
    expect(new Set(DOMAIN_NAMES).size).toBe(DOMAIN_NAMES.length);
  });
});
