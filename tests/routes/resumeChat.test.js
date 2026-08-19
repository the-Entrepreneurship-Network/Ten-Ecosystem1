'use strict';

/**
 * The conversation, tested as a conversation. The bug these exist to keep
 * dead: the agent asking a question, receiving the answer, and replying with
 * the same help text it always gave — because a stateless router cannot tell
 * an answer from small talk.
 */

const express = require('express');
const request = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v2/resume', require('../../routes/v2/resumeAgent'));
  return a;
}

/** One turn: send a message with the session the previous turn returned. */
async function turn(a, message, session, extra) {
  const res = await request(a)
    .post('/api/v2/resume/chat')
    .field('message', message)
    .field('session', session ? JSON.stringify(session) : '')
    .field('target', (extra && extra.target) || '')
    .field('jd', (extra && extra.jd) || '');
  return res.body;
}

const RESUME = [
  'Priya Nair',
  'priya.nair@example.com  +91 98765 43210',
  '',
  'Experience',
  'Backend Developer | Edutech | Jan 2024 – Present',
  '- Built REST APIs in Spring Boot for 400 students',
  '',
  'Skills',
  'Java, Spring Boot',
].join('\n');

describe('the conversation advances instead of repeating', () => {
  it('an answer is consumed by the question that asked it', async () => {
    const a = app();
    const t1 = await turn(a, 'build from scratch', null);
    expect(t1.kind).toBe('ask');
    expect(t1.session.asked).toBe('target');

    const t2 = await turn(a, 'Data Analyst', t1.session);
    // The old router would have replied with the same help text here.
    expect(t2.reply).not.toBe(t1.reply);
    expect(t2.session.target).toBe('Data Analyst');
    expect(t2.session.asked).not.toBe('target');
  });

  it('asks one question at a time, in the interview order', async () => {
    const a = app();
    let s = null;
    const askedFields = [];
    let out = await turn(a, 'build', s);
    for (let i = 0; i < 8 && out.kind === 'ask'; i++) {
      askedFields.push(out.session.asked);
      out = await turn(a, `answer ${i}`, out.session);
    }
    // No field is ever asked twice — the loop the user reported.
    expect(new Set(askedFields).size).toBe(askedFields.length);
  });

  it('builds once the stop rule is satisfied instead of interrogating forever', async () => {
    const a = app();
    let out = await turn(a, 'build', null);
    const answers = {
      target: 'Backend Developer', jd: 'skip', name: 'Asha Menon',
      email: 'asha@example.com', phone: '+91 90000 11111', link: 'github.com/asha',
      skills: 'Java, Spring Boot, PostgreSQL',
      projects: 'Built an invoicing API in Spring Boot used by 3 teams',
      education: 'B.Tech CSE, 2022 – 2026',
      metric: 'skip', dates: 'skip', evidence: 'skip',
    };
    for (let i = 0; i < 12 && out.kind === 'ask'; i++) {
      out = await turn(a, answers[out.session.asked] || 'skip', out.session);
    }
    expect(out.kind).toBe('build');
    expect(out.text).toContain('ASHA MENON');
    expect(out.text).toContain('asha@example.com');
    expect(out.report.score).toBeGreaterThan(60);
  });

  it('a command interrupts the interview rather than being eaten as an answer', async () => {
    const a = app();
    const t1 = await turn(a, 'build', null);
    expect(t1.session.asked).toBe('target');
    const t2 = await turn(a, 'actually just check my resume', t1.session);
    expect(t2.kind).toBe('ask');
    expect(t2.session.asked).toBe('resume');
    expect(t2.session.command).toBe('check');
  });

  it('check on a pasted resume scores it and keeps the session', async () => {
    const a = app();
    const t1 = await turn(a, 'check this:\n' + RESUME, null);
    // long paste recognised as a resume even mid-sentence
    expect(['scan', 'ask']).toContain(t1.kind);
    expect(t1.session.resumeText).toContain('Priya Nair');
  });

  it('gap needs the JD, asks for it once, then answers with the table only', async () => {
    const a = app();
    const t1 = await turn(a, 'what is missing from my resume', null);
    expect(t1.session.asked).toBe('resume');
    const t2 = await turn(a, RESUME, t1.session);
    expect(t2.session.asked).toBe('jd');
    const t3 = await turn(a, 'Backend engineer: Java, Spring Boot, PostgreSQL, Docker, Kubernetes required.', t2.session);
    expect(t3.kind).toBe('help');
    expect(t3.reply).toMatch(/Gap table/);
    expect(t3.reply).toMatch(/postgresql|docker|kubernetes/i);
    expect(t3.reply).not.toContain('SUMMARY'); /* no rewrite shipped */
  });

  it('tailor converts once it has resume and target, quoting before → after', async () => {
    const a = app();
    const t1 = await turn(a, 'tailor my resume', null);
    const t2 = await turn(a, RESUME, t1.session);
    let out = t2;
    if (out.session.asked === 'target') out = await turn(a, 'Backend Developer', out.session);
    for (let i = 0; i < 4 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    expect(out.packet).toBeTruthy();
    expect(out.reply).toMatch(/checker \d+→\d+/);
    expect(out.text).toContain('PRIYA NAIR');
  });

  it('"fix it" after a score starts the fix instead of the help menu', async () => {
    // The reported loop: score shown → "fix it" → menu → reply → menu again.
    const a = app();
    const t1 = await turn(a, RESUME, null);            // scored
    const t2 = await turn(a, 'fix it', t1.session);
    expect(t2.kind).not.toBe('help');                  // the old dead end
    expect(['ask', 'build']).toContain(t2.kind);
    if (t2.kind === 'ask') expect(t2.session.command).toBe('tailor');
  });

  it('"fix it" as the answer to "what job title" declines the title and proceeds', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);
    let out = await turn(a, 'fix it', t1.session);
    // If it asks for a title and the visitor just repeats the wish, that is
    // "no title, just fix" — the same words must never produce the same
    // question twice.
    if (out.kind === 'ask' && out.session.asked === 'target') {
      out = await turn(a, 'fix it please', out.session);
      expect(out.session.asked).not.toBe('target');
    }
    for (let i = 0; i < 6 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    expect(out.text).toContain('PRIYA NAIR');
  });

  it('compare ranks the JDs and recommends the strongest', async () => {
    const a = app();
    const t1 = await turn(a, 'compare these jobs', null);
    const t2 = await turn(a, RESUME, t1.session);
    expect(t2.session.asked).toBe('jds');
    const jds = [
      'Frontend Engineer: React, TypeScript, CSS required. Building dashboards.',
      'Backend Engineer: Java, Spring Boot, REST API and SQL. 2+ years building services.',
    ].join('\n---\n');
    const t3 = await turn(a, jds, t2.session);
    expect(t3.reply).toMatch(/Fit matrix/);
    // Java/Spring resume: the backend JD must win.
    expect(t3.reply).toMatch(/Strongest target: #2/);
  });

  it('cover refuses before a resume ships, then writes one against it', async () => {
    const a = app();
    const t1 = await turn(a, 'cover letter please', null);
    expect(t1.reply).toMatch(/finished resume/i);

    // ship one via tailor, then ask again
    let out = await turn(a, RESUME, t1.session);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 7 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');

    let cov = await turn(a, 'cover letter', out.session);
    if (cov.session.asked === 'company') cov = await turn(a, 'Northwind', cov.session);
    expect(cov.reply).toMatch(/Cover letter — \d+ words/);
    expect(cov.reply).toMatch(/Northwind/);
  });

  it('prep gives the five-line defense only after a ship', async () => {
    const a = app();
    const t1 = await turn(a, 'interview prep', null);
    expect(t1.reply).toMatch(/shipped resume/i);

    let out = await turn(a, RESUME, t1.session);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 7 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    const prep = await turn(a, 'prep', out.session);
    expect(prep.reply).toMatch(/Five-line defense/);
    expect(prep.reply.split('\n').filter((l) => /^\d\./.test(l))).toHaveLength(5);
  });

  it('confirms JD keywords with the person instead of adding them', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'tailor it', out.session, { jd: 'Backend: Java, Spring Boot, PostgreSQL and Docker required.' });
    let sawConfirm = false;
    for (let i = 0; i < 7 && out.kind === 'ask'; i++) {
      if (out.session.asked === 'confirmkw') {
        sawConfirm = true;
        expect(out.reply).toMatch(/no evidence/i);
        out = await turn(a, 'Docker — containerised the attendance service for deployment', out.session);
      } else {
        out = await turn(a, 'skip', out.session);
      }
    }
    expect(sawConfirm).toBe(true);
    expect(out.kind).toBe('build');
    // The confirmed line is now evidence in the shipped text; the never-
    // mentioned term stays not-claimed.
    expect(out.text).toMatch(/containerised the attendance service/);
    expect(out.packet.notClaimed).toContain('postgresql');
    expect(out.packet.notClaimed).not.toContain('docker');
  });

  it('a delivery opens with the path, command, band and the caveat', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 7 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    expect(out.reply).toMatch(/Path: A · Command: tailor · Band:/);
    expect(out.reply).toMatch(/Greenhouse does not auto-score/);
    expect(out.reply).toMatch(/Keyword (N\/A|\d+\/40) · Format \d+\/30/);
  });

  it('match runs the Jobscan screen: score plus gap in one reply, with the band', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'jobscan this', t1.session, { jd: 'Backend: Java, Spring Boot, PostgreSQL, Docker.' });
    expect(t2.reply).toMatch(/Command: match/);
    expect(t2.reply).toMatch(/% evidenced overlap/);
    expect(t2.reply).toMatch(/65–80%/);
    expect(t2.reply).toMatch(/missing: postgresql|missing: docker/);
  });

  it('linkedin writes headline and About from evidence only', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'linkedin headline please', t1.session, { target: 'Backend Developer' });
    expect(t2.reply).toMatch(/Command: linkedin/);
    expect(t2.reply).toMatch(/Headline: Backend Developer/);
    expect(t2.reply).toMatch(/About:/);
    // evidenced skills only — Kubernetes was never on this resume
    expect(t2.reply).not.toMatch(/kubernetes/i);
  });

  it('recruiter view prints the six-second gates', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'recruiter view', t1.session);
    expect(t2.reply).toMatch(/Command: recruiter/);
    expect(t2.reply).toMatch(/6-second function match: \d+\/25/);
    expect(t2.reply).toMatch(/Greenhouse does not auto-score/);
  });

  it('job hunting hands off to the Job Portal instead of reprinting resume commands', async () => {
    const a = app();
    const t1 = await turn(a, 'find me jobs and email hr', null);
    expect(t1.reply).toMatch(/Command: jobs/);
    expect(t1.reply).toMatch(/\/job-portal\//);
    expect(t1.reply).not.toMatch(/check —|build —/);
  });

  it('help twice is not the trap it used to be: the session survives it', async () => {
    const a = app();
    const t1 = await turn(a, 'hello', null);
    expect(t1.kind).toBe('help');
    const t2 = await turn(a, 'build', t1.session);
    expect(t2.kind).toBe('ask'); /* the menu did not strand the visitor */
  });

  it('the router skill button map: 98 without a resume asks the job title', async () => {
    const a = app();
    const t1 = await turn(a, 'make it 98/100', null);
    expect(t1.kind).toBe('ask');
    expect(t1.session.asked).toBe('target');   /* build interview Q1, not "attach a resume" */
    expect(t1.session.command).toBe('build');
  });

  it('"make it 98/100" runs raise, not tailor, and never answers 90 and stops', async () => {
    // The recording: user asked for 98, the agent shipped 90 and said nothing
    // about why. Raise must either reach the target or name the missing fact.
    const a = app();
    const t1 = await turn(a, RESUME, null);
    let out = await turn(a, 'make it 98/100', t1.session);
    expect(out.session.command === 'raise' || out.kind === 'build').toBe(true);

    for (let i = 0; i < 5 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    // Either it reached the goal, or it stated a ceiling with the reason.
    const reachedOrCeiling = /every parse, heading, verb and keyword lever spent/.test(out.reply)
      || /Ceiling: Checker \d+\/100/.test(out.reply);
    expect(reachedOrCeiling).toBe(true);
    if (/Ceiling/.test(out.reply)) expect(out.reply).toMatch(/I will not invent it|will not invent them/);
  });

  it('raise asks for the one fact worth the most points before giving up', async () => {
    const a = app();
    const thin = ['Ravi Kumar', 'ravi@example.com +91 90000 11111', '',
      'Experience', 'Developer | Acme | Jan 2024 – Present',
      '- Built the invoicing module in Java', '', 'Skills', 'Java'].join('\n');
    const t1 = await turn(a, thin, null);
    const t2 = await turn(a, 'make it 98', t1.session);
    if (t2.kind === 'ask') {
      expect(t2.reply).toMatch(/the next \d+ points need/i);
      expect(t2.reply).toMatch(/or say skip/i);
    }
  });

  it('every reply names the seat', async () => {
    const a = app();
    const t1 = await turn(a, 'build from scratch', null);
    expect(t1.reply).toMatch(/^Seat: RESUME · Command: build/);
  });

  it('the router skill button map: "do all" checks first, tailors only with a JD', async () => {
    const a = app();
    // resume, no JD → the check report is the answer
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'do all', t1.session);
    expect(['scan', 'ask']).toContain(t2.kind);

    // resume + JD → straight into tailor
    const s1 = await turn(a, RESUME, null);
    const s2 = await turn(a, 'do all', s1.session, { jd: 'Backend: Java, Spring Boot, PostgreSQL.' });
    expect(s2.session.command === 'tailor' || s2.kind === 'build').toBe(true);
  });

  it('the empty-state line is one sentence, not the four bullets', async () => {
    const a = app();
    const t1 = await turn(a, 'hello', null);
    expect(t1.reply).toBe('Upload a resume or say the job title.');
    expect(t1.reply).not.toMatch(/check —|build —|tailor —|gap —/);
  });

  it('asks open with the seat and command line, per the reply shape', async () => {
    const a = app();
    const t1 = await turn(a, 'build from scratch', null);
    expect(t1.reply).toMatch(/^Seat: RESUME · Command: build/);
  });

  it('"make it 98/100" and "do all" are commands, not menu fodder', async () => {
    // The screenshots: both messages got the identical help menu.
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'make it 98/100', t1.session);
    expect(t2.kind).not.toBe('help');
    /* 98 is its own command now — raise, which climbs or states the ceiling. */
    expect(t2.session.command === 'raise' || t2.kind === 'build').toBe(true);

    const s1 = await turn(a, RESUME, null);
    const s2 = await turn(a, 'do all', s1.session);
    expect(s2.kind).not.toBe('help');
  });

  it('the menu never prints twice in a row — the agent takes the lead instead', async () => {
    const a = app();
    const t1 = await turn(a, 'ummm', null);
    expect(t1.kind).toBe('help');
    const t2 = await turn(a, 'hmmm what', t1.session);
    expect(t2.kind).toBe('ask');            /* not the menu again */
    expect(t2.reply).not.toBe(t1.reply);
    expect(t2.session.asked).toBe('resume'); /* it moved the work forward */
  });

  it('with a resume already in hand, the second unmatched message starts the fix', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);       // scored, salvageable
    const t2 = await turn(a, 'okay so???', t1.session);   // menu once
    if (t2.kind === 'help') {
      const t3 = await turn(a, 'and???', t2.session);
      expect(t3.kind).toBe('ask');
      expect(t3.session.command).toBe('tailor');
    }
  });
});
