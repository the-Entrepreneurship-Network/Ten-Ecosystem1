'use strict';

/**
 * Tailoring for Google and tailoring for JPMorgan are not the same operation.
 *
 * They were. Both got the same domain bench, the same twenty-five projects,
 * the same skills list — and a student who builds the wrong three projects has
 * spent a month on the wrong month. Google's backend bar is distributed
 * systems under load; a bank's is correctness, latency and an audit trail
 * somebody can be asked about in a review; an IT-services firm's is
 * integration and delivery against a client SLA.
 *
 * And the order of the errand matters as much as its content: openings first,
 * then the large employers, then the page — built and tailored for whichever
 * row they opened. A resume aimed at nothing in particular is what a student
 * already has.
 */

const express = require('express');
const request = require('supertest');
const profiles = require('../../services/v2/companyProfiles');

jest.setTimeout(5 * 60 * 1000);

/* Stubbed where the seats actually meet: one function, not a request to our
   own port — that hop is what failed behind the hosting proxy. */
jest.mock('../../routes/v2/jobAgent', () => {
  const router = jest.requireActual('../../routes/v2/jobAgent');
  router.findJobs = jest.fn();
  return router;
});
const jobAgent = require('../../routes/v2/jobAgent');

const PORTAL_JOBS = [
  { title: 'Software Engineer', company: 'stripe', location: 'Bengaluru, India', url: 'https://stripe.com/jobs/1', description: 'Java, Postgres.', tags: ['java'], fit5: 4 },
  { title: 'Software Engineer, Platform', company: 'airbnb', location: 'Remote, EU', url: 'https://careers.airbnb.com/2', description: 'AWS, Terraform.', tags: ['aws'], fit5: 3 },
];

beforeEach(() => {
  jobAgent.findJobs.mockReset();
  jobAgent.findJobs.mockResolvedValue(PORTAL_JOBS);
});

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

const choices = (out) => {
  const o = out.options || {};
  return [...(o.options || []), ...((o.groups || []).flatMap((g) => g.options || []))];
};

const walk = async (a, out, how = 'all', max = 30) => {
  let cur = out;
  for (let i = 0; i < max && cur.kind === 'ask'; i += 1) {
    const all = choices(cur);
    const answer = !all.length ? 'skip'
      : how === 'first' ? all[0].value
        : all.map((c) => c.value).join(', ');
    // eslint-disable-next-line no-await-in-loop
    cur = await turn(a, answer, cur.session);
  }
  return cur;
};

const RESUME = [
  'BISHAL NAG', 'Backend Engineer',
  'bishal@example.com | +91 90000 00000 | github.com/bishal',
  '', 'EXPERIENCE', 'Backend Engineer | Northwind | Jan 2023 - Present',
  '- Built REST APIs in Java serving 5,000 requests a day, cutting latency 30%',
  '', 'SKILLS', 'Java, Spring Boot, SQL',
  '', 'EDUCATION', 'B.Tech Computer Science, 2019 - 2023',
].join('\n');

/* ------------------------------------------------------------- THE PROFILE */

describe('the profile knows one employer from another', () => {
  it('gives Google systems-at-scale work and a bank an audit trail', () => {
    const g = profiles.profileFor('Google', 'Backend Engineer');
    const j = profiles.profileFor('JPMorgan Chase', 'Backend Engineer');
    expect(g.projects).toEqual(expect.arrayContaining(['sharding']));
    expect(j.projects).toEqual(expect.arrayContaining(['audit logging']));
    expect(g.projects).not.toEqual(j.projects);
    expect(g.note).not.toBe(j.note);
  });

  it('gives an IT-services firm migration and delivery work', () => {
    const t = profiles.profileFor('Tata Consultancy Services', 'Software Engineer');
    expect(t.projects).toEqual(expect.arrayContaining(['legacy migration']));
    expect(t.skills).toEqual(expect.arrayContaining(['enterprise integration']));
  });

  it('gives an aerospace employer safety-critical work', () => {
    const s = profiles.profileFor('SpaceX', 'Avionics Engineer');
    expect(s.projects.join(' ')).toMatch(/rtos|redundancy|flight data/);
  });

  it('answers for a company it has never heard of, from its domain', () => {
    /* An unknown bank is still a bank. Falling back to nothing would offer a
       student the generic bench for the one case where the bar is specific. */
    const unknown = profiles.profileFor('Some Regional Bank Ltd', 'Risk Analyst');
    expect(unknown.known).toBe(false);
    expect(unknown.projects.length).toBeGreaterThan(0);
    expect(unknown.note).toBeTruthy();
  });

  it('names its bar in one line, for the reply', () => {
    expect(profiles.noteFor('Netflix', 'Backend Engineer')).toMatch(/Netflix screens backend engineer on/i);
  });

  it('answers for every employer on the list, named or by sector', () => {
    /*
     * Two things have to be true and they are not the same thing.
     *
     * Every company on the list must produce real work to build — a page
     * tailored for an employer that returns nothing is the bug this replaced,
     * where a hundred and forty-nine of them fell through to a blank.
     *
     * And the ones a student is most likely to aim at are named individually,
     * because a sector answer is right about the shape of the work and vague
     * about the bar. The long tail keeps its sector, which is a real answer:
     * a bank we have not written up is still a bank.
     */
    const { COMPANIES } = require('../../services/v2/aspirationalCompanies');
    COMPANIES.forEach(([name]) => {
      const p = profiles.profileFor(name, 'Software Engineer');
      expect(p.projects.length).toBeGreaterThan(0);
      expect(p.skills.length).toBeGreaterThan(0);
      expect(p.note).toBeTruthy();
    });

    const named = COMPANIES.filter(([n]) => profiles.profileFor(n, 'Software Engineer').known);
    expect(named.length).toBeGreaterThanOrEqual(180);
    ['Google', 'Amazon', 'OpenAI', 'Anthropic', 'Netflix', 'JPMorgan Chase',
      'Infosys', 'Flipkart', 'Razorpay', 'TSMC'].forEach((n) => {
      expect(profiles.profileFor(n, 'Software Engineer').known).toBe(true);
    });
  });

  it('gives every named employer a distinct answer, never a shared one', () => {
    /* A named profile that repeats its neighbour's is the sector fallback
       wearing a company name — which is what this whole pass replaced. */
    const { HOUSES } = require('../../services/v2/companyProfiles');
    const notes = new Set(HOUSES.map(([, note]) => note));
    const leads = new Set(HOUSES.map(([, , resume]) => resume));
    expect(notes.size).toBe(HOUSES.length);
    expect(leads.size).toBe(HOUSES.length);
  });

  it('says what the page should lead with, not only what they look for', () => {
    /*
     * "What does Google look for" is answered everywhere in adjectives. What
     * a student cannot look up is which of their own true facts to put at the
     * top for this employer — and it differs sharply between them.
     */
    const g = profiles.profileFor('Amazon', 'Backend Engineer').resume;
    const t = profiles.profileFor('Infosys', 'Backend Engineer').resume;
    expect(g).toBeTruthy();
    expect(t).toBeTruthy();
    expect(g).not.toBe(t);
    expect(profiles.noteFor('Amazon', 'Backend Engineer')).toMatch(/Lead the page with/);
  });

  it('claims only what it can honestly claim about its source', () => {
    /* It knows published postings and engineering writing. It does not know
       anybody's internal shortlisting history, and must not imply it. */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/v2/companyProfiles.js'), 'utf8',
    );
    expect(src).toMatch(/PUBLISHED postings/);
    expect(src).toMatch(/not anybody's internal shortlisting data/i);
  });
});

describe('a resume built from scratch clears the same bar as one uploaded', () => {
  const TYPED = {
    name: 'Bishal Nag',
    email: 'bishal.nag@gmail.com',
    phone: '+91 78639 92542',
    github: 'github.com/bishalnag',
    linkedin: 'linkedin.com/in/bishalnag',
  };

  const buildFromScratch = async () => {
    const a = agent();
    let out = await turn(a, 'build me a resume', null);
    for (let i = 0; i < 50; i += 1) {
      if (out.kind === 'ask') {
        const opts = choices(out);
        const typed = TYPED[out.session.asked];
        // eslint-disable-next-line no-await-in-loop
        out = await turn(a, typed !== undefined ? typed : (opts.length ? opts[0].value : 'skip'), out.session);
      } else if (out.jobs) {
        // eslint-disable-next-line no-await-in-loop
        out = await turn(a, `I want to tailor my resume for the ${out.jobs[0].title} role at ${out.jobs[0].company}`, out.session);
      } else break;
    }
    return out;
  };

  it('reaches the bar instead of stopping at the conversion', async () => {
    /*
     * It stopped at 56 while an uploaded resume aimed at the same job came
     * back at 96 — the two paths delivered from different places in the
     * router and only one of them ran the climb. Same errand, same employer,
     * half the score.
     */
    const out = await buildFromScratch();
    expect(out.kind).toBe('build');
    expect(out.report.score).toBeGreaterThanOrEqual(92);
  });

  it('never turns an employer into an achievement', async () => {
    /*
     * The internship question is a list of employers, so the answer is a
     * company name — and it was being pasted in as work. A page came back
     * with an EXPERIENCE section whose achievements read "- Google" and
     * "- Google". Nobody claimed to have done Google.
     */
    const out = await buildFromScratch();
    const bullets = out.text.split('\n').filter((l) => /^\s*-\s/.test(l));
    bullets.forEach((b) => {
      expect(b).not.toMatch(/^-\s*(Built|Delivered|Created|Developed)?\s*Google\s*(\(paid internship\))?\s*$/i);
    });
  });

  it('never prints the same line twice', async () => {
    /* Two list questions about projects, one entry picked in both. */
    const out = await buildFromScratch();
    /* Planned entries count too — the employer's bench and the role's
       catalogue overlap by design, and concatenating them without deduping
       put the same project on the page twice with two identical step lists. */
    const lines = out.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const seen = new Map();
    lines.forEach((l) => seen.set(l, (seen.get(l) || 0) + 1));
    const repeated = [...seen.entries()].filter(([l, n]) => n > 1 && l.startsWith('-'));
    expect(repeated).toEqual([]);
  });
});

describe('a wrong pick is overruled, and the student is told so', () => {
  const RESUME_B = RESUME;
  const tailorWith = async (mode) => {
    const a = agent();
    let out = await turn(a, RESUME_B, null);
    out.session.jobs = [{
      title: 'Backend Engineer', company: 'Netflix', location: 'Global', url: '',
      aspirational: true, description: '', tags: [],
    }];
    out = await turn(a, 'I want to tailor my resume for the Backend Engineer role at Netflix', out.session);
    for (let i = 0; i < 30 && out.kind === 'ask'; i += 1) {
      const opts = choices(out);
      let answer;
      if (out.session.asked === 'confirmtailor') answer = 'yes';
      else if (!opts.length) answer = 'skip';
      else if (out.session.asked === 'addproject') {
        answer = mode === 'none' ? 'skip'
          : mode === 'worst' ? opts[opts.length - 1].value
            : opts.slice(0, 2).map((c) => c.value).join(', ');
      } else answer = opts.slice(0, 2).map((c) => c.value).join(', ');
      // eslint-disable-next-line no-await-in-loop
      out = await turn(a, answer, out.session);
    }
    return out;
  };

  it('adds the right work anyway when the weakest option was chosen', async () => {
    /*
     * Somebody picking from a list of thirty will sometimes pick the weakest
     * one for the job they are aiming at. Their pick is never removed — it is
     * their plan and they may have a reason — but the page still has to clear
     * the bar, so what the employer actually screens on goes on behind it.
     */
    const out = await tailorWith('worst');
    expect(out.report.score).toBeGreaterThanOrEqual(92);
    expect(out.reply).toMatch(/Your picks are on the page and stay there/);
    expect(out.reply).toMatch(/what Netflix screens this role on/);
  });

  it('adds it anyway when they decline every suggestion, and says which', async () => {
    /* Declining is a click. A page below the bar is filtered before a human
       reads it, so the work goes on and the decision is stated out loud
       rather than slipped in. */
    const out = await tailorWith('none');
    expect(out.report.score).toBeGreaterThanOrEqual(92);
    expect(out.reply).toMatch(/You did not want to pick any, so I chose/);
    expect(out.reply).toMatch(/chaos testing|circuit breakers|streaming/);
  });

  it('keeps good picks and is honest that more still went on', async () => {
    /*
     * Picking the two strongest options is not the same as picking enough:
     * two projects rarely carry a page to the bar on their own. The note has
     * to stay accurate rather than flattering — the picks are kept, and what
     * went on behind them is named either way.
     */
    const out = await tailorWith('best');
    expect(out.report.score).toBeGreaterThanOrEqual(92);
    expect(out.reply).toMatch(/Your picks are on the page and stay there/);
    /* And never the wording for somebody who picked nothing. */
    expect(out.reply).not.toMatch(/You did not want to pick any/);
  });
});

describe('the work depends on the company AND the role, never on one alone', () => {
  const COMPANIES = ['Google', 'Amazon', 'Netflix', 'JPMorgan Chase', 'Infosys', 'Razorpay', 'TSMC', 'Anthropic'];
  const ROLES = ['Software Engineer', 'Data Scientist', 'DevOps Engineer', 'UI/UX Designer', 'Cybersecurity Analyst'];
  const top = (c, r) => profiles.profileFor(c, r).projects.slice(0, 8).join('|');

  it('gives one company\'s four roles four different lists', () => {
    /*
     * They were identical. The company was the only thing consulted, so a
     * Google data scientist and a Google UI/UX designer were both told to
     * build sharding, distributed tracing and search indexing.
     */
    const seen = new Set(ROLES.map((r) => top('Google', r)));
    expect(seen.size).toBe(ROLES.length);
    expect(profiles.profileFor('Google', 'UI/UX Designer').projects.slice(0, 3).join(' '))
      .not.toMatch(/sharding/);
    expect(profiles.profileFor('Google', 'Data Scientist').projects.slice(0, 3).join(' '))
      .toMatch(/sql|python|pandas/);
  });

  it('gives one role different lists at different companies', () => {
    /*
     * And the other half of the same bug: putting the role first made every
     * employer produce the identical list. What distinguishes a data
     * scientist at Google from one anywhere else is the scale they work at,
     * so the company's own emphasis sits directly behind the role's core.
     */
    const seen = new Set(COMPANIES.map((c) => top(c, 'Data Scientist')));
    expect(seen.size).toBe(COMPANIES.length);
    expect(top('Google', 'Data Scientist')).toMatch(/sharding|search indexing/);
    expect(top('JPMorgan Chase', 'Data Scientist')).toMatch(/audit logging|reconciliation/);
    expect(top('Netflix', 'Data Scientist')).toMatch(/chaos testing|streaming/);
  });

  it('is distinct across every company and role pair, not just the famous ones', () => {
    const seen = new Set();
    COMPANIES.forEach((c) => ROLES.forEach((r) => seen.add(top(c, r))));
    expect(seen.size).toBe(COMPANIES.length * ROLES.length);
  });

  it('never returns an empty list, for any employer and any title', () => {
    /* 374 employers and 105 titles is 39,270 combinations, and a page
       tailored for one of them that recommends nothing is the failure this
       whole feature exists to prevent. */
    const { COMPANIES: ALL } = require('../../services/v2/aspirationalCompanies');
    const career = require('../../services/v2/careerData');
    const titles = career.POSITION_GROUPS.flatMap((g) => g.roles);
    ALL.slice(0, 40).forEach(([c]) => titles.slice(0, 30).forEach((r) => {
      const p = profiles.profileFor(c, r);
      expect(p.projects.length).toBeGreaterThan(0);
      expect(p.skills.length).toBeGreaterThan(0);
    }));
  });
});

describe('one scale, and nothing quietly dropped', () => {
  it('reports every score out of 100, including the very first one', async () => {
    /*
     * A weak upload opened with "estimated checker 45/60" — the first number
     * a student ever sees — and every number after it was out of 100. Two
     * scales in one conversation is how a page that went 45 to 94 reads as
     * noise rather than progress.
     */
    const a = agent();
    const weak = [
      'BISHAL NAG', 'bishal@example.com', '+91 90000 00000', '',
      'OBJECTIVE', 'Seeking a challenging position in a reputed organization.',
      '', 'SKILLS', 'Java, HTML, CSS',
      '', 'INTERNSHIP', 'Web Development Intern, Zeta Labs',
      '- Responsible for developing web applications',
    ].join('\n');
    const out = await turn(a, weak, null);
    const shown = String(out.reply || out.prompt || '');
    expect(shown).toMatch(/\d+\/100/);
    expect(shown).not.toMatch(/\/60\b/);
  });

  it('keeps the degree on the page however buildResume was called', () => {
    /*
     * The education line is composed as the three answers arrive, so the
     * interview path was fine and every other caller was not: hand
     * buildResume a degree, a college and a year directly and the page came
     * back with no EDUCATION section at all.
     */
    const agentMod = require('../../routes/v2/resumeAgent');
    const built = agentMod.buildResume({
      name: 'Bishal Nag', role: 'Software Engineer', email: 'b@e.com', phone: '+91 90000 00000',
      degree: 'B.Tech Computer Science',
      college: 'Kalinga Institute of Industrial Technology (KIIT)',
      gradyear: '2026', skills: 'Java, SQL',
    });
    expect(built.text).toMatch(/EDUCATION/);
    expect(built.text).toMatch(/B\.Tech Computer Science/);
    expect(built.text).toMatch(/Kalinga/);
  });
});

describe('the row you opened is the row it tailors for', () => {
  it('tailors for OpenAI when OpenAI is the row, not for whoever is first', async () => {
    /*
     * Every target row carries the SAME title — the role being aimed at — so
     * matching on the title alone returned whichever came first in the list.
     * Somebody opened OpenAI, pressed Tailor, and the page was rewritten for
     * Google: the sentence said OpenAI, the lookup read "backend engineer",
     * and Google was row one.
     */
    const a = agent();
    const base = await turn(a, RESUME, null);
    const jobs = ['Google', 'OpenAI', 'Netflix', 'JPMorgan Chase', 'Infosys'].map((company) => ({
      title: 'Backend Engineer', company, location: 'Global', url: '',
      aspirational: true, description: '', tags: [],
    }));

    for (const company of ['OpenAI', 'Netflix', 'JPMorgan Chase', 'Infosys', 'Google']) {
      const session = { ...JSON.parse(JSON.stringify(base.session)), jobs };
      // eslint-disable-next-line no-await-in-loop
      const out = await turn(a, `I want to tailor my resume for the Backend Engineer role at ${company}`, session);
      expect(out.session.pickedJob.company).toBe(company);
    }
  });

  it('puts that employer\'s guidance on the finished page, not only on a question', async () => {
    /*
     * It was said once, on the question about which projects to build, and
     * then never again — so the student who answered that question got the
     * finished resume with no word about what this employer reads for. The
     * advice belongs next to the artefact it applies to.
     */
    const a = agent();
    const base = await turn(a, RESUME, null);
    base.session.jobs = [{
      title: 'Backend Engineer', company: 'JPMorgan Chase', location: 'Global', url: '',
      aspirational: true, description: '', tags: [],
    }];
    let out = await turn(a, 'I want to tailor my resume for the Backend Engineer role at JPMorgan Chase', base.session);
    for (let i = 0; i < 20 && out.kind === 'ask'; i += 1) {
      const answer = out.session.asked === 'confirmtailor'
        ? 'yes'
        : (choices(out).slice(0, 3).map((c) => c.value).join(', ') || 'skip');
      // eslint-disable-next-line no-await-in-loop
      out = await turn(a, answer, out.session);
    }
    expect(out.kind).toBe('build');
    /*
     * The guidance moved from prose into the page itself, which is the whole
     * brief: show the resume, show the score, then how to finish the work.
     * A paragraph about what a bank screens on, stacked above the resume,
     * was the "extra things" that got cut — what the employer wants is now
     * the work sitting on the page under its own headings.
     */
    expect(out.text).toMatch(/audit logging|reconciliation|low-latency messaging/i);
    expect(out.reply).toMatch(/^ATS score: \d+\/100/);
    expect(out.reply).toMatch(/Before you attach this/);
  });

  it('still finds the row by number when no company is named', async () => {
    const a = agent();
    const base = await turn(a, RESUME, null);
    base.session.jobs = [
      { title: 'Backend Engineer', company: 'stripe', location: 'Remote', url: 'https://x/1', description: 'Java.', tags: [] },
      { title: 'Backend Engineer', company: 'airbnb', location: 'Remote', url: 'https://x/2', description: 'Go.', tags: [] },
    ];
    const out = await turn(a, 'tailor number 2', base.session);
    expect(out.session.pickedJob.company).toBe('airbnb');
  });
});

/* ---------------------------------------------------- THE TAILOR THAT USES IT */

describe('the tailor is shaped by the employer, not only by the role', () => {
  const tailorFor = async (company) => {
    const a = agent();
    let out = await turn(a, RESUME, null);
    out.session.jobs = [{
      title: 'Backend Engineer', company, location: 'Global', url: '',
      aspirational: true, description: '', tags: [],
    }];
    out = await turn(a, 'tailor number 1', out.session);
    return { a, out };
  };

  it('leads the project list with what that company screens on', async () => {
    const { a, out } = await tailorFor('Netflix');
    let cur = out;
    let sawOffer = null;
    for (let i = 0; i < 6 && cur.kind === 'ask'; i += 1) {
      if (cur.session.asked === 'addproject') { sawOffer = cur; break; }
      // eslint-disable-next-line no-await-in-loop
      cur = await turn(a, choices(cur).map((c) => c.value).join(', ') || 'skip', cur.session);
    }
    expect(sawOffer).toBeTruthy();
    expect(String(sawOffer.reply)).toMatch(/Netflix screens/i);
    const terms = choices(sawOffer).map((c) => c.value.toLowerCase());
    expect(terms.slice(0, 6).join(' ')).toMatch(/chaos|streaming|circuit|canary/);
  });

  it('offers a bank a different list than it offers Google', async () => {
    const g = await tailorFor('Google');
    const j = await tailorFor('JPMorgan Chase');
    const first = async ({ a, out }) => {
      let cur = out;
      for (let i = 0; i < 6 && cur.kind === 'ask'; i += 1) {
        if (cur.session.asked === 'addproject') return choices(cur).map((c) => c.value);
        // eslint-disable-next-line no-await-in-loop
        cur = await turn(a, choices(cur).map((c) => c.value).join(', ') || 'skip', cur.session);
      }
      return [];
    };
    const gTerms = await first(g);
    const jTerms = await first(j);
    expect(gTerms.length).toBeGreaterThan(0);
    expect(jTerms.length).toBeGreaterThan(0);
    expect(gTerms.slice(0, 4)).not.toEqual(jTerms.slice(0, 4));
  });

  it('goes deep for a target and stays sane for an ordinary posting', async () => {
    const { a, out } = await tailorFor('Amazon');
    let cur = out;
    let offer = [];
    for (let i = 0; i < 6 && cur.kind === 'ask'; i += 1) {
      if (cur.session.asked === 'addproject') { offer = choices(cur); break; }
      // eslint-disable-next-line no-await-in-loop
      cur = await turn(a, choices(cur).map((c) => c.value).join(', ') || 'skip', cur.session);
    }
    /* A target has no advert behind it, only a bar — so the bench is the
       whole thing rather than the four things one listing named. */
    expect(offer.length).toBeGreaterThanOrEqual(12);
  });

  it('names the company\'s skills under LEARNING even with no advert to read', async () => {
    /* A target has no posting behind it, so the not-claimed list is empty and
       the block came out blank — for exactly the student who needs it most. */
    const { a, out } = await tailorFor('Netflix');
    const done = await walk(a, out);
    expect(done.text).toMatch(/LEARNING/);
    const learning = done.text.split(/LEARNING[^\n]*\n/)[1].split('\n')[0].toLowerCase();
    /* Netflix's own vocabulary, whichever half of the profile it comes from —
       the projects it screens on and the skills behind them are one list. */
    expect(learning).toMatch(/chaos|streaming|circuit breaker|canary|resilience|observability|jvm/);
  });

  it('puts the company\'s skills on the page as learning, never as claims', async () => {
    const { a, out } = await tailorFor('Netflix');
    const done = await walk(a, out);
    const after = await walk(a, await turn(a, 'make it 96', done.session));
    expect(after.report.score).toBeGreaterThanOrEqual(96);
    expect(after.text).toMatch(/LEARNING/);
    /*
     * One number now, not two.
     *
     * The page used to be scored twice — once with the planned work cut out
     * and once with it counted — and the pair had to be explained side by
     * side every time. A student who picked the recommended projects watched
     * the real number sit still, which is the whole reason the feature was
     * being ignored. The score describes the page; the marker and the export
     * gate are what keep the page from being sent as a lie.
     */
    expect(after.text).toMatch(/\[PLANNED/);
    expect(after.reply).toMatch(/Before you attach this/);
  });
});

/* ------------------------------------------------- OPENINGS BEFORE THE PAGE */

describe('a new user gets the openings before the blank page', () => {
  const start = async () => {
    const a = agent();
    const out = await turn(a, 'build me a resume for a software engineer', null);
    return { a, out };
  };

  it('searches the title they named instead of interviewing first', async () => {
    const { out } = await start();
    expect(Array.isArray(out.jobs)).toBe(true);
    expect(out.jobs.some((j) => j.company === 'stripe')).toBe(true);
    expect(out.reply).toMatch(/before we write a word/i);
  });

  it('lists the live openings first and the large employers after them', async () => {
    const { out } = await start();
    const firstTarget = out.jobs.findIndex((j) => j.aspirational);
    const lastReal = out.jobs.map((j) => !!j.aspirational).lastIndexOf(false);
    expect(firstTarget).toBeGreaterThan(lastReal);
    expect(out.jobs.filter((j) => j.aspirational).length).toBeGreaterThanOrEqual(20);
  });

  it('builds the page against the row they open, tailored, in one motion', async () => {
    const { a, out } = await start();
    const picked = await turn(a, 'tailor number 1', out.session);
    const done = await walk(a, picked, 'first');
    expect(done.kind).toBe('build');
    expect(done.session.pickedJob.company).toBe('stripe');
    expect(String(done.reply)).toMatch(/stripe screens/i);
  });

  it('builds anyway when the boards are silent, rather than stranding them', async () => {
    jobAgent.findJobs.mockRejectedValue(new Error('every board timed out'));
    const { out } = await start();
    /* No page, no listings — the interview is the only useful next move. */
    expect(out.kind).toBe('ask');
    expect(String(out.reply)).toMatch(/build the page first/i);
  });
});
