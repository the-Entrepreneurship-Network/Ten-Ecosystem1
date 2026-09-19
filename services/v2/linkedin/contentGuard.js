'use strict';

/**
 * The content guard: the one thing standing between a staff member's typing
 * and the company page.
 *
 * Everything here is a pure function of the text. No network, no database, no
 * model call — because the guard has to give the same answer twice for the
 * same words. The agent reviews a draft when it arrives and reviews the final
 * text again at the moment of publishing (the session travels through the
 * browser and can be edited there), and a guard that consulted an LLM could
 * pass a text at 10:00 and block the identical text at 10:01. A staff member
 * who watched that happen would stop trusting the whole feature.
 *
 * The second rule is that every issue must be explainable. A verdict of
 * "revise" with no excerpt is an argument the agent cannot win: the person
 * looks at 900 characters, cannot see which eight words were the problem, and
 * either gives up or posts from their phone instead. So every issue carries
 * the exact substring that triggered it and a fix written as an instruction.
 *
 * The excerpt is always a literal substring of the input. services/v2/linkedin
 * /agent.js locates it with indexOf() to cut the offending sentence out and
 * re-review the remainder; an excerpt that had been trimmed, case-folded or
 * prettified would silently never be found, and the agent would refuse a draft
 * it could have salvaged.
 *
 * Every regex below is linear: character classes and bounded repetition only,
 * no nested quantifiers over overlapping alternatives. LinkedIn allows 3,000
 * characters and the guard runs twice per publish inside a request; a pattern
 * that backtracked catastrophically on a 5,000-character paste would hang the
 * worker, not just the request.
 */

/* ── brand ──────────────────────────────────────────────────────────────── */

const BRAND = {
  name: 'The Entrepreneurship Network',
  short: 'TEN',
  site: 'https://virtualinternships.entrepreneurshipnetwork.net',
  linkedin: 'https://www.linkedin.com/company/the-entrepreneurship-network/',
  hashtags: {
    core: ['#TheEntrepreneurshipNetwork', '#TEN', '#Internships'],
    opening: ['#Hiring', '#InternshipOpportunity', '#Freshers'],
    placement: ['#Placement', '#SuccessStory', '#Careers'],
    leadgen: ['#StudentLife', '#CareerGrowth', '#VirtualInternship'],
  },
  officialEmail: process.env.TEN_OFFICIAL_EMAIL || '',
};

/*
 * The hosts that belong to us. A post is supposed to point at these, so a URL
 * or an address on one of them is never "someone's personal contact details" —
 * that false positive is the one that would make the guard useless, because
 * nearly every internship post ends with the site.
 */
const BRAND_HOSTS = ['entrepreneurshipnetwork.net', 'linkedin.com'];

/* ── the codes ──────────────────────────────────────────────────────────── */

/*
 * Every code the guard can raise, with the severity it raises at. Severity is
 * fixed per code rather than computed, so "why was this blocked" has one
 * answer that can be read off a table instead of traced through the function.
 *
 * block  — this must not reach the company page in any form.
 * revise — publishable once the mechanical fix or a rewrite is applied.
 * note   — a craft observation. Notes never hold a post back.
 */
const CODES = Object.freeze({
  hate_slur: 'block',
  harassment_threat: 'block',
  sexual_explicit: 'block',
  personal_contact: 'block',
  discriminatory_hiring: 'block',
  defamation: 'block',
  confidential: 'block',
  political_religious: 'revise',
  guaranteed_outcome: 'revise',
  unverifiable_superlative: 'revise',
  shouting: 'revise',
  exclamation_overload: 'revise',
  hashtag_overload: 'revise',
  emoji_overload: 'revise',
  too_long: 'block',
  long_post: 'note',
  too_short: 'revise',
  placeholder_text: 'revise',
  insecure_link: 'revise',
  competitor_bashing: 'revise',
  urgency_bait: 'revise',
  brand_name: 'revise',
  link_in_body: 'revise',
  missing_cta: 'note',
  ai_slop: 'note',
  weak_hook: 'note',
});

/*
 * Deliberately short and deliberately unambiguous. These are terms with no
 * innocent reading in a recruitment post, so a word-boundary match is enough
 * and no context check is needed. The list is not a moderation system and is
 * not trying to be one: anything subtler than this belongs in a human's
 * review, and a longer list would start blocking ordinary words (the classic
 * failure where "Scunthorpe" cannot be typed).
 */
const SLURS = ['chinki', 'chamar', 'bhangi', 'kaffir', 'raghead', 'tranny', 'retard', 'retarded'];

const THREATS = [
  /\bi(?:'ll| will) (?:find|hunt|destroy|ruin|kill) (?:you|him|her|them)\b/i,
  /\byou(?:'ll| will) regret (?:this|it)\b/i,
  /\bwatch your back\b/i,
  /\bi know where (?:you|he|she|they) (?:live|work)s?\b/i,
  /\bteach (?:him|her|them|you) a lesson\b/i,
  /\bshut up or\b/i,
];

const SEXUAL = [
  /\bsend (?:me )?nudes?\b/i,
  /\bsexual favou?rs?\b/i,
  /\bsleep with (?:me|the boss)\b/i,
  /\b(?:good[- ]?looking|attractive|hot) (?:girls?|women|boys?) (?:only|preferred|apply)\b/i,
  /\bcasting couch\b/i,
];

const DISCRIMINATORY = [
  /\b(?:males?|females?|girls?|boys?|men|women|ladies|gents)\s+(?:candidates?\s+)?(?:only|preferred)\b/i,
  /\bonly\s+(?:males?|females?|girls?|boys?|men|women)\b/i,
  /\b(?:hindus?|muslims?|christians?|sikhs?|jains?|brahmins?)\s+(?:candidates?\s+)?(?:only|preferred)\b/i,
  /\bonly\s+(?:hindus?|muslims?|christians?|sikhs?|brahmins?)\b/i,
  /\b(?:unmarried|married|single)\s+(?:candidates?|applicants?|girls?|women|men)\b/i,
  /\bno\s+(?:married|pregnant)\s+(?:candidates?|women|applicants?)\b/i,
  /\b(?:age|candidates?)\s+(?:below|under|above|over|less than)\s+\d{2}\s*(?:years?|yrs?)?\b/i,
  /\bupper\s+caste\b/i,
];

/*
 * Calling someone dishonest, in the shapes people actually write it.
 *
 * Two things widen these beyond the obvious "X is a fraud". An intensifier
 * usually sits between the article and the noun — "a complete scam", "a total
 * fraud" — and a draft that names the company in one clause refers to it as
 * "they" in the next: "Do not apply to Acme Corp, they are a complete scam."
 * The accusation is identical and so is the liability, so the pronoun form is
 * matched too, but only when a capitalised name appeared earlier in the same
 * sentence — otherwise "they are a scam" with no subject at all would trip on
 * drafts that are quoting or warning in the abstract.
 */
const SLUR_NOUNS = '(?:fraud|scam|scammer|fraudster|fake|cheat|crook|liar)s?';
const INTENSIFIER = '(?:complete\\s+|total\\s+|absolute\\s+|utter\\s+|massive\\s+|huge\\s+|real\\s+|proper\\s+)?';

const DEFAMATION = [
  new RegExp(`\\b[A-Z][A-Za-z&.'-]*(?:\\s+[A-Z][A-Za-z&.'-]*){0,2}\\s+(?:is|are|was|were)\\s+(?:a\\s+|an\\s+|the\\s+)?${INTENSIFIER}${SLUR_NOUNS}\\b`),
  new RegExp(`\\b[A-Z][A-Za-z&.'-]*(?:\\s+[A-Z][A-Za-z&.'-]*){0,2}[^.!?\\n]{0,80}?\\b(?:they|it|he|she)\\s+(?:is|are|was|were)\\s+(?:a\\s+|an\\s+|the\\s+)?${INTENSIFIER}${SLUR_NOUNS}\\b`),
  /\b[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,2}[^.!?\n]{0,80}?\b(?:cheats?|cheated|scams?|scammed|loots?|looted)\s+(?:students?|interns?|freshers?|people|candidates?)\b/,
];

const POLITICAL = [
  /\bvote for\b/i,
  /\b(?:bjp|inc|aap|tmc|dmk|shiv sena|congress party)\b/i,
  /\b(?:narendra )?modi\b/i,
  /\brahul gandhi\b/i,
  /\bhindutva\b/i,
  /\bjai shri ram\b/i,
  /\b(?:pray|prayers?) (?:to|for) (?:god|allah|jesus|ram)\b/i,
];

const GUARANTEES = [
  /\b100\s*%\s*(?:placement|job|guarantee[d]?|success)\b/i,
  /\bguaranteed\s+(?:job|placement|internship|salary|offer|selection)\b/i,
  /\bassured\s+(?:job|placement|selection|offer)\b/i,
  /\bjob\s+guarantee\b/i,
  /\bplacement\s+guarantee\b/i,
  /\bsure\s*shot\s+(?:job|placement)\b/i,
];

const SUPERLATIVES = [
  /\bbest\s+(?:in|of)\s+(?:india|the world|the country|asia)\b/i,
  /\b(?:india|world)(?:'s|’s)?\s+(?:no\.?\s*1|number\s+one|best|largest|leading|top)\b/i,
  /\b#\s?1\b/,
  /\bno\.?\s*1\s+(?:internship|platform|company|programme|program)\b/i,
  /\bmost\s+trusted\b/i,
  /\bunmatched\b/i,
];

const COMPETITORS = /\b(?:internshala|unstop|letsintern|scaler|newton school|udemy|coursera|upgrad|physicswallah)\b/i;
const COMPETITOR_ATTACK = /\b(?:scam|fake|useless|waste|rip[- ]?off|cheating|worthless|overpriced|garbage)\b/i;
const COMPETITOR_COMPARE = /\b(?:unlike|better than|beats|smarter than|instead of)\s+(?:internshala|unstop|letsintern|scaler|newton school|udemy|coursera|upgrad|physicswallah)\b/i;

const URGENCY = [
  /\bhurry\b/i,
  /\blast chance\b/i,
  /\bonly\s+\d{1,3}\s+(?:seats?|slots?|spots?)\s+(?:left|remaining)\b/i,
  /\blimited\s+(?:seats?|slots?|spots?)\b/i,
  /\bact now\b/i,
  /\bdon'?t miss out\b/i,
  /\bfast filling\b/i,
  /\bclosing soon\b/i,
  /\bfew seats? left\b/i,
];

const CONFIDENTIAL = [
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:'s|’s)\s+(?:salary|ctc|package|pay)\b/,
  /\b(?:salary|ctc|package)\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/,
  /\binternal\s+(?:data|report|numbers|document|dashboard|figures)\b/i,
  /\b(?:do not|don'?t)\s+share\s+(?:this\s+)?(?:outside|externally|publicly)\b/i,
  /\bconfidential\b/i,
  /\bnot for public\b/i,
];

const PLACEHOLDERS = [
  /\blorem ipsum\b/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /\bFIXME\b/,
  /\bXXXX+\b/i,
  /\[(?:name|company|role|date|link|insert[^\]\n]{0,30})\]/i,
  /\{\{[^}\n]{0,40}\}\}/,
];

/*
 * The phrases that make a post read as machine-written. Each entry carries the
 * plain alternative, because "this sounds like AI" is not actionable and
 * "write 'using' instead of 'leveraging'" is. These are notes, never blocks —
 * house style is the writer's call, and a guard that refused to post over a
 * word choice would be overruled by someone pasting straight into LinkedIn.
 */
const AI_SLOP = [
  { re: /\bdelve\b/i, plain: 'look at' },
  { re: /\bgame[- ]changer\b/i, plain: 'a real difference' },
  { re: /\bleverage\b/i, plain: 'use' },
  { re: /\bunlock\b/i, plain: 'open up' },
  { re: /\bin today'?s fast[- ]paced world\b/i, plain: 'cut the line entirely' },
  { re: /\bthrilled to announce\b/i, plain: 'announcing' },
  { re: /\bi am thrilled\b/i, plain: 'say what happened, plainly' },
  { re: /\bexcited to share\b/i, plain: 'sharing' },
  { re: /\bit'?s not [a-z]{1,20}, it'?s [a-z]{1,20}\b/i, plain: 'say the thing once' },
  { re: /\blet that sink in\b/i, plain: 'cut the line entirely' },
  { re: /\bunleash\b/i, plain: 'start' },
  { re: /\belevate\b/i, plain: 'improve' },
  { re: /\bseamless(?:ly)?\b/i, plain: 'smooth' },
  { re: /\bcutting[- ]edge\b/i, plain: 'current' },
  { re: /\bsynergy\b/i, plain: 'working together' },
  { re: /\bnavigate the landscape\b/i, plain: 'find your way' },
  { re: /\btapestry\b/i, plain: 'mix' },
  { re: /\btestament to\b/i, plain: 'proof of' },
  { re: /\bat the end of the day\b/i, plain: 'cut the line entirely' },
];

const AS_A_OPENER = /^as an? [a-z][a-z ]{2,40},/i;
const EMOJI_OPENER = /^\s*[\u{1F680}\u{1F525}]/u;

const GENERIC_OPENERS = /^(?:hello everyone|hi everyone|greetings|dear all|we are happy to inform|it is my pleasure to inform)\b/i;

const CTA_VERBS = /\b(?:apply|register|sign up|enrol|enroll|join|visit|comment|dm|message|share|tag|follow|book|download|read more|learn more)\b/i;

/* Reserved for the mechanical caps fix: acronyms that are meant to shout. */
const CAPS_ALLOWED = ['MERN', 'HTML', 'JSON', 'NASA', 'IEEE', 'GATE', 'CUET', 'NEET', 'REST', 'SAAS'];

/* ── small helpers ──────────────────────────────────────────────────────── */

const MAX_EXCERPT = 160;

function cut(s) {
  const v = String(s == null ? '' : s);
  return v.length > MAX_EXCERPT ? v.slice(0, MAX_EXCERPT) : v;
}

/**
 * The first match of a pattern, as it appears in the text.
 *
 * Patterns are used without the /g flag here on purpose: a shared global regex
 * carries lastIndex between calls, so the second review() of the same text
 * would start scanning from the middle and miss the issue it found the first
 * time. That is precisely the "passed at 10:00, blocked at 10:01" bug the
 * whole module exists to avoid.
 */
function firstMatch(re, text) {
  const m = text.match(re);
  return m ? m[0] : '';
}

function allMatches(pattern, text) {
  const re = new RegExp(pattern.source, pattern.flags.indexOf('g') >= 0 ? pattern.flags : `${pattern.flags}g`);
  const out = [];
  let m = re.exec(text);
  let guard = 0;
  while (m && guard < 500) {
    out.push({ value: m[0], index: m.index });
    if (m.index === re.lastIndex) re.lastIndex += 1;
    m = re.exec(text);
    guard += 1;
  }
  return out;
}

const URL_RE = /https?:\/\/[^\s<>()[\]"']+/gi;
const BARE_DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.){1,3}(?:com|net|org|in|io|co|dev|ai|me)\b(?:\/[^\s<>()"']*)?/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,64}\.[A-Za-z]{2,10}/g;
/* Indian mobiles: 10 digits starting 6-9, optionally +91 and one separator. */
const INDIAN_PHONE_RE = /(?<![\d+])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
/* Generic international: a + and 8 or more digits in up to four groups. */
const INTL_PHONE_RE = /(?<![\d])\+\d{1,3}[\s-]?\d{2,4}(?:[\s-]?\d{2,4}){1,3}(?!\d)/g;

function isBrandHost(value) {
  const v = String(value).toLowerCase();
  return BRAND_HOSTS.some((host) => v.indexOf(host) >= 0);
}

/*
 * Product names that happen to be spelled like domains.
 *
 * A post that says "a Socket.io chat app" is naming a library, not linking to
 * socket.io, and flagging it teaches whoever reads the report to ignore the
 * link warning — which is the warning that actually matters, because a raw URL
 * in the body of a LinkedIn post is what suppresses its reach.
 *
 * An allowlist rather than a cleverer pattern: "visit example.com" and "a
 * Socket.io app" are the same shape, and the only thing that separates them is
 * knowing that Socket.io is a library. That is a fact, so it is written down.
 * A name here still counts as a link if it appears with a scheme or a path —
 * `https://socket.io/docs` is a link whatever else socket.io is.
 */
const PRODUCT_NAMES = [
  'socket.io', 'node.js', 'next.js', 'vue.js', 'nuxt.js', 'nest.js', 'express.js',
  'three.js', 'd3.js', 'chart.js', 'ember.js', 'backbone.js', 'react.dev',
];

function findLinks(text) {
  const seen = [];
  const push = (v) => { if (seen.indexOf(v) < 0) seen.push(v); };
  for (const m of allMatches(URL_RE, text)) push(m.value);
  for (const m of allMatches(BARE_DOMAIN_RE, text)) {
    /* A bare domain that is already inside a full URL is the same link. */
    if (seen.some((u) => u.toLowerCase().indexOf(m.value.toLowerCase()) >= 0)) continue;
    /* Bare — no scheme, no path — and a known product name: not a link. */
    if (PRODUCT_NAMES.indexOf(m.value.toLowerCase()) >= 0) continue;
    push(m.value);
  }
  /* An e-mail's domain is not a link; drop anything that sits after an @. */
  const emails = allMatches(EMAIL_RE, text).map((m) => m.value.toLowerCase());
  return seen.filter((u) => !emails.some((e) => e.indexOf(u.toLowerCase()) >= 0));
}

function countEmojis(text) {
  const m = text.match(/\p{Extended_Pictographic}/gu);
  return m ? m.length : 0;
}

function countHashtags(text) {
  const m = text.match(/(?:^|\s)#[A-Za-z0-9_]+/g);
  return m ? m.length : 0;
}

function hashtagList(text) {
  return allMatches(/(?:^|\s)(#[A-Za-z0-9_]+)/g, text).map((m) => m.value.trim());
}

function capsStats(text) {
  const letters = text.match(/[A-Za-z]/g);
  const caps = text.match(/[A-Z]/g);
  const total = letters ? letters.length : 0;
  return { letters: total, ratio: total ? (caps ? caps.length : 0) / total : 0 };
}

function isHashtagOnlyLine(line) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((w) => /^#[A-Za-z0-9_]+$/.test(w));
}

/**
 * Which line the call to action lives on: the last line that is neither blank
 * nor a row of hashtags. A link there is where a link belongs, which is what
 * keeps "Apply by 25 Sept at virtualinternships.entrepreneurshipnetwork.net"
 * from being reported as a stray link in the body — the single most common
 * shape of an ordinary HR post, and the false positive that would teach staff
 * to ignore the guard.
 */
function ctaLineIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i].trim();
    if (!l) continue;
    if (isHashtagOnlyLine(l)) continue;
    return i;
  }
  return -1;
}

/* ── mechanical fixes ───────────────────────────────────────────────────── */

function titleCase(word) {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * SHOUTING becomes Shouting. Only runs of four letters or more are touched, so
 * TEN, HR, AI, IST and the rest of the two- and three-letter acronyms staff
 * actually mean to capitalise survive untouched, and the handful of longer
 * ones that are genuinely acronyms are listed explicitly.
 */
function normaliseCaps(text) {
  return text.replace(/\b[A-Z]{4,}\b/g, (word) => (CAPS_ALLOWED.indexOf(word) >= 0 ? word : titleCase(word)));
}

function trimHashtags(text, max) {
  let seen = 0;
  return text.replace(/(^|\s)(#[A-Za-z0-9_]+)/g, (whole, lead, tag) => {
    seen += 1;
    return seen <= max ? whole : lead;
  });
}

/**
 * Replace an individual's phone number or e-mail with the channel the company
 * actually wants replies on.
 *
 * This runs even though a personal contact is a blocking issue and a blocked
 * review returns no cleaned text at all. It is the second line of defence for
 * the path in agent.js that removes the offending sentence and asks the guard
 * again: if a second number survived in another sentence that was not itself
 * flagged (a number split oddly across a line break, say), the re-review must
 * not hand the composer a draft that still carries it.
 */
function redactContacts(text, officialChannel) {
  let out = text;
  out = out.replace(EMAIL_RE, (m) => (isBrandHost(m) || m.toLowerCase() === officialChannel.toLowerCase() ? m : officialChannel));
  out = out.replace(INDIAN_PHONE_RE, officialChannel);
  out = out.replace(INTL_PHONE_RE, officialChannel);
  return out;
}

function mechanicalFixes(text, officialChannel) {
  let out = String(text);
  out = redactContacts(out, officialChannel);
  out = normaliseCaps(out);
  out = out.replace(/!{2,}/g, '!');
  out = out.replace(/\?{2,}/g, '?');
  out = trimHashtags(out, 5);
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/* ── the review ─────────────────────────────────────────────────────────── */

function issue(code, excerpt, message, fix) {
  return { code, severity: CODES[code] || 'note', excerpt: cut(excerpt), message, fix };
}

/**
 * Review one draft.
 *
 * @param {string} text
 * @param {{kind?: string, brand?: object}} [options]
 * @returns {{verdict: string, issues: Array, stats: object, cleaned: string}}
 */
function review(text, options) {
  const opts = options || {};
  const brand = opts.brand || BRAND;
  const kind = typeof opts.kind === 'string' && opts.kind ? opts.kind : 'general';
  const raw = text == null ? '' : String(text);
  const body = raw.trim();
  /* The official channel is read at call time rather than captured at require
     time: the server loads this module long before a test (or a restart with a
     new .env) sets TEN_OFFICIAL_EMAIL, and a stale empty string would send
     people to the site when there is a real inbox to send them to. */
  const officialChannel = brand.officialEmail || process.env.TEN_OFFICIAL_EMAIL || brand.site || BRAND.site;

  const lines = body.split('\n');
  const links = findLinks(body);
  const caps = capsStats(body);
  const exclamations = (body.match(/!/g) || []).length;
  const stats = {
    chars: body.length,
    words: body ? body.split(/\s+/).filter(Boolean).length : 0,
    lines: body ? lines.length : 0,
    hashtags: countHashtags(body),
    emojis: countEmojis(body),
    capsRatio: Math.round(caps.ratio * 100) / 100,
    exclamations,
    links,
  };

  const issues = [];
  const add = (code, excerpt, message, fix) => { issues.push(issue(code, excerpt, message, fix)); };

  /* ---- things that must never be published ---- */

  for (const slur of SLURS) {
    const m = firstMatch(new RegExp(`\\b${slur}\\b`, 'i'), body);
    if (m) {
      add('hate_slur', m, `"${m}" is a slur. Nothing that contains it can go on the company page.`,
        'Remove the word and the sentence around it, then send the draft again.');
      break;
    }
  }

  for (const re of THREATS) {
    const m = firstMatch(re, body);
    if (m) {
      add('harassment_threat', m, `"${m}" reads as a threat aimed at a person.`,
        'Take the threat out. If this is a real dispute it belongs in a private message, not on the page.');
      break;
    }
  }

  for (const re of SEXUAL) {
    const m = firstMatch(re, body);
    if (m) {
      add('sexual_explicit', m, `"${m}" is sexual content, and on a recruitment page it is also harassment.`,
        'Remove it entirely. Describe the role, not the person you want in it.');
      break;
    }
  }

  /* ---- an individual's contact details ---- */

  const contacts = [];
  for (const m of allMatches(EMAIL_RE, body)) {
    const isOfficial = isBrandHost(m.value) || m.value.toLowerCase() === String(officialChannel).toLowerCase();
    if (!isOfficial) contacts.push({ value: m.value, what: 'e-mail address' });
  }
  const phoneHits = allMatches(INDIAN_PHONE_RE, body).concat(allMatches(INTL_PHONE_RE, body));
  for (const m of phoneHits) {
    /* The two phone patterns overlap on "+91 98765 43210"; report it once. */
    if (contacts.some((c) => c.value.indexOf(m.value) >= 0 || m.value.indexOf(c.value) >= 0)) continue;
    contacts.push({ value: m.value, what: 'phone number' });
  }
  for (const c of contacts.slice(0, 4)) {
    add('personal_contact', c.value,
      `"${c.value}" is an individual's ${c.what}. A company post puts it in front of every follower, and whoever owns it gets the calls forever.`,
      `Point people at ${officialChannel} instead.`);
  }

  /* ---- hiring restrictions ---- */

  for (const re of DISCRIMINATORY) {
    const m = firstMatch(re, body);
    if (m) {
      add('discriminatory_hiring', m,
        `"${m}" restricts who may apply by gender, age, caste, religion or marital status.`,
        'State the skills and the work instead. If there is a genuine occupational requirement, it needs HR sign-off, not a line in a post.');
      break;
    }
  }

  /* ---- defamation ---- */

  for (const re of DEFAMATION) {
    const m = firstMatch(re, body);
    if (m) {
      add('defamation', m,
        `"${m}" names someone and calls them dishonest. Published from the company account that is our statement, and our liability.`,
        'Remove the accusation. Report it to the people who can act on it instead of posting it.');
      break;
    }
  }

  /* ---- confidential material ---- */

  for (const re of CONFIDENTIAL) {
    const m = firstMatch(re, body);
    if (m) {
      add('confidential', m,
        `"${m}" looks like internal information — a named person's pay or a number that was never meant to leave the office.`,
        'Take it out. Ranges and totals are fine; a named individual\'s figures are not.');
      break;
    }
  }

  /* ---- length ---- */

  /*
   * Two different things used to share one code, and one of them was wrong.
   *
   * Past 3,000 characters LinkedIn truncates the post, so the end of it does
   * not exist — that is a fact about the platform and it stays a block.
   *
   * Between about 1,300 and 3,000 is a matter of taste: long posts lose some
   * readers before the call to action. It was a block too, which meant the
   * house opinion about brevity could stop a post the team had deliberately
   * written long. A hiring post that lists the projects an intern will build
   * is long on purpose. So it is a note now, reported and ignorable, under a
   * code of its own.
   */
  if (body.length > 3000) {
    add('too_long', body.slice(0, 80),
      `This is ${body.length} characters. LinkedIn cuts a post off at 3,000, so the end would simply not exist.`,
      'Cut it under 3,000 — one idea per paragraph, and move the detail to the comments.');
  } else if (body.length > 1300) {
    add('long_post', body.slice(0, 80),
      `This is ${body.length} characters. Posts over about 1,300 lose some readers before the call to action.`,
      'Fine if the length is doing work. If it is not, cut to around 1,300 and keep the hook, the facts and the ask.');
  }
  if (body.length > 0 && body.length < 25) {
    add('too_short', body,
      'There is not enough here to make a post — under 25 characters is a fragment, not an update.',
      'Add the facts: what it is, who it is for, and what you want the reader to do.');
  }

  /* ---- claims ---- */

  for (const re of GUARANTEES) {
    const m = firstMatch(re, body);
    if (m) {
      add('guaranteed_outcome', m,
        `"${m}" promises an outcome nobody can promise, and it is the exact wording education regulators act on.`,
        'Say what we actually provide: mentorship, live project work, a certificate and placement support.');
      break;
    }
  }

  for (const re of SUPERLATIVES) {
    const m = firstMatch(re, body);
    if (m) {
      add('unverifiable_superlative', m,
        `"${m}" is a ranking claim with nothing behind it.`,
        'Replace it with a fact you can show — a number of interns, a domain, a named partner.');
      break;
    }
  }

  const competitorNamed = firstMatch(COMPETITORS, body);
  const compare = firstMatch(COMPETITOR_COMPARE, body);
  if (compare) {
    add('competitor_bashing', compare,
      `"${compare}" sets us against a named competitor. It reads as insecurity and it invites a reply.`,
      'Delete the comparison and describe what we do.');
  } else if (competitorNamed && firstMatch(COMPETITOR_ATTACK, body)) {
    add('competitor_bashing', competitorNamed,
      `"${competitorNamed}" is named next to an accusation. Do not run down another company from ours.`,
      'Take the competitor\'s name out entirely.');
  }

  for (const re of URGENCY) {
    const m = firstMatch(re, body);
    if (m) {
      add('urgency_bait', m,
        `"${m}" is manufactured urgency. Students see it on every scam ad in their feed.`,
        'Give the real deadline instead — "applications close on 25 September" says the same thing and is true.');
      break;
    }
  }

  for (const re of POLITICAL) {
    const m = firstMatch(re, body);
    if (m) {
      add('political_religious', m,
        `"${m}" brings party politics or religion into a company post.`,
        'Remove it. The page speaks about internships and careers and nothing else.');
      break;
    }
  }

  /* ---- mechanics ---- */

  if (caps.letters >= 20 && caps.ratio > 0.6) {
    const shout = firstMatch(/[A-Z][A-Z\s,'!.-]{14,}/, body) || body.slice(0, 60);
    add('shouting', shout,
      `${Math.round(caps.ratio * 100)}% of the letters are capitals. On a feed that reads as anger, not emphasis.`,
      'Write it in sentence case. I have already normalised it below.');
  }

  if (exclamations >= 3 || /!{2,}/.test(body)) {
    const bang = firstMatch(/[^\n]{0,40}!{1,}/, body);
    add('exclamation_overload', bang,
      `There are ${exclamations} exclamation marks. One is emphasis; three is shouting.`,
      'Keep at most one, and only where it earns its place.');
  }

  if (stats.hashtags > 5) {
    const tags = hashtagList(body);
    add('hashtag_overload', tags[5] || '#',
      `${stats.hashtags} hashtags. LinkedIn stops helping after about five and the post starts looking like spam.`,
      'Keep the first five — the brand tags and the two that describe the post.');
  }

  /*
   * Emoji used as field markers are structure, not decoration.
   *
   * A recruitment post in the format this company asked for leads each fact
   * with the same symbol every time — a building for the company, a clock for
   * the duration, a bag of money for the stipend — and a reader who has seen
   * one of these posts can find the stipend in the next one without reading
   * it. Counting those the same way as a sentence sprinkled with sparkles
   * flagged the house format as noise, every single time it was used.
   *
   * So a line that opens with one emoji and continues with a label is exempt,
   * and only the emoji left over anywhere else are counted.
   */
  const markerLines = lines.filter((l) => /^\s*\p{Extended_Pictographic}️?\s*\S/u.test(l)).length;
  const decorative = Math.max(0, stats.emojis - markerLines);
  if (decorative > 6) {
    const e = firstMatch(/\p{Extended_Pictographic}/u, body);
    add('emoji_overload', e,
      `${decorative} emojis outside the field markers. Past a handful they stop being decoration and start being noise, and screen readers announce every one.`,
      'Keep two or three at most, and none in the first line.');
  }

  /* ---- links ---- */

  const insecure = links.filter((l) => /^http:\/\//i.test(l));
  if (insecure.length) {
    add('insecure_link', insecure[0],
      `"${insecure[0]}" is plain http. Browsers warn on it and LinkedIn will not preview it.`,
      `Use the https address — ${brand.site || BRAND.site}.`);
  }

  if (links.length) {
    const ctaIdx = ctaLineIndex(lines);
    const strays = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (i === ctaIdx) continue;
      const found = findLinks(lines[i]);
      for (const f of found) strays.push(f);
    }
    if (strays.length) {
      add('link_in_body', strays[0],
        `"${strays[0]}" sits in the middle of the post. LinkedIn pushes posts with a link in the body to fewer people, and the reader loses the thread.`,
        'Move it to the last line, with the call to action, and keep one link only.');
    } else if (links.length > 1) {
      add('link_in_body', links[1],
        `There are ${links.length} links. Every extra one splits the click and costs reach.`,
        'Keep one link on the call-to-action line and drop the rest.');
    }
  }

  /* ---- placeholders ---- */

  for (const re of PLACEHOLDERS) {
    const m = firstMatch(re, body);
    if (m) {
      add('placeholder_text', m,
        `"${m}" is placeholder text that was never filled in.`,
        'Replace it with the real name, date or link before this goes out.');
      break;
    }
  }

  /* ---- the brand's own name ---- */

  const brandName = String(brand.name || BRAND.name);
  for (const m of allMatches(/\b(?:the\s+)?ent[a-z]*pren[a-z]*\s+network[a-z]*\b/gi, body)) {
    const normalised = m.value.toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');
    if (normalised !== 'entrepreneurship network') {
      add('brand_name', m.value,
        `"${m.value}" is not how the company is written.`,
        `Write "${brandName}" in full the first time, and "${brand.short || BRAND.short}" after that.`);
      break;
    }
  }

  /* ---- notes ---- */

  const firstLine = (lines[0] || '').trim();
  if (firstLine.length > 210) {
    add('weak_hook', firstLine,
      `The first line is ${firstLine.length} characters. LinkedIn folds the post at about 210, so the rest of the hook is hidden behind "…more".`,
      'Put one short, concrete sentence on the first line and move the detail below it.');
  } else if (GENERIC_OPENERS.test(firstLine)) {
    add('weak_hook', firstLine,
      `"${firstLine}" is a greeting, not a hook. Nobody stops scrolling for it.`,
      'Open with the thing that happened: the role, the number, the name.');
  }

  if (!CTA_VERBS.test(body) && !links.length) {
    add('missing_cta', lines[lines.length - 1] || body.slice(-60),
      'There is nothing to do at the end. A post with no ask gets read and forgotten.',
      'Finish with one instruction — "Apply at …", "Comment to register", "Share this with a fresher".');
  }

  const slop = [];
  for (const entry of AI_SLOP) {
    const m = firstMatch(entry.re, body);
    if (m) slop.push({ value: m, plain: entry.plain });
    if (slop.length >= 3) break;
  }
  const emDashes = (body.match(/—/g) || []).length;
  if (slop.length) {
    add('ai_slop', slop[0].value,
      `"${slop[0].value}" is the kind of phrase that makes a post read as machine-written${slop.length > 1 ? ` (also: ${slop.slice(1).map((s) => `"${s.value}"`).join(', ')})` : ''}.`,
      `Say "${slop[0].plain}" instead.`);
  } else if (AS_A_OPENER.test(firstLine)) {
    add('ai_slop', firstLine.slice(0, firstLine.indexOf(',') + 1),
      'Opening with "As a …," is the most recognisable LinkedIn-bot sentence there is.',
      'Start with what happened, not with who you are.');
  } else if (EMOJI_OPENER.test(body)) {
    add('ai_slop', body.slice(0, 2),
      'A rocket or fire emoji as the first character is the house style of every automated post on the feed.',
      'Start with a word.');
  } else if (emDashes > 2) {
    add('ai_slop', firstMatch(/[^\n]{0,30}—[^\n]{0,30}/, body),
      `There are ${emDashes} em-dashes. More than a couple is a tell.`,
      'Use full stops. Two sentences beat one dash-joined sentence.');
  }

  /* ---- verdict ---- */

  let verdict = 'ok';
  if (issues.some((i) => i.severity === 'block')) verdict = 'block';
  else if (issues.some((i) => i.severity === 'revise')) verdict = 'revise';

  const cleaned = verdict === 'block' ? '' : mechanicalFixes(body, officialChannel);

  return { verdict, issues, stats, cleaned };
}

module.exports = { review, BRAND, CODES };
