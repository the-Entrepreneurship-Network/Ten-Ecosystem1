'use strict';

/**
 * The AI pre-check of a task submission.
 *
 * Before a coordinator opens a submission, the portal checks:
 *   - that the link opens for someone who is not signed in;
 *   - for a GitHub link, that the repository is public (and not empty);
 *   - that the screenshot is attached;
 *   - and, with Gemini (free tier), whether the work matches the task,
 *     with a draft of the feedback.
 * The result is stored on the submission as `aiCheck`. The coordinator sees it
 * on the card, with the draft already in the feedback box, so approving is one
 * click. Nothing here approves or rejects: that is the coordinator, or for the
 * clear cases the AI Coordinator's review in services/aiCoordinatorJobs.js,
 * both through the same path, because certificates depend on it.
 *
 * This replaces the old step that wrote Gemini's text straight into `feedback`,
 * where the student saw it as "COORDINATOR FEEDBACK" before any coordinator had
 * looked, and which never opened the link.
 */

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const gemini = require('../utils/gemini');
const { httpFetch } = require('./v2/httpFetch');

const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (compatible; TEN-portal-link-check)';

// ── Opening a link safely ────────────────────────────────────────────────

/*
 * The address comes from a student, and the server is the one opening it, so
 * it must not be able to reach the server's own network: localhost, the
 * private ranges, or the cloud metadata address (169.254.169.254) that hands
 * out the machine's credentials. Every hop of a redirect is checked again, and
 * the connection goes to the address that was checked, not a second lookup.
 */
function isPublicAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b, c] = ip.split('.').map(Number);
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;     // shared address space
        if (a === 169 && b === 254) return false;                // link-local, cloud metadata
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
        if (a === 198 && (b === 18 || b === 19)) return false;
        return true;
    }
    if (net.isIPv6(ip)) {
        const x = ip.toLowerCase();
        if (x.startsWith('::ffff:')) return isPublicAddress(x.slice(7));
        if (x === '::' || x === '::1' || x.startsWith('ff')) return false;
        if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return false;   // unique-local, link-local
        return true;
    }
    return false;
}

function guardedLookup(hostname, options, callback) {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) {
            return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
        }
        // Newer Node asks for every address at once.
        if (options && options.all) return callback(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
    });
}

/** Each one is read after "The link does not open: it …". */
const WHY = {
    EBLOCKED: 'points inside a private network',
    ENOTFOUND: 'points to an address that does not exist',
    EAI_AGAIN: 'points to an address that does not exist',
    ECONNREFUSED: 'was refused by the site',
    ECONNRESET: 'was cut off by the site',
    ETIMEDOUT: 'got no answer from the site in time',
    CERT_HAS_EXPIRED: 'is on a site whose certificate has expired'
};

/**
 * One request: the status and the redirect target, never the body.
 * `lookup` and `anyPort` exist for the tests, which run a server on localhost.
 */
function requestOnce(url, { timeoutMs = 8000, lookup = guardedLookup, anyPort = false } = {}) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(url); } catch (_) { return resolve({ error: 'is not a web address' }); }
        if (!/^https?:$/.test(u.protocol)) return resolve({ error: 'is not a web address' });
        if (!anyPort && u.port && u.port !== '80' && u.port !== '443') return resolve({ error: 'uses an unusual port' });
        const host = u.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && !isPublicAddress(host)) return resolve({ error: WHY.EBLOCKED });

        let settled = false;
        const done = (r) => { if (!settled) { settled = true; resolve(r); } };
        const req = (u.protocol === 'https:' ? https : http).request(u, {
            method: 'GET', lookup, timeout: timeoutMs,
            headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' }
        }, (res) => {
            done({ status: res.statusCode, location: res.headers.location || '' });
            res.destroy();   // only the status matters; do not download the page
        });
        req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
        req.on('error', (err) => done({ error: WHY[err.code] || 'could not be opened (' + (err.code || err.message) + ')', code: err.code }));
        req.end();
    });
}

/** "github.com/me/repo" is how people type it: give it a scheme. */
function normalizeUrl(raw) {
    const s = String(raw || '').trim().split(/\s+/)[0] || '';
    if (!s) return '';
    return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
}

/** The first web address in some text, or a bare "mysite.netlify.app". */
function firstUrl(...texts) {
    for (const t of texts) {
        const m = String(t || '').match(/\b(?:https?:\/\/|www\.|github\.com\/|drive\.google\.com\/)[^\s<>"')]+/i);
        if (m) return normalizeUrl(m[0].replace(/[.,;:!?]+$/, ''));
    }
    const bare = String(texts[0] || '').trim();
    return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(bare) ? normalizeUrl(bare) : '';
}

/**
 * Does the link open for someone who is not signed in?
 * verdict: opens | login | broken | down | unknown | missing
 */
/** A sign-in page: where a link that is not shared publicly sends a visitor. */
function isSignIn(url) {
    try {
        const u = new URL(url);
        return /(^|\.)accounts\.google\.com$/i.test(u.hostname) || /\/(ServiceLogin|signin|login)\b/i.test(u.pathname);
    } catch (_) {
        return false;
    }
}

async function checkLink(raw, opts = {}) {
    let url = normalizeUrl(raw);
    if (!url) return { verdict: 'missing' };
    for (let hop = 0; hop < 5; hop += 1) {
        const r = await requestOnce(url, opts);
        if (r.error) return { url, verdict: r.code === 'ETIMEDOUT' ? 'unknown' : 'broken', error: r.error };
        if (r.status >= 300 && r.status < 400 && r.location) {
            try { url = new URL(r.location, url).toString(); } catch (_) { return { url, verdict: 'broken', error: 'redirects to a bad address' }; }
            // No need to open the sign-in page itself: being sent there is the answer.
            if (isSignIn(url)) return { url, verdict: 'login', status: r.status };
            continue;
        }
        if (isSignIn(url)) return { url, verdict: 'login', status: r.status };
        if (r.status >= 200 && r.status < 300) return { url, verdict: 'opens', status: r.status };
        if (r.status === 401 || r.status === 403) return { url, verdict: 'login', status: r.status };
        if (r.status === 404 || r.status === 410) return { url, verdict: 'broken', status: r.status, error: 'is not there (' + r.status + ')' };
        if (r.status >= 500) return { url, verdict: 'down', status: r.status };
        return { url, verdict: 'unknown', status: r.status };   // 429, LinkedIn's 999 and the like
    }
    return { url, verdict: 'broken', error: 'redirects too many times' };
}

// ── GitHub ───────────────────────────────────────────────────────────────

function parseGitHub(url) {
    try {
        const u = new URL(normalizeUrl(url));
        if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
        const [owner, repo] = u.pathname.split('/').filter(Boolean);
        if (!owner) return null;
        return repo ? { owner, repo: repo.replace(/\.git$/i, '') } : { owner };
    } catch (_) {
        return null;
    }
}

let tokenRefused = false;
const githubHeaders = () => Object.assign(
    { 'User-Agent': 'TEN-portal', Accept: 'application/vnd.github+json' },
    process.env.GITHUB_TOKEN && !tokenRefused ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}
);

/**
 * The repository as an anonymous visitor sees it. Without GITHUB_TOKEN GitHub
 * allows 60 lookups an hour from the server (two per check); past that the
 * repository part says "not checked" and the coordinator can press Re-check.
 */
async function githubRepo({ owner, repo }) {
    const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
        let res = await httpFetch(base, { headers: githubHeaders(), timeoutMs: 8000 });
        // An expired or wrong GITHUB_TOKEN makes GitHub refuse everything (401),
        // public repositories included. Asking anonymously still works.
        if (res.status === 401 && process.env.GITHUB_TOKEN && !tokenRefused) {
            tokenRefused = true;
            console.warn('[pre-check] GitHub refused GITHUB_TOKEN; checking repositories without it.');
            res = await httpFetch(base, { headers: githubHeaders(), timeoutMs: 8000 });
        }
        if (res.status === 404) return { public: false };
        if (res.status === 403 || res.status === 429) return { unknown: 'GitHub\'s hourly limit was reached' };
        if (!res.ok) return { unknown: 'GitHub answered ' + res.status };
        const j = await res.json();
        const out = {
            public: !j.private, fullName: j.full_name || `${owner}/${repo}`, description: String(j.description || '').slice(0, 300),
            language: j.language || '', branch: j.default_branch || 'main', pushedAt: j.pushed_at || null,
            empty: j.size === 0, files: [], readme: ''
        };
        if (out.empty) return out;
        const [list, readme] = await Promise.all([
            httpFetch(base + '/contents', { headers: githubHeaders(), timeoutMs: 8000 })
                .then((r) => (r.ok ? r.json() : [])).catch(() => []),
            httpFetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(out.branch)}/README.md`,
                { headers: { 'User-Agent': 'TEN-portal' }, timeoutMs: 8000 })
                .then((r) => (r.ok ? r.text() : '')).catch(() => '')
        ]);
        out.files = Array.isArray(list) ? list.slice(0, 40).map((f) => f.name + (f.type === 'dir' ? '/' : '')) : [];
        out.readme = String(readme || '').slice(0, 2500);
        return out;
    } catch (err) {
        return { unknown: 'GitHub could not be reached' };
    }
}

// ── Putting it together ──────────────────────────────────────────────────

const scrub = (s) => require('./aiCoordinator').scrub(s);

const SCHEMA = {
    type: gemini.Type.OBJECT,
    properties: {
        match: { type: gemini.Type.STRING },
        reason: { type: gemini.Type.STRING },
        draft: { type: gemini.Type.STRING },
        decision: { type: gemini.Type.STRING }
    },
    required: ['match', 'draft', 'decision']
};

function linkLine(link) {
    return ({
        opens: 'opens for anyone',
        login: 'asks the reader to sign in, so it is not shared publicly',
        broken: 'does not open: it ' + (link.error || 'failed'),
        down: 'the site was not working when checked',
        unknown: 'could not be checked automatically',
        missing: 'no link was given'
    })[link.verdict] || 'not checked';
}

/** What a coordinator must not miss, in plain words. Also what the student is told. */
function problemsOf({ link, github, repo, screenshot }) {
    const out = [];
    if (link.verdict === 'missing') out.push('There is no link to the work.');
    if (link.verdict === 'broken') out.push(`The link does not open: it ${link.error || 'failed'}.`);
    if (link.verdict === 'login') out.push('The link asks for a sign-in, so reviewers cannot open it. Share it with "Anyone with the link".');
    if (github && !github.repo) out.push('The GitHub link is a profile, not a repository. Link the repository itself.');
    if (repo && repo.public === false) out.push('The GitHub repository is private or does not exist. Make it public.');
    if (repo && repo.empty) out.push('The GitHub repository is empty.');
    if (screenshot.expected && !screenshot.present) out.push('No screenshot is attached.');
    return out;
}

function draftWithoutAi(task, problems) {
    return problems.length
        ? `Thanks for submitting "${task}". Before it can be approved: ${problems.join(' ')} Please fix this and submit it again.`
        : `Thanks for submitting "${task}". The link opens and everything needed is attached.`;
}

/**
 * Check a submission and store the result. Never throws.
 * @param {string} id the Submission _id
 * @param {{screenshotExpected?: boolean, notify?: boolean}} [opts] notify: tell the
 *        student about a problem (the first check only, not a coordinator's re-check)
 * @returns {Promise<object|null>} the aiCheck stored, or null
 */
async function run(id, { screenshotExpected = true, notify = true } = {}) {
    try {
        if (/^(off|false|0|no)$/i.test(String(process.env.AI_COORDINATOR || 'on').trim())) return null;
        const Submission = mongoose.model('Submission');
        const sub = await Submission.findById(id).lean();
        if (!sub || sub.reviewedOnce) return null;

        const url = firstUrl(sub.githubLink, sub.note);
        const github = url ? parseGitHub(url) : null;
        // Through module.exports, so a test can stand in for the network.
        const [link, repo] = await Promise.all([
            module.exports.checkLink(url),
            github && github.repo ? module.exports.githubRepo(github) : Promise.resolve(null)
        ]);
        const screenshot = {
            expected: !!screenshotExpected,
            present: !!sub.image && fs.existsSync(path.join(ROOT, String(sub.image).replace(/^\/+/, '')))
        };
        const problems = problemsOf({ link, github, repo, screenshot });
        const task = String(sub.task || 'the task').slice(0, 200);

        const check = {
            at: new Date(),
            link: { url: link.url || url, verdict: link.verdict, status: link.status || null, error: link.error || '' },
            repo: repo ? {
                public: repo.public, fullName: repo.fullName || '', language: repo.language || '',
                pushedAt: repo.pushedAt || null, empty: !!repo.empty, unknown: repo.unknown || ''
            } : null,
            screenshot,
            problems,
            match: 'unclear',
            reason: '',
            draft: draftWithoutAi(task, problems),
            decision: problems.length ? 'changes' : 'approve',
            by: 'rules'
        };

        if (gemini.ready()) {
            try {
                const DomainTask = require('../models/new/DomainTask');
                const def = await DomainTask.findOne({ taskTitle: sub.task }).select('taskDescription').lean().catch(() => null);
                const prompt = [
                    `You help a coordinator of TEN's ${sub.domain || ''} virtual internship review an intern's task submission. ` +
                    'You do not decide: the coordinator does.',
                    `Task: "${task}"`,
                    def && def.taskDescription ? `Task description: ${String(def.taskDescription).slice(0, 1200)}` : '',
                    `The intern's note: "${scrub(String(sub.note || '')).slice(0, 600)}"`,
                    'What the portal checked:',
                    `- The link ${linkLine(link)}.`,
                    repo ? (repo.unknown ? `- GitHub: ${repo.unknown}, so the repository was not checked.`
                        : `- GitHub repository ${repo.fullName || ''}: ${repo.public ? 'public' : 'private or missing'}` +
                          `${repo.empty ? ', empty' : ''}${repo.language ? ', mostly ' + repo.language : ''}` +
                          `${repo.description ? ', described as "' + repo.description + '"' : ''}.`) : '',
                    repo && repo.files && repo.files.length ? `- Files at the top of the repository: ${repo.files.join(', ')}` : '',
                    screenshot.expected ? `- Screenshot: ${screenshot.present ? 'attached' : 'missing'}.` : '',
                    repo && repo.readme ? `README (start):\n${repo.readme}` : '',
                    '',
                    'Say whether the work matches the task: "yes", "partly", "no", or "unclear" when there is too little to tell. ' +
                    'Give the reason in one short sentence.',
                    'Write a draft of the feedback the coordinator could send the intern: 2 to 4 sentences, under 80 words, ' +
                    'specific to this task, kind and direct. If a check failed, say exactly what to fix.',
                    'Suggest "approve" when the checks pass and the work matches the task; otherwise "changes".',
                    'Answer with JSON: "match", "reason", "draft", "decision".'
                ].filter(Boolean).join('\n');
                const out = await gemini.ask(prompt, SCHEMA);
                const m = String((out && out.match) || '').toLowerCase();
                const draft = String((out && out.draft) || '').trim();
                if (draft) {
                    check.match = ['yes', 'partly', 'no'].includes(m) ? m : 'unclear';
                    check.reason = String((out && out.reason) || '').trim().slice(0, 300);
                    check.draft = draft.slice(0, 1200);
                    // A failed check is never "approve", whatever the model says,
                    // and a model that would approve it wrote praise: the checks'
                    // own draft, which says what to fix, goes in the box instead.
                    const wouldApprove = /approve/i.test(String(out.decision || ''));
                    check.decision = !problems.length && wouldApprove ? 'approve' : 'changes';
                    if (problems.length && wouldApprove) check.draft = draftWithoutAi(task, problems);
                    check.by = 'ai';
                }
            } catch (err) {
                console.warn('[pre-check] Gemini did not answer:', err.message);
            }
        }
        // Nor can it say work matches the task when nobody could open the work.
        if (link.verdict !== 'opens' && !(repo && repo.public)) {
            check.match = 'unclear';
            check.reason = 'The work could not be opened, so it was not compared with the task.';
        }

        const saved = await Submission.updateOne({ _id: sub._id, reviewedOnce: { $ne: true } }, { $set: { aiCheck: check } });
        const stored = !!(saved && (saved.modifiedCount || saved.nModified));
        if (stored) logCheck(sub, task, check);
        if (notify && problems.length && stored) await tellStudent(sub, task, problems);
        return check;
    } catch (err) {
        console.error('[pre-check] failed:', err.message);
        return null;
    }
}

/** For the daily report and the backlog's daily limit. A log that fails changes nothing else. */
function logCheck(sub, task, check) {
    try {
        require('../models/AiCoordinatorLog').create({
            kind: 'precheck', employeeId: sub.employeeId || '', domain: sub.domain || '',
            question: task, reply: check.problems.join(' ').slice(0, 1000), source: check.decision, reason: check.by
        }).catch((err) => console.error('[pre-check] log failed:', err.message));
    } catch (err) {
        console.error('[pre-check] log failed:', err.message);
    }
}

/** A problem the student can fix now: in the portal and on their phone, not by email. */
async function tellStudent(sub, task, problems) {
    try {
        const Notification = require('../models/Notification');
        const note = new Notification({
            title: `Check your submission: ${task}`.slice(0, 140),
            message: `The portal's AI pre-check found: ${problems.join(' ')} Your coordinator sees this too. ` +
                'If you can fix it now, for example by making the repository public, do: they open the link when they review.',
            type: 'warning',
            from: 'TEN AI Coordinator',
            targetType: 'student',
            targetEmployeeId: sub.employeeId,
            targetDomain: sub.domain || ''
        });
        note.$locals.skipEmail = true;
        await note.save();
    } catch (err) {
        console.error('[pre-check] student notice failed:', err.message);
    }
}

module.exports = {
    run, checkLink, parseGitHub, githubRepo, firstUrl, isPublicAddress,
    _internal: { requestOnce, guardedLookup, problemsOf, draftWithoutAi, normalizeUrl }
};
