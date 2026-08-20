'use strict';

const atsEngine = require('./atsResumeEngine');

/**
 * What an applicant tracking system actually pulls out of this file.
 *
 * Every other view here is an opinion — a score, a rewrite, a list of things
 * to fix. This one is a fact: these are the fields a parser would extract,
 * this is the confidence it had, and this is the line it took them from. A
 * student who sees their phone number extracted as "91 98765" or their
 * employer extracted as their job title stops arguing with the score and
 * fixes the file, because the failure is in front of them rather than
 * summarised.
 *
 * Borrowed in shape from OpenResume's parser page, which is the right idea:
 * if the tool that is on your side cannot read the document, the one that is
 * not on your side certainly cannot.
 *
 * Deterministic. No model, no key, no network. Every verdict here can be
 * traced to a line of the file.
 */

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const RE_PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const RE_URL = /((?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com)\/[\w\-./]+)/i;

/* A field, with the evidence for it rather than just the value. */
function field(name, value, line, confidence, why) {
  return { name, value: value || null, line: line || null, confidence, why };
}

/**
 * The extraction, field by field.
 *
 * Confidence is one of `high`, `low` or `none`, and it means something
 * specific each time: high is a pattern that cannot be anything else (an
 * address with an @, a date range), low is a heuristic that is usually right
 * (the first line is the name), none is a field the parser could not fill.
 */
function extract(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  const led = atsEngine.factLedger(raw);
  const fields = [];

  /* Name — the weakest guess a parser makes, and it says so. */
  const nameLine = nonEmpty[0] || '';
  /*
   * "CURRICULUM VITAE" fits the shape of a name and is not one.
   *
   * The pattern alone reported high confidence on a document title, which is
   * exactly the mistake this view exists to expose in other people's
   * parsers — so the words that head a resume are excluded by name.
   */
  const DOC_TITLE = /^(curriculum vitae|resume|résumé|cv|profile|personal details|bio ?data)$/i;
  const nameLooksRight = /^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(nameLine) &&
    !DOC_TITLE.test(nameLine.trim());
  fields.push(field('Name', led.name || (nameLooksRight ? nameLine : null), nameLine,
    led.name && nameLooksRight ? 'high' : led.name ? 'low' : 'none',
    nameLooksRight
      ? 'First line, two to four capitalised words — the shape a parser expects.'
      : 'The first line does not look like a name. A parser guesses here, and it guesses wrong on decorated headers.'));

  const emailLine = lines.find((l) => RE_EMAIL.test(l));
  fields.push(field('Email', (raw.match(RE_EMAIL) || [])[0], emailLine,
    emailLine ? 'high' : 'none',
    emailLine ? 'An address is unambiguous — the @ makes it impossible to confuse with anything else.'
      : 'No address found in the body. An ATS that cannot reply usually discards the application.'));

  const phoneLine = lines.find((l) => RE_PHONE.test(l));
  const phone = (raw.match(RE_PHONE) || [])[0];
  fields.push(field('Phone', phone, phoneLine,
    phone && phone.replace(/\D/g, '').length >= 10 ? 'high' : phone ? 'low' : 'none',
    !phone ? 'No number found.'
      : phone.replace(/\D/g, '').length >= 10 ? 'Ten or more digits together — a parser reads this cleanly.'
        : 'Fewer than ten digits came out in one piece. A number split across columns extracts broken.'));

  const urlLine = lines.find((l) => RE_URL.test(l));
  fields.push(field('Profile URL', (raw.match(RE_URL) || [])[0], urlLine,
    urlLine ? 'high' : 'none',
    urlLine ? 'A known profile host — extracted as text, which is what matters.'
      : 'No LinkedIn or GitHub URL as plain text. A link hidden behind display text does not survive extraction.'));

  fields.push(field('Job title', led.title, led.title,
    led.title ? 'low' : 'none',
    led.title ? 'Taken from the line under the name, which is where a title normally sits.'
      : 'No title line under the name. The parser has to infer your target from the body instead.'));

  return { fields, ledger: led, lines };
}

/**
 * Sections and roles, as the parser splits them — the half that actually
 * decides whether a resume survives.
 */
function structure(text) {
  const { ledger, lines } = extract(text);

  const CORE = ['experience', 'education', 'skills'];
  const sections = Object.keys({ experience: 1, education: 1, skills: 1, projects: 1, summary: 1, certifications: 1 })
    .map((key) => ({
      name: key,
      found: ledger.sectionsFound.includes(key),
      core: CORE.includes(key),
    }));

  const roles = ledger.roles.map((r) => ({
    header: r.header || '(no header line — the parser cannot tell where this job starts)',
    dated: r.hasDates,
    bullets: r.bullets.length,
    warning: !r.header ? 'Bullets with no employer line above them are attributed to nothing.'
      : !r.hasDates ? 'No date range on this role — recruiters filter on dates, and a role without them reads as a gap.'
        : null,
  }));

  /* The layout faults that break extraction, found by shape rather than by
     looking at an image nobody has. */
  /*
   * Columns, judged as a share of the page rather than a fixed count.
   *
   * A flat threshold of six wide lines missed a short two-column extract
   * entirely — the fixture that motivated this view had five, and was
   * reported as clean. What matters is whether the gutter runs down the page,
   * not how long the page is.
   */
  const content = lines.filter(Boolean);
  const wide = content.filter((l) => /\S\s{6,}\S/.test(l)).length;
  const hazards = [];
  if (wide >= 6 || (content.length >= 4 && wide / content.length >= 0.3)) hazards.push({
    what: 'Two columns',
    why: `${wide} of ${content.length} lines have a wide internal gap. A parser reads across the page, so two columns interleave into nonsense.`,
  });
  if (/\t{2,}/.test(text)) hazards.push({ what: 'Tab-built table', why: 'Tables are dropped or scrambled by most parsers.' });
  if (/[■□▲►◆✦❖]/.test(text)) hazards.push({ what: 'Decorative bullets', why: 'Glyph bullets are stripped, and the line can go with them.' });
  const glued = lines.filter((l) => /[A-Za-z](?:19|20)\d{2}\b/.test(l));
  if (glued.length) hazards.push({
    what: 'Words run into years',
    why: `${glued.length} line(s) like "${(glued[0].match(/\S*[A-Za-z](?:19|20)\d{2}\S*/) || [])[0]}". A date the parser cannot see is a date the filter cannot match.`,
  });

  return { sections, roles, hazards };
}

/**
 * The whole view, plus the one sentence that matters: would this file survive
 * being read by a machine?
 */
function parserView(text) {
  const { fields } = extract(text);
  const { sections, roles, hazards } = structure(text);

  const missing = fields.filter((f) => f.confidence === 'none').map((f) => f.name);
  const shaky = fields.filter((f) => f.confidence === 'low').map((f) => f.name);
  const coreMissing = sections.filter((s) => s.core && !s.found).map((s) => s.name);
  const undated = roles.filter((r) => !r.dated).length;

  const fatal = missing.includes('Email') || hazards.some((h) => h.what === 'Two columns') || coreMissing.length >= 2;

  return {
    fields,
    sections,
    roles,
    hazards,
    verdict: fatal
      ? 'This file would come out of a parser damaged. Fix the faults below before you send it anywhere.'
      : missing.length || shaky.length || undated || hazards.length
        ? 'Readable, with parts a parser will get wrong.'
        : 'Extracts cleanly. Every field a filter looks for came out whole.',
    fatal,
    summary: {
      extracted: fields.filter((f) => f.value).length,
      of: fields.length,
      missing,
      shaky,
      coreMissing,
      undatedRoles: undated,
    },
    caveat: 'This is one parser, run on the text of your file. Different systems differ in the details — but a file this one cannot read is a file most of them cannot read either.',
  };
}

module.exports = { parserView, extract, structure };
