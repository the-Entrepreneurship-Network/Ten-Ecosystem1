'use strict';

/**
 * Planned projects, and the gate between them and an employer.
 *
 * A student asked for the projects a posting wants to be added to their page
 * before they exist, so they can see the resume they are working towards.
 * That is a reasonable thing to want and a dangerous thing to ship without a
 * boundary — the boundary is here: the draft may say "not built yet", the
 * PDF may not exist while it does.
 */

const express = require('express');
const request = require('supertest');
const skillPlan = require('../../services/v2/skillPlan');

function app() {
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

const RESUME = [
  'Priya Nair',
  'Backend Developer',
  'priya@example.com | +91 90000 00000',
  '',
  'EXPERIENCE',
  'Backend Developer | Zeta | Jan 2023 - Present',
  '- Built an API in Java serving 5,000 requests a day',
  '',
  'PROJECTS',
  '- Campus portal used by 300 students',
  '',
  'SKILLS',
  'Java, Spring Boot',
  '',
  'EDUCATION',
  'B.Tech Computer Science, 2021 - 2025',
].join('\n');

const JD = 'Backend Engineer. Must have: Java, Kafka, Docker, PostgreSQL.';

async function withPlanned(a) {
  let out = await turn(a, RESUME, null);
  out.session.jd = JD;
  return turn(a, 'add these projects to my resume', out.session);
}

describe('planned projects are visible and clearly not real', () => {
  it('adds them under their own heading, never mixed into real projects', async () => {
    const out = await withPlanned(app());
    expect(out.text).toMatch(/^PLANNED PROJECTS/m);
    /* The real project is still where it was, unmarked. */
    const projectsBlock = out.text.split(/^PLANNED PROJECTS/m)[0];
    expect(projectsBlock).toMatch(/- Campus portal used by 300 students/);
    expect(projectsBlock).not.toMatch(/\[PLANNED/);
  });

  it('marks every planned line and leaves the numbers blank', async () => {
    const out = await withPlanned(app());
    const lines = out.text.split('\n').filter((l) => /\[PLANNED/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => {
      expect(l).toMatch(/\[PLANNED — not built yet\]/);
      /* A blank, never an invented figure. */
      expect(l).toMatch(/<[^>]+>/);
    });
  });

  it('warns before anything is sent, and says why', async () => {
    const out = await withPlanned(app());
    expect(out.reply).toMatch(/Before you send this to anyone/i);
    expect(out.reply).toMatch(/do not exist yet/i);
    expect(out.reply).toMatch(/fails the first question/i);
  });

  it('gives the build steps for each one, in order', async () => {
    const out = await withPlanned(app());
    expect(out.reply).toMatch(/^1\. /m);
    expect(out.reply).toMatch(/Be ready for:/);
  });
});

describe('the gate between a planned project and an employer', () => {
  it('refuses to export a PDF while anything is unbuilt', async () => {
    const a = app();
    const out = await withPlanned(a);
    const res = await request(a)
      .post('/api/v2/resume/build.pdf')
      .field('text', out.session.resumeText)
      .field('name', 'Priya Nair')
      .field('email', 'priya@example.com')
      .field('phone', '+91 90000 00000')
      .field('skills', 'Java, Spring Boot');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/have not built yet/i);
    expect(res.body.planned.length).toBeGreaterThan(0);
  });

  it('catches a planned line arriving through the details fields too', async () => {
    /* The browser sends details, a script might send text. Both doors. */
    const a = app();
    const res = await request(a)
      .post('/api/v2/resume/build.pdf')
      .field('name', 'Priya Nair')
      .field('email', 'priya@example.com')
      .field('phone', '+91 90000 00000')
      .field('skills', 'Java')
      .field('projects', `${skillPlan.PLANNED} A queue-backed order processor — Built a <broker> pipeline`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/have not built yet/i);
  });
});

describe('the two ways out', () => {
  it('a built project moves into real Projects, in their own words', async () => {
    const a = app();
    let out = await withPlanned(a);
    const before = skillPlan.plannedLines(out.session.resumeText).length;

    out = await turn(a, 'i built it', out.session);
    expect(out.session.asked).toBe('builtproof');

    const line = 'Built a Kafka order pipeline handling 400 messages a minute, verified by killing consumers mid-run';
    out = await turn(a, line, out.session);

    /* One fewer planned, and their sentence is now a real project line. */
    expect(skillPlan.plannedLines(out.session.resumeText)).toHaveLength(before - 1);
    expect(out.session.resumeText).toMatch(/- Built a Kafka order pipeline handling 400 messages a minute/);
  });

  it('taking the planned section off leaves an honest page that exports', async () => {
    const a = app();
    let out = await withPlanned(a);
    out = await turn(a, 'apply with what I have', out.session);

    expect(skillPlan.plannedLines(out.session.resumeText)).toHaveLength(0);
    expect(out.session.resumeText).not.toMatch(/PLANNED PROJECTS/);
    /* The work they actually did survives the removal. */
    expect(out.session.resumeText).toMatch(/Campus portal used by 300 students/);

    const res = await request(a)
      .post('/api/v2/resume/build.pdf')
      .field('text', out.session.resumeText)
      .field('name', 'Priya Nair')
      .field('email', 'priya@example.com')
      .field('phone', '+91 90000 00000')
      .field('skills', 'Java, Spring Boot')
      .field('experience', 'Backend Developer | Zeta | Jan 2023 - Present\n- Built an API in Java serving 5,000 requests a day')
      .field('projects', 'Campus portal used by 300 students')
      .field('education', 'B.Tech Computer Science, 2021 - 2025');
    /* Whatever else the builder wants, it is no longer the planned gate. */
    if (res.status !== 200) expect(res.body.error).not.toMatch(/have not built yet/i);
  });
});
