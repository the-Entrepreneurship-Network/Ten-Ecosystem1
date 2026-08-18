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

  it('help twice is not the trap it used to be: the session survives it', async () => {
    const a = app();
    const t1 = await turn(a, 'hello', null);
    expect(t1.kind).toBe('help');
    const t2 = await turn(a, 'build', t1.session);
    expect(t2.kind).toBe('ask'); /* the menu did not strand the visitor */
  });
});
