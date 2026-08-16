'use strict';

const {
  OFFICIAL_REPO_SLUG,
  OFFICIAL_REPO_URL,
  validateOfficialPullRequestUrl
} = require('../../config/github');

describe('config/github', () => {
  it('defaults to the official contribution repository', () => {
    expect(OFFICIAL_REPO_SLUG).toBe('the-Entrepreneurship-Network/Ten-Ecosystem1');
    expect(OFFICIAL_REPO_URL).toBe('https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/');
  });

  describe('validateOfficialPullRequestUrl', () => {
    it('accepts a well-formed pull request against the official repo', () => {
      const result = validateOfficialPullRequestUrl('https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/42');
      expect(result).toEqual({
        ok: true,
        url: 'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/42',
        prNumber: 42
      });
    });

    it('normalises what the student pasted', () => {
      expect(validateOfficialPullRequestUrl('  https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/7/files  ').url)
        .toBe('https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/7');
      expect(validateOfficialPullRequestUrl('https://github.com/THE-ENTREPRENEURSHIP-NETWORK/ten-ecosystem1/pull/7').url)
        .toBe('https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/7');
      expect(validateOfficialPullRequestUrl('https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1.git/pull/7').ok)
        .toBe(true);
    });

    // These are the payloads that made this field a stored-XSS vector: the old
    // client-side check was `startsWith('https://github.com/')`, which nothing
    // here would have caught.
    it.each([
      ['javascript: URL',        'javascript:alert(document.cookie)'],
      ['data: URL',              'data:text/html,<script>alert(1)</script>'],
      ['quote breakout',         'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/1"><script>alert(1)</script>'],
      ['host suffix look-alike', 'https://github.com.evil.tld/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/1'],
      ['userinfo trick',         'https://github.com@evil.tld/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/1'],
      ['subdomain look-alike',   'https://evil-github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/1'],
      ['plain http',             'http://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/1']
    ])('rejects %s', (_label, url) => {
      expect(validateOfficialPullRequestUrl(url).ok).toBe(false);
    });

    it.each([
      ['a different owner',  'https://github.com/someone/Ten-Ecosystem1/pull/1'],
      ['a different repo',   'https://github.com/growth-eng/some-other-repo/pull/1'],
      ['the old repo name',  'https://github.com/growth-eng/Ten-Ecosystem/pull/1']
    ])('rejects %s', (_label, url) => {
      const result = validateOfficialPullRequestUrl(url);
      expect(result.ok).toBe(false);
      expect(result.message).toContain(OFFICIAL_REPO_SLUG);
    });

    it.each([
      ['the repo root',      'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1'],
      ['an issue not a PR',  'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/issues/1'],
      ['a commit',           'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/commit/abc123'],
      ['a missing number',   'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/'],
      ['a non-numeric PR',   'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/abc'],
      ['PR zero',            'https://github.com/the-Entrepreneurship-Network/Ten-Ecosystem1/pull/0']
    ])('rejects %s', (_label, url) => {
      expect(validateOfficialPullRequestUrl(url).ok).toBe(false);
    });

    it.each([
      ['empty string', ''],
      ['whitespace', '   '],
      ['not a URL', 'my pull request'],
      ['undefined', undefined],
      ['null', null],
      ['a number', 42],
      ['an object', {}]
    ])('rejects %s with a helpful message', (_label, value) => {
      const result = validateOfficialPullRequestUrl(value);
      expect(result.ok).toBe(false);
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });

    it('rejects an absurdly long string without trying to parse it', () => {
      const result = validateOfficialPullRequestUrl('https://github.com/' + 'a'.repeat(600));
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/too long/);
    });
  });
});
