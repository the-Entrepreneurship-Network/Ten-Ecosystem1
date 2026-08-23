'use strict';

/**
 * The ats-resume skill's promises, held to arithmetic. The one that matters
 * most: nothing the rewriter ships contains a fact the source did not.
 */

const {
  factLedger, checkerScore, recruiterScan, rewriteResume, jdHardTerms, impactBullet
} = require('../../services/v2/atsResumeEngine');

/* A resume with the classic reject reasons: cute headings the parser cannot
   index, duty bullets, an unevidenced skill dump, no dates, buzzwords. */
const REJECTABLE = [
  'Priya Nair',
  'priya.nair@example.com  +91 98765 43210',
  '',
  'My Journey',
  'Passionate team player seeking a challenging opportunity.',
  '',
  'Where I Have Been',
  'Responsible for backend development at a startup',
  'Worked on a student portal for my college',
  '',
  'What I Know',
  'Java, Spring Boot, React, Kubernetes, Terraform, Leadership, Communication',
].join('\n');

/* The same person, written the way the skill writes: standard headings,
   dated role, verb bullets with scope, skills that the bullets evidence. */
const CLEAN = [
  'Priya Nair',
  'Backend Developer',
  'priya.nair@example.com | +91 98765 43210 | github.com/priyanair',
  '',
  'Summary',
  'Backend developer. Evidenced in Java, Spring Boot, PostgreSQL.',
  '',
  'Skills',
  'Java, Spring Boot, PostgreSQL, REST API, Git',
  '',
  'Experience',
  'Backend Developer | Edutech Startup | Jan 2024 – Present',
  '- Built REST order APIs in Spring Boot used by the checkout web app',
  '- Wrote PostgreSQL queries that cut report generation from 30s to 2s',
  '- Shipped attendance and marks modules in Java for 400 students',
  '',
  'Education',
  '- B.Tech Computer Science, 2020 – 2024',
].join('\n');

const JD = 'We need a backend engineer with Java, Spring Boot, PostgreSQL and REST API experience. Docker and Kubernetes are a plus. 2+ years.';

describe('fact ledger', () => {
  it('separates evidenced skills from listed ones', () => {
    const led = factLedger(CLEAN);
    expect(led.evidencedSkills).toEqual(expect.arrayContaining(['Java', 'Spring Boot', 'PostgreSQL']));
    const rejectable = factLedger(REJECTABLE);
    // Kubernetes and Terraform are on the line but in no bullet.
    expect(rejectable.unevidencedSkills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
  });

  it('recovers contact details from anywhere in the text', () => {
    const led = factLedger(REJECTABLE);
    expect(led.email).toBe('priya.nair@example.com');
    expect(led.phone).toBeTruthy();
    expect(led.name).toBe('Priya Nair');
  });
});

describe('checker score', () => {
  it('scores the rejectable file far below the clean one', () => {
    const bad = checkerScore(REJECTABLE, factLedger(REJECTABLE), JD);
    const good = checkerScore(CLEAN, factLedger(CLEAN), JD);
    expect(bad.total).toBeLessThan(good.total - 20);
  });

  it('is honestly out of 60 when no JD is given', () => {
    const s = checkerScore(CLEAN, factLedger(CLEAN), '');
    expect(s.max).toBe(60);
    expect(s.keywords).toBeNull();
    expect(s.note).toMatch(/out of 60/);
  });

  it('names every deduction with its reason', () => {
    const s = checkerScore(REJECTABLE, factLedger(REJECTABLE), JD);
    expect(s.deductions.length).toBeGreaterThan(0);
    s.deductions.forEach((d) => {
      expect(d.points).toBeGreaterThan(0);
      expect(d.why.length).toBeGreaterThan(10);
    });
  });

  it('extracts hard terms from a JD and ignores fluff', () => {
    const terms = jdHardTerms(JD);
    expect(terms).toEqual(expect.arrayContaining(['java', 'spring boot', 'postgresql', 'docker', 'kubernetes']));
    expect(terms).not.toContain('need');
  });
});

describe('recruiter scan', () => {
  it('rewards the clean resume on the six-second gate', () => {
    const good = recruiterScan(CLEAN, factLedger(CLEAN), 'backend developer');
    const bad = recruiterScan(REJECTABLE, factLedger(REJECTABLE), 'backend developer');
    expect(good.total).toBeGreaterThan(bad.total);
    const sixSec = good.gates.find((g) => g.gate.includes('6-second'));
    expect(sixSec.points).toBe(25);
  });
});

describe('rewrite (CONVERT)', () => {
  const packet = rewriteResume(REJECTABLE, { target: 'backend developer', jd: JD });

  it('raises both scores', () => {
    expect(packet.after.checker).toBeGreaterThan(packet.before.checker);
    expect(packet.after.recruiter).toBeGreaterThan(packet.before.recruiter);
  });

  it('keeps the person’s facts', () => {
    expect(packet.resume).toContain('PRIYA NAIR');
    expect(packet.resume).toContain('priya.nair@example.com');
    // Their real bullets survive, re-opened without the banned duty phrasing.
    expect(packet.resume).toMatch(/backend development at a startup/i);
    expect(packet.resume).not.toMatch(/responsible for/i);
    expect(packet.resume).not.toMatch(/worked on/i);
  });

  it('never invents: no number appears that the source did not contain', () => {
    const sourceNumbers = (REJECTABLE.match(/\d[\d,.]*/g) || []);
    const outputNumbers = (packet.resume.match(/\d[\d,.]*/g) || []);
    outputNumbers.forEach((n) => expect(sourceNumbers).toContain(n));
  });

  it('reports unevidenced skills, and never ships a placeholder in their place', () => {
    /*
     * The rule was: drop every skill no bullet proves. On this fixture that
     * is all of them — the bullets are duty-phrased and name no tool — so the
     * page came back with "[ list the tools your bullets actually show ]"
     * where the student's Java, Spring Boot and React used to be. They lost
     * their own skills line, the keyword check fell to zero, and the score
     * went DOWN: the rewrite was making the resume worse and reporting it as
     * the student's problem.
     *
     * Deleting a claim somebody made is not honesty, it is deletion. The line
     * survives; which entries no bullet backs is reported instead, and that
     * report is what the interview then asks about.
     */
    const lines = packet.resume.split('\n');
    const skillsLine = lines[lines.findIndex((l) => l === 'SKILLS') + 1] || '';
    expect(skillsLine).not.toMatch(/\[ list the tools/i);
    expect(skillsLine).toMatch(/Java/);
    /* The unevidenced ones are still named as unevidenced. */
    expect(packet.essentials.dropped.join(' ')).toMatch(/Kubernetes/);
    expect(packet.ledger.unevidencedSkills.join(' ')).toMatch(/Terraform/);
  });

  it('puts the evidenced skills first and deletes none of them', () => {
    /*
     * Evidence decides the order, not who survives.
     *
     * Keeping only what a bullet proves removed Docker and Terraform from a
     * real resume's "AWS, Docker, Kubernetes, Terraform" — the keyword count
     * halved and tailoring handed back a page scoring four points lower than
     * the one uploaded. The student watched two of their skills be deleted
     * and called an improvement. What the bullets prove now leads, where a
     * reader and a parser both look; the rest keep their place and are
     * reported as unevidenced.
     */
    const p = rewriteResume([
      'Asha Rao', 'asha@example.com | +91 90000 00000',
      '', 'Experience', 'Backend Developer | Zeta | Jan 2023 - Present',
      '- Built a REST API in Java with Spring Boot serving 5,000 requests a day',
      '', 'Skills', 'Java, Spring Boot, Kubernetes, Terraform',
    ].join('\n'), { target: 'backend developer' });
    const l = p.resume.split('\n');
    const line = l[l.findIndex((x) => x === 'SKILLS') + 1] || '';
    /* Java is proven by a bullet, so it leads. Kubernetes and Terraform are
       not, so they follow — but they are still the student's own claims and
       are still on the page. */
    expect(line.indexOf('Java')).toBeLessThan(line.toLowerCase().indexOf('kubernetes'));
    expect(line).toMatch(/Kubernetes/i);
    expect(p.essentials.dropped.join(' ')).toMatch(/Kubernetes|Terraform/i);
  });

  it('lists what the JD wants that the ledger cannot prove, and states the ceiling', () => {
    /* Spelled as the posting spells them — this list is read by a person. */
    const missing = packet.notClaimed.map((t) => t.toLowerCase());
    expect(missing).toEqual(expect.arrayContaining(['postgresql', 'docker']));
    expect(packet.ceiling).toMatch(/cannot close that gap/i);
  });

  it('does not list a fragment of a term it has already listed', () => {
    /* "REST API, REST, API" is one demand written three times, and it made
       the ceiling sentence read like a far larger gap than it was. */
    const missing = packet.notClaimed.map((t) => t.toLowerCase());
    missing.forEach((t) => {
      const swallowedBy = missing.filter((o) => o !== t && o.length > t.length && o.split(/\s+/).includes(t));
      expect(swallowedBy).toHaveLength(0);
    });
  });

  it('evaluates the ship gate instead of asserting it', () => {
    expect(packet.shipGate.checks).toHaveLength(12);
    packet.shipGate.checks.forEach((c) => {
      expect(typeof c.pass).toBe('boolean');
      expect(c.why.length).toBeGreaterThan(0);
    });
  });

  it('never claims to be unrejectable', () => {
    expect(packet.caveat).toMatch(/no resume is unrejectable/i);
  });

  it('an already-clean resume converts without losing score', () => {
    const clean = rewriteResume(CLEAN, { target: 'backend developer', jd: JD });
    expect(clean.after.checker).toBeGreaterThanOrEqual(clean.before.checker - 2);
    expect(clean.shipGate.checks.find((c) => c.check === 'Zero unverified claims').pass).toBe(true);
  });

  it('leads with projects when they are the hire signal', () => {
    const studentResume = [
      'Arjun Rao', 'arjun@example.com +91 91234 56789', '',
      'Projects',
      'Chat App — React, Socket.io',
      '- Built a real-time chat used by 60 classmates with React and Socket.io',
      'Expense Tracker',
      '- Wrote a Flask API and SQLite store tracking 900 records',
      '',
      'Skills', 'React, Socket.io, Flask, SQLite', '',
      'Education', 'B.Tech CSE, 2022 – 2026',
    ].join('\n');
    const p = rewriteResume(studentResume, { target: 'full stack developer' });
    const projAt = p.resume.indexOf('PROJECTS');
    expect(projAt).toBeGreaterThan(-1);
    expect(p.essentials.projectLed).toBe(true);
  });
});

describe('v4.0: strength bands (Path A)', () => {
  const { strengthBand } = require('../../services/v2/atsResumeEngine');

  it('bands on the lower of the two scores', () => {
    expect(strengthBand({ total: 90, max: 100, parse: 30 }, { total: 40 })).toBe('weak');
    expect(strengthBand({ total: 65, max: 100, parse: 28 }, { total: 75 })).toBe('salvageable');
    expect(strengthBand({ total: 85, max: 100, parse: 30 }, { total: 88 })).toBe('strong');
  });

  it('does not inflate a partial checker into a band', () => {
    /* 49/60 is 82% only because the keyword block was never scored. Reading
       that as "strong" made one resume strong without a JD and weak with one. */
    const partial = { total: 49, max: 60, parse: 28 };
    const full = { total: 49, max: 100, parse: 28 };
    const recruiter = { total: 62 };
    expect(strengthBand(partial, recruiter)).toBe(strengthBand(partial, recruiter));
    expect(strengthBand(partial, recruiter)).toBe('salvageable');   /* judged on the recruiter scan */
    expect(strengthBand(full, recruiter)).toBe('weak');             /* 49% checker drags it down */
  });

  it('will not award a full six-second match when no target is known', () => {
    const led = factLedger(CLEAN);
    const withTarget = recruiterScan(CLEAN, led, 'backend developer');
    const noTarget = recruiterScan(CLEAN, led, '');
    const gateOf = (s) => s.gates.find((g) => g.gate.includes('6-second')).points;
    expect(gateOf(withTarget)).toBe(25);
    expect(gateOf(noTarget)).toBeLessThan(25);
    expect(noTarget.total).toBeLessThan(100);
  });

  it('a parse under 16/30 is weak regardless of the rest', () => {
    expect(strengthBand({ total: 80, max: 100, parse: 12 }, { total: 85 })).toBe('weak');
  });

  it('the rejectable file lands in weak and carries the interview', () => {
    const p = rewriteResume(REJECTABLE, { target: 'backend developer', jd: JD });
    expect(p.band).toBe('weak');
    expect(p.path).toBe('A');
    expect(p.interview.questions.length).toBeGreaterThan(0);
  });

  it('a strong resume gets at most one question', () => {
    const p = rewriteResume(CLEAN, { target: 'backend developer', jd: JD });
    expect(['salvageable', 'strong']).toContain(p.band);
    if (p.band === 'strong') expect(p.interview.questions.length).toBeLessThanOrEqual(1);
  });

  it('the ship gate now runs twelve checks including path and PDF', () => {
    const p = rewriteResume(CLEAN, { target: 'backend developer', jd: JD });
    expect(p.shipGate.checks).toHaveLength(12);
    expect(p.shipGate.checks.find((c) => c.check === 'Path and band stated').why).toMatch(/Path A/);
    expect(p.shipGate.checks.find((c) => c.check.includes('PDF')).why).toMatch(/rewrite\.pdf/);
  });
});

describe('v4.0: the interview asks only what is missing', () => {
  const { interviewQuestions } = require('../../services/v2/atsResumeEngine');

  it('skips identity questions the ledger already answers', () => {
    const led = factLedger(CLEAN);
    const iv = interviewQuestions(led, { target: 'backend developer', jd: JD });
    const fields = iv.questions.map((q) => q.field);
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('email');
    expect(fields).not.toContain('phone');
  });

  it('asks for the target first when none is given', () => {
    const iv = interviewQuestions(factLedger(CLEAN), {});
    expect(iv.questions[0].field).toBe('target');
    expect(iv.questions[0].block).toBe(1);
  });

  it('asks for no prose: not a metric, not evidence, not a description', () => {
    /*
     * Both of these used to be asked and both were typed answers — "one real
     * number you will stand behind", "for each skill, what did you build with
     * it?". The brief for this agent is that nothing is typed except a name,
     * an email, a phone number and two profile links, and these were the last
     * two holdouts. They were also the questions people abandoned the
     * interview on, which is the same fact from the other side.
     *
     * The metric question additionally could not terminate: it is derived
     * from the ledger, and typing a number does not put that number inside a
     * bullet, so it asked itself again on every turn — seventeen times in one
     * walk-through.
     *
     * Nothing is lost. The climb puts projects on the page carrying their own
     * numbers, and the student fills the blanks in as they build them, which
     * is when they will actually know what the number was.
     */
    const scopeless = [
      'Ravi Kumar', 'ravi@example.com +91 90000 11111', '',
      'Experience',
      'Developer | Acme | Jan 2024 – Present',
      '- Built the invoicing module in Java and Spring Boot',
      '- Wrote the PostgreSQL reporting layer',
      '', 'Skills', 'Java, Spring Boot, PostgreSQL',
    ].join('\n');
    [REJECTABLE, scopeless].forEach((page) => {
      const iv = interviewQuestions(factLedger(page), { target: 'backend developer', jd: JD });
      const fields = iv.questions.map((q) => q.field);
      expect(fields).not.toContain('metric');
      expect(fields).not.toContain('evidence');
    });
  });

  it('carries the stop rule so nobody waits for a perfect life story', () => {
    const iv = interviewQuestions(factLedger(CLEAN), { target: 'x', jd: 'y' });
    expect(iv.canBuild).toBe(true);
    expect(iv.stopRule).toMatch(/Stop asking/);
  });
});

describe('running the rewrite twice', () => {
  const SOURCE = [
    'Bishal Nag', 'bishal@example.com +91 98765 43210', '',
    'Experience', 'Senior DevOps Engineer | Acme | Jan 2022 - Present',
    '- Managed Kubernetes clusters and Terraform on Azure for 12 services', '',
    'Skills', 'Azure, Kubernetes, Terraform, Jenkins, Docker', '',
    'Education', 'B.Tech CSE, 2021',
  ].join('\n');
  const convert = (text) => rewriteResume(text, { target: 'DevOps Engineer', mode: 'CONVERT' }).resume;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  it('produces the same document — converting a converted page changes nothing', () => {
    const once = convert(SOURCE);
    expect(norm(convert(once))).toBe(norm(once));
  });

  it('never grows a second bullet on a line that already had one', () => {
    /* "- B.Tech" became "- - B.Tech" and then "- - - B.Tech": a student
       pressing "fix it" twice watched their resume decay. */
    let text = SOURCE;
    for (let i = 0; i < 4; i += 1) text = convert(text);
    expect(text).not.toMatch(/-\s+-/);
    expect(text).toMatch(/^- B\.Tech CSE, 2021$/m);
  });

  it('does not drift in length across repeated passes', () => {
    let text = convert(SOURCE);
    const first = text.length;
    for (let i = 0; i < 3; i += 1) text = convert(text);
    expect(text.length).toBe(first);
  });
});

describe('impact bullets', () => {
  it('strips banned openers and keeps the substance', () => {
    expect(impactBullet('Responsible for backend development')).toBe('Backend development');
    expect(impactBullet('worked on a student portal')).toBe('A student portal');
  });

  it('strips first person — a resume bullet is not a diary line', () => {
    expect(impactBullet('I built the payments API in Go')).toBe('Built the payments API in Go');
    expect(impactBullet('We have shipped three releases')).toBe('Shipped three releases');
    /* "Managing" is a gerund, which the verb check reads as no verb at all,
       so the past tense of the same word goes in — grammar, not a new claim. */
    expect(impactBullet('I was managing a team of 4')).toBe('Managed a team of 4');
  });

  it('leaves a strong bullet alone', () => {
    expect(impactBullet('Built REST APIs in Spring Boot')).toBe('Built REST APIs in Spring Boot');
  });
});
