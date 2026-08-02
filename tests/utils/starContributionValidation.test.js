'use strict';

const {
  OFFICIAL_STAR_PERFORMER_REPO_URL,
  isOfficialStarPerformerPullRequestUrl,
  validateStarContribution
} = require('../../utils/starContributionValidation');

describe('utils/starContributionValidation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/users/wronguser')) {
        return { ok: false, status: 404 };
      }
      if (String(url).includes('/repos/growth-eng/Ten-Ecosystem1/pulls/123')) {
        return { ok: true, status: 200 };
      }
      return { ok: true, status: 200 };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('isOfficialStarPerformerPullRequestUrl', () => {
    it('accepts a pull request URL for the official Ten-Ecosystem1 repo', () => {
      expect(isOfficialStarPerformerPullRequestUrl('https://github.com/growth-eng/Ten-Ecosystem1/pull/123')).toBe(true);
    });

    it('accepts the same URL with trailing segments and query params', () => {
      expect(isOfficialStarPerformerPullRequestUrl('https://github.com/growth-eng/Ten-Ecosystem1/pull/123/files?diff=split')).toBe(true);
    });

    it('rejects pull request URLs from a different repo', () => {
      expect(isOfficialStarPerformerPullRequestUrl('https://github.com/growth-eng/another-repo/pull/123')).toBe(false);
    });

    it('rejects non-PR URLs for the official repo', () => {
      expect(isOfficialStarPerformerPullRequestUrl('https://github.com/growth-eng/Ten-Ecosystem1/issues/123')).toBe(false);
    });
  });

  describe('validateStarContribution', () => {
    it('accepts a valid tech submission payload', async () => {
      const result = await validateStarContribution(JSON.stringify({
        track: 'tech',
        githubUsername: 'octocat',
        githubPR: 'https://github.com/growth-eng/Ten-Ecosystem1/pull/321',
        detailedDescription: 'Updated the Star Performer repository link and repo validation.'
      }));

      expect(result.valid).toBe(true);
      expect(result.contribution.githubPR).toBe('https://github.com/growth-eng/Ten-Ecosystem1/pull/321');
    });

    it('rejects tech submissions that target the wrong repo', async () => {
      const result = await validateStarContribution({
        track: 'tech',
        githubUsername: 'octocat',
        githubPR: 'https://github.com/growth-eng/another-repo/pull/321',
        detailedDescription: 'Updated the link.'
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain(OFFICIAL_STAR_PERFORMER_REPO_URL);
    });

    it('rejects tech submissions when the GitHub username does not exist', async () => {
      const result = await validateStarContribution({
        track: 'tech',
        githubUsername: 'wronguser',
        githubPR: 'https://github.com/growth-eng/Ten-Ecosystem1/pull/123',
        detailedDescription: 'Updated the link and validated the live Github user and PR existence.'
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('GitHub username could not be verified');
    });

    it('accepts a valid business submission payload', async () => {
      const result = await validateStarContribution({
        track: 'business',
        businessDomain: 'Marketing & Branding',
        businessLink: 'https://www.figma.com/file/demo',
        detailedDescription: 'Proposed a new partner-facing messaging flow for outreach.'
      });

      expect(result.valid).toBe(true);
      expect(result.contribution.businessLink).toBe('https://www.figma.com/file/demo');
    });

    it('rejects invalid JSON payloads', async () => {
      const result = await validateStarContribution('not-json');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Contribution payload must be valid JSON.');
    });
  });
});
