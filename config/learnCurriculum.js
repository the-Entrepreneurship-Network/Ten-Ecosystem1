'use strict';

/**
 * The LLM portal's curriculum: one module per domain, loaded from
 * data/learn/<slug>.json.
 *
 * The domain list is config/domains.js — the same list every other page uses —
 * so a domain added there shows up here as "content coming" rather than
 * silently missing, and a JSON file with no matching domain is ignored rather
 * than invented into the product.
 *
 * Each topic carries the module text (a technical explanation, then a simple
 * one), the video that follows it, and a difficulty from 1 to 5 that must
 * never decrease as the topics advance — the ramp is part of the spec.
 *
 * Deliberately NO question bank in the seeds: questions are generated fresh
 * per attempt by the exam service, which is what makes a retake's questions
 * different from the first sitting's. Content here is what a HUMAN maintains.
 */

const fs = require('fs');
const path = require('path');
const { DOMAINS } = require('./domains');

const DATA_DIR = path.join(__dirname, '..', 'data', 'learn');

function slugify(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Loaded once at boot. The files are the source of truth; editing them and
 *  restarting is the whole content-management story, on purpose. */
let CACHE = null;

function load() {
    if (CACHE) return CACHE;
    const modules = {};
    for (const d of DOMAINS) {
        if (d.selectable === false) continue;
        const slug = slugify(d.name);
        const file = path.join(DATA_DIR, slug + '.json');
        let topics = [];
        try {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            topics = (raw.topics || []).map((t, i) => ({
                n: i + 1,
                title: String(t.title || '').trim(),
                technical: String(t.technical || '').trim(),
                simple: String(t.simple || '').trim(),
                videoId: t.videoId || null,
                videoSearch: t.videoSearch || null,
                difficulty: Math.min(5, Math.max(1, Number(t.difficulty) || 1))
            })).filter((t) => t.title && t.technical && t.simple);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('[learn] bad curriculum file ' + slug + '.json:', err.message);
            }
        }
        modules[slug] = {
            slug,
            name: d.name,
            shortCode: d.shortCode || '',
            topics,
            ready: topics.length >= 20
        };
    }
    CACHE = modules;
    return modules;
}

function getModules() {
    return Object.values(load());
}

function getModule(slug) {
    return load()[String(slug || '').toLowerCase()] || null;
}

function getTopic(slug, n) {
    const mod = getModule(slug);
    if (!mod) return null;
    return mod.topics[Number(n) - 1] || null;
}

/**
 * Videos that can stand in for a topic's own.
 *
 * Two thirds of the topics carry a `videoSearch` string rather than an id,
 * and the embed built from one — `youtube.com/embed?listType=search&list=…` —
 * is a form YouTube withdrew: it answers "Error 153, video player
 * configuration error" every time. So a topic with no id of its own gets the
 * other videos from ITS OWN module, which are at least the same course, and
 * the page offers a search link for the exact topic beside them.
 *
 * ponytail: same-module videos, not a search API. Put real per-topic ids in
 * data/learn/<slug>.json — one line each — and they take precedence here.
 */
function videoPoolFor(slug, topicN) {
    const mod = getModule(slug);
    if (!mod) return [];
    const own = mod.topics[topicN - 1];
    const seen = new Set();
    const out = [];
    const push = (id) => {
        const v = String(id || '').trim();
        if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    };
    if (own) {
        push(own.videoId);
        (own.videoIds || []).forEach(push);
    }
    // Nearest first: the topics either side of this one are the closest thing
    // to "related" that needs no network call to find.
    const byDistance = mod.topics
        .map((t, i) => ({ t, d: Math.abs((i + 1) - topicN) }))
        .sort((a, b) => a.d - b.d);
    for (const { t } of byDistance) push(t.videoId);
    return out.slice(0, 6);
}

/** Test hook: forget the cache so a suite can point DATA_DIR at fixtures. */
function _reload() { CACHE = null; }

module.exports = { getModules, getModule, getTopic, videoPoolFor, slugify, _reload, DATA_DIR };
