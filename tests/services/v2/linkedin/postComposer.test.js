'use strict';

/*
 * The composer's promise is narrow and absolute: the post is the author's
 * words.
 *
 * It corrects mechanics — shouting, runs of exclamation marks, a missing
 * capital, a missing full stop, accidental blank lines — and it adds nothing.
 * No opening line of its own, no paragraph about what a TEN internship
 * involves, no call to action, no hashtags. Most of what is below is
 * therefore a negative assertion, because "did not touch it" is the property
 * that matters: a post that goes out under the company's name should be the
 * sentence the person typed, not the agent's improvement on it.
 *
 * extractFields is still tested in full even though the composer no longer
 * writes from it, because the poster (when somebody asks for one) does.
 */

const composer = require('../../../../services/v2/linkedin/postComposer');
const { review } = require('../../../../services/v2/linkedin/contentGuard');

const THIN_OPENING = 'we are hiring python interns, remote, 2 months, stipend 5k, apply by 25 sept';
const PLACEMENT = 'Congratulations to Priya Sharma who has been placed at Infosys as a Software Engineer after her TEN internship in Data Science.';
const LEADGEN = 'Invite final-year students to apply for virtual internships. We want more freshers building real projects before they graduate.';

describe('reading the draft', () => {
  it('knows an opening from a placement from an invitation', () => {
    expect(composer.detectKind(THIN_OPENING)).toBe('opening');
    expect(composer.detectKind(PLACEMENT)).toBe('placement');
    expect(composer.detectKind(LEADGEN)).toBe('leadgen');
    expect(composer.detectKind('The office is closed on Monday.')).toBe('general');
    expect(composer.detectKind('')).toBe('general');
  });

  it('pulls the facts out of a one-line note', () => {
    const f = composer.extractFields(THIN_OPENING, 'opening');
    expect(f.mode).toBe('Remote');
    expect(f.duration).toBe('2 months');
    expect(f.stipend).toBe('₹5,000');
    expect(f.applyBy).toBe('25 Sept');
  });

  it('reads stipends the several ways people write them', () => {
    const of = (s) => composer.extractFields(`hiring interns, stipend ${s}`, 'opening').stipend;
    expect(of('Rs 8,000 per month')).toBe('₹8,000');
    expect(of('8k')).toBe('₹8,000');
    expect(of('5k-10k per month')).toBe('₹5,000 – ₹10,000');
    /* "unpaid" contains "paid", which once matched the money pattern and
       reported a ₹2 stipend by walking forward to "2 months". */
    expect(composer.extractFields('unpaid internship for 2 months', 'opening').stipend).toBe('Unpaid');
  });

  it('reads a placement, including a name behind a relative clause', () => {
    const f = composer.extractFields(PLACEMENT, 'placement');
    expect(f.studentName).toBe('Priya Sharma');
    expect(f.company).toBe('Infosys');
    /* The title must not be cut short by the "in" inside "Engineer". */
    expect(f.position).toBe('Software Engineer');
    expect(f.domain).toBe('Data Science');
  });

  it('reads the short form of a placement too', () => {
    const f = composer.extractFields('Aisha Khan joined Wipro last week as an Analyst.', 'placement');
    expect(f.studentName).toBe('Aisha Khan');
    expect(f.company).toBe('Wipro');
    expect(f.position).toBe('Analyst');
  });

  it('leaves a field empty rather than guessing', () => {
    const f = composer.extractFields('We have news to share with everyone this week.', 'general');
    expect(f.stipend).toBe('');
    expect(f.studentName).toBe('');
    expect(f.company).toBe('');
  });
});

describe('the post is the author’s words, tidied', () => {
  it('keeps every line the author typed, in their order', () => {
    const draft = 'We are hiring Python interns\nRemote, 2 months, stipend 5k\nApply by 25 Sept';
    const lines = composer.compose(draft, {}).text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^We are hiring Python interns/);
    expect(lines[1]).toMatch(/^Remote, 2 months, stipend 5k/);
    expect(lines[2]).toMatch(/^Apply by 25 Sept/);
  });

  it('adds nothing of its own: no body, no call to action, no hashtags', () => {
    const p = composer.compose('We are hiring Python interns. Remote, 2 months.', {});
    /* The exact phrases an earlier, generative version used to bolt on. */
    expect(p.text).not.toMatch(/project work, not shadowing/);
    expect(p.text).not.toMatch(/You finish with three things/);
    expect(p.text).not.toMatch(/Apply at https/);
    expect(p.text).not.toMatch(/#TheEntrepreneurshipNetwork/);
    expect(p.cta).toBe('');
    expect(p.hashtags).toEqual([]);
  });

  it('keeps the author’s own hashtags and link exactly as typed', () => {
    const draft = 'Two seats left on the October cohort.\nApply at virtualinternships.entrepreneurshipnetwork.net\n#Hiring #TEN';
    const p = composer.compose(draft, {});
    expect(p.text).toContain('#Hiring #TEN');
    expect(p.text).toContain('virtualinternships.entrepreneurshipnetwork.net');
    expect(p.hashtags).toEqual(['#Hiring', '#TEN']);
    /* A full stop glued to a bare domain becomes part of the link. */
    expect(p.text).not.toMatch(/entrepreneurshipnetwork\.net\./);
  });

  it('calms a shouted line without changing its words', () => {
    expect(composer.compose('WE ARE HIRING PYTHON INTERNS!!!', {}).text)
      .toBe('We are hiring Python interns!');
  });

  it('calms a run of shouted words inside an ordinary line', () => {
    /* The content guard de-shouts first and leaves this half-fixed shape. */
    expect(composer.compose('WE ARE Hiring Python Interns!', {}).text)
      .toBe('We are Hiring Python Interns!');
  });

  it('leaves genuine initialisms in capitals', () => {
    const draft = 'Our HR team and the UI UX interns met the CEO today for a review session.';
    expect(composer.compose(draft, {}).text).toBe(draft);
  });

  it('does not touch a draft that is already clean', () => {
    const draft = 'Priya Sharma has been placed at Infosys as a Software Engineer.\n\nShe built three projects during her internship.\n\n#Placement';
    expect(composer.compose(draft, {}).text).toBe(draft);
  });

  it('collapses accidental blank lines but keeps the author’s paragraphs', () => {
    expect(composer.compose('First line.\n\n\n\nSecond line.', {}).text)
      .toBe('First line.\n\nSecond line.');
  });

  it('reports the length of what will actually be posted', () => {
    const p = composer.compose('We are hiring Python interns. Remote, 2 months.', {});
    expect(p.chars).toBe(p.text.length);
  });

  it.each([['opening', THIN_OPENING], ['placement', PLACEMENT], ['leadgen', LEADGEN]])(
    'leaves a %s draft acceptable to the content guard',
    (kind, draft) => {
      expect(review(composer.compose(draft, { kind }).text, { kind }).verdict).toBe('ok');
    },
  );

  it('never introduces a machine-written phrase', () => {
    [THIN_OPENING, PLACEMENT, LEADGEN].forEach((d) => {
      const p = composer.compose(d, {});
      expect(review(p.text, { kind: p.kind }).issues.map((i) => i.code)).not.toContain('ai_slop');
    });
  });

  it('assembles four parts in LinkedIn order when something asks it to', () => {
    expect(composer.assemble({
      hook: 'A hook.', body: 'A body.', cta: 'Apply here.', hashtags: ['#One', '#Two'],
    })).toBe('A hook.\n\nA body.\n\nApply here.\n\n#One #Two');
  });
});

describe('edits the author asks for', () => {
  const base = () => composer.compose('We are hiring Python interns. Remote for two months. Apply before the end of September.', {});

  it('changes the headline and keeps the rest', () => {
    const next = composer.transform(base(), 'headline', 'Six Python internship seats, remote, from October.');
    expect(next.hook).toBe('Six Python internship seats, remote, from October.');
    expect(next.text).toContain('Six Python internship seats');
  });

  it('sets hashtags on request, capped at five', () => {
    const next = composer.transform(base(), 'hashtags', ['Hiring', '#Python', 'TEN', '#A', '#B', '#C']);
    expect(next.hashtags.length).toBeLessThanOrEqual(5);
    expect(next.hashtags[0]).toBe('#Hiring');
  });

  it('sets a call to action on request', () => {
    const next = composer.transform(base(), 'cta', 'Write to careers@entrepreneurshipnetwork.net.');
    expect(next.cta).toBe('Write to careers@entrepreneurshipnetwork.net.');
  });

  it('returns null for an instruction it does not know', () => {
    expect(composer.transform(base(), 'translate to French')).toBeNull();
    expect(composer.transform(base(), 'headline', '')).toBeNull();
    expect(composer.transform(null, 'shorter')).toBeNull();
  });
});

describe('the model-written version', () => {
  const OLD_ENV = {};
  beforeEach(() => {
    ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_KEY'].forEach((k) => {
      OLD_ENV[k] = process.env[k];
      delete process.env[k];
    });
  });
  afterEach(() => {
    Object.keys(OLD_ENV).forEach((k) => {
      if (OLD_ENV[k] === undefined) delete process.env[k];
      else process.env[k] = OLD_ENV[k];
    });
  });

  it('returns null when the server has no model to ask', async () => {
    await expect(composer.composeWithLLM(THIN_OPENING, { kind: 'opening' })).resolves.toBeNull();
  });

  it('returns null rather than throwing on an empty draft', async () => {
    await expect(composer.composeWithLLM('', {})).resolves.toBeNull();
    await expect(composer.composeWithLLM(null, {})).resolves.toBeNull();
  });
});

describe('the promise, stated plainly', () => {
  /*
   * This block exists because the requirement was given in one sentence and
   * is easy to erode: "whatever is written inside that agent and whatever
   * photo is posted to the agent, that will only be the post — the agent
   * should only help modify the sentences or the lines."
   *
   * So: for a draft with nothing mechanically wrong with it, the text that
   * would be published must be byte-for-byte what the author typed.
   */
  const AS_TYPED = [
    'We are hiring 6 Python interns for the October cohort. Remote, 2 months, stipend ₹5,000 a month. Apply by 30 September at virtualinternships.entrepreneurshipnetwork.net',
    'Priya Sharma has been placed at Infosys as a Software Engineer.\n\nShe built three projects with us before the interview.\n\n#Placement #TEN',
    'Our office will be closed on Monday for the holiday.',
  ];

  it.each(AS_TYPED)('publishes a clean draft unchanged: %s', (draft) => {
    expect(composer.compose(draft, {}).text).toBe(draft);
  });

  it('changes only mechanics when something is wrong', () => {
    const draft = 'WE ARE HIRING!!!   Remote role';
    const out = composer.compose(draft, {}).text;
    /* The words survive; the shouting, the triple mark and the double space
       do not. */
    expect(out.toLowerCase()).toContain('we are hiring');
    expect(out.toLowerCase()).toContain('remote role');
    expect(out).not.toContain('!!!');
    expect(out).not.toContain('  ');
  });
});
