/*
 * Academics — the learning portal under the student dashboard.
 *
 * Mounted at /api/v2/academics. Page at /academics.
 *
 * Two things here are worth reading before changing anything: how a written
 * answer is marked (markAnswer), and when a failed student may try again
 * (attemptState). Both decide whether somebody progresses, so both are
 * deterministic and both explain themselves.
 */
'use strict';

const router   = require('express').Router();
const mongoose = require('mongoose');

let AcademicProgress = null;
try { AcademicProgress = require('../../models/new/AcademicProgress'); } catch (_e) { /* optional */ }
let DomainTask = null;
try { DomainTask = require('../../models/new/DomainTask'); } catch (_e) { /* optional */ }

/* ────────────────────────────── rules ─────────────────────────────── */

const PASS_MARK      = 70;          // percent
const MAX_ATTEMPTS   = 3;           // per window
const WINDOW_MS      = 24 * 60 * 60 * 1000;
const PREMIUM_AMOUNT = 999;         // rupees, per domain

/* Identity comes from the login session, never from the request body — the
   same rule as the assistant. A body-supplied employeeId can be edited in
   devtools, and this decides who has paid and who has passed. */
function sessionEmployeeId(req) {
  const s = req && req.session && req.session.student;
  return (s && (s.employeeId || s.employee_id)) ? String(s.employeeId || s.employee_id) : '';
}

function needSignIn(res) {
  return res.status(401).json({ error: 'Sign in on the portal, then reopen Academics.' });
}

const dbUp = () => mongoose.connection && mongoose.connection.readyState === 1;

/* ─────────────────────────── marking ──────────────────────────────── */

/*
 * A written answer is marked against the rubric points the question carries,
 * not against a similarity score.
 *
 * This decides whether a student unlocks the next module, so it has to be
 * explainable and appealable: "you covered 4 of the 6 required points, and
 * missed X and Y" is something a student can act on and a coordinator can
 * overturn. A cosine distance of 0.63 is not.
 *
 * Each rubric point carries its own accepted terms. A point is covered when
 * any of its terms appears, allowing for word endings and a one-character
 * slip. Points may be weighted; weight defaults to 1.
 */
const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Does `text` contain `term`, allowing word endings and one typo? */
function mentions(text, term) {
  const t = normalise(term);
  if (!t) { return false; }
  if (text.indexOf(t) !== -1) { return true; }
  // Multi-word terms are matched whole or not at all; single words get the
  // fuzzy pass, because "normalisation" and "normalization" are the same idea.
  if (t.indexOf(' ') !== -1) { return false; }
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length < 4 || t.length < 4) { continue; }
    if (w.indexOf(t) === 0 || t.indexOf(w) === 0) { return true; }
    if (Math.abs(w.length - t.length) <= 2 && editDistance(w, t) <= 1) { return true; }
  }
  return false;
}

/**
 * @param {string} answer         what the student wrote
 * @param {Array}  rubric         [{ point, terms: [], weight }]
 * @param {number} minWords       answers shorter than this cannot pass
 * @returns {{score, passed, covered, missed, tooShort}}
 */
function markAnswer(answer, rubric, minWords) {
  const text  = normalise(answer);
  const words = text ? text.split(' ').length : 0;
  const need  = typeof minWords === 'number' ? minWords : 25;
  const list  = Array.isArray(rubric) ? rubric : [];

  const covered = [];
  const missed  = [];
  let got = 0, total = 0;

  list.forEach(function (r) {
    const weight = typeof r.weight === 'number' ? r.weight : 1;
    total += weight;
    const terms = Array.isArray(r.terms) && r.terms.length ? r.terms : [r.point];
    const hit = terms.some(function (t) { return mentions(text, t); });
    if (hit) { covered.push(r.point); got += weight; } else { missed.push(r.point); }
  });

  const score = total > 0 ? Math.round((got / total) * 100) : 0;

  /* A very short answer that happens to name the right words is not an answer.
     Without this, "caching, indexing, sharding" scores 100 on a question that
     asked the student to explain them. */
  const tooShort = words < need;

  return {
    score: score,
    passed: score >= PASS_MARK && !tooShort,
    covered: covered,
    missed: missed,
    tooShort: tooShort,
    words: words,
  };
}

/* ─────────────────────── attempts and the window ──────────────────── */

/*
 * Three attempts per 24 hours, measured from the FIRST attempt of the group.
 *
 * Worked example, which is the case that makes the rule non-obvious: attempts
 * at 09:00, 11:00 and 15:00, all failed. The fourth unlocks at 09:00 the next
 * day — 24h after the first of the three, not after the last.
 */
function attemptState(attempts, now) {
  const t = now instanceof Date ? now.getTime() : Date.now();
  const past = (attempts || []).map(function (a) { return new Date(a.at).getTime(); })
    .filter(function (n) { return !isNaN(n); })
    .sort(function (a, b) { return a - b; });

  // Only attempts inside the live window count against the allowance.
  const live = past.filter(function (n) { return t - n < WINDOW_MS; });
  if (live.length < MAX_ATTEMPTS) {
    return { allowed: true, remaining: MAX_ATTEMPTS - live.length, unlocksAt: null };
  }
  const unlocksAt = new Date(live[0] + WINDOW_MS);
  return { allowed: false, remaining: 0, unlocksAt: unlocksAt };
}

/* ───────────────────────── progress helpers ───────────────────────── */

async function progressFor(employeeId, domain) {
  if (!AcademicProgress) { return null; }
  let row = await AcademicProgress.findOne({ employeeId: employeeId, domain: domain });
  if (!row) {
    row = await AcademicProgress.create({ employeeId: employeeId, domain: domain, modules: [] });
  }
  return row;
}

function moduleOf(row, moduleKey) {
  let m = row.modules.filter(function (x) { return x.moduleKey === moduleKey; })[0];
  if (!m) {
    row.modules.push({ moduleKey: moduleKey, attempts: [] });
    m = row.modules[row.modules.length - 1];
  }
  return m;
}

/** A module is open when it is the first, or the one before it was passed. */
function unlockedThrough(row, curriculum) {
  let open = 0;
  for (let i = 0; i < curriculum.length; i++) {
    const m = row.modules.filter(function (x) { return x.moduleKey === curriculum[i].key; })[0];
    if (m && m.passed) { open = i + 1; } else { break; }
  }
  return open;
}

/* ──────────────────────────── curriculum ──────────────────────────── */

/*
 * Modules are derived from the task library the portal already runs on, so a
 * domain's Academics content matches the weeks a student is actually assigned.
 * The rubric is generated from the task title and description until real
 * course content is written — see docs/academics-career-portal-spec.md §6.2,
 * which is the largest open item in the brief.
 */
function rubricFromTask(task) {
  const title = String(task.taskTitle || '');
  const desc  = String(task.taskDescription || '');
  const words = normalise(title + ' ' + desc).split(' ')
    .filter(function (w) { return w.length > 4; });
  const seen = {};
  const key = words.filter(function (w) {
    if (seen[w]) { return false; } seen[w] = 1; return true;
  }).slice(0, 6);

  return key.map(function (w) {
    return { point: 'Explains "' + w + '" and how it applies here', terms: [w], weight: 1 };
  });
}

async function curriculumFor(domain) {
  if (!DomainTask || !dbUp()) { return []; }
  const rows = await DomainTask.find({ domain: domain, durationType: '3months' })
    .sort({ weekNumber: 1 }).lean();
  return rows.map(function (t, i) {
    return {
      key: 'm' + (i + 1),
      index: i + 1,
      title: t.taskTitle || ('Module ' + (i + 1)),
      summary: t.taskDescription || '',
      difficulty: t.difficultyLevel || 'easy',
      coins: t.coinReward || 0,
      project: {
        title: t.taskTitle || ('Project ' + (i + 1)),
        brief: t.taskDescription || '',
      },
      assessment: {
        question: 'In your own words, explain what you built in "' + (t.taskTitle || 'this module')
          + '", the decisions you made, and why. Cover each idea the module introduced.',
        minWords: 60,
        rubric: rubricFromTask(t),
      },
    };
  });
}

/* ───────────────────────────── routes ─────────────────────────────── */

// GET /api/v2/academics/overview — the four Academics cards and their state.
router.get('/overview', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  let enrolled = [];
  if (employeeId && AcademicProgress && dbUp()) {
    try {
      enrolled = await AcademicProgress.find({ employeeId: employeeId })
        .select('domain paid certificateIssued modules').lean();
    } catch (_e) { enrolled = []; }
  }
  return res.json({
    signedIn: !!employeeId,
    premiumAmount: PREMIUM_AMOUNT,
    passMark: PASS_MARK,
    maxAttempts: MAX_ATTEMPTS,
    sections: [
      { key: 'student',    label: 'Student',    sub: 'Domains — 14 learning tracks', premium: true,  ready: true },
      { key: 'job',        label: 'Job',        sub: 'Job findings',                 premium: true,  ready: false },
      { key: 'resume',     label: 'Resume',     sub: 'Builder and checker',          premium: false, ready: false },
      { key: 'hackathons', label: 'Hackathons', sub: 'Idea-thons and hackathons',    premium: false, ready: false },
    ],
    enrolled: enrolled.map(function (e) {
      return {
        domain: e.domain, paid: !!e.paid, certificate: !!e.certificateIssued,
        passed: (e.modules || []).filter(function (m) { return m.passed; }).length,
      };
    }),
  });
});

// GET /api/v2/academics/domains — every domain, with progress when signed in.
router.get('/domains', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  let domains = [];
  try { domains = DomainTask && dbUp() ? await DomainTask.distinct('domain') : []; } catch (_e) { domains = []; }
  domains.sort();

  let mine = {};
  if (employeeId && AcademicProgress && dbUp()) {
    try {
      const rows = await AcademicProgress.find({ employeeId: employeeId }).lean();
      rows.forEach(function (r) {
        mine[r.domain] = {
          paid: !!r.paid,
          certificate: !!r.certificateIssued,
          passed: (r.modules || []).filter(function (m) { return m.passed; }).length,
        };
      });
    } catch (_e) { mine = {}; }
  }
  return res.json({
    signedIn: !!employeeId,
    domains: domains.map(function (d) { return { domain: d, progress: mine[d] || null }; }),
  });
});

// GET /api/v2/academics/domain/:domain — modules, lock state, attempt state.
router.get('/domain/:domain', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  if (!employeeId) { return needSignIn(res); }
  if (!dbUp()) { return res.status(503).json({ error: 'Database unavailable. Try again shortly.' }); }

  try {
    const domain = String(req.params.domain);
    const curriculum = await curriculumFor(domain);
    if (!curriculum.length) { return res.status(404).json({ error: 'No curriculum for ' + domain + '.' }); }

    const row  = await progressFor(employeeId, domain);
    const open = unlockedThrough(row, curriculum);
    const now  = new Date();

    const modules = curriculum.map(function (c, i) {
      const m = row.modules.filter(function (x) { return x.moduleKey === c.key; })[0];
      const st = attemptState(m ? m.attempts : [], now);
      return {
        key: c.key, index: c.index, title: c.title, summary: c.summary,
        difficulty: c.difficulty, coins: c.coins,
        locked: i > open,
        passed: !!(m && m.passed),
        bestScore: m ? m.bestScore : 0,
        projectDone: !!(m && m.projectDone),
        attemptsUsed: m ? m.attempts.length : 0,
        canAttempt: st.allowed,
        attemptsLeft: st.remaining,
        unlocksAt: st.unlocksAt,
      };
    });

    const allPassed = modules.every(function (m) { return m.passed; });
    return res.json({
      domain: domain,
      paid: !!row.paid,
      deferred: !!row.deferredAt,
      passMark: PASS_MARK,
      maxAttempts: MAX_ATTEMPTS,
      premiumAmount: PREMIUM_AMOUNT,
      modules: modules,
      complete: allPassed,
      // The second payment moment. No skip on this one.
      certificateBlocked: allPassed && !row.paid,
      certificateIssued: !!row.certificateIssued,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not load the domain.' });
  }
});

// POST /api/v2/academics/defer — "continue to modules", the pay-later choice.
router.post('/defer', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  if (!employeeId) { return needSignIn(res); }
  if (!dbUp()) { return res.status(503).json({ error: 'Database unavailable.' }); }
  try {
    const row = await progressFor(employeeId, String((req.body || {}).domain || ''));
    if (!row) { return res.status(400).json({ error: 'Pick a domain first.' }); }
    if (!row.deferredAt) { row.deferredAt = new Date(); await row.save(); }
    return res.json({ ok: true, deferred: true, message: 'Study away. Payment is only needed for the certificate.' });
  } catch (_e) { return res.status(500).json({ error: 'Could not save that.' }); }
});

// GET /api/v2/academics/assessment/:domain/:moduleKey — the question, never the rubric.
router.get('/assessment/:domain/:moduleKey', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  if (!employeeId) { return needSignIn(res); }
  if (!dbUp()) { return res.status(503).json({ error: 'Database unavailable.' }); }
  try {
    const domain = String(req.params.domain);
    const curriculum = await curriculumFor(domain);
    const c = curriculum.filter(function (x) { return x.key === req.params.moduleKey; })[0];
    if (!c) { return res.status(404).json({ error: 'No such module.' }); }

    const row = await progressFor(employeeId, domain);
    const idx = curriculum.indexOf(c);
    if (idx > unlockedThrough(row, curriculum)) {
      return res.status(403).json({ error: 'Finish the module before this one first.' });
    }
    const m  = moduleOf(row, c.key);
    const st = attemptState(m.attempts, new Date());

    return res.json({
      domain: domain, moduleKey: c.key, title: c.title,
      question: c.assessment.question,
      minWords: c.assessment.minWords,
      // The number of things to cover, but not what they are.
      pointCount: c.assessment.rubric.length,
      passMark: PASS_MARK,
      canAttempt: st.allowed,
      attemptsLeft: st.remaining,
      unlocksAt: st.unlocksAt,
      alreadyPassed: !!m.passed,
    });
  } catch (_e) { return res.status(500).json({ error: 'Could not load the assessment.' }); }
});

// POST /api/v2/academics/assessment — mark one written answer.
router.post('/assessment', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  if (!employeeId) { return needSignIn(res); }
  if (!dbUp()) { return res.status(503).json({ error: 'Database unavailable.' }); }

  try {
    const body      = req.body || {};
    const domain    = String(body.domain || '');
    const moduleKey = String(body.moduleKey || '');
    const answer    = String(body.answer || '');

    const curriculum = await curriculumFor(domain);
    const c = curriculum.filter(function (x) { return x.key === moduleKey; })[0];
    if (!c) { return res.status(404).json({ error: 'No such module.' }); }

    const row = await progressFor(employeeId, domain);
    if (curriculum.indexOf(c) > unlockedThrough(row, curriculum)) {
      return res.status(403).json({ error: 'Finish the module before this one first.' });
    }

    const m = moduleOf(row, moduleKey);
    if (m.passed) {
      return res.json({ alreadyPassed: true, score: m.bestScore, passed: true,
        message: 'You have already passed this module.' });
    }

    const now = new Date();
    const st  = attemptState(m.attempts, now);
    if (!st.allowed) {
      return res.status(429).json({
        error: 'attempts_exhausted',
        message: 'You have used all ' + MAX_ATTEMPTS + ' attempts. The next one opens at '
          + st.unlocksAt.toLocaleString('en-IN') + '.',
        unlocksAt: st.unlocksAt, attemptsLeft: 0,
      });
    }

    const marked = markAnswer(answer, c.assessment.rubric, c.assessment.minWords);
    m.attempts.push({ at: now, score: marked.score, passed: marked.passed,
                      covered: marked.covered, missed: marked.missed });
    if (marked.score > m.bestScore) { m.bestScore = marked.score; }
    if (marked.passed) { m.passed = true; }

    const after = attemptState(m.attempts, now);
    const done  = curriculum.every(function (x) {
      const mm = row.modules.filter(function (y) { return y.moduleKey === x.key; })[0];
      return mm && mm.passed;
    });
    if (done && !row.completedAt) { row.completedAt = now; }
    await row.save();

    return res.json({
      score: marked.score,
      passed: marked.passed,
      passMark: PASS_MARK,
      tooShort: marked.tooShort,
      words: marked.words,
      // Told plainly, because a student who fails has to know what to fix and a
      // coordinator has to be able to overturn it.
      covered: marked.covered,
      missed: marked.missed,
      attemptsLeft: after.remaining,
      unlocksAt: after.unlocksAt,
      domainComplete: done,
      certificateBlocked: done && !row.paid,
    });
  } catch (_e) { return res.status(500).json({ error: 'Could not mark that answer.' }); }
});

// POST /api/v2/academics/project — mark a project done, or record a skip.
router.post('/project', async (req, res) => {
  const employeeId = sessionEmployeeId(req);
  if (!employeeId) { return needSignIn(res); }
  if (!dbUp()) { return res.status(503).json({ error: 'Database unavailable.' }); }
  try {
    const body = req.body || {};
    const row  = await progressFor(employeeId, String(body.domain || ''));
    const m    = moduleOf(row, String(body.moduleKey || ''));
    if (body.skip) {
      // Recorded, not blocked. A hard block strands anyone who genuinely
      // cannot finish; the argument against skipping is made in the UI.
      m.projectSkipped = true;
    } else {
      m.projectDone = true; m.projectSkipped = false;
    }
    await row.save();
    return res.json({ ok: true, projectDone: m.projectDone, projectSkipped: m.projectSkipped });
  } catch (_e) { return res.status(500).json({ error: 'Could not save that.' }); }
});

// GET /api/v2/academics/health
router.get('/health', async (req, res) => {
  const out = { database: dbUp() ? 'connected' : 'disconnected', passMark: PASS_MARK,
                maxAttempts: MAX_ATTEMPTS, windowHours: WINDOW_MS / 3600000, notes: [] };
  try { out.domains = DomainTask && dbUp() ? (await DomainTask.distinct('domain')).length : 0; }
  catch (_e) { out.domains = 0; }
  if (!dbUp()) { out.notes.push('Mongo is unreachable; Academics needs it.'); }
  if (!out.domains) { out.notes.push('No domains — run the DomainTask seed.'); }
  if (!out.notes.length) { out.notes.push('All good.'); }
  return res.json(out);
});

module.exports = router;
module.exports.markAnswer = markAnswer;
module.exports.attemptState = attemptState;
module.exports.PASS_MARK = PASS_MARK;
module.exports.MAX_ATTEMPTS = MAX_ATTEMPTS;
module.exports.WINDOW_MS = WINDOW_MS;
