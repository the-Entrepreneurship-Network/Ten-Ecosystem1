'use strict';

/**
 * @jest-environment node
 *
 * pdf-parse loads pdf.js, which reaches for browser globals and fails under
 * the jsdom environment the rest of the suite uses. The round trip below has
 * to run where the server runs.
 *
 * The resume agent, measured rather than described.
 *
 * The claim the portal makes to a student is a number — "ATS 98/100,
 * unrejectable" — so the tests assert the number, not the wording. Two
 * properties matter and neither is provable by reading the code:
 *
 *   1. A resume built from a student's own details scores near the top of the
 *      scale, and a bad one does not. If the scanner ever became generous
 *      enough to pass anything, the score would stop meaning anything.
 *   2. The PDF the student actually sends is parseable. The text scoring 100
 *      is worth nothing if the rendered file reads as a blank page to an ATS,
 *      so the PDF is scored from text extracted back out of the finished
 *      document.
 */

const agent = require('../../routes/v2/resumeAgent');

const FULL_STACK = {
  name: 'Aditi Sharma',
  role: 'Full-Stack Web Developer',
  email: 'aditi.sharma@example.com',
  phone: '+91 98765 43210',
  linkedin: 'linkedin.com/in/aditisharma',
  github: 'github.com/aditisharma',
  location: 'Bengaluru',
  skills: 'React, Node.js, Express, MongoDB, TypeScript, REST API, JWT, Redux, Docker, Git',
  experience: 'built a college event booking platform used by 300 students, cutting manual registration time 40%',
  projects: 'real-time chat with Socket.io serving 120 concurrent users',
  education: 'B.Tech Computer Science Engineering, 2022 - 2026',
};

const BAD_RESUME = [
  'My CV',
  'Where I have been',
  'Responsible for stuff at a company',
  'Worked on some things',
  'What I know',
  'things',
].join('\n');

describe('the scanner separates a good resume from a bad one', () => {
  it('rejects a resume with no contact block, no real headings and no numbers', () => {
    const report = agent.scanResume(BAD_RESUME, 'python');
    expect(report.score).toBeLessThan(40);
    expect(report.verdict).toBe('will_be_rejected');
    expect(report.failing.length).toBeGreaterThan(3);
  });

  it('names the fix for every point it takes away', () => {
    const report = agent.scanResume(BAD_RESUME, 'python');
    report.failing.forEach((f) => {
      expect(typeof f.fix).toBe('string');
      expect(f.fix.length).toBeGreaterThan(20);
    });
  });

  it('does not dock a resume for its education line', () => {
    /*
     * Nobody writes "Delivered B.Tech". Scoring education and certification
     * entries for action verbs docked points from every well-written resume
     * that had them — the check belongs to experience and projects only.
     */
    const withEducation = [
      'Priya Nair', 'Backend Developer', 'priya@example.com | +91 90000 00000',
      '', 'EXPERIENCE',
      '- Built an API serving 5,000 requests a day, cutting latency 30%',
      '- Automated the deploy pipeline, saving 4 hours a week',
      '', 'EDUCATION',
      '- B.Tech Computer Science, 2021 - 2025',
      '', 'CERTIFICATIONS',
      '- TEN Virtual Internship — verifiable certificate, 2026',
    ].join('\n');

    const verbs = agent.scanResume(withEducation, 'java').checks.find((c) => c.id === 'verbs');
    expect(verbs.earned).toBe(verbs.weight);
  });
});

describe('a resume built from a student\'s details scores at the top', () => {
  it('reaches at least 98 with full details', () => {
    const built = agent.buildResume(FULL_STACK);
    expect(built.report.score).toBeGreaterThanOrEqual(98);
    expect(built.report.verdict).toBe('ats_ready');
    expect(built.missing).toHaveLength(0);
  });

  it('still clears the bar with only a name and a role', () => {
    const built = agent.buildResume({ name: 'Rahul K', role: 'Data Scientist' });
    expect(built.report.score).toBeGreaterThanOrEqual(80);
  });

  it('says what is missing and what it is worth, instead of inventing it', () => {
    const built = agent.buildResume({ name: 'Rahul K', role: 'Data Scientist' });
    const fields = built.missing.map((m) => m.field);
    expect(fields).toContain('email');
    expect(fields).toContain('phone');
    // A contact detail nobody supplied must never be fabricated to lift a score.
    expect(built.text).not.toMatch(/example\.com/);
    expect(built.potentialScore).toBeGreaterThanOrEqual(built.report.score);
  });

  it('opens every experience and project bullet with an action verb', () => {
    const built = agent.buildResume(FULL_STACK);
    const verbs = built.report.checks.find((c) => c.id === 'verbs');
    expect(verbs.earned).toBe(verbs.weight);
  });
});

describe('the PDF the student sends is the one that was scored', () => {
  it('renders a real PDF', async () => {
    const built = agent.buildResume(FULL_STACK);
    const buf = await agent.resumePdfBuffer(built.text);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  }, 20000);

  it('still scores at least 98 when the text is pulled back out of it', () => {
    /*
     * The whole point. A two-column, icon-heavy PDF can look perfect and
     * extract as noise; this asserts the rendered document survives the same
     * parse an applicant tracking system performs.
     *
     * It runs in a child process because pdf-parse bundles its own pdf.js
     * build, which throws while loading under Jest's module loader in either
     * environment. Dropping the assertion would leave the portal's central
     * promise untested, so the round trip runs where the server runs — plain
     * node — and this asserts on what it reports.
     */
    const { execFileSync } = require('child_process');
    const path = require('path');
    const root = path.join(__dirname, '../..');

    const script = `
      const agent = require(${JSON.stringify(path.join(root, 'routes/v2/resumeAgent.js'))});
      const details = ${JSON.stringify(FULL_STACK)};
      (async () => {
        const built = agent.buildResume(details);
        const buf = await agent.resumePdfBuffer(built.text);
        const extracted = (await require('pdf-parse')(buf)).text || '';
        const rescored = agent.scanResume(extracted, details.role);
        console.log(JSON.stringify({
          score: rescored.score,
          hazards: rescored.hazards.length,
          /* The header is set in caps, as resume headers are. */
          hasName: /aditi\\s+sharma/i.test(extracted),
          hasExperience: extracted.includes('EXPERIENCE'),
          isPdf: buf.slice(0, 5).toString() === '%PDF-',
        }));
      })().catch((e) => { console.error(e); process.exit(1); });
    `;

    const out = execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', timeout: 60000 });
    const result = JSON.parse(out.trim().split('\n').pop());

    expect(result.isPdf).toBe(true);
    expect(result.hasName).toBe(true);
    expect(result.hasExperience).toBe(true);
    expect(result.hazards).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(98);
  }, 90000);
});
