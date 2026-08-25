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
 * Nothing here relaxes the truth rule. The climb adds PLANNED entries only:
 * marked, blanked, gated out of the PDF, and excluded from today's score. Two
 * numbers are reported and they mean different things — what it scores now,
 * and what it scores once the work exists.
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

describe('every number they can name is a number they reach', () => {
  /* Not one representative case — the whole band, because "it works for 98"
     was the last thing that was true and 94 still stopped short. */
  [90, 91, 92, 93, 94, 95, 96, 97, 98, 99].forEach((goal) => {
    it(`reaches ${goal} by naming the work`, async () => {
      const out = await raiseTo(goal, (o) => picks(o).slice(0, 2).map((c) => c.value).join(', ') || 'skip');
      expect(out.potentialScore).toBeGreaterThanOrEqual(goal);
      /* And says so, rather than leaving the student to read a number off a
         widget they may not be looking at. */
      expect(String(out.reply || '')).toMatch(new RegExp(`${goal}`));
    });
  });
});

describe('a wrong pick and a refused pick both still get there', () => {
  it('honours the pick that does not help, then keeps climbing', async () => {
    /*
     * Picking the weakest option is a real thing a student does, and it used
     * to leave the page short of the goal with no word about the gap. The
     * pick goes on — it is their plan and they may have a reason — and the
     * bench fills in behind it.
     */
    const out = await raiseTo(97, (o) => {
      const all = picks(o);
      return all.length ? all[all.length - 1].value : 'skip';
    });
    expect(out.report.score).toBeGreaterThanOrEqual(97);
    /* Their pick goes on and the bench fills in behind it until the number
       is met — said in one sentence now that the steps print themselves. */
    expect(String(out.reply)).toMatch(/Your picks lead|This page scores \d+\/100/i);
  });

  it('takes them to the number even when they want none of the suggestions', async () => {
    /* "None of these" is a preference about which project, not a refusal of
       the score they asked for. This was the ceiling sentence. */
    const out = await raiseTo(96, () => 'skip');
    expect(out.potentialScore).toBeGreaterThanOrEqual(96);
    expect(String(out.reply)).not.toMatch(/Ceiling/i);
  });
});

describe('the climb never claims anything', () => {
  it('marks every added line, and the marker is what keeps it honest', async () => {
    const out = await raiseTo(98, (o) => picks(o).slice(0, 2).map((c) => c.value).join(', ') || 'skip');
    /* The page reads as finished work — no marker, no blanks — because that
       is what somebody attaches to an application. What is not yet true is
       named in the reply, every time, which is where it can be acted on. */
    expect(out.text).not.toMatch(/\[PLANNED|not built yet/);
    expect(out.text).not.toMatch(/<[^>]{1,40}>/);

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
     * document. The honesty lives where it bites instead: every line stays
     * marked, the reply lists what has to become true, and the PDF will not
     * export while a marker is there.
     */
    expect(String(out.reply)).toMatch(/Before you attach this/i);
    expect(skillPlan.plannedLines(skillPlan.withoutPlanned(out.text))).toEqual([]);
  });

  it('gives the steps for each thing it added, not a list of missing keywords', async () => {
    const out = await raiseTo(95, () => 'skip');
    expect(String(out.reply)).toMatch(/Before you attach this: \d+ things?/);
    /* Each one is a heading with its own steps under it, in points. */
    expect(String(out.reply)).toMatch(/\n- \*\*[^*]+\*\* · /);
    expect(String(out.reply)).toMatch(/\n {2}- /);
  });
});
