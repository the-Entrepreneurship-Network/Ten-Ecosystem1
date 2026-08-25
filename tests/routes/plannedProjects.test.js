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

describe('the projects it adds read as finished work', () => {
  /*
   * They did not. The page carried a section headed "PLANNED PROJECTS (not
   * yet built — remove or complete before applying)" and lines reading
   * "[PLANNED — not built yet] A working system where dashboards is the hard
   * part — Built <what it does> on dashboards, serving <N> users at <N>ms".
   *
   * Every word of that is honest and none of it belongs on a document
   * somebody attaches to an application: a parser does not know the heading,
   * a recruiter reads a disclaimer, and the student cannot send the page
   * without hand-editing it first. The honesty moved to the reply, where it
   * is instruction rather than defacement — the page is a page.
   */
  it('writes them into PROJECTS, with no second heading and no marker', async () => {
    const out = await withPlanned(app());
    expect(out.text).not.toMatch(/PLANNED PROJECTS/);
    expect(out.text).not.toMatch(/\[PLANNED/);
    expect(out.text).toMatch(/^PROJECTS/m);
    /* The work they actually did is still there, alongside. */
    expect(out.text).toMatch(/Campus portal used by 300 students/);
  });

  it('leaves no blanks on the page for anybody to send by accident', async () => {
    const out = await withPlanned(app());
    const bullets = out.text.split('\n').filter((l) => /^- /.test(l));
    expect(bullets.length).toBeGreaterThan(1);
    bullets.forEach((l) => {
      expect(l).not.toMatch(/<[^>]{1,40}>/);
      expect(l).not.toMatch(/not built yet/i);
    });
  });

  it('states what still has to become true, in the reply', async () => {
    /* The debt is not gone, it has moved to where it can be acted on. */
    const out = await withPlanned(app());
    expect(out.reply).toMatch(/Before you attach this/i);
  });

  it('gives the build steps for each one, in order', async () => {
    const out = await withPlanned(app());
    expect(out.reply).toMatch(/- \*\*/);
    expect(out.reply).toMatch(/\n {2}- /);
  });
});

describe('what goes on the page is work, not a measurement nobody took', () => {
  it('never asserts a figure the student would have to defend', async () => {
    /*
     * The finished wording is allowed to say what was built and how it was
     * proven. It is not allowed to say it moved ten thousand messages a
     * minute, because nobody measured that — and a bullet that invents a
     * number is the thing an interviewer opens with.
     */
    const out = await withPlanned(app());
    const added = out.text.split('\n')
      .filter((l) => /^- /.test(l))
      .filter((l) => !/Campus portal|API in Java/.test(l));
    added.forEach((l) => {
      expect(l).not.toMatch(/\b\d{3,}\b/);
      expect(l).not.toMatch(/\d+\s*(ms|%)\b/);
    });
  });
});

describe('the two ways out', () => {
  it('a project they finish becomes their own sentence', async () => {
    const a = app();
    let out = await withPlanned(a);

    out = await turn(a, 'i built it', out.session);
    expect(out.session.asked).toBe('builtproof');

    const line = 'Built a Kafka order pipeline handling 400 messages a minute, verified by killing consumers mid-run';
    out = await turn(a, line, out.session);
    expect(out.session.resumeText).toMatch(/- Built a Kafka order pipeline handling 400 messages a minute/);
  });
});
