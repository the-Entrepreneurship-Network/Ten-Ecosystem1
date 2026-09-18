'use strict';

/**
 * The post the company page publishes every Saturday and Sunday, and the
 * rotation that decides which of the fourteen domains gets each slot.
 *
 * Nobody types any of this. That is the point of the module: the text below is
 * the one the team already publishes by hand, written down once, so that an
 * unattended job can produce it without a person in front of it. Everything a
 * person used to decide in the moment is either fixed here or derived from the
 * date.
 *
 * Three things about the copy are deliberate and easy to get wrong later.
 *
 * 1. **One application link, not six.** The hand-written posts carried all six
 *    onboarding links at the bottom, so somebody applying for a Python
 *    internship had to work out which of six WhatsApp links was theirs. A post
 *    about one domain carries that domain's link and no others.
 *
 * 2. **The stipend is Unpaid, and it says so twice.** Once in the fact list
 *    and once in prose, because burying it is how a fresher finds out after
 *    they have already started. There is no rupee figure anywhere in this file
 *    on purpose — a number nobody approved, printed on a live job ad, is the
 *    single most expensive mistake this feature could make.
 *
 * 3. **The pitch is the projects, not the pay.** TEN has no course-then-
 *    training-then-project ladder; interns are on industry-level work from the
 *    first week. That is the honest reason to take an unpaid internship here,
 *    so it is the argument the post actually makes rather than a line of
 *    filler under a list of perks.
 */

/*
 * Onboarding links, as published on the company page.
 *
 * Six links for fourteen domains, because onboarding is organised by track
 * rather than by domain — every engineering intern goes through the same Tech
 * door. `finance` has no domain pointing at it today; it is kept because the
 * link is live and a Finance domain appearing later should find its link here
 * rather than silently fall back to Tech.
 */
const APPLY = {
  tech: 'https://lnkd.in/gK5Cna3c',
  business: 'https://lnkd.in/gFUCCzxf',
  hr: 'https://lnkd.in/gZTZ9_Gx',
  space: 'https://lnkd.in/g7fnzzbc',
  vc: 'https://lnkd.in/ghAA9efW',
  finance: 'https://lnkd.in/gPnn379B',
};

/*
 * The fourteen domains the site advertises, in the order the rotation walks
 * them. Fourteen, not the nineteen in config/domains.js: the public page says
 * "14 DOMAINS — ONE ECOSYSTEM" and ships fourteen icons, and a hiring post for
 * a domain the site does not advertise points at a door that is not there.
 *
 * `slug` is both the poster filename and the rotation's stable identity, so
 * renaming a domain's display name does not shuffle the rotation.
 * `tag` is the domain's own hashtag, which is the only part of the hashtag
 * block that changes between posts.
 */
const DOMAINS = [
  { slug: 'python',   name: 'Python Development',     role: 'Python Development Intern',      track: 'tech',     tag: '#Python' },
  { slug: 'web',      name: 'Web Development',        role: 'Web Development Intern',         track: 'tech',     tag: '#WebDevelopment' },
  { slug: 'business', name: 'Business Development',   role: 'Business Development Intern',    track: 'business', tag: '#BusinessDevelopment' },
  { slug: 'mern',     name: 'MERN Stack Development', role: 'MERN Stack Development Intern',  track: 'tech',     tag: '#MERN' },
  { slug: 'hr',       name: 'HR',                     role: 'Human Resources Intern',         track: 'hr',       tag: '#HumanResources' },
  { slug: 'datasci',  name: 'Data Science',           role: 'Data Science Intern',            track: 'tech',     tag: '#DataScience' },
  { slug: 'java',     name: 'Java Development',       role: 'Java Development Intern',        track: 'tech',     tag: '#Java' },
  { slug: 'space',    name: 'Space',                  role: 'Space Technology Intern',        track: 'space',    tag: '#SpaceTech' },
  { slug: 'cyber',    name: 'Cyber Security',         role: 'Cyber Security Intern',          track: 'tech',     tag: '#CyberSecurity' },
  { slug: 'venture',  name: 'Venture Capital',        role: 'Venture Capital Intern',         track: 'vc',       tag: '#VentureCapital' },
  { slug: 'flutter',  name: 'Flutter Development',    role: 'Flutter Development Intern',     track: 'tech',     tag: '#Flutter' },
  { slug: 'softeng',  name: 'Software Engineering',   role: 'Software Engineering Intern',    track: 'tech',     tag: '#SoftwareEngineering' },
  { slug: 'devops',   name: 'DevOps with AWS',        role: 'DevOps (AWS) Intern',            track: 'tech',     tag: '#DevOps' },
  { slug: 'vibe',     name: 'Vibe Coding',            role: 'Vibe Coding Intern',             track: 'tech',     tag: '#VibeCoding' },
];

/* Facts that are the same for every domain. They are constants rather than
   arguments because there is nobody to supply arguments — an unattended job
   that took a stipend parameter would take whatever was left in the config the
   last time somebody edited it. */
const PROGRAMME = {
  org: 'The Entrepreneurship Network (TEN)',
  mode: 'Remote',
  duration: '2–6 Months (Flexible)',
  stipend: 'Unpaid',
  eligibility: "Any Bachelor's | Any Master's | Freshers Welcome",
};

/* The Saturday the rotation counts from. Any Saturday would do; this one is
   fixed so that the domain a given weekend gets does not depend on when the
   process last restarted. 2026-01-03 is a Saturday. */
const EPOCH_DAY = Date.UTC(2026, 0, 3) / 86400000;

const IST_MS = 330 * 60 * 1000;

/** The IST calendar day an instant falls on, as {y, m, d, dow, days}. */
function istDay(date) {
  const shifted = new Date(date.getTime() + IST_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    dow: shifted.getUTCDay(),
    days: Math.floor(shifted.getTime() / 86400000),
  };
}

/** 'YYYY-MM-DD' for the IST calendar day, which is what a slot key is built from. */
function istDateKey(date) {
  const p = istDay(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
}

function isWeekend(date) {
  const dow = istDay(date).dow;
  return dow === 6 || dow === 0;
}

/**
 * Which slot in the rotation this weekend day is — Saturday then Sunday,
 * counting forward from the epoch.
 *
 * Derived from the date rather than stored, so a database restore, a fresh
 * deploy or a second worker all land on the same domain for the same day. Two
 * slots a week against fourteen domains means a domain comes round every seven
 * weeks, which is far enough apart that the page does not look like it is
 * repeating itself.
 */
function slotIndex(date) {
  const p = istDay(date);
  const offset = p.days - EPOCH_DAY;
  /* Floor division that stays correct for dates before the epoch, where the
     remainder of % would come back negative. */
  const week = Math.floor(offset / 7);
  const within = offset - week * 7;
  return week * 2 + (within === 0 ? 0 : 1);
}

/** The domain whose turn it is on that date. */
function pick(date) {
  const i = slotIndex(date);
  const n = DOMAINS.length;
  return DOMAINS[((i % n) + n) % n];
}

function byName(name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  return DOMAINS.find((x) => x.name.toLowerCase() === want || x.slug === want) || null;
}

function applyUrl(domain) {
  return APPLY[domain && domain.track] || APPLY.tech;
}

/**
 * The post body for one domain.
 *
 * Plain text with emoji markers, because that is what the page already looks
 * like and LinkedIn has no rich text in a share. The markers are the only
 * emoji in the post; contentGuard counts a line-leading marker separately from
 * decoration for exactly this reason.
 */
function body(domain) {
  const dom = typeof domain === 'string' ? byName(domain) : domain;
  if (!dom) throw new Error(`weekendPost: no such domain: ${domain}`);

  const lines = [
    `🚀 WE ARE #HIRING #INTERNS | ${PROGRAMME.org}`,
    '',
    `We are looking for ${dom.role}s to join ${PROGRAMME.org}.`,
    '',
    /* One paragraph, one line. LinkedIn renders a newline as a newline, so
       prose wrapped at 78 characters here comes out ragged on a phone — the
       hard breaks below are all between things that really are separate
       lines. */
    'No course to sit through first, no training block before you are allowed to touch anything real. From week one you are on an industry-level project, and the project is the training: you learn here by building and shipping, with a coordinator reviewing your work every week.',
    '',
    `📌 Position: ${dom.role}`,
    `🧭 Domain: ${dom.name}`,
    `💻 Mode: ${PROGRAMME.mode}`,
    `🕒 Duration: ${PROGRAMME.duration}`,
    `💰 Stipend: ${PROGRAMME.stipend}`,
    `🎓 Eligibility: ${PROGRAMME.eligibility}`,
    '',
    '🎁 What you walk away with:',
    'Certificate of Internship',
    'Letter of Recommendation',
    'Real industry-level project work, not shadowing',
    'A portfolio you can walk an interviewer through',
    '',
    'To be straight with you: this internship is unpaid. What it pays in is the hands-on experience of building at industry level, work that is reviewed every week, and the proof that you did it.',
    '',
    `🔗 Apply for ${dom.name} here: ${applyUrl(dom)}`,
    '',
    /* Five hashtags in the whole post, and two of them are already up in the
       headline. The guard's rule is that LinkedIn stops helping past about
       five and the post starts reading as spam, so the three down here are
       the three that are not already said above: the domain, who it is for,
       and the brand. */
    `${dom.tag} #Freshers #TheEntrepreneurshipNetwork`,
  ];

  return lines.join('\n');
}

/** What the poster for this domain is filed under in public/assets/. */
function posterFile(domain) {
  const dom = typeof domain === 'string' ? byName(domain) : domain;
  return dom ? `${dom.slug}.jpg` : '';
}

/** Alt text, derived from the same facts as the body so the two cannot drift. */
function altText(domain) {
  const dom = typeof domain === 'string' ? byName(domain) : domain;
  if (!dom) return '';
  return [
    `Hiring poster: ${PROGRAMME.org} is hiring a ${dom.role}`,
    PROGRAMME.mode,
    PROGRAMME.duration,
    `stipend ${PROGRAMME.stipend}`,
    'freshers welcome',
  ].join(', ') + '.';
}

module.exports = {
  APPLY,
  DOMAINS,
  PROGRAMME,
  altText,
  applyUrl,
  body,
  byName,
  isWeekend,
  istDateKey,
  istDay,
  pick,
  posterFile,
  slotIndex,
};
