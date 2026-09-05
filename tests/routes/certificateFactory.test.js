'use strict';

/**
 * The anonymous certificate factory in routes/v2/certificates.js.
 *
 * Six routes in that file had no authentication of any kind, and every one of
 * them took the student's identity straight from the request. The router is
 * mounted twice — at /api/v2 and again at /api/v2/certificates — so each was
 * reachable at two URLs.
 *
 * Chained together, a stranger could:
 *
 *   POST /hr-approve  { studentId, certTypes:['LOC','LOR','STAR'], force:true }
 *        -> generate all three certificates for any student
 *   POST /issue-lop   { studentId, newRole:'Chief Executive' }
 *        -> mint a Letter of Promotion naming any role
 *   POST /pay-fine    { studentId, fineType }
 *        -> clear an outstanding fine and trigger issue
 *   POST /coordinator-approve { studentId }
 *        -> mark an internship complete
 *   GET  /pending-hr
 *        -> read every student's name, employee id, attendance and score
 *   GET  /download/LOR?employeeId=...
 *        -> download the finished PDF
 *
 * The five write/list routes are deleted: nothing called them. The HR portal
 * posts to /students/:id/hr-approve in server.js and the coordinator dashboard
 * to /students/:id/coordinator-approve, which are the guarded implementations.
 *
 * /download is kept — my-documents.html links to it — and gated with
 * requireSelfOrStaff.
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const OWNER = 'TEN/WEB/1005';

/** A thenable that also answers .lean()/.select(), like a Mongoose query. */
function mockQ(result) {
  const obj = {
    lean: () => obj,
    select: () => obj,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
    catch: (rej) => Promise.resolve(result).catch(rej)
  };
  return obj;
}

const mockState = {
  student: {
    _id: 'sid1', employeeId: OWNER, name: 'Test Intern',
    domain: 'Web Development', tenure: '45 Days', joiningDate: '2026-07-01'
  }
};

jest.mock('../../models/Student', () => ({
  findOne: () => mockQ(mockState.student),
  find: () => mockQ([{ _id: 'sid1' }]),
  findById: () => mockQ(mockState.student),
  findByIdAndUpdate: () => mockQ(mockState.student),
  schema: { path: () => true, add: () => {} }
}));

jest.mock('../../models/new/StudentCertificate', () => ({ find: () => mockQ([]) }));
jest.mock('../../models/new/StudentTaskProgress', () => ({
  countDocuments: async () => 10,
  aggregate: async () => []
}));
jest.mock('../../models/new/CoinRedemption', () => ({ find: () => mockQ([]) }), { virtual: true });
jest.mock('../../models/new/PsychologyTrigger', () => ({ find: () => mockQ([]), create: async () => ({}) }));
jest.mock('../../models/new/StudentDocument', () => ({ findOne: () => mockQ(null) }), { virtual: true });
jest.mock('../../models/DocumentHistory', () => ({ create: async () => ({}), logSend: async () => ({}) }));
jest.mock('../../models/MailHistory', () => ({ create: async () => ({}) }));
jest.mock('../../models/Notification', () => ({ create: async () => ({}) }));
jest.mock('../../services/certificateEntitlement', () => ({
  feeSettled: async () => ({ covered: false, via: null }),
  feeSettledAll: async () => ({}),
  CERT_KEYS: {}
}));
jest.mock('../../services/studioAccess', () => ({
  getStudioAccess: async () => ({ portals: {}, feeDue: null, premium: false }),
  canOpen: async () => false
}));
// Requiring the router schedules hourly cron jobs whose timers would keep the
// Jest worker alive after the tests finish.
jest.mock('node-cron', () => ({ schedule: () => ({ stop() {}, start() {} }) }));
jest.mock('../../services/v2/certificateService', () => ({
  generateCertificateId: () => 'TEN-EXP-2026-abc123',
  generateExpertCertificate: async () => '/x.pdf',
  generateNanoCertificate: async () => '/x.pdf',
  generateFellowshipCertificate: async () => '/x.pdf'
}));

let session;

/** Both mounts, exactly as server.js registers them. */
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = session; next(); });
  a.use('/api/v2', require('../../routes/v2/certificates'));
  a.use('/api/v2/certificates', require('../../routes/v2/certificates'));
  return a;
}

beforeEach(() => {
  session = null;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('the five unauthenticated certificate routes are gone', () => {
  const WRITES = [
    ['/hr-approve', { studentId: 'sid1', certTypes: ['LOC', 'LOR', 'STAR'], force: true }],
    ['/pay-fine', { studentId: 'sid1', fineType: 'loc_attendance' }],
    ['/coordinator-approve', { studentId: 'sid1' }],
    ['/issue-lop', { studentId: 'sid1', newRole: 'Chief Executive' }]
  ];

  /*
   * Both mounts are checked. Deleting a route from a file mounted twice and
   * only testing one prefix would leave the other open, which is the exact
   * shape of the original bug.
   */
  WRITES.forEach(([route, body]) => {
    it(`POST ${route} is not routable at either mount`, async () => {
      for (const prefix of ['/api/v2', '/api/v2/certificates']) {
        const res = await request(app()).post(prefix + route).send(body);
        expect(res.status).toBe(404);
      }
    });
  });

  it('GET /pending-hr no longer lists every student to anonymous callers', async () => {
    for (const prefix of ['/api/v2', '/api/v2/certificates']) {
      const res = await request(app()).get(prefix + '/pending-hr');
      expect(res.status).toBe(404);
      expect(res.body.students).toBeUndefined();
    }
  });

  it('the route handlers are really deleted, not just unreachable', () => {
    const src = strip(read('routes/v2/certificates.js'));
    ["'/hr-approve'", "'/pay-fine'", "'/coordinator-approve'", "'/issue-lop'", "'/pending-hr'"]
      .forEach((route) => expect(src).not.toContain(route));
  });

  it('the guarded implementations they duplicated are still there', () => {
    // Deleting these must not remove the working Approve button behind them.
    const server = strip(read('server.js'));
    expect(server).toContain('app.post("/students/:id/hr-approve"');
    expect(server).toContain('app.post("/students/:id/coordinator-approve"');
  });
});

describe('a certificate PDF is only for the student it names', () => {
  it('an anonymous request is refused', async () => {
    const res = await request(app()).get(`/api/v2/certificates/download/LOR?employeeId=${encodeURIComponent(OWNER)}`);
    expect(res.status).toBe(401);
  });

  it('one student cannot fetch another student\'s document', async () => {
    // Employee ids are sequential and printed on every certificate, so this is
    // a walk, not a guess.
    session = { student: { employeeId: OWNER } };
    const res = await request(app()).get('/api/v2/certificates/download/LOR?employeeId=TEN%2FWEB%2F9999');
    expect(res.status).toBe(403);
  });

  it('the student it belongs to is let through', async () => {
    session = { student: { employeeId: OWNER } };
    const res = await request(app()).get(`/api/v2/certificates/download/LOR?employeeId=${encodeURIComponent(OWNER)}`);
    // The mocked student holds no PDF, so the route runs on to its own
    // "not generated yet" answer — what matters is that the guard passed.
    expect([200, 404]).toContain(res.status);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('staff can still open a student document', async () => {
    session = { hr: { username: 'hr1' } };
    const res = await request(app()).get(`/api/v2/certificates/download/LOC?employeeId=${encodeURIComponent(OWNER)}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('a missing employeeId is rejected rather than matching the first student', async () => {
    /*
     * Mongoose strips an undefined value out of a query, so
     * findOne({ employeeId: undefined }) is findOne({}) — it returns whichever
     * student happens to be first in the collection and serves their PDF.
     */
    session = { hr: { username: 'hr1' } };
    const res = await request(app()).get('/api/v2/certificates/download/LOR');
    expect(res.status).toBe(400);
  });

  it('the guard is the shared one, not a hand-rolled check', () => {
    const src = strip(read('routes/v2/certificates.js'));
    expect(src).toContain("router.get('/download/:type', requireSelfOrStaff(");
    expect(src).toContain('requireSelfOrStaff } = require("../../middleware/sessionAuth")');
  });

  it('the one page that links to it still points at the same URL', () => {
    // The fix must not have moved the route out from under the download link.
    expect(read('public/my-documents.html')).toContain('/api/v2/certificates/download/');
  });
});

describe('coordinator approval is a decision only staff can make', () => {
  const server = strip(read('server.js'));

  it('both coordinator routes are behind a session check', () => {
    expect(server).toContain('app.post("/students/:id/coordinator-approve", requireStaffSession');
    expect(server).toContain('app.post("/students/:id/coordinator-revoke", requireStaffSession');
  });

  it('the approver is read from the session, not from the request body', () => {
    // It was `coordinatorId` out of the body, so the record of who approved a
    // certificate was whatever the caller typed.
    expect(server).not.toContain('student.approvedByCoordinatorId = coordinatorId || "coordinator";');
    expect(server).toContain('student.approvedByCoordinatorId = approver;');
  });

  it('HR counts as staff here, because escalated students land with them', () => {
    const at = server.indexOf('function requireStaffSession');
    expect(at).toBeGreaterThan(-1);
    const body = server.slice(at, at + 300);
    expect(body).toContain('req.session.coordinator');
    expect(body).toContain('req.session.hr');
    expect(body).toContain('req.session.adminUser');
  });
});
