'use strict';

/**
 * The mock interview, measured rather than described.
 *
 * Two properties matter and neither is provable by reading the code: the
 * questions have to come from THIS resume rather than a generic list, and a
 * candidate who barely spoke must be told they barely spoke instead of being
 * handed a plausible-looking number.
 */

const mi = require('../../services/v2/mockInterview');

const RESUME = [
  'Priya Nair',
  'Backend Developer',
  'priya@example.com | +91 90000 00000',
  '',
  'EXPERIENCE',
  'Backend Developer | Zeta | Jan 2023 - Present',
  '- Built an API on AWS serving 5,000 requests a day, cutting latency 30%',
  '- Automated deploys with Terraform, saving 4 hours a week',
  '',
  'SKILLS',
  'Java, Spring Boot, Kubernetes',
  '',
  'EDUCATION',
  'B.Tech Computer Science, 2021 - 2025',
].join('\n');

const STRONG = [
  'When I joined Zeta the signup API was timing out. I was asked to bring it under',
  '500 milliseconds. I profiled the endpoint and I rewrote the query with a single join,',
  'then I added a Redis cache. I measured it on the APM dashboard over two weeks and',
  'latency went from 1.4 seconds to 380 milliseconds, which cut support tickets by 30 percent.',
].join(' ');

const WAFFLE = 'um yeah so like we basically worked on the api and stuff, i think it got faster, you know';

describe('the questions come out of the resume in front of it', () => {
  it('asks the candidate to defend their own quantified bullet', () => {
    const { questions } = mi.questionsFor(RESUME, { role: 'Backend Engineer' });
    const defend = questions.find((q) => q.kind === 'defend');
    expect(defend).toBeTruthy();
    expect(defend.prompt).toMatch(/5,000 requests a day/);
  });

  it('asks about a skill claimed with nothing behind it', () => {
    /* The question that ends interviews when it has not been rehearsed. */
    const { questions } = mi.questionsFor(RESUME, { role: 'Backend Engineer' });
    const unevidenced = questions.find((q) => q.kind === 'unevidenced');
    expect(unevidenced).toBeTruthy();
    expect(unevidenced.prompt).toMatch(/Java|Spring Boot|Kubernetes/);
  });

  it('asks about what the posting wants and the page cannot prove', () => {
    const { questions } = mi.questionsFor(RESUME, {
      role: 'Backend Engineer',
      jd: 'Backend Engineer. Must have: Java, Spring Boot, Kafka.',
    });
    const gap = questions.find((q) => q.kind === 'gap');
    expect(gap).toBeTruthy();
    /* Kafka, not "Spring" — a term wholly inside a longer one is that term,
       and quoting the fragment back names half a technology. */
    expect(gap.prompt).toMatch(/Kafka/);
    expect(gap.prompt).not.toMatch(/asks for Spring\./);
  });
});

describe('an answer is read for what it contains', () => {
  it('separates a well-shaped answer from a waffle', () => {
    const q = mi.questionsFor(RESUME, {}).questions[1];
    const good = mi.scoreAnswer(STRONG, q);
    const bad = mi.scoreAnswer(WAFFLE, q);
    expect(good.score).toBeGreaterThan(75);
    expect(bad.score).toBeLessThan(35);
  });

  it('finds the situation, the action and the result when they are there', () => {
    const good = mi.scoreAnswer(STRONG, mi.questionsFor(RESUME, {}).questions[1]);
    expect(good.star).toEqual(expect.arrayContaining(['situation', 'action', 'result']));
    expect(good.hasNumber).toBe(true);
  });

  it('counts filler and hedging rather than sensing them', () => {
    const bad = mi.scoreAnswer(WAFFLE, mi.questionsFor(RESUME, {}).questions[1]);
    expect(bad.fillerRate).toBeGreaterThan(10);
    expect(bad.hedges).toContain('i think');
  });

  it('says nothing about ownership when the answer says "I"', () => {
    const good = mi.scoreAnswer(STRONG, mi.questionsFor(RESUME, {}).questions[1]);
    expect(good.ownership).toBe('i');
  });
});

describe('a candidate who barely spoke is told so', () => {
  it('reads zero and says why, instead of averaging silence into a score', () => {
    /*
     * The temptation is to average whatever exists so the session "worked".
     * Someone who said four words has not performed badly, they have not
     * performed — and telling them 62 would be the most misleading thing
     * this file could do.
     */
    const q = mi.questionsFor(RESUME, {}).questions;
    const report = mi.scoreSession([
      { question: q[0], transcript: 'uh thank you' },
      { question: q[1], transcript: '' },
    ]);
    expect(report.score).toBe(0);
    expect(report.verdict).toMatch(/more answers/i);
    expect(report.detail).toMatch(/not enough/i);
  });

  it('does not throw away two honest short answers as silence', () => {
    const q = mi.questionsFor(RESUME, {}).questions;
    const report = mi.scoreSession([
      { question: q[0], transcript: STRONG },
      { question: q[1], transcript: 'I automated our deploys with Terraform. I wrote the modules and the pipeline, and I tested it on staging. A release takes twenty minutes now instead of three hours.' },
    ]);
    expect(report.score).toBeGreaterThan(0);
    expect(report.answered).toBe(2);
  });
});

describe('it reports what the words show and no more', () => {
  it('labels tone from countable things, and says the microphone was not there', () => {
    const q = mi.questionsFor(RESUME, {}).questions;
    const report = mi.scoreSession([{ question: q[0], transcript: STRONG }]);
    expect(report.tone.clarity).toBeTruthy();
    expect(report.tone.clarityWhy).toMatch(/filler|words/i);
    /* The important part: it never implies it heard anything. */
    expect(report.tone.caveat).toMatch(/not your voice|no microphone/i);
  });

  it('calls pace an estimate rather than words per minute', () => {
    const q = mi.questionsFor(RESUME, {}).questions;
    const report = mi.scoreSession([{ question: q[0], transcript: STRONG }]);
    expect(report.pace.proxy).toBe(true);
    expect(report.pace.note).toMatch(/not words per minute/i);
  });
});

describe('the answers to rehearse are built from their own page', () => {
  it('scaffolds from a real bullet and never writes the answer for them', () => {
    /*
     * Handing somebody three polished answers puts words in their mouth that
     * they cannot defend when the follow-up comes, which is worse than a bad
     * answer honestly given.
     */
    const better = mi.betterAnswers(RESUME, 3);
    expect(better.length).toBeGreaterThan(0);
    expect(better[0].from).toMatch(/5,000 requests|Terraform/);
    expect(better[0].scaffold.join(' ')).toMatch(/Situation|Action|Result/);
    /* The quantified bullet leads, because it is the answer that lands. */
    expect(better[0].hasNumber).toBe(true);
  });
});
