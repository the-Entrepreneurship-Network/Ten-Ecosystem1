'use strict';

/**
 * Tailored application materials — a resume and a cover letter aimed at one
 * specific posting.
 *
 * The single rule that shapes everything here: nothing is invented. The
 * tailoring reorders, re-words and re-emphasises what the person already
 * wrote, and where the posting wants something they do not have, it says so in
 * a gaps list instead of quietly adding it. A resume that claims Kubernetes
 * because the posting asked for it fails at the interview, which is worse than
 * failing at the filter.
 *
 * This is deterministic assembly, not generation. No model writes these, so
 * they read as structured drafts the student edits and sends — which is also
 * why the tone rules below matter: the text has to sound like a person rather
 * than a form, and it must not reach for the vocabulary that gives away
 * machine writing.
 */

const { atsMatch, hasWord } = require('./jobFitness');

/* Words that make a letter read as machine-written. Kept out of the generated
   text, and flagged if the student's own source resume leans on them. */
const CLICHES = Object.freeze([
  'spearheaded', 'leveraged', 'synergy', 'synergies', 'passionate about',
  'results-driven', 'go-getter', 'think outside the box', 'dynamic professional',
  'proven track record', 'hit the ground running', 'wear many hats'
]);

/** Split a resume into labelled sections so bullets can be reordered. */
function sectionsOf(resumeText) {
  const lines = String(resumeText || '').split(/\r?\n/);
  const sections = [];
  let current = { heading: 'top', lines: [] };

  const HEADING = /^\s*(experience|work experience|employment|projects?|education|skills|technical skills|certifications?|summary|profile|achievements?)\s*:?\s*$/i;

  lines.forEach((line) => {
    if (HEADING.test(line)) {
      if (current.lines.length) sections.push(current);
      current = { heading: line.trim().replace(/:$/, '').toLowerCase(), lines: [] };
    } else if (line.trim()) {
      current.lines.push(line.trim());
    }
  });
  if (current.lines.length) sections.push(current);
  return sections;
}

/** Lines that look like accomplishment bullets rather than prose or headers. */
function bulletsOf(sections) {
  const wanted = /experience|project|achievement|employment/i;
  return sections
    .filter((s) => wanted.test(s.heading))
    .flatMap((s) => s.lines)
    .filter((l) => l.length > 25);
}

/**
 * Reorder bullets so the ones carrying the posting's own vocabulary come
 * first. The wording is untouched — only the order changes, because rewriting
 * someone's achievements without knowing the facts behind them is how a resume
 * acquires claims its author cannot defend.
 */
function prioritise(bullets, keywords) {
  return bullets
    .map((text) => ({
      text,
      hits: keywords.filter((k) => hasWord(text.toLowerCase(), k))
    }))
    .sort((a, b) => b.hits.length - a.hits.length);
}

/**
 * A summary line addressed at this specific role, built only from things the
 * person's own resume supports.
 */
function summaryLine(profile, job, provenSkills) {
  const role = job.title || profile.role;
  const years = typeof profile.years === 'number' && profile.years > 0
    ? `${profile.years} year${profile.years === 1 ? '' : 's'} of `
    : '';
  const stack = provenSkills.slice(0, 4).join(', ');

  const parts = [`${profile.role || 'Engineer'} with ${years}hands-on work`];
  if (stack) parts.push(`in ${stack}`);
  parts.push(`applying for ${role}${job.company ? ' at ' + job.company : ''}`);
  return parts.join(' ') + '.';
}

/**
 * Build the tailored resume.
 *
 * Returns the document plus the honest diagnostics: what the posting wanted
 * that the resume cannot support, and what the keyword match came to before
 * and after reordering.
 */
function tailorResume(profile, job, resumeText) {
  const p = profile || {};
  const jobText = [job.title, job.description, (job.tags || []).join(' ')].filter(Boolean).join(' ');
  const before = atsMatch(resumeText, jobText, p.skills, job.title);

  /* Only skills the source resume actually evidences may be surfaced. */
  const provenSkills = (p.skills || []).filter((s) => hasWord(String(resumeText).toLowerCase(), s));
  const jobSkills = provenSkills.filter((s) => hasWord(jobText.toLowerCase(), s));

  const sections = sectionsOf(resumeText);
  const ordered = prioritise(bulletsOf(sections), before.matched);

  const contact = sections.find((s) => s.heading === 'top');
  const education = sections.find((s) => /education/i.test(s.heading));

  const doc = [];
  doc.push(p.name || (contact && contact.lines[0]) || 'Your Name');
  if (contact) doc.push(contact.lines.slice(1, 3).join(' · '));
  doc.push('');
  doc.push('SUMMARY');
  doc.push(summaryLine(p, job, jobSkills.length ? jobSkills : provenSkills));
  doc.push('');
  doc.push('SKILLS');
  /* Matching skills first: a filter reading top-down should meet them early. */
  doc.push([...jobSkills, ...provenSkills.filter((s) => !jobSkills.includes(s))].join(' · '));
  doc.push('');
  doc.push('EXPERIENCE & PROJECTS');
  ordered.forEach((b) => doc.push('• ' + b.text));
  if (education) {
    doc.push('');
    doc.push('EDUCATION');
    education.lines.forEach((l) => doc.push(l));
  }

  const text = doc.join('\n');
  const after = atsMatch(text, jobText, p.skills, job.title);

  return {
    filename: fileName(p.name, job, 'Resume'),
    text,
    ats: { before: before.percent, after: after.percent, passes: after.passes },
    /* What the posting asked for that this resume cannot honestly claim.
       Shown to the student as work to do, never silently inserted. */
    gaps: before.missing.filter((k) => !hasWord(String(resumeText).toLowerCase(), k)).slice(0, 12),
    reorderedBullets: ordered.length
  };
}

/**
 * Build the cover letter: under 300 words, mirroring a handful of the
 * posting's phrases, and mapping real achievements to what was asked for.
 */
function coverLetter(profile, job, resumeText) {
  const p = profile || {};
  const jobText = [job.title, job.description, (job.tags || []).join(' ')].filter(Boolean).join(' ');
  const match = atsMatch(resumeText, jobText, p.skills, job.title);

  /* Three to five of the posting's own terms, used in context rather than
     listed — mirroring the phrasing is what gets past the filter. */
  const mirror = match.matched
    .filter((k) => (p.skills || []).map((s) => s.toLowerCase()).includes(k))
    .slice(0, 5);

  const evidence = prioritise(bulletsOf(sectionsOf(resumeText)), match.matched)
    .filter((b) => b.hits.length)
    .slice(0, 3)
    .map((b) => b.text);

  const company = job.company || 'your team';
  const role = job.title || p.role;

  const body = [];
  body.push(`Dear Hiring Team at ${company},`);
  body.push('');
  body.push(
    `I am applying for the ${role} role. ` +
    (mirror.length
      ? `I work with ${mirror.slice(0, 3).join(', ')} day to day, which is what the posting is built around.`
      : `The work described matches what I have been building.`)
  );
  body.push('');

  if (evidence.length) {
    body.push('Three things from my recent work that speak to it directly:');
    evidence.forEach((e) => body.push('• ' + e));
    body.push('');
  }

  body.push(
    (p.location ? `I am based in ${p.location} and ` : 'I am ') +
    'available to start on a standard notice period, and open to relocating for the right team.'
  );
  body.push('');
  body.push('I would welcome the chance to talk it through.');
  body.push('');
  body.push(p.name || 'Your Name');

  const text = body.join('\n');
  const words = text.split(/\s+/).filter(Boolean).length;

  return {
    filename: fileName(p.name, job, 'CoverLetter'),
    text,
    words,
    withinLimit: words <= 300,
    mirroredKeywords: mirror,
    /* Flagged rather than rewritten: it is the student's voice to change. */
    clichesInSource: CLICHES.filter((c) => String(resumeText).toLowerCase().includes(c))
  };
}

/**
 * A cold email to the person doing the hiring.
 *
 * Written against what actually gets replies rather than what reads well:
 *
 *   Short.      Under 120 words. A recruiter reading on a phone between
 *               meetings will not scroll, so anything below the fold is lost.
 *   Specific.   One proof point with a number in it, taken from the resume,
 *               chosen because it matches what the posting asked for. Generic
 *               enthusiasm is the reason most of these are ignored.
 *   One ask.    A single question with a yes/no answer. "Let me know if
 *               there is a fit" gives the reader nothing to reply to;
 *               "should I send my resume?" costs them one word.
 *   No filler.  No clichés, no apologising for the intrusion, no paragraph
 *               about how much they admire the company.
 *
 * The subject line matters more than the body — it decides whether the body is
 * read at all — so it names the role and the single most relevant skill.
 */
function coldEmail(profile, job, resumeText, options) {
  const p = profile || {};
  const opts = options || {};
  const jobText = [job.title, job.description, (job.tags || []).join(' ')].filter(Boolean).join(' ');
  const match = atsMatch(resumeText, jobText, p.skills, job.title);

  const relevantSkills = (p.skills || [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => hasWord(jobText.toLowerCase(), s));

  /* The strongest line is one that carries the posting's words and a number:
     "cut report times from 30s to 2s" is evidence, "worked on reporting" is
     a claim. */
  const bullets = prioritise(bulletsOf(sectionsOf(resumeText)), match.matched);
  const withNumber = bullets.find((b) => b.hits.length && /\d/.test(b.text));
  const proof = (withNumber || bullets[0] || { text: '' }).text;

  const role = job.title || p.role;
  const company = job.company || 'your team';
  const greeting = opts.hiringManager ? `Hi ${opts.hiringManager},` : 'Hi,';

  const subject = relevantSkills.length
    ? `${role} — ${relevantSkills.slice(0, 2).join(' + ')}`
    : `${role} — ${p.role || 'application'}`;

  const lines = [];
  lines.push(greeting);
  lines.push('');
  lines.push(
    `I saw the ${role} opening at ${company}` +
    (relevantSkills.length ? ` and it lines up with what I work on — ${relevantSkills.slice(0, 3).join(', ')}.` : '.')
  );
  lines.push('');
  if (proof) {
    lines.push(`Most relevant thing I have done: ${trimSentence(proof)}`);
    lines.push('');
  }
  /* The ask. Deliberately answerable in one word. */
  lines.push(opts.ask || 'Would it help if I sent my resume?');
  lines.push('');
  lines.push(p.name || 'Your Name');
  if (opts.phone) lines.push(opts.phone);

  const body = lines.join('\n');
  const words = body.split(/\s+/).filter(Boolean).length;

  return {
    subject,
    body,
    words,
    withinLimit: words <= 120,
    proofUsed: Boolean(proof),
    /* Two nudges, spaced the way a busy inbox forgives. Most replies to cold
       outreach come from the follow-up rather than the first message. */
    followUps: [
      {
        afterDays: 4,
        subject: `Re: ${subject}`,
        body: [greeting, '', `Following up on the ${role} role — still interested.`,
          'Happy to send my resume or do a short call.', '', p.name || 'Your Name'].join('\n')
      },
      {
        afterDays: 10,
        subject: `Re: ${subject}`,
        body: [greeting, '', `Last note from me on the ${role} role.`,
          'If it is filled or not a fit, no problem — I will stop here.',
          'If it is still open, I can start on a standard notice period.', '',
          p.name || 'Your Name'].join('\n')
      }
    ],
    /* Stated rather than guessed: the address has to come from the student. */
    note: 'Send to the hiring manager or the recruiter named on the posting. ' +
      'A named person replies far more often than a careers@ inbox.'
  };
}

/** Keep a bullet to one clean sentence so the email stays short. */
function trimSentence(text) {
  const first = String(text || '').split(/(?<=\.)\s/)[0].trim();
  const clipped = first.length > 160 ? first.slice(0, 157).replace(/\s+\S*$/, '') + '…' : first;
  return clipped.replace(/^[•\-*]\s*/, '');
}

/** `Name_Resume_Company_Role.txt` — recognisable in a downloads folder. */
function fileName(name, job, kind) {
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 24);
  const shortRole = String(job.title || '').split(/\s+/).slice(0, 2).join('');
  return [safe(name) || 'Candidate', kind, safe(job.company), safe(shortRole)]
    .filter(Boolean).join('_') + '.txt';
}

module.exports = {
  tailorResume, coverLetter, coldEmail,
  sectionsOf, bulletsOf, prioritise, CLICHES
};
