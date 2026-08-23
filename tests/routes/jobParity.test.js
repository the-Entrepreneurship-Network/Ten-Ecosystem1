'use strict';

/**
 * One hunt, two seats.
 *
 * A student read a role in the resume agent, tailored for it, walked to the
 * Job Portal to apply — and it was not in the list, because each seat was
 * running its own search over the same boards. Two pipelines cannot be kept
 * in step by care; they drift the moment either is touched.
 *
 * These tests pin the only arrangement that cannot drift: the resume agent
 * reads the portal's search rather than running one, so whatever the portal
 * will list is what it shows, in that order. The difference between the seats
 * is presentation — the portal hands over a link to apply through, and the
 * resume agent shows the role to tailor for.
 */

const express = require('express');
const request = require('supertest');

/*
 * The portal's search, stubbed at the function rather than over HTTP.
 *
 * These tests used to stand up a second server and point PORT at it, because
 * the resume seat reached the search by POSTing to its own port. That hop was
 * the bug: in production the server is not reachable at http://127.0.0.1:PORT
 * — the hosting proxy listens elsewhere — so the request was refused and the
 * board came back empty on every search. The seats now share the function,
 * which is what parity meant all along, so the stub goes where the seam is.
 */
jest.mock('../../routes/v2/jobAgent', () => {
  const actual = jest.requireActual('../../routes/v2/jobAgent');
  const router = actual;
  router.findJobs = jest.fn();
  return router;
});
const jobAgent = require('../../routes/v2/jobAgent');

/* Exactly what findJobs hands back — the portal's own rows, its own order. */
const PORTAL_JOBS = [
  { title: 'Senior Software Engineer, Backend', company: 'robinhood', location: 'Remote, US', url: 'https://boards.greenhouse.io/robinhood/1', description: 'Java, Kafka, Postgres.', tags: ['java'], fit5: 4 },
  { title: 'Backend Engineer, Developer Experience', company: 'stripe', location: 'Bengaluru, India', url: 'https://stripe.com/jobs/2', description: 'Go, gRPC.', tags: ['go'], fit5: 4 },
  { title: 'Staff Backend Engineer', company: 'airbnb', location: 'Remote, EU', url: 'https://careers.airbnb.com/3', description: 'Scala, Kafka.', tags: ['scala'], fit5: 3 },
];

const RESUME = [
  'BISHAL NAG',
  'Backend Engineer | Java | Spring Boot',
  'bishal@example.com | +91 78639 92542',
  '',
  'EXPERIENCE',
  'Backend Engineer | Zeta | Jan 2023 - Present',
  '- Built REST APIs in Java serving 5,000 requests a day, cutting latency 30%',
  '',
  'SKILLS',
  'Java, Spring Boot, SQL, Docker',
  '',
  'EDUCATION',
  'B.Tech Computer Science, 2019 - 2023',
].join('\n');

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

async function hunt() {
  const a = agent();
  let out = await turn(a, RESUME, null);
  out.session.jobRole = 'Backend Engineer';
  return turn(a, 'find me jobs', out.session);
}

describe('both seats show the same openings', () => {
  it('lists the portal\'s jobs, in the portal\'s order', async () => {
    /*
     * Parity is about the openings. The big-tech names appended after them
     * are not postings and are marked as such — they are somewhere to aim,
     * and the portal has no equivalent because you cannot apply to an
     * aspiration.
     */
    const out = await hunt();
    const real = out.jobs.filter((j) => !j.aspirational);
    expect(real.map((j) => `${j.title}|${j.company}`)).toEqual(
      PORTAL_JOBS.map((j) => `${j.title}|${j.company}`),
    );
  });

  it('lists every opening the boards returned, not the first eight', async () => {
    /*
     * The portal listed twenty-seven for a resume and this seat showed two of
     * them, which reads as a broken search rather than as a cap. Both numbers
     * were ours: findJobs defaults to eight and this sliced to eight again
     * afterwards. Somebody asking what is out there is owed what is out there.
     */
    const many = Array.from({ length: 27 }, (_, i) => ({
      title: `Backend Engineer ${i + 1}`,
      company: `company-${i + 1}`,
      location: 'Remote',
      url: `https://boards.greenhouse.io/c${i + 1}`,
      description: 'Java, Kafka.',
      tags: ['java'],
      fit5: 3,
    }));
    jobAgent.findJobs.mockResolvedValue(many);
    const out = await hunt();
    expect(out.jobs.filter((j) => !j.aspirational).length).toBe(27);
    /* And it asked the search for more than eight in the first place. */
    const [, opts] = jobAgent.findJobs.mock.calls[0];
    expect(opts.limit).toBeGreaterThanOrEqual(30);
  });

  it('appends the whole roster, not the first thirty', async () => {
    /*
     * The cap was thirty, and it cut by how well each employer fitted the
     * title — so a backend engineer never saw the banks, the semiconductor
     * firms or the Indian product companies at all. Every employer on the
     * list appears after the live openings; the ordering decides what is near
     * the top, not what exists.
     */
    const { COMPANIES } = require('../../services/v2/aspirationalCompanies');
    const out = await hunt();
    const targets = out.jobs.filter((j) => j.aspirational);
    expect(targets.length).toBe(COMPANIES.length);
    expect(new Set(targets.map((j) => j.company)).size).toBe(targets.length);
  });

  it('appends the big names as targets, never as openings', () => {
    return hunt().then((out) => {
      const aspirational = out.jobs.filter((j) => j.aspirational);
      expect(aspirational.map((j) => j.company)).toEqual(
        expect.arrayContaining(['Google', 'Meta', 'Amazon', 'Microsoft']),
      );
      /* No link, because there is nothing to apply to yet. */
      aspirational.forEach((j) => expect(j.url).toBe(''));
    });
  });

  it('keeps every company the portal listed, so the walk across matches', async () => {
    /* The whole point: a role read here is findable there. */
    const out = await hunt();
    PORTAL_JOBS.forEach((p) => {
      expect(out.jobs.some((j) => j.company === p.company && j.title === p.title)).toBe(true);
    });
  });

  it('carries overseas and Indian rows alike, exactly as the portal ranked them', async () => {
    const out = await hunt();
    const places = out.jobs.map((j) => j.location);
    expect(places).toEqual(expect.arrayContaining(['Remote, US', 'Bengaluru, India', 'Remote, EU']));
  });
});

describe('the seats differ in what they hand you, not in what they found', () => {
  it('the resume agent names the role and never prints a link', async () => {
    /*
     * Applying happens in the portal. A link here is an invitation to leave
     * mid-tailor, and the row it belongs to is already waiting there.
     */
    const out = await hunt();
    expect(out.reply).toMatch(/robinhood/);
    expect(out.reply).toMatch(/Senior Software Engineer, Backend/);
    expect(out.reply).not.toMatch(/https?:\/\//);
  });

  it('still carries the posting, so a tailor can read what the job asks for', async () => {
    /* Not rendered, but present: tailoring against a title maps a title. */
    const out = await hunt();
    expect(out.jobs[0].description).toMatch(/Java, Kafka/);
    expect(out.jobs[0].url).toMatch(/^https?:\/\//);
  });

  it('says nothing was found rather than inventing rows when the boards are down', async () => {
    jobAgent.findJobs.mockRejectedValue(new Error('every board timed out'));
    const out = await hunt();
    expect(out.reply).toMatch(/did not answer|not invent/i);
    expect(out.jobs === undefined || out.jobs.length === 0).toBe(true);
  });

  it('searches on a role named in the sentence, with no resume yet', async () => {
    /*
     * "find me jobs for a backend engineer" was answered with "attach your
     * resume first" — a dead end put in front of somebody who had just named
     * the role. A page makes the ranking better; it was never needed to run
     * a search.
     */
    const a = agent();
    const out = await turn(a, 'find me jobs for a backend engineer', null);
    expect(out.session.jobRole).toBe('backend engineer');
    expect(out.jobs.filter((j) => !j.aspirational).length).toBeGreaterThan(0);
    expect(out.session.asked).toBeFalsy();
  });

  it('asks the position picker when no role was named, never for a document', async () => {
    /* The one thing the search cannot know is which job they want, and that
       is a list to choose from — not a file to go and find. */
    const a = agent();
    const out = await turn(a, 'find me jobs', null);
    expect(out.kind).toBe('ask');
    expect(out.session.asked).toBe('jobrole');
    const opts = [...(out.options.options || []), ...((out.options.groups || []).flatMap((g) => g.options || []))];
    expect(opts.length).toBeGreaterThan(20);
  });

  it('takes the title out of a typed answer instead of using the sentence', async () => {
    /*
     * Every list ends with "something else — I will type it", and what people
     * type is a sentence. Stored whole, thirty target rows came back titled
     * "find me jobs for a backend engineer at Verizon".
     */
    const a = agent();
    let out = await turn(a, 'find me jobs', null);
    expect(out.session.asked).toBe('jobrole');
    out = await turn(a, 'find me jobs for a backend engineer', out.session);
    expect(out.session.jobRole).toBe('backend engineer');
    expect(out.jobs.find((j) => j.aspirational).title).toBe('backend engineer');
  });

  it('reaches the search in process, with no request to our own port', async () => {
    /*
     * The bug this file now guards. Reaching the search over
     * http://127.0.0.1:${PORT} works on a laptop and fails behind the hosting
     * proxy, where the server is not listening on that port — so the board
     * came back empty in production while every test passed locally. The two
     * seats are in one module graph; the call is a call.
     */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../routes/v2/resumeAgent.js'), 'utf8',
    );
    expect(src).not.toMatch(/127\.0\.0\.1:\$\{port\}\/api\/v2\/jobs\/search/);
    expect(src).toMatch(/jobAgent\.findJobs\(/);

    await hunt();
    expect(jobAgent.findJobs).toHaveBeenCalled();
    const [, opts] = jobAgent.findJobs.mock.calls[0];
    expect(opts.role).toBe('Backend Engineer');
  });
});
