'use strict';

const { tailorResume, coverLetter, coldEmail, prioritise } = require('../../services/v2/jobMaterials');

const RESUME = [
  'Asha Menon',
  'asha@example.com · Bengaluru',
  '',
  'Experience',
  'Built a booking platform in React and Node handling 4000 users a month.',
  'Wrote the MongoDB aggregation layer that cut report times from 30s to 2s.',
  'Maintained internal Excel reporting for the operations team.',
  '',
  'Projects',
  'Created a TypeScript CLI that generates invoices from a Postgres database.',
  '',
  'Education',
  'B.Tech Computer Science, 2022'
].join('\n');

const PROFILE = {
  name: 'Asha Menon',
  role: 'full stack developer',
  seniority: 'entry',
  years: 2,
  location: 'Bengaluru',
  skills: ['react', 'node', 'mongodb', 'typescript', 'excel'],
  projects: ['Created a TypeScript CLI that generates invoices'],
  education: 'B.Tech Computer Science'
};

const JOB = {
  title: 'Full Stack Developer',
  company: 'Northwind',
  description: 'React and Node required. MongoDB a plus. Kubernetes experience desirable.',
  tags: ['react', 'node']
};

describe('tailored resume', () => {
  it('puts the bullets carrying the posting keywords first', () => {
    const out = tailorResume(PROFILE, JOB, RESUME);
    const reactLine = out.text.indexOf('booking platform in React');
    const excelLine = out.text.indexOf('Excel reporting');
    expect(reactLine).toBeLessThan(excelLine);
  });

  it('never invents a skill the resume does not evidence', () => {
    const out = tailorResume(PROFILE, JOB, RESUME);
    // The posting wants Kubernetes; the resume has never mentioned it.
    expect(out.text.toLowerCase()).not.toContain('kubernetes');
    expect(out.gaps.join(' ').toLowerCase()).toContain('kubernetes');
  });

  it('reports the keyword match before and after tailoring', () => {
    const out = tailorResume(PROFILE, JOB, RESUME);
    expect(typeof out.ats.before).toBe('number');
    expect(typeof out.ats.after).toBe('number');
  });

  it('names the file so it is recognisable in a downloads folder', () => {
    const out = tailorResume(PROFILE, JOB, RESUME);
    expect(out.filename).toBe('AshaMenon_Resume_Northwind_FullStack.txt');
  });

  it('keeps the education section', () => {
    expect(tailorResume(PROFILE, JOB, RESUME).text).toContain('B.Tech Computer Science');
  });
});

describe('cover letter', () => {
  it('stays under the 300 word limit', () => {
    const out = coverLetter(PROFILE, JOB, RESUME);
    expect(out.words).toBeLessThanOrEqual(300);
    expect(out.withinLimit).toBe(true);
  });

  it('mirrors the posting vocabulary rather than inventing its own', () => {
    const out = coverLetter(PROFILE, JOB, RESUME);
    expect(out.mirroredKeywords.length).toBeGreaterThan(0);
    out.mirroredKeywords.forEach((k) => {
      expect(JOB.description.toLowerCase()).toContain(k);
    });
  });

  it('avoids the words that give away machine writing', () => {
    const text = coverLetter(PROFILE, JOB, RESUME).text.toLowerCase();
    ['spearheaded', 'leveraged', 'synergy', 'passionate about', 'proven track record']
      .forEach((cliche) => expect(text).not.toContain(cliche));
  });

  it('flags clichés in the source resume instead of silently keeping them', () => {
    const puffed = RESUME.replace('Built a booking', 'Spearheaded a booking');
    expect(coverLetter(PROFILE, JOB, puffed).clichesInSource).toContain('spearheaded');
  });

  it('addresses the company by name', () => {
    expect(coverLetter(PROFILE, JOB, RESUME).text).toContain('Northwind');
  });
});

describe('cold email', () => {
  it('stays short enough to be read on a phone', () => {
    const out = coldEmail(PROFILE, JOB, RESUME, {});
    expect(out.words).toBeLessThanOrEqual(120);
    expect(out.withinLimit).toBe(true);
  });

  it('puts the role and the matching skills in the subject', () => {
    const out = coldEmail(PROFILE, JOB, RESUME, {});
    expect(out.subject).toContain('Full Stack Developer');
    expect(out.subject.toLowerCase()).toMatch(/react|node/);
  });

  it('leads with a proof point that has a number in it', () => {
    const out = coldEmail(PROFILE, JOB, RESUME, {});
    expect(out.proofUsed).toBe(true);
    // "cut report times from 30s to 2s" beats the bullet with no figures.
    expect(out.body).toMatch(/\d/);
  });

  it('ends on a question that can be answered in one word', () => {
    const out = coldEmail(PROFILE, JOB, RESUME, {});
    expect(out.body).toContain('Would it help if I sent my resume?');
  });

  it('uses the hiring manager name when there is one', () => {
    const named = coldEmail(PROFILE, JOB, RESUME, { hiringManager: 'Priya' });
    expect(named.body.startsWith('Hi Priya,')).toBe(true);
    expect(coldEmail(PROFILE, JOB, RESUME, {}).body.startsWith('Hi,')).toBe(true);
  });

  it('avoids the phrases that get cold email deleted', () => {
    const text = coldEmail(PROFILE, JOB, RESUME, {}).body.toLowerCase();
    ['passionate about', 'leveraged', 'synergy', 'proven track record', 'reaching out']
      .forEach((phrase) => expect(text).not.toContain(phrase));
  });

  it('comes with two spaced follow-ups, since most replies come from those', () => {
    const out = coldEmail(PROFILE, JOB, RESUME, {});
    expect(out.followUps).toHaveLength(2);
    expect(out.followUps[0].afterDays).toBeLessThan(out.followUps[1].afterDays);
    expect(out.followUps[1].body).toMatch(/last note/i);
  });

  it('accepts a custom ask', () => {
    const out = coldEmail(PROFILE, JOB, RESUME, { ask: 'Open to a 15 minute call this week?' });
    expect(out.body).toContain('Open to a 15 minute call this week?');
  });
});

describe('bullet prioritisation', () => {
  it('ranks by how many posting keywords a bullet carries', () => {
    const ranked = prioritise(
      ['Managed the office rota', 'Built a React and Node service with MongoDB'],
      ['react', 'node', 'mongodb']
    );
    expect(ranked[0].hits.length).toBe(3);
    expect(ranked[1].hits.length).toBe(0);
  });
});
