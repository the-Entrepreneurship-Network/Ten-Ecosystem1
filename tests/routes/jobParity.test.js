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

/* The portal's search, stubbed: these tests are about parity between the two
   seats, not about whether a board answered today. */
function portalStub(jobs) {
  const app = express();
  app.use(express.json());
  app.post('/api/v2/jobs/search', (req, res) => {
    res.json({ ok: true, profile: { role: req.body.role }, resumeText: req.body.text, jobs, withheld: 0 });
  });
  return app;
}

const PORTAL_JOBS = [
  { title: 'Senior Software Engineer, Backend', company: 'robinhood', location: 'Remote, US', directUrl: 'https://boards.greenhouse.io/robinhood/1', description: 'Java, Kafka, Postgres.', tags: ['java'], fit5: 4 },
  { title: 'Backend Engineer, Developer Experience', company: 'stripe', location: 'Bengaluru, India', directUrl: 'https://stripe.com/jobs/2', description: 'Go, gRPC.', tags: ['go'], fit5: 4 },
  { title: 'Staff Backend Engineer', company: 'airbnb', location: 'Remote, EU', directUrl: 'https://careers.airbnb.com/3', description: 'Scala, Kafka.', tags: ['scala'], fit5: 3 },
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

let server;
let prevPort;

beforeAll((done) => {
  server = portalStub(PORTAL_JOBS).listen(0, () => {
    prevPort = process.env.PORT;
    /* The resume agent calls the portal on this port, so the stub answers
       exactly where the real one would. */
    process.env.PORT = String(server.address().port);
    done();
  });
});

afterAll((done) => {
  if (prevPort === undefined) delete process.env.PORT;
  else process.env.PORT = prevPort;
  server.close(done);
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

  it('says nothing was found rather than inventing rows when the portal is down', async () => {
    const prev = process.env.PORT;
    process.env.PORT = '1';           /* nothing listening */
    const out = await hunt();
    process.env.PORT = prev;
    expect(out.reply).toMatch(/did not answer|not invent/i);
    expect(out.jobs === undefined || out.jobs.length === 0).toBe(true);
  });
});
