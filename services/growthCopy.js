'use strict';

/**
 * Turn a one-line brief into a campaign draft.
 *
 * The campaign form is six fields typed from scratch every time — name,
 * subject, heading, body, button text, button link — and that is the slowest
 * step in sending anything. This asks Gemini to fill them from a sentence, so
 * the human edits a draft instead of facing a blank form. It is the same
 * utils/gemini the idea agent uses; no new key, no new cost.
 *
 * Nothing here sends or saves. It returns the same shape the form holds, and
 * the human still presses Preview and Save. The model writes a first draft; it
 * does not reach anyone.
 *
 * Two fields are NOT left to the model's imagination, because a wrong value in
 * either is worse than a blank one:
 *
 *   - the button LINK is chosen from a closed list of real portal pages. A
 *     model asked for a URL will invent a plausible one, and a campaign that
 *     goes out with a 404 button is worse than one with no button. So the model
 *     picks a destination by key and the real URL is built here.
 *
 *   - the SEGMENT is validated against the real segment keys. A made-up
 *     audience name would fail silently at send time; an unrecognised one is
 *     dropped and the human picks.
 */

const { ask, ready, Type } = require('../utils/gemini');
const segments = require('./growthSegments');

/**
 * Where a call-to-action button may point. A closed list of pages that exist,
 * keyed so the model chooses a destination rather than writing a URL. The
 * description is what the model sees; the key is the real path.
 */
const CTA_PATHS = Object.freeze({
    '/overview':    'the student portal home and dashboard — the safe default',
    '/studio.html': 'Career Studio: resume rebuilt to pass an ATS, portfolio, ₹500 upsell',
    '/learn':       'the learning hub, lessons and tracks',
    '/academics':   'the academics and courses page',
    '/domains':     'the fourteen domains overview',
    '/community':   'the student community page'
});
const DEFAULT_PATH = '/overview';

/** Field ceilings, matching what routes/growth.js stores on a GrowthCampaign. */
const LIMITS = { name: 200, subject: 300, heading: 200, bodyText: 20000, ctaLabel: 80 };

const SCHEMA = {
    type: Type.OBJECT,
    properties: {
        name:     { type: Type.STRING },
        subject:  { type: Type.STRING },
        heading:  { type: Type.STRING },
        bodyText: { type: Type.STRING },
        ctaLabel: { type: Type.STRING },
        ctaPath:  { type: Type.STRING },
        segment:  { type: Type.STRING }
    },
    required: ['subject', 'heading', 'bodyText', 'ctaLabel', 'ctaPath']
};

/** The portal's base URL, read the same way services/growthTracking.js reads it. */
function baseUrl() {
    return String(process.env.PORTAL_URL || '').replace(/\/+$/, '');
}

function buildPrompt(brief) {
    const ctas = Object.entries(CTA_PATHS)
        .map(([path, what]) => `  ${path} — ${what}`).join('\n');
    const segs = Object.entries(segments.SEGMENTS)
        .map(([key, s]) => `  ${key} — ${s.label}: ${s.description}`).join('\n');

    return [
        'You write marketing email for The Entrepreneurship Network (TEN), an Indian',
        'virtual-internship programme. The readers are students, mostly 18–24, in India.',
        '',
        'Write ONE campaign email from this brief:',
        `"""${String(brief).slice(0, 600)}"""`,
        '',
        'Rules for the copy:',
        '- Plain, direct, warm. No hype, no emoji in the subject, at most one elsewhere.',
        '- Indian English. Rupees as ₹. Say what they get, what it costs, what to do next.',
        '- subject: under about 90 characters, specific, no clickbait.',
        '- heading: a short line that sits at the top of the email.',
        '- bodyText: 2–4 short paragraphs, plain text. A BLANK LINE separates paragraphs.',
        '  No markdown, no links in the body — the button is the only link.',
        '- ctaLabel: 2–4 words for the button, an action ("See what\'s included").',
        '- name: a short internal label for this campaign (the team sees it, not the reader).',
        '',
        'Choose the button destination by key from this list — do not write a URL:',
        ctas,
        '',
        'Suggest the audience segment by key from this list (or "" if unsure):',
        segs,
        '',
        'Return JSON only.'
    ].join('\n');
}

const trim = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/**
 * @param {string} brief  the one-line description of the campaign
 * @returns {Promise<{name,subject,heading,bodyText,ctaLabel,ctaUrl,segment}>}
 */
async function draft(brief) {
    if (!String(brief || '').trim()) throw new Error('Describe the campaign in a sentence first.');
    if (!ready()) throw new Error('No AI key on this server — write the campaign by hand, or ask an admin to set GEMINI_API_KEY.');

    const out = await ask(buildPrompt(brief), SCHEMA) || {};

    // The link: a key into the real-pages list, never a URL the model wrote.
    const path = CTA_PATHS[out.ctaPath] ? out.ctaPath : DEFAULT_PATH;
    // The audience: a real segment key, or nothing for the human to choose.
    const segment = segments.isSegment(out.segment) ? out.segment : '';

    return {
        name:     trim(out.name, LIMITS.name) || trim(out.subject, LIMITS.name),
        subject:  trim(out.subject, LIMITS.subject),
        heading:  trim(out.heading, LIMITS.heading),
        bodyText: trim(out.bodyText, LIMITS.bodyText),
        ctaLabel: trim(out.ctaLabel, LIMITS.ctaLabel),
        ctaUrl:   baseUrl() + path,
        segment
    };
}

module.exports = { draft, CTA_PATHS, DEFAULT_PATH, LIMITS, buildPrompt };
