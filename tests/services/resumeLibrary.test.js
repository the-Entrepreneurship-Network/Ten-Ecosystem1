'use strict';

/**
 * The library and the parser view — the two things this agent lacked that
 * every serious open-source builder has.
 *
 * A master with derivatives, so a person who tailors twice in a week still
 * has both; and a plain statement of what a machine pulls out of their file,
 * which is the only view here that is a fact rather than an opinion.
 */

const lib = require('../../services/v2/resumeLibrary');
const { parserView } = require('../../services/v2/parserView');

const CLEAN = [
  'Priya Nair',
  'Backend Developer',
  'priya@example.com | +91 98765 43210 | github.com/priyanair',
  '',
  'EXPERIENCE',
  'Backend Developer | Zeta | Jan 2023 - Present',
  '- Built an API on AWS serving 5,000 requests a day, cutting latency 30%',
  '- Automated deploys with Terraform, saving 4 hours a week',
  '',
  'SKILLS',
  'Java, Spring Boot, AWS, Terraform',
  '',
  'EDUCATION',
  'B.Tech Computer Science, 2021 - 2025',
].join('\n');

/* The same person as a two-column PDF extracts: columns interleaved, the
   place run into the year, no dates the parser can see. */
const MANGLED = [
  'PRIYA NAIR                                   Bengaluru',
  'Backend Developer                            priya at example dot com',
  '',
  'EXPERIENCE                                   EDUCATION',
  'Zeta                                         B.Tech CS',
  'Built an API                                 KIIT2025',
].join('\n');

describe('the master survives every tailoring', () => {
  it('keeps one version per posting and never overwrites the master', () => {
    let store = lib.setMaster(null, CLEAN);
    store = lib.saveVersion(store, { text: 'AMAZON VERSION', company: 'Amazon', role: 'Backend Engineer', score: 88, notClaimed: ['kafka'] });
    store = lib.saveVersion(store, { text: 'GOOGLE VERSION', company: 'Google', role: 'Backend Engineer', score: 91, notClaimed: [] });

    const listed = lib.listVersions(store);
    expect(listed.hasMaster).toBe(true);
    expect(listed.versions).toHaveLength(2);
    /* The one that mattered on Monday is still there on Tuesday. */
    expect(store.master).toContain('Priya Nair');
    expect(lib.getVersion(store, listed.versions[1].id).text).toBe('AMAZON VERSION');
  });

  it('keeps the caveat with the document', () => {
    /* A version opened in three weeks needs its note as much as its text. */
    let store = lib.saveVersion(null, { text: 'X', company: 'Amazon', role: 'SRE', score: 80, notClaimed: ['kubernetes', 'grafana'] });
    const v = lib.getVersion(store, lib.listVersions(store).versions[0].id);
    expect(v.notClaimed).toEqual(['kubernetes', 'grafana']);
    expect(v.score).toBe(80);
  });

  it('re-tailoring the same posting on the same day replaces that row', () => {
    let store = lib.saveVersion(null, { text: 'FIRST', company: 'Amazon', role: 'SRE' });
    store = lib.saveVersion(store, { text: 'SECOND', company: 'Amazon', role: 'SRE' });
    expect(lib.listVersions(store).versions).toHaveLength(1);
    expect(lib.getVersion(store, lib.listVersions(store).versions[0].id).text).toBe('SECOND');
  });
});

describe('the bullet library reaches across every version', () => {
  it('collects bullets from the master and the versions, deduplicated', () => {
    let store = lib.setMaster(null, CLEAN);
    store = lib.saveVersion(store, {
      text: ['P N', 'p@example.com', '', 'EXPERIENCE', 'Dev | Zeta | Jan 2023 - Present',
        '- Built an API on AWS serving 5,000 requests a day, cutting latency 30%',
        '- Wrote the Kafka consumer that processed 200,000 events a night'].join('\n'),
      company: 'Amazon', role: 'Backend Engineer',
    });
    const bullets = lib.bulletLibrary(store);
    /* The shared bullet appears once, not twice. */
    expect(bullets.filter((b) => /5,000 requests/.test(b.text))).toHaveLength(1);
    expect(bullets.some((b) => /Kafka consumer/.test(b.text))).toBe(true);
  });

  it('ranks by the posting\'s own terms, with a number worth something', () => {
    /* The part usually done with embeddings, done by counting — a bullet that
       names the required tool AND carries a figure is the first line. */
    const store = lib.setMaster(null, CLEAN);
    const ranked = lib.rankForJd(store, 'Backend Engineer. Must have: Terraform, AWS.', 5);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].hits.length).toBeGreaterThan(0);
    expect(ranked.every((b) => b.score > 0)).toBe(true);
  });

  it('says so when nothing matches, rather than ranking noise', () => {
    const store = lib.setMaster(null, CLEAN);
    expect(lib.rankForJd(store, 'Nurse. Must have: phlebotomy, triage, ACLS.', 5)).toHaveLength(0);
  });
});

describe('the quick check is short and specific', () => {
  it('passes a clean page and names what a weak one lacks', () => {
    const good = lib.quickCheck(CLEAN);
    expect(good.passed).toBeGreaterThanOrEqual(6);
    const bad = lib.quickCheck('My CV\nI am a hard worker\nResponsible for things');
    expect(bad.passed).toBeLessThan(good.passed);
    expect(bad.worst.length).toBeGreaterThan(0);
    bad.worst.forEach((w) => expect(w.note.length).toBeGreaterThan(20));
  });
});

describe('the parser view states facts, not opinions', () => {
  it('reports each field with the evidence for it', () => {
    const v = parserView(CLEAN);
    const email = v.fields.find((f) => f.name === 'Email');
    expect(email.value).toBe('priya@example.com');
    expect(email.confidence).toBe('high');
    expect(email.why).toMatch(/@/);
  });

  it('calls a two-column extract what it is', () => {
    /*
     * The point of the whole view: if the tool on your side cannot read the
     * document, the one that is not on your side certainly cannot.
     */
    const v = parserView(MANGLED);
    expect(v.hazards.some((h) => /column/i.test(h.what))).toBe(true);
    expect(v.fatal).toBe(true);
    expect(v.verdict).toMatch(/damaged/i);
  });

  it('flags a place run into a year, and quotes it', () => {
    const v = parserView(MANGLED);
    const glued = v.hazards.find((h) => /years/i.test(h.what));
    expect(glued).toBeTruthy();
    expect(glued.why).toMatch(/KIIT2025/);
  });

  it('never claims more confidence than it has about a name', () => {
    /* The weakest guess a parser makes, and it says so. */
    const v = parserView('CURRICULUM VITAE\nsomeone@example.com');
    const name = v.fields.find((f) => f.name === 'Name');
    expect(['low', 'none']).toContain(name.confidence);
  });
});
