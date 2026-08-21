'use strict';

/**
 * Tailoring is an improvement or it is a bug.
 *
 * A student uploaded a page scoring 80, asked for it to be tailored, and got
 * 77 back. Against a real posting the header said 37. Two separate faults sat
 * behind that: the rewrite was deleting skills no bullet happened to name, and
 * the score silently changed scale when a job description appeared — 40 of the
 * 100 points becoming keyword overlap with an advert the person had just
 * chosen. Neither was the resume getting worse, and both looked exactly like
 * it was.
 */

const A = require('../../routes/v2/resumeAgent');
const E = require('../../services/v2/atsResumeEngine');

const person = (name, title, skills, bullets) => [
  name, title, `${name}@example.com | +91 90000 00000 | github.com/x`,
  '', 'EXPERIENCE', `${title.split('|')[0].trim()} | Northwind | Jan 2023 - Present`,
  ...bullets.map((b) => `- ${b}`),
  '', 'SKILLS', skills, '', 'EDUCATION', 'B.Tech Computer Science, 2019 - 2023',
].join('\n');

const CASES = [
  ['devops', person('BISHAL', 'DevOps Engineer | AWS', 'AWS, Docker, Kubernetes, Terraform, Jenkins',
    ['Built Azure DevOps pipelines across 12 services, cutting deploy time from 40 to 6 minutes'])],
  ['backend', person('PRIYA', 'Backend Engineer | Java', 'Java, Spring Boot, SQL, Docker, Redis',
    ['Built REST APIs in Java serving 5,000 requests a day, cutting latency 30%'])],
  ['frontend', person('ROHAN', 'Frontend Engineer | React', 'React, TypeScript, CSS, Jest, Webpack',
    ['Built the dashboard in React used by 2,000 people a week'])],
  ['data', person('ASHA', 'Data Analyst | SQL', 'SQL, Python, Pandas, Tableau, Excel',
    ['Modelled a 400,000-row dataset, cutting the weekly report from 40 minutes to 6'])],
  ['ml', person('KIRAN', 'ML Engineer | Python', 'Python, PyTorch, SQL, Docker, MLflow',
    ['Trained a classifier on 90,000 records, lifting precision from 71% to 88%'])],
  ['qa', person('NEHA', 'QA Engineer | Automation', 'Selenium, Java, Jest, CI/CD, Postman',
    ['Automated 240 regression cases, cutting the release check from 2 days to 3 hours'])],
];

/* No posting, a posting they nearly match, and one they mostly do not — the
   last is where choosing a job used to cost forty points. */
const JDS = [
  ['no posting', ''],
  ['a near miss', 'Backend Engineer. Must have: Java, Spring Boot, PostgreSQL, Docker.'],
  ['a far miss', 'Backend Engineer at GitLab. Ruby, Go, GraphQL, Redis, Kafka, Elasticsearch, gRPC required.'],
];

describe('the tailor never hands back a worse page', () => {
  CASES.forEach(([name, resume]) => {
    JDS.forEach(([label, jd]) => {
      it(`${name} against ${label}`, () => {
        const before = A.scanResume(resume, '').score;
        const p = E.rewriteResume(resume, { target: '', jd, mode: 'CONVERT' });
        const after = A.scanResume(p.resume, '').score;

        /* Choosing a job may not make your resume worse. */
        expect(after).toBeGreaterThanOrEqual(before);

        /*
         * And no skill the person listed may vanish. Keeping only what a
         * bullet proves deleted Docker and Terraform from a real page, which
         * halved its keyword count — the drop this test exists to catch.
         */
        const listed = E.factLedger(resume).statedSkills.map((s) => s.toLowerCase());
        const kept = String(p.resume).toLowerCase();
        expect(listed.filter((s) => !kept.includes(s))).toEqual([]);
      });
    });
  });
});
