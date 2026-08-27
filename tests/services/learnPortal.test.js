'use strict';

/**
 * The LLM portal: curriculum, exams and the rules around them.
 */

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const curriculum = require('../../config/learnCurriculum');
const learnExam = require('../../services/learnExam');
const studioPricing = require('../../config/studioPricing');
const ROUTE = strip(read('routes/v2/learn.js'));
const PAGE = read('public/learn.html');
const HRPAGE = read('public/hr-proctor.html');
const STUDIO_ROUTE = strip(read('routes/v2/studio.js'));

describe('one module per domain', () => {
  const mods = curriculum.getModules();

  it('covers every selectable domain, from the one domain list', () => {
    const { DOMAINS } = require('../../config/domains');
    expect(mods.length).toBe(DOMAINS.filter((d) => d.selectable !== false).length);
  });

  it.each(mods.map((m) => [m.slug, m]))('%s has more than 20 topics', (_slug, m) => {
    expect(m.topics.length).toBeGreaterThan(20);
    expect(m.ready).toBe(true);
  });

  // "the level of difficulty should increase bit by bit"
  it.each(mods.map((m) => [m.slug, m]))('%s gets harder, never easier', (_slug, m) => {
    const d = m.topics.map((t) => t.difficulty);
    expect(d[0]).toBe(1);
    expect(d[d.length - 1]).toBe(5);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
  });

  // "written in the technical explanations then simple explanation"
  it.each(mods.map((m) => [m.slug, m]))('%s explains every topic twice, and points at a video', (_slug, m) => {
    m.topics.forEach((t) => {
      expect(t.technical.length).toBeGreaterThan(80);
      expect(t.simple.length).toBeGreaterThan(30);
      expect(t.simple.length).toBeLessThan(t.technical.length);
      expect(t.videoId || t.videoSearch).toBeTruthy();
    });
  });

  it('is content a human edits, not a database', () => {
    expect(fs.existsSync(curriculum.DATA_DIR)).toBe(true);
    expect(fs.readdirSync(curriculum.DATA_DIR).filter((f) => f.endsWith('.json')).length).toBe(mods.length);
  });
});

describe('the exam shape', () => {
  it('is 10 written then 10 MCQ per topic, and bigger for the final', () => {
    expect(learnExam.TOPIC_WRITTEN).toBe(10);
    expect(learnExam.TOPIC_MCQ).toBe(10);
    expect(learnExam.FINAL_WRITTEN).toBeGreaterThan(learnExam.TOPIC_WRITTEN);
    expect(learnExam.FINAL_MCQ).toBeGreaterThan(learnExam.TOPIC_MCQ);
  });

  it('gives the final two hours', () => {
    expect(learnExam.FINAL_MINUTES).toBe(120);
  });

  /*
   * "that question should change automatically" — a retake must not be the
   * same paper. Questions are generated per attempt from the topic text, so
   * there is no bank to repeat.
   */
  it('sets a fresh paper for every attempt', () => {
    expect(ROUTE).toContain('paper = await learnExam.generatePaper(mod, topicN)');
    const files = fs.readdirSync(curriculum.DATA_DIR);
    files.forEach((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(curriculum.DATA_DIR, f), 'utf8'));
      // No stored questions anywhere in the seed content.
      expect(JSON.stringify(raw)).not.toMatch(/"questions"|"answerIndex"/);
    });
  });

  // The client scores nothing: it never receives the key.
  it('never sends the MCQ answers to the browser', () => {
    expect(ROUTE).toMatch(/options: q\.kind === 'mcq' \? q\.options : undefined/);
    const client = ROUTE.slice(ROUTE.indexOf('function clientQuestions'), ROUTE.indexOf('function clientQuestions') + 400);
    expect(client).not.toContain('answerIndex');
  });

  it('marks written answers with the AI, and refuses rather than faking it', () => {
    expect(ROUTE).toContain('verdicts = await learnExam.gradeWritten(');
    expect(ROUTE).toContain('if (!learnExam.ready())');
  });

  it('keeps the clock on the server', () => {
    expect(ROUTE).toMatch(/Date\.now\(\) > attempt\.deadlineAt\.getTime\(\)/);
  });

  it('does not fail a learner because the marker had an outage', () => {
    expect(ROUTE).toContain('retryable: true');
  });
});

describe('the order is the course', () => {
  it('opens a topic only when the earlier ones are settled', () => {
    expect(ROUTE).toContain('function firstUnsettled(mod, progress)');
    expect(ROUTE).toContain('if (n > firstUnsettled(mod, progress))');
  });

  it('opens the exam only after the video', () => {
    expect(ROUTE).toMatch(/if \(!st \|\| !st\.videoDoneAt\) \{/);
    expect(ROUTE).toContain('The exam opens after the video.');
  });

  it('opens the final only when every topic is settled', () => {
    expect(ROUTE).toContain('The final opens when every topic is settled.');
  });
});

describe('proctoring', () => {
  it('warns three times, then voids the attempt', () => {
    expect(ROUTE).toContain('const WARN_LIMIT = 3;');
    expect(ROUTE).toContain('const crossed = attempt.warningCount >= WARN_LIMIT;');
    expect(ROUTE).toContain('attempt.voidedAt = new Date();');
  });

  it('needs the camera before the paper appears', () => {
    expect(PAGE).toContain('navigator.mediaDevices.getUserMedia');
    expect(PAGE).toContain('This exam is camera-proctored');
  });

  it('warns on an empty frame and on leaving the tab', () => {
    expect(PAGE).toContain("warn('nobody visible in frame')");
    expect(PAGE).toContain("warn('left the exam tab')");
  });

  // One warning per six seconds, not one per frame — otherwise a single
  // moment away from the desk would burn all three instantly.
  it('does not spend all three warnings in one second', () => {
    expect(PAGE).toContain('cooling = Date.now() + 6000;');
  });

  it('tells HR, in the portal and by email', () => {
    expect(ROUTE).toContain('Proctoring limit crossed — decision needed');
    // Both halves live in the one helper the fee-deferral queue also uses.
    expect(ROUTE).toContain("require('../../services/hrAlert').alertHR");
    const alert = read('services/hrAlert.js');
    expect(alert).toContain('EcosystemNotification.insertMany');
    expect(alert).toContain('HR_NOTIFY_EMAIL');
    // Neither half may take the request down with it.
    expect((alert.match(/catch \(err\)/g) || []).length).toBe(2);
  });

  it('holds every exam in that module until HR decides', () => {
    expect(ROUTE).toMatch(/ProctorIncident\.findOne\(\{ userId: who\.id, domainSlug: slug, status: 'pending' \}\)/);
    expect(ROUTE).toContain('proctorHold: true');
  });
});

describe('the HR decision', () => {
  it('approves a retake or closes the exam for good', () => {
    expect(ROUTE).toContain("if (action !== 'approve' && action !== 'reject')");
    expect(ROUTE).toContain("'topics.$.closedByHRAt': new Date()");
  });

  // "if do reject that then student ... move ahead and complete the next topic"
  it('lets a rejected learner carry on to the next topic', () => {
    expect(ROUTE).toContain('if (!st || (!st.passedAt && !st.closedByHRAt)) return t.n;');
  });

  it('can email the learner either way', () => {
    expect(ROUTE).toContain('Your TEN exam is unlocked again');
    expect(ROUTE).toContain('About your TEN exam proctoring review');
  });

  it('is HR-only, and cannot be decided twice', () => {
    expect(ROUTE).toContain('function requireHR(handler)');
    expect(ROUTE).toContain("if (incident.status !== 'pending')");
    expect(HRPAGE).toContain('/api/v2/learn/hr/incidents');
  });
});

describe('the certificate', () => {
  it('needs the topics, the final and the project settled', () => {
    expect(ROUTE).toContain('const projectDone = !!(progress.project.doneAt || progress.project.skippedAt)');
    expect(ROUTE).toMatch(/if \(!allSettled \|\| !progress\.finalExam\.passedAt \|\| !projectDone\)/);
  });

  it('lets the big project be done or skipped', () => {
    expect(ROUTE).toContain("'project.skippedAt': new Date()");
  });

  /*
   * "if choose that pay after competition section then for them they first
   * need to pay then only they can download that certificate"
   */
  it('is held back from a learner who still owes the deferred fee', () => {
    expect(ROUTE).toContain('if (access.feeDue) {');
    expect(ROUTE).toContain('this is completion');
  });

  it('can be checked by anyone holding the id', () => {
    expect(ROUTE).toContain("router.get('/verify/:certId'");
  });
});

describe('pay after completion is the course only', () => {
  it('is declared on the course and nowhere else', () => {
    expect(studioPricing.PRODUCTS.course.deferrable).toBe(true);
    ['resume', 'job', 'combo'].forEach((k) =>
      expect(studioPricing.PRODUCTS[k].deferrable).toBeFalsy());
  });

  it('is refused by the order route for the others', () => {
    expect(STUDIO_ROUTE).toContain('!product.deferrable');
    expect(STUDIO_ROUTE).toContain('is pay-first. Only the course offers pay after completion.');
  });

  it('is offered on screen only where it exists', () => {
    expect(read('public/studio.html')).toContain('p.deferrable');
  });
});

describe('what the money buys is shown before it is asked for', () => {
  it.each(Object.keys(studioPricing.PRODUCTS))('%s lists what it includes', (key) => {
    expect(studioPricing.PRODUCTS[key].includes.length).toBeGreaterThanOrEqual(2);
  });

  it('is rendered on the pay screen', () => {
    expect(read('public/studio.html')).toContain('p.includes.map');
  });
});

describe('learner accounts', () => {
  it('are their own role, not interns', () => {
    expect(read('models/EcosystemUser.js')).toContain('"learner"');
    expect(ROUTE).toContain("role: 'learner'");
  });

  it('never reveal which addresses exist', () => {
    expect(ROUTE).toContain("const BAD = { success: false, message: 'Email or password is incorrect.' };");
  });

  it('store only hashes', () => {
    expect(ROUTE).toContain('await bcrypt.hash(password, 10)');
    expect(ROUTE).toContain('await bcrypt.compare(password');
  });

  it('gate every module behind the course fee', () => {
    expect(ROUTE).toContain('if (!access.portals.course.granted)');
  });
});

/*
 * A learner buys ONE course. The portal used to open on all fifteen modules,
 * which is fourteen doors that are not theirs and one that is.
 */
describe('one domain, chosen once', () => {
  const PAGESRC = strip(PAGE);

  it('is stored on the account, not guessed from progress', () => {
    // A progress row exists the moment a module screen is opened, so progress
    // cannot tell "mine" from "looked at once".
    expect(read('models/EcosystemUser.js')).toContain('learnDomain');
    expect(ROUTE).toContain('async function chosenDomain(who)');
    expect(ROUTE).toContain("router.post('/domain'");
  });

  it('a withdrawn module cannot lock somebody out of the portal', () => {
    const fn = ROUTE.slice(ROUTE.indexOf('async function chosenDomain'));
    expect(fn.slice(0, 400)).toContain('curriculum.getModule(slug)');
  });

  /*
   * The choice has to be a rule, not a filter. Every route that names a module
   * asks the same question, or the other fourteen are one typed URL away.
   */
  it('every module-scoped route refuses another domain', () => {
    expect(ROUTE).toContain('async function requireOwnDomain(who, slug, res)');
    const guarded = [
      "router.get('/module/:slug'",
      "router.get('/module/:slug/topic/:n'",
      "router.post('/module/:slug/topic/:n/video-done'",
      "router.post('/exam/start'",
      "router.post('/module/:slug/project'",
      "router.get('/module/:slug/certificate'"
    ];
    for (const route of guarded) {
      const at = ROUTE.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      const body = ROUTE.slice(at, at + 1200);
      expect(body).toContain('requireOwnDomain(who');
    }
    // The exam is the one that matters most: it is reached by body, not by URL.
    const exam = ROUTE.slice(ROUTE.indexOf("router.post('/exam/start'"));
    expect(exam.indexOf('requireOwnDomain')).toBeLessThan(exam.indexOf('isFinal ?'));
  });

  it('the curriculum returns their module alone once they have chosen', () => {
    expect(ROUTE).toContain('modules: [mine]');
    expect(ROUTE).toContain("req.query.choose === '1'");
  });

  /*
   * Switchable until something is earned, fixed after. The certificate names a
   * domain; carrying progress into another one would issue it for a course
   * nobody sat.
   */
  it('locks the choice once a topic has been passed', () => {
    const fn = ROUTE.slice(ROUTE.indexOf("router.post('/domain'"));
    const body = fn.slice(0, fn.indexOf('\n}));'));
    expect(body).toContain('settledCount(p) > 0');
    expect(body).toMatch(/status\(409\)/);
  });

  it('the portal opens on the module, and the chooser only when there is none', () => {
    expect(PAGESRC).toContain('if (d.chosen) { moduleScreen(d.chosen, d); return; }');
    expect(PAGESRC).toContain('chooseScreen(d)');
    // and there is no "all modules" way back any more
    expect(PAGESRC).not.toContain('All modules');
    // and the fifteen-card grid it used to be went with it
    expect(PAGE).not.toContain('.mod{');
  });
});

describe('the portal earns its price', () => {
  const PAGESRC = strip(PAGE);

  /*
   * A <button> does not inherit color — it takes the UA's `buttontext`, which
   * is black. The module cards and every topic row are buttons, so their titles
   * were rendering black on a black card.
   */
  it('buttons take the page colour, not the browser default', () => {
    expect(PAGE).toMatch(/button,\.btn\{font-family:inherit;color:inherit/);
  });

  it('the domain chooser is real 3D, and still made of buttons', () => {
    expect(PAGE).toContain('perspective:1200px');
    expect(PAGE).toContain('transform-style:preserve-3d');
    expect(PAGESRC).toContain('rotateY(${ry}deg)');
    // Clickable, focusable, keyboard- and swipe-driven — what a canvas would cost.
    expect(PAGESRC).toContain('<button class="dcard"');
    expect(PAGESRC).toContain("e.key === 'ArrowLeft'");
    expect(PAGESRC).toContain("stage.addEventListener('touchend'");
    // Cards behind the front one are out of the tab order, not merely faded.
    expect(PAGESRC).toContain('c.tabIndex = a > 2 ? -1 : 0;');
  });

  it('the run is drawn with real perspective, not a scaled row', () => {
    const fn = PAGESRC.slice(PAGESRC.indexOf('function drawPath'));
    expect(fn).toContain('const k = 1 / z3;');
    expect(fn).toContain('x3 * k');
    expect(fn).toContain('y3 * k');
  });

  it('none of it punishes a phone or a battery', () => {
    expect(PAGESRC).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(PAGE).toContain('@media (prefers-reduced-motion:reduce)');
    // The field is removed outright, not merely stilled.
    expect(PAGESRC).toContain('cv.remove()');
    // DPR is clamped, and a hidden tab stops painting.
    expect(PAGESRC).toMatch(/Math\.min\(1\.5, window\.devicePixelRatio/);
    expect(PAGESRC).toContain("document.addEventListener('visibilitychange'");
    expect(PAGESRC).toContain('cancelAnimationFrame(raf)');
  });
});
