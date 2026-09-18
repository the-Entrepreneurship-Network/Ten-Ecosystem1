'use strict';

/*
 * The model wrapper's contract is almost entirely about failure.
 *
 * Everything downstream of it treats `null` as "use the deterministic writer",
 * so the property worth testing hardest is that null is what comes back from
 * every unhappy path there is — no key, a refused request, prose instead of
 * JSON, a thrown error. If any of those escaped as an exception, a staff
 * member drafting a post would see the whole feature fail because of a
 * lapsed API key.
 *
 * The network is mocked throughout. These tests must pass on a machine with
 * no keys and no internet, which is also how CI runs them.
 */

jest.mock('../../../../services/v2/httpFetch', () => ({ httpFetch: jest.fn() }));

const { httpFetch } = require('../../../../services/v2/httpFetch');
const llm = require('../../../../services/v2/linkedin/llm');

const KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_KEY', 'LINKEDIN_AGENT_MODEL'];
const saved = {};

beforeEach(() => {
  httpFetch.mockReset();
  KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
});

afterEach(() => {
  KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

/** A fetch-shaped answer, the small slice httpFetch exposes. */
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const okOpenAI = (content) => reply(200, { choices: [{ message: { content } }] });

describe('which provider this server can use', () => {
  it('is nobody when no key is set', () => {
    expect(llm.provider()).toBeNull();
  });

  it('is OpenAI when its key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(llm.provider()).toBe('openai');
  });

  it('is Gemini when only a Google key is set', () => {
    process.env.GEMINI_API_KEY = 'g-test';
    expect(llm.provider()).toBe('gemini');
  });

  it('prefers OpenAI when both are set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.GEMINI_API_KEY = 'g-test';
    expect(llm.provider()).toBe('openai');
  });

  it('is read fresh every time, not captured at require', () => {
    expect(llm.provider()).toBeNull();
    process.env.OPENAI_API_KEY = 'sk-late';
    expect(llm.provider()).toBe('openai');
  });
});

describe('asking for JSON', () => {
  it('returns null without a provider, and never calls out', async () => {
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toBeNull();
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('sends the OpenAI request the documented way', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(okOpenAI('{"hook":"A hook"}'));

    const out = await llm.generateJSON({ system: 'write a post', user: 'the draft', schemaHint: '{"hook":"string"}' });
    expect(out).toEqual({ hook: 'A hook' });

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    /* OpenAI's JSON mode refuses a request whose prompt never says "JSON". */
    expect(body.messages[0].content).toMatch(/JSON/i);
  });

  it('honours a model override', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.LINKEDIN_AGENT_MODEL = 'gpt-4.1-mini';
    httpFetch.mockResolvedValue(okOpenAI('{"a":1}'));
    await llm.generateJSON({ system: 's', user: 'u' });
    expect(JSON.parse(httpFetch.mock.calls[0][1].body).model).toBe('gpt-4.1-mini');
  });

  it('digs the JSON out of a fenced answer', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(okOpenAI('```json\n{"hook":"Fenced"}\n```'));
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toEqual({ hook: 'Fenced' });
  });

  it('digs it out of a chatty answer', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(okOpenAI('Sure! Here you go: {"hook":"Chatty"} — hope that helps.'));
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toEqual({ hook: 'Chatty' });
  });

  it('returns null when the answer is not JSON at all', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(okOpenAI('I cannot help with that request.'));
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toBeNull();
  });

  it('returns null when the answer is a JSON array rather than an object', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    httpFetch.mockResolvedValue(okOpenAI('[1,2,3]'));
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toBeNull();
  });

  it('returns null on a refusal, without throwing', async () => {
    process.env.OPENAI_API_KEY = 'sk-bad';
    httpFetch.mockResolvedValue(reply(401, { error: { message: 'Incorrect API key provided: sk-bad' } }));
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toBeNull();
  });

  it('returns null when the network is gone', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    httpFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.openai.com'));
    await expect(llm.generateJSON({ system: 's', user: 'u' })).resolves.toBeNull();
  });

  it('returns null when asked for nothing', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(llm.generateJSON({})).resolves.toBeNull();
    await expect(llm.generateJSON({ system: 's' })).resolves.toBeNull();
    expect(httpFetch).not.toHaveBeenCalled();
  });
});

describe('it never leaks the key', () => {
  it('keeps the key out of everything it logs on failure', async () => {
    process.env.OPENAI_API_KEY = 'sk-secret-value-12345';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      httpFetch.mockResolvedValue(reply(401, { error: { message: 'bad key' } }));
      await llm.generateJSON({ system: 's', user: 'u' });

      httpFetch.mockRejectedValue(new Error('boom'));
      await llm.generateJSON({ system: 's', user: 'u' });

      const printed = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(printed).not.toContain('sk-secret-value-12345');
    } finally {
      spy.mockRestore();
    }
  });
});
