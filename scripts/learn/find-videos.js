#!/usr/bin/env node
'use strict';

/**
 * Picks course videos for the learning portal from open, non-YouTube sources
 * and writes them into data/learn/<slug>.json as
 *
 *   "videos": [{ "src": "ia"|"pt"|"dm", "embed": "<https url>", "title": "...", "minutes": 12 }]
 *
 * best first, at most 5 per topic. The topic's old "videoId"/"videoSearch"
 * fields are removed; every other field is kept.
 *
 * Sources:
 *   ia  Internet Archive  (archive.org/advancedsearch.php + /metadata for runtime)
 *   pt  PeerTube          (via sepiasearch.org/api/v1/search/videos)
 *   dm  Dailymotion       (api.dailymotion.com/videos), only to fill slots ia/pt left
 *
 * Quality beats coverage: a video is accepted only if its title (Internet
 * Archive: title or description) carries the topic's distinctive words AND a
 * word that ties it to the course (e.g. "java"). A slot stays empty rather
 * than hold something off-topic.
 *
 * Usage:
 *   node scripts/learn/find-videos.js [--slug java-development] [--dry]
 *
 * No dependencies beyond Node's stdlib.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'learn');
const UA = 'ten-learn-video-finder/1.0';
const MAX_VIDEOS = 5;
const MIN_SEC = 3 * 60;
const MAX_SEC = 60 * 60;

/* ------------------------------------------------------------------ */
/* Course context                                                      */
/* ------------------------------------------------------------------ */

// name: used in queries. ctx: at least one of these must appear in the
// video title (IA: title or description) so a "Generics" video is about
// Java generics and not C# ones. The first ctx word is the query prefix.
const COURSES = {
    'artificial-intelligence': { name: 'Artificial Intelligence', ctx: ['machine learning', 'artificial intelligence', 'deep learning', 'neural', 'ml', 'llm', 'llms', 'gpt', 'chatgpt', 'scikit', 'sklearn', 'pytorch', 'tensorflow', 'keras', 'mlops', 'data science'], not: ['upscale', 'upscaled', 'ai upscale', 'ai generated', 'ai art', 'ai music', 'ai cover'] },
    'business-development': { name: 'Business Development', ctx: ['business', 'sales', 'selling', 'b2b', 'marketing', 'startup', 'startups', 'customer', 'customers', 'entrepreneur', 'entrepreneurship', 'crm', 'negotiation', 'market', 'pricing'] },
    'cyber-security': { name: 'Cyber Security', ctx: ['security', 'cybersecurity', 'cyber', 'hacking', 'hacker', 'hackers', 'infosec', 'owasp', 'pentest', 'penetration', 'malware', 'exploit', 'ctf', 'nmap', 'kali', 'cryptography', 'crypto', 'vulnerability', 'vulnerabilities', 'attack', 'attacks'] },
    'data-science': { name: 'Data Science', ctx: ['data science', 'data', 'pandas', 'statistics', 'statistical', 'python', 'machine learning', 'sklearn', 'scikit', 'numpy', 'analytics', 'sql', 'jupyter', 'seaborn', 'matplotlib'] },
    'devops-with-aws': { name: 'DevOps with AWS', ctx: ['devops', 'aws', 'linux', 'docker', 'kubernetes', 'k8s', 'terraform', 'git', 'github', 'gitlab', 'bash', 'shell', 'ci', 'cd', 'ci/cd', 'cloud', 'amazon', 'ec2', 's3', 'iam', 'prometheus', 'grafana', 'devsecops', 'container', 'containers', 'compose', 'ansible', 'jenkins', 'unix', 'terminal'] },
    'finance': { name: 'Finance', ctx: ['finance', 'financial', 'money', 'investing', 'investment', 'investor', 'stock', 'stocks', 'bond', 'bonds', 'accounting', 'economics', 'corporate', 'banking', 'portfolio', 'valuation', 'markets', 'market', 'capital', 'derivatives', 'options', 'futures', 'interest', 'dcf', 'npv', 'cash', 'balance', 'income', 'ratio', 'ratios', 'budgeting', 'equity'] },
    'flutter-development': { name: 'Flutter Development', ctx: ['flutter', 'dart'] },
    'hr': { name: 'HR', ctx: ['hr', 'human resources', 'human resource', 'employee', 'employees', 'workplace', 'hiring', 'recruiting', 'recruitment', 'recruiter', 'interview', 'interviews', 'interviewing', 'management', 'manager', 'managers', 'employment', 'onboarding', 'talent', 'leadership', 'staff', 'work', 'team', 'teams', 'organizational', 'hris', 'payroll', 'compensation', 'diversity', 'inclusion'] },
    'java-development': { name: 'Java Development', ctx: ['java', 'jvm', 'spring boot', 'spring framework', 'spring data', 'spring mvc', 'maven', 'gradle', 'junit', 'jdbc', 'jdk', 'openjdk', 'hibernate', 'jpa'], not: ['javascript', 'java script'] },
    'mern-stack-development': { name: 'MERN Stack Development', ctx: ['mern', 'node', 'nodejs', 'node.js', 'express', 'expressjs', 'mongodb', 'mongo', 'mongoose', 'react', 'reactjs', 'javascript', 'js', 'npm', 'jwt', 'socket.io', 'websocket', 'websockets', 'rest', 'api', 'supertest', 'jest'] },
    'python-development': { name: 'Python Development', ctx: ['python', 'pytest', 'flask', 'pandas', 'asyncio', 'pip', 'django', 'pypi', 'cpython', 'jupyter'] },
    'software-engineering': { name: 'Software Engineering', ctx: ['software', 'programming', 'programmer', 'programmers', 'code', 'coding', 'developer', 'developers', 'engineering', 'computer science', 'agile', 'scrum', 'git', 'api', 'apis', 'oop', 'algorithm', 'algorithms', 'database', 'databases', 'devops', 'ci/cd', 'architecture', 'microservices', 'testing', 'debugging', 'refactoring', 'solid'] },
    'space-intern': { name: 'Space Intern', ctx: ['space', 'spacecraft', 'satellite', 'satellites', 'orbit', 'orbits', 'orbital', 'rocket', 'rockets', 'nasa', 'esa', 'isro', 'cubesat', 'cubesats', 'launch', 'astronaut', 'astronauts', 'spaceflight', 'mars', 'moon', 'lunar', 'planetary', 'remote sensing', 'mission', 'missions', 'aerospace'] },
    'venture-capital': { name: 'Venture Capital', ctx: ['venture', 'vc', 'vcs', 'startup', 'startups', 'founder', 'founders', 'fundraising', 'investor', 'investors', 'investing', 'investment', 'angel', 'seed', 'series a', 'pitch', 'term sheet', 'cap table', 'ipo', 'acquisition', 'entrepreneur', 'entrepreneurs', 'entrepreneurship', 'y combinator', 'yc', 'valuation'] },
    'web-development': { name: 'Web Development', ctx: ['web', 'html', 'html5', 'css', 'css3', 'javascript', 'js', 'dom', 'browser', 'browsers', 'frontend', 'front-end', 'react', 'reactjs', 'flexbox', 'grid', 'fetch', 'json', 'website', 'websites', 'devtools', 'http', 'accessibility', 'a11y', 'netlify', 'github pages', 'jsx', 'hooks'] }
};

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

// Words that say nothing about what a video covers.
const GENERIC = new Set((
    'a an the and or of in on to for with without from by at as is are be it its your you our we what why how ' +
    'when where which who that this these those not vs versus into over under off out one first new ' +
    'introduction intro introducing basics basic tutorial tutorials part parts lecture lectures lesson lessons ' +
    'course courses explained explaining explanation overview guide beginners beginner beginning ' +
    'fundamentals fundamental full complete crash learn learning video videos episode chapter module unit ' +
    'step steps simple easy quick really actually done properly well practice practical working work ' +
    'everything thing things capstone final project projects mini example examples ideas template ' +
    'and_ 101 day days week minutes hour hours session talk webinar demo'
).split(/\s+/));

// Distinctive-but-broad words: on their own they don't pin a topic down.
const WEAK = new Set((
    'data type types system systems management process design strategy model models control flow ' +
    'development building build using reading apps app code application applications team plan planning ' +
    'analysis principles api apis web state language languages program programs file files text work ' +
    'metric metrics business security network networks software engineering science market markets ' +
    'research tool tools service services set map list run runs page pages structure structures'
).split(/\s+/));

const WEAK_STEMS = new Set([...WEAK].map((w) => stem(w)));

function norm(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/isation/g, 'ization').replace(/ise\b/g, 'ize')
        .replace(/modell/g, 'model').replace(/behaviour/g, 'behavior').replace(/defence/g, 'defense');
}

function stem(w) {
    if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !/[siua]s$/.test(w)) return w.slice(0, -1);
    return w;
}

function tokens(s) {
    return norm(s).replace(/[^a-z0-9+#./]+/g, ' ').replace(/(^|\s)[./]+|[./]+(\s|$)/g, ' ')
        .split(/\s+/).filter(Boolean);
}

/** Stem sets for a piece of text, with dotted/slashed tokens also split. */
function stemSet(s) {
    const out = new Set();
    for (const t of tokens(s)) {
        out.add(stem(t));
        for (const p of t.split(/[./]/)) if (p) out.add(stem(p));
    }
    return out;
}

function wordMatch(w, set) {
    if (set.has(w)) return true;
    if (w.length < 5) return false;
    for (const x of set) {
        if (x.length >= 5 && (x.startsWith(w) || w.startsWith(x))) return true;
    }
    return false;
}

/** The topic's distinctive word stems. Falls back to the old videoSearch
 *  string when the title has none ("The capstone"). */
function distinctive(text, courseWords) {
    const seen = new Set();
    const out = [];
    for (const t of tokens(text)) {
        if (t.length < 2 || GENERIC.has(t) || /^\d+$/.test(t)) continue;
        const s = stem(t);
        if (GENERIC.has(s) || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

function hasPhrase(text, phrase) {
    const t = ' ' + tokens(text).join(' ') + ' ';
    const p = ' ' + tokens(phrase).join(' ') + ' ';
    if (t.includes(p)) return true;
    // single word: allow stem match ("startups" ~ "startup")
    if (!phrase.includes(' ')) return stemSet(text).has(stem(norm(phrase)));
    return false;
}

function contextOk(text, ctx, not, words) {
    if ((not || []).some((c) => hasPhrase(text, c))) return false;
    const found = ctx.filter((c) => hasPhrase(text, c));
    if (!found.length) return false;
    if (!words) return true;
    // When the title shares only ONE word with the topic and that word is
    // also the only course word it has ("JUNIT vs Rider" for "Unit testing
    // with JUnit"), nothing else ties it to the course: reject.
    const set = stemSet(text);
    const hits = words.filter((w) => wordMatch(w, set));
    if (hits.length >= 2) return true;
    return found.some((c) => c.includes(' ') || !hits.includes(stem(norm(c))));
}

const LIVE = /\blive[- ]?stream|\blivestream|\bstreamed live\b|\(live\)|\blive:/i;

/**
 * Score how well a title covers the topic words. Returns 0 to reject.
 * Words that are also course words ("python" in a Python course) do not
 * count towards the topic: the context rule already covers them. Of the
 * remaining topic words:
 *  - 1 or 2 words: at least 1 strong (non-WEAK) hit; all-weak topics: all.
 *  - 3+ words: at least ceil(n/2), including a strong one.
 * A topic made only of course words ("Flutter and Dart") needs all of them.
 */
function topicScore(words, text, courseWords) {
    const set = stemSet(text);
    const own = courseWords ? words.filter((w) => !courseWords.has(w)) : words;
    if (!own.length) return words.every((w) => wordMatch(w, set)) ? 1 : 0;
    const hit = own.filter((w) => wordMatch(w, set));
    if (!hit.length) return 0;
    const weak = (w) => WEAK.has(w) || WEAK_STEMS.has(w);
    const strong = own.filter((w) => !weak(w));
    const strongHit = hit.filter((w) => !weak(w));
    if (!strong.length) return hit.length === own.length ? 1 : 0;
    if (!strongHit.length) return 0;
    // Two words: both, unless the missing one is weak ("Pricing strategy"
    // is satisfied by "pricing"; "Reading the field" needs both).
    if (own.length === 2 && strongHit.length < strong.length) return 0;
    const need = own.length <= 2 ? 1 : Math.ceil(own.length / 2);
    if (hit.length < need) return 0;
    const extra = words.length - own.length ? words.filter((w) => !own.includes(w) && wordMatch(w, set)).length * 0.1 : 0;
    return hit.length / own.length + extra;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One request at a time per host, with a small gap: polite and simple.
const hostQueues = {};
const GAP_MS = { 'archive.org': 400, 'sepiasearch.org': 500, 'api.dailymotion.com': 400 };

function rawGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 30000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                resolve({ redirect: new URL(res.headers.location, url).toString() });
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body, retryAfter: res.headers['retry-after'] }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

async function getJson(url) {
    const host = new URL(url).hostname;
    const prev = hostQueues[host] || Promise.resolve();
    let release;
    hostQueues[host] = new Promise((r) => { release = r; });
    await prev;
    try {
        let target = url;
        for (let attempt = 0; attempt < 5; attempt++) {
            let res;
            try {
                res = await rawGet(target);
            } catch (err) {
                await sleep(1000 * 2 ** attempt);
                continue;
            }
            if (res.redirect) { target = res.redirect; attempt--; continue; }
            if (res.status === 429 || res.status >= 500) {
                const ra = Number(res.retryAfter);
                await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt);
                continue;
            }
            if (res.status !== 200) return null;
            try { return JSON.parse(res.body); } catch { return null; }
        }
        return null;
    } finally {
        setTimeout(release, GAP_MS[host] || 400);
    }
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

// Titles carrying these are almost never English, whatever the metadata says.
const FOREIGN = new Set(('com para aula aulas curso como con el los las del una uno und der die das mit ' +
    'avec pour les des une sur dans och och fur fuer und zum zur einfuhrung introduccion introducao ' +
    'trabalhando programacao programacion desarrollo desenvolvimento clase leccion parte segunda primera ' +
    'tutoriel cours partie lezione corso wie ist mit hindi urdu tamil telugu bangla kannada malayalam marathi gujarati punjabi').split(/\s+/));
const looksForeign = (title) => tokens(title).some((w) => FOREIGN.has(w));

const ENGLISH = new Set(['en', 'eng', 'english', 'en-us', 'en-gb', 'en_us', 'en_gb']);
const mostlyAscii = (s) => {
    const str = String(s || '');
    if (!str) return false;
    const nonAscii = str.replace(/[\x00-\x7F]/g, '').length;
    return nonAscii / str.length < 0.1;
};

const IA_BAD_COLLECTION = /youtube|archiveteam|altcensored|mirrortube|social-media-video|fringe|deemphasize|tvarchive|tvnews|^tv-|inlibrary|printdisabled|lendinglibrary|stream_only/i;

function iaQuery(words, ctx) {
    const w = words.map((x) => `title:(${x}*)`).join(' OR ');
    const c = ctx.slice(0, 12).map((x) => (x.includes(' ') ? `title:("${x}")` : `title:(${x})`)).join(' OR ');
    return `(${w}) AND (${c}) AND mediatype:(movies)`;
}

function asArray(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }

function parseRuntime(r) {
    if (r == null) return null;
    const s = String(Array.isArray(r) ? r[0] : r).trim();
    let m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    m = s.match(/^(\d+(?:\.\d+)?)\s*(min|minutes|m)\b/i);
    if (m) return Math.round(parseFloat(m[1]) * 60);
    m = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds)?$/i);
    if (m) return Math.round(parseFloat(m[1]));
    return null;
}

async function iaDuration(id) {
    const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (!meta || !meta.metadata) return null;
    if (meta.is_dark || meta.metadata.access_restricted_item === 'true') return null;
    const files = Array.isArray(meta.files) ? meta.files : [];
    // Several video files under one item usually means a playlist of parts:
    // the embed plays the first, so use the first original video's length.
    const vids = files.filter((f) => f.length && /\.(mp4|ogv|webm|mkv|avi|mov|mpe?g|m4v|flv)$/i.test(f.name || ''));
    const originals = vids.filter((f) => f.source === 'original');
    const pick = (originals[0] || vids[0]);
    let sec = pick ? parseRuntime(pick.length) : null;
    if (sec == null) sec = parseRuntime(meta.metadata.runtime);
    const distinctOriginals = new Set(originals.map((f) => f.name.replace(/\.[^.]+$/, ''))).size;
    return { sec, multi: distinctOriginals > 1 };
}

async function searchIA(t) {
    const q = iaQuery(t.words, t.ctx);
    const fl = ['identifier', 'title', 'description', 'licenseurl', 'collection', 'language', 'runtime', 'downloads'];
    const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
        fl.map((f) => '&fl[]=' + f).join('') + '&sort[]=downloads+desc&rows=60&page=1&output=json';
    const data = await getJson(url);
    const docs = (data && data.response && data.response.docs) || [];
    const cands = [];
    for (const d of docs) {
        const id = String(d.identifier || '');
        if (!id || /^youtube-/i.test(id)) continue;
        if (asArray(d.collection).some((c) => IA_BAD_COLLECTION.test(String(c)))) continue;
        const title = String(Array.isArray(d.title) ? d.title[0] : d.title || '').trim();
        if (!title || LIVE.test(title) || looksForeign(title)) continue;
        const desc = String(asArray(d.description).join(' ')).replace(/<[^>]+>/g, ' ').slice(0, 2000);
        const langs = asArray(d.language).map((l) => String(l).toLowerCase().trim());
        if (langs.length ? !langs.some((l) => ENGLISH.has(l)) : !mostlyAscii(title)) continue;
        // topic words: title, or description (IA only)
        let score = topicScore(t.words, title, t.courseWords);
        if (!score) { score = topicScore(t.words, desc, t.courseWords) * 0.7; }
        if (!score) continue;
        if (!contextOk(title, t.ctx, t.not, t.words) && !contextOk(desc, t.ctx, t.not, t.words)) continue;
        const lic = String(d.licenseurl || '');
        const open = /creativecommons\.org|publicdomain/i.test(lic);
        cands.push({ src: 'ia', id, title, score: score + (open ? 0.15 : 0) + (contextOk(title, t.ctx, t.not, t.words) ? 0.1 : 0), runtime: d.runtime });
    }
    cands.sort((a, b) => b.score - a.score);
    const out = [];
    for (const c of cands.slice(0, 10)) {
        let sec = parseRuntime(c.runtime);
        const info = await iaDuration(c.id);
        if (!info) continue;
        if (info.sec != null) sec = info.sec;
        if (sec == null || sec < MIN_SEC || sec > MAX_SEC) continue;
        out.push({ src: 'ia', embed: `https://archive.org/embed/${encodeURIComponent(c.id)}`, title: c.title, minutes: Math.max(1, Math.round(sec / 60)), score: c.score });
        if (out.length >= MAX_VIDEOS) break;
    }
    return out;
}

async function searchPT(t, queries) {
    const out = [];
    for (const q of queries) {
        const url = 'https://sepiasearch.org/api/v1/search/videos?search=' + encodeURIComponent(q) +
            '&count=30&start=0&languageOneOf=en&nsfw=false&durationMin=' + MIN_SEC + '&durationMax=' + MAX_SEC + '&sort=-match';
        const data = await getJson(url);
        for (const v of (data && data.data) || []) {
            if (v.isLive || v.nsfw) continue;
            if (!v.language || v.language.id !== 'en') continue;
            if (v.privacy && v.privacy.id !== 1) continue;
            const sec = Number(v.duration);
            if (!(sec >= MIN_SEC && sec <= MAX_SEC)) continue;
            const embed = String(v.embedUrl || '');
            if (!/^https:\/\//.test(embed)) continue;
            const title = String(v.name || '').trim();
            if (LIVE.test(title) || looksForeign(title)) continue;
            const score = topicScore(t.words, title, t.courseWords);
            if (!score || !contextOk(title, t.ctx, t.not, t.words)) continue;
            const open = v.licence && v.licence.id >= 1 && v.licence.id <= 7;
            out.push({ src: 'pt', embed, title, minutes: Math.round(sec / 60), score: score + (open ? 0.1 : 0) + 0.05 });
        }
    }
    return out;
}

async function searchDM(t, queries) {
    const out = [];
    for (const q of queries) {
        const url = 'https://api.dailymotion.com/videos?search=' + encodeURIComponent(q) +
            '&fields=id,title,duration,language,allow_embed,private,status,explicit,mode,onair' +
            '&languages=en&longer_than=3&shorter_than=60&sort=relevance&limit=30&family_filter=true';
        const data = await getJson(url);
        for (const v of (data && data.list) || []) {
            if (!v.allow_embed || v.private || v.status !== 'published' || v.explicit) continue;
            if (v.mode && v.mode !== 'vod') continue;
            if (v.onair) continue;
            if (v.language && v.language !== 'en') continue;
            const sec = Number(v.duration);
            if (!(sec >= MIN_SEC && sec <= MAX_SEC)) continue;
            const title = String(v.title || '').trim();
            if (!mostlyAscii(title) || LIVE.test(title) || looksForeign(title)) continue;
            const score = topicScore(t.words, title, t.courseWords);
            if (!score || !contextOk(title, t.ctx, t.not, t.words)) continue;
            out.push({ src: 'dm', embed: `https://www.dailymotion.com/embed/video/${encodeURIComponent(v.id)}`, title, minutes: Math.round(sec / 60), score });
        }
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Per topic                                                           */
/* ------------------------------------------------------------------ */

const dedupeKey = (title) => tokens(title).join(' ').replace(/\b(part|pt|ep|episode)\s*\d*\b/g, '').replace(/\s+/g, ' ').trim();

function pick(all) {
    const seenEmbed = new Set();
    const seenTitle = new Set();
    const ordered = [
        ...all.filter((v) => v.src !== 'dm').sort((a, b) => b.score - a.score),
        ...all.filter((v) => v.src === 'dm').sort((a, b) => b.score - a.score)
    ];
    const out = [];
    for (const v of ordered) {
        const k = dedupeKey(v.title);
        if (seenEmbed.has(v.embed) || seenTitle.has(k)) continue;
        seenEmbed.add(v.embed);
        seenTitle.add(k);
        out.push({ src: v.src, embed: v.embed, title: v.title, minutes: v.minutes });
        if (out.length >= MAX_VIDEOS) break;
    }
    return out;
}

async function findForTopic(slug, topic) {
    const course = COURSES[slug];
    const ctx = course.ctx;
    const courseWords = new Set(ctx.filter((c) => !c.includes(' ')).map((c) => stem(norm(c))));
    let words = distinctive(topic.title, courseWords);
    if (!words.length && topic.videoSearch) words = distinctive(topic.videoSearch, courseWords);
    if (!words.length) return { words, videos: [] };

    const cleanTitle = topic.title.replace(/[:,]/g, ' ').replace(/\s+/g, ' ').trim();
    const prefix = ctx[0];
    const queries = [];
    const add = (q) => { q = q.replace(/\s+/g, ' ').trim(); if (q && !queries.some((x) => x.toLowerCase() === q.toLowerCase())) queries.push(q); };
    add(hasPhrase(cleanTitle, prefix) ? cleanTitle : `${prefix} ${cleanTitle}`);
    add(`${cleanTitle} ${course.name}`);
    if (topic.videoSearch) add(topic.videoSearch);

    const t = { words, ctx, not: course.not || [], courseWords };
    const [ia, pt] = await Promise.all([searchIA(t), searchPT(t, queries)]);
    let all = [...ia, ...pt];
    const distinct = new Set(all.map((v) => dedupeKey(v.title))).size;
    if (distinct < MAX_VIDEOS) all = all.concat(await searchDM(t, queries));
    return { words, videos: pick(all) };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function rewriteTopic(topic, videos) {
    const out = {};
    for (const [k, v] of Object.entries(topic)) {
        if (k === 'videoId' || k === 'videoSearch' || k === 'videos') continue;
        out[k] = v;
    }
    out.videos = videos;
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const si = args.indexOf('--slug');
    const only = si >= 0 ? args[si + 1] : null;
    const slugs = Object.keys(COURSES).filter((s) => !only || s === only);
    if (only && !slugs.length) { console.error('unknown slug: ' + only); process.exit(1); }

    const table = [];
    for (const slug of slugs) {
        const file = path.join(DATA_DIR, slug + '.json');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const topics = raw.topics || [];
        let covered = 0;
        let total = 0;
        const newTopics = [];
        for (let i = 0; i < topics.length; i++) {
            const topic = topics[i];
            let res;
            try {
                res = await findForTopic(slug, topic);
            } catch (err) {
                console.error(`[${slug} #${i + 1}] ${err.message}`);
                res = { words: [], videos: [] };
            }
            if (res.videos.length) covered++;
            total += res.videos.length;
            console.log(`[${slug} #${i + 1}] ${topic.title}  {${res.words.join(', ')}}  -> ${res.videos.length}`);
            for (const v of res.videos) console.log(`     ${v.src} ${String(v.minutes).padStart(2)}m  ${v.title}  <${v.embed}>`);
            newTopics.push(rewriteTopic(topic, res.videos));
        }
        if (!dry) {
            raw.topics = newTopics;
            fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
        }
        table.push({ slug, topics: topics.length, covered, total });
    }

    console.log('\ncourse                      topics  with-video  videos');
    for (const r of table) console.log(`${r.slug.padEnd(28)}${String(r.topics).padStart(6)}${String(r.covered).padStart(12)}${String(r.total).padStart(8)}`);
    const sum = table.reduce((a, r) => ({ topics: a.topics + r.topics, covered: a.covered + r.covered, total: a.total + r.total }), { topics: 0, covered: 0, total: 0 });
    console.log(`${'TOTAL'.padEnd(28)}${String(sum.topics).padStart(6)}${String(sum.covered).padStart(12)}${String(sum.total).padStart(8)}`);
    if (dry) console.log('(dry run: nothing written)');
}

if (require.main === module) {
    main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { distinctive, topicScore, contextOk, stemSet, parseRuntime };
