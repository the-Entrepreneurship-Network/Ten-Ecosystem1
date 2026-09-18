'use strict';

/**
 * The LinkedIn agent's brain: one chat turn in, one reply out.
 *
 * This module is deliberately pure. It holds no HTTP, no cron and no global
 * state: every turn receives the message, the session blob the browser is
 * carrying, the person asking, and the modules it may lean on. The route is a
 * thin shell around turn(); the tests hand it fakes. That split is what lets
 * the whole conversation — review, refusal, rewrite, poster, post, schedule,
 * history — be exercised with no database, no LinkedIn token and no network,
 * which is the only way "nothing ever posts during tests" can be promised.
 *
 * Two rules shape everything below.
 *
 * 1. The agent never publishes the original text. What goes out is always the
 *    version it composed after the content guard has passed it. "post it",
 *    "post anyway" and "post my original" all resolve to that version; the
 *    words differ only in how the reply explains itself. If the guard blocks
 *    the draft and nothing appropriate can be salvaged, nothing is posted and
 *    the reply says why, quoting only the offending excerpt — a reply that
 *    echoed a blocked draft in full would just be the draft again, in the
 *    agent's voice.
 *
 * 2. The session is client-held state. The browser sends it back on every
 *    turn, which means a determined staff member could edit `final` in the
 *    dev tools and ask the agent to post it. So the text is re-reviewed at the
 *    moment of publishing, and a blocked text is refused there too, no matter
 *    what the earlier turns said.
 */

const INTENTS = {
  /* "yes" is the affirmative for whatever the agent last asked; when it is
     awaiting a schedule confirmation it means schedule, otherwise post. */
  post: /^(yes|ok|okay|post( it| this| now)?|publish( it| now)?|go ahead|ship it|confirm)$/i,
  postAnyway: /^(post (my )?original|post (it |this )?anyway|post anyway)$/i,
  schedule: /^schedule(?:\s+(?:it\s+|this\s+|for\s+)?(.+))?$/i,
  shorter: /^(shorter|make it shorter|too long|trim it)$/i,
  longer: /^(longer|make it longer|expand it)$/i,
  formal: /^((more )?formal|formal tone)$/i,
  warm: /^(warm(er)?|friendlier|more friendly|warm tone)$/i,
  regenerate: /^(regenerate|another version|another one|try again|rewrite it)$/i,
  noImage: /^(no image|without (the )?image|text only|no poster)$/i,
  withImage: /^(with (the )?image|add (the )?image|keep (the )?image)$/i,
  /* Drawing a poster is a separate request from keeping the author's own
     photograph, so it gets its own phrase. */
  makePoster: /^(make|draw|generate|create|add)( me)?( a| the)? poster$/i,
  /* Showing the gallery, and choosing from it. "poster 2" and "use midnight"
     are both how people answer a row of six pictures. */
  showPosters: /^(posters?|show (me )?posters?|poster options|suggest (a )?posters?|design options)$/i,
  pickPoster: /^(?:use |pick |choose |poster |design )?(midnight|solar|split|paper|spotlight|blueprint|[1-6])$/i,
  noPoster: /^(no poster|without (a )?poster|skip the poster|text only)$/i,
  /* The way back to the sub-editor, for somebody who wants their own words
     and nothing else. "Elaborate" turns the full writer back on. */
  keepShort: /^(keep it short|as typed|just my words|short version|do not elaborate|don.t elaborate|no elaboration)$/i,
  elaborateMore: /^(elaborate|expand( it)?|make it longer|full version|write it properly|more detail)$/i,
  /* Answering, or refusing to answer, one of the intake questions. */
  skip: /^(skip|skip it|no|none|n\/a|not sure|later|does not matter|doesn.t matter)$/i,
  headline: /^(?:change (?:the )?headline to|headline:)\s*(.+)$/i,
  hashtags: /^hashtags:\s*(.+)$/i,
  cta: /^cta:\s*(.+)$/i,
  history: /^(history|what did we post|posts|show posts|recent posts)$/i,
  stats: /^(stats|analytics|how did .* do)$/i,
  help: /^(help|what can you do|\?)$/i,
  cancel: /^(cancel|discard|start over|new post)$/i,
  /* "no" answers a pending question without throwing the draft away. */
  decline: /^(no|nope|not now|not yet|don't)$/i,
  /* The dashboard's quick chips. They set the kind for the draft that follows
     rather than being drafts themselves — "Internship opening" is not a post. */
  kindOpening: /^(internship opening|opening|new opening|hiring post)$/i,
  kindPlacement: /^(placement story|placement|success story|achievement)$/i,
  kindLeadgen: /^(attract freshers|leadgen|lead gen|lead generation|freshers)$/i,
  kindGeneral: /^(general post|general|announcement)$/i,
};

const KINDS = ['opening', 'placement', 'leadgen', 'general'];
const TONES = ['professional', 'warm', 'formal'];

/* Blocking codes that no rewrite can make appropriate. The others that block
   (a personal phone number, a "females only" line, a company called a scam)
   usually sit inside a legitimate post, and removing the offending sentence
   leaves something worth publishing. */
const UNRECOVERABLE = ['hate_slur', 'harassment_threat', 'sexual_explicit'];

const DRY_RUN_NOTICE = 'LinkedIn is not connected on this server — dry run. Payload saved; connect LinkedIn in Settings to post for real.';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const BRAND_NAME = 'The Entrepreneurship Network';

/* How many of the seven hiring facts have to be missing before the agent
   starts asking. Four of seven means a one-line note opens the questions and
   a filled-in brief does not. */
const INTAKE_THRESHOLD = 4;

/* ── dependencies ───────────────────────────────────────────────────────── */

/*
 * Required lazily and only for the keys the caller did not inject. The unit
 * tests inject everything, so they never load mongoose or the composer; the
 * route injects nothing, so it gets the real modules. Eager requires at the
 * top of this file would tie the agent's testability to every sibling module
 * existing and loading cleanly.
 */
function resolveDeps(deps) {
  const given = deps || {};
  const pick = (name, path) => (given[name] ? given[name] : require(path));
  return {
    LinkedInPost: pick('LinkedInPost', '../../../models/LinkedInPost'),
    linkedinClient: pick('linkedinClient', './linkedinClient'),
    scheduler: pick('scheduler', './scheduler'),
    composer: pick('composer', './postComposer'),
    guard: pick('guard', './contentGuard'),
    posters: pick('posters', './posterStudio'),
    designs: pick('designs', './posterDesigns'),
    elaborate: pick('elaborate', './elaborate'),
    intake: pick('intake', './intake'),
    now: given.now || (() => new Date()),
  };
}

/* ── small helpers ──────────────────────────────────────────────────────── */

function str(v, max) {
  const s = v == null ? '' : String(v);
  return max ? s.slice(0, max) : s;
}

/** "1,120" — the reply quotes character counts the way LinkedIn's own counter does. */
function withCommas(n) {
  return String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

function countHashtags(text) {
  const m = String(text || '').match(/(^|\s)#[A-Za-z0-9_]+/g);
  return m ? m.length : 0;
}

/**
 * The IST calendar day containing `now`, as UTC instants.
 *
 * Done by hand with a fixed +05:30 because India has no daylight saving and
 * the server's own timezone is whatever the host happens to be — a PM2 box in
 * UTC would otherwise count "today" from 05:30 IST, and the cadence advisory
 * would forget the morning's posts every afternoon.
 */
function istDayRange(now) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const startUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS;
  return { start: new Date(startUtc), end: new Date(startUtc + DAY_MS) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "12 Sep" in IST — how the advisories name an earlier post. */
function istDate(date) {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Fri 19 Sep, 10:00 am IST" — how a scheduled time is read back. */
function istDateTime(date) {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'} IST`;
}

/**
 * Dice coefficient over word bigrams, on text with hashtags and punctuation
 * removed and case folded.
 *
 * Bigrams rather than words because two internship posts share most of their
 * vocabulary ("apply", "internship", "remote", "stipend") while saying
 * different things; it is the word pairs that reveal the same sentences. The
 * hashtag line is dropped because every post ends with the same three core
 * tags, which would push any two posts toward looking alike.
 */
function bigrams(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/#[\w]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i + 1 < words.length; i += 1) set.add(`${words[i]} ${words[i + 1]}`);
  return set;
}

function diceSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

/**
 * Await a model query whether it is a mongoose Query or a plain promise.
 *
 * Mongoose returns a chainable Query from find(); the test fakes return an
 * array or a promise. Applying sort/limit/lean only when they exist means the
 * same code runs against both without the fakes having to imitate a Query.
 */
async function findMany(Model, filter, opts) {
  const o = opts || {};
  let q = Model.find(filter);
  if (q && typeof q.sort === 'function' && o.sort) q = q.sort(o.sort);
  if (q && typeof q.limit === 'function' && o.limit) q = q.limit(o.limit);
  if (q && typeof q.lean === 'function') q = q.lean();
  const rows = await q;
  return Array.isArray(rows) ? rows : [];
}

async function findOne(Model, id) {
  let q = Model.findById(id);
  if (q && typeof q.lean === 'function') q = q.lean();
  return (await q) || null;
}

function idOf(doc) {
  if (!doc) return '';
  const id = doc._id != null ? doc._id : doc.id;
  return id == null ? '' : String(id);
}

/* ── session ────────────────────────────────────────────────────────────── */

/**
 * Only the fields the agent itself writes survive a round trip through the
 * browser. Anything else the client sends back is dropped, and every string
 * is capped, so a tampered or bloated blob cannot smuggle state in or blow
 * the request body up.
 */
function normaliseSession(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {
    draft: str(s.draft, 6000),
    kind: KINDS.includes(s.kind) ? s.kind : '',
    kindHint: KINDS.includes(s.kindHint) ? s.kindHint : '',
    verdict: ['ok', 'revise', 'block'].includes(s.verdict) ? s.verdict : '',
    issues: Array.isArray(s.issues) ? s.issues.slice(0, 40).map(cleanIssue) : [],
    composed: s.composed && typeof s.composed === 'object' ? {
      hook: str(s.composed.hook, 400),
      body: str(s.composed.body, 4000),
      cta: str(s.composed.cta, 600),
      hashtags: Array.isArray(s.composed.hashtags) ? s.composed.hashtags.slice(0, 10).map((h) => str(h, 60)) : [],
      text: str(s.composed.text, 4000),
      kind: KINDS.includes(s.composed.kind) ? s.composed.kind : 'general',
      chars: Number(s.composed.chars) || 0,
    } : null,
    final: str(s.final, 4000),
    poster: s.poster && typeof s.poster === 'object' ? {
      template: KINDS.includes(s.poster.template) ? s.poster.template : 'general',
      fields: s.poster.fields && typeof s.poster.fields === 'object' ? s.poster.fields : {},
    } : null,
    withImage: s.withImage !== false,
    awaiting: ['confirm-schedule', 'schedule-when', 'draft', 'intake', 'pick-poster', 'confirm-post'].includes(s.awaiting) ? s.awaiting : '',
    /*
     * The intake, carried across turns.
     *
     * The session is client state and everything in it is re-validated here on
     * the way back in, which is why each of these is clamped rather than
     * copied. They were missing from this list at first and the effect was
     * quietly absurd: the agent asked which domain the internship was for,
     * the browser sent the answer back, `awaiting` had been scrubbed to '' on
     * the way out, and the answer was read as a brand new draft — so every
     * question was asked exactly once and answering it threw the post away.
     */
    facts: s.facts && typeof s.facts === 'object' ? cleanFacts(s.facts) : {},
    asked: Array.isArray(s.asked) ? s.asked.slice(0, 20).map((f) => str(f, 30)) : [],
    askingField: str(s.askingField, 30),
    intakeDone: Boolean(s.intakeDone),
    brevity: s.brevity === 'short' ? 'short' : 'full',
    sourceText: str(s.sourceText, 6000),
    /* Which designs were offered, so "poster 2" means the second of those. */
    gallery: Array.isArray(s.gallery) ? s.gallery.slice(0, 8).map((g) => str(g, 24)) : [],
    design: str(s.design, 24),
    wantsPoster: Boolean(s.wantsPoster),
    scheduleFor: str(s.scheduleFor, 40),
    postId: str(s.postId, 40),
    lastPostId: str(s.lastPostId, 40),
    variant: Math.max(0, Math.min(20, Number(s.variant) || 0)),
    tone: TONES.includes(s.tone) ? s.tone : 'professional',
    fixed: Array.isArray(s.fixed) ? s.fixed.slice(0, 40).map((c) => str(c, 40)) : [],
    nearDuplicate: s.nearDuplicate && typeof s.nearDuplicate === 'object'
      ? { date: str(s.nearDuplicate.date, 20), score: Number(s.nearDuplicate.score) || 0 }
      : null,
  };
  return out;
}

/**
 * The collected facts, bounded.
 *
 * Only the fields the intake asks about survive, each clipped: the browser
 * could send anything back under this key, and these values are printed onto
 * a poster and into a post. An unbounded object here would be a way to put
 * arbitrary text on the company's page through a field nobody is reading.
 */
const FACT_KEYS = ['org', 'role', 'domain', 'batch', 'openings', 'mode', 'location',
  'duration', 'stipend', 'skills', 'eligibility', 'applyBy', 'afterLpa'];

function cleanFacts(f) {
  const out = {};
  FACT_KEYS.forEach((k) => {
    const v = str(f[k], 160).trim();
    if (v) out[k] = v;
  });
  return out;
}

function cleanIssue(i) {
  const o = i && typeof i === 'object' ? i : {};
  return {
    code: str(o.code, 40),
    severity: ['block', 'revise', 'note'].includes(o.severity) ? o.severity : 'note',
    excerpt: str(o.excerpt, 160),
    message: str(o.message, 300),
    fix: str(o.fix, 300),
  };
}

/** A session with nothing in progress; the kind hint is the only thing kept. */
function freshSession(prev, keep) {
  const base = normaliseSession({});
  if (keep && prev && prev.kindHint) base.kindHint = prev.kindHint;
  return base;
}

/* ── reply building ─────────────────────────────────────────────────────── */

const helpText = [
  'Here is what I do, in the order you would use it:',
  '• Draft — paste an idea or a rough post; I turn it into a LinkedIn-ready one (hook, body, CTA, hashtags).',
  '• Review — every draft is checked first: contact details, hiring restrictions, superlatives, shouting, length. I say exactly what I changed.',
  '• Poster — an internship opening, a placement story or a freshers post gets a branded square poster.',
  '• Post — say "post it" and it goes to the company page (or a dry run when LinkedIn is not connected).',
  '• Schedule — "schedule tomorrow 10am" or "schedule monday 9am"; times are IST.',
  '• History and stats — "history" lists recent posts; "stats" shows page numbers when LinkedIn is connected.',
  '• Change it — "shorter", "longer", "formal", "warm", "regenerate", "no image", "change the headline to …", "hashtags: …", "cta: …".',
  '• "cancel" drops the draft in progress.',
].join('\n');

function issueLine(i) {
  const fix = i.fix ? ` -> ${i.fix}` : '';
  return `• ${i.code} — ${i.message}${fix}`;
}

function countsLine(text, poster, withImage) {
  const posterNote = poster && withImage ? 'square poster attached' : 'no poster';
  const tags = countHashtags(text);
  return `${withCommas(text.length)} characters · ${tags} hashtag${tags === 1 ? '' : 's'} · ${posterNote}`;
}

function reviewOptions(extra) {
  const options = [
    { label: 'Post now', value: 'post it' },
    { label: 'Schedule', value: 'schedule' },
    { label: 'Shorter', value: 'shorter' },
    { label: 'Regenerate', value: 'regenerate' },
    { label: 'No image', value: 'no image' },
    { label: 'Change headline', value: 'change the headline to ' },
  ];
  if (extra && extra.postAnyway) options.splice(1, 0, { label: 'Post anyway', value: 'post anyway', note: 'It is close to an earlier post' });
  return { options };
}

function verdictLine(verdict, issues) {
  const revise = issues.filter((i) => i.severity === 'revise').length;
  const notes = issues.filter((i) => i.severity === 'note').length;
  if (verdict === 'ok') {
    if (notes === 0) return 'Clean. Nothing to fix.';
    return `Clean, with ${notes === 1 ? 'one small note' : `${notes} small notes`}.`;
  }
  return `Close — ${revise === 1 ? 'one thing' : `${revise} things`} needed fixing before this could go out. Done below.`;
}

function posterFor(d, session) {
  if (!session.poster) return null;
  try {
    const built = d.posters.build({ template: session.poster.template, fields: session.poster.fields, size: 'square' });
    return Object.assign({}, built, { withImage: session.withImage !== false });
  } catch (e) {
    console.error('[linkedin-agent] poster build failed:', e.message);
    return null;
  }
}

function postSummary(session) {
  return {
    text: session.final,
    hashtags: (session.composed && session.composed.hashtags) || [],
    chars: session.final.length,
    kind: session.kind || 'general',
  };
}

function reviewPayload(session) {
  return {
    verdict: session.verdict,
    issues: session.issues,
    original: session.verdict === 'block' ? '' : session.draft,
    final: session.final,
    chars: session.final.length,
    kind: session.kind || 'general',
  };
}

/* ── advisories ─────────────────────────────────────────────────────────── */

/**
 * Two lines that may be appended to a review. Neither ever blocks: the
 * cadence line is about what the feed rewards, the duplicate line is about
 * not repeating ourselves, and either can be overridden on purpose. Both are
 * best-effort — a database that is down costs the advisory, not the review.
 */
async function advisories(d, finalText) {
  const lines = [];
  let nearDuplicate = null;
  const now = d.now();
  try {
    const { start, end } = istDayRange(now);
    const today = await d.LinkedInPost.countDocuments({ status: 'published', publishedAt: { $gte: start, $lt: end } });
    if (today >= 2) {
      lines.push(`This would be the ${ordinal(today + 1)} post today — one or two a day is what the feed rewards.`);
    }
  } catch (e) {
    console.error('[linkedin-agent] cadence check failed:', e.message);
  }
  try {
    const recent = await findMany(d.LinkedInPost, {
      status: 'published',
      publishedAt: { $gte: new Date(now.getTime() - 30 * DAY_MS) },
    }, { sort: { publishedAt: -1 }, limit: 100 });
    let best = null;
    for (const p of recent) {
      const score = diceSimilarity(finalText, p.final || '');
      if (score >= 0.8 && (!best || score > best.score)) best = { score, date: istDate(p.publishedAt || p.createdAt || now) };
    }
    if (best) {
      nearDuplicate = best;
      lines.push(`This is very close to what we posted on ${best.date} — say "post anyway" if that is intended.`);
    }
  } catch (e) {
    console.error('[linkedin-agent] duplicate check failed:', e.message);
  }
  return { lines, nearDuplicate };
}

/* ── drafting ───────────────────────────────────────────────────────────── */

/**
 * Drop the sentences the guard blocked on, for the codes where that leaves a
 * post worth having. A blocked draft comes back with `cleaned` empty — the
 * guard does not guess what to keep — so the agent removes each blocking
 * excerpt itself and asks the guard again. If the remainder still blocks, or
 * the trouble was hate/harassment/sexual content, there is nothing to offer.
 */
function scrub(text, issues) {
  let out = String(text || '');
  for (const i of issues) {
    if (i.severity !== 'block' || !i.excerpt) continue;
    const idx = out.indexOf(i.excerpt);
    if (idx < 0) continue;
    /* Take the whole sentence the excerpt sits in, not just the excerpt: a
       phone number with "Call me on" left behind reads as a broken sentence. */
    const before = out.lastIndexOf('\n', idx);
    const sentStart = Math.max(before + 1, Math.max(out.lastIndexOf('. ', idx), out.lastIndexOf('! ', idx), out.lastIndexOf('? ', idx)) + 2);
    const afterMatch = out.slice(idx + i.excerpt.length).search(/[.!?\n]/);
    const sentEnd = afterMatch < 0 ? out.length : idx + i.excerpt.length + afterMatch + 1;
    out = `${out.slice(0, Math.max(0, sentStart))} ${out.slice(sentEnd)}`;
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function recoverable(issues) {
  return !issues.some((i) => i.severity === 'block' && (
    UNRECOVERABLE.includes(i.code)
    || (i.code === 'defamation' && /\b(person|individual|people|student|employee)\b/i.test(i.message || ''))
  ));
}

async function composeFinal(d, source, session, extra) {
  const kind = session.kind;
  const fields = safeExtract(d, source, kind);
  const opts = Object.assign({ kind, issues: session.issues, variant: session.variant, tone: session.tone, fields }, extra || {});

  /*
   * Elaborate by default; keep it short only when asked.
   *
   * "We are hiring Python developers" is true and nobody applies to it. A
   * post has to say what the work is, what a student leaves with and what to
   * do next, or it is a line the feed scrolls past — so the agent writes the
   * full version unless the author has said "keep it short", in which case
   * the sub-editor runs and their words come back tidied and otherwise
   * untouched.
   *
   * Either path adds no fact the author did not give. The elaborator says
   * what is true of every TEN internship and nothing about this one that was
   * not in the note; the model-written variant is put through the content
   * guard and a figure check before it is allowed anywhere near the page.
   */
  if (session.brevity !== 'short') {
    try {
      const long = await d.elaborate.elaborate(source, opts);
      if (long && long.text) return { composed: long, fields };
    } catch (e) {
      console.error('[linkedin-agent] elaboration failed, falling back to the sub-editor:', e.message);
    }
  }

  let composed = null;
  try {
    composed = await d.composer.composeWithLLM(source, opts);
  } catch (e) {
    /* composeWithLLM promises never to throw; belt and braces. */
    composed = null;
  }
  if (!composed || !composed.text) composed = d.composer.compose(source, opts);
  return { composed, fields };
}

function safeExtract(d, text, kind) {
  try { return d.composer.extractFields(text, kind) || {}; } catch (e) { return {}; }
}

function posterFields(d, kind, fields, composed) {
  const extracted = Object.assign({}, fields, {
    headline: (composed && composed.hook) || fields.headline || '',
    sub: (composed && composed.cta) || fields.sub || '',
  });
  try { return d.posters.fieldsFor(kind, extracted) || extracted; } catch (e) { return extracted; }
}

function applyComposed(session, composed) {
  session.composed = {
    hook: str(composed.hook, 400),
    body: str(composed.body, 4000),
    cta: str(composed.cta, 600),
    hashtags: Array.isArray(composed.hashtags) ? composed.hashtags.slice(0, 10) : [],
    text: str(composed.text, 4000),
    kind: KINDS.includes(composed.kind) ? composed.kind : session.kind,
    chars: Number(composed.chars) || String(composed.text || '').length,
  };
  session.final = session.composed.text;
  /*
   * The note the post was written from, kept on the session.
   *
   * "Keep it short" and "elaborate" both re-run the writer, and they must
   * re-run it over what the author typed — not over the post the agent last
   * produced. Without this, asking for the full version twice fed finished
   * prose back in as though it were a fresh note and the post grew each
   * time.
   */
  if (composed.sourceText) session.sourceText = str(composed.sourceText, 6000);
}

async function reviewReply(d, session, opening) {
  const adv = await advisories(d, session.final);
  session.nearDuplicate = adv.nearDuplicate;
  const poster = posterFor(d, session);
  const lines = [];
  if (opening) lines.push(opening);
  lines.push('Here is the version I will post:');
  lines.push('');
  lines.push(session.final);
  lines.push('');
  lines.push(countsLine(session.final, poster, session.withImage));
  for (const l of adv.lines) lines.push(l);
  lines.push('');
  lines.push('Post it now, schedule it, or tell me what to change?');
  return {
    ok: true,
    kind: 'review',
    reply: lines.join('\n'),
    session,
    review: reviewPayload(session),
    post: postSummary(session),
    poster,
    options: reviewOptions({ postAnyway: Boolean(adv.nearDuplicate) }),
  };
}

async function handleDraft(d, message, prev, user) {
  const session = freshSession(prev, true);
  session.draft = message;
  session.kind = session.kindHint || safeKind(d, message);
  session.tone = prev.tone || 'professional';
  const rv = d.guard.review(message, { kind: session.kind });
  session.verdict = rv.verdict;
  session.issues = (rv.issues || []).map(cleanIssue);
  const blocking = session.issues.filter((i) => i.severity === 'block');

  if (rv.verdict === 'block') {
    const head = `I won't post this as written: ${blocking[0] ? blocking[0].message : 'it fails the content check'}.`;
    const issueLines = session.issues.map(issueLine);
    if (recoverable(session.issues)) {
      const scrubbed = scrub(message, session.issues);
      const again = scrubbed.length >= 25 ? d.guard.review(scrubbed, { kind: session.kind }) : { verdict: 'block', issues: [], cleaned: '' };
      if (again.verdict !== 'block' && again.cleaned) {
        const { composed, fields } = await composeFinal(d, again.cleaned, session);
        applyComposed(session, composed);
        session.fixed = blocking.map((i) => i.code);
        session.poster = { template: session.kind, fields: posterFields(d, session.kind, fields, composed) };
        const body = await reviewReply(d, session, [head, ...issueLines, '', "Here's what I can post instead — the flagged part is out, the rest is intact."].join('\n'));
        body.kind = 'review';
        return body;
      }
    }
    /* Nothing to offer. The session keeps the verdict so "post it" can be
       refused with the reason, but no final and no poster. */
    session.final = '';
    session.composed = null;
    session.poster = null;
    return {
      ok: true,
      kind: 'refused',
      reply: [head, ...issueLines, '', "There's nothing here I can post appropriately. Send me a different draft, or say \"help\"."].join('\n'),
      session,
      review: reviewPayload(session),
      options: { options: [{ label: 'Start over', value: 'start over' }, { label: 'Help', value: 'help' }] },
    };
  }

  const source = rv.cleaned || message;

  /*
   * Ask for the facts a hiring poster cannot be drawn without.
   *
   * A poster is a spec sheet, and "We are hiring Python interns" is not one:
   * a student reading it cannot tell which batch it is for, how long it runs,
   * whether it pays, or whether they are eligible. Every one of those decides
   * whether somebody applies, and only the author knows them.
   *
   * The questions run one at a time with tappable answers rather than as a
   * form, and everything already present in the draft is read first — a
   * person who typed "hiring 20 Python interns, October batch, remote, 3
   * months, 5k, freshers welcome" is asked nothing at all, which is the
   * difference between an assistant and a form.
   */
  if (session.kind === 'opening' && !session.intakeDone) {
    session.facts = Object.assign({}, d.intake.known(source, session.kind), session.facts || {});
    session.sourceText = str(source, 6000);

    /*
     * Interrogate a note, not a brief.
     *
     * Somebody who typed "hiring python interns, remote, 2 months, stipend
     * 5000, apply by 25 Sept" has done the work, and answering four more
     * questions to be told what they already said is how a helpful feature
     * becomes one people route around. So the questions only open when the
     * draft is genuinely thin; above that the post is written immediately and
     * the reply names the gaps, with a chip for anyone who does want to fill
     * them in.
     */
    const gaps = d.intake.missing(session.facts);
    if (gaps.length >= INTAKE_THRESHOLD) {
      const q = d.intake.nextQuestion(session.facts, session.asked || []);
      if (q) return askIntake(d, session, q);
    }
    session.intakeDone = true;
  }

  const { composed, fields } = await composeFinal(d, source, session);
  applyComposed(session, composed);
  session.fixed = session.issues.filter((i) => i.severity === 'revise').map((i) => i.code);
  /*
   * No poster unless one was asked for.
   *
   * The agent used to draw a branded square for every draft and attach it.
   * That is the agent choosing what the company's post looks like, and the
   * author never chose it — somebody posting a photograph of their own event
   * got a generated graphic in its place. The image that goes out is the
   * author's attachment. "Make a poster" still asks for one, and then it is
   * theirs by choice rather than by default.
   */
  session.poster = session.wantsPoster
    ? { template: session.kind, fields: posterFields(d, session.kind, fields, composed) }
    : null;
  const opening = [verdictLine(rv.verdict, session.issues), ...session.issues.map(issueLine)].join('\n');
  return reviewReply(d, session, opening);
}

function safeKind(d, text) {
  try {
    const k = d.composer.detectKind(text);
    return KINDS.includes(k) ? k : 'general';
  } catch (e) { return 'general'; }
}

/* ── transforms ─────────────────────────────────────────────────────────── */

async function handleTransform(d, session, op, arg) {
  if (!session.composed || !session.final) {
    return ask(session, 'There is no post in progress to change. Paste a draft first.');
  }
  if (op === 'regenerate') session.variant = (session.variant || 0) + 1;
  if (op === 'formal' || op === 'warm') session.tone = op;
  let next;
  try {
    next = d.composer.transform(Object.assign({}, session.composed), op, arg);
  } catch (e) {
    console.error('[linkedin-agent] transform failed:', e.message);
    next = null;
  }
  if (!next || !next.text) {
    /* A transform the composer could not do falls back to recomposing the
       cleaned draft with the new tone/variant, so the person still gets a
       fresh version rather than a shrug. */
    const source = session.draft;
    const built = await composeFinal(d, source, session);
    next = built.composed;
  }
  applyComposed(session, next);
  if (op === 'headline' && session.poster) {
    session.poster.fields = Object.assign({}, session.poster.fields, { headline: str(arg, 200) });
  }
  const said = {
    shorter: 'Shorter version:',
    longer: 'Longer version:',
    formal: 'More formal:',
    warm: 'Warmer:',
    regenerate: `Another take (version ${session.variant + 1}):`,
    headline: 'New headline in place:',
    hashtags: 'Hashtags updated:',
    cta: 'CTA updated:',
  }[op] || 'Updated:';
  return reviewReply(d, session, said);
}

/**
 * Draw a poster, because the author asked for one.
 *
 * The default is the author's own attachment, so this is the opt-in path: it
 * builds the branded square from the facts already extracted and attaches it
 * in place of (or in the absence of) a photograph.
 */
/**
 * Show the gallery: the author's line, already set in every design.
 *
 * This is the heart of the poster flow and the reason it is a gallery rather
 * than a prompt. Nobody can describe the poster they want, but everybody can
 * recognise it — so the agent renders the sentence six ways and lets them
 * point. The options are the pictures themselves; the chat only needs to
 * carry the numbers.
 */
/**
 * Switch between the full post and the author's words alone, and rewrite.
 *
 * Both directions matter. Somebody who typed a careful paragraph does not
 * want it expanded, and somebody who typed six words does not want those six
 * words published — so the agent picks the useful default (elaborate) and
 * makes the other one a single phrase away.
 */
async function handleBrevity(d, session, mode) {
  if (!session.sourceText && !session.final) {
    return ask(session, 'There is no post in progress. Paste a draft first.');
  }
  session.brevity = mode === 'short' ? 'short' : 'full';
  const source = session.sourceText || session.final;
  const { composed } = await composeFinal(d, source, session);
  applyComposed(session, composed);
  return reviewReply(d, session, mode === 'short'
    ? 'Your words, tidied and otherwise untouched:'
    : 'The full version:');
}

/**
 * Put one intake question, with its answers as chips.
 *
 * The progress line matters more than it looks: nobody answers six questions
 * without being told how many are left, and a chat that asks an unbounded
 * series of questions is one people abandon half way through.
 */
function askIntake(d, session, q) {
  session.awaiting = 'intake';
  session.askingField = q.field;
  const p = d.intake.progress(session.facts, session.asked);
  const lines = [q.ask];
  if (q.why) lines.push(q.why);
  lines.push('');
  lines.push(`${p.answered} of ${p.total} answered — say "skip" for anything that does not apply.`);

  return {
    ok: true,
    kind: 'ask',
    reply: lines.join('\n'),
    session,
    intake: { field: q.field, answered: p.answered, total: p.total, facts: session.facts },
    options: {
      options: q.options.map((o) => ({ label: o, value: o })).concat([{ label: 'Skip', value: 'skip' }]),
    },
  };
}

/**
 * Record an answer and move on, or start writing once the list is done.
 *
 * "Skip" is a real answer: it marks the field asked so the agent never
 * circles back to it, and the fact simply never appears on the poster. That
 * is what keeps this a conversation rather than a validation loop.
 */
async function handleIntakeAnswer(d, session, message, user) {
  const field = session.askingField;
  const res = d.intake.answer(session.facts, session.asked, field, message);
  session.facts = res.facts;
  session.asked = res.asked;
  session.askingField = '';

  const q = d.intake.nextQuestion(session.facts, session.asked);
  if (q) return askIntake(d, session, q);

  session.intakeDone = true;
  session.awaiting = '';

  /*
   * Everything asked: write the post in the format the company uses for
   * hiring — a title, one labelled fact per line, eligibility, and a clear
   * instruction to comment. The facts came from the author; the shape is the
   * house style.
   */
  const composed = d.elaborate.hiringPost(session.facts, {
    sourceText: session.sourceText,
    eligibility: session.facts.eligibility,
  });
  applyComposed(session, composed);
  const still = d.intake.missing(session.facts);
  const opening = still.length
    ? `Written up. ${still.length} thing${still.length === 1 ? '' : 's'} left blank, so ${still.length === 1 ? 'it is' : 'they are'} not on the poster: ${still.join(', ')}.`
    : 'Written up, with everything you gave me.';
  return reviewReply(d, session, opening);
}

function handleShowPosters(d, session) {
  if (!session.final) return ask(session, 'Give me the line first, then I will show you some posters for it.');

  let gallery = [];
  try {
    gallery = d.designs.suggest({ line: session.final, kind: session.kind || 'general' }) || [];
  } catch (e) {
    console.error('[linkedin-agent] poster gallery failed:', e.message);
  }
  if (!gallery.length) return ask(session, 'I could not draw the posters just now. The post can still go out without one.');

  session.gallery = gallery.map((g) => g.id);
  session.awaiting = 'pick-poster';

  return {
    ok: true,
    kind: 'posters',
    reply: [
      `Here are ${gallery.length} posters with your line on them.`,
      '',
      'Click one and I will put it on the post, or say "no poster" to publish the text on its own.',
    ].join('\n'),
    session,
    /* The full SVGs travel so the chooser can show them at once. The browser
       rasterises whichever one is picked at publish time. */
    gallery: gallery.map((g, i) => ({
      index: i + 1, id: g.id, name: g.name, note: g.note,
      svg: g.svg, width: g.width, height: g.height, alt: g.alt, line: g.line,
    })),
    options: {
      options: gallery.map((g, i) => ({ label: `${i + 1}. ${g.name}`, value: `poster ${i + 1}`, note: g.note }))
        .concat([{ label: 'No poster', value: 'no poster' }]),
    },
  };
}

/**
 * Take the design they pointed at, and show the finished thing.
 *
 * Accepts a number ("poster 2") or a name ("use midnight"), because a person
 * looking at a labelled row of pictures will use whichever is closer to hand.
 * The answer is the post and the poster together, with the one question that
 * matters left to ask.
 */
function handlePickPoster(d, session, choice) {
  if (!session.final) return ask(session, 'There is no post in progress. Paste a draft first.');

  const ids = Array.isArray(session.gallery) && session.gallery.length
    ? session.gallery
    : (d.designs.DESIGN_IDS || []);
  const raw = String(choice || '').trim().toLowerCase();
  const byNumber = /^[1-6]$/.test(raw) ? ids[Number(raw) - 1] : null;
  const byName = ids.filter((id) => id === raw)[0] || null;
  const id = byNumber || byName;
  if (!id) return ask(session, 'I did not catch which poster. Say "poster 1" through "poster 6", or the name.');

  let built = null;
  try {
    built = d.designs.renderDesign({ design: id, line: session.final, kind: session.kind || 'general' });
  } catch (e) {
    console.error('[linkedin-agent] poster render failed:', e.message);
  }
  if (!built) return ask(session, 'That poster would not draw. Pick another, or post the text on its own.');

  /* A chosen design replaces both the drawn-from-facts poster and any
     attachment: the author has just said, explicitly, which picture they
     want. */
  session.design = id;
  session.wantsPoster = true;
  session.withImage = true;
  session.poster = null;
  session.awaiting = 'confirm-post';

  return {
    ok: true,
    kind: 'poster-chosen',
    reply: [
      `${built.name} it is. Your line is set in it.`,
      '',
      session.final,
      '',
      `${withCommas(session.final.length)} characters · ${countHashtags(session.final)} hashtag${countHashtags(session.final) === 1 ? '' : 's'} · ${built.name} poster attached`,
      '',
      'Shall I post it to LinkedIn?',
    ].join('\n'),
    session,
    post: postSummary(session),
    poster: {
      svg: built.svg, template: built.id, fields: {}, width: built.width, height: built.height,
      alt: built.alt, withImage: true, name: built.name,
    },
    options: {
      options: [
        { label: 'Yes, post it', value: 'post it' },
        { label: 'Schedule it', value: 'schedule' },
        { label: 'Show the posters again', value: 'posters' },
        { label: 'No poster', value: 'no poster' },
      ],
    },
  };
}

function handleMakePoster(d, session) {
  if (!session.final) return ask(session, 'There is no post in progress. Paste a draft first.');
  session.wantsPoster = true;
  session.withImage = true;
  const fields = safeExtract(d, session.sourceText || session.final, session.kind);
  session.poster = {
    template: session.kind,
    fields: posterFields(d, session.kind, fields, session.composed),
  };
  return reviewReply(d, session, 'Poster drawn and attached:');
}

function handleImage(d, session, withImage) {
  if (!session.final) return ask(session, 'There is no post in progress. Paste a draft first.');
  session.withImage = withImage;
  /* "No image" means no image at all — neither the attachment nor a poster
     the agent was asked to draw earlier. */
  if (!withImage) session.wantsPoster = false;
  const poster = posterFor(d, session);
  return {
    ok: true,
    kind: 'review',
    reply: [
      withImage ? 'Poster back on.' : 'Poster off — this will go out as text only.',
      countsLine(session.final, poster, withImage),
      '',
      'Post it now, schedule it, or change something else?',
    ].join('\n'),
    session,
    review: reviewPayload(session),
    post: postSummary(session),
    poster,
    options: reviewOptions(),
  };
}

/* ── publishing ─────────────────────────────────────────────────────────── */

function authorOf(user) {
  const u = user || {};
  return { role: str(u.role, 30), id: str(u.id || u._id, 80), name: str(u.name, 120) };
}

function historyEntry(user, action, note) {
  const u = authorOf(user);
  return { at: new Date(), by: u.name || u.id || u.role, action, note: str(note, 300) };
}

/**
 * Create the LinkedInPost for the session, or update the one it already has.
 * The record exists before LinkedIn is called, so a crash between the two
 * leaves a 'ready' post that the history shows and a person can retry — a
 * post that only got written after a successful publish would vanish on
 * exactly the failures worth knowing about.
 */
async function upsertPost(d, session, user, status, extra) {
  const poster = posterFor(d, session);
  const doc = Object.assign({
    kind: session.kind || 'general',
    draft: session.draft,
    final: session.final,
    issues: session.issues,
    verdict: session.verdict || 'ok',
    poster: {
      template: session.poster ? session.poster.template : (session.kind || 'general'),
      fields: session.poster ? session.poster.fields : {},
      svg: poster ? poster.svg : '',
      withImage: session.withImage !== false,
    },
    status,
    author: authorOf(user),
  }, extra || {});
  if (session.postId) {
    const updated = await d.LinkedInPost.findByIdAndUpdate(
      session.postId,
      { $set: doc, $push: { history: historyEntry(user, status, 'updated from chat') } },
      { new: true },
    );
    if (updated) return updated;
  }
  doc.history = [historyEntry(user, 'created', 'from chat')];
  return d.LinkedInPost.create(doc);
}

async function markPost(d, id, set, user, action, note) {
  if (!id) return;
  try {
    await d.LinkedInPost.findByIdAndUpdate(id, { $set: set, $push: { history: historyEntry(user, action, note) } }, { new: true });
  } catch (e) {
    console.error('[linkedin-agent] could not record post state:', e.message);
  }
}

function pngBuffer(pngBase64) {
  if (!pngBase64 || typeof pngBase64 !== 'string') return undefined;
  const clean = pngBase64.replace(/^data:image\/png;base64,/, '');
  try {
    const buf = Buffer.from(clean, 'base64');
    return buf.length > 0 ? buf : undefined;
  } catch (e) { return undefined; }
}

/**
 * The publish result, explained. A dry run is not a failure and not a
 * success; it is the exact payload that would have gone out, saved, with a
 * note about how to make it real.
 */
function publishReply(result, session) {
  const r = result || {};
  if (r.dryRun) return DRY_RUN_NOTICE;
  if (r.ok) return `Posted to ${BRAND_NAME}${r.url ? `: ${r.url}` : '.'}`;
  return `LinkedIn refused the post: ${r.error || 'unknown error'}. It is saved as failed — say "post it" to retry once that is sorted.`;
}

async function publishSession(d, session, user, pngBase64, explain) {
  /* The session is client state: re-check the text before anything is sent. */
  const again = d.guard.review(session.final, { kind: session.kind || 'general' });
  if (again.verdict === 'block') {
    session.final = '';
    session.composed = null;
    session.verdict = 'block';
    session.issues = (again.issues || []).map(cleanIssue);
    return {
      ok: true,
      kind: 'refused',
      reply: [
        `I won't post this as written: ${session.issues[0] ? session.issues[0].message : 'it fails the content check'}.`,
        ...session.issues.map(issueLine),
        '',
        "There's nothing here I can post appropriately.",
      ].join('\n'),
      session,
      review: reviewPayload(session),
    };
  }

  const poster = posterFor(d, session);
  /*
   * The image that goes out is the one the author attached.
   *
   * This used to require a generated poster to exist before it would send any
   * image at all, so a person who attached their own photograph and typed
   * "post it" published a text-only post and watched their picture disappear.
   * The attachment is the point: whatever the browser sent is what goes to
   * LinkedIn, and the generated poster is only a fallback for someone who
   * asked the agent to draw one.
   */
  const png = session.withImage !== false ? pngBuffer(pngBase64) : undefined;
  const altText = poster && poster.alt
    ? poster.alt
    : `${BRAND_NAME} — image attached to this post`;

  const record = await upsertPost(d, session, user, 'ready');
  const postId = idOf(record);
  session.postId = postId;
  await markPost(d, postId, { status: 'publishing' }, user, 'publishing', png ? 'with poster' : 'text only');

  let result;
  try {
    result = await d.linkedinClient.publish({ text: session.final, png, altText });
  } catch (e) {
    /* publish() promises not to throw, but a thrown error must still land as
       a failed post rather than a 500 that leaves the record in 'publishing'. */
    result = { ok: false, dryRun: false, error: e.message };
  }
  const r = result || { ok: false, error: 'no response from the LinkedIn client' };

  const now = d.now();
  if (r.ok || r.dryRun) {
    await markPost(d, postId, {
      status: 'published',
      publishedAt: now,
      dryRun: Boolean(r.dryRun),
      linkedin: { postUrn: r.postUrn || '', imageUrn: r.imageUrn || '', url: r.url || '' },
      error: '',
    }, user, r.dryRun ? 'dry-run' : 'published', r.url || '');
  } else {
    await markPost(d, postId, { status: 'failed', error: str(r.error, 500) }, user, 'failed', r.error || '');
  }

  const lines = [];
  if (explain) lines.push(explain);
  lines.push(publishReply(r, session));
  lines.push(countsLine(session.final, poster, session.withImage && Boolean(png)));

  const summary = postSummary(session);
  const review = reviewPayload(session);
  /* A finished post clears the way for the next one; the id stays so a failed
     attempt can be retried with "post it" instead of drafting again. */
  const next = (r.ok || r.dryRun) ? freshSession(session, true) : session;
  if (!(r.ok || r.dryRun)) next.postId = postId;
  else next.lastPostId = postId;

  return {
    ok: true,
    kind: 'posted',
    reply: lines.join('\n'),
    session: next,
    post: summary,
    review,
    poster,
    publish: {
      ok: Boolean(r.ok),
      dryRun: Boolean(r.dryRun),
      url: r.url || '',
      postUrn: r.postUrn || '',
      payload: r.payload,
      error: r.error || '',
      postId,
    },
    options: { options: [{ label: 'New post', value: 'new post' }, { label: 'History', value: 'history' }] },
  };
}

function noFinalReply(session) {
  if (session.verdict === 'block') {
    return {
      ok: true,
      kind: 'refused',
      reply: "There's nothing here I can post appropriately. The last draft was blocked — send me a different one.",
      session,
    };
  }
  return ask(session, 'Nothing to post yet. Paste a draft or an idea and I will review it first.');
}

async function handlePost(d, session, user, pngBase64, anyway) {
  if (!session.final) return noFinalReply(session);
  let explain = '';
  if (anyway) {
    if (session.verdict === 'revise' && session.fixed.length) {
      explain = `Posting the revised version — I fixed ${session.fixed.join(', ')} first; the original as written would not have passed.`;
    } else if (session.verdict === 'ok') {
      explain = 'Posting as composed.';
    } else if (session.fixed.length) {
      explain = `Posting the clean version — ${session.fixed.join(', ')} is out; the original as written cannot go up.`;
    }
  }
  return publishSession(d, session, user, pngBase64, explain);
}

/* ── scheduling ─────────────────────────────────────────────────────────── */

function parseWhenSafe(d, text) {
  try { return d.scheduler.parseWhen(text, d.now(), 'Asia/Kolkata'); } catch (e) { return null; }
}

function proposeSchedule(session, when) {
  session.awaiting = 'confirm-schedule';
  session.scheduleFor = new Date(when).toISOString();
  return {
    ok: true,
    kind: 'ask',
    reply: `Schedule it for ${istDateTime(when)}? Say yes to confirm.`,
    session,
    options: { options: [{ label: 'Yes, schedule it', value: 'yes' }, { label: 'Cancel', value: 'cancel' }] },
  };
}

function handleScheduleRequest(d, session, whenText) {
  if (!session.final) return noFinalReply(session);
  if (!whenText) {
    session.awaiting = 'schedule-when';
    return {
      ok: true,
      kind: 'ask',
      reply: 'When should it go out? Times are IST — "tomorrow 10am", "monday 9am", "in 2 hours", "25 Sep 18:00".',
      session,
      options: { options: [
        { label: 'Tomorrow 10am', value: 'tomorrow 10am' },
        { label: 'Tomorrow 6pm', value: 'tomorrow 6pm' },
        { label: 'Monday 9am', value: 'monday 9am' },
      ] },
    };
  }
  const when = parseWhenSafe(d, whenText);
  if (!when) {
    session.awaiting = 'schedule-when';
    return ask(session, `I couldn't read "${str(whenText, 60)}" as a future time. Try "tomorrow 10am" or "25 Sep 10:00" (IST).`);
  }
  return proposeSchedule(session, when);
}

async function confirmSchedule(d, session, user, pngBase64) {
  const when = session.scheduleFor ? new Date(session.scheduleFor) : null;
  if (!when || Number.isNaN(when.getTime()) || when.getTime() <= d.now().getTime()) {
    session.awaiting = 'schedule-when';
    session.scheduleFor = '';
    return ask(session, 'That time has passed. When should it go out instead?');
  }
  if (!session.final) return noFinalReply(session);
  const png = session.withImage !== false ? (pngBase64 ? String(pngBase64).replace(/^data:image\/png;base64,/, '') : '') : '';
  const extra = { scheduledFor: when };
  if (png) extra['poster.png'] = png;
  const record = await upsertPost(d, session, user, 'scheduled', extra);
  const postId = idOf(record);
  const poster = posterFor(d, session);
  const next = freshSession(session, true);
  next.lastPostId = postId;
  return {
    ok: true,
    kind: 'scheduled',
    reply: [
      `Scheduled for ${istDateTime(when)}. It will go out from the server on its own.`,
      countsLine(session.final, poster, session.withImage && Boolean(png)),
      png ? '' : (session.withImage !== false ? 'The poster image was not attached, so it will go out as text unless you post it from the dashboard instead.' : ''),
    ].filter(Boolean).join('\n'),
    session: next,
    post: postSummary(session),
    poster,
    scheduledFor: when.toISOString(),
    postId,
    options: { options: [{ label: 'New post', value: 'new post' }, { label: 'History', value: 'history' }] },
  };
}

/* ── history and stats ──────────────────────────────────────────────────── */

function postRow(p) {
  return {
    id: idOf(p),
    kind: p.kind || 'general',
    status: p.status || 'draft',
    final: str(p.final, 140),
    scheduledFor: p.scheduledFor ? new Date(p.scheduledFor).toISOString() : '',
    publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : '',
    url: (p.linkedin && p.linkedin.url) || '',
    dryRun: Boolean(p.dryRun),
  };
}

async function handleHistory(d, session) {
  const rows = await findMany(d.LinkedInPost, {}, { sort: { createdAt: -1 }, limit: 10 });
  const posts = rows.map(postRow);
  const lines = posts.length ? ['Recent posts:'] : ['Nothing posted yet from here.'];
  for (const p of posts) {
    const when = p.publishedAt ? istDate(p.publishedAt) : (p.scheduledFor ? `due ${istDateTime(p.scheduledFor)}` : '—');
    const first = p.final.split('\n')[0].slice(0, 80);
    lines.push(`• ${when} · ${p.status}${p.dryRun ? ' (dry run)' : ''} · ${p.kind} · ${first}${p.url ? ` · ${p.url}` : ''}`);
  }
  return { ok: true, kind: 'history', reply: lines.join('\n'), session, posts };
}

async function handleStats(d, session) {
  const since = new Date(d.now().getTime() - 30 * DAY_MS);
  const lines = [];
  let local = { published: 0, byKind: {} };
  try {
    const rows = await findMany(d.LinkedInPost, { status: 'published', publishedAt: { $gte: since } }, { limit: 500 });
    local.published = rows.length;
    for (const p of rows) local.byKind[p.kind || 'general'] = (local.byKind[p.kind || 'general'] || 0) + 1;
    const kinds = Object.keys(local.byKind).map((k) => `${k} ${local.byKind[k]}`).join(', ');
    lines.push(`Last 30 days: ${local.published} post${local.published === 1 ? '' : 's'} published from here${kinds ? ` (${kinds})` : ''}.`);
  } catch (e) {
    console.error('[linkedin-agent] local stats failed:', e.message);
  }

  let cfg = { configured: false };
  try { cfg = d.linkedinClient.config() || cfg; } catch (e) { cfg = { configured: false }; }
  let linkedin = null;
  if (!cfg.configured) {
    lines.push("LinkedIn is not connected on this server, so there are no page statistics to show. An HR or admin can connect it from the Connection card.");
  } else {
    try {
      linkedin = await d.linkedinClient.shareStatistics({ orgUrn: cfg.orgUrn });
    } catch (e) {
      console.error('[linkedin-agent] shareStatistics failed:', e.message);
      linkedin = null;
    }
    if (linkedin) {
      const s = pickShareTotals(linkedin);
      if (s) lines.push(`Page totals: ${withCommas(s.impressionCount)} impressions · ${withCommas(s.clickCount)} clicks · ${withCommas(s.likeCount)} likes · ${withCommas(s.commentCount)} comments · ${withCommas(s.shareCount)} reposts.`);
      else lines.push('LinkedIn returned statistics but not in the shape I know — the raw numbers are attached.');
    } else {
      lines.push('LinkedIn did not return statistics just now. Try again in a minute.');
    }
  }
  return { ok: true, kind: 'stats', reply: lines.join('\n'), session, stats: { local, linkedin } };
}

/** The totals block of organizationalEntityShareStatistics, wherever it sits. */
function pickShareTotals(raw) {
  const el = raw && Array.isArray(raw.elements) ? raw.elements[0] : raw;
  const t = el && (el.totalShareStatistics || el.shareStatistics || (el.totals));
  if (!t || typeof t !== 'object') return null;
  return {
    impressionCount: t.impressionCount || 0,
    clickCount: t.clickCount || 0,
    likeCount: t.likeCount || 0,
    commentCount: t.commentCount || 0,
    shareCount: t.shareCount || 0,
  };
}

/* ── misc replies ───────────────────────────────────────────────────────── */

function ask(session, text, options) {
  return { ok: true, kind: 'ask', reply: text, session, options: options || undefined };
}

const KIND_PROMPTS = {
  opening: 'Internship opening it is. Give me the role, domain, mode (remote/hybrid/onsite), stipend, duration and the apply-by date — one message is enough, I will shape it.',
  placement: 'Placement story. Who got placed, at which company and as what? A line in their words helps, and the domain they interned in.',
  leadgen: 'A post to bring freshers in. Tell me the offer — the domains open, what they get, and where to register — and I will write the hook.',
  general: 'General post. Give me the announcement or the idea and I will draft it.',
};

function handleKindHint(session, kind) {
  const next = freshSession(session, false);
  next.kindHint = kind;
  next.awaiting = 'draft';
  return ask(next, KIND_PROMPTS[kind]);
}

/* ── the turn ───────────────────────────────────────────────────────────── */

async function turn(input) {
  const inp = input || {};
  const d = resolveDeps(inp.deps);
  const user = inp.user || {};
  const session = normaliseSession(inp.session);
  const raw = str(inp.message, 6000);
  const message = raw.trim();
  const pngBase64 = inp.pngBase64;

  try {
    if (!message) return ask(session, 'Paste a draft or an idea for a post and I will take it from there. Say "help" for what I can do.');

    if (INTENTS.help.test(message)) return { ok: true, kind: 'help', reply: helpText, session };
    if (INTENTS.cancel.test(message)) {
      return { ok: true, kind: 'ask', reply: 'Cleared. Send me the next idea when you have one.', session: freshSession(session, false) };
    }

    if (INTENTS.decline.test(message)) {
      const wasAsking = session.awaiting;
      session.awaiting = '';
      session.scheduleFor = '';
      if (wasAsking === 'confirm-schedule' || wasAsking === 'schedule-when') {
        return ask(session, 'Okay, not scheduled. Post it now, change something, or say "cancel" to drop it.', reviewOptions());
      }
      return ask(session, session.final ? 'Okay. Post it, schedule it, or tell me what to change.' : 'Okay. Send me a draft when you are ready.', session.final ? reviewOptions() : undefined);
    }

    if (INTENTS.kindOpening.test(message)) return handleKindHint(session, 'opening');
    if (INTENTS.kindPlacement.test(message)) return handleKindHint(session, 'placement');
    if (INTENTS.kindLeadgen.test(message)) return handleKindHint(session, 'leadgen');
    if (INTENTS.kindGeneral.test(message)) return handleKindHint(session, 'general');

    if (INTENTS.history.test(message)) return handleHistory(d, session);
    if (INTENTS.stats.test(message)) return handleStats(d, session);

    /* A pending question takes the next message as its answer. */
    if (session.awaiting === 'confirm-schedule') {
      if (INTENTS.post.test(message)) return confirmSchedule(d, session, user, pngBase64);
      session.awaiting = '';
      session.scheduleFor = '';
      /* Not a yes: fall through and treat it as whatever it is. */
    }
    if (session.awaiting === 'schedule-when' && !INTENTS.schedule.test(message) && !INTENTS.post.test(message)) {
      const when = parseWhenSafe(d, message);
      if (when) return proposeSchedule(session, when);
      /* Not a time either — a new draft or a command; clear and fall through. */
      session.awaiting = '';
    }

    if (INTENTS.postAnyway.test(message)) return handlePost(d, session, user, pngBase64, true);
    if (INTENTS.post.test(message)) return handlePost(d, session, user, pngBase64, false);

    const sched = message.match(INTENTS.schedule);
    if (sched) return handleScheduleRequest(d, session, (sched[1] || '').trim());

    if (INTENTS.shorter.test(message)) return handleTransform(d, session, 'shorter');
    if (INTENTS.longer.test(message)) return handleTransform(d, session, 'longer');
    if (INTENTS.formal.test(message)) return handleTransform(d, session, 'formal');
    if (INTENTS.warm.test(message)) return handleTransform(d, session, 'warm');
    if (INTENTS.regenerate.test(message)) return handleTransform(d, session, 'regenerate');
    if (INTENTS.noImage.test(message)) return handleImage(d, session, false);
    /* Checked before withImage, because "add the poster" would otherwise be
       read as "keep the attachment". */
    if (INTENTS.makePoster.test(message)) return handleMakePoster(d, session);
    /* The gallery, and the answer to it. pickPoster is tested only while a
       gallery is on screen, because a bare "2" means nothing otherwise and
       would swallow a draft that happens to be one character long. */
    /* An intake answer is whatever they typed while a question was open,
       so it is checked before every other intent — 'Online' and '3 months'
       are answers here and nothing else anywhere. */
    if (session.awaiting === 'intake' && session.askingField) {
      return handleIntakeAnswer(d, session, message, user);
    }
    if (INTENTS.showPosters.test(message)) return handleShowPosters(d, session);
    if (session.awaiting === 'pick-poster' && INTENTS.pickPoster.test(message)) {
      return handlePickPoster(d, session, message.match(INTENTS.pickPoster)[1]);
    }
    if (INTENTS.keepShort.test(message)) return handleBrevity(d, session, 'short');
    if (INTENTS.elaborateMore.test(message)) return handleBrevity(d, session, 'full');
    if (INTENTS.withImage.test(message)) return handleImage(d, session, true);
    const headline = message.match(INTENTS.headline);
    if (headline) return handleTransform(d, session, 'headline', headline[1].trim());
    const hashtags = message.match(INTENTS.hashtags);
    if (hashtags) {
      const tags = hashtags[1].split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`)).slice(0, 5);
      return handleTransform(d, session, 'hashtags', tags);
    }
    const cta = message.match(INTENTS.cta);
    if (cta) return handleTransform(d, session, 'cta', cta[1].trim());

    return handleDraft(d, message, session, user);
  } catch (e) {
    console.error('[linkedin-agent] turn failed:', e && e.stack ? e.stack : e);
    return {
      ok: true,
      kind: 'error',
      reply: 'Something went wrong on my side. Nothing was posted. Try that again, or say "start over".',
      session,
    };
  }
}

module.exports = {
  turn,
  INTENTS,
  helpText,
  DRY_RUN_NOTICE,
  /* Exposed for tests and for the route's own history listing. */
  diceSimilarity,
  istDayRange,
  istDateTime,
  postRow,
  normaliseSession,
};
