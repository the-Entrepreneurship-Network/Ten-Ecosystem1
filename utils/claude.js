'use strict';

/**
 * Claude, through Anthropic's API, for the Interview Room when the admin
 * portal picks it (services/aiMeeting.js). ask() mirrors utils/gemini.js:
 * a prompt and a JSON schema in, the parsed object out.
 *
 * Needs ANTHROPIC_API_KEY in .env. Paid per token, unlike Gemini's free tier:
 * the admin portal shows the cost per interview of each model and caps the
 * Claude interviews a month.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

let client = null;
const ready = () => !!String(process.env.ANTHROPIC_API_KEY || '').trim();

function getClient() {
    if (!client) {
        const Client = Anthropic.default || Anthropic;
        // A student is waiting on each answer: one retry, then the caller falls back to Gemini.
        client = new Client({ timeout: 60 * 1000, maxRetries: 1 });
    }
    return client;
}

/**
 * One request; resolves to the object the schema describes. Throws when
 * Claude declines, runs out of room, or returns something that is not JSON,
 * so the caller can fall back.
 */
async function ask(prompt, schema, model) {
    if (!MODELS.includes(model)) throw new Error('Unknown Claude model: ' + model);
    const params = {
        model,
        max_tokens: 16000,
        // Low effort: a short question or a mark, wanted in seconds.
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }]
    };
    const c = getClient();
    // Opus and Sonnet: if a safety check declines, the API retries on a model
    // that can answer. Haiku has no server-side fallback; the caller falls back to Gemini.
    const res = model === 'claude-haiku-5-5'
        ? await c.messages.create(params)
        : await c.beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, params));
    if (res.stop_reason === 'refusal') throw new Error('Claude declined (' + ((res.stop_details && res.stop_details.category) || 'no category') + ')');
    if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of room');
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
}

module.exports = { ask, ready, MODELS, _reset: () => { client = null; } };
