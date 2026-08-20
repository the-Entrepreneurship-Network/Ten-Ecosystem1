'use strict';

const career = require('./careerData');

/**
 * The interview, as one ordered bank of questions.
 *
 * Three commands used to ask their own scattered subsets — build asked six
 * things, raise asked for "a metric", the cover letter asked for a company
 * name — so what the agent knew about a person depended on which button they
 * had pressed, and none of the three ever asked where they studied, whether
 * the internship was paid, when they are free to start, or what they want to
 * be paid. A resume and a letter are built from the same facts about the same
 * person; there is one bank, and each command draws the part it needs.
 *
 * Every question that has a knowable answer set offers it. A blank prompt is
 * the hardest kind of question, and "what is your notice period" answered from
 * a list is answered in a second and answered consistently. Every list ends in
 * a free-text escape, and every question can be skipped: this is an interview,
 * not a form, and a fact nobody supplies is reported as missing rather than
 * invented.
 */

/* ── answer sets that are not roles, companies or markets ───────────────── */

const YES_NO = (yes, no) => [
  { label: yes || 'Yes', value: 'yes' },
  { label: no || 'No, not yet', value: 'no' },
];

const DURATIONS = [
  { label: 'Under 1 month', value: 'under 1 month' },
  { label: '1–3 months', value: '1-3 months' },
  { label: '3–6 months', value: '3-6 months' },
  { label: '6–12 months', value: '6-12 months' },
  { label: 'Over a year', value: 'over a year' },
];

const HOURS_PER_WEEK = [
  { label: 'Up to 10 hours', note: 'alongside full-time study', value: 'up to 10 hours a week' },
  { label: '10–20 hours', note: 'part-time', value: '10-20 hours a week' },
  { label: '20–30 hours', note: 'heavy part-time', value: '20-30 hours a week' },
  { label: '40 hours', note: 'full-time', value: '40 hours a week' },
];

const WORKING_WINDOW = [
  { label: 'Mornings', note: 'roughly 9am–1pm', value: 'mornings, 9am-1pm' },
  { label: 'Afternoons', note: 'roughly 1pm–6pm', value: 'afternoons, 1pm-6pm' },
  { label: 'Evenings', note: 'roughly 6pm–11pm', value: 'evenings, 6pm-11pm' },
  { label: 'Any hours', note: 'flexible across the day', value: 'flexible hours' },
];

const NOTICE = [
  { label: 'Immediately', value: 'available immediately' },
  { label: 'In 2 weeks', value: 'available in 2 weeks' },
  { label: 'In 1 month', value: 'available in 1 month' },
  { label: 'In 2–3 months', value: 'available in 2-3 months' },
  { label: 'After my course ends', value: 'available after my course ends' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const COMMIT_LENGTH = [
  { label: '1–3 months', note: 'a short internship', value: 'can commit 1-3 months' },
  { label: '3–6 months', note: 'a full internship term', value: 'can commit 3-6 months' },
  { label: '6–12 months', value: 'can commit 6-12 months' },
  { label: 'Open-ended', note: 'looking for a permanent role', value: 'open-ended / permanent' },
];

const WORK_MODE = [
  { label: 'Remote', value: 'remote' },
  { label: 'On-site', value: 'on-site' },
  { label: 'Hybrid', value: 'hybrid' },
  { label: 'No preference', value: 'no preference' },
];

const DEGREES = [
  { label: 'B.Tech / B.E.', value: 'B.Tech' },
  { label: 'B.Sc', value: 'B.Sc' },
  { label: 'BCA', value: 'BCA' },
  { label: 'B.Com', value: 'B.Com' },
  { label: 'BBA', value: 'BBA' },
  { label: 'M.Tech / M.E.', value: 'M.Tech' },
  { label: 'MCA', value: 'MCA' },
  { label: 'M.Sc', value: 'M.Sc' },
  { label: 'MBA', value: 'MBA' },
  { label: 'Diploma', value: 'Diploma' },
];

const PHOTO = [
  { label: 'No photo', note: 'what US, UK, Canada and Indian tech expect', value: 'no' },
  { label: 'Include one', note: 'normal in much of the EU, LatAm and Japan', value: 'yes' },
];

/**
 * Pay expectation, in the currency of the market they picked.
 *
 * Built from the same indicative bands the rest of the agent uses, so a
 * student sees the range their level actually sits in rather than guessing —
 * and the caveat travels with it, because this is the one number a person is
 * most likely to repeat in a negotiation.
 */
function salaryOptions(details) {
  const country = details.country || 'India';
  const band = career.payBand(details.position || details.role, details.level || 'entry', country);
  if (!band) return null;
  const step = (band.high - band.low) / 3;
  const at = (n) => `${band.symbol}${Math.round(n).toLocaleString('en-US')}`;
  /* The unit belongs in the label. "₹4–₹7" is not a salary; "₹4–₹7 LPA" is,
     and the difference is the one a person would repeat out loud. */
  const rng = (lo, hi) => `${at(lo)}–${at(hi)} ${band.unit}`;
  return [
    { label: rng(band.low, band.low + step), note: 'entry of the band', value: rng(band.low, band.low + step) },
    { label: rng(band.low + step, band.low + 2 * step), note: 'mid band', value: rng(band.low + step, band.low + 2 * step) },
    { label: rng(band.low + 2 * step, band.high), note: 'top of the band', value: rng(band.low + 2 * step, band.high) },
    { label: 'Open to discussion', note: 'no figure in the letter', value: 'open to discussion' },
  ];
}

/* ── the bank ───────────────────────────────────────────────────────────── */

/*
 * `when` decides whether a question is asked at all, given what is already
 * known. `uses` says which commands need the answer, so a cover letter does
 * not interrogate somebody about their bullet metrics and a resume build does
 * not ask their salary expectation.
 */
const BANK = [
  /* — what they are aiming at, first: every other answer is judged against
       the target, and it is the thing the person came in thinking about — */
  {
    field: 'position', uses: ['build', 'raise', 'cover'], group: 'The target',
    question: 'Which position are you applying for?',
    groups: () => career.POSITION_GROUPS.map((g) => ({
      group: g.group, options: g.roles.map((r) => ({ label: r, value: r })),
    })),
    /* May already be known from the sentence that started this — "a resume
       for a data analyst" answers it before it is asked. */
    when: (d) => !d.position && !d.role,
  },
  {
    field: 'company', uses: ['cover'], group: 'The target',
    question: 'Which company is this for?',
    options: (d) => {
      const inMarket = d.country ? career.companiesHiringIn(d.country) : career.COMPANIES;
      return (inMarket.length ? inMarket : career.COMPANIES).slice(0, 40)
        .map((c) => ({ label: c.name, note: c.country, value: c.name }));
    },
    when: (d) => !d.company,
  },
  {
    field: 'level', uses: ['build', 'cover'], group: 'The target',
    question: 'At what level are you applying?',
    options: () => career.LEVELS.map((l) => ({ label: l.label, value: l.id })),
    when: (d) => !d.level,
  },
  {
    field: 'country', uses: ['build', 'cover'], group: 'The target',
    question: 'Which country is the role in?',
    options: (d) => {
      const home = d.company ? career.companyCountry(d.company) : null;
      const list = home ? [home, ...career.COUNTRIES.filter((c) => c !== home)] : career.COUNTRIES;
      return list.map((c) => ({ label: c, value: c }));
    },
    when: (d) => !d.country,
  },
  {
    field: 'workmode', uses: ['cover'], group: 'The target',
    question: 'Remote, on-site or hybrid?',
    options: () => WORK_MODE,
    when: (d) => !d.workmode,
  },

  /* — who they are — */
  {
    field: 'name', uses: ['build', 'raise', 'cover'], group: 'You',
    question: 'Full name, as it should appear at the top of the page?',
    when: (d, l) => !d.name && !(l && l.name),
  },
  {
    field: 'email', uses: ['build', 'raise', 'cover'], group: 'You',
    question: 'Email address? An ATS discards an application it cannot reply to.',
    when: (d, l) => !d.email && !(l && l.email),
  },
  {
    field: 'phone', uses: ['build', 'raise', 'cover'], group: 'You',
    question: 'Phone number, with country code?',
    when: (d, l) => !d.phone && !(l && l.phone),
  },
  {
    field: 'github', uses: ['build', 'raise', 'cover'], group: 'You',
    question: 'GitHub profile URL? Paste it, or skip if you do not have one.',
    when: (d) => !d.github,
  },
  {
    field: 'linkedin', uses: ['build', 'raise', 'cover'], group: 'You',
    question: 'LinkedIn profile URL?',
    when: (d) => !d.linkedin,
  },
  {
    field: 'location', uses: ['build', 'cover'], group: 'You',
    question: 'Which city are you based in?',
    options: (d) => {
      const cities = career.citiesIn(d.country || 'India');
      return cities.length ? cities.map((c) => ({ label: c, value: c })) : null;
    },
    when: (d) => !d.location,
  },
  {
    field: 'photo', uses: ['build'], group: 'You',
    question: 'Should the exported CV carry a photo? The parsed text cannot hold one either way — this decides the PDF only.',
    options: () => PHOTO,
    when: (d) => !d.photo,
  },

  /* — study — */
  {
    field: 'degree', uses: ['build'], group: 'Education',
    question: 'Which degree are you studying for, or have you finished?',
    options: () => DEGREES,
    /*
     * Each part is gated on its own answer, not on the education line they
     * build between them. Answering "B.Tech" filled that line, which made the
     * next two questions look answered — so the college and the years were
     * never asked and the page shipped an education section reading "B.Tech".
     */
    when: (d, l) => !d.degree && !(l && l.education && l.education.length),
  },
  {
    field: 'college', uses: ['build'], group: 'Education',
    question: 'Which college or university, and which course? For example "Ramaiah Institute of Technology, Computer Science".',
    when: (d, l) => !d.college && !(l && l.education && l.education.length),
  },
  {
    field: 'gradyear', uses: ['build'], group: 'Education',
    question: 'Which years — start and finish? "2022 – 2026" is the shape a parser reads.',
    when: (d, l) => !d.gradyear && !(l && l.education && l.education.length),
  },

  /* — internships — */
  {
    field: 'hasinternship', uses: ['build', 'raise'], group: 'Internships',
    question: 'Have you done an internship?',
    options: () => YES_NO('Yes, at least one', 'No, not yet'),
    when: (d, l) => !d.hasinternship && !(l && l.roles && l.roles.length),
  },
  {
    field: 'internship', uses: ['build', 'raise'], group: 'Internships',
    question: 'Name it: the company, your title, and what you actually built there. One or two lines, in your words.',
    when: (d) => d.hasinternship === 'yes' && !d.internship,
  },
  {
    field: 'internshipdates', uses: ['build', 'raise'], group: 'Internships',
    question: 'From which month to which month? "Jun 2025 – Dec 2025", or "Jan 2026 – Present".',
    when: (d) => d.hasinternship === 'yes' && !d.internshipdates,
  },
  {
    field: 'stipend', uses: ['build'], group: 'Internships',
    question: 'Was it paid? A paid internship is worth naming; an unpaid one is worth just as much on the page, and neither goes on it unless you say so.',
    options: () => [
      { label: 'Paid', note: 'stipend received', value: 'paid' },
      { label: 'Unpaid', value: 'unpaid' },
      { label: 'Leave it off the resume', value: 'omit' },
    ],
    when: (d) => d.hasinternship === 'yes' && !d.stipend,
  },

  /* — projects, skills, proof — */
  {
    field: 'hasprojects', uses: ['build', 'raise'], group: 'Projects',
    question: 'Have you built any projects?',
    options: () => YES_NO('Yes', 'No, not yet'),
    when: (d, l) => !d.hasprojects && !(l && l.projects && l.projects.length),
  },
  {
    field: 'projects', uses: ['build', 'raise'], group: 'Projects',
    question: 'Describe one: what it does, the tools you used, and who used it. A number — users, records, requests — is what makes it land.',
    when: (d) => d.hasprojects === 'yes' && !d.projects,
  },
  {
    field: 'skills', uses: ['build', 'raise'], group: 'Skills',
    question: 'Which tools and languages have you actually used? Only ones you could defend in an interview.',
    /* GitHub's languages are offered here as a starting point, never as the
       answer — the repos show what they have pushed, not what they can
       defend, and those are different lists. */
    options: (d) => (d.githubLanguages
      ? [{ label: d.githubLanguages, note: 'from your GitHub — edit if it is not the whole story', value: d.githubLanguages }]
      : null),
    when: (d, l) => !d.skills && !(l && l.statedSkills && l.statedSkills.length),
  },
  {
    field: 'hascerts', uses: ['build'], group: 'Proof',
    question: 'Any certifications or achievements worth listing?',
    options: () => YES_NO('Yes', 'None to list'),
    when: (d, l) => !d.hascerts && !(l && l.certifications && l.certifications.length),
  },
  {
    field: 'certifications', uses: ['build'], group: 'Proof',
    question: 'Name them — the issuer and the year. One per line.',
    when: (d) => d.hascerts === 'yes' && !d.certifications,
  },

  /* — terms, for a letter or an enquiry — */
  {
    field: 'salary', uses: ['cover'], group: 'Terms',
    question: 'What pay are you asking for? These are public ranges for your level and market, not offers — check the posting before you commit to a number.',
    options: (d) => salaryOptions(d),
    when: (d) => !d.salary,
  },
  {
    field: 'hours', uses: ['cover'], group: 'Terms',
    question: 'How many hours a week can you commit?',
    options: () => HOURS_PER_WEEK,
    when: (d) => !d.hours,
  },
  {
    field: 'window', uses: ['cover'], group: 'Terms',
    question: 'Which part of the day can you work?',
    options: () => WORKING_WINDOW,
    when: (d) => !d.window,
  },
  {
    field: 'availablefrom', uses: ['cover'], group: 'Terms',
    question: 'From which month are you available?',
    options: () => MONTHS.map((m) => ({ label: m, value: m })),
    when: (d) => !d.availablefrom,
  },
  {
    field: 'commitlength', uses: ['cover'], group: 'Terms',
    question: 'How long can you commit for?',
    options: () => COMMIT_LENGTH,
    when: (d) => !d.commitlength,
  },
  {
    field: 'notice', uses: ['cover'], group: 'Terms',
    question: 'How soon could you start?',
    options: () => NOTICE,
    when: (d) => !d.notice,
  },
];

/* ── driving it ─────────────────────────────────────────────────────────── */

const OTHER = { label: 'Something else — I will type it', value: '' };

/** The options for one question, resolved against what is already known. */
function optionsFor(entry, details) {
  if (!entry) return null;
  if (entry.groups) {
    const groups = entry.groups(details || {});
    return groups && groups.length ? { multi: false, groups, other: OTHER } : null;
  }
  if (entry.options) {
    const options = entry.options(details || {});
    return options && options.length ? { multi: false, options, other: OTHER } : null;
  }
  return null;
}

/**
 * The next question for a command, or null when the bank has nothing left to
 * ask. `declined` are the ones already skipped — a skip is an answer, and
 * re-asking it is the repeat-loop this whole design exists to prevent.
 */
function nextFor(command, details, ledger, declined) {
  const d = details || {};
  const skipped = declined || [];
  return BANK.find((q) =>
    q.uses.includes(command) &&
    !skipped.includes(q.field) &&
    q.when(d, ledger)) || null;
}

/** Everything still unanswered for a command — for a progress line. */
function remainingFor(command, details, ledger, declined) {
  const d = details || {};
  const skipped = declined || [];
  return BANK.filter((q) =>
    q.uses.includes(command) && !skipped.includes(q.field) && q.when(d, ledger));
}

module.exports = {
  BANK,
  nextFor,
  remainingFor,
  optionsFor,
  salaryOptions,
  MONTHS,
};
