'use strict';

/**
 * The one place in the LinkedIn agent that talks to a language model.
 *
 * Everything else in this feature is deterministic on purpose: the guard, the
 * composer, the poster and the client all produce the same output from the
 * same input, on any machine, with no key and no network. This module is the
 * single exception, and it is built so that its absence changes nothing. If
 * there is no key, if the key is wrong, if the provider is down, if it returns
 * prose where JSON was asked for — every one of those paths returns `null`,
 * and the caller falls back to the deterministic writer.
 *
 * That shape is deliberate. A staff member drafting an internship post at
 * eleven at night should not see the feature break because somebody's billing
 * lapsed; they should see a slightly plainer post. `generateJSON` therefore
 * never throws and never rejects.
 *
 * Two providers, in a fixed order. OPENAI_API_KEY wins because it is the one
 * documented for this feature; GEMINI_API_KEY is next because the rest of the
 * app already carries @google/genai for the learning exam, so a server that
 * has a Gemini key can use it without installing anything.
 *
 * Nothing here ever logs a key, echoes one in an error, or returns one. The
 * error paths print the provider name and the failure, never the credential.
 */

const { httpFetch } = require('../httpFetch');

/** Read at call time, not at require time — a test (or a restart that loads a
    new .env) must be able to change the answer without reloading the module. */
function openaiKey() {
  return process.env.OPENAI_API_KEY || '';
}

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY || '';
}

/**
 * Which provider this server can use, or null when it can use none.
 *
 * The route reports this on /status so the connection card can say "drafting
 * with OpenAI" or "using the built-in writer" — a person looking at an
 * unusually plain post deserves to know which of the two wrote it.
 */
function provider() {
  if (openaiKey()) return 'openai';
  if (geminiKey()) return 'gemini';
  return null;
}

/** The model for each provider. Overridable, because the good cheap model of
    the month changes faster than this file will. */
function openaiModel() {
  return process.env.LINKEDIN_AGENT_MODEL || 'gpt-4o-mini';
}

function geminiModel() {
  return process.env.LINKEDIN_AGENT_GEMINI_MODEL || 'gemini-2.0-flash';
}

/**
 * Parse a model's answer into an object, or give up.
 *
 * Models asked for JSON still wrap it in ```json fences, prefix it with "Here
 * is the JSON:", or add a trailing sentence. Rather than trust the format, we
 * strip the common wrappers and, failing that, take the outermost {...} in the
 * string. Anything that still will not parse is not worth guessing at.
 */
function parseJson(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    /* Fall through to the brace scan. */
  }

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** OpenAI's chat completions, in JSON mode. */
async function viaOpenAI({ system, user, maxTokens, timeoutMs }) {
  const res = await httpFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openaiModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      /* JSON mode. The model still needs the word "JSON" in the prompt for
         this to be accepted, which the system prompt always carries. */
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    timeoutMs,
  });

  if (!res || !res.ok) {
    /* The status is useful; the body is not worth printing, because a 401 body
       from OpenAI quotes the key prefix back at you. */
    console.error(`[linkedin-agent] openai refused the draft (HTTP ${res ? res.status : 'no response'})`);
    return null;
  }

  const body = await res.json();
  const content = body
    && body.choices
    && body.choices[0]
    && body.choices[0].message
    && body.choices[0].message.content;
  return parseJson(content);
}

/**
 * Gemini, through the SDK the app already depends on.
 *
 * Required lazily: @google/genai is a real dependency of this project, but a
 * server with no Gemini key should never pay to load it, and a broken install
 * of it must not take the LinkedIn agent down at require time.
 */
async function viaGemini({ system, user, maxTokens, timeoutMs }) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: geminiKey() });

  /* The SDK has no timeout option, so the race is ours to run. A hung request
     must not hold a staff member's chat open forever. */
  const call = ai.models.generateContent({
    model: geminiModel(),
    contents: `${system}\n\n${user}`,
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
      temperature: 0.7,
    },
  });

  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    /* Do not hold the process open for this timer alone — the scheduler cron
       and the test runner both notice. */
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  try {
    const res = await Promise.race([call, timeout]);
    if (!res) {
      console.error('[linkedin-agent] gemini did not answer in time');
      return null;
    }
    return parseJson(res.text);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ask the configured model for one JSON object.
 *
 * Returns the parsed object, or `null` for every failure there is: no
 * provider, a network error, a non-2xx, an unparseable body, a timeout. The
 * caller is written to treat null as "use the deterministic path", so a
 * failure here is a quality difference, never an outage.
 *
 * @param {object} args
 * @param {string} args.system     the instruction the model works under
 * @param {string} args.user       the content to work on
 * @param {string} [args.schemaHint] a description of the JSON shape wanted,
 *                                   appended to the system prompt
 * @returns {Promise<object|null>}
 */
async function generateJSON({ system, user, schemaHint, maxTokens = 800, timeoutMs = 15000 } = {}) {
  const which = provider();
  if (!which) return null;
  if (!system || !user) return null;

  /* The word "JSON" must appear for OpenAI's JSON mode, and the shape has to
     be stated for either model to hit it reliably. */
  const fullSystem = schemaHint
    ? `${system}\n\nReturn JSON only, in exactly this shape:\n${schemaHint}`
    : `${system}\n\nReturn JSON only.`;

  try {
    if (which === 'openai') {
      return await viaOpenAI({ system: fullSystem, user, maxTokens, timeoutMs });
    }
    return await viaGemini({ system: fullSystem, user, maxTokens, timeoutMs });
  } catch (e) {
    /* e.message from an HTTP client can contain the request URL but not the
       Authorization header, so this is safe to print — and without it, a
       misconfigured server looks identical to one with no key at all. */
    console.error(`[linkedin-agent] ${which} draft failed:`, e && e.message ? e.message : e);
    return null;
  }
}

module.exports = { provider, generateJSON };
