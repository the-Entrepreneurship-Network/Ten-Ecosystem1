'use strict';

/**
 * A number they asked for is a number they get.
 *
 * "Make it 96" used to end in a ceiling sentence — here is 89, the rest needs
 * facts your history does not show, I will not invent them. Every clause of
 * that is true and the whole of it is a refusal: the student asked how to
 * reach 96 and was told no. The answer a mentor gives is the work, in order,
 * and the page that work produces — which is what these pin.
 *
 * Nothing here relaxes the truth rule. The climb adds only the work the
 * student picks to build: listed in the reply as not done yet, and gated out
 * of the PDF until it is. Declining is honoured: nothing goes on that they
 * did not choose, and the reply says how far their own page gets.
 */

const express = require('express');
const request = require('supertest');
const skillPlan = require('../../services/v2/skillPlan');

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

const RESUME = [
  'BISHAL NAG',
  'Backend Engineer',
  'bishal@example.com | +91 78639 92542 | github.com/bishal',
  '',
  'EXPERIENCE',
  'Backend Engineer | Zeta | Jan 2023 - Present',
  '- Built REST APIs in Java serving 5,000 requests a day, cutting latency 30%',
  '',
  'PROJECTS',
  '- Campus portal used by 300 students',
  '',
  'SKILLS',
  'Java, Spring Boot, SQL',
  '',
  'EDUCATION',
  'B.Tech Computer Science, 2019 - 2023',
].join('\n');

const picks = (out) => {
  const o = out.options || {};
  const flat = [...(o.options || []), ...((o.groups || []).flatMap((g) => g.options || []))];
  return flat;
};

/** Ask for a number, then answer whatever it asks with `answer`. */
async function raiseTo(goal, answer) {
  const a = agent();
  let out = await turn(a, RESUME, null);
  out = await turn(a, `make it ${goal}`, out.session);
  for (let i = 0; i < 6 && out.kind === 'ask'; i += 1) {
    out = await turn(a, answer(out), out.session);
  }
  return out;
}

describe('every number they can name is one their own picks reach', () => {
  /* Not one representative case — the whole band, because "it works for 98"
     was the last thing that was true and 94 still stopped short. Six picks
     is a month of work; the climb uses those and nothing else. */
  [90, 91, 92, 93, 94, 95, 96, 97, 98, 99].forEach((goal) => {
    it(`reaches ${goal} with the work they picked`, async () => {
      const out = await raiseTo(goal, (o) => picks(o).slice(0, 6).map((c) => c.value).join(', ') || 'skip');
      expect(out.potentialScore).toBeGreaterThanOrEqual(goal);
      /* And says so, rather than leaving the student to read a number off a
         widget they may not be looking at. */
      expect(String(out.reply || '')).toMatch(new RegExp(`${goal}`));
    });
  });
});

describe('a weak pick and a refusal are both told the truth', () => {
  it('adds the pick that does not help, and nothing behind it', async () => {
    /*
     * The bench used to fill in behind a weak pick until the number was met,
     * all of it written as finished. The pick goes on — it is their plan — and
     * the reply says how far it gets and what would take it further.
     */
    const out = await raiseTo(97, (o) => {
      const all = picks(o);
      return all.length ? all[all.length - 1].value : 'skip';
    });
    expect((out.session.plannedGuides || []).length).toBeLessThanOrEqual(1);
    expect(String(out.reply)).not.toMatch(/more were added behind them/);
    expect(String(out.reply)).toMatch(/The work you picked takes this page to \d+\/100|This page scores \d+\/100/);
  });

  it('adds nothing when they want none of the suggestions', async () => {
    /* "None of these" used to mean "pick for me". It means none. */
    const out = await raiseTo(96, () => 'skip');
    expect(out.session.plannedGuides || []).toEqual([]);
    expect(out.text).toMatch(/campus portal used by 300 students/i);
    expect(out.text).not.toMatch(/Relational schema|Containerised|Service deployed/);
    expect(String(out.reply)).toMatch(/Your page scores \d+\/100 as it stands\. I only add work you choose/);
    expect(String(out.reply)).not.toMatch(/Before you attach this/);
  });
});

describe('the climb never claims anything', () => {
  it('tracks every added line, and the reply is what keeps it honest', async () => {
    const out = await raiseTo(98, (o) => picks(o).slice(0, 6).map((c) => c.value).join(', ') || 'skip');
    /*
     * The debt is on the session, not stamped across the document.
     *
     * Every added line used to carry "[PLANNED — not built yet]" and the page
     * grew a LEARNING heading above them. All of it was true and none of it
     * was sendable: a parser indexes neither, a recruiter reads a disclaimer,
     * and the student had to hand-edit the page before attaching it — so the
     * marker got deleted and the honesty went with it. The list moved to
     * where it cannot be quietly removed: the reply names each entry, and the
     * PDF route reads the same list and refuses while any of it stands.
     */
    const planned = out.session.plannedGuides || [];
    expect(planned.length).toBeGreaterThan(0);
    expect(out.text).not.toMatch(/PLANNED|LEARNING/);
    /* And each one it lists is genuinely on the page it is talking about. */
    /* Under the title the page prints, which is what the export gate reads. */
    planned.forEach((g) => expect(out.text).toContain(g.name || g.build));

    /*
     * One number, not two.
     *
     * The page used to be scored twice — once with the planned work cut out
     * and once with it counted — and a student who picked the recommended
     * projects watched the real number sit still. "What is the advantage of
     * adding those skills and projects if it is not increasing the score?"
     * had no good answer, and the feature was being ignored because of it.
     *
     * An ATS scores the document it is given and these lines are on the
     * document. The honesty lives where it bites instead: the reply lists
     * what has to become true, and the PDF will not export while any of it
     * is still owed.
     */
    expect(String(out.reply)).toMatch(/Before you attach this/i);
    /* Naming a title as built removes it from what is owed, and removing an
       entry takes its lines off the page. */
    expect(skillPlan.plannedLines(out.text)).toEqual([]);
    expect(skillPlan.withoutEntries(out.text, [planned[0].build]))
      .not.toContain(planned[0].build);
  });

  it('gives the steps for each thing it added, not a list of missing keywords', async () => {
    const out = await raiseTo(95, (o) => picks(o).slice(0, 6).map((c) => c.value).join(', ') || 'skip');
    expect(String(out.reply)).toMatch(/Before you attach this: \d+ projects? on the page/);
    /* Each one is a heading with its own steps under it, in points. */
    expect(String(out.reply)).toMatch(/\n- \*\*[^*]+\*\* · /);
    expect(String(out.reply)).toMatch(/\n {2}- /);
  });
});
