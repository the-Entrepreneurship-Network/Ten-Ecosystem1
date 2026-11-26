'use strict';

/**
 * The one Gemini client.
 *
 * This lived inside services/learnExam.js, exported as `__gemini` with a note
 * saying it was not part of the public surface. The idea agent needs the same
 * call, and copying it would have meant two retry policies, two timeouts and
 * two places to edit when Google retires a model — which they do on their own
 * schedule, and which has already taken the exam down once.
 *
 * Nothing here is new behaviour. It is the exam's client, moved, so both
 * callers share one.
 *
 * The Google SDK (@google/genai) is deliberately not used: it needs the fetch
 * API and ReadableStream as globals, which the Node this server runs on does
 * not have, so loading it threw before a request was ever made. The REST API
 * takes the same schema strings.
 */

const https = require('https');

/** Schema field types — the five uppercase strings the REST API expects. */
const Type = {
    OBJECT:  'OBJECT',
    ARRAY:   'ARRAY',
    STRING:  'STRING',
    BOOLEAN: 'BOOLEAN',
    INTEGER: 'INTEGER'
};

const GEMINI_HOST = 'generativelanguage.googleapis.com';

/**
 * Which model to ask. Read from the environment so the next retirement is a
 * config edit and a restart, not a one-word code change and a deploy.
 */
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

/**
 * The model to ask when the first one is overloaded.
 *
 * "This model is currently experiencing high demand" and minute-long stalls
 * are per model: on 2026-11-26 the exam, the help desk and the task feedback
 * all hit them in the same afternoon. A lighter model usually has room when
 * the main one does not. Set GEMINI_FALLBACK_MODEL=off for no second try.
 */
const GEMINI_FALLBACK_MODEL = () => process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest';

/** How long to wait before giving up on a stalled connection. */
const GEMINI_TIMEOUT_MS = 60000;

function apiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY || '';
}

function ready() {
    return !!apiKey();
}

/**
 * One POST to Gemini, returning the parsed JSON body.
 *
 * The API key travels in the query string, so the path must never reach an
 * error message, a log line or a thrown stack. Failures are reported by status
 * code and a short excerpt of the body, never by anything that saw the key.
 */
function post(body, model) {
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const req = https.request({
            host: GEMINI_HOST,
            path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey())}`,
            method: 'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'User-Agent':     'aistudio-build'
            }
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`Gemini returned ${res.statusCode}: ${text.slice(0, 200)}`);
                    err.status = res.statusCode;
                    return reject(err);
                }
                try {
                    resolve(JSON.parse(text));
                } catch (_) {
                    reject(new Error('Gemini sent a reply that was not JSON.'));
                }
            });
        });

        req.setTimeout(GEMINI_TIMEOUT_MS, () => {
            const err = new Error(`Gemini did not answer within ${GEMINI_TIMEOUT_MS}ms (timeout).`);
            err.timeout = true;
            req.destroy(err);
        });
        req.on('error', reject);
        req.end(payload);
    });
}

/**
 * Statuses that mean "ask again", not "you did something wrong".
 *
 * 503 is Google's own wording for high demand; 429 is the free tier's rate
 * limit, which clears in seconds. Nothing else is retried: a 400 will be bad
 * again, a 404 means the model is gone, and a timeout has already cost sixty
 * seconds.
 */
const RETRY_STATUS = [429, 503];
const RETRY_WAITS_MS = [1000, 3000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One model, with the 429/503 retries. */
async function askModel(body, model) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await post(body, model);
        } catch (err) {
            const again = RETRY_STATUS.includes(err && err.status)
                && attempt < RETRY_WAITS_MS.length;
            if (!again) throw err;
            await sleep(RETRY_WAITS_MS[attempt]);
        }
    }
}

/**
 * Ask the model for JSON matching `schema`.
 * @param {string} prompt
 * @param {object} schema a responseSchema built from `Type`
 */
async function ask(prompt, schema) {
    if (!apiKey()) throw new Error('No Gemini key on this server.');

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema:   schema
        }
    };

    let out;
    try {
        out = await askModel(body, GEMINI_MODEL());
    } catch (err) {
        // Busy or stalled: the second model gets the same question once.
        // Anything else (a 400, a 404, a dropped line) would fail there too.
        const fallback = GEMINI_FALLBACK_MODEL();
        const busy = RETRY_STATUS.includes(err && err.status) || (err && err.timeout);
        if (!busy || fallback === 'off' || fallback === GEMINI_MODEL()) throw err;
        out = await askModel(body, fallback).catch((err2) => {
            console.error(`[gemini] ${fallback} failed too:`, err2.message);
            throw err;
        });
    }

    const cand = out && out.candidates && out.candidates[0];
    const text = cand && cand.content && cand.content.parts
        && cand.content.parts[0] && cand.content.parts[0].text;

    if (!text) {
        // A blocked or empty candidate is a normal outcome, not a crash.
        const why = (out && out.promptFeedback && out.promptFeedback.blockReason)
            || (cand && cand.finishReason) || 'no content';
        throw new Error(`Gemini returned no answer (${why}).`);
    }
    return JSON.parse(text);
}

module.exports = { ask, ready, apiKey, Type, GEMINI_MODEL, GEMINI_FALLBACK_MODEL, RETRY_STATUS, RETRY_WAITS_MS };
