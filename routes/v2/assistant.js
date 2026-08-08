/*
 * TEN Assistant — a self-contained section, new in this change.
 *
 * Replaces the old Gemini-backed bot (routes/v2/bots.js, removed). It answers
 * from this portal's own data instead of a language model: the DomainTask
 * collection already holds the seeded curriculum — 14 domains across four
 * duration tracks — so week numbers, task titles, coin values and difficulty
 * ratings come from the same rows the student's task page reads.
 *
 * Two consequences worth stating plainly:
 *   - No API key. Nothing is called over the network, so the assistant cannot
 *     stop working because a key expired or a quota ran out.
 *   - Nothing is generated, so nothing can be invented. When the data cannot
 *     answer a question, it says so and points at a coordinator rather than
 *     producing a confident guess.
 *
 * Curriculum is read from the database, never copied into this file. A reseed
 * changes the answers automatically and there is no second copy to drift.
 *
 * This file is additive. It defines its own routes under /api/v2/assistant and
 * shares only the existing BotQuery model for logging, so no existing feature
 * depends on anything here.
 */

const router     = require('express').Router();
const DomainTask = require('../../models/new/DomainTask');

// Logging is best-effort and must never break an answer.
let BotQuery = null;
try { BotQuery = require('../../models/BotQuery'); } catch (_e) { /* optional */ }

/* ──────────────────────────── durations ─────────────────────────── */
/*
 * All six the portal offers. Only four have seeded rows: DomainTask's
 * durationType enum is ["45days","1month","3months","6months"]. Rather than
 * leave a student on 1 Week or 15 Days staring at an empty plan, those two are
 * derived from the front of the 1 Month track — and every answer built that
 * way says so. Presenting a derived plan as the seeded one would be worse than
 * showing nothing.
 */
const DURATIONS = [
  { key: '1week',   label: '1 Week',   source: '1month',  take: 1,  derived: true },
  { key: '15days',  label: '15 Days',  source: '1month',  take: 2,  derived: true },
  { key: '1month',  label: '1 Month',  source: '1month'  },
  { key: '45days',  label: '45 Days',  source: '45days'  },
  { key: '3months', label: '3 Months', source: '3months' },
  { key: '6months', label: '6 Months', source: '6months' },
];

const DURATION_PATTERNS = [
  ['6months', /\b(6|six)[\s-]*month/i],
  ['3months', /\b(3|three)[\s-]*month/i],
  ['45days',  /\b45[\s-]*day|\bforty[\s-]?five[\s-]*day/i],
  ['1month',  /\b(1|one)[\s-]*month\b|\b4[\s-]*week/i],
  ['15days',  /\b15[\s-]*day|\bfifteen[\s-]*day/i],
  ['1week',   /\b(1|one)[\s-]*week\b/i],
];

function matchDuration(text) {
  for (const [key, re] of DURATION_PATTERNS) {
    if (re.test(text)) { return DURATIONS.find(d => d.key === key); }
  }
  return null;
}

/* ───────────────────────────── domains ──────────────────────────── */
/*
 * Aliases are ordered most specific first: "react" must resolve to MERN rather
 * than Web Development, and "pandas" to Data Science rather than Python, so the
 * more specific track claims the shared vocabulary.
 */
const DOMAIN_ALIASES = [
  ['MERN Stack Development', ['mern', 'mongodb', 'mongo', 'express', 'react', 'node', 'mean']],
  ['Data Science',           ['data science', 'machine learning', 'numpy', 'pandas', 'scikit', 'dataset', 'ml model']],
  ['DevOps with AWS',        ['devops', 'aws', 'docker', 'kubernetes', 'ci/cd', 'jenkins', 'terraform', 'cloud']],
  ['Cyber Security',         ['cyber', 'security', 'pentest', 'penetration', 'owasp', 'ethical hack', 'vulnerab']],
  ['Flutter Development',    ['flutter', 'dart', 'mobile app', 'android', 'ios']],
  ['Vibe Coding',            ['vibe coding', 'vibe-coding', 'cursor', 'copilot', 'prompt engineering']],
  ['Space Research',         ['space', 'satellite', 'astronomy', 'aerospace', 'orbital']],
  ['Venture Capital',        ['venture capital', 'term sheet', 'cap table', 'due diligence', 'pitch deck', 'funding']],
  ['Business Analyst',       ['business analyst', 'business analysis', 'requirement', 'power bi', 'tableau', 'stakeholder']],
  ['HR Management',          ['hr management', 'human resource', 'recruit', 'hiring', 'payroll', 'onboarding']],
  ['Software Engineering',   ['software engineering', 'sdlc', 'dsa', 'data structures', 'algorithm', 'system design']],
  ['Java Development',       ['java', 'spring', 'jdbc', 'hibernate', 'maven']],
  ['Python Development',     ['python', 'django', 'flask', 'fastapi']],
  ['Web Development',        ['web development', 'web dev', 'frontend', 'html', 'css', 'tailwind', 'javascript']],
];

let domainCache = null;
async function allDomains() {
  if (domainCache) { return domainCache; }
  try {
    const list = await DomainTask.distinct('domain');
    if (list && list.length) { domainCache = list.sort(); }
  } catch (_e) { /* database unavailable — fall back to the alias list */ }
  return domainCache || DOMAIN_ALIASES.map(a => a[0]).sort();
}

async function matchDomain(text, fallback) {
  const s = ' ' + String(text || '').toLowerCase() + ' ';
  for (const [domain, aliases] of DOMAIN_ALIASES) {
    if (aliases.some(a => s.includes(a))) { return domain; }
  }
  const known = await allDomains();
  const hit = known.find(d => s.includes(d.toLowerCase()));
  if (hit) { return hit; }
  if (fallback) {
    const f = known.find(d => d.toLowerCase() === String(fallback).toLowerCase());
    if (f) { return f; }
  }
  return null;
}

/* ──────────────────────────── rendering ─────────────────────────── */
const rupees = coins => 'Rs ' + Math.round(coins * 0.5);

async function tasksFor(domain, duration) {
  const rows = await DomainTask
    .find({ domain, durationType: duration.source })
    .sort({ weekNumber: 1 })
    .lean();
  return duration.take ? rows.slice(0, duration.take) : rows;
}

function renderPlan(domain, duration, rows) {
  if (!rows.length) {
    return `I could not find a seeded task list for ${domain} on the ${duration.label} track. Ask your coordinator which track you are on.`;
  }
  const total = rows.reduce((n, r) => n + (r.coinReward || 0), 0);
  const last  = rows[rows.length - 1];

  const head = [
    `${domain} — ${duration.label} track`,
    `${rows.length} weekly task${rows.length === 1 ? '' : 's'}. Task coins: ${total} (${rupees(total)} at 100 coins = Rs 50), before attendance, streaks and the daily posting task.`,
  ];

  if (duration.derived) {
    head.push(`Note: ${duration.label} has no task library of its own. This is the first ${duration.take} week${duration.take === 1 ? '' : 's'} of the 1 Month track, so treat it as a starting point and confirm with your coordinator.`);
  }

  const weeks = rows.map(r =>
    `Week ${r.weekNumber} — ${r.taskTitle} (${r.coinReward} coins, ${r.difficultyLevel})\n${r.taskDescription}`
  );

  return head.join('\n') + '\n\n' + weeks.join('\n\n') + '\n\n' + [
    'How to finish:',
    '1. Submit by day 5 each week. Tasks go Available → Submitted → Approved, and approval is not instant.',
    `2. Build toward "${last.taskTitle}" from week 1. It is worth ${last.coinReward} coins on its own and every earlier week feeds it.`,
    '3. Bank the recurring coins: 5 a day for attendance, 50 for a 7-day streak, 30 for finishing a full week.',
    '4. Do the Daily Job Posting task. 3 coins per platform up to 10 platforms is 30 coins a day.',
  ].join('\n');
}

/* ───────────────────────── topic answers ────────────────────────── */
async function domainListAnswer() {
  const list = await allDomains();
  return [
    `TEN runs ${list.length} domains:`,
    '',
    list.map((d, i) => `${i + 1}. ${d}`).join('\n'),
    '',
    'Each has a weekly task library on 1 Month, 45 Days, 3 Months and 6 Months. 1 Week and 15 Days are offered too but have no task library of their own.',
    'Tell me your domain and track and I will list every week.',
  ].join('\n');
}

const TOPIC_RULES = [
  {
    test: /\bcoin|reward|payout|stipend|money|rupee|\brs\b|salary|paid\b/i,
    answer: () => [
      'Coins convert at 100 coins = Rs 50 (1 coin = Rs 0.50).',
      '',
      '• Task: 20–100 coins by difficulty',
      '• Quiz passed first attempt: 50',
      '• Daily attendance: 5, and a 7-day streak: 50',
      '• Complete a full week: 30',
      '• Daily Job Posting: 3 coins per platform, up to 10 platforms',
      '• Complete the entire course: 500',
      '',
      'The recurring ones add up faster than task coins. Attendance alone is about 150 a month, and daily posting at ten platforms beats every individual task on most tracks.',
    ].join('\n'),
  },
  {
    test: /\bcertificate|certification|\blor\b|\bloc\b|recommendation|star performance/i,
    answer: () => [
      'Certificates go through 2-step approval: your coordinator approves first, then HR.',
      '',
      '• LOC at 100% completion',
      '• LOR at 50% or more',
      '• Star Performance for top scorers',
      '',
      'What earns the strongest version: consistent weekly submissions that get approved, a finished final project, and a visible attendance record. Anything specific to your account, ask your coordinator.',
    ].join('\n'),
  },
  {
    test: /\bdaily post|job posting|posting task|share.*(linkedin|whatsapp)|social/i,
    answer: () => [
      'The Daily Job Posting task is mandatory for every intern in every domain, separate from your weekly track tasks.',
      '',
      'It pays 3 coins per platform, up to 10 platforms — 30 coins a day.',
      'Platforms: LinkedIn, LinkedIn Groups, Facebook, Facebook Groups, WhatsApp, WhatsApp Groups, Instagram, Telegram, Telegram Groups.',
      '',
      'Done every day for a month that is roughly 900 coins, more than the entire task list of most tracks. It is the highest-return habit in the programme and the one most often treated as optional.',
    ].join('\n'),
  },
  {
    test: /\battendance|streak|present\b|mark.*attend/i,
    answer: () => 'Mark attendance daily in your student dashboard: 5 coins a day, plus 50 for a 7-day streak. WhatsApp Re-Joiners must also fill the Google Form twice daily.',
  },
  {
    test: /\bdocument|address proof|marksheet|upload|offer letter/i,
    answer: () => 'Upload your Address Proof and Marksheet on the my-documents page. PDF, JPG or PNG, under 5MB each. Your offer letter is generated once HR approves them.',
  },
  {
    test: /\b(what|which|list|all|how many)\b.*\b(domain|track|field|stream|course)s?\b/i,
    answer: domainListAnswer,
  },
  {
    test: /\bduration|how long|track length|which track/i,
    answer: () => [
      'Six durations are offered: 1 Week, 15 Days, 1 Month, 45 Days, 3 Months and 6 Months.',
      '',
      'The weekly task library is seeded for 1 Month (4 weeks), 45 Days (6), 3 Months (12) and 6 Months (24).',
      '1 Week and 15 Days do not have a task library of their own. If you picked one and your plan looks empty, that is why — it is not a fault in your account. Ask your coordinator to move you onto a track that has tasks.',
    ].join('\n'),
  },
  {
    test: /\bsubmit|deadline|approv|late|behind/i,
    answer: () => [
      'Tasks move Available → Submitted → Approved. Approval is not instant, so submitting on the last day of a week pushes the approval into the next one. Aim for day 5.',
      '',
      'If you are behind, do not skip ahead to the final project. The tasks are cumulative, so a gap in the middle shows up as a broken final week, and reviewers read your commit history.',
    ].join('\n'),
  },
];

/**
 * The engine. Domain plus duration is the most specific thing a student can
 * give, so it outranks the topic rules: "how many coins for MERN 3 months"
 * should return that plan and its coin total, not the generic coin table.
 */
async function answerFor(question, ctx) {
  const q        = String(question || '');
  const domain   = await matchDomain(q, ctx && ctx.domain);
  const duration = matchDuration(q);

  if (domain && duration) {
    return renderPlan(domain, duration, await tasksFor(domain, duration));
  }
  for (const rule of TOPIC_RULES) {
    if (rule.test.test(q)) { return await rule.answer(); }
  }
  if (domain) {
    return `${domain} runs on 1 Month, 45 Days, 3 Months and 6 Months. Tell me which track you are on and I will list every week with what to build, its coin value and its difficulty.`;
  }
  return [
    'I can help with your weekly tasks, your track plan, coins, attendance, documents, submissions and certificates.',
    '',
    'Tell me your domain and duration — for example "MERN 3 months" — and I will give you every week with what to build and what it pays.',
  ].join('\n');
}

/* ──────────────────────────── endpoints ─────────────────────────── */

// POST /api/v2/assistant/ask
router.post('/ask', async (req, res) => {
  try {
    const { question, userId, userName, domain } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'question required' });
    }

    const answer = await answerFor(question, { domain });

    // Logging must never take the answer down with it.
    if (BotQuery && userId) {
      BotQuery.create({
        userId, userType: 'student', userName: userName || '',
        domain: domain || '', botType: 'task', question, answer, status: 'answered',
      }).catch(() => {});
    }

    return res.json({ answer, source: 'portal-data' });
  } catch (e) {
    console.error('[assistant/ask]', e.message);
    return res.status(500).json({ error: 'The assistant could not answer that. Try again.' });
  }
});

// GET /api/v2/assistant/domains
router.get('/domains', async (req, res) => {
  try {
    return res.json({
      domains:   await allDomains(),
      durations: DURATIONS.map(d => ({ key: d.key, label: d.label, derived: !!d.derived })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/v2/assistant/plan?domain=...&duration=...
router.get('/plan', async (req, res) => {
  try {
    const duration = DURATIONS.find(d => d.key === req.query.duration);
    if (!req.query.domain || !duration) {
      return res.status(400).json({ error: 'domain and a valid duration are required' });
    }
    const rows = await tasksFor(req.query.domain, duration);
    return res.json({
      domain:   req.query.domain,
      duration: duration.label,
      derived:  !!duration.derived,
      weeks:    rows.map(r => ({
        week:       r.weekNumber,
        title:      r.taskTitle,
        task:       r.taskDescription,
        coins:      r.coinReward,
        difficulty: r.difficultyLevel,
      })),
      totalCoins: rows.reduce((n, r) => n + (r.coinReward || 0), 0),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/v2/assistant/health
router.get('/health', async (req, res) => {
  const domains = await allDomains();
  return res.json({ ok: true, domains: domains.length, requiresApiKey: false });
});

module.exports = router;
