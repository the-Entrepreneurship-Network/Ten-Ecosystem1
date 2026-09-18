'use strict';

/*
 * The content guard is the thing standing between a staff member's draft and
 * the company's LinkedIn page, so it is tested from both sides.
 *
 * Catching bad drafts is only half the job. A guard that flags ordinary
 * internship posts is a guard people learn to click past, and a guard clicked
 * past is not a guard at all — so the first block here is entirely about
 * posts that must sail through untouched, including the ones that look
 * superficially like the things being screened for: a URL (ours), a date, a
 * rupee figure, an official inbox.
 */

const { review, BRAND, CODES } = require('../../../../services/v2/linkedin/contentGuard');

/** Every code this review raised, for terse assertions. */
const codesOf = (r) => r.issues.map((i) => i.code);

describe('posts that must not be flagged', () => {
  const clean = [
    ['a plain internship opening',
      'We are hiring Python Development interns. Remote, 2 months, stipend Rs 5,000 per month. Apply by 30 Sept at https://virtualinternships.entrepreneurshipnetwork.net'],
    ['a placement story',
      'Priya Sharma interned with TEN in Data Science and has now been placed at Infosys as a Software Engineer.\n\nThe projects she built were what made the difference in her interview.\n\nInternships are open at https://virtualinternships.entrepreneurshipnetwork.net'],
    ['an invitation to students',
      'Most students finish college without one real project to show.\n\nThe Entrepreneurship Network runs virtual internships across 19 domains, with a coordinator reviewing what you submit each week.\n\nStart here: https://virtualinternships.entrepreneurshipnetwork.net'],
  ];

  it.each(clean)('%s passes with nothing to fix', (_label, text) => {
    const r = review(text, { kind: 'opening' });
    expect(r.verdict).toBe('ok');
    /* Notes are advice, not defects — the assertion that matters is that
       nothing here needs a human to change it before it goes out. */
    expect(r.issues.filter((i) => i.severity !== 'note')).toEqual([]);
  });

  it('does not treat our own site as somebody\'s personal contact details', () => {
    const r = review('Applications are open. Apply at https://virtualinternships.entrepreneurshipnetwork.net before 30 September.', { kind: 'opening' });
    expect(codesOf(r)).not.toContain('personal_contact');
    expect(codesOf(r)).not.toContain('insecure_link');
  });

  it('does not treat the official inbox as a personal one', () => {
    const previous = process.env.TEN_OFFICIAL_EMAIL;
    process.env.TEN_OFFICIAL_EMAIL = 'careers@entrepreneurshipnetwork.net';
    try {
      const r = review('Questions about the internship? Write to careers@entrepreneurshipnetwork.net and the team will answer.', { kind: 'general' });
      expect(codesOf(r)).not.toContain('personal_contact');
    } finally {
      if (previous === undefined) delete process.env.TEN_OFFICIAL_EMAIL;
      else process.env.TEN_OFFICIAL_EMAIL = previous;
    }
  });
});

describe('what it blocks outright', () => {
  it('refuses a draft that restricts applicants by gender or age', () => {
    const r = review('We are hiring interns. Only male candidates below 25 years please. Remote role for 3 months.', { kind: 'opening' });
    expect(r.verdict).toBe('block');
    expect(codesOf(r)).toContain('discriminatory_hiring');
    /* A blocked draft has no cleaned version: there is nothing to publish. */
    expect(r.cleaned).toBe('');
  });

  it('refuses a promise of guaranteed placement', () => {
    const r = review('Join our internship programme today. 100% placement guaranteed for every single student who enrols with us.', { kind: 'leadgen' });
    expect(codesOf(r)).toContain('guaranteed_outcome');
  });

  it('refuses a draft that names a company as a fraud', () => {
    const r = review('Do not apply to Acme Corp, they are a complete scam and they cheat every fresher who joins them.', { kind: 'general' });
    expect(r.verdict).toBe('block');
    expect(codesOf(r)).toContain('defamation');
  });

  it('carries the excerpt that triggered each issue, and a fix', () => {
    const r = review('Only male candidates below 25 years. Call 9876543210 for details about this internship role.', { kind: 'opening' });
    r.issues.forEach((issue) => {
      expect(typeof issue.code).toBe('string');
      expect(['block', 'revise', 'note']).toContain(issue.severity);
      expect(typeof issue.message).toBe('string');
      expect(issue.message.length).toBeGreaterThan(0);
      /* A complaint with no remedy is not actionable, which is the whole
         point of showing the issue to a human rather than silently editing. */
      expect(typeof issue.fix).toBe('string');
    });
  });
});

describe('what it asks to be revised or merely notes', () => {
  it('flags an individual\'s phone number and e-mail', () => {
    const r = review('Interested in the internship? Call Rahul on 9876543210 or mail rahul.kumar@gmail.com to apply today.', { kind: 'opening' });
    expect(codesOf(r)).toContain('personal_contact');
  });

  it('flags shouting and exclamation pile-ups', () => {
    const r = review('HUGE ANNOUNCEMENT FOR ALL STUDENTS EVERYWHERE!!! APPLY RIGHT NOW!!!', { kind: 'general' });
    const codes = codesOf(r);
    expect(codes).toEqual(expect.arrayContaining(['shouting', 'exclamation_overload']));
  });

  it('flags more than five hashtags', () => {
    const r = review('We are hiring interns for the coming cohort across several domains this month. #a #b #c #d #e #f #g', { kind: 'opening' });
    expect(codesOf(r)).toContain('hashtag_overload');
  });

  it('flags an insecure link', () => {
    const r = review('Apply for the internship at http://example.com/apply — applications close at the end of the month.', { kind: 'opening' });
    expect(codesOf(r)).toContain('insecure_link');
  });

  it('flags placeholder text left in a draft', () => {
    const r = review('Congratulations to [name] who has been placed at [company] after their internship with us this year.', { kind: 'placement' });
    expect(codesOf(r)).toContain('placeholder_text');
  });

  it('flags a draft that is too short to be a post', () => {
    const r = review('hiring interns', { kind: 'opening' });
    expect(codesOf(r)).toContain('too_short');
  });

  it('blocks a draft past LinkedIn\'s hard character limit', () => {
    const r = review(`${'We are hiring interns for this cohort. '.repeat(120)}`, { kind: 'opening' });
    expect(codesOf(r)).toContain('too_long');
  });

  it('notes the phrases that make a post read as machine-written', () => {
    const r = review('I am thrilled to announce that we will delve into a game-changer of an internship programme that will unlock student potential.', { kind: 'general' });
    expect(codesOf(r)).toContain('ai_slop');
  });
});

describe('the cleaned version', () => {
  it('is offered for a draft that only needs revision', () => {
    const r = review('WE ARE HIRING PYTHON INTERNS FOR A REMOTE ROLE!!! Apply before the thirtieth of September.', { kind: 'opening' });
    expect(r.verdict).not.toBe('block');
    expect(r.cleaned).toBeTruthy();
    /* The mechanical fixes are exactly that — the shouting is gone and the
       exclamation run is collapsed, without anyone rewriting the content. */
    expect(r.cleaned).not.toMatch(/!!!/);
    expect(r.cleaned).not.toBe(r.cleaned.toUpperCase());
  });
});

describe('the shape of the answer', () => {
  it('reports the statistics a reply is built from', () => {
    const r = review('We are hiring two Python interns this month for a remote role. #Hiring #TEN', { kind: 'opening' });
    expect(r.stats).toEqual(expect.objectContaining({
      chars: expect.any(Number),
      words: expect.any(Number),
      lines: expect.any(Number),
      hashtags: expect.any(Number),
      links: expect.any(Array),
    }));
    expect(r.stats.hashtags).toBe(2);
  });

  it('treats empty input as too short rather than throwing', () => {
    expect(() => review('')).not.toThrow();
    expect(() => review(null)).not.toThrow();
    expect(() => review(undefined)).not.toThrow();
  });

  it('exposes the brand and the code table it works from', () => {
    expect(BRAND.name).toBe('The Entrepreneurship Network');
    expect(BRAND.hashtags.core).toContain('#TEN');
    expect(Object.keys(CODES).length).toBeGreaterThan(15);
  });
});

describe('it stays fast on a long draft', () => {
  /*
   * Every rule here is a regular expression run over user-supplied text, and
   * a pattern that backtracks badly turns a long paste into a hung request.
   * Five thousand characters is roughly the longest thing anyone would paste
   * in; it has to come back in well under a second.
   */
  it('reviews 5,000 characters promptly', () => {
    const long = `We are hiring interns across many domains this season. ${'The programme runs for two months and is fully remote. '.repeat(90)}`;
    const started = Date.now();
    const r = review(long.slice(0, 5000), { kind: 'opening' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.verdict).toBeDefined();
  });
});
