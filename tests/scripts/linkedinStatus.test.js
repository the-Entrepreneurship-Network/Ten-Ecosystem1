'use strict';

/**
 * The check that answers "why is the company page still empty?".
 *
 * The agent behaves identically with and without credentials right up to the
 * last step: it builds the post, renders the poster, saves the row and logs
 * what looks like success. Only `publish()` knows the difference, and it says
 * so by returning `dryRun` rather than by failing. That is correct — a server
 * with no token is a supported configuration, not a fault — but it meant the
 * difference between "posting" and "not posting" was invisible from the
 * outside.
 *
 * So the invariant these tests protect is not the script's wording. It is that
 * the script's verdict and `publish()`'s behaviour can never disagree: if the
 * script says LIVE, a publish must not be a dry run, and vice versa. A
 * diagnostic that can lie about this is worse than none, because it is the
 * thing somebody reaches for when they already suspect something is wrong.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'linkedin-status.js');
const LINKEDIN_ENV = [
  'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORG_ID',
  'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI',
  'LINKEDIN_AUTOPILOT_DISABLED', 'LINKEDIN_SCHEDULER_DISABLED',
];

/** Run the script with a clean LinkedIn environment plus whatever is given. */
function run(env) {
  const clean = Object.assign({}, process.env);
  LINKEDIN_ENV.forEach((k) => { delete clean[k]; });
  /* The script loads .env, which on a developer's machine may carry real
     credentials; DOTENV_CONFIG_PATH points it at nothing so the test sees only
     what it was handed. */
  clean.DOTENV_CONFIG_PATH = path.join(__dirname, 'no-such.env');

  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      env: Object.assign(clean, env || {}),
      encoding: 'utf8',
      timeout: 30000,
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, stdout: String(e.stdout || '') };
  }
}

describe('scripts/linkedin-status.js', () => {
  it('says DRY RUN and exits non-zero when nothing is configured', () => {
    const r = run({});
    expect(r.stdout).toMatch(/DRY RUN/);
    expect(r.stdout).toMatch(/NOT sending/i);
    /* Non-zero so it can be a deploy gate rather than something a person has
       to remember to read. */
    expect(r.code).toBe(1);
  });

  it('names both routes to making it live, and the LinkedIn-side prerequisite', () => {
    const out = run({}).stdout;
    expect(out).toContain('LINKEDIN_ACCESS_TOKEN');
    expect(out).toContain('LINKEDIN_ORG_ID');
    expect(out).toContain('/api/v2/linkedin/oauth/start');
    /* The real blocker is usually not the environment variable but LinkedIn's
       own approval, which takes days. Somebody reading this at 2am should not
       have to discover that separately. */
    expect(out).toContain('Community Management API');
    expect(out).toContain('w_organization_social');
  });

  it('says LIVE and exits zero once a token and a page are set', () => {
    const r = run({ LINKEDIN_ACCESS_TOKEN: 'test-token', LINKEDIN_ORG_ID: '12345' });
    expect(r.stdout).toMatch(/LIVE/);
    expect(r.stdout).not.toMatch(/DRY RUN/);
    expect(r.code).toBe(0);
  });

  /*
   * The one that matters. A token with no page to post as is the configuration
   * that looks set up and is not: publish() refuses it, so the script must too.
   */
  it('does not claim LIVE for a token with no page', () => {
    const r = run({ LINKEDIN_ACCESS_TOKEN: 'test-token' });
    expect(r.stdout).toMatch(/DRY RUN/);
    expect(r.code).toBe(1);
  });

  it('reports the kill switches rather than ignoring them', () => {
    const out = run({
      LINKEDIN_ACCESS_TOKEN: 'test-token',
      LINKEDIN_ORG_ID: '12345',
      LINKEDIN_AUTOPILOT_DISABLED: '1',
    }).stdout;
    expect(out).toContain('LINKEDIN_AUTOPILOT_DISABLED is set');
  });
});

describe('the verdict matches what publish() will actually do', () => {
  const REAL = {};

  beforeEach(() => {
    jest.resetModules();
    LINKEDIN_ENV.forEach((k) => { REAL[k] = process.env[k]; delete process.env[k]; });
  });

  afterEach(() => {
    LINKEDIN_ENV.forEach((k) => {
      if (REAL[k] === undefined) delete process.env[k];
      else process.env[k] = REAL[k];
    });
  });

  it('is a dry run exactly when the config says it is not configured', async () => {
    const client = require('../../services/v2/linkedin/linkedinClient');
    expect(client.config().configured).toBe(false);
    const res = await client.publish({ text: 'hello' });
    expect(res.dryRun).toBe(true);
    expect(res.ok).toBe(false);
    /* And it does not pretend: no post URN comes back from a dry run. */
    expect(res.postUrn).toBe('');
  });

  it('a token without an org id is still not configured', () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'test-token';
    jest.resetModules();
    const client = require('../../services/v2/linkedin/linkedinClient');
    expect(client.config().configured).toBe(false);
    expect(client.config().warning).toMatch(/LINKEDIN_ORG_ID/);
  });

  it('a token with an org id is configured', () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'test-token';
    process.env.LINKEDIN_ORG_ID = '12345';
    jest.resetModules();
    const client = require('../../services/v2/linkedin/linkedinClient');
    const cfg = client.config();
    expect(cfg.configured).toBe(true);
    expect(cfg.orgUrn).toBe('urn:li:organization:12345');
  });
});
