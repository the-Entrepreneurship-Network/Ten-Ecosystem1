'use strict';

/**
 * @jest-environment node
 *
 * The pages this covers all shipped as interfaces over nothing: success
 * dialogs where a write should have been, arrays of invented people, and one
 * endpoint the browser called for months without it existing.
 *
 * These tests assert the properties that were false before — that a thing
 * submitted is a thing stored, that a score is decided by the server, and that
 * an empty database produces an empty list rather than a sample.
 */

const mongoose = require('mongoose');

describe('the schemas that back the formerly-fake screens', () => {
  const MODELS = [
    ['ContractorProject',   'contractorId'],
    ['ContractorMilestone', 'deliverableUrl'],
    ['ContractorTimesheet', 'hours'],
    ['InvestorInterest',    'startupName'],
    ['InvestorHolding',     'amount'],
    ['Program',             'slug'],
    ['ProgramApplication',  'email'],
    ['Hackathon',           'slug'],
    ['HackathonTeam',       'leadEmail'],
    ['DailyJobPost',        'date'],
    ['DomainGroup',         'inviteUrl']
  ];

  it.each(MODELS)('%s is a real model with a %s field', (name, field) => {
    const Model = require(`../../models/${name}`);
    expect(Model.modelName).toBe(name);
    expect(Model.schema.path(field)).toBeDefined();
  });

  it('records one daily job post per student per day, in the database', () => {
    // The old flow enforced this with a localStorage key, which any student
    // could clear to claim the coins again.
    const DailyJobPost = require('../../models/DailyJobPost');
    const unique = DailyJobPost.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => Object.keys(fields).sort().join(','));
    expect(unique).toContain('date,studentId');
  });

  it('stops one investor registering the same interest twice', () => {
    const InvestorInterest = require('../../models/InvestorInterest');
    const unique = InvestorInterest.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => Object.keys(fields).sort().join(','));
    expect(unique).toContain('investorId,startupName');
  });

  it('stops one person applying to the same programme twice', () => {
    const ProgramApplication = require('../../models/ProgramApplication');
    const unique = ProgramApplication.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => Object.keys(fields).sort().join(','));
    expect(unique).toContain('email,programId');
  });

  it('reads the quiz bank that already existed rather than a second one', () => {
    /*
     * A correction to the audit: the editable question bank was never missing.
     * models/new/QuizQuestion is the collection services/v2/quizEngine reads
     * for /api/v2/quiz/*. What was hardcoded was the parallel
     * /api/v2/student/generate-quiz path, which ignored it. Adding a second
     * QuizQuestion model broke the quiz routes outright — "Cannot overwrite
     * `QuizQuestion` model once compiled" — so this pins the reuse.
     */
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../routes/v2/studentPortal.js'), 'utf8');
    expect(src).toContain('require("../../models/new/QuizQuestion")');
    expect(fs.existsSync(path.join(__dirname, '../../models/QuizQuestion.js'))).toBe(false);
  });
});

describe('a programme closes when its deadline passes', () => {
  const Program = require('../../models/Program');

  function program(fields) {
    return new Program(Object.assign({
      title: 'TEN Summer Internship',
      slug: 'ten-summer-internship',
      published: true,
      status: 'open'
    }, fields));
  }

  it('is open when published, open and in date', () => {
    expect(program({ deadline: new Date(Date.now() + 86400000) }).isOpen()).toBe(true);
  });

  it('is closed once the deadline is in the past', () => {
    /*
     * The array this replaced advertised "TEN Summer Internship 2025" with a
     * 2025-08-15 deadline long after that date, because a literal cannot
     * notice time passing.
     */
    expect(program({ deadline: new Date('2025-08-15') }).isOpen()).toBe(false);
  });

  it('is closed while it is an unpublished draft', () => {
    expect(program({ published: false, deadline: null }).isOpen()).toBe(false);
  });
});

describe('hackathon registration respects its own window', () => {
  const Hackathon = require('../../models/Hackathon');

  function event(fields) {
    return new Hackathon(Object.assign({
      title: 'TEN Build Weekend',
      slug: 'ten-build-weekend',
      published: true,
      status: 'registration_open'
    }, fields));
  }

  it('opens when published and inside the window', () => {
    expect(event({
      registrationOpensAt: new Date(Date.now() - 3600000),
      registrationClosesAt: new Date(Date.now() + 3600000)
    }).registrationOpen()).toBe(true);
  });

  it('closes after the closing time', () => {
    expect(event({ registrationClosesAt: new Date(Date.now() - 1000) }).registrationOpen()).toBe(false);
  });

  it('is shut while it is a draft', () => {
    expect(event({ published: false }).registrationOpen()).toBe(false);
  });
});

describe('the routes are mounted and reachable', () => {
  const fs = require('fs');
  const path = require('path');
  const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it.each([
    ['/api/v2/contractor',    './routes/v2/contractorDesk'],
    ['/api/v2/investor-desk', './routes/v2/investorDesk'],
    ['/api/v2/hackathons',    './routes/v2/hackathons'],
    ['/api/v2/groups',        './routes/v2/domainGroups']
  ])('%s is mounted', (mount, file) => {
    expect(server).toContain(mount);
    expect(server).toContain(file);
  });

  it('mounts the Setu gateway router the docs always claimed was live', () => {
    expect(server).toContain('"/api/payment/setu"');
    expect(server).toContain('./routes/paymentSetuRoutes');
  });

  it('still does not mount the router with no auth on initiate', () => {
    // routes/paymentRoutes.js POST /initiate takes studentId from the body and
    // has no guard. It must stay unreachable.
    expect(server).not.toContain('routes/paymentRoutes');
  });
});

describe('the endpoints the pages call actually exist', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');
  const studentPortal = fs.readFileSync(path.join(root, 'routes/v2/studentPortal.js'), 'utf8');

  it('defines the daily-job-post endpoint v2-tasks.html has always called', () => {
    expect(studentPortal).toContain('"/student/daily-job-post"');
  });

  it('grades the quiz on the server instead of believing the client', () => {
    // Anchored on the route registration, not the first mention of the path —
    // the path also appears in the comments explaining this change.
    const at = studentPortal.indexOf('router.post("/student/quiz-result"');
    expect(at).toBeGreaterThan(-1);
    const block = studentPortal.slice(at, at + 1600);

    // The old handler destructured `passed` and `coins` off the request body
    // and awarded on them.
    expect(block).not.toMatch(/const \{[^}]*\bpassed\b[^}]*\} = req\.body/);
    expect(block).toContain('gradeQuiz(');
  });

  it('does not ship the answer key with the questions', () => {
    const at = studentPortal.indexOf('router.post("/student/generate-quiz"');
    expect(at).toBeGreaterThan(-1);
    const block = studentPortal.slice(at, at + 2000);
    // Questions are mapped to id/question/options only — correct_answer stays
    // on the server.
    expect(block).toContain('question: q.question_text');
    expect(block).not.toContain('correct_answer');
    expect(block).not.toMatch(/answer:\s*q\.answer/);
  });
});

describe('the pages no longer carry invented people', () => {
  const fs = require('fs');
  const path = require('path');
  const pub = path.join(__dirname, '../../public');

  it.each(['community.html', 'programs.html', 'talent-network.html'])(
    '%s has no seeded talent, mentor or investor rows',
    (name) => {
      const src = fs.readFileSync(path.join(pub, name), 'utf8');
      expect(src).toContain('let localTalents = [];');
      expect(src).toContain('let localMentorsList = [];');
      expect(src).toContain('let localInvestorsList = [];');
      expect(src).toContain('loadRealDirectories');
      // The people who used to be hardcoded into every copy of the page.
      expect(src).not.toContain('Astra Syndicate Fund');
      expect(src).not.toContain('Rakesh Singhal');
      expect(src).not.toContain('Nisha Sharma');
      expect(src).not.toContain('Dr. Vivek Khare');
      // The scripted conversation between them.
      expect(src).toContain('localCommunityChats = { founders: [], talent: [], investor: [] }');
    }
  );

  it('groups.html resolves invites from the database', () => {
    const src = fs.readFileSync(path.join(pub, 'groups.html'), 'utf8');
    expect(src).toContain('/api/v2/groups');
    // The invented slugs the old helper returned are gone as code. They survive
    // only inside the comment that records why, so this asserts on the call.
    expect(src).not.toMatch(/return "https:\/\/chat\.whatsapp\.com\/web-dev-ten"/);
    expect(src).not.toContain('function getDomainWhatsAppLink');
  });

  it('groups.html keeps the real invite links its cards already had', () => {
    /*
     * A correction to the audit that prompted this work: only the JS helper
     * returned invented slugs. The cards in the markup carry genuine opaque
     * invite tokens, and the first version of this change overrode them with
     * "coming soon" whenever the database had no row — turning nine working
     * links into dead ones.
     */
    const src = fs.readFileSync(path.join(pub, 'groups.html'), 'utf8');
    const realInvites = src.match(/chat\.whatsapp\.com\/[A-Za-z0-9]{15,}/g) || [];
    expect(realInvites.length).toBeGreaterThanOrEqual(8);
    expect(src).not.toContain('linkEl.textContent = "Coming soon"');
  });

  it('the contractor dashboard posts its milestone instead of announcing it', () => {
    const src = fs.readFileSync(path.join(pub, 'contractor-dashboard.html'), 'utf8');
    expect(src).toContain('/api/v2/contractor');
    expect(src).not.toContain('routed to client and HR administrators queues');
    expect(src).not.toContain('Interactive Canvas UI Rewrite');
  });

  it('the investor dashboard stores interest instead of claiming it did', () => {
    const src = fs.readFileSync(path.join(pub, 'investor-dashboard.html'), 'utf8');
    expect(src).toContain('/api/v2/investor-desk');
    // The claim is gone from the dialog; it survives only in the comment that
    // records what it used to say.
    expect(src).not.toMatch(/text: `Matched interest ledger/);
    // The invented startups are gone as markup. Both names survive only inside
    // the comments recording what used to be there.
    expect(src).not.toMatch(/<h4[^>]*>Krypton Solar<\/h4>/);
    expect(src).not.toMatch(/startDiscussion\('Krypton Solar'\)/);
    expect(src).toContain("fetch(API + '/startups'");
  });

  it('v2-tasks.html no longer turns a failed request into coins earned', () => {
    const src = fs.readFileSync(path.join(pub, 'v2-tasks.html'), 'utf8');
    expect(src).not.toContain("catch(() => ({ success: true }))");
    expect(src).toContain('Could not reach the server');
  });
});

describe('programApiRoutes serves the database, not a literal', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../routes/programApiRoutes.js'), 'utf8');

  it('no longer defines the PROGRAMS_DATA literal', () => {
    // The name survives in the file header explaining what was removed, so the
    // assertion is on the declaration rather than the string.
    expect(src).not.toMatch(/const PROGRAMS_DATA\s*=/);
    expect(src).not.toContain("title: 'TEN Summer Internship 2025'");
  });

  it('stores an application rather than answering that it did', () => {
    expect(src).toContain('ProgramApplication.create');
  });

  it('counts the ecosystem stats it used to hardcode as zeros', () => {
    const at = src.indexOf("router.get('/founder-os/stats'");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 1400);
    expect(block).toContain('countDocuments');
    expect(block).not.toMatch(/internships:\s*0,\s*students:\s*0/);
  });
});

afterAll(async () => {
  // The models register on the default connection; close it so Jest exits.
  await mongoose.disconnect().catch(() => {});
});
