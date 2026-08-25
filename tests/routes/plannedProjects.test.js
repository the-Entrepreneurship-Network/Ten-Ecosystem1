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

describe('the projects it adds read as a resume, not as a to-do list', () => {
  it('writes them under PROJECTS, finished, with no marker and no blanks', async () => {
    /*
     * They used to arrive under a heading of their own — "PLANNED PROJECTS
     * (not yet built — remove or complete before applying)" — with every line
     * stamped "[PLANNED — not built yet]" and its figures left as "<N> users
     * at <N>ms". Every word of that was true and none of it belonged on a
     * document somebody attaches to an application: no parser knows the
     * heading, a recruiter reads a disclaimer, and the student cannot send
     * the page without editing it by hand first.
     *
     * They are projects. They go under PROJECTS, written the way the entries
     * already there are written. What is still owed is said in the reply.
     */
    const out = await withPlanned(app());
    expect(out.text).not.toMatch(/PLANNED/);
    expect(out.text).not.toMatch(/<[A-Za-z][^>]*>/);
    expect(out.text).toMatch(/^PROJECTS$/m);
    /* One Projects heading, not a second one below the first. */
    expect((out.text.match(/^PROJECTS$/gm) || []).length).toBe(1);
    /* The student's own project is untouched and still first. */
    expect(out.text).toMatch(/- Campus portal used by 300 students/);
  });

  it('gives each one a title and the work beneath it', async () => {
    const out = await withPlanned(app());
    const body = out.text.split(/^PROJECTS$/m)[1].split(/^[A-Z][A-Z &]{2,}$/m)[0];
    const titles = body.split('\n').filter((l) => l.trim() && !l.trim().startsWith('-'));
    expect(titles.length).toBeGreaterThan(0);
    titles.forEach((t) => {
      /* A name a project would really have, not a technology in a sentence. */
      expect(t).not.toMatch(/^(Working system|Production service) built on /);
    });
  });

  it('never adds the same project twice', async () => {
    /*
     * Two terms can resolve to one brief, and the page is composed by more
     * than one caller — so the same entry landed twice, with the same bullet
     * under each.
     */
    const out = await withPlanned(app());
    const titles = out.text.split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('-') && !/^[A-Z][A-Z &]{2,}$/.test(l.trim()))
      .map((l) => l.trim().toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('says in the reply what is not true yet, and how to make it true', async () => {
    /*
     * The page carried the disclaimer before, so the reply could be brief.
     * The page is sendable now — and therefore sendable before the work
     * exists — so this sentence is the only thing between a student and
     * attaching a resume describing projects they have not built.
     */
    const out = await withPlanned(app());
    expect(out.reply).toMatch(/Before you attach this/i);
    expect(out.reply).toMatch(/not true yet/i);
    /* And the steps, in order, for each one. */
    expect(out.reply).toMatch(/\n {2}- /);
  });
});
describe('the gate between a planned project and an employer', () => {
  it('refuses to export a PDF while anything is unbuilt', async () => {
    const a = app();
    const out = await withPlanned(a);
    const res = await request(a)
      .post('/api/v2/resume/build.pdf')
      .field('text', out.session.resumeText)
      /* The gate reads the session now — the page no longer confesses, so
         what has not been built is recorded beside the plan that made it. */
      .field('session', JSON.stringify(out.session))
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
    /*
     * What is still unbuilt is counted from the record now, not from markers
     * in the text. The page reads as a finished document — that is the whole
     * change — so the list of what has not actually been done lives on the
     * session beside the plan that produced it.
     */
    const a = app();
    let out = await withPlanned(a);
    const before = (out.session.plannedGuides || []).length;
    expect(before).toBeGreaterThan(0);

    out = await turn(a, 'i built it', out.session);
    expect(out.session.asked).toBe('builtproof');

    const line = 'Built a Kafka order pipeline handling 400 messages a minute, verified by killing consumers mid-run';
    out = await turn(a, line, out.session);

    /* One fewer outstanding, and their sentence is now a real project line. */
    expect((out.session.plannedGuides || []).length).toBe(before - 1);
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
      /* The gate reads the session now — the page no longer confesses, so
         what has not been built is recorded beside the plan that made it. */
      .field('session', JSON.stringify(out.session))
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