'use strict';

/**
 * @jest-environment node
 *
 * utils/claude.js: what it sends to Anthropic (the official SDK, the chosen
 * model, structured JSON output, low effort, the server-side fallback on
 * Opus and Sonnet), and that a decline or a cut-off answer throws so the
 * Interview Room falls back to Gemini.
 */

const mockCalls = [];
let mockReply = null;
jest.mock('@anthropic-ai/sdk', () => {
    class Anthropic {
        constructor(opts) {
            mockCalls.push({ ctor: opts });
            this.messages = { create: async (p) => { mockCalls.push({ path: 'messages', p }); return mockReply; } };
            this.beta = { messages: { create: async (p) => { mockCalls.push({ path: 'beta', p }); return mockReply; } } };
        }
    }
    return { default: Anthropic };
});

const claude = require('../../utils/claude');
const SCHEMA = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false };
const reply = (text, extra) => Object.assign({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] }, extra || {});

beforeEach(() => { mockCalls.length = 0; claude._reset(); process.env.ANTHROPIC_API_KEY = 'test-key'; });
afterAll(() => { delete process.env.ANTHROPIC_API_KEY; });

it('is ready only with ANTHROPIC_API_KEY', () => {
    expect(claude.ready()).toBe(true);
    process.env.ANTHROPIC_API_KEY = '  ';
    expect(claude.ready()).toBe(false);
});

it('asks Opus through the beta endpoint with the server-side fallback, structured output and low effort, and parses the JSON', async () => {
    mockReply = reply('{"question":"What breaks if the server is slow?"}');
    expect(await claude.ask('the prompt', SCHEMA, 'claude-opus-5-5')).toEqual({ question: 'What breaks if the server is slow?' });
    expect(mockCalls[0].ctor).toEqual({ timeout: 60000, maxRetries: 1 });
    expect(mockCalls[1]).toEqual({ path: 'beta', p: {
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        model: 'claude-opus-5-5', max_tokens: 16000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: 'the prompt' }]
    } });
});

it('asks Haiku on the plain endpoint, which has no server-side fallback', async () => {
    mockReply = reply('{"question":"q"}');
    await claude.ask('p', SCHEMA, 'claude-haiku-5-5');
    expect(mockCalls[1].path).toBe('messages');
    expect(mockCalls[1].p).not.toHaveProperty('fallbacks');
    expect(mockCalls[1].p.model).toBe('claude-haiku-5-5');
});

it('throws on a decline, a cut-off answer, broken JSON or an unknown model', async () => {
    mockReply = reply('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } });
    await expect(claude.ask('p', SCHEMA, 'claude-sonnet-5-5')).rejects.toThrow('Claude declined (cyber)');
    mockReply = reply('{"question":', { stop_reason: 'max_tokens' });
    await expect(claude.ask('p', SCHEMA, 'claude-sonnet-5-5')).rejects.toThrow('ran out of room');
    mockReply = reply('not json');
    await expect(claude.ask('p', SCHEMA, 'claude-sonnet-5-5')).rejects.toThrow();
    await expect(claude.ask('p', SCHEMA, 'gpt-5')).rejects.toThrow('Unknown Claude model');
});
