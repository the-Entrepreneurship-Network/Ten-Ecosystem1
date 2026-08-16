'use strict';

/**
 * How well a person fits a job, and how well their resume reads to an ATS.
 *
 * Two different questions that are easy to confuse:
 *
 *   Fitness  — should this person apply? A holistic read of skills, years,
 *              domain, seniority, projects and education against the posting.
 *
 *   ATS      — will a keyword filter pass the resume through? Purely how much
 *              of the posting's own vocabulary appears in the document.
 *
 * A candidate can be an excellent fit and still be filtered out for writing
 * "React.js" where the posting said "ReactJS", which is exactly why both are
 * reported rather than one blended number.
 *
 * Everything here is deterministic. No model is called, so the same resume and
 * the same posting always produce the same score, and the reasons given are
 * the actual arithmetic rather than a plausible-sounding summary.
 */

/* Weights as specified: skills carry the most, education and projects least. */
const WEIGHTS = Object.freeze({
  skills: 3,
  years: 2,
  domain: 2,
  seniority: 2,
  projects: 1,
  education: 1
});

const BANDS = Object.freeze([
  { min: 80, band: 'strong', advice: 'Strong fit — apply.' },
  { min: 60, band: 'moderate', advice: 'Moderate fit — worth applying.' },
  { min: 0, band: 'stretch', advice: 'Stretch — apply only if the work appeals.' }
]);

const SENIORITY_RANK = Object.freeze({ intern: 0, entry: 1, mid: 2, senior: 3 });

/**
 * The skill vocabulary, kept here rather than in the route because both the
 * resume reader and the scorer have to agree on what counts as a skill. If
 * they drift, a resume can list a skill the scorer cannot see in a posting.
 */
const SKILL_VOCAB = Object.freeze([
  'javascript', 'typescript', 'react', 'next.js', 'node', 'express', 'mongodb', 'mongoose', 'redux', 'graphql',
  'python', 'django', 'flask', 'fastapi', 'pandas', 'numpy', 'scikit-learn', 'tensorflow', 'pytorch', 'nlp',
  'java', 'spring', 'spring boot', 'hibernate', 'kotlin', 'android', 'swift', 'ios', 'flutter', 'dart',
  'html', 'css', 'tailwind', 'sass', 'figma', 'ui/ux', 'accessibility',
  'sql', 'postgresql', 'mysql', 'redis', 'elasticsearch', 'kafka',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins', 'ci/cd', 'linux', 'bash', 'git',
  'cyber security', 'penetration testing', 'owasp', 'siem', 'soc', 'networking', 'cryptography',
  'excel', 'power bi', 'tableau', 'financial modelling', 'valuation', 'market research', 'stakeholder management',
  'recruitment', 'onboarding', 'payroll', 'hris', 'content writing', 'seo', 'social media',
  'machine learning', 'deep learning', 'data analysis', 'data visualization', 'rest api', 'microservices', 'testing', 'jest'
]);

const DOMAINS = Object.freeze({
  fintech: ['fintech', 'payments', 'banking', 'lending', 'trading', 'insurance'],
  ecommerce: ['ecommerce', 'e-commerce', 'marketplace', 'retail', 'd2c'],
  health: ['health', 'healthcare', 'medical', 'clinical', 'pharma', 'biotech'],
  /* Not the bare words "education" or "learning": every resume has an
     Education heading and half of them mention machine learning, so those
     matched everybody and made the domain signal meaningless. */
  edtech: ['edtech', 'ed-tech', 'e-learning', 'learning platform', 'curriculum', 'coursework platform'],
  saas: ['saas', 'b2b', 'enterprise software', 'crm', 'erp'],
  gaming: ['gaming', 'game studio', 'unity', 'unreal'],
  logistics: ['logistics', 'supply chain', 'delivery', 'fleet', 'warehouse'],
  security: ['security', 'cyber', 'infosec', 'soc', 'threat']
});

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary match that tolerates the +/# in "c++" and "c#". */
function hasWord(haystack, term) {
  if (!term) return false;
  return new RegExp(
    `(^|[^a-z0-9+#])${escapeRe(String(term).toLowerCase())}([^a-z0-9+#]|$)`, 'i'
  ).test(haystack);
}

/**
 * Years of experience the posting asks for. Reads the common phrasings —
 * "3+ years", "2-4 years", "minimum 5 years" — and returns the lower bound,
 * which is the number that actually gates an application.
 */
function requiredYears(text) {
  const low = String(text || '').toLowerCase();
  const range = low.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*\+?\s*(?:years|yrs|year)/);
  if (range) return parseInt(range[1], 10);
  const plus = low.match(/(\d+)\s*\+\s*(?:years|yrs|year)/);
  if (plus) return parseInt(plus[1], 10);
  const min = low.match(/(?:minimum|at least|min\.?)\s*(\d+)\s*(?:years|yrs|year)/);
  if (min) return parseInt(min[1], 10);
  const plain = low.match(/(\d+)\s*(?:years|yrs)\s*(?:of\s*)?(?:experience|exp)/);
  if (plain) return parseInt(plain[1], 10);
  return null;
}

/** Seniority the posting is pitched at, or null when it does not say. */
function requiredSeniority(text) {
  const low = String(text || '').toLowerCase();
  if (/\b(intern|internship|trainee)\b/.test(low)) return 'intern';
  if (/\b(senior|sr\.|staff|principal|lead|architect|head of)\b/.test(low)) return 'senior';
  if (/\b(fresher|graduate|entry[- ]level|junior|jr\.)\b/.test(low)) return 'entry';
  if (/\b(mid[- ]level|associate)\b/.test(low)) return 'mid';
  return null;
}

/** Which industries a piece of text reads as belonging to. */
function domainsOf(text) {
  const low = String(text || '').toLowerCase();
  return Object.keys(DOMAINS).filter((d) => DOMAINS[d].some((k) => low.includes(k)));
}

/**
 * The vocabulary a posting is filtering on: its skill words plus the
 * distinctive words in its title. Generic filler is dropped, because matching
 * "the" tells nobody anything.
 */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'work', 'team', 'role', 'job',
  'years', 'year', 'experience', 'strong', 'good', 'plus', 'must', 'have', 'this', 'that',
  'from', 'your', 'about', 'time', 'full', 'part', 'well', 'able', 'into', 'they', 'their'
]);

/**
 * The terms worth matching against.
 *
 * Taking every distinctive word in the posting made this useless: a 4000
 * character description contributed hundreds of words like "implementation."
 * and "refactoring.", so a resume that named every required technology still
 * scored 7%, and the "missing keywords" list was mostly punctuation and the
 * company's own domain name.
 *
 * So it keeps the terms an ATS is actually keyed on: known skills, the words
 * in the job title, and tokens that look technical — versioned names, dotted
 * names, acronyms. Everything else is prose.
 */
function keywordsOf(jobText, vocabulary, title) {
  const low = String(jobText || '').toLowerCase();
  const found = new Set();

  (vocabulary || SKILL_VOCAB).forEach((skill) => { if (hasWord(low, skill)) found.add(skill); });
  SKILL_VOCAB.forEach((skill) => { if (hasWord(low, skill)) found.add(skill); });

  /* Title words: what the role is called is what a filter searches for. */
  String(title || '').toLowerCase().split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .forEach((w) => found.add(w));

  /* Technical-looking tokens the vocabulary has never heard of, so a new
     framework still counts. Trailing punctuation stripped — "refactoring."
     and "refactoring" are the same word to a human and to a filter. */
  (low.match(/[a-z][a-z0-9+#.-]{2,19}/g) || []).forEach((raw) => {
    const w = raw.replace(/[.\-]+$/, '');
    if (w.length < 3 || STOP.has(w)) return;
    const technical = /[0-9+#]/.test(w) || /\.(js|ts|py|net|io)$/.test(w) || w.includes('-');
    if (technical) found.add(w);
  });

  return [...found];
}

/**
 * What share of the posting's vocabulary the resume already contains.
 * This is the number an ATS approximates, and 70% is the usual pass mark.
 */
function atsMatch(resumeText, jobText, vocabulary, title) {
  const resume = String(resumeText || '').toLowerCase();
  const keywords = keywordsOf(jobText, vocabulary, title);
  if (!keywords.length) return { percent: 0, matched: [], missing: [], passes: false };

  const matched = keywords.filter((k) => hasWord(resume, k));
  const missing = keywords.filter((k) => !hasWord(resume, k));
  const percent = Math.round((matched.length / keywords.length) * 100);

  return {
    percent,
    passes: percent >= 70,
    matched: matched.slice(0, 40),
    /* Ordered longest-first: multi-word phrases are the ones worth adding. */
    missing: missing.sort((a, b) => b.length - a.length).slice(0, 25)
  };
}

/**
 * Score a profile against one posting.
 *
 * A dimension the posting says nothing about is left out of the average
 * rather than scored zero. Most listings never mention education, and
 * punishing a candidate for the employer's silence would push every score
 * into "stretch" and make the number useless.
 */
function fitness(profile, job) {
  const p = profile || {};
  const jobText = [job && job.title, job && job.description, (job && job.tags || []).join(' '), job && job.type]
    .filter(Boolean).join(' ').toLowerCase();

  const parts = [];
  const reasons = [];

  /* Skills — the share of what the posting names that the person has. */
  const mySkills = (p.skills || []).map((s) => String(s).toLowerCase());
  const wanted = mySkills.filter((s) => hasWord(jobText, s));

  /* Scored as coverage of what the posting demands, not of what the candidate
     happens to list. Measuring against the candidate's own list punishes
     breadth: someone who knows five things and is asked for two would score
     40% for having both of them. */
  const demanded = SKILL_VOCAB.filter((s) => hasWord(jobText, s));
  if (demanded.length) {
    const have = demanded.filter((s) => mySkills.includes(s));
    parts.push({ key: 'skills', score: have.length / demanded.length });
    reasons.push(`${have.length} of the ${demanded.length} skills asked for` +
      (have.length ? ` — ${have.slice(0, 4).join(', ')}` : ''));
  } else if (mySkills.length) {
    /* A posting naming no recognisable skill says nothing either way. */
    reasons.push('the posting names no specific skills');
  }

  /* Years — under the bar is a penalty that scales with the gap. */
  const need = requiredYears(jobText);
  if (need !== null && typeof p.years === 'number') {
    const gap = p.years - need;
    const score = gap >= 0 ? 1 : Math.max(0, 1 + gap / Math.max(need, 1));
    parts.push({ key: 'years', score });
    reasons.push(gap >= 0
      ? `meets the ${need}-year requirement`
      : `${Math.abs(gap)} year${Math.abs(gap) === 1 ? '' : 's'} under the ${need}-year requirement`);
  }

  /* Domain — prior work in the same industry. */
  const jobDomains = domainsOf(jobText);
  /* Read from what the person has built and stated, not from the raw top of
     the resume — that included section headings and produced phantom matches. */
  const myDomains = domainsOf([(p.domains || []).join(' '), (p.projects || []).join(' ')].filter(Boolean).join(' '));
  if (jobDomains.length) {
    const shared = jobDomains.filter((d) => myDomains.includes(d));
    parts.push({ key: 'domain', score: shared.length ? 1 : 0.4 });
    if (shared.length) reasons.push(`${shared[0]} background matches`);
  }

  /* Seniority — a level apart is survivable, two is not. */
  const jobLevel = requiredSeniority(jobText);
  if (jobLevel && p.seniority && SENIORITY_RANK[p.seniority] !== undefined) {
    const distance = Math.abs(SENIORITY_RANK[jobLevel] - SENIORITY_RANK[p.seniority]);
    const score = distance === 0 ? 1 : distance === 1 ? 0.6 : 0.15;
    parts.push({ key: 'seniority', score });
    if (distance > 0) reasons.push(`posting is pitched at ${jobLevel}, you read as ${p.seniority}`);
  }

  /* Projects — has this person built the thing being asked for. */
  const projectText = (p.projects || []).join(' ').toLowerCase();
  if (projectText && wanted.length) {
    const overlap = wanted.filter((s) => hasWord(projectText, s));
    parts.push({ key: 'projects', score: overlap.length ? Math.min(1, overlap.length / 3) : 0.3 });
    if (overlap.length) reasons.push(`your projects use ${overlap.slice(0, 3).join(', ')}`);
  }

  /* Education — only when the posting actually asks. */
  const asksDegree = /\b(b\.?tech|b\.?e\.?|bachelor|master|m\.?tech|mba|degree|graduate)\b/.test(jobText);
  if (asksDegree && p.education) {
    parts.push({ key: 'education', score: 1 });
  }

  if (!parts.length) {
    /* Nothing measurable at all. Reported as unknown rather than as a zero
       fit — the posting failed to say what it wants, which is not the same as
       the candidate being unsuitable. */
    return {
      percent: 0,
      band: 'unknown',
      advice: 'Not enough detail to score this posting — read it yourself.',
      confidence: 0,
      reasons: ['the posting states little about what it wants — score is a guess'],
      dimensions: []
    };
  }

  const totalWeight = parts.reduce((sum, part) => sum + WEIGHTS[part.key], 0);
  const weighted = parts.reduce((sum, part) => sum + part.score * WEIGHTS[part.key], 0);
  let percent = Math.round((weighted / totalWeight) * 100);

  /*
   * A score is only as trustworthy as the evidence under it. Averaging over
   * whichever dimensions happened to be measurable let the least informative
   * postings win: one naming no skills, no seniority and no years scored on a
   * single weak signal and came out at 100%, above every real match.
   *
   * So confidence is the share of the total possible weight that was actually
   * measured, and a thinly-evidenced score is pulled back towards the middle
   * rather than being allowed to top the list on nothing.
   */
  const measured = parts.reduce((sum, part) => sum + WEIGHTS[part.key], 0);
  const possible = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const confidence = measured / possible;

  if (confidence < 0.5) {
    /* Pulled toward 50: still ordered sensibly among its peers, but it cannot
       outrank a job whose requirements were actually stated and met. */
    percent = Math.round(50 + (percent - 50) * confidence * 1.4);
    reasons.push('the posting states little about what it wants — score is a guess');
  }

  const band = BANDS.find((b) => percent >= b.min);

  return {
    percent,
    band: band.band,
    advice: band.advice,
    confidence: Math.round(confidence * 100),
    reasons: reasons.slice(0, 4),
    dimensions: parts.map((part) => ({ name: part.key, score: Math.round(part.score * 100) }))
  };
}

module.exports = {
  SKILL_VOCAB,
  fitness,
  atsMatch,
  keywordsOf,
  requiredYears,
  requiredSeniority,
  domainsOf,
  hasWord,
  WEIGHTS,
  BANDS
};
