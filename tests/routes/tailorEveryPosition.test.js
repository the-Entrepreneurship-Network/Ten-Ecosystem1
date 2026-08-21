'use strict';

/**
 * Tailoring must not cost points. For every position, not five of them.
 *
 * The rule was proved on a handful of roles — DevOps, backend, data, frontend,
 * QA — and shipped, and then somebody tailored for a Business Intelligence
 * Analyst and watched 83 become 82. The cause was never in those five: a long
 * title above the name was long enough to be filed as experience, so the title
 * itself became a verb-less bullet, the rewrite emitted it twice, and the verb
 * ratio fell. Short titles slipped under the length test, which is exactly why
 * the five-role sample said the feature worked.
 *
 * So the check is the whole world of titles: every role the picker offers, and
 * a wide spread it does not — seniority prefixes, hyphenated forms, regional
 * spellings, and specialisms from hardware to actuarial work. A student types
 * whatever the posting says, and the posting says whatever it says.
 */

const express = require('express');
const request = require('supertest');
const career = require('../../services/v2/careerData');

jest.setTimeout(10 * 60 * 1000);

function agent() {
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

/* A believable page for whatever the role is: a title, two measured bullets,
   a few plausible tools. The point under test is the tailor, not the fixture. */
const resumeFor = (role) => [
  'ANJALI RAO', role,
  'anjali@example.com | +91 90000 00000 | github.com/anjali',
  '', 'EXPERIENCE', `${role} | Northwind | Jan 2023 - Present`,
  '- Delivered the core workflow end to end, handling 4,000 records a day and cutting turnaround from 40 minutes to 6',
  '- Wrote the automated checks covering 40 paths, catching 18 regressions before release',
  '', 'PROJECTS', '- Campus portal used by 300 students',
  '', 'SKILLS', 'Python, SQL, Git, Docker, Linux',
  '', 'EDUCATION', 'B.Tech Computer Science, 2019 - 2023',
].join('\n');

const pickAll = (out) => {
  const o = out.options || {};
  const flat = [...(o.options || []), ...((o.groups || []).flatMap((g) => g.options || []))];
  return flat.length ? flat.map((c) => c.value).join(', ') : 'skip';
};

/* Titles the picker does not list. Real postings, all of them. */
const OFF_MENU = [
  'Senior Software Engineer', 'Staff Engineer', 'Principal Engineer', 'Lead Developer',
  'Junior Developer', 'Software Development Engineer II', 'SDE-1', 'SDE 2',
  'Member of Technical Staff', 'Engineering Manager', 'Head of Engineering',
  'Full Stack Developer', 'Front End Developer', 'Back End Developer',
  'React Developer', 'Node.js Developer', 'Java Developer', 'Python Developer',
  '.NET Developer', 'Golang Engineer', 'Rust Engineer', 'Salesforce Developer',
  'SAP Consultant', 'Kubernetes Engineer', 'Observability Engineer', 'FinOps Engineer',
  'Data Platform Engineer', 'Analytics Manager', 'Deep Learning Engineer',
  'LLM Engineer', 'Generative AI Engineer', 'Search Engineer', 'Payments Engineer',
  'Trust and Safety Engineer', 'Accessibility Engineer', 'Performance Engineer',
  'Developer Experience Engineer', 'Technical Account Manager', 'Presales Consultant',
  'IT Support Specialist', 'Network Operations Engineer', 'Systems Analyst',
  'Information Security Manager', 'GRC Analyst', 'Threat Intelligence Analyst',
  'Digital Forensics Analyst', 'Cryptography Engineer', 'Product Owner',
  'Delivery Manager', 'Agile Coach', 'Interaction Designer', 'Visual Designer',
  'Design Systems Engineer', 'Content Designer', 'Documentation Engineer',
  'Solutions Consultant', 'Integration Engineer', 'Mainframe Developer',
  'COBOL Developer', 'ETL Developer', 'Power BI Developer', 'Tableau Developer',
  'Snowflake Engineer', 'Databricks Engineer', 'Test Automation Architect',
  'SDET', 'Electronics Engineer', 'VLSI Engineer', 'ASIC Design Engineer',
  'RF Engineer', 'Controls Engineer', 'Mechatronics Engineer', 'Avionics Engineer',
  'Geospatial Engineer', 'Computational Biologist', 'Medical Imaging Engineer',
  'Game Engine Programmer', 'Technical Artist', 'Audio Programmer',
  'Blockchain Architect', 'Web3 Developer', 'Growth Engineer',
  'Marketing Technologist', 'Revenue Operations Analyst', 'Supply Chain Analyst',
  'Actuarial Analyst', 'Risk Engineer', 'Research Engineer', 'Technical Recruiter',
  'Developer Relations Engineer', 'Cloud Operations Engineer', 'Privacy Engineer',
  'Automation Engineer', 'Process Engineer', 'Quality Analyst',
  'Enterprise Architect', 'Domain Architect',
];

async function tailorFor(role) {
  const a = agent();
  const resume = resumeFor(role);
  let out = await turn(a, resume, null);
  const before = out.report.score;

  /* A posting for the same role, which is the ordinary case — and the one
     that must never cost points. */
  out.session.jd = `${role}. Must have: Python, SQL, Docker, Kubernetes, Kafka.`;
  out = await turn(a, 'tailor my resume', out.session);
  for (let i = 0; i < 8 && out.kind === 'ask'; i += 1) {
    out = await turn(a, pickAll(out), out.session);
  }
  return { before, after: out.report && out.report.score };
}

describe('every position the picker offers', () => {
  const roles = career.POSITION_GROUPS.flatMap((g) => g.roles);

  it(`covers all ${roles.length} of them without losing a point`, async () => {
    const drops = [];
    for (const role of roles) {
      /* Serial on purpose: each journey is several round trips and running
         seventy-nine of them at once tells you nothing except that a laptop
         has a thread limit. */
      // eslint-disable-next-line no-await-in-loop
      const { before, after } = await tailorFor(role);
      if (!(after >= before)) drops.push(`${role}: ${before} -> ${after}`);
    }
    expect(drops).toEqual([]);
  });
});

describe('and the titles it does not offer', () => {
  it(`covers ${OFF_MENU.length} off-menu titles without losing a point`, async () => {
    const drops = [];
    for (const role of OFF_MENU) {
      // eslint-disable-next-line no-await-in-loop
      const { before, after } = await tailorFor(role);
      if (!(after >= before)) drops.push(`${role}: ${before} -> ${after}`);
    }
    expect(drops).toEqual([]);
  });
});
