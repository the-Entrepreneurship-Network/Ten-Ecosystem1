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
 *   ia  Internet Archive  (archive.org/advancedsearch.php + /metadata)
 *   pt  PeerTube          (via sepiasearch.org/api/v1/search/videos)
 *   dm  Dailymotion       (api.dailymotion.com/videos), only to fill slots ia/pt left
 *
 * Legal first. A wrong or pirated video is worse than no video:
 *   ia  kept only if the item's /metadata licenseurl is Creative Commons or
 *       public domain. No licence, no keep.
 *   pt  kept only with a SepiaSearch licence id 1-7 (CC or public domain).
 *   dm  kept only from the "school" or "tech" channels and never with a
 *       news / interview / trailer / music / vlog / reaction title.
 *   all dropped if the title (ia: or description) looks like a ripped or
 *       resold paid course: Udemy, Coursera, LinkedIn Learning, Lynda,
 *       Pluralsight, Packt, Skillshare, Domestika, MasterClass, Downloadly,
 *       FreeCourseSite, TutsGalaxy, "course download", "Bonus 20xx", "[FCS]",
 *       "Bootcamp" dumps, or a title that starts with a lecture or track
 *       number ("053 ", "5. ", "(35 - Part 8").
 *
 * Then relevant: a video is accepted only if its title (Internet Archive:
 * title or description) carries the topic's distinctive words, or two of the
 * technical terms in the topic's own text, AND its title carries a word that
 * ties it to the course (e.g. "java"). Picks a person rejected by hand are listed in REJECT
 * and never come back. A slot stays empty rather than hold something
 * off-topic: the page then says there is no video for the topic yet.
 *
 * Usage: see main() below.
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
/* Judged by hand                                                      */
/* ------------------------------------------------------------------ */

// Videos a person read the title of and rejected for the topic they had
// matched (wrong meaning, neighbouring topic, too generic, not teaching),
// as "<slug>#<topic index> <embed url>". A re-run never puts them back on
// that topic.
const REJECT = new Set([
    // 239 picks judged off-topic in the review of 2026-11:
    'artificial-intelligence#0 https://archive.org/embed/disruptivetechs-ai',
    'artificial-intelligence#0 https://archive.org/embed/isoc-no-ai',
    'artificial-intelligence#0 https://archive.org/embed/pyconza2018-Guide_to_choose_right_deep_Learning_framework_for_your_AI_project',
    'artificial-intelligence#0 https://archive.org/embed/sexfuture',
    'artificial-intelligence#1 https://archive.org/embed/neural-prophet-a-powerful-ai-framework-for-time-series-models',
    'artificial-intelligence#10 https://video.osgeo.org/videos/embed/7BXS5TCfRJjCUZU5BiavdA',
    'artificial-intelligence#11 https://archive.org/embed/pyconza2017-Getting_more_out_of_your_pandas',
    'artificial-intelligence#11 https://video.osgeo.org/videos/embed/tmj5ko9gP6JH8DUzFMTWPV',
    'artificial-intelligence#11 https://www.dailymotion.com/embed/video/x96ac8a',
    'artificial-intelligence#16 https://archive.org/embed/disruptivetechs-ai',
    'artificial-intelligence#17 https://archive.org/embed/Europython_2019_YWujJSHp',
    'artificial-intelligence#3 https://video.osgeo.org/videos/embed/dw5JMMJg8G5pTDrCcegQHR',
    'artificial-intelligence#5 https://archive.org/embed/Europython_2019_3z5E8ZHb',
    'artificial-intelligence#5 https://videos.spacebar.ca/videos/embed/qmrRP8P6FxRJSqGbRm7VKe',
    'business-development#0 https://www.dailymotion.com/embed/video/x6l5p3i',
    'business-development#1 https://www.dailymotion.com/embed/video/x6l5hwx',
    'business-development#11 https://archive.org/embed/InboundMarketing-IMSChrisBroganPostH264ForIPodVideoAndIPhone640x480964',
    'business-development#11 https://archive.org/embed/httpsbit.ly3dspmg2',
    'business-development#11 https://video.fraxoweb.com/videos/embed/4XhWuk4wb6xACunVYJf6oh',
    'business-development#11 https://video.fraxoweb.com/videos/embed/jmcw6ungopQejqWRqaRBcR',
    'business-development#12 https://archive.org/embed/osen2017-emergingmarket',
    'business-development#12 https://diler.tube/videos/embed/eFZyMw1mPcQLQkGh2MJtSF',
    'business-development#12 https://peertube.dngr.us/videos/embed/71ufYuRYfkPBbjKvqkfZ8K',
    'business-development#12 https://peertube.dngr.us/videos/embed/uCBetsXg6NsNJQkhXX4CmM',
    'business-development#14 https://archive.org/embed/DrupalconDc2009-BusinessAnalyticsWithViews',
    'business-development#18 https://peertube.f-si.org/videos/embed/81951ef3-5914-4d21-99cf-b8019e698711',
    'business-development#18 https://peertube.kaleidos.net/videos/embed/ipS1CgVtShpPqSz7fdmUFS',
    'business-development#18 https://tv.dyne.org/videos/embed/iLHoU4f7qEnVbqt9DJ7yFV',
    'business-development#18 https://video.fraxoweb.com/videos/embed/4NGCKoQ9XSSjT1192p37hu',
    'business-development#18 https://videos.shmalls.pw/videos/embed/7SbiTRer1pwCdXrBPPCsz9',
    'business-development#20 https://archive.org/embed/nina-and-the-neurons-go-eco-9.-monkey-business',
    'business-development#20 https://archive.org/embed/nina-and-the-neurons-go-eco-monkey-business-jungle-and-spotty',
    'business-development#20 https://archive.org/embed/nina-and-the-neurons-go-eco-monkey-business-orinoco-and-the-big-black-umbrella-and-painting',
    'business-development#4 https://www.dailymotion.com/embed/video/x59wh0',
    'business-development#4 https://www.dailymotion.com/embed/video/x7te3hh',
    'business-development#9 https://archive.org/embed/InboundMarketing-IMSBrentLearyPostH264ForIPodVideoAndIPhone640x480930',
    'business-development#9 https://www.dailymotion.com/embed/video/x7tftz0',
    'cyber-security#11 https://archive.org/embed/Day1Part9DynamicMalwareAnalysis',
    'cyber-security#11 https://archive.org/embed/Day2Part1ReverseEngineeringMalware',
    'cyber-security#11 https://archive.org/embed/Day2Part2ReverseEngineeringMalware',
    'cyber-security#11 https://makertube.net/videos/embed/pUNCnzgHdUQhntsbyXzUsd',
    'cyber-security#13 https://archive.org/embed/Haktip_25',
    'cyber-security#13 https://archive.org/embed/gov.house.hbs.hrs02INT2212_070118.2',
    'cyber-security#14 https://peertube.dngr.us/videos/embed/8cB52Hkpm9sdVjg87ZPttk',
    'cyber-security#18 https://archive.org/embed/SocialSe1962',
    'cyber-security#18 https://archive.org/embed/YourSoci1940',
    'cyber-security#18 https://videos.spacebar.ca/videos/embed/mBNVRq3HrzmFMMPsceWuAV',
    'cyber-security#2 https://archive.org/embed/Day2Part1ReverseEngineeringMalware',
    'cyber-security#2 https://archive.org/embed/Day2Part2ReverseEngineeringMalware',
    'cyber-security#6 https://archive.org/embed/bbs-reading-group-20230604-Fang2010a',
    'cyber-security#7 https://archive.org/embed/topdns-dnsai',
    'cyber-security#8 https://www.dailymotion.com/embed/video/x27hfns',
    'data-science#0 https://peertube.watch/videos/embed/wKUmEyyruHMx2yi9G28m4T',
    'data-science#0 https://toobnix.org/videos/embed/b4eLjcLo9vcewVTzrv95L8',
    'data-science#10 https://archive.org/embed/Day1Part13ReverseEngineeringMalware',
    'data-science#10 https://archive.org/embed/Day1Part14ReverseEngineeringMalware',
    'data-science#10 https://archive.org/embed/Day1Part15ReverseEngineeringMalware',
    'data-science#10 https://archive.org/embed/Day1Part9ReverseEngineeringMalware',
    'data-science#11 https://peertube.openstreetmap.fr/videos/embed/3eQMKBzoVo3WHCKZsGjHZB',
    'data-science#11 https://www.dailymotion.com/embed/video/xa5vh4o',
    'data-science#12 https://video.osgeo.org/videos/embed/dmu5xdDZ7J6Kbh8QUcgmZz',
    'data-science#12 https://videos.spacebar.ca/videos/embed/qmrRP8P6FxRJSqGbRm7VKe',
    'data-science#13 https://www.dailymotion.com/embed/video/x5rqiuy',
    'data-science#3 https://www.dailymotion.com/embed/video/xb5x7ta',
    'data-science#5 https://archive.org/embed/how-to-use-conditional-highlighting-in-numbers-for-data-visualization-macmost-2907',
    'data-science#5 https://video.blender.org/videos/embed/aVvducRgN9L9Nc4ny8oiEU',
    'data-science#5 https://video.matomocamp.org/videos/embed/496b49e5-b045-4e74-a8ab-165f05bb7e87',
    'data-science#5 https://video.osgeo.org/videos/embed/rbt6rr7n5ogxRbqmbDSQUk',
    'data-science#9 https://archive.org/embed/FlowAnalysisP10',
    'data-science#9 https://archive.org/embed/FlowAnalysisP7',
    'data-science#9 https://archive.org/embed/FlowAnalysisP8',
    'data-science#9 https://archive.org/embed/FlowAnalysisP9',
    'data-science#9 https://tubedu.org/videos/embed/wdnPNtFUSmeGxEiVen8sEm',
    'devops-with-aws#0 https://archive.org/embed/SeaGL2021-Bri_Hatch-SSH_from_your_DevOps_CI_CD_securely',
    'devops-with-aws#0 https://archive.org/embed/auto-devops',
    'devops-with-aws#0 https://archive.org/embed/dodboise2016-industryofcool',
    'devops-with-aws#0 https://archive.org/embed/lca2019-Oracle_Public_Cloud_DevOps_OpenStack_CICD_Infrastructure',
    'devops-with-aws#0 https://archive.org/embed/lcza18-Linux_and_Open_Source_for_SMEs_DevOps',
    'devops-with-aws#1 https://tilvids.com/videos/embed/a1CGAwt3fush7XGwHDvabC',
    'devops-with-aws#1 https://tilvids.com/videos/embed/cCG1Whk6bAvqEJrBbt8hSB',
    'devops-with-aws#1 https://tube.devwithzachary.com/videos/embed/ntbSZNoxjzCgVuJa1EHdEV',
    'devops-with-aws#10 https://archive.org/embed/chicagolug-2020-05-02-sten-turpin-k3s',
    'devops-with-aws#10 https://archive.org/embed/nodevember16-Docker_for_Devs_Why_you_should_care_about_containers',
    'devops-with-aws#10 https://archive.org/embed/pyconza2017-Deploying_Django_web_applications_in_Docker_containers',
    'devops-with-aws#15 https://archive.org/embed/BSidesDC2014-Day2-DoctorDockerInfrastructureImmunity',
    'devops-with-aws#15 https://archive.org/embed/day1_1715_A_Behind-the-Scenes_Peek_at_Worlds_First_Linux-Based_Laptop_Orchestra_',
    'devops-with-aws#15 https://archive.org/embed/lca2019-Oracle_Public_Cloud_DevOps_OpenStack_CICD_Infrastructure',
    'devops-with-aws#16 https://archive.org/embed/pyconza2019-migrating-to-python-3-using-docker-for-your-cicd-pipeline',
    'devops-with-aws#17 https://archive.org/embed/pyconza2017-Deploying_Django_web_applications_in_Docker_containers',
    'devops-with-aws#19 https://archive.org/embed/nodevember16-Dockerized_Node_Application_Pipeline_DockerDroneRancher_Oh_My',
    'devops-with-aws#19 https://www.dailymotion.com/embed/video/x9dbl0c',
    'devops-with-aws#2 https://www.dailymotion.com/embed/video/xbzgh36',
    'devops-with-aws#3 https://archive.org/embed/automatically-organize-files-with-an-automator-folder-action-shell-script-macmost-2262',
    'devops-with-aws#3 https://archive.org/embed/creating-an-information-notification-with-shell-scripts-and-automator-macmost-2185',
    'devops-with-aws#6 https://archive.org/embed/auto-devops',
    'devops-with-aws#7 https://archive.org/embed/SeaGL2024-Bash_Variable_Expansion',
    'devops-with-aws#7 https://video.osgeo.org/videos/embed/ahs7oABEg56rWD5gi9MY6B',
    'devops-with-aws#7 https://video.osgeo.org/videos/embed/pDai2KjdjUWSibacnZ7TSA',
    'devops-with-aws#8 https://www.dailymotion.com/embed/video/x86eea5',
    'devops-with-aws#9 https://www.dailymotion.com/embed/video/xaxkx0i',
    'devops-with-aws#9 https://www.dailymotion.com/embed/video/xbk61qi',
    'finance#0 https://archive.org/embed/BankingF',
    'finance#0 https://autonomy.tube/videos/embed/45636746-de62-4b88-a481-408af5b81886',
    'finance#0 https://autonomy.tube/videos/embed/ae4bdc91-10e2-4b18-9c95-caeb11d7a4ab',
    'finance#0 https://peertube.mesnumeriques.fr/videos/embed/nm94gPv2WcsKyskUNhP9Lc',
    'finance#12 https://www.dailymotion.com/embed/video/x95r5a6',
    'finance#12 https://www.dailymotion.com/embed/video/x95r5oc',
    'finance#12 https://www.dailymotion.com/embed/video/x95tais',
    'finance#13 https://fediverse.tv/videos/embed/9VpoqrvFWrUVW5tJAhVcVw',
    'finance#13 https://fediverse.tv/videos/embed/rKudVPvKNwvSe22mEhBvv7',
    'finance#16 https://archive.org/embed/BankingF',
    'finance#16 https://videos.fsci.in/videos/embed/cZC5YuCyCnxncjpuAjTaXx',
    'finance#16 https://videos.fsci.in/videos/embed/fozE6RBFftHjmMdemt9dKs',
    'finance#16 https://videos.fsci.in/videos/embed/orA3Xxvij3hg7orV4HQvpi',
    'finance#17 https://www.dailymotion.com/embed/video/x9o769w',
    'finance#18 https://www.dailymotion.com/embed/video/x8w8sh0',
    'finance#2 https://diler.tube/videos/embed/6Ea4p9tSjJPYsPESYnvGxj',
    'finance#2 https://diler.tube/videos/embed/nBqwyKgardeT2T46KwpDmx',
    'finance#2 https://peertube.dngr.us/videos/embed/wcEpdZiuK8BNS8LuWSHMMz',
    'finance#20 https://www.dailymotion.com/embed/video/x9f655e',
    'finance#3 https://www.dailymotion.com/embed/video/x2yfnq6',
    'finance#3 https://www.dailymotion.com/embed/video/x91p10e',
    'finance#4 https://tilvids.com/videos/embed/aSuCAezxkjetYuT4hEkRkf',
    'finance#5 https://www.dailymotion.com/embed/video/x8thvko',
    'finance#5 https://www.dailymotion.com/embed/video/x8wdrxg',
    'finance#6 https://www.dailymotion.com/embed/video/x36dwa2',
    'finance#6 https://www.dailymotion.com/embed/video/x7zmmc9',
    'finance#7 https://www.dailymotion.com/embed/video/x2b0nzj',
    'finance#7 https://www.dailymotion.com/embed/video/x6new6l',
    'flutter-development#2 https://www.dailymotion.com/embed/video/x84e73b',
    'flutter-development#0 https://www.dailymotion.com/embed/video/x84e73b',
    'flutter-development#0 https://www.dailymotion.com/embed/video/x8i8zwj',
    'flutter-development#1 https://www.dailymotion.com/embed/video/x84e73b',
    'flutter-development#17 https://www.dailymotion.com/embed/video/xatiaue',
    'hr#11 https://archive.org/embed/Cubicgarden-InterviewWithChrisDibonaAtGoogleDevelopmentDay149',
    'hr#11 https://archive.org/embed/Cubicgarden-InterviewWithEdParsonsAtGoogleDevelopmentDay564',
    'hr#11 https://archive.org/embed/Development_in_Provincetown_-_An_Interview_with_Duane_Steele',
    'hr#11 https://archive.org/embed/Development_in_Provincetown_-_An_Interview_with_Mary_Jo_Avellar',
    'hr#11 https://archive.org/embed/Development_in_Provincetown_-_An_Interview_with_Sheila_Lyons',
    'hr#19 https://video.igem.org/videos/embed/u3qXXDwxaJeq5E67bGbLd7',
    'hr#3 https://www.dailymotion.com/embed/video/x91ep3c',
    'hr#4 https://video.igem.org/videos/embed/ntnf6ePS8V4TsRzHGhqCGg',
    'hr#4 https://video.igem.org/videos/embed/qPpLHiXihtTDi3yEh4Uz89',
    'hr#4 https://video.igem.org/videos/embed/rRvUrbCm5zfyzsHk2y9adH',
    'hr#4 https://video.igem.org/videos/embed/sKKQJZDuzyKTHapgVB2ZRz',
    'hr#4 https://video.igem.org/videos/embed/v9NGwiSpUiMmA94dk2mMG3',
    'hr#7 https://archive.org/embed/LawEnforcementEmployeesBenevolentAssociation',
    'hr#9 https://archive.org/embed/AnInterviewWithSheikYakzanCirca1991AndPublicPerformanceOfSema',
    'hr#9 https://archive.org/embed/BA_Admin_2009-WestSideStoryMusicalPerformanceAndInterview619',
    'hr#9 https://archive.org/embed/scm-467157-fromosofundraiserinterviewsto',
    'hr#9 https://archive.org/embed/usaodd_may_24_08',
    'hr#9 https://archive.org/embed/usaodd_nov_4_08',
    'java-development#15 https://videos.ijug.eu/videos/embed/87DQZqSZHQvzmbMjfM8nz3',
    'java-development#15 https://videos.ijug.eu/videos/embed/tmFYag2aDbwgD6h7K84K6u',
    'java-development#17 https://www.dailymotion.com/embed/video/x9265sa',
    'java-development#20 https://videos.ijug.eu/videos/embed/aj5x4wV5XgwinwqEbhzkMi',
    'java-development#20 https://videos.ijug.eu/videos/embed/fEfBeKPzCGHoEE81ZvdQVw',
    'java-development#20 https://videos.ijug.eu/videos/embed/sZ6sDN63invaawXPyKqLFQ',
    'mern-stack-development#1 https://archive.org/embed/1720TermsJavaScript_201807',
    'mern-stack-development#1 https://archive.org/embed/Code4libJessieKeck',
    'mern-stack-development#14 https://archive.org/embed/lca2019-Is_it_Really_that_Bad_Exploring_IoT_Camera_Security',
    'mern-stack-development#18 https://peertube.watch/videos/embed/36f61CtPQx3wmyp5NLEhMR',
    'mern-stack-development#5 https://archive.org/embed/lca2019-Is_it_Really_that_Bad_Exploring_IoT_Camera_Security',
    'mern-stack-development#9 https://www.dailymotion.com/embed/video/x8lj722',
    'python-development#0 https://archive.org/embed/ChiehIntrotoprogramminginPythonandTkinterlecture3',
    'python-development#0 https://archive.org/embed/ChiehIntrotoprogramminginPythonnTkinterlecture4',
    'python-development#0 https://archive.org/embed/ChiehIntrotoprogrammingwithPythonandTkinterlecture6',
    'python-development#1 https://archive.org/embed/nbpy19-A_Gradual_Introduction_to_Types',
    'python-development#1 https://archive.org/embed/pyohio_2024-Is_Python_Your_TYPE_of_Programming_Language_How_to_Use_Static_Typing_in_Python_with_Type',
    'python-development#13 https://archive.org/embed/Europython_2018_HWZ9IN08',
    'python-development#13 https://archive.org/embed/Europython_2018_PVIrGo0i',
    'python-development#13 https://archive.org/embed/Europython_2020_XmERDgac',
    'python-development#13 https://archive.org/embed/lca2018-Modernising_firmware_testing_on_POWER_with_Python_and_prerelease_everything',
    'python-development#14 https://archive.org/embed/building-simple-yet-effective-apis-for-the-city-of-cape-town',
    'python-development#14 https://archive.org/embed/pyconza2017-Better_APIs_using_GraphQL_with_Python_and_React',
    'python-development#14 https://archive.org/embed/rapid-serverless-apis-with-python-and-aws-amplify',
    'python-development#16 https://archive.org/embed/pyconza2018-Building_Rest_API_with_Django_Rest_Framework_2',
    'python-development#18 https://archive.org/embed/pyconza2020-Trio-re-encoded',
    'python-development#4 https://www.dailymotion.com/embed/video/x3ftrhl',
    'python-development#4 https://www.dailymotion.com/embed/video/xykqlo',
    'python-development#5 https://www.dailymotion.com/embed/video/x9o9ukg',
    'python-development#8 https://archive.org/embed/oscw-2024-william-woodruff-x-509-path-validation-in-python',
    'python-development#8 https://archive.org/embed/pytx19-Saturday_Keynote',
    'python-development#8 https://www.dailymotion.com/embed/video/x8dhbuz',
    'python-development#9 https://archive.org/embed/pyconza2019-radio-astronomy-reduction-pipelines-using-python-and-containers',
    'python-development#9 https://archive.org/embed/pytx19-Introduction_to_Exploratory_Data_Analysis_with_the_SciAnalysis_Python_Package',
    'software-engineering#0 https://www.dailymotion.com/embed/video/xby9pzi',
    'software-engineering#10 https://archive.org/embed/7minPowerSpeech',
    'software-engineering#10 https://archive.org/embed/Agilehelpline-AgileStrategyManifesto190',
    'software-engineering#11 https://video.igem.org/videos/embed/6yU2ibWg44GL6kkakqYCQb',
    'software-engineering#11 https://video.igem.org/videos/embed/8B9J4ue1ZS5QfhuJDP72Pu',
    'software-engineering#11 https://videos.trom.tf/videos/embed/dsaf5UmbcQ6bG3ZUkeCJMa',
    'software-engineering#12 https://peertube.watch/videos/embed/7iSzQte4pjfSSkJxW4rpS1',
    'software-engineering#13 https://archive.org/embed/Twit_Coding_101_73',
    'software-engineering#13 https://archive.org/embed/hak5_8x18',
    'software-engineering#15 https://www.dailymotion.com/embed/video/x21l615',
    'software-engineering#16 https://archive.org/embed/Europython_2019_83CDZBLR',
    'software-engineering#16 https://archive.org/embed/exploring-the-remarkable-regenerative-patterns-and-practices-of-the-internet-eng',
    'software-engineering#16 https://archive.org/embed/five-must-have-code-patterns-for-your-godot-game-feat.-play-with-furcifer-1080p',
    'software-engineering#17 https://www.dailymotion.com/embed/video/xby8zvq',
    'software-engineering#19 https://archive.org/embed/Europython_2019_83CDZBLR',
    'software-engineering#19 https://archive.org/embed/Redmonk-6thSenseAndJIRA805',
    'software-engineering#19 https://archive.org/embed/nbpy23-Make_Your_Engineering_Team_A_Fabulous_Place_for_Programmers_with_ADHD_and_Autism',
    'software-engineering#2 https://tilvids.com/videos/embed/82rJbedwEZegWoZfwiALqM',
    'software-engineering#20 https://www.dailymotion.com/embed/video/x4czuv',
    'software-engineering#4 https://www.dailymotion.com/embed/video/x5qkr08',
    'software-engineering#6 https://peertube.lagbag.com/videos/embed/wu93Lckww5AbmuQeW6LBY4',
    'software-engineering#6 https://toobnix.org/videos/embed/augR7u7F75FZoxsBT2Fwwn',
    'software-engineering#6 https://tubedu.org/videos/embed/7CPAowLLwFJvdqWHNqX7Qp',
    'software-engineering#6 https://tubedu.org/videos/embed/pqgRag1nscwRhMV6bbjaHi',
    'software-engineering#7 https://archive.org/embed/pyconza2019-machine-learning-engineering-principles-with-python-and-mlflow',
    'software-engineering#8 https://watch.softinio.com/videos/embed/dqkfvcbeRnFvhSaCj94YBJ',
    'software-engineering#9 https://www.dailymotion.com/embed/video/x9lqmea',
    'space-intern#0 https://solarsystem.video/videos/embed/1XanUu2QPwJLaCfG9Qoqaf',
    'space-intern#0 https://solarsystem.video/videos/embed/6tikJvULLfZx7vbgAYCZyH',
    'space-intern#0 https://tube.mucs.club/videos/embed/9qGGuK288f88wEW2AVptb4',
    'space-intern#11 https://www.dailymotion.com/embed/video/x8gol59',
    'space-intern#11 https://www.dailymotion.com/embed/video/xb2rumi',
    'space-intern#11 https://www.dailymotion.com/embed/video/xb3hpi6',
    'space-intern#12 https://www.dailymotion.com/embed/video/x8jpux3',
    'space-intern#14 https://archive.org/embed/DigitalspaceSpace.comVideobootprintsOnAsteroidsHumanCrewedMissionTo',
    'space-intern#14 https://archive.org/embed/SpaceRoverEpisodeIINeHumanisCredeAudioVersion',
    'space-intern#15 https://www.dailymotion.com/embed/video/xrsuib',
    'space-intern#17 https://astrotube.obspm.fr/videos/embed/3zjdBaiX78h6AzYgN5Cm2q',
    'space-intern#17 https://peertube.dngr.us/videos/embed/h2ddbsnKNwqtQ8tf4UweLv',
    'space-intern#2 https://diler.tube/videos/embed/pvMNwSpHetYvcuoys2UGG5',
    'space-intern#3 https://archive.org/embed/FB-219',
    'space-intern#3 https://www.dailymotion.com/embed/video/x2ygngm',
    'space-intern#8 https://makertube.net/videos/embed/3nAGnHu7MptgT4Xao4uHTe',
    'space-intern#8 https://www.dailymotion.com/embed/video/x913gy4',
    'space-intern#9 https://peertube.openstreetmap.fr/videos/embed/uGPyREvudjUUbZWKsnqBYy',
    'space-intern#9 https://video.osgeo.org/videos/embed/gbZGVNqA9Ffu8PsBqB6XgU',
    'space-intern#9 https://video.osgeo.org/videos/embed/uRhDyEAkuSopyje5w8cwZr',
    'space-intern#9 https://video.osgeo.org/videos/embed/vB4b7CxPtSFsGH5SGoKWwa',
    'venture-capital#0 https://archive.org/embed/DesertVe1958',
    'venture-capital#0 https://archive.org/embed/coops-venture-capital-meet',
    'venture-capital#15 https://archive.org/embed/e2c-journeys-BSW',
    'venture-capital#2 https://archive.org/embed/TimBrunsdenAttheCuttingEdgeofFundraising',
    'venture-capital#5 https://www.dailymotion.com/embed/video/xa4ecim',
]);
const rejected = (slug, n, embed) => REJECT.has(`${slug}#${n} ${embed}`);

/* ------------------------------------------------------------------ */
/* Legal and teaching filters                                          */
/* ------------------------------------------------------------------ */

// A paid course re-uploaded by someone else is not ours to show, whatever
// licence the uploader typed in. Brand names, rip-site names and the shape
// of a course dump ("053 The Java Class Library", "(35 - Part 8 ...)").
const RIP_TITLE = new RegExp([
    'udemy', 'coursera', 'linkedin\\s*learning', 'lynda', 'pluralsight', 'packt', 'skillshare', 'domestika',
    'masterclass', 'downloadly', 'freecoursesite', 'free\\s*course\\s*site', 'tutsgalaxy', 'course\\s*download',
    'bonus\\s*20\\d\\d', '\\[fcs\\]', 'getfreecourses', 'courseclub', 'tutflix', 'tutsnode', 'freetutorials',
    'cbt\\s*nuggets', 'itpro\\.?tv', 'infinite\\s*skills', 'udacity', 'educative', 'codecademy',
    'frontend\\s*masters', 'egghead', 'treehouse', 'zero\\s*to\\s*mastery', 'zero\\s*to\\s*hero', 'bootcamp',
    'eduonix', 'simplilearn', 'edureka', 'intellipaat', 'whizlabs', 'a\\s*cloud\\s*guru', 'linux\\s*academy',
    'kodekloud', '^\\s*\\[new\\]', '\\.ir\\b', 'corporate finance foundation',
    'mosh\\s*hamedani', 'premium\\s*courses?\\s*free', 'developer[-\\s]course', 'full\\s*course\\s*free\\s*download'
].join('|'), 'i');
const RIP_DESC = /downloadly|freecoursesite|free\s*course\s*site|tutsgalaxy|course\s*download|\[fcs\]|getfreecourses|tutsnode|paid\s*course\s*for\s*free|bonus\s*20\d\d/i;
// "10 Linux Terminal Tips" is a listicle, "14 Python programming" a track number.
const LISTICLE = /^\s*\d{1,2}\s+(?:\w+\s+){0,4}?(?:tips|reasons|ways|things|mistakes|habits|tools|patterns|tricks|questions|signs|rules|lessons|ideas|steps|myths|secrets|facts|examples|skills|strategies|principles|best|top|must)\b/i;

function isRip(title, desc) {
    const t = String(title || '');
    if (RIP_TITLE.test(t) || RIP_DESC.test(String(desc || ''))) return true;
    if (/^\s*0\d{1,2}\b/.test(t)) return true;                                       // "053 ", "007 "
    if (/^\s*\d{1,3}\s*[.)\-_:]\s*\S/.test(t) && !/^\s*\d+\.\d/.test(t)) return true; // "5. Flutter", "1 - What"
    if (/\(\s*\d{1,3}\s*-\s*/.test(t)) return true;                                    // "(35 - Part 8"
    if (/^\s*\d{1,3}\s+[A-Za-z]/.test(t) && !LISTICLE.test(t)) return true;            // "14 Python programming"
    return false;
}

const iaLicenceOk = (url) => /creativecommons\.org|publicdomain/i.test(String(url || ''));
// PeerTube licence ids: 1-6 are the Creative Commons licences, 7 public domain.
const PT_LICENCES = [1, 2, 3, 4, 5, 6, 7];

// Dailymotion has no licence field; it is kept only for teaching content.
const NOT_TEACHING = /\bnews\b|breaking|headlines|\bcnbc\b|bloomberg|reuters|\bfox\b|\bcnn\b|\bbbc\b|\bnbc\b|\bcbs\b|\bwion\b|\bndtv\b|times now|india today|al jazeera|press conference|\binterview\b|podcast|\btrailer\b|teaser|music video|\blyrics?\b|\bsong\b|\bvlog\b|reaction|reacts|\bprank\b|\bseason\s*\d|\bshow\b|market (?:update|wrap|close|open)|\bsensex\b|\bnifty\b|earnings call|\bkeynote\b|\bdebate\b|full movie|documentary|\bep\.?\s*\d|\bepisode\s*\d|day in the life|\breview\b|#ask|dragons'? den|shark tank|\bceo\b|\bmp\b|minister|budget 20\d\d/i;
const DM_CHANNELS = new Set(['school', 'tech']);

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
    const w = words.map((x) => `title:(${x}*) OR description:(${x})`).join(' OR ');
    const c = ctx.slice(0, 12).map((x) => (x.includes(' ') ? `"${x}"` : x)).join(' OR ');
    return `(${w}) AND (title:(${c}) OR description:(${c}) OR subject:(${c})) AND mediatype:(movies) AND (licenseurl:*creativecommons* OR licenseurl:*publicdomain*)`;
}

function asArray(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
const clean = (s) => String(asArray(s).join(' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

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

/** The item's metadata, which is the authority on licence and length. */
async function iaInfo(id) {
    const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (!meta || !meta.metadata) return null;
    if (meta.is_dark || meta.metadata.access_restricted_item === 'true') return null;
    const files = Array.isArray(meta.files) ? meta.files : [];
    // Several video files under one item usually means a playlist of parts:
    // the embed plays the first, so use the first original video's length.
    const vids = files.filter((f) => f.length && /\.(mp4|ogv|webm|mkv|avi|mov|mpe?g|m4v|flv)$/i.test(f.name || ''));
    const originals = vids.filter((f) => f.source === 'original');
    const first = (originals[0] || vids[0]);
    let sec = first ? parseRuntime(first.length) : null;
    if (sec == null) sec = parseRuntime(meta.metadata.runtime);
    return {
        sec,
        licence: String(meta.metadata.licenseurl || ''),
        title: clean(meta.metadata.title),
        desc: clean(meta.metadata.description).slice(0, 2000),
        collection: asArray(meta.metadata.collection).map(String)
    };
}

/** Checks one candidate against the legal rules. Returns a reason or ''. */
async function legal(v) {
    if (v.src === 'ia') {
        const id = decodeURIComponent(v.embed.split('/').pop());
        const info = v.info || await iaInfo(id);
        if (!info) return 'gone';
        v.info = info;
        if (isRip(v.title, info.desc)) return 'rip';
        if (!iaLicenceOk(info.licence)) return 'licence';
        if (info.collection.some((c) => IA_BAD_COLLECTION.test(c))) return 'licence';
        return '';
    }
    if (isRip(v.title, '')) return 'rip';
    if (v.src === 'pt') {
        // The data file does not store the licence: look the video up again.
        if (v.licence === undefined) {
            const data = await getJson('https://sepiasearch.org/api/v1/search/videos?search=' + encodeURIComponent(v.title) + '&count=50');
            const hit = ((data && data.data) || []).find((x) => x.embedUrl === v.embed);
            v.licence = hit && hit.licence ? hit.licence.id : null;
        }
        return PT_LICENCES.includes(v.licence) ? '' : 'licence';
    }
    if (v.src === 'dm') {
        if (v.channel === undefined) {
            const id = v.embed.split('/').pop();
            const data = await getJson(`https://api.dailymotion.com/video/${encodeURIComponent(id)}?fields=channel`);
            v.channel = data ? data.channel : null;
        }
        return (NOT_TEACHING.test(v.title) || !DM_CHANNELS.has(v.channel)) ? 'news' : '';
    }
    return '';
}

async function searchIA(t, lax) {
    const q = iaQuery(t.words, t.ctx);
    const fl = ['identifier', 'title', 'description', 'licenseurl', 'collection', 'language', 'runtime', 'downloads'];
    const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
        fl.map((f) => '&fl[]=' + f).join('') + '&sort[]=downloads+desc&rows=80&page=1&output=json';
    const data = await getJson(url);
    const docs = (data && data.response && data.response.docs) || [];
    const cands = [];
    for (const d of docs) {
        const id = String(d.identifier || '');
        if (!id || /^youtube-/i.test(id)) continue;
        if (asArray(d.collection).some((c) => IA_BAD_COLLECTION.test(String(c)))) continue;
        if (!iaLicenceOk(d.licenseurl)) continue;
        const title = String(Array.isArray(d.title) ? d.title[0] : d.title || '').trim();
        if (!title || LIVE.test(title) || looksForeign(title)) continue;
        const desc = clean(d.description).slice(0, 2000);
        if (isRip(title, desc)) continue;
        const langs = asArray(d.language).map((l) => String(l).toLowerCase().trim());
        if (langs.length ? !langs.some((l) => ENGLISH.has(l)) : !mostlyAscii(title)) continue;
        const score = match(t, title, desc, lax);
        if (!score) continue;
        cands.push({ src: 'ia', id, title, desc, score, runtime: d.runtime });
    }
    cands.sort((a, b) => b.score - a.score);
    const out = [];
    for (const c of cands.slice(0, lax ? 14 : 10)) {
        const info = await iaInfo(c.id);
        if (!info || !iaLicenceOk(info.licence)) continue;
        let sec = info.sec != null ? info.sec : parseRuntime(c.runtime);
        if (sec == null || sec < MIN_SEC || sec > MAX_SEC) continue;
        out.push({ src: 'ia', embed: `https://archive.org/embed/${encodeURIComponent(c.id)}`, title: c.title, minutes: Math.max(1, Math.round(sec / 60)), score: c.score, info, note: c.desc.slice(0, 160) });
    }
    return out;
}

async function searchPT(t, queries, lax) {
    const out = [];
    for (const q of queries) {
        const url = 'https://sepiasearch.org/api/v1/search/videos?search=' + encodeURIComponent(q) +
            '&count=40&start=0&languageOneOf=en&nsfw=false&durationMin=' + MIN_SEC + '&durationMax=' + MAX_SEC +
            PT_LICENCES.map((l) => '&licenceOneOf=' + l).join('') + '&sort=-match';
        const data = await getJson(url);
        for (const v of (data && data.data) || []) {
            if (v.isLive || v.nsfw) continue;
            if (!v.language || v.language.id !== 'en') continue;
            if (v.privacy && v.privacy.id !== 1) continue;
            if (!v.licence || !PT_LICENCES.includes(v.licence.id)) continue;
            const sec = Number(v.duration);
            if (!(sec >= MIN_SEC && sec <= MAX_SEC)) continue;
            const embed = String(v.embedUrl || '');
            if (!/^https:\/\//.test(embed)) continue;
            const title = String(v.name || '').trim();
            if (LIVE.test(title) || looksForeign(title) || isRip(title, '')) continue;
            const score = match(t, title, '', lax);
            if (!score) continue;
            out.push({ src: 'pt', embed, title, minutes: Math.round(sec / 60), score: score + 0.05, licence: v.licence.id, note: `${v.channel && v.channel.displayName} / ${v.licence.label}` });
        }
    }
    return out;
}

async function searchDM(t, queries, lax) {
    const out = [];
    for (const q of queries) {
        const url = 'https://api.dailymotion.com/videos?search=' + encodeURIComponent(q) +
            '&fields=id,title,duration,language,allow_embed,private,status,explicit,mode,onair,channel,owner.screenname' +
            '&languages=en&longer_than=3&shorter_than=60&sort=relevance&limit=40&family_filter=true';
        const data = await getJson(url);
        for (const v of (data && data.list) || []) {
            if (!v.allow_embed || v.private || v.status !== 'published' || v.explicit) continue;
            if (v.mode && v.mode !== 'vod') continue;
            if (v.onair) continue;
            if (v.language && v.language !== 'en') continue;
            if (!DM_CHANNELS.has(v.channel)) continue;
            const sec = Number(v.duration);
            if (!(sec >= MIN_SEC && sec <= MAX_SEC)) continue;
            const title = String(v.title || '').trim();
            if (!mostlyAscii(title) || LIVE.test(title) || looksForeign(title)) continue;
            if (NOT_TEACHING.test(title) || isRip(title, '')) continue;
            const score = match(t, title, '', lax);
            if (!score) continue;
            out.push({ src: 'dm', embed: `https://www.dailymotion.com/embed/video/${encodeURIComponent(v.id)}`, title, minutes: Math.round(sec / 60), score, channel: v.channel, note: `${v.channel} / ${v['owner.screenname']}` });
        }
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

// Technical terms in the topic's own text: "ArrayList", "JVM", "useEffect".
function keyTerms(technical, courseWords) {
    const out = [];
    const seen = new Set();
    for (const raw of String(technical || '').split(/[\s,;()—–]+/)) {
        const w = raw.replace(/^[^A-Za-z@#]+|[^A-Za-z0-9+#]+$/g, '');
        if (w.length < 3) continue;
        const codeLike = /[a-z][A-Z]|^[A-Z]{2,}[a-z]*s?$|[@#]|\.\w|\(\)/.test(w);
        if (!codeLike) continue;
        const s = stem(norm(w).replace(/[^a-z0-9+#]/g, ''));
        if (!s || seen.has(s) || GENERIC.has(s) || courseWords.has(s)) continue;
        seen.add(s);
        out.push({ word: w, stem: s });
    }
    return out.slice(0, 6);
}

/**
 * Strict (default): the title, or an Internet Archive description, carries
 * the topic's distinctive words (topicScore) AND ties to the course
 * (contextOk). Lax (--candidates only): one strong topic word or key term
 * plus the course context, for a human to judge.
 */
function match(t, title, desc, lax) {
    // Strict: the course tie must be in the title itself ("flutter" in an
    // aircraft-test description is not Flutter); a description may only
    // supply the topic words.
    const titleCtx = contextOk(title, t.ctx, t.not, lax ? null : t.words);
    if (!lax && !titleCtx) return 0;
    for (const text of [title, desc]) {
        if (!text) continue;
        if (text !== title && lax && !contextOk(text, t.ctx, t.not, null)) continue;
        if (text === title && !titleCtx) continue;
        let s = topicScore(t.words, text, t.courseWords);
        if (!s) {
            const set = stemSet(text);
            const hits = t.terms.filter((k) => set.has(k.stem)).length;
            if (hits >= 2 || (lax && hits >= 1)) s = 0.5 + hits * 0.1;
        }
        if (!s && lax) {
            const set = stemSet(text);
            const strong = t.words.filter((w) => !t.courseWords.has(w) && !WEAK.has(w) && !WEAK_STEMS.has(w));
            if (strong.some((w) => wordMatch(w, set))) s = 0.3;
        }
        if (s) return text === title ? s : s * 0.7;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* Per topic                                                           */
/* ------------------------------------------------------------------ */

const dedupeKey = (title) => tokens(title).join(' ').replace(/\b(part|pt|ep|episode)\s*\d*\b/g, '').replace(/\s+/g, ' ').trim();
const slim = (v) => ({ src: v.src, embed: v.embed, title: v.title, minutes: v.minutes });

function pick(all, keep, isRejected) {
    const seenEmbed = new Set(keep.map((v) => v.embed));
    const seenTitle = new Set(keep.map((v) => dedupeKey(v.title)));
    const ordered = [
        ...all.filter((v) => v.src !== 'dm').sort((a, b) => b.score - a.score),
        ...all.filter((v) => v.src === 'dm').sort((a, b) => b.score - a.score)
    ];
    const out = keep.map(slim);
    for (const v of ordered) {
        if (out.length >= MAX_VIDEOS) break;
        const k = dedupeKey(v.title);
        if (seenEmbed.has(v.embed) || seenTitle.has(k) || isRejected(v.embed)) continue;
        seenEmbed.add(v.embed);
        seenTitle.add(k);
        out.push(slim(v));
    }
    return out;
}

function topicContext(slug, topic) {
    const course = COURSES[slug];
    const ctx = course.ctx;
    const courseWords = new Set(ctx.filter((c) => !c.includes(' ')).map((c) => stem(norm(c))));
    let words = distinctive(topic.title, courseWords);
    if (!words.length && topic.videoSearch) words = distinctive(topic.videoSearch, courseWords);
    const terms = keyTerms(topic.technical, courseWords);
    if (!words.length) words = terms.map((k) => k.stem);
    return { course, words, terms, ctx, not: course.not || [], courseWords };
}

function queriesFor(slug, topic, t) {
    const cleanTitle = topic.title.replace(/[:,]/g, ' ').replace(/\b(the|done properly|in practice)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const prefix = t.ctx[0];
    const queries = [];
    const add = (q) => { q = q.replace(/\s+/g, ' ').trim(); if (q && !queries.some((x) => x.toLowerCase() === q.toLowerCase())) queries.push(q); };
    add(hasPhrase(cleanTitle, prefix) ? cleanTitle : `${prefix} ${cleanTitle}`);
    add(`${cleanTitle} ${t.course.name}`);
    if (topic.videoSearch) add(topic.videoSearch);
    if (t.terms.length) add(`${prefix} ${t.terms.slice(0, 2).map((k) => k.word).join(' ')} tutorial`);
    return queries;
}

async function findForTopic(slug, topic, lax) {
    const t = topicContext(slug, topic);
    if (!t.words.length) return { words: t.words, found: [] };
    const queries = queriesFor(slug, topic, t);
    const [ia, pt] = await Promise.all([searchIA(t, lax), searchPT(t, queries, lax)]);
    let found = [...ia, ...pt];
    const distinct = new Set(found.map((v) => dedupeKey(v.title))).size;
    if (lax || distinct < MAX_VIDEOS) found = found.concat(await searchDM(t, queries.slice(0, 3), lax));
    return { words: t.words, found };
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

/**
 * Usage:
 *   node scripts/learn/find-videos.js [--slug web-development] [--dry] [--all]
 *   node scripts/learn/find-videos.js --slug hr --candidates /tmp/hr.json
 *
 * Default: keep every existing video that still passes the legal rules and
 * is not in REJECT, and search only for topics left with fewer than 2.
 * --all searches every topic again (existing picks still come first).
 * --candidates writes every legal candidate, matched loosely, for a person
 * to judge; nothing in data/learn is touched.
 */
async function main() {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const all = args.includes('--all');
    const si = args.indexOf('--slug');
    const only = si >= 0 ? args[si + 1] : null;
    const ci = args.indexOf('--candidates');
    const candOut = ci >= 0 ? args[ci + 1] : null;
    const slugs = Object.keys(COURSES).filter((s) => !only || s === only);
    if (only && !slugs.length) { console.error('unknown slug: ' + only); process.exit(1); }

    const table = [];
    const dump = {};
    for (const slug of slugs) {
        const file = path.join(DATA_DIR, slug + '.json');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const topics = raw.topics || [];
        let covered = 0;
        let total = 0;
        const newTopics = [];
        dump[slug] = [];
        for (let i = 0; i < topics.length; i++) {
            const topic = topics[i];
            const keep = [];
            const dropped = [];
            for (const v of topic.videos || []) {
                const why = rejected(slug, i, v.embed) ? 'rejected' : await legal(v);
                if (why) dropped.push({ ...slim(v), why }); else keep.push(v);
            }
            let found = [];
            if (candOut || all || keep.length < 2) {
                try {
                    found = (await findForTopic(slug, topic, !!candOut)).found;
                } catch (err) {
                    console.error(`[${slug} #${i + 1}] ${err.message}`);
                }
            }
            const videos = pick(found, keep, (e) => rejected(slug, i, e));
            if (candOut) {
                const seen = new Set(keep.map((v) => v.embed));
                dump[slug].push({
                    n: i, title: topic.title, technical: topic.technical,
                    existing: keep.map(slim), dropped,
                    candidates: found.filter((v) => { if (seen.has(v.embed) || rejected(slug, i, v.embed)) return false; seen.add(v.embed); return true; })
                        .map((v) => ({ ...slim(v), note: v.note || '', score: Math.round(v.score * 100) / 100 }))
                });
            }
            if (videos.length) covered++;
            total += videos.length;
            console.log(`[${slug} #${i + 1}] ${topic.title}  kept ${keep.length}, dropped ${dropped.length} -> ${videos.length}`);
            for (const d of dropped) console.log(`     - ${d.why.padEnd(8)} ${d.title}`);
            for (const v of videos) console.log(`     ${v.src} ${String(v.minutes).padStart(2)}m  ${v.title}  <${v.embed}>`);
            newTopics.push(rewriteTopic(topic, videos));
        }
        if (!dry && !candOut) {
            raw.topics = newTopics;
            fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
        }
        table.push({ slug, topics: topics.length, covered, total });
    }
    if (candOut) fs.writeFileSync(candOut, JSON.stringify(dump, null, 1));

    console.log('\ncourse                      topics  with-video  videos');
    for (const r of table) console.log(`${r.slug.padEnd(28)}${String(r.topics).padStart(6)}${String(r.covered).padStart(12)}${String(r.total).padStart(8)}`);
    const sum = table.reduce((a, r) => ({ topics: a.topics + r.topics, covered: a.covered + r.covered, total: a.total + r.total }), { topics: 0, covered: 0, total: 0 });
    console.log(`${'TOTAL'.padEnd(28)}${String(sum.topics).padStart(6)}${String(sum.covered).padStart(12)}${String(sum.total).padStart(8)}`);
    if (dry || candOut) console.log('(nothing written to data/learn)');
}

if (require.main === module) {
    main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { distinctive, topicScore, contextOk, stemSet, parseRuntime, isRip, iaLicenceOk, keyTerms, NOT_TEACHING, REJECT, rejected };
