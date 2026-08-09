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
const mongoose   = require('mongoose');
const DomainTask = require('../../models/new/DomainTask');

/*
 * Taught answers live in the existing SystemKnowledge collection rather than
 * a new one, and are written only by an admin through /teach.
 *
 * Students never write here. If they could, one student could teach the
 * assistant something false and it would repeat it confidently to everyone
 * else, and a wrong answer about a fee or a deadline costs real money. So an
 * unanswered question is captured as a question, and a coordinator supplies
 * the answer once.
 */
let SystemKnowledge = null;
try { SystemKnowledge = require('../../models/SystemKnowledge'); } catch (_e) { /* optional */ }

let AssistantUsage = null;
try { AssistantUsage = require('../../models/new/AssistantUsage'); } catch (_e) { /* optional */ }

// Logging is best-effort and must never break an answer.
let BotQuery = null;
try { BotQuery = require('../../models/BotQuery'); } catch (_e) { /* optional */ }

/* ────────────────────────────── tiers ───────────────────────────── */
/*
 * Four tiers. `messages` is the cap per 30-day period; null means unlimited.
 * `depth` is what the answer renderer is allowed to include, so the paid
 * difference is real content rather than the same answer behind a counter.
 *
 * Prices are recorded for display only. Nothing here charges a card: the
 * entitlement is granted by verifyPayment once a human has matched the UPI
 * reference against the merchant statement, and written by grantEntitlement.
 */
const TIERS = {
  starter: {
    key: 'starter', label: 'Starter', price: 0, priceLabel: 'Free',
    messages: 25, depth: 'brief', historyDays: 0, deepDive: false,
    blurb: 'Short answers to get you unstuck.',
  },
  pro: {
    key: 'pro', label: 'Pro', price: 500, priceLabel: '₹500/month',
    messages: 90, depth: 'standard', historyDays: 7, deepDive: false,
    blurb: 'Fuller answers, and your last 7 days of conversation kept.',
  },
  plus: {
    key: 'plus', label: 'Plus', price: 1200, priceLabel: '₹1,200/month',
    messages: 350, depth: 'deep', historyDays: 30, deepDive: true,
    blurb: 'Deep Dive Mode for multi-part questions, 30 days of history.',
  },
  enterprise: {
    key: 'enterprise', label: 'Enterprise', price: 5000, priceLabel: '₹5,000/month',
    messages: null, depth: 'ultimate', historyDays: null, deepDive: true,
    blurb: 'Unlimited messages, full portal knowledge, essay-length reasoning.',
  },
};

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Load (or create) a student's usage row, rolling the period over when it has
 * expired and downgrading when an entitlement has lapsed. Both are checked on
 * read rather than by a scheduled job, so there is nothing to keep running and
 * no window where a lapsed subscription still answers as paid.
 */
async function loadUsage(userId) {
  if (!AssistantUsage || !userId) { return null; }
  try {
    return await loadUsageOrThrow(userId);
  } catch (e) {
    /*
     * The database is unreachable. Answering is more useful than failing, so
     * this degrades to an unmetered Starter session rather than returning an
     * error: the questions that need no database (coins, certificates, the
     * daily posting task) are static text and should never have depended on
     * Mongo being up. Nothing paid is given away, because a null row reads as
     * Starter depth everywhere downstream.
     */
    console.warn('[assistant] usage unavailable, serving unmetered Starter:', e.message);
    return null;
  }
}

async function loadUsageOrThrow(userId) {
  let row = await AssistantUsage.findOne({ userId });
  if (!row) { row = await AssistantUsage.create({ userId }); }

  let dirty = false;
  const now = Date.now();

  if (now - new Date(row.periodStart).getTime() >= PERIOD_MS) {
    row.messagesUsed = 0;
    row.periodStart  = new Date();
    dirty = true;
  }
  const exp = row.entitlement && row.entitlement.expiresAt;
  if (row.tier !== 'starter' && exp && new Date(exp).getTime() < now) {
    row.tier = 'starter';
    dirty = true;
  }
  if (dirty) { await row.save(); }
  return row;
}

function quotaFor(row) {
  const tier = TIERS[(row && row.tier) || 'starter'] || TIERS.starter;
  const used = (row && row.messagesUsed) || 0;
  const remaining = tier.messages === null ? null : Math.max(0, tier.messages - used);

  let resetsOn = null;
  if (row && row.periodStart) {
    const d = new Date(new Date(row.periodStart).getTime() + PERIOD_MS);
    resetsOn = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return { tier, used, remaining, exhausted: remaining === 0, resetsOn };
}

/** Single place an entitlement is written, whatever granted it. */
async function grantEntitlement(userId, tierKey, meta) {
  if (!AssistantUsage || !userId || !TIERS[tierKey]) { return null; }
  const row = await AssistantUsage.findOneAndUpdate(
    { userId },
    {
      tier: tierKey,
      // A new entitlement starts a fresh period, so an upgrade mid-month is
      // not spent against messages already used on the previous tier.
      messagesUsed: 0,
      periodStart: new Date(),
      entitlement: {
        productId: (meta && meta.productId) || null,
        store:     (meta && meta.store) || 'manual',
        expiresAt: (meta && meta.expiresAt) || new Date(Date.now() + PERIOD_MS),
        grantedAt: new Date(),
        appUserId: (meta && meta.appUserId) || userId,
      },
    },
    { upsert: true, new: true }
  );
  return row;
}

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
  try {
    const rows = await DomainTask
      .find({ domain, durationType: duration.source })
      .sort({ weekNumber: 1 })
      .lean();
    return duration.take ? rows.slice(0, duration.take) : rows;
  } catch (e) {
    // An empty list renders as "no seeded task list for this track", which is
    // the honest thing to say when the rows cannot be read.
    console.warn('[assistant] task lookup failed:', e.message);
    return [];
  }
}

const DEPTH_RANK = { brief: 0, standard: 1, deep: 2, ultimate: 3 };
const atLeast = (depth, level) => DEPTH_RANK[depth || 'brief'] >= DEPTH_RANK[level];

/*
 * Depth is what separates the tiers. Rather than the same answer behind a
 * counter, each level adds real content. The full answer is always computed
 * and then cut down, so paid tiers are never a separate code path.
 */
function renderPlan(domain, duration, rows, depth) {
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

  const shown = atLeast(depth, 'standard') ? rows : rows.slice(0, 3);
  const weeks = shown.map(function (r) {
    return 'Week ' + r.weekNumber + ' — ' + r.taskTitle +
           ' (' + r.coinReward + ' coins, ' + r.difficultyLevel + ')\n' + r.taskDescription;
  });

  const out = [head.join('\n'), weeks.join('\n\n')];

  if (shown.length < rows.length) {
    out.push('… and ' + (rows.length - shown.length) + ' more weeks on Pro and above.');
  }

  if (atLeast(depth, 'standard')) {
    out.push([
      'How to finish:',
      '1. Submit by day 5 each week. Tasks go Available → Submitted → Approved, and approval is not instant.',
      '2. Build toward "' + last.taskTitle + '" from week 1. It is worth ' + last.coinReward + ' coins on its own and every earlier week feeds it.',
      '3. Bank the recurring coins: 5 a day for attendance, 50 for a 7-day streak, 30 for finishing a full week.',
      '4. Do the Daily Job Posting task. 3 coins per platform up to 10 platforms is 30 coins a day.'
    ].join('\n'));
  }

  if (atLeast(depth, 'deep')) {
    const hard = rows.filter(function (r) { return r.difficultyLevel === 'hard' || r.difficultyLevel === 'expert'; });
    out.push([
      'Where this track gets hard:',
      hard.length
        ? hard.map(function (r) { return '• Week ' + r.weekNumber + ' (' + r.difficultyLevel + ') — ' + r.taskTitle; }).join('\n')
        : '• Difficulty stays moderate throughout.',
      '',
      'Keep the two weeks before week ' + (hard.length ? hard[0].weekNumber : rows.length) + ' light. That is where students stall, and the tasks are cumulative.'
    ].join('\n'));
  }

  if (atLeast(depth, 'ultimate')) {
    const totalCoins = rows.reduce(function (n, r) { return n + r.coinReward; }, 0);
    const byDiff = rows.reduce(function (m, r) { m[r.difficultyLevel] = (m[r.difficultyLevel] || 0) + 1; return m; }, {});
    out.push([
      'Full breakdown:',
      '• Difficulty spread: ' + Object.keys(byDiff).map(function (k) { return byDiff[k] + ' ' + k; }).join(', ') + '.',
      '• The final task alone is ' + Math.round((last.coinReward / totalCoins) * 100) + '% of this track’s task coins, so an unfinished final week costs far more than one week of effort.',
      '• These are task coins only. Attendance across ' + rows.length + ' weeks adds roughly ' + (rows.length * 7 * 5) + ' more, plus ' + rows.length + ' week-completion bonuses of 30, plus up to 30 a day from the posting task. The recurring total usually exceeds the task total.',
      '• Submissions are reviewed against the description, not the title. Read the task text literally and satisfy each clause.'
    ].join('\n'));
  }

  return out.filter(Boolean).join('\n\n');
}

/* ───────────────────────── topic answers ────────────────────────── */
/* "is there an AI domain", "do you have UI UX" - a real question with a real
   answer, which is that TEN seeds fourteen and that is not one of them. */
const ASKS_IF_DOMAIN_EXISTS = new RegExp(
  '(?:\\b(?:is there|do you have|do you offer|can i (?:do|take|join|pick|choose)|is|any)\\b'
  + '.{0,30}\\b(?:domain|track|course)s?\\b)'
  + '|(?:\\b(?:is there|do you have|do you offer|can i (?:do|take|join|pick|choose))\\b.{0,20}'
  + '\\b(?:ai|ml|ui\\s*/?\\s*ux|design|digital\\s*marketing|content\\s*writing|sales|finance|'
  + 'marketing|blockchain|game\\s*dev|graphic|video|seo|hr)\\b)', 'i');

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
    test: /\b(plan|plans|pricing|tier|subscription|pro\b|plus\b|enterprise|upgrade|starter)\b.{0,20}\b(cost|price|much|available|are|do|work|mean)?\b|\bwhat are the plans\b|\bhow much is (pro|plus|enterprise)\b|\bupgrade\b/i,
    answer: () => [
      'The assistant itself has four tiers. Everything about your internship, tasks and coins is unaffected by them.',
      '',
      '• Starter, free: 25 messages a month, short answers',
      '• Pro, Rs 500/month: 90 messages, fuller answers, 7-day history',
      '• Plus, Rs 1,200/month: 350 messages, Deep Dive Mode, 30-day history',
      '• Enterprise, Rs 5,000/month: unlimited messages, full depth and history',
      '',
      'Open Plans in the sidebar to see them and pay by UPI. Paying does not change your tasks, your coins or your certificate: it only changes how much you can ask me and how deeply I answer.',
    ].join('\n'),
  },
  {
    test: /\brefund|money back|cancel.{0,20}(subscription|plan)|charged|double.?paid|payment failed|paid but/i,
    answer: () => [
      'I cannot process refunds, cancellations or payment problems, and I cannot see your payment record.',
      '',
      'Take it to your coordinator through Domain Chat, with the UPI reference number from your payment app. That reference is what lets them match it against the account.',
      '',
      'If you submitted a reference and your tier has not changed, that is expected until someone verifies it: submitting a reference is a claim, not an activation.',
    ].join('\n'),
  },
  {
    test: /\b(fee|fees|charge|pay anything|have to pay|cost)\b/i,
    answer: () => [
      'Be careful with this one, and confirm it with your coordinator rather than with me.',
      '',
      'Two places money appears in the portal:',
      '• The Crash Course tracks (1 Week, 15 Days, 1 Month) show a programme fee before the dashboard activates.',
      '• Certificates carry a payment step; issuance is not automatic on completion.',
      '',
      'I deliberately do not quote amounts. I can read that a payment step exists, not what it costs, and a wrong number here costs you real money. Ask your coordinator for the figure before you pay anything.',
    ].join('\n'),
  },
  {
    test: /\bscam|fake|legit|genuine|trust|fraud|real company|worth it\b/i,
    answer: () => [
      'Not something I should answer about my own employer, so here is what you can check yourself.',
      '',
      '• Certificates carry a certificate ID and a verification URL, so any certificate you receive can be verified independently.',
      '• The task library, coin rates and approval flow are the same ones this portal runs on, which is why I can quote them exactly.',
      '• Anything involving money, ask your coordinator for specifics in writing before you pay.',
      '',
      'If something feels wrong, raise it with your coordinator and keep the reply. That is better evidence than my opinion.',
    ].join('\n'),
  },
  {
    test: /\b(stress|stressed|anxious|anxiety|depress|overwhelm|burn ?out|panic|can'?t cope|too much pressure|giving up|quit)\b/i,
    answer: () => [
      'That is worth saying out loud to a person, not to me.',
      '',
      'Message your coordinator through Domain Chat and tell them you are struggling. Durations here are flexible and falling behind is recoverable; going quiet is what turns it into a problem.',
      '',
      'If it helps: partial work is not wasted. A recommendation needs 50% completion, not 100%. And if this is bigger than the internship, please talk to someone you trust or a professional, not a chatbot.',
    ].join('\n'),
  },
  {
    test: /\bnext task|due this week|what.{0,12}(due|next)\b|current task|this week.?s task/i,
    answer: () => [
      'I cannot see which week you are on, because I do not have access to your submissions.',
      '',
      'Your task page shows it: tasks unlock weekly and move Available → Submitted → Approved.',
      '',
      'Tell me your track and a week number and I will give you exactly what that week wants, for example "MERN week 5".',
    ].join('\n'),
  },
  {
    test: /\b(how many|total|number of)\b.{0,16}\btasks?\b/i,
    answer: () => [
      'It depends on your track: 4 tasks on 1 Month, 6 on 45 Days, 12 on 3 Months and 24 on 6 Months, one per week.',
      '',
      'On top of that, every intern has the Daily Job Posting task every day, regardless of domain.',
      '',
      'Tell me your domain and track and I will list all of them.',
    ].join('\n'),
  },
  {
    test: /\btask (was |got )?(rejected|not approved|declined|returned)|rejected my|why.{0,20}rejected/i,
    answer: () => [
      'I cannot see why yours was rejected, only what reviewers usually send back for.',
      '',
      '• The submission does not do what the task description literally asks. Read it clause by clause.',
      '• A link that is not reachable: a private repo, a dead deployment, a file nobody else can open.',
      '• Work that arrived without the earlier weeks it builds on.',
      '',
      'Ask your coordinator for the specific reason through Domain Chat, fix that one thing, and resubmit.',
    ].join('\n'),
  },
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
    test: ASKS_IF_DOMAIN_EXISTS,
    answer: async () => {
      const list = await allDomains();
      return [
        'TEN seeds ' + list.length + ' domains, and only these have a weekly task library:',
        '',
        list.map((d, i) => (i + 1) + '. ' + d).join('\n'),
        '',
        'If the one you are asking about is not on that list, it has no task library here. Other subjects may exist elsewhere in the TEN ecosystem, so ask your coordinator, but I can only plan the fourteen above.',
      ].join('\n');
    },
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
    test: /\bquiz|mcq|test\b|domain test/i,
    answer: () => [
      'The Domain MCQ Test is on the quiz portal.',
      '',
      'Passing on your first attempt pays 50 coins. A later attempt still counts for completion but not for that bonus, so read the material before you start rather than treating attempt one as practice.',
    ].join('\n'),
  },
  {
    test: /\bleaderboard|badge|rank|star performer|top perform/i,
    answer: () => [
      'The leaderboard ranks on total coins, so it rewards consistency rather than one good week.',
      '',
      'Attendance, streaks and the daily posting task move it more than individual tasks do: they repeat every day, and task coins do not. Star Performance recognition goes to top scorers.',
    ].join('\n'),
  },
  {
    test: /\bcoordinator|mentor|who (do|should) i (ask|contact)|domain chat|support/i,
    answer: () => [
      'Your coordinator manages your tasks and approvals, and you reach them through Domain Chat in the portal.',
      '',
      'Ask them for anything specific to you: approval status, a fee, an extension, a correction to your record. I can explain how the programme works, but I cannot see your account.',
    ].join('\n'),
  },
  {
    test: /\bdiscord|community|group|network\b/i,
    answer: () => [
      'The TEN alumni Discord is at https://discord.gg/GYnZFbDE7, and the QR code is in the attendance section.',
      '',
      'TEN Network in your dashboard is the wider ecosystem: founders, mentors, investors and other interns.',
    ].join('\n'),
  },
  {
    test: /\b(log ?in|password|employee ?id|cannot access|forgot)/i,
    answer: () => [
      'Log in with your Employee ID and the password you registered with. Your registration details, including a masked password, are in the Profile modal on your dashboard.',
      '',
      'On first login you choose New Joiner or WhatsApp Re-Joiner, and that choice cannot be changed later. If you are locked out, your coordinator can help; I cannot reset anything.',
    ].join('\n'),
  },
  {
    test: /\bstart|begin|first day|new here|just joined|what (do|should) i do( first)?\b|where do i (start|begin)/i,
    answer: () => [
      'Start in this order:',
      '',
      '1. Set your duration on the tasks page. That unlocks your weekly plan.',
      '2. Mark attendance today, and every day after. 5 coins each, 50 for a 7-day streak.',
      '3. Do the Daily Job Posting task. Mandatory in every domain, up to 30 coins a day.',
      '4. Open week 1 and start it now rather than at the weekend. Tasks are cumulative.',
      '5. Upload your documents so your offer letter can be generated.',
      '',
      'Tell me your domain and track and I will lay out every week.',
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

/* ────────────────────────── intent ───────────────────────── */
/*
 * Read the message before answering it.
 *
 * The engine used to reach for an answer on every input, so "hi" came back
 * with the student's registered domain and its four track lengths. That is
 * worse than saying nothing: it reads as though the assistant did not look at
 * the message. These checks classify the input first, so a greeting gets a
 * greeting and only a question about their work reaches the curriculum.
 */

/** Greetings, thanks, acknowledgements. Anchored to the whole message, so "hi"
 *  matches but "which track is this" does not. */
/* Trailing words like "bro", "sir" or "a lot" are still small talk. Ending a
   conversation with "thanks bro" and being told the assistant could not tell
   what you needed is a bad last impression for no reason. */
const GREET = "hi+|hey+|hello+|yo|hola|namaste|greetings|good\\s*(?:morning|afternoon|evening|day|night)|"
            + "thank(?:s| you)?|thx|ty|ok(?:ay)?|k|cool|nice|great|awesome|got it|sure|yep|yes|no|bye|see ya";
const TAIL  = "you|u|so much|a lot|bro|bhai|sir|ma'?am|mate|man|dude|buddy|ji|there|again|everyone|all";
/* Two greetings in a row ("ok cool", "hello there") are still small talk.
   Being told the assistant could not tell what you needed, because you said
   two friendly words instead of one, is a silly way to end a conversation. */
const SMALL_TALK = new RegExp(
  '^[\\s!.?,]*(?:' + GREET + ')(?:[\\s!.?,]+(?:' + GREET + '|' + TAIL + '))*[\\s!.?,]*$', 'i');

/** "who are you", "what can you do", "help". */
const CAPABILITY = /\b(who are you|what (can|do) you do|what are you|how (do|can) i use|help me|what is this)\b|^\s*help\s*$/i;

/**
 * Does the message actually concern their work?
 *
 * Only then is it fair to fall back to the domain on their account. Without
 * this gate the fallback fires on anything unrecognised, which is precisely
 * how "hi" became a Java Development answer.
 */
const ABOUT_WORK = /\b(plan|track|week|task|schedule|deadline|roadmap|syllabus|curriculum|project|assignment|build|submit|due|domain|internship|course|module|learn|start|next|do|earn|money|coin|make|pay|paid)\b/i;

function greeting(ctx) {
  const name = (ctx && ctx.userName) ? String(ctx.userName).trim().split(/\s+/)[0] : '';
  const dom  = (ctx && ctx.domain) ? String(ctx.domain) : '';
  return [
    (name ? 'Hi ' + name + '. ' : 'Hi. ') +
      'I can help with your weekly tasks, coins, attendance, documents and certificates.',
    '',
    dom
      ? 'You are on ' + dom + '. Tell me your track and I will list every week: "' + dom + ' 3 months".'
      : 'Tell me your domain and track and I will list every week, for example "MERN 3 months".',
  ].join('\n');
}

function capabilities(ctx) {
  const dom = (ctx && ctx.domain) ? String(ctx.domain) : '';
  return [
    'I am the TEN Assistant. I answer from this portal’s own task library, so what I tell you matches what you will actually be assigned.',
    '',
    'Ask me for:',
    '• Your week-by-week plan, with what to build, its coin value and difficulty',
    '• How coins add up, and the recurring ones students miss',
    '• Certificates, attendance, documents, submissions',
    '',
    dom ? 'Start with: "' + dom + ' 3 months".' : 'Start with your domain and track, for example "MERN 3 months".',
  ].join('\n');
}

/**
 * The engine. Domain plus duration is the most specific thing a student can
 * give, so it outranks the topic rules: "how many coins for MERN 3 months"
 * should return that plan and its coin total, not the generic coin table.
 */
/* ─────────────────────────── learning ──────────────────────────── */

const STOPWORDS = new Set(['what', 'when', 'where', 'which', 'this', 'that', 'they',
  'have', 'does', 'the', 'and', 'for', 'with', 'from', 'about', 'your', 'you',
  'can', 'how', 'get', 'tell', 'give', 'please', 'need', 'want', 'are']);

function keywords(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 2 && !STOPWORDS.has(w); });
}

/**
 * Match against what a coordinator has taught.
 *
 * A topic hit counts double: matching the topic name is a far stronger signal
 * than matching one word in the body, and requiring two body matches meant
 * single-subject questions fell through to the generic reply.
 */
async function taughtAnswer(question) {
  if (!SystemKnowledge) { return null; }
  try {
    const items = await SystemKnowledge.find({}).lean();
    const words = keywords(question);
    if (!words.length) { return null; }

    let best = null, bestScore = 0;
    for (const item of items) {
      const topic = String(item.topic || '').toLowerCase().replace(/_/g, ' ');
      const body  = String(item.content || '').toLowerCase();
      let score = 0;
      for (const w of words) {
        if (topic.includes(w)) { score += 2; }
        else if (body.includes(w)) { score += 1; }
      }
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return bestScore >= 2 ? best.content : null;
  } catch (_e) {
    return null;
  }
}

/** Record a question nobody could answer, so it can be taught later. Fire and
 *  forget: a logging failure must never take the reply down with it. */
function noteUnanswered(question, ctx) {
  if (!BotQuery) { return; }
  BotQuery.create({
    userId:   (ctx && ctx.userId) || 'unknown',
    userType: 'student',
    userName: (ctx && ctx.userName) || '',
    domain:   (ctx && ctx.domain) || '',
    botType:  'query',
    question: String(question).slice(0, 500),
    answer:   null,
    status:   'open',
  }).catch(function () {});
}

/*
 * What counts as "about TEN".
 *
 * Two things hang off this. Off-topic questions get an honest out-of-scope
 * reply instead of the menu, and they are never queued for a coordinator to
 * answer. Without that gate the learning queue fills with weather and cricket
 * and buries the one useful question a student actually asked.
 *
 * Stems carry \w* rather than a closing \b: "certificat\b" does not match
 * "certificate", which silently put half the real questions out of scope.
 */
const PORTAL_TERMS = new RegExp(
  '\\b(?:' + [
    'ten', 'portal', 'intern\\w*', 'task\\w*', 'week\\w*', 'coin\\w*',
    'certificat\\w*', 'attendance', 'document\\w*', 'offer\\s*letter',
    'domain\\w*', 'track\\w*', 'duration\\w*', 'coordinator\\w*', 'mentor\\w*',
    'submit\\w*', 'submission\\w*', 'approv\\w*', 'quiz\\w*', 'mcq',
    'leaderboard', 'badge\\w*', 'project\\w*', 'deadline\\w*', 'stipend',
    'payment\\w*', 'pay\\w*', 'fee\\w*', 'login', 'log\\s*in', 'employee',
    'discord', 'streak\\w*', 'dashboard', 'course\\w*', 'module\\w*',
    'marksheet', 'lor', 'loc', 'star\\s*performer', 'deploy\\w*',
    'assignment\\w*', 'finish\\w*', 'complet\\w*', 'money', 'earn\\w*',
    'rupee\\w*', 'salary', 'programme', 'program', 'mern', 'python', 'java',
    'flutter', 'devops', 'cyber', 'data\\s*science',
  ].join('|') + ')',
  'i'
);

/** Asking the assistant to do the work rather than help with it. */
const DO_IT_FOR_ME = /\b(write|do|make|build|complete|finish|give me)\b.{0,24}\b(my|the)\b.{0,24}\b(code|project|assignment|task|homework|report)\b|\bdo it for me\b/i;

/** "can I change/switch my domain|track|duration" - an account action. */
const ACCOUNT_ACTION = /\b(change|switch|move|swap|cancel|quit|leave|extend|reset|update)\b.{0,20}\b(domain|track|duration|plan|tenure|internship|account|password|email)\b/i;

/** "what if I don't finish", "what happens if I drop out". */
const NOT_FINISHING = /\b(not|don'?t|dont|cannot|can'?t|fail|drop|quit|leave|incomplete|unable)\b.{0,24}\b(finish|complete|submit|do it|continue)\b|\bwhat happens if\b/i;

/** "what is my week 5 task", "week 7", "3rd week". */
const WEEK_NUMBER = /\bweek\s*(\d{1,2})\b|\b(\d{1,2})(st|nd|rd|th)\s*week\b/i;

/** "how much can I earn", "how much money". */
const HOW_MUCH = /\bhow much\b.{0,24}\b(earn|make|money|paid|get|rupee|rs|income)\b|\bhow much (money|can i)\b/i;

/* ─────────────────────── extra answers ──────────────────────────── */

/*
 * One message for both "I did not understand that" and "that is not about
 * TEN". Telling them apart reliably is not possible here, and guessing wrong
 * is worse than saying both: answering gibberish with "I only cover TEN" reads
 * as a brush-off, and answering an off-topic question with "I could not tell"
 * implies it would have helped if only it had parsed.
 */
function outOfScope() {
  return [
    'I could not tell what you need from that.',
    '',
    'I only cover TEN: your weekly tasks, tracks, coins, attendance, documents and certificates. Ask me about your internship and I will give you a straight answer.',
    '',
    'Try "MERN 3 months", "how do coins work", or "what should I do first".',
  ].join('\n');
}

function doItForMe(domain) {
  return [
    'I will not write your submission for you. Your coordinator reviews the work and asks about it, and the point of the task is that you can build it.',
    '',
    'What I can do:',
    '• Break the task into steps and tell you what "done" looks like',
    '• Explain the concept or the error you are stuck on',
    '• Review your approach before you commit to it',
    '',
    domain ? 'Tell me which week of ' + domain + ' you are on and where you are stuck.'
           : 'Tell me your track and which week you are stuck on.',
  ].join('\n');
}

function accountAction() {
  return [
    'That is a change to your record, so it goes through your coordinator rather than me. Reach them through Domain Chat in the portal.',
    '',
    'I can see how the programme works, not your account, so anything that changes what is on file for you needs a human.',
  ].join('\n');
}

function notFinishing() {
  return [
    'Finishing matters more than finishing fast.',
    '',
    '• The Certificate of Completion (LOC) needs 100% completion.',
    '• A recommendation (LOR) needs 50% or more, so partial work is not wasted.',
    '• The final task alone is worth several normal weeks, so stopping near the end costs far more than the weeks it saves.',
    '',
    'If you are behind, tell your coordinator now rather than at the end. Durations are flexible; silence is what causes problems.',
  ].join('\n');
}

async function weekAnswer(domain, duration, n, depth) {
  const rows = await tasksFor(domain, duration);
  if (!rows.length) {
    return 'I could not read the task list for ' + domain + ' on that track. Ask your coordinator which track you are on.';
  }
  const row = rows.filter(function (r) { return r.weekNumber === n; })[0];
  if (!row) {
    return domain + ' on the ' + duration.label + ' track has ' + rows.length +
      ' weeks, so there is no week ' + n + '. Ask me for any week from 1 to ' + rows.length + '.';
  }
  return [
    domain + ' — week ' + row.weekNumber + ' of ' + rows.length + ' (' + duration.label + ')',
    '',
    row.taskTitle + ' — ' + row.coinReward + ' coins, ' + row.difficultyLevel,
    row.taskDescription,
    '',
    'Submit by day 5. Tasks go Available → Submitted → Approved and approval is not instant.',
  ].join('\n');
}

async function earnings(domain, duration) {
  // Without a domain there is no task list to price, and printing the
  // variable anyway produced "the honest arithmetic for null".
  const rows = (domain && duration) ? await tasksFor(domain, duration) : [];
  const weeks = rows.length || 12;
  const taskCoins = rows.reduce(function (n, r) { return n + (r.coinReward || 0); }, 0);
  const days = weeks * 7;
  const attendance = days * 5;
  const streaks = Math.floor(days / 7) * 50;
  const weekly = weeks * 30;
  const posting = days * 30;
  const course = 500;
  const total = taskCoins + attendance + streaks + weekly + posting + course;

  return [
    'Here is the honest arithmetic' + (rows.length && domain ? ' for ' + domain + ' on the ' + duration.label + ' track' : '') + '.',
    '',
    (rows.length ? '• Tasks: ' + taskCoins + ' coins\n' : '') +
    '• Attendance, ' + days + ' days at 5: ' + attendance + '\n' +
    '• Weekly streaks: ' + streaks + '\n' +
    '• Finishing each week, ' + weeks + ' at 30: ' + weekly + '\n' +
    '• Daily posting at ten platforms: ' + posting + '\n' +
    '• Finishing the course: ' + course,
    '',
    'That is roughly ' + total + ' coins, about Rs ' + Math.round(total * 0.5) + ', if you do everything every day.',
    '',
    'Two honest caveats. The posting task is the largest single line and it only pays if you actually post to ten platforms daily. And I can tell you the published rates, not how or when your account is settled: ask your coordinator about payout.',
  ].join('\n');
}

async function answerFor(question, ctx) {
  const q     = String(question || '').trim();
  const depth = (ctx && ctx.depth) || 'brief';

  if (!q) { return greeting(ctx); }
  if (SMALL_TALK.test(q)) { return greeting(ctx); }
  if (CAPABILITY.test(q)) { return capabilities(ctx); }

  const mayUseRegistered = ABOUT_WORK.test(q);

  // Two different things: a domain the student named, and the one on their
  // account. The second is fine for "what is my week 5 task", but it must not
  // turn every unrecognised sentence into a summary of their track - which is
  // how "when is the TEN hackathon" became a list of Java durations.
  const namedDomain = await matchDomain(q, null);
  const domain = namedDomain ||
    (mayUseRegistered ? await matchDomain('', ctx && ctx.domain) : null);
  const duration = matchDuration(q);

  // Specific intents outrank the generic plan lookup, because each of these
  // otherwise falls through to a domain dump that answers a different question.
  if (DO_IT_FOR_ME.test(q))    { return doItForMe(domain); }
  if (ACCOUNT_ACTION.test(q))  { return accountAction(); }
  if (NOT_FINISHING.test(q))   { return notFinishing(); }
  if (HOW_MUCH.test(q))        { return earnings(domain, duration || DURATIONS.find(function (d) { return d.key === '3months'; })); }

  // "3 months" on its own: they mean their own track. A bare duration is about
  // their work by definition, so this does not wait for ABOUT_WORK to agree -
  // "3 months" contains no other work vocabulary and matched nothing at all.
  if (!namedDomain && duration && ctx && ctx.domain) {
    const own = await matchDomain('', ctx.domain);
    if (own) { return renderPlan(own, duration, await tasksFor(own, duration), depth); }
  }

  const wk = WEEK_NUMBER.exec(q);
  if (wk && domain) {
    const n = parseInt(wk[1] || wk[2], 10);
    const d = duration || DURATIONS.find(function (x) { return x.key === '3months'; });
    return weekAnswer(domain, d, n, depth);
  }

  if (domain && duration) {
    return renderPlan(domain, duration, await tasksFor(domain, duration), depth);
  }
  for (const rule of TOPIC_RULES) {
    if (rule.test.test(q)) {
      const full = await rule.answer();
      // Starter gets the fact, not the commentary around it: the first
      // paragraphs carry the answer, the later ones carry the advice.
      if (!atLeast(depth, 'standard')) {
        const paras = full.split('\n\n');
        return paras.length > 2 ? paras.slice(0, 2).join('\n\n') : full;
      }
      return full;
    }
  }
  // Only when they actually named it. Otherwise fall through, so the question
  // they did ask gets a chance at the taught answers and the learning queue.
  if (namedDomain) {
    return `${namedDomain} runs on 1 Month, 45 Days, 3 Months and 6 Months. Tell me which track you are on and I will list every week with what to build, its coin value and its difficulty.`;
  }
  // Anything a coordinator has already taught for this kind of question.
  const taught = await taughtAnswer(q);
  if (taught) { return taught; }

  // Nothing matched. Record it so it can be taught, then say so plainly.
  // Nothing recognised it. If it does not even mention the programme, say so
  // rather than offering a menu of things it did not ask about.
  if (!PORTAL_TERMS.test(q)) { return outOfScope(); }

  // It is about TEN but nothing here covers it, so it is worth a coordinator's
  // time. Only these reach the queue: the knowledge base stays about TEN.
  noteUnanswered(q, ctx);
  return [
    'I could not tell what you need from that.',
    '',
    'I can answer:',
    '• Your week-by-week plan — try "MERN 3 months" or "Python 45 days"',
    '• How coins add up',
    '• Certificates, attendance, documents',
    '• Which domains and durations exist',
    '',
    'Anything about your own account, marks or payments, ask your coordinator.',
  ].join('\n');
}

/* ──────────────────────────── endpoints ─────────────────────────── */

// POST /api/v2/assistant/ask
router.post('/ask', async (req, res) => {
  try {
    const { question, userId, userName, domain, deepDive } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'question required' });
    }

    /*
     * The quota is checked and spent here, on the server, before an answer is
     * produced. A counter kept in browser storage is cleared by one devtools
     * command or a reinstall, so anything gated on it is not really gated.
     * Since this decides who has paid, it cannot live on the client.
     */
    const usage = await loadUsage(userId);
    const q     = quotaFor(usage);

    if (q.exhausted) {
      return res.status(402).json({
        error: 'message_limit_reached',
        paywall: paywallPayload(q.tier, q),
        tier: q.tier.key,
        used: q.used,
        limit: q.tier.messages,
      });
    }

    // Deep Dive is a Plus and Enterprise feature. Asking for it on a lower
    // tier answers normally rather than failing, and says why.
    const wantsDeepDive   = !!deepDive;
    const deepDiveAllowed = wantsDeepDive && q.tier.deepDive;
    const depth           = deepDiveAllowed ? 'ultimate' : q.tier.depth;

    let answer = await answerFor(question, { domain, depth, userName, userId });
    if (wantsDeepDive && !deepDiveAllowed) {
      answer += '\n\nDeep Dive Mode is available on Plus and Enterprise.';
    }

    try { if (usage) {
      usage.messagesUsed += 1;
      if (q.tier.historyDays === null || q.tier.historyDays > 0) {
        usage.history.push({ question: String(question), answer, askedAt: new Date() });
        // Trimmed on write, so nothing is retained longer than the tier the
        // student is actually on.
        if (q.tier.historyDays !== null) {
          const cutoff = Date.now() - q.tier.historyDays * 24 * 60 * 60 * 1000;
          usage.history = usage.history.filter(function (h) {
            return new Date(h.askedAt).getTime() >= cutoff;
          });
        }
      } else {
        usage.history = [];
      }
      await usage.save();
    } } catch (e) {
      // The answer is already computed. Losing the counter is worth less than
      // losing the reply, so this is logged and swallowed.
      console.warn('[assistant] could not record usage:', e.message);
    }

    if (BotQuery && userId) {
      BotQuery.create({
        userId, userType: 'student', userName: userName || '',
        domain: domain || '', botType: 'task', question, answer, status: 'answered',
      }).catch(function () {});
    }

    const after = quotaFor(usage);
    return res.json({
      answer,
      source: 'portal-data',
      tier: after.tier.key,
      depth,
      deepDive: deepDiveAllowed,
      used: after.used,
      limit: after.tier.messages,
      remaining: after.remaining,
    });
  } catch (e) {
    console.error('[assistant/ask]', e.message);
    return res.status(500).json({ error: 'The assistant could not answer that. Try again.' });
  }
});

/**
 * Everything the paywall screen needs, so its copy lives in one place.
 *
 * `sub` states plainly what happened before any pitch. A student who hits the
 * limit mid-question and is shown only "Great minds don't give advice by the
 * hour" has no idea whether they ran out of messages or the thing broke - and
 * the second reading is the one people reach for.
 */
function paywallPayload(currentTier, quota) {
  const used  = quota && typeof quota.used === 'number' ? quota.used : null;
  const limit = currentTier && currentTier.messages;
  const resets = quota && quota.resetsOn
    ? ' Your free messages reset on ' + quota.resetsOn + '.'
    : '';

  return {
    headline: 'Great minds don’t give advice by the hour.',
    sub: (used !== null && limit)
      ? 'You have used all ' + limit + ' of your free messages this month.' + resets + ' Pick a plan to keep going.'
      : 'Your mentor has more to say.',
    reason: 'message_limit_reached',
    used: used,
    limit: limit,
    current: (currentTier && currentTier.key) || 'starter',
    upi: { vpa: UPI.vpa, payeeName: UPI.payeeName },
    plans: ['pro', 'plus', 'enterprise'].map(function (k) {
      const t = TIERS[k];
      return {
        key: t.key,
        label: t.label,
        price: t.price,
        priceLabel: t.priceLabel,
        blurb: t.blurb,
        messages: t.messages === null ? 'Unlimited messages' : t.messages + ' messages',
        history: t.historyDays === null ? 'Full conversation history' : t.historyDays + '-day history',
        deepDive: t.deepDive,
      };
    }),
  };
}

// GET /api/v2/assistant/entitlement?userId=...
router.get('/entitlement', async (req, res) => {
  try {
    const usage = await loadUsage(req.query.userId);
    const q     = quotaFor(usage);
    return res.json({
      tier: q.tier.key,
      label: q.tier.label,
      depth: q.tier.depth,
      deepDive: q.tier.deepDive,
      used: q.used,
      limit: q.tier.messages,
      remaining: q.remaining,
      historyDays: q.tier.historyDays,
      paywall: paywallPayload(q.tier, q),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/v2/assistant/history?userId=...
router.get('/history', async (req, res) => {
  try {
    const usage = await loadUsage(req.query.userId);
    const q     = quotaFor(usage);
    if (!usage || !usage.history || q.tier.historyDays === 0) {
      return res.json({ tier: q.tier.key, retained: 0, history: [] });
    }
    return res.json({
      tier: q.tier.key,
      retained: q.tier.historyDays,
      history: usage.history.slice(-100),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ─────────────────────────── UPI payment ───────────────────────── */
/*
 * The same UPI-and-UTR flow the tenure payment already runs, so students see
 * one payment pattern across the portal rather than two.
 *
 * The important property: paying over a static UPI QR cannot be verified
 * programmatically. Nothing in the UPI response comes back to this server, and
 * a student can type any string into the reference field. So submitting a UTR
 * records a claim and grants nothing. The tier is granted only by
 * verifyPayment, after a human has matched the reference against the merchant
 * statement. Auto-granting on submission would hand every tier to anyone who
 * typed twelve characters.
 */
const UPI = {
  vpa: 'paytmqr5k0ods@ptys',
  payeeName: 'LIMITLESS TECHNOLOGI',
};

/*
 * The QR is generated per request rather than served from public/paytm-qr.jpeg.
 *
 * Two reasons. That file is corrupt in the repository - it begins with UTF-8
 * replacement characters instead of the JPEG magic bytes, so it has never
 * rendered; something committed it through a text-mode tool. And a generated
 * code can carry the exact amount for the tier, so the payer's UPI app
 * pre-fills 500, 1200 or 5000 instead of the student typing it and underpaying.
 *
 * It encodes the standard UPI URI with the real VPA, so every UPI app resolves
 * it to the same merchant account as the printed Paytm code.
 */
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_e) { /* route degrades below */ }

/** Deep link so a phone opens its UPI app with the amount already filled. */
function upiLink(tier) {
  const q = [
    'pa=' + encodeURIComponent(UPI.vpa),
    'pn=' + encodeURIComponent(UPI.payeeName),
    'am=' + encodeURIComponent(String(tier.price)),
    'cu=INR',
    'tn=' + encodeURIComponent('TEN Assistant ' + tier.label),
  ].join('&');
  return 'upi://pay?' + q;
}

// GET /api/v2/assistant/payment-info?tier=pro
router.get('/payment-info', (req, res) => {
  const tier = TIERS[req.query.tier];
  if (!tier || !tier.price) {
    return res.status(400).json({ error: 'unknown or free tier' });
  }
  return res.json({
    tier: tier.key,
    label: tier.label,
    amount: tier.price,
    priceLabel: tier.priceLabel,
    vpa: UPI.vpa,
    payeeName: UPI.payeeName,
    qrImage: '/api/v2/assistant/payment-qr?tier=' + tier.key,
    upiLink: upiLink(tier),
    note: 'Pay the exact amount, then submit the UPI reference number. Your plan activates once the team verifies the payment.',
  });
});

// GET /api/v2/assistant/payment-qr?tier=pro
router.get('/payment-qr', async (req, res) => {
  try {
    const tier = TIERS[req.query.tier];
    if (!tier || !tier.price) { return res.status(400).json({ error: 'unknown or free tier' }); }
    if (!QRCode) { return res.status(503).json({ error: 'qrcode module unavailable' }); }

    const png = await QRCode.toBuffer(upiLink(tier), {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 480,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    res.type('image/png');
    // Deterministic for a given tier, but kept short so a VPA change is picked
    // up without chasing caches.
    res.set('Cache-Control', 'public, max-age=600');
    return res.send(png);
  } catch (e) {
    console.error('[assistant/payment-qr]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/v2/assistant/submit-utr   { userId, tier, utr }
router.post('/submit-utr', async (req, res) => {
  try {
    const { userId, tier, utr } = req.body || {};
    if (!userId) { return res.status(400).json({ error: 'userId required' }); }

    const plan = TIERS[tier];
    if (!plan || !plan.price) { return res.status(400).json({ error: 'unknown or free tier' }); }

    // Same shape the tenure payment flow already accepts, so students are not
    // told two different things about what a valid reference looks like.
    const ref = String(utr || '').trim();
    if (!/^[A-Za-z0-9]{6,25}$/.test(ref)) {
      return res.status(400).json({
        error: 'Please enter a valid Transaction ID (6 to 25 characters, letters and numbers only).',
      });
    }

    if (!AssistantUsage) { return res.status(503).json({ error: 'payments unavailable' }); }

    const row = await AssistantUsage.findOneAndUpdate(
      { userId },
      {
        $set: {
          pendingPayment: {
            tier: plan.key,
            amount: plan.price,
            utr: ref,
            status: 'pending',
            submittedAt: new Date(),
            reviewedBy: null,
            reviewedAt: null,
            note: null,
          },
        },
      },
      { upsert: true, new: true }
    );

    // Deliberately no entitlement here. See the note at the top of this block.
    return res.json({
      ok: true,
      status: 'pending',
      tier: plan.key,
      message: 'Reference received. Your ' + plan.label + ' plan activates once the team verifies the payment.',
      submittedAt: row.pendingPayment.submittedAt,
    });
  } catch (e) {
    console.error('[assistant/submit-utr]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/*
 * GET /api/v2/assistant/payment-requests?status=pending
 *
 * Admin only. This lists other students' user IDs and UPI references, so it
 * carries the same guard as verify-payment: an unset token refuses rather
 * than serving, because the failure mode of getting this wrong is every
 * student being able to read everyone else's payment claims.
 */
router.get('/payment-requests', async (req, res) => {
  try {
    const expected = process.env.ASSISTANT_ADMIN_TOKEN;
    if (!expected) {
      console.warn('[assistant] ASSISTANT_ADMIN_TOKEN not set; payment-requests refused');
      return res.status(503).json({ error: 'not configured' });
    }
    if (req.get('X-Admin-Token') !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!AssistantUsage) { return res.json({ requests: [] }); }
    const status = req.query.status || 'pending';
    const rows = await AssistantUsage
      .find({ 'pendingPayment.status': status })
      .sort({ 'pendingPayment.submittedAt': -1 })
      .lean();
    return res.json({
      count: rows.length,
      requests: rows.map(function (r) {
        return {
          userId: r.userId,
          currentTier: r.tier,
          requested: r.pendingPayment.tier,
          amount: r.pendingPayment.amount,
          utr: r.pendingPayment.utr,
          submittedAt: r.pendingPayment.submittedAt,
        };
      }),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/*
 * POST /api/v2/assistant/verify-payment   { userId, approve, reviewedBy, note }
 *
 * The only path that grants a paid tier. Guarded by ASSISTANT_ADMIN_TOKEN,
 * required rather than optional: an unset token refuses the request, because
 * an open endpoint here means anyone can approve their own payment.
 */
router.post('/verify-payment', async (req, res) => {
  try {
    const expected = process.env.ASSISTANT_ADMIN_TOKEN;
    if (!expected) {
      console.warn('[assistant] ASSISTANT_ADMIN_TOKEN not set; verification refused');
      return res.status(503).json({ error: 'verification not configured' });
    }
    if (req.get('X-Admin-Token') !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { userId, approve, reviewedBy, note } = req.body || {};
    if (!userId) { return res.status(400).json({ error: 'userId required' }); }
    if (!AssistantUsage) { return res.status(503).json({ error: 'payments unavailable' }); }

    const row = await AssistantUsage.findOne({ userId });
    if (!row || !row.pendingPayment || row.pendingPayment.status !== 'pending') {
      return res.status(404).json({ error: 'no pending payment for this user' });
    }

    if (!approve) {
      row.pendingPayment.status     = 'rejected';
      row.pendingPayment.reviewedBy = reviewedBy || 'admin';
      row.pendingPayment.reviewedAt = new Date();
      row.pendingPayment.note       = note || null;
      await row.save();
      return res.json({ ok: true, status: 'rejected', tier: row.tier });
    }

    const tierKey = row.pendingPayment.tier;
    await grantEntitlement(userId, tierKey, {
      store: 'upi',
      productId: 'upi:' + row.pendingPayment.utr,
      appUserId: userId,
    });

    const fresh = await AssistantUsage.findOne({ userId });
    fresh.pendingPayment.status     = 'verified';
    fresh.pendingPayment.reviewedBy = reviewedBy || 'admin';
    fresh.pendingPayment.reviewedAt = new Date();
    await fresh.save();

    return res.json({ ok: true, status: 'verified', tier: tierKey });
  } catch (e) {
    console.error('[assistant/verify-payment]', e.message);
    return res.status(500).json({ error: e.message });
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

/*
 * GET /api/v2/assistant/health
 *
 * Reports what the assistant can actually reach. "The assistant could not
 * answer that" is useless on its own, so this names the cause: whether mongoose
 * is connected, whether the task library has rows, and whether entitlements can
 * be read. Safe to expose - it returns counts and states, never data.
 */
/*
 * The learning loop, both admin-only.
 *
 *   GET  /unanswered   what the assistant could not answer
 *   POST /teach        { topic, answer } - answer it once, for everyone
 *
 * Behind the admin token for the same reason /verify-payment is: whoever can
 * write here can make the assistant say anything to every student.
 */
function adminOk(req, res) {
  const expected = process.env.ASSISTANT_ADMIN_TOKEN;
  if (!expected) { res.status(503).json({ error: 'not configured' }); return false; }
  if (req.get('X-Admin-Token') !== expected) { res.status(401).json({ error: 'unauthorized' }); return false; }
  return true;
}

router.get('/unanswered', async (req, res) => {
  if (!adminOk(req, res)) { return; }
  try {
    if (!BotQuery) { return res.json({ total: 0, questions: [] }); }
    const rows = await BotQuery.find({ answer: null, status: 'open' })
      .sort({ createdAt: -1 }).limit(200).lean();

    // Group near-duplicates, so the same question asked forty times is one job
    // rather than forty rows to read.
    const groups = {};
    rows.forEach(function (r) {
      const key = keywords(r.question).sort().join(' ').slice(0, 60) || String(r.question).slice(0, 40);
      if (!groups[key]) { groups[key] = { sample: r.question, count: 0, domains: {} }; }
      groups[key].count++;
      if (r.domain) { groups[key].domains[r.domain] = true; }
    });

    const questions = Object.keys(groups).map(function (k) {
      return {
        question: groups[k].sample,
        askedTimes: groups[k].count,
        domains: Object.keys(groups[k].domains),
      };
    }).sort(function (a, b) { return b.askedTimes - a.askedTimes; });

    return res.json({ total: rows.length, questions: questions });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/teach', async (req, res) => {
  if (!adminOk(req, res)) { return; }
  try {
    const { topic, answer } = req.body || {};
    if (!topic || !answer) { return res.status(400).json({ error: 'topic and answer required' }); }
    // The knowledge base is for TEN. Refusing off-topic entries keeps it from
    // drifting into a general FAQ nobody is maintaining.
    if (!PORTAL_TERMS.test(String(topic) + ' ' + String(answer))) {
      return res.status(400).json({ error: 'off topic: this assistant only covers TEN and its portal' });
    }
    if (!SystemKnowledge) { return res.status(503).json({ error: 'knowledge store unavailable' }); }

    await SystemKnowledge.findOneAndUpdate(
      { topic: String(topic).toLowerCase().trim() },
      { content: String(answer).trim(), updatedAt: new Date() },
      { upsert: true, new: true }
    );

    // Close the open questions this now answers, so the queue drains instead
    // of growing forever.
    let closed = 0;
    if (BotQuery) {
      const words = keywords(topic + ' ' + answer);
      const open = await BotQuery.find({ answer: null, status: 'open' }).lean();
      const ids = open.filter(function (r) {
        const hay = String(r.question).toLowerCase();
        return words.filter(function (w) { return hay.indexOf(w) !== -1; }).length >= 2;
      }).map(function (r) { return r._id; });
      if (ids.length) {
        await BotQuery.updateMany({ _id: { $in: ids } }, { status: 'answered' });
        closed = ids.length;
      }
    }

    return res.json({ ok: true, topic: topic, closedQuestions: closed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});


router.get('/health', async (req, res) => {
  const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const out = {
    ok: true,
    requiresApiKey: false,
    database: STATES[mongoose.connection.readyState] || 'unknown',
    curriculum: 'unknown',
    domains: 0,
    entitlements: 'unknown',
    notes: [],
  };

  try {
    const domains = await allDomains();
    out.domains = domains.length;
    const rows = await DomainTask.estimatedDocumentCount();
    out.curriculum = rows > 0 ? 'seeded (' + rows + ' tasks)' : 'empty';
    if (!rows) {
      out.notes.push('DomainTask is empty. Run: node seeds/domainTasks.seed.js');
    }
  } catch (e) {
    out.curriculum = 'unreadable';
    out.notes.push('Task library unreadable: ' + e.message);
  }

  if (!AssistantUsage) {
    out.entitlements = 'model missing';
  } else {
    try {
      await AssistantUsage.estimatedDocumentCount();
      out.entitlements = 'readable';
    } catch (e) {
      out.entitlements = 'unreadable';
      out.notes.push('Usage unreadable, tiers will not meter: ' + e.message);
    }
  }

  if (out.database !== 'connected') {
    out.notes.push('MONGODB_URI is not set or the database is unreachable. The assistant still answers, at Starter depth, without track plans.');
  }
  if (!out.notes.length) { out.notes.push('All good.'); }

  return res.json(out);
});

module.exports = router;
