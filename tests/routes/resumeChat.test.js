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
    /* The interview asks for education in the three parts a person thinks in
       — degree, institution, years — rather than as one line. */
    const answers = {
      target: 'Backend Developer', jd: 'skip', name: 'Asha Menon',
      email: 'asha@example.com', phone: '+91 90000 11111',
      github: 'github.com/asha', linkedin: 'linkedin.com/in/asha',
      skills: 'Java, Spring Boot, PostgreSQL',
      hasprojects: 'yes',
      projects: 'Built an invoicing API in Spring Boot used by 3 teams',
      degree: 'B.Tech', college: 'KIIT University, Computer Science', gradyear: '2022 – 2026',
      education: 'B.Tech CSE, 2022 – 2026',
      metric: 'skip', evidence: 'skip', more: 'skip',
    };
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) {
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
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    expect(out.kind).toBe('build');

    /*
     * The letter interviews before it writes. It used to ask one question —
     * the company — and write from that alone, which is how "amazon" became
     * a whole letter: no position, no market, no project to point at. Each
     * question is skippable, so this answers the company and skips the rest.
     */
    let cov = await turn(a, 'cover letter', out.session);
    for (let i = 0; i < 24 && cov.kind === 'ask'; i++) {
      cov = await turn(a, cov.session.asked === 'company' ? 'Northwind' : 'skip', cov.session);
    }
    expect(cov.reply).toMatch(/Cover letter — \d+ words/);
    expect(cov.reply).toMatch(/Northwind/);
  });

  it('the letter asks what it needs instead of writing from a company name', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    /* The interview covers the whole page now — education, internships,
       projects, certifications, links — so a walkthrough that skips every
       question has more of them to skip. */
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);

    const asked = [];
    let cov = await turn(a, 'cover letter', out.session);
    for (let i = 0; i < 24 && cov.kind === 'ask'; i++) {
      asked.push(cov.session.asked);
      cov = await turn(a, 'skip', cov.session);
    }
    /*
     * The position and the employer, and then it writes.
     *
     * The letter briefly asked eleven things — level, market, work mode,
     * links, pay, hours, availability, working window — which is a form, not
     * a question, and none of it changes 150 words written from facts already
     * on the page. Two questions and a lead is the whole letter.
     */
    expect(asked).toContain('position');
    expect(asked).toContain('company');
    /* And the terms a letter exists to state: when they can start, how many
       hours, how long. Not the links, pay bands and work mode that were
       cut — none of those change 150 words. */
    expect(asked).toEqual(expect.arrayContaining(['availablefrom', 'hours', 'commitlength']));
    expect(asked.length).toBeLessThanOrEqual(7);
  });

  it('offers the answers to pick from when the answer comes from a known set', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    /* The interview covers the whole page now — education, internships,
       projects, certifications, links — so a walkthrough that skips every
       question has more of them to skip. */
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);

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
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
    const prep = await turn(a, 'prep', out.session);
    expect(prep.reply).toMatch(/Five-line defense/);
    expect(prep.reply.split('\n').filter((l) => /^\d\./.test(l))).toHaveLength(5);
  });

  it('confirms JD keywords with the person instead of adding them', async () => {
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'tailor it', out.session, { jd: 'Backend: Java, Spring Boot, PostgreSQL and Docker required.' });
    let sawConfirm = false;
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) {
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
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
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
    /* Evidenced terms say where the proof is, so the row is checkable — and
       "Spring Boot" appears once, not also as a bare "Spring" row: a term
       wholly inside a longer one is that term. */
    expect(t2.reply).toMatch(/\| Spring Boot \| yes \| Experience \|/i);
    expect(t2.reply).not.toMatch(/\| Spring \|/i);
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
    for (let i = 0; i < 24 && out.kind === 'ask'; i += 1) {
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
    for (let i = 0; i < 24 && out.kind === 'ask'; i += 1) {
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

  it('the score keeps climbing as facts arrive, instead of stalling on one number', async () => {
    /*
     * The complaint, as a test. A resume went 68 → 74 → 80 across releases and
     * then stopped: every later "make it 98" re-ran two spent levers and
     * returned the identical score and the identical sentence. The rewrite was
     * also actively damaging the page — stripping "Responsible for" without
     * putting a verb back, and replacing a stated skills line with a
     * placeholder — so the climb started from a hole it had dug itself.
     */
    const a = app();
    const WEAK = [
      'Rahul Verma', 'rahul.verma@example.com  9876543210',
      '', 'Objective', 'Seeking a challenging role in a reputed organization.',
      '', 'Experience', 'Software Developer, Acme Solutions',
      'Responsible for developing web applications',
      'Worked on bug fixes and maintenance',
      '', 'Skills', 'Java, HTML, CSS',
      '', 'Education', 'B.Tech Computer Science',
    ].join('\n');

    /* A weak resume opens the rebuild interview rather than a score card, so
       the baseline is read directly rather than from the first reply. */
    const start = require('../../routes/v2/resumeAgent').scanResume(WEAK, 'Software Developer').score;
    let out = await turn(a, WEAK, null);

    const facts = [
      'Built the customer portal in Java used by 4,000 users a month',
      'Fixed 120 bugs before release, cutting the crash rate 35%',
      'Jan 2022 - Present',
    ];
    const seen = [start];
    out = await turn(a, 'make it 98', out.session);
    for (const f of facts) {
      out = await turn(a, f, out.session);
      if (out.report) seen.push(out.report.score);
    }

    /* Every fact moved the number, and the last is well above the first. */
    expect(seen[seen.length - 1]).toBeGreaterThan(start);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(78);
  });

  it('shows which line is holding the score down once formatting is spent', async () => {
    /* "I need one real number for your strongest bullet" is true, identical
       every time, and unactionable. The per-bullet worklist names the line. */
    const a = app();
    const WEAK = [
      'Rahul Verma', 'rahul.verma@example.com  9876543210',
      '', 'Experience', 'Software Developer, Acme Solutions',
      'Responsible for developing web applications',
      'Worked on bug fixes and maintenance',
      '', 'Skills', 'Java, HTML, CSS', '', 'Education', 'B.Tech CS',
    ].join('\n');

    let out = await turn(a, WEAK, null);
    const replies = [];
    /* A short page is first asked for more history — that is its own answer
       to "why is it not 98". Declining it reaches the per-bullet worklist. */
    for (let i = 0; i < 6; i += 1) {
      out = await turn(a, out.session.asked === 'more' ? 'skip' : 'make it 98', out.session);
      replies.push(String(out.reply || ''));
    }
    /* Never the same sentence twice in a row — the complaint was watching one
       reply come back verbatim, not a phase being revisited later. */
    replies.forEach((r, i) => { if (i) expect(r).not.toBe(replies[i - 1]); });
    const worklist = replies.find((r) => /What is wrong/.test(r));
    expect(worklist).toBeTruthy();
    expect(worklist).toMatch(/carries no number|action verb|duty phrase/);
  });

  it('offers the kinds of number that fit the bullet, to pick from', async () => {
    /* "Add a metric" is the least actionable advice in resume writing because
       nobody knows which number is wanted. The options name the candidates. */
    const a = app();
    const WEAK = [
      'Rahul Verma', 'rahul.verma@example.com  9876543210',
      '', 'Experience', 'Software Developer, Acme Solutions',
      'Responsible for developing web applications',
      'Worked on bug fixes and maintenance',
      '', 'Skills', 'Java, HTML, CSS', '', 'Education', 'B.Tech CS',
    ].join('\n');

    let out = await turn(a, WEAK, null);
    let withOptions = null;
    for (let i = 0; i < 8 && !withOptions; i += 1) {
      out = await turn(a, out.session.asked === 'more' ? 'skip' : 'make it 98', out.session);
      if (out.options && out.options.options) withOptions = out.options;
    }
    expect(withOptions).toBeTruthy();
    expect(withOptions.options.length).toBeGreaterThan(1);
    expect(withOptions.other).toBeTruthy();
  });

  it('reads a fact typed after a delivery as a fact, not as a lost visitor', async () => {
    /* Handed a rewritten page and typing "Jan 2022 – Present" — an answer to
       the dates question — the student was told "upload a resume or say the
       job title", about the document on their screen. */
    const a = app();
    let out = await turn(a, RESUME, null);
    out = await turn(a, 'fix it', out.session);
    for (let i = 0; i < 8 && out.kind === 'ask'; i += 1) out = await turn(a, 'skip', out.session);

    const after = await turn(a, 'Led the migration to Spring Boot across 12 services', out.session);
    expect(String(after.reply || '')).not.toMatch(/Upload a resume/i);
    expect(after.session.resumeText).toMatch(/Led the migration/);
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
    /* The interview covers the whole page now — education, internships,
       projects, certifications, links — so a walkthrough that skips every
       question has more of them to skip. */
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
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
    /* The interview covers the whole page now — education, internships,
       projects, certifications, links — so a walkthrough that skips every
       question has more of them to skip. */
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
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
    /* The interview covers the whole page now — education, internships,
       projects, certifications, links — so a walkthrough that skips every
       question has more of them to skip. */
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) out = await turn(a, 'skip', out.session);
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

  it('job hunting asks for the resume rather than sending them elsewhere', async () => {
    /*
     * It used to hand people to a different portal, which meant uploading the
     * same resume a second time and losing the thread. Finding an opening and
     * tailoring for it are one errand, so the hunt happens here — and with no
     * resume on file the honest first move is to ask for one.
     */
    const a = app();
    const t1 = await turn(a, 'find me jobs', null);
    expect(t1.kind).toBe('ask');
    expect(t1.session.asked).toBe('resume');
    expect(t1.reply).toMatch(/what it can prove/i);
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
    for (let i = 0; i < 24 && out.kind === 'ask'; i++) {
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
    let out = await turn(a, 'make it 98', t1.session);
    /*
     * A thin page is asked for more history first — page length is the one
     * check no lever can move, so more of their own work is the honest ask.
     * Declining it reaches the fact question.
     */
    if (out.session.asked === 'more') {
      expect(out.reply).toMatch(/points are page length/i);
      out = await turn(a, 'skip', out.session);
    }
    if (out.kind === 'ask') {
      expect(out.reply).toMatch(/the next \d+ points need|What number belongs on this line/i);
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
