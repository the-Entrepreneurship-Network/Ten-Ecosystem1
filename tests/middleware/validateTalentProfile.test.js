'use strict';

const { validateTalentProfile } = require('../../middleware/validateTalentProfile');
const { mockRes, expectValidationError, expectNextCalled } = require('../helpers');

describe('middleware/validateTalentProfile', () => {
  it('calls next() for a valid body', () => {
    expectNextCalled({
      body: {
        headline: 'Software Engineer',
        bio: 'I build things.',
        availability: 'immediately',
        visibility: 'public',
        skills: [{ level: 'beginner' }],
        openTo: ['internship', 'fulltime'],
        socialLinks: { linkedin: 'https://linkedin.com/in/test' },
      },
    }, validateTalentProfile);
  });

  it('calls next() for an empty body (all fields optional)', () => {
    expectNextCalled({ body: {} }, validateTalentProfile);
  });

  it('rejects headline longer than 120 characters', () => {
    expectValidationError({ body: { headline: 'x'.repeat(121) } }, validateTalentProfile, 'headline');
  });

  it('allows headline of exactly 120 characters', () => {
    expectNextCalled({ body: { headline: 'x'.repeat(120) } }, validateTalentProfile);
  });

  it('rejects bio longer than 1000 characters', () => {
    expectValidationError({ body: { bio: 'a'.repeat(1001) } }, validateTalentProfile, 'bio');
  });

  it('rejects invalid availability value', () => {
    expectValidationError({ body: { availability: 'next-year' } }, validateTalentProfile, 'availability');
  });

  it.each(['immediately', '2weeks', '1month', 'not-available'])('accepts availability=%s', (val) => {
    expectNextCalled({ body: { availability: val } }, validateTalentProfile);
  });

  it('rejects invalid visibility value', () => {
    expectValidationError({ body: { visibility: 'hidden' } }, validateTalentProfile, 'visibility');
  });

  it.each(['public', 'network', 'private'])('accepts visibility=%s', (val) => {
    expectNextCalled({ body: { visibility: val } }, validateTalentProfile);
  });

  it('rejects invalid skill level', () => {
    expectValidationError({ body: { skills: [{ level: 'pro' }] } }, validateTalentProfile, 'skills[0].level');
  });

  it.each(['beginner', 'intermediate', 'advanced', 'expert'])('accepts skill level=%s', (level) => {
    expectNextCalled({ body: { skills: [{ level }] } }, validateTalentProfile);
  });

  it('rejects invalid openTo value', () => {
    expectValidationError({ body: { openTo: ['contract'] } }, validateTalentProfile, 'openTo[0]');
  });

  it('accepts all valid openTo values', () => {
    const valid = ['internship', 'fulltime', 'parttime', 'freelance', 'mentorship', 'investment'];
    expectNextCalled({ body: { openTo: valid } }, validateTalentProfile);
  });

  it('rejects invalid social link URLs', () => {
    expectValidationError(
      { body: { socialLinks: { linkedin: 'not-a-url' } } },
      validateTalentProfile,
      'socialLinks.linkedin'
    );
  });

  it('accepts valid social link URLs', () => {
    expectNextCalled({
      body: {
        socialLinks: {
          linkedin: 'https://linkedin.com/in/user',
          github: 'https://github.com/user',
          twitter: 'http://twitter.com/user',
          website: 'https://example.com',
        },
      },
    }, validateTalentProfile);
  });

  it('skips URL validation for empty social link fields', () => {
    expectNextCalled({ body: { socialLinks: { linkedin: '', github: null } } }, validateTalentProfile);
  });

  it('collects multiple errors at once', () => {
    const body = expectValidationError({
      body: {
        headline: 'x'.repeat(121),
        bio: 'b'.repeat(1001),
        availability: 'wrong',
        visibility: 'wrong',
      },
    }, validateTalentProfile);
    expect(body.errors.length).toBeGreaterThanOrEqual(4);
  });
});
