'use strict';

/**
 * The post the company page publishes, and the rotation that decides which of
 * the fourteen domains gets each slot.
 *
 * A post goes out every two hours, round the clock, cycling through all
 * fourteen domains. Fourteen domains at two hours apiece is a twenty-eight
 * hour lap, so a lap does not fit inside a day and is not meant to — the point
 * is reach, and the rotation simply keeps going.
 *
 * Nobody types any of this. That is the point of the module: everything a
 * person used to decide in the moment is either fixed here or derived from the
 * clock.
 *
 * Four things about the copy are deliberate and easy to get wrong later.
 *
 * 1. **The post is about the projects.** Not the programme, not the perks, and
 *    not the pay. Every domain names three things an intern actually builds,
 *    because "you will get hands-on experience" is what every internship ad
 *    says and "you will write your own Redis" is not.
 *
 * 2. **The stipend is stated once, as a fact, and never argued about.** It is
 *    one line in the fact block: `Stipend: Unpaid`. There is no paragraph
 *    explaining why it is worth taking anyway, because a paragraph like that
 *    reads as an apology and tells a reader the company has nothing else to
 *    offer. It has plenty else to offer; the post spends its words on that
 *    instead. There is no rupee figure anywhere in this file on purpose — a
 *    number nobody approved, printed on a live job ad, is the single most
 *    expensive mistake this feature could make.
 *
 * 3. **One application link, not six.** The hand-written posts carried all six
 *    onboarding links at the bottom, so somebody applying for a Python
 *    internship had to work out which of six WhatsApp links was theirs. A post
 *    about one domain carries that domain's link and no others.
 *
 * 4. **No prior knowledge, said plainly.** The audience is freshers who think
 *    they are not ready. Telling them the bar is "willing to build" rather
 *    than "already knows" is the single most useful sentence in the post.
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
 *
 * `builds` is the part that does the work. Three things an intern in that
 * domain actually ships, written concretely enough that a reader can picture
 * the first one. They are deliberately ambitious — "your own Redis" rather
 * than "a caching exercise" — because that is the level the projects are set
 * at and understating it would lose the reader this post is for.
 */
const DOMAINS = [
  {
    slug: 'python', name: 'Python Development', role: 'Python Development Intern',
    track: 'tech', tag: '#Python',
    builds: [
      'Build a Django job board with employer logins, resume uploads and application tracking',
      'Write a scraper that checks sites on a cron and pushes new finds to a Telegram bot',
      'Package a command-line tool and publish it to PyPI so anyone can pip install it',
    ],
  },
  {
    slug: 'web', name: 'Web Development', role: 'Web Development Intern',
    track: 'tech', tag: '#WebDevelopment',
    builds: [
      'Turn a Figma design into a five-page responsive website and deploy it live',
      'Take a live website from a failing Lighthouse score to 90+ on speed and accessibility',
      'Build a drag-and-drop kanban board that survives a refresh with no backend',
    ],
  },
  {
    slug: 'business', name: 'Business Development', role: 'Business Development Intern',
    track: 'business', tag: '#BusinessDevelopment',
    builds: [
      'Build a 300-company prospect database in HubSpot, segmented by ideal customer profile',
      'Run a four-touch cold email sequence to 150 prospects and report the reply rates',
      'Map 40 referral partners, score them on fit, and pitch the top ten',
    ],
  },
  {
    slug: 'mern', name: 'MERN Stack Development', role: 'MERN Stack Development Intern',
    track: 'tech', tag: '#MERN',
    builds: [
      'A Socket.io chat app with rooms, online presence and message history in MongoDB',
      'An e-commerce store with a React cart, admin product CRUD and test-mode checkout',
      'A booking app with admin, provider and customer logins that blocks double-booked slots',
    ],
  },
  {
    slug: 'hr', name: 'HR', role: 'Human Resources Intern',
    track: 'hr', tag: '#HumanResources',
    builds: [
      'Source, screen and schedule for one live role, then report the hiring funnel',
      'Design a 30-60-90 day onboarding plan and run it with a real new-joiner intake',
      'Run an anonymous engagement pulse survey and turn it into one action per manager',
    ],
  },
  {
    slug: 'datasci', name: 'Data Science', role: 'Data Science Intern',
    track: 'tech', tag: '#DataScience',
    builds: [
      'Predict which customers churn, and show the three factors driving each prediction',
      "Forecast next quarter's weekly sales, and backtest it against a naive baseline",
      'Read out an A/B test: lift, confidence interval, and a ship or no-ship call',
    ],
  },
  {
    slug: 'java', name: 'Java Development', role: 'Java Development Intern',
    track: 'tech', tag: '#Java',
    builds: [
      'A Spring Boot REST API for library issue, return and overdue fines, on MySQL with JPA',
      'A Spring Security login service issuing JWTs, with ADMIN, STAFF and MEMBER roles',
      'A Spring Batch job that loads nightly CSV files into MySQL and skips malformed rows',
    ],
  },
  {
    slug: 'space', name: 'Space', role: 'Space Technology Intern',
    track: 'space', tag: '#SpaceTech',
    builds: [
      'A pass planner that turns live TLE data into antenna pointing and contact windows',
      'A decoder that turns recorded satellite audio into weather images and telemetry frames',
      'A box-least-squares transit search that finds an exoplanet in TESS light curves',
    ],
  },
  {
    slug: 'cyber', name: 'Cyber Security', role: 'Cyber Security Intern',
    track: 'tech', tag: '#CyberSecurity',
    builds: [
      'Run a Wazuh SIEM lab, simulate SSH brute force, and write the rules that catch it',
      'Pen-test OWASP Juice Shop and write it up as a client report with CVSS ratings',
      'Triage phishing emails: headers, SPF and DKIM, IOC list, and an analyst verdict',
    ],
  },
  {
    slug: 'venture', name: 'Venture Capital', role: 'Venture Capital Intern',
    track: 'vc', tag: '#VentureCapital',
    builds: [
      'Map 50 startups in one sector, then screen them down to a ten-company pipeline',
      'Write an investment memo on a real seed startup that ends in invest or pass',
      'Build a cap table that runs a SAFE, a Series A and three exit waterfalls',
    ],
  },
  {
    slug: 'flutter', name: 'Flutter Development', role: 'Flutter Development Intern',
    track: 'tech', tag: '#Flutter',
    builds: [
      'An offline-first Flutter expense tracker that syncs to Firestore on reconnect',
      'A Flutter attendance app with geofenced GPS check-in and a front-camera selfie',
      'A Flutter app of your own, signed and shipped to Google Play closed testing',
    ],
  },
  {
    slug: 'softeng', name: 'Software Engineering', role: 'Software Engineering Intern',
    track: 'tech', tag: '#SoftwareEngineering',
    builds: [
      'A Redis clone from scratch: TCP server, RESP protocol, TTL expiry, LRU eviction',
      "A rebuild of Git's object model: init, add, commit and log on real SHA-1 objects",
      'An interpreter for a small language: scanner, parser, AST and evaluator',
    ],
  },
  {
    slug: 'devops', name: 'DevOps with AWS', role: 'DevOps (AWS) Intern',
    track: 'tech', tag: '#DevOps',
    builds: [
      'A GitHub Actions pipeline that pushes a Docker image to ECR and deploys it on ECS',
      'A two-AZ VPC, load balancer and auto scaling group built in Terraform with remote state',
      'A Prometheus and Grafana stack on EC2 with Alertmanager alerts firing into Slack',
    ],
  },
  {
    slug: 'vibe', name: 'Vibe Coding', role: 'Vibe Coding Intern',
    track: 'tech', tag: '#VibeCoding',
    builds: [
      'A RAG assistant that answers from your own PDFs and cites the paragraph it used',
      'A live SaaS MVP shipped with an AI coding agent, then reviewed line by line',
      'A prompt test suite that scores answers and blocks a bad prompt from shipping',
    ],
  },
];

/* Facts that are the same for every domain. They are constants rather than
   arguments because there is nobody to supply arguments — an unattended job
   that took a stipend parameter would take whatever was left in the config the
   last time somebody edited it. */
/*
 * These are the facts printed on the poster the post carries, and they are
 * written here once so the two cannot disagree. A post that says six months
 * above an image that says three is the exact failure the poster kit exists to
 * prevent, and it is not caught by looking at either one on its own —
 * tests/services/v2/linkedin/domainPost.test.js reads the poster build script
 * and asserts they still match.
 */
const PROGRAMME = {
  org: 'The Entrepreneurship Network (TEN)',
  batch: 'October 2026',
  mode: 'Online',
  duration: '3 Months',
  stipend: 'Unpaid',
  eligibility: "Any Bachelor's | Any Master's | Any Stream",
};

/* How far apart two posts are. Twelve slots a day against fourteen domains
   means a lap takes twenty-eight hours, so the same domain never lands at the
   same hour twice in a row — which is what keeps a feed on a 24-hour cycle
   from looking like a stuck clock. */
const SLOT_HOURS = 2;

/* The instant the rotation counts from. Any instant would do; this one is
   fixed so that the domain a given slot gets does not depend on when the
   process last restarted. */
const EPOCH_HOUR = Date.UTC(2026, 0, 3) / 3600000;

const IST_MS = 330 * 60 * 1000;

/** The IST wall-clock fields an instant falls on. */
function istDay(date) {
  const shifted = new Date(date.getTime() + IST_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    dow: shifted.getUTCDay(),
    days: Math.floor(shifted.getTime() / 86400000),
    hours: Math.floor(shifted.getTime() / 3600000),
  };
}

/** 'YYYY-MM-DD' for the IST calendar day. */
function istDateKey(date) {
  const p = istDay(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
}

/**
 * 'YYYY-MM-DDTHH' for the two-hour bucket this instant falls in, IST.
 *
 * This is the slot key, and it is what makes the whole thing idempotent: the
 * tick runs every few minutes on every worker, and they all compute the same
 * string for the same two hours. The unique index on it does the rest.
 */
function slotKey(date) {
  const p = istDay(date);
  const pad = (n) => String(n).padStart(2, '0');
  const hour = Math.floor(p.h / SLOT_HOURS) * SLOT_HOURS;
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(hour)}`;
}

/**
 * Which slot in the rotation this instant is, counting from the epoch.
 *
 * Derived from the clock rather than stored, so a database restore, a fresh
 * deploy or a second worker all land on the same domain for the same slot.
 */
function slotIndex(date) {
  const p = istDay(date);
  return Math.floor((p.hours - EPOCH_HOUR) / SLOT_HOURS);
}

/** The domain whose turn it is at that instant. */
function pick(date) {
  const i = slotIndex(date);
  const n = DOMAINS.length;
  return DOMAINS[((i % n) + n) % n];
}

/** The start of the two-hour bucket this instant falls in, as a Date. */
function slotStart(date) {
  const p = istDay(date);
  const hour = Math.floor(p.h / SLOT_HOURS) * SLOT_HOURS;
  return new Date(Date.UTC(p.y, p.m, p.d, hour, 0, 0, 0) - IST_MS);
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
 *
 * Long on purpose, and the length is all projects and specifics. A reader who
 * stops after the first screen has still seen the role, the batch and three
 * things they would build.
 */
function body(domain) {
  const dom = typeof domain === 'string' ? byName(domain) : domain;
  if (!dom) throw new Error(`domainPost: no such domain: ${domain}`);

  const lines = [
    `🚀 WE ARE #HIRING #INTERNS | ${PROGRAMME.org}`,
    '',
    `Applications are open for the ${PROGRAMME.batch} batch — ${dom.role}s.`,
    '',
    'Here is what this internship actually is: you build things. From your first week you are on a real, industry-level project. There is no course to finish first, no reading list, no three weeks of training before you are allowed to touch anything that matters. The project is the training, and a coordinator reviews your work every single week.',
    '',
    `🛠️ What ${dom.name} interns here build:`,
    ...dom.builds.map((b) => `• ${b}`),
    '',
    'Not tutorials. Not clones of a video you watched. Real systems, built by you, that you can open up and explain line by line in an interview.',
    '',
    `📌 Position: ${dom.role}`,
    `🧭 Domain: ${dom.name}`,
    `📅 Batch: ${PROGRAMME.batch}`,
    `💻 Mode: ${PROGRAMME.mode}`,
    `🕒 Duration: ${PROGRAMME.duration}`,
    `💰 Stipend: ${PROGRAMME.stipend}`,
    `🎓 Eligibility: ${PROGRAMME.eligibility}`,
    '',
    '🙌 No prior knowledge needed.',
    'If you have never built anything before, you are exactly who this is for. Nobody here is expected to arrive already knowing it. You are expected to build it — and that is a much easier bar to clear than the one you are imagining.',
    '',
    '🎯 You finish with:',
    '• Industry-level projects you can walk an interviewer through',
    '• A portfolio that shows work, not certificates of attendance',
    '• Certificate of Internship',
    '• Letter of Recommendation',
    '• The experience of shipping something, which is the part nobody can teach you in a classroom',
    '',
    'This is what makes people interview-ready and job-ready: not what they studied, but what they have built and can defend.',
    '',
    `🔗 Apply for ${dom.name}: ${applyUrl(dom)}`,
    '',
    /* Five hashtags across the whole post, and two of them are already up in
       the headline. Past about five LinkedIn stops helping and the post starts
       reading as spam, so the three down here are the three not already said
       above: the domain, who it is for, and the brand. */
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
    `${PROGRAMME.batch} batch`,
    PROGRAMME.mode,
    PROGRAMME.duration,
    `stipend ${PROGRAMME.stipend}`,
    'no prior skill needed',
  ].join(', ') + '.';
}

module.exports = {
  APPLY,
  DOMAINS,
  PROGRAMME,
  SLOT_HOURS,
  altText,
  applyUrl,
  body,
  byName,
  istDateKey,
  istDay,
  pick,
  posterFile,
  slotIndex,
  slotKey,
  slotStart,
};
