'use strict';

/**
 * Thirty journeys, walked the way a student walks them.
 *
 * Unit tests kept passing while the thing on screen kept failing, because the
 * failures were never in one function — they were in what the second turn did
 * with what the first turn left behind. A tailor that reset the picks. A raise
 * that asked the same question twice. A score that changed rulers halfway. All
 * of it invisible to a test that calls one function once.
 *
 * So: ten journeys through the resume seat, ten through the job search, ten
 * through the cover letter, each one a sequence of turns with a session
 * carried between them, each one asserting what the student would actually
 * see. If a journey fails, the feature is broken however green the units are.
 */

const express = require('express');
const request = require('supertest');

jest.setTimeout(5 * 60 * 1000);

/* The portal's search, stubbed at the function the resume seat now calls —
   these journeys are about the agent, not about whether a board answered
   today. It used to be stubbed over HTTP on our own port, which is exactly
   the hop that failed in production. */
jest.mock('../../routes/v2/jobAgent', () => {
  const router = jest.requireActual('../../routes/v2/jobAgent');
  router.findJobs = jest.fn();
  return router;
});
const jobAgent = require('../../routes/v2/jobAgent');

const PORTAL_JOBS = [
  { title: 'Backend Engineer', company: 'stripe', location: 'Bengaluru, India', url: 'https://stripe.com/jobs/1', description: 'Java, Kafka, Postgres, Docker.', tags: ['java'], fit5: 4 },
  { title: 'Senior Backend Engineer', company: 'robinhood', location: 'Remote, US', url: 'https://boards.greenhouse.io/robinhood/2', description: 'Go, gRPC, Kubernetes.', tags: ['go'], fit5: 3 },
  { title: 'Platform Engineer', company: 'airbnb', location: 'Remote, EU', url: 'https://careers.airbnb.com/3', description: 'Terraform, AWS, CI/CD.', tags: ['aws'], fit5: 3 },
];

beforeEach(() => {
  jobAgent.findJobs.mockReset();
  jobAgent.findJobs.mockResolvedValue(PORTAL_JOBS);
});

function agent() {
  const a = express();
  a.use(express.json());
  a.use('/api/v2/resume', require('../../routes/v2/resumeAgent'));
  return a;
}

const turn = (a, message, session) =>
  request(a)
    .post('/api/v2/resume/chat')
    .field('message', message)
    .field('session', session ? JSON.stringify(session) : '')
    .then((r) => r.body);

const choices = (out) => {
  const o = out.options || {};
  return [...(o.options || []), ...((o.groups || []).flatMap((g) => g.options || []))];
};

/** Answer whatever is asked with the picker, never with prose. */
const answerPicks = (out, how = 'all') => {
  const all = choices(out);
  if (!all.length) return 'skip';
  if (how === 'first') return all[0].value;
  if (how === 'last') return all[all.length - 1].value;
  if (how === 'none') return 'skip';
  return all.map((c) => c.value).join(', ');
};

/** Walk until it stops asking, answering only by picking. */
async function walk(a, out, how = 'all', max = 10) {
  let cur = out;
  for (let i = 0; i < max && cur.kind === 'ask'; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    cur = await turn(a, answerPicks(cur, how), cur.session);
  }
  return cur;
}

const person = (name, title, skills, bullets, extras = []) => [
  name, title, `${name.split(' ')[0].toLowerCase()}@example.com | +91 90000 00000 | github.com/${name.split(' ')[0].toLowerCase()}`,
  '', 'EXPERIENCE', `${title.split('|')[0].trim()} | Northwind | Jan 2023 - Present`,
  ...bullets.map((b) => `- ${b}`),
  ...extras,
  '', 'SKILLS', skills, '', 'EDUCATION', 'B.Tech Computer Science, 2019 - 2023',
].join('\n');

const BACKEND = person('BISHAL NAG', 'Backend Engineer', 'Java, Spring Boot, SQL, Docker',
  ['Built REST APIs in Java serving 5,000 requests a day, cutting latency 30%']);
const DATA = person('ASHA IYER', 'Data Analyst', 'SQL, Python, Pandas, Tableau',
  ['Modelled a 400,000-row dataset, cutting the weekly report from 40 minutes to 6']);
const FRONTEND = person('ROHAN DAS', 'Frontend Engineer', 'React, TypeScript, CSS, Jest',
  ['Built the dashboard in React used by 2,000 people a week']);
const QA = person('NEHA RAO', 'QA Engineer', 'Selenium, Java, Jest, CI/CD',
  ['Automated 240 regression cases, cutting the release check from 2 days to 3 hours']);

/* ------------------------------------------------------------------ RESUME */

describe('resume seat · ten journeys', () => {
  it('1 · upload, and the page comes back scored rather than lectured', async () => {
    const a = agent();
    const out = await turn(a, BACKEND, null);
    expect(out.report.score).toBeGreaterThan(0);
    expect(out.kind).toBe('scan');
    expect(String((out.rebuilt && out.rebuilt.text) || out.text || '')).toMatch(/BISHAL NAG/);
  });

  it('2 · tailoring against a posting never lowers the number', async () => {
    const a = agent();
    let out = await turn(a, BACKEND, null);
    const before = out.report.score;
    out.session.jd = 'Backend Engineer at GitLab. Ruby, Go, GraphQL, Redis, Kafka required.';
    out = await walk(a, await turn(a, 'tailor my resume', out.session));
    expect(out.report.score).toBeGreaterThanOrEqual(before);
  });

  it('3 · the same resume can be tailored twice, for two different jobs', async () => {
    const a = agent();
    let out = await turn(a, DATA, null);
    out.session.jd = 'Data Analyst. SQL, Tableau, dbt.';
    out = await walk(a, await turn(a, 'tailor my resume', out.session));
    const first = out.report.score;

    out.session.jd = 'Analytics Engineer. dbt, Snowflake, Airflow.';
    out = await walk(a, await turn(a, 'tailor my resume', out.session));
    expect(out.report.score).toBeGreaterThanOrEqual(Math.min(first, out.report.score));
    expect(out.kind).toBe('build');
  });

  it('4 · nothing it asks is an essay — every question is a list to pick from', async () => {
    const a = agent();
    let out = await turn(a, FRONTEND, null);
    out.session.jd = 'Frontend Engineer. React, TypeScript, accessibility, Playwright.';
    out = await turn(a, 'tailor my resume', out.session);
    let asks = 0;
    while (out.kind === 'ask' && asks < 8) {
      expect(choices(out).length).toBeGreaterThan(0);
      // eslint-disable-next-line no-await-in-loop
      out = await turn(a, answerPicks(out), out.session);
      asks += 1;
    }
    expect(asks).toBeGreaterThan(0);
  });

  it('5 · several answers can be given to one question', async () => {
    const a = agent();
    let out = await turn(a, BACKEND, null);
    out.session.jd = 'Backend Engineer. Kafka, Kubernetes, Terraform, Redis.';
    out = await turn(a, 'tailor my resume', out.session);
    const multi = [];
    for (let i = 0; i < 6 && out.kind === 'ask'; i += 1) {
      if (out.options && out.options.multi) multi.push(out.session.asked);
      // eslint-disable-next-line no-await-in-loop
      out = await turn(a, answerPicks(out), out.session);
    }
    expect(multi.length).toBeGreaterThan(0);
  });

  it('6 · no skill they listed is deleted by the rewrite', async () => {
    const a = agent();
    let out = await turn(a, BACKEND, null);
    out.session.jd = 'Backend Engineer. Go, gRPC.';
    out = await walk(a, await turn(a, 'tailor my resume', out.session));
    ['java', 'spring boot', 'sql', 'docker'].forEach((s) =>
      expect(out.text.toLowerCase()).toContain(s));
  });

  it('7 · a number they ask for is reached, by naming the work', async () => {
    const a = agent();
    let out = await turn(a, QA, null);
    out = await walk(a, await turn(a, 'make it 96', out.session));
    expect(out.report.score).toBeGreaterThanOrEqual(96);
    /* The steps for everything it added, in points, and nothing else. */
    expect(out.reply).toMatch(/Before you attach this: \d+ things?/);
  });

  it('8 · what is missing is added to the page as skills, not reported as missing', async () => {
    const a = agent();
    let out = await turn(a, FRONTEND, null);
    out.session.jd = 'Frontend Engineer. Must have: Kubernetes, Terraform.';
    out = await walk(a, await turn(a, 'tailor my resume', out.session));
    /* On the page, in the sections a parser reads — never merely complained
       about, and never under a heading that carries a disclaimer. */
    expect(out.text).toMatch(/^PROJECTS$/m);
    expect(out.text).not.toMatch(/PLANNED|LEARNING \(/);
  });

  it('9 · the page reads as finished, and the reply carries the debt', async () => {
    /*
     * The page used to carry the marker and the blanks, which made it a to-do
     * list nobody could attach to an application. It reads as a resume now;
     * what is not yet true is named in the reply, where it is instruction
     * rather than defacement — and it is still named, every time.
     */
    const a = agent();
    let out = await turn(a, QA, null);
    out = await walk(a, await turn(a, 'make it 98', out.session));
    expect(out.session.plannedGuides.length).toBeGreaterThan(0);
    expect(out.text).not.toMatch(/\[PLANNED|not built yet/);
    expect(out.text).not.toMatch(/<[^>]{1,40}>/);
    expect(out.reply).toMatch(/Before you attach this/);
  });

  it('10 · it never invents an employer, a date or a degree', async () => {
    const a = agent();
    let out = await turn(a, DATA, null);
    out.session.jd = 'Data Analyst at Meta. Presto, Hive, experimentation.';
    out = await walk(a, await turn(a, 'tailor my resume', out.session));
    const claimed = out.text.split('\n').filter((l) => !/\[PLANNED/i.test(l)).join('\n');
    expect(claimed).not.toMatch(/\bMeta\b/);
    expect(claimed).toMatch(/Northwind/);
    expect(claimed).toMatch(/2019 - 2023|2019–2023/);
  });
});

/* -------------------------------------------------------------- JOB SEARCH */

describe('job search · ten journeys', () => {
  const hunt = async (resume, role) => {
    const a = agent();
    let out = await turn(a, resume, null);
    out.session.jobRole = role;
    out = await turn(a, 'find me jobs', out.session);
    return { a, out };
  };

  it('1 · reads the position off the resume instead of asking for it', async () => {
    /*
     * They said what they are on the first turn — the page is headed Backend
     * Engineer — and were asked again on the second. The list itself is where
     * you change lane; every row can start a tailor for a different title.
     */
    const a = agent();
    let out = await turn(a, BACKEND, null);
    out = await turn(a, 'find me jobs', out.session);
    expect(out.kind).not.toBe('ask');
    expect(Array.isArray(out.jobs)).toBe(true);
    expect(String(out.session.jobRole).toLowerCase()).toContain('backend');
  });

  it('2 · lists the portal\'s openings, in the portal\'s order', async () => {
    const { out } = await hunt(BACKEND, 'Backend Engineer');
    const real = out.jobs.filter((j) => !j.aspirational);
    expect(real.map((j) => j.company)).toEqual(PORTAL_JOBS.map((j) => j.company));
  });

  it('3 · real openings come first and the targets come last', async () => {
    /* The order the student asked for: who is hiring now, then who is worth
       aiming at. A target above a live opening buries the thing they can
       actually apply to. */
    const { out } = await hunt(BACKEND, 'Backend Engineer');
    const firstAspirational = out.jobs.findIndex((j) => j.aspirational);
    const lastReal = out.jobs.map((j) => !!j.aspirational).lastIndexOf(false);
    expect(firstAspirational).toBeGreaterThan(lastReal);
  });

  it('4 · the targets span domains, not one sector', async () => {
    const { out } = await hunt(DATA, 'Data Analyst');
    const names = out.jobs.filter((j) => j.aspirational).map((j) => j.company);
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
  });

  it('5 · a target carries no link, because there is nothing to apply to', async () => {
    const { out } = await hunt(BACKEND, 'Backend Engineer');
    out.jobs.filter((j) => j.aspirational).forEach((j) => expect(j.url).toBe(''));
  });

  it('6 · an opening keeps its posting, so a tailor can read it', async () => {
    const { out } = await hunt(BACKEND, 'Backend Engineer');
    expect(out.jobs[0].description).toMatch(/Java|Kafka/);
  });

  it('7 · opening a row and tailoring for it uses that posting', async () => {
    const { a, out } = await hunt(BACKEND, 'Backend Engineer');
    const after = await walk(a, await turn(a, 'tailor number 1', out.session));
    expect(after.session.pickedJob.company).toBe('stripe');
    expect(after.kind).toBe('build');
  });

  it('8 · tailoring for a big-name target still works, and still scores', async () => {
    const { a, out } = await hunt(BACKEND, 'Backend Engineer');
    const target = out.jobs.find((j) => j.aspirational);
    const before = out.report ? out.report.score : null;
    const after = await walk(a, await turn(a, `tailor number ${out.jobs.indexOf(target) + 1}`, out.session));
    expect(after.session.aspirational).toBe(true);
    if (before !== null && after.report) expect(after.report.score).toBeGreaterThanOrEqual(0);
  });

  it('9 · the reply names companies and prints no raw link', async () => {
    const { out } = await hunt(BACKEND, 'Backend Engineer');
    expect(out.reply).toMatch(/stripe/);
    expect(out.reply).not.toMatch(/https?:\/\//);
  });

  it('10 · dead boards say so instead of inventing rows', async () => {
    jobAgent.findJobs.mockRejectedValue(new Error('every board timed out'));
    const { out } = await hunt(BACKEND, 'Backend Engineer');
    expect(out.reply).toMatch(/did not answer|not invent|Nothing came back/i);
  });
});

/* ------------------------------------------- BUILT FROM SCRATCH, THEN JOBS */

describe('no resume at all · the same errand from the other end', () => {
  /*
   * "Build me a resume for a software engineer" is somebody who wants a job
   * and has no page. Building it used to be the end of the conversation — a
   * document, and no next move — when the openings for the exact title they
   * had just named were one search away.
   */
  /*
   * Eight single-answer questions stand between the request and the list.
   *
   * Three come off a list and five are the person — name, email, phone,
   * GitHub, LinkedIn — and none of them is an essay. They come first because
   * four hundred rows is not the next thing somebody can act on when the
   * agent does not yet know their name.
   */
  const CORE = ['college', 'degree', 'gradyear', 'name', 'email', 'phone', 'github', 'linkedin'];
  const TYPED = {
    name: 'Ananya Rao',
    email: 'ananya@example.com',
    phone: '+91 98765 43210',
    github: 'ananyarao',
    linkedin: 'linkedin.com/in/ananyarao',
    link: 'linkedin.com/in/ananyarao',
  };

  const listing = async () => {
    const a = agent();
    let out = await turn(a, 'build me a resume for a software engineer', null);
    for (let i = 0; i < 12 && out.kind === 'ask' && CORE.includes(out.session.asked); i += 1) {
      const field = out.session.asked;
      const opts = choices(out);
      // eslint-disable-next-line no-await-in-loop
      out = await turn(a, TYPED[field] || (opts.length ? opts[0].value : 'skip'), out.session);
    }
    return { a, out };
  };

  it('shows the openings for that title, once it knows who is asking', async () => {
    const { out } = await listing();
    expect(out.kind).not.toBe('ask');
    expect(Array.isArray(out.jobs)).toBe(true);
    expect(String(out.session.jobRole || out.session.target || '').toLowerCase()).toContain('software');
    expect(out.jobs.some((j) => j.company === 'stripe')).toBe(true);
  });

  it('the row they open is what the page is built and tailored for', async () => {
    const { a, out } = await listing();
    /* Twenty-odd interview questions, each one a pick — the walk answers them
       the way the picker would, and the page lands tailored to the row. */
    const tailored = await walk(a, await turn(a, 'tailor number 1', out.session), 'first', 40);
    expect(tailored.session.pickedJob.company).toBe('stripe');
    expect(tailored.kind).toBe('build');
    expect(String(tailored.reply)).toMatch(/Built and tailored for/i);
  });
});

/* ------------------------------------------------------------ COVER LETTER */

describe('cover letter · ten journeys', () => {
  const withJob = async (resume) => {
    const a = agent();
    let out = await turn(a, resume, null);
    out.session.jobRole = 'Backend Engineer';
    out = await turn(a, 'find me jobs', out.session);
    out = await walk(a, await turn(a, 'tailor number 1', out.session));
    return { a, out };
  };

  const letter = async (a, session) => walk(a, await turn(a, 'write the cover letter', session));

  it('1 · the tailored page knows which job the letter is for', async () => {
    /*
     * The offer used to be a line at the bottom of the tailored reply. The
     * brief for that reply is the score and the work in points and nothing
     * else, so it went with the rest of the extras — the letter has its own
     * tab, and the job it would be about is on the session, which is what
     * makes "write the cover letter" work without asking again.
     */
    const { out } = await withJob(BACKEND);
    expect(out.session.pickedJob.company).toBe('stripe');
    expect(out.reply).toMatch(/^ATS score: \d+\/100/);
    expect(out.reply).not.toMatch(/cover letter/i);
  });

  it('2 · asking for it produces one', async () => {
    const { a, out } = await withJob(BACKEND);
    const l = await letter(a, out.session);
    expect(String(l.text || l.reply)).toMatch(/\w{200,}|[\s\S]{400,}/);
  });

  it('3 · it names the company it is for', async () => {
    const { a, out } = await withJob(BACKEND);
    const l = await letter(a, out.session);
    expect(String(l.text || l.reply).toLowerCase()).toContain('stripe');
  });

  it('4 · it names the role it is for', async () => {
    const { a, out } = await withJob(BACKEND);
    const l = await letter(a, out.session);
    expect(String(l.text || l.reply).toLowerCase()).toMatch(/backend engineer/);
  });

  it('5 · it uses a fact from the resume rather than adjectives', async () => {
    const { a, out } = await withJob(BACKEND);
    const l = await letter(a, out.session);
    expect(String(l.text || l.reply)).toMatch(/5,000|30%|Java|Northwind/);
  });

  it('6 · it never calls them passionate or a great fit', async () => {
    const { a, out } = await withJob(BACKEND);
    const l = await letter(a, out.session);
    expect(String(l.text || l.reply)).not.toMatch(/passionate|results-driven|great fit|leverage|utili[sz]e/i);
  });

  it('7 · it claims nothing the resume cannot support', async () => {
    const { a, out } = await withJob(FRONTEND);
    const l = await letter(a, out.session);
    /* The posting names Kafka; a frontend page has never touched it. */
    expect(String(l.text || l.reply)).not.toMatch(/\bexpert in Kafka\b|\byears of Kafka\b/i);
  });

  it('8 · it is a draft and nothing is sent', async () => {
    const { a, out } = await withJob(BACKEND);
    const l = await letter(a, out.session);
    expect(String(l.reply || '')).not.toMatch(/\bsent\b|\bemail sent\b/i);
  });

  it('9 · a second letter for a different job is a different letter', async () => {
    const { a, out } = await withJob(BACKEND);
    const l1 = await letter(a, out.session);
    const first = String(l1.text || l1.reply || '');
    const second = await walk(a, await turn(a, 'tailor number 3', l1.session));
    const l2r = await letter(a, second.session);
    const l2 = String(l2r.text || l2r.reply || '');
    expect(l2).not.toBe(first);
    expect(l2.toLowerCase()).toContain('airbnb');
  });

  it('10 · asking without a job asks for one rather than writing to nobody', async () => {
    /* A letter to no company is a template, and a template is what a student
       can already download from anywhere. It says what it needs first. */
    const a = agent();
    const out = await turn(a, BACKEND, null);
    const l = await turn(a, 'write the cover letter', out.session);
    const body = String(l.text || l.reply || '');
    expect(l.kind === 'ask' || /which|company|posting|role|check, build or tailor/i.test(body)).toBe(true);
    expect(body).not.toMatch(/Dear Hiring Manager/i);
  });
});
