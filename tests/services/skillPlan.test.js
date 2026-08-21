'use strict';

/**
 * The gap plan, and the line it must not cross.
 *
 * The feature exists because a student asked for the missing skills to be
 * written onto the resume with the learning to follow. That trades a
 * document they can defend for one they cannot, so what ships instead is the
 * plan — and these tests are what keep the two apart.
 */

const { planFor } = require('../../services/v2/skillPlan');

const RESUME = [
  'Priya Nair',
  'Backend Developer',
  'priya@example.com | +91 90000 00000',
  '',
  'EXPERIENCE',
  'Backend Developer | Zeta | Jan 2023 - Present',
  '- Built an API in Java serving 5,000 requests a day',
  '',
  'SKILLS',
  'Java, Spring Boot',
  '',
  'EDUCATION',
  'B.Tech Computer Science, 2021 - 2025',
].join('\n');

const JD = 'Backend Engineer. Must have: Java, Kafka, Docker, PostgreSQL. Nice to have: Terraform.';

describe('it plans the gap instead of papering over it', () => {
  it('names what the posting wants and the page cannot prove', () => {
    const plan = planFor(RESUME, JD);
    expect(plan.ok).toBe(true);
    expect(plan.missing).toEqual(expect.arrayContaining(['Kafka', 'Docker', 'PostgreSQL']));
    /* Java is evidenced by a bullet, so it is not a gap. */
    expect(plan.missing).not.toContain('Java');
  });

  it('puts the essential terms before the nice-to-haves', () => {
    /* A weekend spent on a "nice to have" is a weekend that did not move
       the application. */
    const plan = planFor(RESUME, JD);
    const firstOptional = plan.plans.findIndex((p) => !p.essential);
    const lastEssential = plan.plans.map((p) => p.essential).lastIndexOf(true);
    if (firstOptional !== -1) expect(lastEssential).toBeLessThan(firstOptional);
  });

  it('gives steps somebody can actually follow, not "learn Kafka"', () => {
    const plan = planFor(RESUME, JD);
    const kafka = plan.plans.find((p) => /kafka/i.test(p.term));
    expect(kafka).toBeTruthy();
    expect(kafka.steps.length).toBeGreaterThanOrEqual(4);
    /* Every step is an instruction, not a topic. */
    kafka.steps.forEach((s) => expect(s.split(/\s+/).length).toBeGreaterThan(5));
    expect(kafka.hours).toMatch(/hours/);
  });

  it('leaves the numbers blank, because they come from the thing they built', () => {
    const plan = planFor(RESUME, JD);
    plan.plans.forEach((p) => {
      expect(p.bulletAfter).toMatch(/<[^>]+>/);
      /* Never a finished, fillable-in claim with invented figures. */
      expect(p.bulletAfter).not.toMatch(/\b\d{2,}\b/);
    });
  });

  it('says out loud that none of it belongs on the resume yet', () => {
    /*
     * The whole feature turns on this sentence. Without it the output reads
     * as a list of things to claim.
     */
    const plan = planFor(RESUME, JD);
    expect(plan.rule).toMatch(/not on your resume yet|should be until you have built it/i);
    expect(plan.rule).toMatch(/cannot walk through|fails the first question/i);
  });

  it('carries the question the project will be asked about', () => {
    const plan = planFor(RESUME, JD);
    plan.plans.forEach((p) => expect(String(p.defend).length).toBeGreaterThan(15));
  });

  it('treats a claimed-but-unproven skill as the cheapest gap to close', () => {
    const withClaim = RESUME.replace('Java, Spring Boot', 'Java, Spring Boot, Docker');
    const plan = planFor(withClaim, JD);
    expect(plan.weak).toContain('Docker');
    expect(plan.weakNote).toMatch(/no bullet behind/i);
  });

  it('says nothing to build when the page already proves everything', () => {
    const strong = RESUME.replace(
      '- Built an API in Java serving 5,000 requests a day',
      '- Built an API in Java on PostgreSQL, containerised with Docker, publishing to Kafka at 5,000 requests a day',
    );
    const plan = planFor(strong, 'Backend Engineer. Must have: Java, Kafka, Docker, PostgreSQL.');
    expect(plan.plans).toHaveLength(0);
  });

  it('still gives a concrete plan for a term it has no recipe for', () => {
    const plan = planFor(RESUME, 'Backend Engineer. Must have: Elixir.');
    const elixir = plan.plans.find((p) => /elixir/i.test(p.term));
    expect(elixir).toBeTruthy();
    expect(elixir.steps.length).toBeGreaterThanOrEqual(4);
    expect(elixir.steps.join(' ')).toMatch(/Elixir/);
  });
});
