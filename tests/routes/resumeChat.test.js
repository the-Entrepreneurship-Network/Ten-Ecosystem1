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

    /*
     * The letter interviews before it writes. It used to ask one question —
     * the company — and write from that alone, which is how "amazon" became
     * a whole letter: no position, no market, no project to point at. Each
     * question is skippable, so this answers the company and skips the rest.
     */
    let cov = await turn(a, 'cover letter', out.session);
    for (let i = 0; i < 10 && cov.kind === 'ask'; i++) {
      cov = await turn(a, cov.session.asked === 'company' ? 'Northwind' : 'skip', cov.session);
    }
    expect(cov.reply).toMatch(/Cover letter — \d+ words/);
    expect(cov.reply).toMatch(/Northwind/);
  });

  it('the letter asks what it needs instead of writing from a company name', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 8 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);

    const asked = [];
    let cov = await turn(a, 'cover letter', out.session);
    for (let i = 0; i < 10 && cov.kind === 'ask'; i++) {
      asked.push(cov.session.asked);
      cov = await turn(a, 'skip', cov.session);
    }
    /* The position and the market are the two the old flow never asked. */
    expect(asked).toContain('position');
    expect(asked).toContain('company');
    expect(asked).toContain('country');
  });

  it('offers the answers to pick from when the answer comes from a known set', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 8 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);

    const cov = await turn(a, 'cover letter', out.session);
    expect(cov.session.asked).toBe('position');
    expect(cov.options).toBeTruthy();
    const all = (cov.options.groups || []).flatMap((g) => g.options.map((o) => o.label));
    expect(all).toContain('Backend Engineer');
    expect(all).toContain('Machine Learning Engineer');
    /* And it must always be possible to answer with something not listed. */
    expect(cov.options.other).toBeTruthy();
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
    /* Listed as the posting spells them, so compare case-blind. */
    const notClaimed = out.packet.notClaimed.map((t) => t.toLowerCase());
    expect(notClaimed).toContain('postgresql');
    expect(notClaimed).not.toContain('docker');
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
    /*
     * The screen must show the posting was read term by term, not just
     * scored. This used to assert a "• missing: docker" bullet list; the
     * reply now carries the mapping table the tailor spec asks for — term,
     * whether it is evidenced, where, and what to do — so the assertion
     * checks the table and that the two absent terms are named in it.
     */
    expect(t2.reply).toMatch(/\| JD term \| Have it \| Where \| Action \|/);
    /* Terms are shown as the posting spells them, so the match is case-blind. */
    expect(t2.reply).toMatch(/\| PostgreSQL \| no \|/i);
    expect(t2.reply).toMatch(/\| Docker \| no \|/i);
    /* Evidenced terms say where the proof is, so the row is checkable. */
    expect(t2.reply).toMatch(/\| Spring \| yes \| Experience \|/i);
  });

  it('never asks the identical question twice in a row', async () => {
    /*
     * From a recording: asked for a name, the person typed "build for
     * google", the word "build" re-triggered the build command, the pending
     * question was discarded unanswered, and the identical sentence came
     * back word for word. From the outside that is an agent that cannot
     * hear, and it is the complaint this portal gets most.
     */
    const a = app();
    let out = await turn(a, 'build', null);
    const seen = [];
    for (let i = 0; i < 10 && out.kind === 'ask'; i += 1) {
      /* Answering with a phrase that contains a command word, every turn. */
      out = await turn(a, 'build for google', out.session);
      if (out.kind !== 'ask') break;
      expect(seen).not.toContain(out.reply);
      seen.push(out.reply);
    }
    expect(out.kind).toBe('build');
  });

  it('takes the name and contact from a resume already uploaded', async () => {
    /*
     * Someone uploaded their resume, watched it score, then asked for a
     * resume aimed at a different role — and was told "it would go out
     * saying your name is missing" about a document whose first line is
     * their name. BUILD read only the interview answers, and an upload was
     * not one of them.
     */
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'Build a Full-Stack Developer resume from scratch', out.session);
    for (let i = 0; i < 10 && out.kind === 'ask'; i += 1) {
      expect(out.reply || '').not.toMatch(/your name is missing/i);
      out = await turn(a, 'skip', out.session);
    }
    expect(out.text).toMatch(/PRIYA NAIR/);
  });

  it('works to the score the person asked for, not always 98', async () => {
    const a = app();
    for (const goal of [88, 91, 95, 99]) {
      const t1 = await turn(a, RESUME, null);
      const t2 = await turn(a, `make it ${goal}', please`, t1.session);
      const said = (t2.reply || '');
      expect(said).toMatch(new RegExp(`You asked for ${goal}\\b`));
      /* And it never claims to have reached a bar it did not reach. */
      const claimed = said.match(/Checker (\d+)\/100/);
      if (claimed && /Ceiling/.test(said)) expect(Number(claimed[1])).toBeLessThan(goal);
    }
  });

  it('uses the fact it asked for, instead of re-reporting the same ceiling', async () => {
    /*
     * The raise command asks for the one fact holding the score down, and
     * only the JD-keyword confirmation was ever written back into the
     * resume. So a person answered the question, watched the agent re-score
     * the untouched document, and got the identical ceiling sentence back —
     * having given it exactly what it asked for.
     */
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'make it 95', t1.session);
    expect(t2.kind).toBe('ask');

    const before = t2.session.resumeText;
    const scoreBefore = Number((t2.reply.match(/at (\d+)\/100/) || [])[1]);

    const t3 = await turn(a, 'Docker — containerised the billing service and ran it on AWS ECS', t2.session);
    /* The answer reached the document being scored, not just the notes. */
    expect(t3.session.resumeText).not.toBe(before);
    expect(t3.session.resumeText).toMatch(/containerised the billing service/);
    /* And the conversation moved: a different number, or a different ask. */
    const after = Number((String(t3.reply).match(/(?:at|Checker) (\d+)\/100/) || [])[1]);
    expect(t3.reply).not.toBe(t2.reply);
    if (scoreBefore && after) expect(after).toBeGreaterThanOrEqual(scoreBefore);
  });

  it('reads a job description pasted into the message', async () => {
    /*
     * "Tailor it to this job: Must have Python, AWS, Kubernetes…" was
     * answered with "paste the job description instead if you have it" —
     * about a message that was the job description.
     */
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'tailor it to this job: Senior Backend Developer. Must have: Java, Spring Boot, Kubernetes. Nice to have: Kafka.', t1.session);
    expect(t2.session.jd).toMatch(/Kubernetes/);
    expect(t2.reply || '').not.toMatch(/Paste the job description/i);
  });

  it('does not claim a skill that is only the tail of a compound word', async () => {
    /*
     * "ran the billing service on a 3-node cluster" was read as evidence of
     * Node.js, and Node went onto the skills line of a resume the student
     * would have sent — a claim they never made, produced by a hyphen.
     */
    const a = app();
    const withCluster = [
      'Priya Nair', 'Backend Developer', 'priya@example.com | +91 90000 00000',
      '', 'EXPERIENCE', 'Backend Developer | Zeta | Jan 2023 - Present',
      '- Ran the billing service on a 3-node cluster, cutting failover time 40%',
      '', 'SKILLS', 'Java, Spring Boot', '', 'EDUCATION', 'B.Tech CS, 2021 - 2025',
    ].join('\n');
    let out = await turn(a, withCluster, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 8 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    const skillsLine = (out.text.match(/^SKILLS\n(.+)$/m) || [])[1] || '';
    expect(skillsLine.toLowerCase().split(/,\s*/)).not.toContain('node');
  });

  it('treats a pasted resume as a resume, not as an instruction', async () => {
    /*
     * The agent asks people to paste their resume, then read the paste as a
     * sentence. A summary saying "2 years building services on AWS" matched
     * the build verb, so pasting a finished resume was answered with "what
     * job title are you applying for?" — about a document whose second line
     * is the job title.
     */
    const a = app();
    const pasted = [
      'Priya Nair',
      'Backend Developer',
      'priya.nair@example.com | +91 98765 43210',
      '',
      'SUMMARY',
      'Backend developer with 2 years building services on AWS.',
      '',
      'EXPERIENCE',
      'Backend Developer | Zeta Systems | Jan 2023 - Present',
      '- Built an API on AWS serving 5,000 requests a day, cutting latency 30%',
      '',
      'SKILLS',
      'Python, AWS, Terraform',
      '',
      'EDUCATION',
      'B.Tech Computer Science, 2021 - 2025',
    ].join('\n');

    const out = await turn(a, pasted, null);
    expect(out.session.resumeText).toContain('Zeta Systems');
    /* Looked at, not interrogated. */
    expect(out.reply || '').not.toMatch(/What job title are you applying for/i);
    expect(out.kind).not.toBe('ask');
  });

  it('reads an ordinary posting instead of treating it as no target at all', async () => {
    /*
     * The reported failure, as a test. A student pasted a real posting and
     * got scores out of 60 with an empty Not-claimed list and no ceiling —
     * the agent had scored their resume as though no job description
     * existed. The cause was term extraction that only recognised tools
     * already in this file's vocabulary plus tokens containing a digit, a
     * dot or a hyphen: "Kubernetes, Terraform, AWS, Prometheus, Go" yielded
     * too few terms to clear the keyword block's floor, so the block was
     * skipped in silence.
     *
     * Two properties keep it dead: the keyword block is scored (the score is
     * out of 100, not 60), and terms this codebase has never heard of are
     * still recognised as demands.
     */
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'gap', t1.session, {
      jd: 'Site Reliability Engineer. Required: Kubernetes, Terraform, AWS, Prometheus, Go.',
    });
    expect(t2.reply).toMatch(/Gap table — \d+\/\d+ JD terms evidenced/);
    /* Prometheus is in no vocabulary here and must still be read as a demand. */
    expect(t2.reply).toMatch(/prometheus/i);
    expect(t2.reply).toMatch(/kubernetes/i);
    expect(t2.reply).toMatch(/Factual ceiling/);
  });

  it('scores against a posting out of 100, not out of 60', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'jobscan this', t1.session, {
      jd: 'Backend Developer. Required: Java, Spring Boot, Kubernetes, Terraform.',
    });
    expect(t2.reply).toMatch(/checker \d+\/100/);
    expect(t2.reply).not.toMatch(/checker \d+\/60/);
  });

  it('separates what the posting requires from what it merely prefers', async () => {
    const a = app();
    const t1 = await turn(a, RESUME, null);
    const t2 = await turn(a, 'gap', t1.session, {
      jd: 'Backend Developer. Must have: Java, Spring Boot. Nice to have: Kafka, Grafana.',
    });
    expect(t2.reply).toMatch(/must-have/);
    expect(t2.reply).toMatch(/nice-to-have/);
    /* An optional term absent from the resume is not a failure to fix. */
    expect(t2.reply).toMatch(/\| Grafana \*\(nice to have\)\* \| no \|.*Safe to leave out/i);
  });

  it('keeps the title the resume already states instead of writing "Professional"', async () => {
    /*
     * A page headed "Backend Developer" came back headed "Professional",
     * because nothing read the line under the name — the rewriter's
     * last-resort placeholder was standing in for a fact printed at the top
     * of the document it had just parsed.
     */
    const a = app();
    const withTitle = ['Priya Nair', 'Backend Developer', ...RESUME.split('\n').slice(1)].join('\n');
    let out = await turn(a, withTitle, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 8 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    expect(out.text).toMatch(/Backend Developer/);
    expect(out.text).not.toMatch(/^Professional$/m);
  });

  it('does not print its own bookkeeping words on the shipped page', async () => {
    /* "Evidenced in Python, AWS" was this engine's internal term for where a
       skill came from, printed in the summary of a document being sent to a
       recruiter. */
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 8 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');
    expect(out.text).not.toMatch(/Evidenced in/i);
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

  it('"make a resume of a software developer and make it 98/100" builds one', async () => {
    /* The recording: this exact sentence returned the DevOps resume the user
       had uploaded minutes earlier, with a ceiling note. It asked for a new
       resume for a different role. */
    const a = app();
    const devops = ['Bishal Nag', 'bishal@example.com', '', 'Experience',
      'Senior DevOps Engineer | Acme | Jan 2022 - Present',
      '- Managed Kubernetes clusters and Terraform on Azure', '',
      'Skills', 'Azure, Kubernetes, Terraform, Jenkins'].join('\n');

    const t1 = await turn(a, devops, null);                       // scanned
    let out = await turn(a, 'make a resume of a software developer and make it 98/100', t1.session);

    expect(out.session.command).toBe('build');
    expect(out.session.target).toBe('software developer');
    /* The uploaded history must not be reused as the new resume. */
    expect(out.session.resumeText).toBe('');

    const answers = { target: 'Software Developer', jd: 'skip', name: 'Bishal Nag',
      email: 'bishal@example.com', phone: '+91 90000 11111', link: 'skip',
      skills: 'Java, Spring Boot, SQL', projects: 'Built an inventory API in Spring Boot',
      education: 'B.Tech CSE, 2021' };
    for (let i = 0; i < 12 && out.kind === 'ask'; i++) {
      out = await turn(a, answers[out.session.asked] || 'skip', out.session);
    }
    expect(out.kind).toBe('build');
    /* A software developer resume, not the DevOps one. */
    expect(out.text).not.toMatch(/Kubernetes|Terraform/i);
    expect(out.text).toMatch(/Spring Boot/);
    /* The 98 was carried into the build rather than answered about the old file. */
    expect(out.reply).toMatch(/Checker \d+\/100/);
  });

  it('the band never flatters the score printed on the card', async () => {
    /* A screen reading "62/100" beside the word "Strong" is the product
       contradicting itself, whichever scorer is right. */
    const a = app();
    const t = await turn(a, RESUME, null);
    if (t.kind === 'scan' && t.band) {
      const s = t.report.score;
      const expected = s < 50 ? 'weak' : s < 80 ? 'salvageable' : 'strong';
      const RANK = { weak: 0, salvageable: 1, strong: 2, unknown: 0 };
      expect(RANK[t.band]).toBeLessThanOrEqual(RANK[expected]);
    }
  });

  it('does not hand back the same document when asked to improve it again', async () => {
    /* "ok do it" and "improve it more" returned byte-identical output three
       times running — the agent looking broken while working as written. */
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'make it better', out.session);
    if (out.session.asked === 'target') out = await turn(a, 'Backend Developer', out.session);

    const replies = [];
    for (const msg of ['ok do it', 'improve it more', 'fix it again']) {
      out = await turn(a, msg, out.session);
      replies.push((out.reply || '').slice(0, 120));
    }
    for (let i = 1; i < replies.length; i += 1) {
      expect(replies[i]).not.toBe(replies[i - 1]);
    }
  });

  it('explains the score instead of asking for a resume it already has', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'why is it not 98', out.session);
    expect(out.reply).not.toMatch(/Upload a resume or say the job title/);
    expect(out.reply).toMatch(/Command: raise/);
  });

  it('reads the role out of the request', async () => {
    const a = app();
    const t1 = await turn(a, 'build me a cv for a data analyst', null);
    expect(t1.session.target).toBe('data analyst');
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
