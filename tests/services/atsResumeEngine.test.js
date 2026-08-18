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

  it('drops unevidenced skills from the skills line and reports them', () => {
    const skillsLine = packet.resume.split('\n')[packet.resume.split('\n').findIndex((l) => l === 'SKILLS') + 1] || '';
    expect(skillsLine).not.toMatch(/kubernetes|terraform|leadership/i);
    expect(packet.essentials.dropped.join(' ')).toMatch(/Kubernetes/);
  });

  it('lists what the JD wants that the ledger cannot prove, and states the ceiling', () => {
    expect(packet.notClaimed).toEqual(expect.arrayContaining(['postgresql', 'docker']));
    expect(packet.ceiling).toMatch(/cannot close that gap/i);
  });

  it('evaluates the ship gate instead of asserting it', () => {
    expect(packet.shipGate.checks).toHaveLength(10);
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

describe('impact bullets', () => {
  it('strips banned openers and keeps the substance', () => {
    expect(impactBullet('Responsible for backend development')).toBe('Backend development');
    expect(impactBullet('worked on a student portal')).toBe('A student portal');
  });

  it('leaves a strong bullet alone', () => {
    expect(impactBullet('Built REST APIs in Spring Boot')).toBe('Built REST APIs in Spring Boot');
  });
});
