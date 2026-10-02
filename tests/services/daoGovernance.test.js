'use strict';

/**
 * The DAO, checked two ways.
 *
 * The governance maths is exercised for real — weight, tally and outcome are
 * pure functions of their arguments and need neither a database nor a session,
 * so the tests call them rather than reading the source and hoping.
 *
 * The three concurrency properties cannot be reached that way: they are the
 * difference between a filter and a read-then-write, and reproducing them
 * needs two simultaneous requests against a real Mongo. Those are asserted
 * against comment-stripped source, because each one fails SILENTLY and
 * expensively — an overdrawn balance, a double-counted vote, a deposit
 * refunded twice — and would never show up in a single-threaded test.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/* Comments describe intent; they must never satisfy an assertion about code. */
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const FILES = [
  'config/daoConfig.js', 'models/new/DaoProposal.js',
  'routes/dao.js', 'services/v2/coinService.js'
];

const dao = require('../../config/daoConfig');

describe('every file parses', () => {
  FILES.forEach((f) => {
    test(f, () => { execFileSync(process.execPath, ['--check', path.join(root, f)]); });
  });
});

describe('voting weight is the square root of the balance', () => {
  test('a balance maps to its square root, floored', () => {
    expect(dao.weightFor(100)).toBe(10);
    expect(dao.weightFor(10000)).toBe(100);
    expect(dao.weightFor(99)).toBe(9);
  });

  test('any holder of one coin gets at least one vote', () => {
    expect(dao.weightFor(1)).toBe(1);
    expect(dao.weightFor(3)).toBe(1);
  });

  test('a zero balance is no vote at all', () => {
    expect(dao.weightFor(0)).toBe(0);
  });

  test('garbage is zero, not NaN — a NaN weight would poison every tally', () => {
    expect(dao.weightFor(undefined)).toBe(0);
    expect(dao.weightFor(null)).toBe(0);
    expect(dao.weightFor('abc')).toBe(0);
    expect(dao.weightFor(-500)).toBe(0);
    expect(dao.weightFor(Infinity)).toBe(0);
  });

  test('numeric strings work — a balance read from JSON is still a balance', () => {
    expect(dao.weightFor('400')).toBe(20);
  });

  /*
   * The whole reason for the square root. The portal mints roughly 1,120
   * coins a month to an active student, so a student six months ahead holds
   * about 6x the balance of a newcomer. Under one-coin-one-vote that is 6x
   * the voice and compounds forever; this is the property that stops it.
   */
  test('a 100x balance advantage buys only 10x the voice', () => {
    const whale = dao.weightFor(1000000);
    const minnow = dao.weightFor(10000);
    expect(whale / minnow).toBe(10);
  });

  test('one big holder cannot outvote a cohort of ordinary ones', () => {
    const whale = dao.weightFor(50000);            // ~3.5 years of earning
    const cohort = Array.from({ length: 30 }, () => dao.weightFor(1120)) // one month each
      .reduce((a, b) => a + b, 0);
    expect(cohort).toBeGreaterThan(whale);
  });
});

describe('tallying votes', () => {
  const votes = [
    { choice: 'for',     weight: 10 },
    { choice: 'for',     weight: 5  },
    { choice: 'against', weight: 20 },
    { choice: 'abstain', weight: 3  }
  ];

  test('counts heads and weights separately', () => {
    const t = dao.tallyVotes(votes);
    expect(t.voters).toBe(4);
    expect(t.for).toBe(2);
    expect(t.forWeight).toBe(15);
    expect(t.againstWeight).toBe(20);
    expect(t.abstainWeight).toBe(3);
  });

  test('an unrecognised choice is ignored, not counted as a side', () => {
    const t = dao.tallyVotes([...votes, { choice: 'maybe', weight: 999 }]);
    expect(t.voters).toBe(4);
    expect(t.forWeight).toBe(15);
    expect(t.againstWeight).toBe(20);
  });

  test('no votes tallies to zeros rather than throwing', () => {
    expect(dao.tallyVotes([]).voters).toBe(0);
    expect(dao.tallyVotes(undefined).voters).toBe(0);
    expect(dao.tallyVotes([null, undefined]).voters).toBe(0);
  });
});

describe('what a tally means', () => {
  const manyVotes = (choice, weight, n) =>
    Array.from({ length: n }, () => ({ choice, weight }));

  test('below quorum nothing passes, however lopsided', () => {
    const t = dao.tallyVotes(manyVotes('for', 100, dao.QUORUM_VOTERS - 1));
    const o = dao.outcomeFor(t);
    expect(o.quorumMet).toBe(false);
    expect(o.passed).toBe(false);
  });

  test('quorum plus a weight majority carries it', () => {
    const t = dao.tallyVotes(manyVotes('for', 2, dao.QUORUM_VOTERS));
    const o = dao.outcomeFor(t);
    expect(o.quorumMet).toBe(true);
    expect(o.passed).toBe(true);
  });

  /* A coin flip is not a mandate: the status quo wins a tie. */
  test('a tie fails rather than passing', () => {
    const half = Math.ceil(dao.QUORUM_VOTERS / 2);
    const t = dao.tallyVotes([
      ...manyVotes('for', 10, half),
      ...manyVotes('against', 10, half)
    ]);
    expect(t.voters).toBeGreaterThanOrEqual(dao.QUORUM_VOTERS);
    expect(t.forWeight).toBe(t.againstWeight);
    expect(dao.outcomeFor(t).passed).toBe(false);
  });

  /* Abstaining is being present without taking a side — both halves matter. */
  test('abstentions count toward quorum but not toward the result', () => {
    const t = dao.tallyVotes([
      ...manyVotes('abstain', 50, dao.QUORUM_VOTERS - 1),
      { choice: 'for', weight: 1 }
    ]);
    const o = dao.outcomeFor(t);
    expect(o.quorumMet).toBe(true);
    expect(o.passed).toBe(true);
    expect(t.abstainWeight).toBeGreaterThan(t.forWeight);
  });

  test('the deposit comes back whenever quorum was reached, win or lose', () => {
    const rejected = dao.outcomeFor(dao.tallyVotes(manyVotes('against', 5, dao.QUORUM_VOTERS)));
    expect(rejected.passed).toBe(false);
    expect(rejected.refundDeposit).toBe(true);
  });

  test('the deposit is burned when nobody turned up', () => {
    const ignored = dao.outcomeFor(dao.tallyVotes(manyVotes('for', 5, 1)));
    expect(ignored.refundDeposit).toBe(false);
  });

  test('every outcome explains itself to the student', () => {
    expect(dao.outcomeFor(dao.tallyVotes([])).reason).toMatch(/\d/);
    expect(dao.outcomeFor(dao.tallyVotes(manyVotes('for', 2, dao.QUORUM_VOTERS))).reason)
      .toMatch(/Carried/);
  });

  test('an empty tally is safe to ask about', () => {
    expect(dao.outcomeFor(undefined).passed).toBe(false);
    expect(dao.outcomeFor(null).quorumMet).toBe(false);
  });
});

describe('the voting window', () => {
  test('closes VOTING_DAYS after it opens', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const closes = dao.closesAtFrom(from);
    const days = (closes - from) / 86400000;
    expect(days).toBe(dao.VOTING_DAYS);
  });

  test('defaults to now when given nothing', () => {
    expect(dao.closesAtFrom().getTime()).toBeGreaterThan(Date.now());
  });
});

describe('governance numbers live in one file', () => {
  /*
   * The tenure tables in this project once existed in five places and
   * silently gave every student a 30-day internship. A quorum written into
   * the route as well as the config is the same bug waiting to happen.
   */
  test('the route reads quorum and deposit from the config, never its own number', () => {
    const route = code('routes/dao.js');
    expect(route).toMatch(/require\(['"]\.\.\/config\/daoConfig['"]\)/);
    expect(route).toMatch(/dao\.QUORUM_VOTERS/);
    expect(route).toMatch(/dao\.PROPOSAL_DEPOSIT_COINS/);
    expect(route).not.toMatch(/QUORUM_VOTERS\s*=/);
    expect(route).not.toMatch(/PROPOSAL_DEPOSIT_COINS\s*=/);
  });

  test('the route does not reimplement the weight curve', () => {
    expect(code('routes/dao.js')).not.toMatch(/Math\.sqrt/);
  });

  test('the client is told the live numbers rather than hard-coding them', () => {
    const route = code('routes/dao.js');
    expect(route).toMatch(/quorumVoters:\s*dao\.QUORUM_VOTERS/);
    expect(route).toMatch(/depositCoins:\s*dao\.PROPOSAL_DEPOSIT_COINS/);
  });
});

describe('spending coins cannot overdraw an account', () => {
  const svc = code('services/v2/coinService.js');

  /*
   * The balance check belongs in the FILTER. Read-then-write is the classic
   * way two near-simultaneous spends both pass a check that was true for
   * neither of them by the time they wrote.
   */
  test('the sufficient-balance test is part of the update filter', () => {
    expect(svc).toMatch(/findOneAndUpdate\(\s*\{\s*studentId,\s*totalCoins:\s*\{\s*\$gte:\s*amount\s*\}/);
  });

  test('the balance moves by $inc, never by assignment from a read', () => {
    expect(svc).toMatch(/\$inc:\s*\{\s*totalCoins:\s*-amount\s*\}/);
    expect(svc).not.toMatch(/totalCoins\s*=\s*.*-\s*amount/);
  });

  test('a short balance returns null instead of a negative total', () => {
    expect(svc).toMatch(/return doc \?[\s\S]{0,80}: null/);
  });

  test('spending never opens an account — only awardCoins does that', () => {
    const spendBlock = svc.slice(svc.indexOf('async function spendCoins'));
    expect(spendBlock.slice(0, spendBlock.indexOf('\n}'))).not.toMatch(/upsert/);
  });

  test('it is exported, so the DAO is not reaching into the model itself', () => {
    expect(svc).toMatch(/module\.exports\s*=\s*\{[^}]*spendCoins/);
  });
});

describe('one student, one vote', () => {
  const route = code('routes/dao.js');

  /*
   * The duplicate check and the insert are the same operation. Reading the
   * votes array first and pushing afterwards lets two clicks milliseconds
   * apart both pass the check and both be counted.
   */
  test('the already-voted check is part of the update filter', () => {
    expect(route).toMatch(/'votes\.studentId':\s*\{\s*\$ne:\s*me\._id\s*\}/);
  });

  test('the same filter also refuses a closed proposal', () => {
    expect(route).toMatch(/status:\s*'open',\s*closesAt:\s*\{\s*\$gt:\s*new Date\(\)\s*\}/);
  });

  test('voting does not spend coins — no spend call in the vote handler', () => {
    const start = route.indexOf("/proposals/:id/vote");
    const end = route.indexOf('router.post', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(route.slice(start, end)).not.toMatch(/spendCoins/);
  });

  test('the weight is snapshotted onto the vote, not recomputed later', () => {
    expect(route).toMatch(/weight,/);
    expect(route).toMatch(/coinsAtVote:\s*coins/);
    expect(code('models/new/DaoProposal.js')).toMatch(/coinsAtVote:\s*\{\s*type:\s*Number/);
  });
});

describe('a deposit is refunded once, or not at all', () => {
  const route = code('routes/dao.js');

  /*
   * Closing is a claim: the update is filtered on status 'open', so of two
   * concurrent requests exactly one wins and only the winner refunds. Without
   * that filter a popular proposal closing under load pays the author twice.
   */
  test('the close is a conditional update claiming an open proposal', () => {
    const closes = route.match(/findOneAndUpdate\(\s*\{\s*_id:[^}]*status:\s*'open'\s*\}/g) || [];
    expect(closes.length).toBeGreaterThanOrEqual(2); // the deadline close and the admin close
  });

  test('the refund runs only after the claim succeeded', () => {
    expect(route).toMatch(/if \(!claimed\) continue;/);
    expect(route).toMatch(/if \(outcome\.refundDeposit && p\.depositCoins > 0\)/);
  });

  test('a failed proposal creation gives the deposit back', () => {
    expect(route).toMatch(/catch \(createErr\)[\s\S]{0,400}awardCoins\(/);
  });

  test('the refund decision comes from the config, not from the route', () => {
    expect(route).toMatch(/outcome\.refundDeposit/);
    expect(route).not.toMatch(/voters\s*>=/);
  });
});

describe('the DAO records decisions, it does not execute them', () => {
  const route = code('routes/dao.js');

  /*
   * A passed vote must not reach into pricing or the paywall. A DAO wired
   * directly into config is one brigaded proposal away from switching off a
   * product the portal sells.
   */
  test('nothing here writes pricing, the paywall or the gate', () => {
    expect(route).not.toMatch(/studioPricing|studioGate|PRODUCTS|GUARDED/);
  });

  test('closing a proposal only sets status, never calls out to config', () => {
    expect(route).not.toMatch(/process\.env\.[A-Z_]+\s*=/);
  });
});

describe('the panel asks the server rather than deciding for itself', () => {
  const ui = read('public/ten-extras.js');

  test('the DAO card is mounted for students', () => {
    expect(ui).toMatch(/id="ten-x-dao"/);
    expect(ui).toMatch(/loadDao\("ten-x-dao"\)/);
  });

  test('the quorum and deposit shown come from the API response', () => {
    expect(ui).toMatch(/me\.depositCoins/);
    expect(ui).toMatch(/me\.quorumVoters/);
  });

  test('vote buttons post to the DAO API', () => {
    expect(ui).toMatch(/\/api\/dao\/proposals\/"\s*\+\s*encodeURIComponent\(id\)\s*\+\s*"\/vote/);
  });

  test('the handlers are exported, so the inline onclick attributes resolve', () => {
    expect(ui).toMatch(/loadDao,\s*daoVote,\s*daoRaiseToggle,\s*daoSubmitProposal/);
  });

  test('proposal text is escaped before it reaches the page', () => {
    const card = ui.slice(ui.indexOf('function daoProposalCard'));
    const body = card.slice(0, card.indexOf('\n    }'));
    expect(body).toMatch(/esc\(p\.title\)/);
    expect(body).toMatch(/esc\(p\.body\)/);
    expect(body).toMatch(/esc\(p\.authorName/);
  });
});

describe('the DAO is wired into the server', () => {
  test('mounted at /api/dao', () => {
    expect(code('server.js')).toMatch(/app\.use\('\/api\/dao',\s*require\('\.\/routes\/dao'\)\)/);
  });
});
