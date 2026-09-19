'use strict';

/**
 * The fourteen internship openings, as posters and as text.
 *
 * This is the whole of the LinkedIn feature now. Nothing here talks to
 * LinkedIn, nothing runs on a timer, and nothing publishes. It is a list of
 * fourteen domains, each with a poster on disk and the post that goes with it,
 * and the dashboard section reads it so a person can copy the words, download
 * the picture, and post it from their own account.
 *
 * That is deliberate rather than a reduction. An earlier version of this
 * feature posted to the company page by itself, on a cron, and the risk it
 * carried was not a bug that could be fixed: automated posting is what gets a
 * company page flagged, and the page is the hiring funnel. Fourteen people
 * posting from real profiles reaches further than one page does anyway, and
 * costs nothing if it goes wrong.
 *
 * Everything below is a pure function of the constants in this file. No
 * network, no database, no key, no clock. The one exception is `posters()`,
 * which asks the filesystem which plates exist — see the note there.
 */

const fs = require('fs');
const path = require('path');

const POSTER_DIR = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'linkedin-posters');
const POSTER_URL = '/assets/linkedin-posters';

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
 * The fourteen domains the site advertises. Fourteen, not the nineteen in
 * config/domains.js: the public page says "14 DOMAINS — ONE ECOSYSTEM" and
 * ships fourteen icons, and a hiring post for a domain the site does not
 * advertise points at a door that is not there.
 *
 * `slug` is both the poster filename and the stable identity, so renaming a
 * domain's display name does not orphan its picture.
 *
 * `builds` is the part that does the work. Three things an intern in that
 * domain actually ships, written concretely enough that a reader can picture
 * the first one. They are deliberately ambitious — "a Redis clone from
 * scratch" rather than "a caching exercise" — because that is the level the
 * projects are set at and understating it would lose the reader this post is
 * for. They are also specific to the domain and true of it: the Redis clone
 * belongs to Software Engineering because that is who builds it, and putting
 * it under Python instead would be a nicer sentence and a false one.
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

/*
 * Facts that are the same for every domain, written here once so the poster
 * and the post cannot disagree. A post that says six months above an image
 * that says three is a failure you cannot catch by looking at either one
 * alone.
 *
 * `stipend` is in this object and is deliberately NOT printed in the post —
 * see `text()`. It stays here because the poster carries it and the alt text
 * has to describe the poster truthfully.
 */
const PROGRAMME = {
  org: 'The Entrepreneurship Network (TEN)',
  batch: 'October 2026',
  mode: 'Online',
  duration: '3 Months',
  stipend: 'Unpaid',
  eligibility: "Any Bachelor's | Any Master's | Any Stream",
};

/*
 * Two plates per domain, twenty-eight in all, identical in layout and
 * differing only in the artwork on the right.
 *
 *   domain  <slug>.jpg       the domain's own mark — the Python logo, and so on
 *   ten     <slug>-ten.jpg   the TEN building with the gold-hands mark
 *
 * The TEN set does not exist yet. Rather than hard-code fourteen filenames and
 * ship fourteen broken images the day somebody opens the section, `posters()`
 * asks the disk what is actually there. Dropping the second set into
 * public/assets/linkedin-posters/ is the entire deployment step; no code
 * changes and nothing needs redeploying beyond the files themselves.
 */
const VARIANTS = [
  { variant: 'domain', suffix: '' },
  { variant: 'ten', suffix: '-ten' },
];

function byName(name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  return DOMAINS.find((x) => x.name.toLowerCase() === want || x.slug === want) || null;
}

function resolve(domain) {
  return typeof domain === 'string' ? byName(domain) : domain;
}

function applyUrl(domain) {
  const dom = resolve(domain);
  return APPLY[dom && dom.track] || APPLY.tech;
}

/**
 * The plates that exist for this domain, in a fixed order.
 *
 * Read from disk on every call rather than cached at require time: the second
 * poster set arrives by being copied into the assets directory, and a cache
 * would mean the section kept showing one plate per domain until somebody
 * remembered to restart the process. Fourteen `existsSync` calls per request
 * is nothing next to being wrong for a week.
 */
function posters(domain) {
  const dom = resolve(domain);
  if (!dom) return [];
  return VARIANTS
    .map((v) => ({ variant: v.variant, file: `${dom.slug}${v.suffix}.jpg` }))
    .filter((p) => {
      try {
        return fs.statSync(path.join(POSTER_DIR, p.file)).size > 0;
      } catch (e) {
        return false;
      }
    })
    .map((p) => ({ variant: p.variant, file: p.file, url: `${POSTER_URL}/${p.file}` }));
}

/**
 * The post for one domain — the words a person copies and pastes.
 *
 * Plain text with emoji markers, because that is what a LinkedIn share is;
 * there is no rich text to use. Long on purpose, and the length is all
 * projects and specifics. A reader who stops after the first screen has still
 * seen the role, the batch and three things they would build.
 *
 * **The stipend is not mentioned.** The poster states it plainly in its own
 * field, so the fact is published and nobody is misled — but the post does not
 * raise it and never argues that the internship is worth doing despite it.
 * Naming an absence and then defending it is what makes a reader decide the
 * absence is the story; a post that spends two lines explaining why unpaid is
 * fine reads as a company with nothing else to offer. This one has something
 * else to offer — six hundred-odd interns came through the last batch — so the
 * words go there instead.
 */
function text(domain) {
  const dom = resolve(domain);
  if (!dom) throw new Error(`openings: no such domain: ${domain}`);

  return [
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
  ].join('\n');
}

/** Alt text, derived from the same facts as the poster so the two cannot drift. */
function altText(domain) {
  const dom = resolve(domain);
  if (!dom) return '';
  return `${[
    `Hiring poster: ${PROGRAMME.org} is hiring a ${dom.role}`,
    `${PROGRAMME.batch} batch`,
    PROGRAMME.mode,
    PROGRAMME.duration,
    `stipend ${PROGRAMME.stipend}`,
    'no prior skill needed',
  ].join(', ')}.`;
}

/** Everything the section needs, in one shape, in rotation order. */
function list() {
  return DOMAINS.map((dom) => ({
    slug: dom.slug,
    name: dom.name,
    role: dom.role,
    tag: dom.tag,
    text: text(dom),
    applyUrl: applyUrl(dom),
    alt: altText(dom),
    posters: posters(dom).map((p) => ({ variant: p.variant, url: p.url })),
  }));
}

module.exports = { APPLY, DOMAINS, PROGRAMME, altText, applyUrl, byName, list, posters, text };
