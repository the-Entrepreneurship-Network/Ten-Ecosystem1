'use strict';

/**
 * The questions the agent asks before it will build a hiring post.
 *
 * A poster is a spec sheet. "We are hiring Python interns" is not a spec
 * sheet: a student reading it cannot tell which batch it is for, how long it
 * runs, whether it pays, whether they can do it from home, or whether they
 * are eligible. Every one of those is the reason somebody does or does not
 * apply, and every one of them is a fact only the author has.
 *
 * So the agent asks. Not as a form — a form in a chat window is a form
 * nobody finishes — but as one short question at a time, each with the two or
 * three answers people actually give, so the usual case is three taps rather
 * than three sentences. Anything can be skipped, and a skipped fact simply
 * does not appear on the poster.
 *
 * The order is not arbitrary. It runs from the facts that decide whether a
 * student is interested at all (which batch, how long, paid or not) to the
 * ones that decide whether they are eligible, because somebody who abandons
 * the questions half way through should still have the facts that matter
 * most already collected.
 */

const { extractFields, detectKind } = require('./postComposer');

/*
 * Each question carries its own options. They are the answers staff actually
 * give — TEN runs two-, three- and six-month internships, pays some domains
 * and not others, and takes freshers with no prior skill — and offering them
 * as chips is what turns an interrogation into three taps.
 *
 * `field` is where the answer lands. `required` marks the ones the agent will
 * chase; the rest are offered once and dropped if ignored.
 */
const QUESTIONS = [
  {
    field: 'domain',
    required: true,
    ask: 'Which domain is this for?',
    why: 'It is the first thing a student filters on.',
    options: [], /* filled at runtime from the app's own domain list */
    dynamic: 'domains',
  },
  {
    field: 'batch',
    required: true,
    ask: 'Which batch or start date?',
    why: 'Without it nobody knows whether this is for them.',
    options: ['October batch', 'November batch', 'Immediate start', 'Rolling intake'],
  },
  {
    field: 'openings',
    required: true,
    ask: 'How many openings?',
    why: 'A number makes it real, and it makes people hurry.',
    options: ['5', '10', '20', '50+'],
  },
  {
    field: 'duration',
    required: true,
    ask: 'How long does it run?',
    options: ['2 months', '3 months', '4 months', '6 months'],
  },
  {
    field: 'mode',
    required: true,
    ask: 'Online, offline, or hybrid?',
    options: ['Online', 'Offline', 'Hybrid'],
  },
  {
    field: 'stipend',
    required: true,
    ask: 'Is there a stipend?',
    why: 'Say it either way — "unpaid" stated plainly costs less goodwill than a stipend nobody mentions.',
    options: ['Unpaid', '₹5,000/month', '₹10,000/month', 'Performance based'],
  },
  {
    field: 'skills',
    required: true,
    ask: 'What skills do you want, or is this open to complete freshers?',
    options: ['Open to freshers, no prior skill needed', 'Basic knowledge of the domain', 'Prior project experience'],
  },
  {
    field: 'eligibility',
    required: false,
    ask: 'Who is eligible?',
    options: ['Any Bachelor’s or Master’s degree', 'B.E. / B.Tech / BCA / MCA', 'Final-year students only', 'Open to all students'],
  },
  {
    field: 'applyBy',
    required: false,
    ask: 'Is there a closing date?',
    options: ['No deadline', 'End of this month', 'In two weeks'],
  },
];

const FIELDS = QUESTIONS.map((q) => q.field);
const REQUIRED = QUESTIONS.filter((q) => q.required).map((q) => q.field);

/** The app's own domain list when it is there, so a domain added to the
    portal is offered by the agent the same day. */
function domainOptions() {
  try {
    const cfg = require('../../../config/domains');
    const names = cfg && (cfg.DOMAIN_NAMES || cfg.domainNames);
    if (Array.isArray(names) && names.length) return names.slice(0, 8);
  } catch (e) { /* the fallback below is the point */ }
  return ['Python Development', 'Web Development', 'Data Science', 'Digital Marketing', 'UI/UX', 'Human Resources'];
}

function clean(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

/**
 * What we already know, read out of whatever the author typed.
 *
 * The point of doing this before asking anything is that a person who wrote
 * "hiring Python interns, remote, 2 months, 5k, apply by 30 Sept" has already
 * answered five of the nine questions, and being asked them anyway is the
 * fastest way to make somebody close the panel.
 */
function known(source, kind) {
  const fields = extractFields(source, kind || detectKind(source)) || {};
  const out = {};
  if (fields.domain) out.domain = fields.domain;
  if (fields.duration) out.duration = fields.duration;
  if (fields.mode) out.mode = fields.mode;
  if (fields.stipend) out.stipend = fields.stipend;
  if (fields.applyBy) out.applyBy = fields.applyBy;
  if (fields.role) out.role = fields.role;

  const text = clean(source);

  /*
   * "5 openings", "10 positions", "20 seats" — and the way people actually
   * write it, which is "hiring 20 Python interns". The count sits in front of
   * the role far more often than in front of the word "openings", and a
   * pattern that only knew the formal phrasing asked every author how many
   * openings there were immediately after they had said so.
   */
  const openings = text.match(/\b(\d{1,3})\s*\+?\s*(?:openings?|positions?|seats?|vacanc(?:y|ies)|slots?)\b/i)
    || text.match(/\b(?:hiring|need|want|looking for|recruiting)\s+(\d{1,3})\s*\+?\s+/i)
    || text.match(/\b(\d{1,3})\s*\+?\s+(?:\w+\s+){0,3}?interns?\b/i);
  if (openings) out.openings = openings[1];

  /* "October batch", "Nov 2026 batch", "batch of January" */
  const batch = text.match(/\b([A-Z][a-z]{2,8}(?:\s+\d{4})?)\s+batch\b/)
    || text.match(/\bbatch\s+of\s+([A-Z][a-z]{2,8}(?:\s+\d{4})?)\b/i);
  if (batch) out.batch = `${batch[1]} batch`.replace(/\s+batch batch$/i, ' batch');

  /* Freshers welcome is a skills answer, and the commonest one. */
  if (/\b(no prior (skill|experience)|freshers?( are)? welcome|open to freshers|beginner friendly|no experience (needed|required))\b/i.test(text)) {
    out.skills = 'Open to freshers, no prior skill needed';
  }
  return out;
}

/**
 * The next thing to ask, or null when there is nothing left worth asking.
 *
 * `asked` is the list of fields already put to the author — including ones
 * they skipped — so the agent never asks the same question twice in a
 * conversation. That is the difference between an assistant and a phone tree.
 */
function nextQuestion(facts, asked) {
  const have = facts || {};
  const done = Array.isArray(asked) ? asked : [];
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const q = QUESTIONS[i];
    if (!q.required) continue;
    if (clean(have[q.field])) continue;
    if (done.indexOf(q.field) !== -1) continue;
    return hydrate(q);
  }
  return null;
}

/** Fill in any options that are computed rather than fixed. */
function hydrate(q) {
  const out = {
    field: q.field,
    ask: q.ask,
    why: q.why || '',
    required: Boolean(q.required),
    options: q.dynamic === 'domains' ? domainOptions() : (q.options || []).slice(),
  };
  return out;
}

/**
 * Record an answer.
 *
 * "Skip", "no" and an empty answer all mean the same thing: leave the fact
 * off the poster and stop asking. They are not the same as a wrong answer, so
 * the field is marked as asked either way.
 */
function answer(facts, asked, field, value) {
  const nextFacts = Object.assign({}, facts || {});
  const nextAsked = (Array.isArray(asked) ? asked.slice() : []);
  if (nextAsked.indexOf(field) === -1) nextAsked.push(field);

  const v = clean(value);
  const skipped = !v || /^(skip|no|none|n\/a|not sure|later)$/i.test(v);
  if (!skipped) nextFacts[field] = v;
  return { facts: nextFacts, asked: nextAsked, skipped };
}

/** Which required facts are still missing — what the poster will not show. */
function missing(facts) {
  const have = facts || {};
  return REQUIRED.filter((f) => !clean(have[f]));
}

/**
 * How far through the author is, for the one line of reassurance a
 * question needs: nobody answers six questions without knowing how many are
 * left.
 */
function progress(facts, asked) {
  const answered = REQUIRED.filter((f) => clean((facts || {})[f])).length;
  return { answered, total: REQUIRED.length, remaining: Math.max(0, REQUIRED.length - answered) };
}

/**
 * Does this draft want the questionnaire at all?
 *
 * Only hiring posts. A placement story, an achievement or a general
 * announcement has a completely different set of facts, and asking somebody
 * announcing a student's job offer how many openings there are would be
 * absurd. A draft that already carries most of the facts is also left alone:
 * the questions exist to fill gaps, not to audit.
 */
function wanted(source, kind) {
  const k = kind || detectKind(source);
  if (k !== 'opening') return false;
  return missing(known(source, k)).length > 0;
}

module.exports = {
  QUESTIONS, FIELDS, REQUIRED,
  known, nextQuestion, answer, missing, progress, wanted, domainOptions,
};
