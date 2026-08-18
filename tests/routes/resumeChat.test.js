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

  it('help twice is not the trap it used to be: the session survives it', async () => {
    const a = app();
    const t1 = await turn(a, 'hello', null);
    expect(t1.kind).toBe('help');
    const t2 = await turn(a, 'build', t1.session);
    expect(t2.kind).toBe('ask'); /* the menu did not strand the visitor */
  });

  it('"make it 98/100" and "do all" are commands, not menu fodder', async () => {
    // The screenshots: both messages got the identical help menu.
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'make it 98/100', t1.session);
    expect(t2.kind).not.toBe('help');
    expect(t2.session.command === 'tailor' || t2.kind === 'build').toBe(true);

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
