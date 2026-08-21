'use strict';

/**
 * Build one resume through the agent and write it to a PDF.
 *
 * Kept in the repo rather than run as a one-off paste, because the useful
 * thing about it is repeatability: change the builder, run this, look at the
 * actual document a student would receive. It prints both scores — the text
 * the builder produced and the text an ATS pulls back out of the rendered
 * PDF — since only the second one is the promise the portal makes.
 *
 *   node scripts/build-sample-resume.js [outputPath]
 */

const fs = require('fs');
const path = require('path');
const agent = require('../routes/v2/resumeAgent');

const DETAILS = {
  name: 'Aditi Sharma',
  role: 'Full-Stack Web Developer',
  email: 'aditi.sharma@example.com',
  phone: '+91 98765 43210',
  linkedin: 'linkedin.com/in/aditisharma',
  github: 'github.com/aditisharma',
  location: 'Bengaluru',
  skills: 'React, Node.js, Express, MongoDB, TypeScript, REST API, JWT, Redux, Docker, Git, Jest, Tailwind',
  experience:
    'built a college event booking platform used by 300 students, cutting manual registration time 40%; ' +
    'migrated the API to TypeScript and raised test coverage to 85%',
  projects:
    'real-time chat with Socket.io serving 120 concurrent users; ' +
    'personal finance dashboard with charts and CSV import',
  education: 'B.Tech Computer Science Engineering, 2022 - 2026',
};

(async () => {
  const out = process.argv[2] || path.join(__dirname, '..', 'Aditi-Sharma-TEN-Resume.pdf');

  const built = agent.buildResume(DETAILS);
  const buf = await agent.resumePdfBuffer(built.text);
  fs.writeFileSync(out, buf);

  let pdfScore = 'n/a';
  let hazards = 'n/a';
  try {
    const extracted = (await require('pdf-parse')(buf)).text || '';
    const rescored = agent.scanResume(extracted, DETAILS.role);
    pdfScore = `${rescored.score}/100`;
    hazards = String(rescored.hazards.length);
  } catch (e) {
    pdfScore = `could not verify (${e.message})`;
  }

  console.log(`role      : ${DETAILS.role}`);
  console.log(`text score: ${built.report.score}/100 (${built.report.verdict})`);
  console.log(`pdf score : ${pdfScore}   layout hazards: ${hazards}`);
  console.log(`missing   : ${built.missing.length ? built.missing.map((m) => m.field).join(', ') : 'nothing'}`);
  console.log(`written   : ${out} (${(buf.length / 1024).toFixed(1)} KB)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
