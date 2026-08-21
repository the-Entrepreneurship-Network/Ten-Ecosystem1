'use strict';

const {
  fitness, atsMatch, requiredYears, requiredSeniority, domainsOf
} = require('../../services/v2/jobFitness');

const DEV = {
  role: 'full stack developer',
  seniority: 'entry',
  years: 2,
  skills: ['react', 'node', 'mongodb', 'typescript', 'aws'],
  projects: ['Built a React and Node booking app with MongoDB behind it'],
  education: 'B.Tech Computer Science',
  domains: [],
  summary: ''
};

describe('reading requirements out of a posting', () => {
  it.each([
    ['3+ years of experience', 3],
    ['2-4 years experience required', 2],
    ['minimum 5 years in backend', 5],
    ['at least 1 year of experience', 1],
    ['6 years of experience', 6],
    ['no numbers here at all', null]
  ])('reads %j as %s', (text, expected) => {
    expect(requiredYears(text)).toBe(expected);
  });

  it('picks the lower bound of a range, since that is what gates applying', () => {
    expect(requiredYears('looking for 4-8 years')).toBe(4);
  });

  it.each([
    ['Senior Backend Engineer', 'senior'],
    ['Software Engineer Intern', 'intern'],
    ['Fresher / Entry level role', 'entry'],
    ['Associate Developer, mid-level', 'mid'],
    ['Developer', null]
  ])('reads seniority of %j as %s', (text, expected) => {
    expect(requiredSeniority(text)).toBe(expected);
  });

  it('spots the industry a posting sits in', () => {
    expect(domainsOf('payments and lending platform')).toContain('fintech');
    expect(domainsOf('a clinical trials platform')).toContain('health');
  });
});

describe('fitness', () => {
  it('rates a matching entry-level job as a strong fit', () => {
    const result = fitness(DEV, {
      title: 'Full Stack Developer (Entry level)',
      description: 'Work with React, Node and MongoDB. 1+ years experience.',
      tags: ['react', 'node']
    });
    expect(result.percent).toBeGreaterThanOrEqual(80);
    expect(result.band).toBe('strong');
  });

  it('marks a senior role far above the candidate as a stretch', () => {
    const result = fitness(DEV, {
      title: 'Principal Security Architect',
      description: 'Minimum 10 years leading SOC teams. SIEM, threat modelling, cryptography.',
      tags: ['security']
    });
    expect(result.band).toBe('stretch');
    expect(result.percent).toBeLessThan(60);
  });

  it('explains itself in terms of the actual gap', () => {
    const result = fitness(DEV, {
      title: 'Backend Engineer',
      description: 'Node and MongoDB. 5+ years of experience required.',
      tags: []
    });
    expect(result.reasons.join(' ')).toMatch(/3 years under the 5-year requirement/);
  });

  it('does not punish a candidate for what the posting never asked', () => {
    const bare = fitness(DEV, { title: 'Full Stack Developer', description: 'React and Node.', tags: [] });
    const withDegree = fitness(DEV, {
      title: 'Full Stack Developer',
      description: 'React and Node. B.Tech required. 2 years experience.',
      tags: []
    });
    // A silent posting scores on what it does say, so it must not land lower
    // than the same posting that adds requirements this candidate meets.
    expect(bare.percent).toBeGreaterThan(50);
    expect(withDegree.percent).toBeGreaterThanOrEqual(bare.percent - 10);
  });

  it('says so rather than guessing when there is nothing to go on', () => {
    const result = fitness({ skills: [] }, { title: '', description: '', tags: [] });
    expect(result.band).toBe('unknown');
    expect(result.percent).toBe(0);
  });

  it('does not let a posting that says nothing outrank a real match', () => {
    // This is what put a data-labelling gig at 100% above every dev role:
    // it named no skills, no seniority and no years, so the average was taken
    // over one weak signal.
    const vague = fitness(DEV, {
      title: 'Face Deduplication Collection',
      description: '短期 collection task. Flexible hours.',
      tags: []
    });
    const real = fitness(DEV, {
      title: 'Full Stack Developer',
      description: 'React, Node and MongoDB. 2+ years. Entry level welcome.',
      tags: ['react', 'node']
    });
    expect(vague.percent).toBeLessThan(real.percent);
    expect(vague.confidence).toBeLessThan(50);
    expect(vague.reasons.join(' ')).toMatch(/states little/);
  });

  it('does not read every resume as edtech because it has an Education section', () => {
    // "education" and "learning" matched everybody, so the domain signal was
    // firing on section headings rather than industry experience.
    expect(domainsOf('Education\nB.Tech Computer Science')).not.toContain('edtech');
    expect(domainsOf('machine learning engineer')).not.toContain('edtech');
    expect(domainsOf('built an edtech learning platform')).toContain('edtech');
  });

  it('is not fooled by a substring: "full" in "full-time" is not a role match', () => {
    const warehouse = fitness(DEV, {
      title: 'Full-time Warehouse Associate',
      description: 'Full-time position. Lifting required.',
      tags: []
    });
    expect(warehouse.percent).toBeLessThan(60);
  });
});

describe('ATS matching', () => {
  const JOB = 'Looking for React, TypeScript and GraphQL experience on a Node backend.';

  it('reports the share of the posting vocabulary the resume carries', () => {
    const strong = atsMatch('I work with React, TypeScript, GraphQL and Node daily.', JOB, DEV.skills);
    const weak = atsMatch('I mostly write COBOL.', JOB, DEV.skills);
    expect(strong.percent).toBeGreaterThan(weak.percent);
  });

  it('names what is missing so it can be fixed', () => {
    const result = atsMatch('React and Node only.', JOB, DEV.skills);
    expect(result.missing.join(' ')).toMatch(/graphql/i);
  });

  it('flags the 70% pass mark', () => {
    const result = atsMatch('nothing relevant whatsoever', JOB, DEV.skills);
    expect(result.passes).toBe(false);
  });
});
