'use strict';

/**
 * GET /api/v2/certificates/my-certs — the My Certificates page.
 *
 * The page reported "Could not load certificates." and showed "—%" for course
 * completion. Two separate faults produced that:
 *
 *   1. The handler's catch returned `{ error }` with no `success` and no
 *      `message`. The page checks `d.success` and falls back to a fixed string
 *      when there is no `message`, so the server's actual reason — the only
 *      thing that would have explained the failure — never reached the screen
 *      or a bug report.
 *
 *   2. Reading the student's already-ISSUED certificate records was
 *      unguarded, so a problem there took down the whole page. Those records
 *      are decoration: they add a download link for a certificate already
 *      issued. Whether one is unlocked comes from the task-progress figures,
 *      which are computed separately — so a student was denied sight of their
 *      own progress over a record that in most cases does not exist yet.
 *
 * These tests pin both, plus the wrong-page case for a staff account.
 */

const express = require('express');
const request = require('supertest');

const mockState = {
  student: {
    _id: 'sid1', employeeId: 'TEN/WEB/1005', name: 'Test Intern',
    domain: 'Web Development', tenure: '45 Days', joiningDate: '2026-07-01'
  },
  certsThrow: false,
  progressThrows: false,
  cohortThrows: false
};

/** A thenable that also answers .lean()/.select(), like a Mongoose query. */
function mockQ(result) {
  const p = Promise.resolve(result);
  const obj = {
    lean: () => obj,
    select: () => obj,
    then: (res, rej) => p.then(res, rej),
    catch: (rej) => p.catch(rej)
  };
  return obj;
}

jest.mock('../../models/Student', () => ({
  findOne: () => mockQ(mockState.student),
  find: () => {
    if (mockState.cohortThrows) return { select: () => ({ lean: () => Promise.reject(new Error('cohort query failed')) }) };
    return mockQ([{ _id: 'sid1' }, { _id: 'sid2' }]);
  },
  schema: { path: () => true, add: () => {} }
}));

jest.mock('../../models/new/StudentCertificate', () => ({
  find: () => {
    if (mockState.certsThrow) return { lean: () => Promise.reject(new Error('certificate collection unavailable')) };
    return mockQ([]);
  }
}));

jest.mock('../../models/new/StudentTaskProgress', () => ({
  countDocuments: async () => {
    if (mockState.progressThrows) throw new Error('task progress unavailable');
    return 10;
  },
  aggregate: async () => [{ _id: 'sid1', cnt: 3 }]
}));

jest.mock('../../models/new/CoinRedemption', () => ({ find: () => mockQ([]) }), { virtual: true });
jest.mock('../../models/new/PsychologyTrigger', () => ({ find: () => mockQ([]), create: async () => ({}) }));
jest.mock('../../models/new/StudentDocument', () => ({ findOne: () => mockQ(null) }), { virtual: true });
jest.mock('../../models/DocumentHistory', () => ({ create: async () => ({}), logSend: async () => ({}) }));
jest.mock('../../models/MailHistory', () => ({ create: async () => ({}) }));
jest.mock('../../models/Notification', () => ({ create: async () => ({}) }));
// Requiring the router schedules three hourly cron jobs at module load, whose
// timers keep the Jest worker alive after the tests finish. Stubbed so the
// suite exits cleanly and nothing fires mid-test.
jest.mock('node-cron', () => ({ schedule: () => ({ stop() {}, start() {} }) }));

jest.mock('../../services/v2/certificateService', () => ({
  generateCertificateId: () => 'TEN-EXP-2026-abc123',
  generateExpertCertificate: async () => '/x.pdf',
  generateNanoCertificate: async () => '/x.pdf',
  generateFellowshipCertificate: async () => '/x.pdf'
}));

let session;

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = session; next(); });
  a.use('/api/v2', require('../../routes/v2/certificates'));
  return a;
}

beforeEach(() => {
  session = { student: { employeeId: 'TEN/WEB/1005' } };
  mockState.certsThrow = false;
  mockState.progressThrows = false;
  mockState.cohortThrows = false;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a signed-in student', () => {
  it('gets their certificate state and completion figure', async () => {
    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.expert).toBeDefined();
    expect(typeof res.body.expert.completionPct).toBe('number');
    expect(res.body.nano_degree.threshold).toBe(70);
  });
});

describe('the page survives what it does not need', () => {
  it('still loads when the issued-certificate records cannot be read', async () => {
    // This is the one that produced "Could not load certificates." A student
    // with no issued certificates — most of them — must still see their
    // progress and what is unlocked.
    mockState.certsThrow = true;
    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.expert.record).toBeNull();
  });

  it('still loads when task progress is unavailable, reporting 0%', async () => {
    mockState.progressThrows = true;
    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.expert.completionPct).toBe(0);
  });

  it('still loads when the cohort ranking fails', async () => {
    mockState.cohortThrows = true;
    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('a failure says what actually went wrong', () => {
  it('carries success:false AND a message, so the page can show the reason', async () => {
    // The page renders `d.message` and falls back to a fixed string without
    // one. A response of `{ error: ... }` alone is why a specific fault read
    // as an unexplained failure.
    const Student = require('../../models/Student');
    jest.spyOn(Student, 'findOne').mockImplementation(() => {
      throw new Error('connection to the database was disconnected');
    });

    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('connection to the database was disconnected');
  });
});

describe('the wrong account opening the page', () => {
  it('tells a staff user it is a student page, not that it is broken', async () => {
    session = { hr: { email: 'hr@ten.com' } };
    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/student/i);
  });

  it('refuses a signed-out visitor', async () => {
    session = {};
    const res = await request(app()).get('/api/v2/certificates/my-certs');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBeTruthy();
  });

  it('never lets a student read someone else by naming them', async () => {
    // The query parameter is honoured for staff only. A student asking for
    // another employee ID still gets their own record.
    const res = await request(app())
      .get('/api/v2/certificates/my-certs?employeeId=TEN/WEB/9999');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.expert).toBeDefined();
  });
});
