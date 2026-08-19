'use strict';

/**
 * @fileoverview Recruiter contacts — the ones employers publish themselves.
 *
 * What this collects: the email address, phone number and contact name that a
 * hiring team wrote into their own public job advert. "Send your CV to
 * careers@acme.com", "questions to Priya on +91 …", "email me directly at
 * jane@startup.io" — the poster put that there so applicants would use it, and
 * surfacing it is the whole point of the advert.
 *
 * What this deliberately does NOT do, and why the file would be dangerous
 * without the limit:
 *
 *   It does not guess. hr@ or firstname.lastname@ patterns invented from a
 *   domain are how applications land in nobody's inbox and how a sending
 *   domain earns a spam reputation. The job-hunt skill bans it by name, and
 *   the whole engine's rule is that a fact nobody stated is not a fact.
 *
 *   It does not compile personal contact details from profiles or broker
 *   databases. Assembling a directory of named individuals' work emails and
 *   mobile numbers from LinkedIn or a data vendor is personal-data processing
 *   those people never consented to — India's DPDP Act treats it as such, and
 *   a student mailing a scraped mobile number is a complaint, not an
 *   application.
 *
 * So every row here is traceable: it exists because a specific posting
 * contained it, and that posting's URL travels with it as the evidence.
 */

/* Addresses that belong to the machinery rather than to a hiring team. */
const NOISE_LOCALPARTS = /^(no-?reply|do-?not-?reply|notifications?|support|help|info|admin|webmaster|postmaster|abuse|privacy|legal|security|sales|marketing|billing|unsubscribe|automated|mailer|bounce)$/i;

/* Hosts that are the board's own plumbing, never the employer's team. */
const NOISE_DOMAINS = /(greenhouse|lever|ashby|workday|smartrecruiters|icims|myworkday|indeed|linkedin|glassdoor|sentry|example|test|yourdomain|company)\./i;

const RE_EMAIL_G = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

/*
 * Phone numbers as people actually write them in adverts: an Indian mobile
 * with or without +91, or an international number with a country code. Bare
 * ten-digit runs are excluded — job adverts are full of numbers that are not
 * phones (salaries, employee counts, years), and a wrong number sent a CV is
 * worse than no number.
 */
const RE_PHONE_G = /(?:\+\d{1,3}[\s-]?)\d{5}[\s-]?\d{5}|\+\d{1,3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{4}/g;

/** The words that mark a line as an invitation to make contact. */
const CONTACT_CUE = /\b(email|e-mail|mail|write|send|apply|contact|reach|dm|resume|cv|cover letter|application)\b/i;

/**
 * A named human near the address, when the advert names one.
 * "Contact Priya Sharma at …", "email Jane at …", "reach out to Rahul —".
 */
function nameNear(text, index) {
  const window = String(text).slice(Math.max(0, index - 160), index);
  /* The cue is matched in either case — a sentence usually starts with it,
     so "Contact Priya" must work as well as "contact Priya" — while the name
     itself still has to be capitalised, which is what distinguishes a person
     from the rest of the sentence. Hence the explicit classes rather than the
     `i` flag, which would have loosened both halves. */
  const m = window.match(
    /\b(?:[Cc]ontact|[Ee]mail|[Ee]-mail|[Ww]rite to|[Rr]each out to|[Rr]each|[Ss]peak to|[Aa]sk|[Ss]end (?:it |your cv |your resume )?to)\s+(?:me\s+at\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (!m) return '';
  /* Guard against sentence-initial words that merely look like names. */
  if (/^(The|We|Our|This|Please|You|If|For|All|Any|Send|Email|Apply)$/.test(m[1])) return '';
  return m[1];
}

/** A role title near the address — "Talent Partner", "HR Manager". */
function roleNear(text, index) {
  const window = String(text).slice(Math.max(0, index - 200), index + 120);
  const m = window.match(
    /\b(Head of (?:Talent|People|HR|Recruiting)|Talent (?:Acquisition|Partner|Lead|Manager)|Technical Recruiter|Recruiter|Recruiting (?:Lead|Manager)|HR (?:Manager|Head|Lead|Executive|Partner)|People (?:Ops|Partner|Lead)|Hiring Manager|Engineering Manager|Founder|CTO|CEO)\b/i);
  return m ? m[1] : '';
}

/**
 * Pull every published contact out of one posting.
 *
 * The cue check is what keeps this honest: an address is kept only when the
 * surrounding sentence invites contact. A posting that merely mentions an
 * address in a legal footer is not offering a way in.
 */
function contactsFromPosting(job) {
  const text = `${job.description || ''}\n${job.title || ''}`;
  if (!text.trim()) return [];

  const out = [];
  const seen = new Set();

  let m;
  RE_EMAIL_G.lastIndex = 0;
  while ((m = RE_EMAIL_G.exec(text)) !== null) {
    const email = m[0].replace(/[.,;)]+$/, '');
    const [local, domain] = email.split('@');
    if (!domain) continue;
    if (NOISE_LOCALPARTS.test(local)) continue;
    if (NOISE_DOMAINS.test(domain)) continue;
    if (seen.has(email.toLowerCase())) continue;

    /* The sentence around it must actually invite an application. */
    const around = text.slice(Math.max(0, m.index - 220), m.index + 160);
    if (!CONTACT_CUE.test(around)) continue;

    seen.add(email.toLowerCase());
    out.push({
      company: job.company || '',
      name: nameNear(text, m.index),
      role: roleNear(text, m.index),
      email,
      phone: '',
      /* The evidence. Every row can be checked against the advert it came
         from, which is what makes this different from a scraped list. */
      sourceUrl: job.directUrl || job.url || '',
      sourceTitle: job.title || '',
      postedAgo: job.postedAgo || '',
      via: job.source || '',
    });
  }

  /* A phone number is attached to the contact from the same posting rather
     than listed on its own — a bare number with no employer is not usable. */
  RE_PHONE_G.lastIndex = 0;
  const phones = [];
  while ((m = RE_PHONE_G.exec(text)) !== null) {
    const around = text.slice(Math.max(0, m.index - 220), m.index + 160);
    if (CONTACT_CUE.test(around)) phones.push(m[0].trim());
  }
  if (phones.length && out.length) out[0].phone = phones[0];
  else if (phones.length && !out.length) {
    out.push({
      company: job.company || '',
      name: nameNear(text, text.indexOf(phones[0])),
      role: roleNear(text, text.indexOf(phones[0])),
      email: '',
      phone: phones[0],
      sourceUrl: job.directUrl || job.url || '',
      sourceTitle: job.title || '',
      postedAgo: job.postedAgo || '',
      via: job.source || '',
    });
  }

  return out;
}

/**
 * Every published contact across a hunt, one row per address, newest first.
 * Duplicates collapse: the same recruiter advertising three roles is one
 * person, and their other postings ride along as extra evidence.
 */
function collectRecruiters(jobs) {
  const byEmail = new Map();
  const rows = [];

  (jobs || []).forEach((job) => {
    contactsFromPosting(job).forEach((c) => {
      const key = (c.email || c.phone).toLowerCase();
      if (!key) return;
      const prior = byEmail.get(key);
      if (prior) {
        if (!prior.alsoHiringFor.includes(c.sourceTitle) && c.sourceTitle) {
          prior.alsoHiringFor.push(c.sourceTitle);
        }
        if (!prior.phone && c.phone) prior.phone = c.phone;
        if (!prior.name && c.name) prior.name = c.name;
        if (!prior.role && c.role) prior.role = c.role;
        return;
      }
      const row = { ...c, alsoHiringFor: [] };
      byEmail.set(key, row);
      rows.push(row);
    });
  });

  return rows;
}

module.exports = { collectRecruiters, contactsFromPosting, nameNear, roleNear };
