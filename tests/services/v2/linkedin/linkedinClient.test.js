'use strict';

/*
 * The client is tested with no token, no database and no network — which is
 * also exactly how it runs on this deployment, so these tests exercise the
 * real default path rather than a special case.
 *
 * httpFetch and the connection model are mocked through indirection
 * (`mockFetch`, `mockFindOne`) rather than returned directly from the factory,
 * so that jest.resetModules() can hand back a fresh copy of the client — with
 * its connection cache empty — while the same mock functions keep working.
 */

const mockFetch = jest.fn();
const mockFindOne = jest.fn();
const mockDb = { readyState: 0 };

jest.mock('../../../../services/v2/httpFetch', () => ({
  httpFetch: (...args) => mockFetch(...args),
}));

jest.mock('../../../../models/LinkedInConnection', () => ({
  get db() { return mockDb; },
  findOne: (...args) => mockFindOne(...args),
}));

/** A minimal fetch-shaped response: text() once, headers.get() lower-cased. */
function res(status, body, headers) {
  const h = {};
  for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = headers[k];
  const raw = typeof body === 'string' ? body : (body === undefined ? '' : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (h[String(name).toLowerCase()] === undefined ? null : h[String(name).toLowerCase()]) },
    text: async () => raw,
    json: async () => JSON.parse(raw),
  };
}

const ENV_KEYS = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORG_ID', 'LINKEDIN_API_VERSION'];
const saved = {};

function load() {
  jest.resetModules();
  return require('../../../../services/v2/linkedin/linkedinClient');
}

/* No real waiting anywhere: a poll loop that slept for ten seconds would make
   this file the slowest in the suite and leave timers behind on failure. */
const noSleep = jest.fn(async () => {});

beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  mockFetch.mockReset();
  mockFindOne.mockReset();
  noSleep.mockClear();
  mockDb.readyState = 0;
});

describe('escapeCommentary', () => {
  const client = require('../../../../services/v2/linkedin/linkedinClient');

  it('escapes every reserved character', () => {
    for (const ch of ['|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '\\', '*', '_', '~']) {
      expect(client.escapeCommentary(`a${ch}b`)).toBe(`a\\${ch}b`);
    }
  });

  it('escapes a backslash exactly once, not once per pass', () => {
    expect(client.escapeCommentary('C:\\path (x)')).toBe('C:\\\\path \\(x\\)');
  });

  it('keeps a hashtag intact but escapes a lone #', () => {
    expect(client.escapeCommentary('We are hiring #Python interns')).toBe('We are hiring #Python interns');
    expect(client.escapeCommentary('flat # 3')).toBe('flat \\# 3');
    expect(client.escapeCommentary('#1 in India')).toBe('#1 in India');
  });

  it('escapes the @ in an e-mail address', () => {
    expect(client.escapeCommentary('write to hr@ten.com')).toBe('write to hr\\@ten.com');
  });

  it('leaves ordinary text and newlines alone', () => {
    expect(client.escapeCommentary('Line one.\n\nLine two, 5,000/month.')).toBe('Line one.\n\nLine two, 5,000/month.');
    expect(client.escapeCommentary(null)).toBe('');
  });
});

describe('headers', () => {
  it('carries the bearer token, the Rest.li version and the dated API version', () => {
    const client = load();
    process.env.LINKEDIN_API_VERSION = '202610';
    expect(client.headers('tok')).toEqual({
      Authorization: 'Bearer tok',
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': '202610',
      'Content-Type': 'application/json',
    });
  });
});

describe('config', () => {
  it('reports nothing configured on a bare server and never returns a token', () => {
    const client = load();
    const cfg = client.config();
    expect(cfg.configured).toBe(false);
    expect(cfg.source).toBe('none');
    expect(cfg.apiVersion).toBe('202609');
    expect(Object.keys(cfg)).not.toContain('token');
    expect(Object.keys(cfg)).not.toContain('accessToken');
    expect(JSON.stringify(cfg)).not.toMatch(/token/i);
  });

  it('accepts a numeric LINKEDIN_ORG_ID or a full urn', () => {
    const client = load();
    process.env.LINKEDIN_ACCESS_TOKEN = 'env-token';
    process.env.LINKEDIN_ORG_ID = '12345';
    expect(client.config()).toMatchObject({ configured: true, source: 'env', orgUrn: 'urn:li:organization:12345' });
    process.env.LINKEDIN_ORG_ID = 'urn:li:organization:999';
    expect(client.config().orgUrn).toBe('urn:li:organization:999');
  });

  it('warns when a token is set with no page to post as', () => {
    const client = load();
    process.env.LINKEDIN_ACCESS_TOKEN = 'env-token';
    const cfg = client.config();
    expect(cfg.configured).toBe(false);
    expect(cfg.warning).toMatch(/LINKEDIN_ORG_ID/);
  });

  it('reads the stored connection and warns when the token is nearly dead', async () => {
    const client = load();
    mockDb.readyState = 1;
    /*
     * Deliberately just under three days, not exactly three.
     *
     * daysUntil floors the remainder, so a fixture set to exactly +3 days
     * reports 3 or 2 depending on how many milliseconds pass between building
     * the date and reading it back — the test passed or failed according to
     * how busy the machine was. Half a day of slack makes the answer 2 every
     * time, and 2 is the number the warning text is asserted against.
     */
    const expiresAt = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000);
    mockFindOne.mockReturnValue({
      select: () => ({ lean: async () => ({ accessToken: 'db-token', orgUrn: 'urn:li:organization:77', orgName: 'TEN', expiresAt }) }),
    });
    mockFetch.mockResolvedValue(res(200, { elements: [] }));

    /* An asynchronous call warms the cache that the synchronous config() reads. */
    await client.shareStatistics({ orgUrn: 'urn:li:organization:77' });
    const cfg = client.config();
    expect(cfg).toMatchObject({ configured: true, source: 'db', orgUrn: 'urn:li:organization:77', orgName: 'TEN', expiresInDays: 2 });
    expect(cfg.warning).toMatch(/expires in 2 days/);
    expect(JSON.stringify(cfg)).not.toMatch(/db-token/);
  });

  it('does not touch mongo while the connection is down', () => {
    const client = load();
    mockDb.readyState = 0;
    client.config();
    expect(mockFindOne).not.toHaveBeenCalled();
  });
});

describe('publish — dry run', () => {
  it('returns the exact payload that would have been sent, with no token in it', async () => {
    const client = load();
    const out = await client.publish({ text: 'Hiring Python interns (remote)\n\n#Hiring', png: Buffer.from('12345'), altText: 'poster' });

    expect(out.ok).toBe(false);
    expect(out.dryRun).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(out.payload).toMatchObject({
      visibility: 'PUBLIC',
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      charCount: 'Hiring Python interns (remote)\n\n#Hiring'.length,
      imageBytes: 5,
    });
    expect(out.payload.commentary).toBe('Hiring Python interns \\(remote\\)\n\n#Hiring');
    expect(out.payload.content.media.altText).toBe('poster');
  });

  it('omits content when there is no poster', async () => {
    const client = load();
    const out = await client.publish({ text: 'Plain text post' });
    expect(out.dryRun).toBe(true);
    expect(out.payload.content).toBeUndefined();
    expect(out.payload.imageBytes).toBe(0);
  });

  it('caps the text at 3000 characters', async () => {
    const client = load();
    const out = await client.publish({ text: 'x'.repeat(3500) });
    expect(out.payload.charCount).toBe(3000);
  });
});

describe('publish — connected', () => {
  beforeEach(() => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'live-token';
    process.env.LINKEDIN_ORG_ID = '42';
  });

  it('uploads the image, waits for AVAILABLE, posts, and reads x-restli-id', async () => {
    const client = load();
    mockFetch
      .mockResolvedValueOnce(res(200, { value: { uploadUrl: 'https://upload.example/abc', image: 'urn:li:image:C1' } }))
      .mockResolvedValueOnce(res(201, ''))
      .mockResolvedValueOnce(res(200, { status: 'PROCESSING' }))
      .mockResolvedValueOnce(res(200, { status: 'AVAILABLE' }))
      .mockResolvedValueOnce(res(201, '', { 'x-restli-id': 'urn:li:share:9988' }));

    const png = Buffer.from('PNGBYTES');
    const out = await client.publish({ text: 'Placement story', png, altText: 'Priya placed', sleep: noSleep });

    expect(out).toMatchObject({
      ok: true,
      dryRun: false,
      postUrn: 'urn:li:share:9988',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:9988',
      imageUrn: 'urn:li:image:C1',
    });

    const [initUrl, initOpts] = mockFetch.mock.calls[0];
    expect(initUrl).toBe('https://api.linkedin.com/rest/images?action=initializeUpload');
    expect(JSON.parse(initOpts.body)).toEqual({ initializeUploadRequest: { owner: 'urn:li:organization:42' } });

    const [putUrl, putOpts] = mockFetch.mock.calls[1];
    expect(putUrl).toBe('https://upload.example/abc');
    expect(putOpts.method).toBe('PUT');
    expect(putOpts.headers['Content-Type']).toBe('image/png');
    expect(putOpts.body).toBe(png);

    expect(mockFetch.mock.calls[2][0]).toBe(`https://api.linkedin.com/rest/images/${encodeURIComponent('urn:li:image:C1')}`);

    const [postUrl, postOpts] = mockFetch.mock.calls[4];
    expect(postUrl).toBe('https://api.linkedin.com/rest/posts');
    expect(JSON.parse(postOpts.body)).toEqual({
      author: 'urn:li:organization:42',
      commentary: 'Placement story',
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      content: { media: { id: 'urn:li:image:C1', altText: 'Priya placed' } },
    });
  });

  it('accepts x-linkedin-id as a fallback for the post urn', async () => {
    const client = load();
    mockFetch.mockResolvedValueOnce(res(201, '', { 'x-linkedin-id': 'urn:li:share:1' }));
    const out = await client.publish({ text: 'Text only', sleep: noSleep });
    expect(out.postUrn).toBe('urn:li:share:1');
  });

  it('posts text-only when the image never becomes available', async () => {
    const client = load();
    mockFetch.mockImplementation(async (url) => {
      if (String(url).includes('action=initializeUpload')) return res(200, { value: { uploadUrl: 'https://upload.example/x', image: 'urn:li:image:SLOW' } });
      if (String(url) === 'https://upload.example/x') return res(201, '');
      if (String(url).includes('/rest/images/')) return res(200, { status: 'PROCESSING' });
      return res(201, '', { 'x-restli-id': 'urn:li:share:7' });
    });

    const out = await client.publish({ text: 'Opening', png: Buffer.from('bytes'), sleep: noSleep });

    expect(out.ok).toBe(true);
    expect(out.imageSkipped).toBe('processing timeout');
    expect(out.imageUrn).toBe('');
    const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
    expect(body.content).toBeUndefined();
    /* Ten polls, nine waits between them, and not one real second. */
    expect(noSleep).toHaveBeenCalledTimes(9);
  });

  it('retries once on 429 and honours Retry-After, capped', async () => {
    const client = load();
    mockFetch
      .mockResolvedValueOnce(res(429, { message: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(201, '', { 'x-restli-id': 'urn:li:share:2' }));

    const out = await client.publish({ text: 'Opening', sleep: noSleep });

    expect(out.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledWith(2000);
  });

  it('retries a 5xx once and reports the failure when it happens twice', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(503, { message: 'upstream down' }));
    const out = await client.publish({ text: 'Opening', sleep: noSleep });
    expect(out.ok).toBe(false);
    expect(out.dryRun).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(out.error).toMatch(/upstream down/);
  });

  it('does not retry a 401 and says the token was rejected, without echoing it', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(401, { message: 'Invalid access token' }));
    const out = await client.publish({ text: 'Opening', sleep: noSleep });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(out.error).toBe('token rejected (expired or revoked) — reconnect LinkedIn');
    expect(out.error).not.toMatch(/live-token/);
  });

  it('explains a 403 as a missing page role', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(403, { message: 'ACCESS_DENIED' }));
    const out = await client.publish({ text: 'Opening', sleep: noSleep });
    expect(out.code).toBe('access_denied');
    expect(out.error).toMatch(/administrator of the page/i);
  });

  it('never throws when the network does', async () => {
    const client = load();
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));
    const out = await client.publish({ text: 'Opening', sleep: noSleep });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ECONNRESET/);
  });
});

describe('organisations and statistics', () => {
  beforeEach(() => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'live-token';
    process.env.LINKEDIN_ORG_ID = '42';
  });

  it('resolves the page by vanity name', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(200, { elements: [{ id: 42, localizedName: 'The Entrepreneurship Network', vanityName: 'the-entrepreneurship-network' }] }));
    const org = await client.resolveOrganization({ token: 't', vanityName: 'the-entrepreneurship-network' });
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=the-entrepreneurship-network');
    expect(org).toEqual({ orgUrn: 'urn:li:organization:42', name: 'The Entrepreneurship Network', vanity: 'the-entrepreneurship-network' });
  });

  it('returns null rather than throwing when the vanity lookup fails', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(403, { message: 'no' }));
    expect(await client.resolveOrganization({ token: 't', vanityName: 'x' })).toBeNull();
  });

  it('lists administered organisations', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(200, { elements: [{ organization: 'urn:li:organization:42', role: 'ADMINISTRATOR', state: 'APPROVED' }] }));
    const orgs = await client.listAdministeredOrganizations({ token: 't' });
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED');
    expect(orgs).toEqual([{ orgUrn: 'urn:li:organization:42', role: 'ADMINISTRATOR', state: 'APPROVED' }]);
  });

  it('fetches share statistics for the page and returns null on failure', async () => {
    const client = load();
    mockFetch.mockResolvedValueOnce(res(200, { elements: [{ totalShareStatistics: { impressionCount: 10 } }] }));
    const stats = await client.shareStatistics({ orgUrn: 'urn:li:organization:42' });
    expect(mockFetch.mock.calls[0][0]).toBe(`https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent('urn:li:organization:42')}`);
    expect(stats.elements[0].totalShareStatistics.impressionCount).toBe(10);

    mockFetch.mockResolvedValueOnce(res(500, 'boom'));
    expect(await client.shareStatistics({ orgUrn: 'urn:li:organization:42' })).toBeNull();
  });

  it('has no statistics to fetch when nothing is connected', async () => {
    const client = load();
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    expect(await client.shareStatistics({ orgUrn: 'urn:li:organization:42' })).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('OAuth', () => {
  it('builds the authorization URL with the default scopes', () => {
    const client = load();
    const url = client.oauthUrl({ clientId: 'cid', redirectUri: 'https://ten.test/cb', state: 'abc' });
    expect(url).toBe(
      'https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=cid'
      + '&redirect_uri=https%3A%2F%2Ften.test%2Fcb&state=abc'
      + '&scope=w_organization_social%20r_organization_social%20rw_organization_admin',
    );
    expect(client.DEFAULT_SCOPES).toEqual(['w_organization_social', 'r_organization_social', 'rw_organization_admin']);
  });

  it('exchanges the code as form-urlencoded and returns the token fields', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(200, { access_token: 'AQX', expires_in: 5184000, scope: 'w_organization_social' }));
    const tok = await client.exchangeCode({ code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://ten.test/cb' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(opts.body).toContain('grant_type=authorization_code');
    expect(opts.body).toContain('code=c');
    expect(tok).toEqual({ accessToken: 'AQX', expiresIn: 5184000, refreshToken: '', refreshTokenExpiresIn: 0, scope: 'w_organization_social' });
  });

  it('returns null when LinkedIn refuses the exchange, without echoing the secret', async () => {
    const client = load();
    mockFetch.mockResolvedValue(res(400, { error: 'invalid_client', error_description: 'client_secret sec is wrong' }));
    expect(await client.exchangeCode({ code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://ten.test/cb' })).toBeNull();
    expect(await client.exchangeCode({ code: '', clientId: 'cid', clientSecret: 'sec', redirectUri: 'x' })).toBeNull();
  });
});
