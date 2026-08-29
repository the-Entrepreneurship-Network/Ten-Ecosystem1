'use strict';

/**
 * POST /api/v2/student/complete-onboarding — the WhatsApp joiner's last step.
 *
 * This is the "Internship Joining Date" card. A student who attended through
 * WhatsApp before the portal existed for them picks their real start date here,
 * and the portal credits that pre-portal stretch as attended, because no daily
 * records can exist for days before they had an account.
 *
 * Two things were reported: the card would not proceed, and the attendance
 * figure was wrong. These tests drive the real handler through the scenarios a
 * WhatsApp joiner actually presents.
 */

const express = require('express');
const request = require('supertest');

const DAY = 24 * 60 * 60 * 1000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

const mockState = {
  student: null,
  saved: null,
  attendance: []
};

function mockQ(result) {
  const p = Promise.resolve(result);
  const o = { lean: () => o, select: () => o, sort: () => o, limit: () => o,
              then: (r, j) => p.then(r, j), catch: (j) => p.catch(j) };
  return o;
}

jest.mock('../../models/Student', () => ({
  findOne: (filter) => {
    // The duplicate-employee-ID check looks up a DIFFERENT id; nothing else
    // should ever match.
    if (filter && filter.employeeId && filter.employeeId !== mockState.student.employeeId) {
      return mockQ(null);
    }
    return mockQ(mockState.student);
  },
  findOneAndUpdate: (_f, update) => {
    mockState.saved = update.$set;
    return mockQ(Object.assign({}, mockState.student, update.$set));
  },
  updateOne: async () => ({}),
  updateMany: async () => ({}),
  find: () => mockQ([]),
  countDocuments: async () => 0,
  schema: { path: () => true, add: () => {} }
}));

jest.mock('../../models/Attendance', () => ({
  find: () => mockQ(mockState.attendance),
  updateMany: async () => ({}),
  countDocuments: async () => 0
}));

jest.mock('../../middleware/sessionAuth', () => ({
  requireStudent: (req, res, next) => { req.student = mockState.student; next(); },
  requireHR: (req, res, next) => next(),
  requireStaff: (req, res, next) => next(),
  requireCoordinator: (req, res, next) => next()
}));

jest.mock('node-cron', () => ({ schedule: () => ({ stop() {}, start() {} }) }));

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = { student: { employeeId: mockState.student.employeeId } }; next(); });
  a.use('/api/v2', require('../../routes/v2/studentPortal'));
  return a;
}

/** A student who registered on the portal `portalDaysAgo` days ago. */
function studentRegistered(portalDaysAgo, extra) {
  const created = new Date(Date.now() - portalDaysAgo * DAY);
  return Object.assign({
    _id: 'sid1',
    employeeId: 'TEN/WEB/1005',
    firstName: 'Test', lastName: 'Intern',
    domain: 'Web Development',
    tenure: '3 Months',
    joiningDate: iso(created),
    createdAt: created
  }, extra || {});
}

const post = (body) => request(app()).post('/api/v2/student/complete-onboarding').send(body);

beforeEach(() => {
  mockState.student = studentRegistered(10);
  mockState.saved = null;
  mockState.attendance = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the card proceeds', () => {
  it('accepts a start date well before the portal registration', async () => {
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 60 * DAY) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts a start date on the SAME DAY the student registered', async () => {
    // Someone who joined the WhatsApp group and registered the same day is a
    // perfectly ordinary case and must not be turned away.
    const res = await post({ joinerType: 'whatsapp', joiningDate: mockState.student.joiningDate });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects a date in the future, and says so', async () => {
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() + 3 * DAY) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/future/i);
  });

  it('does not strand a student who picks a date AFTER their stored joiningDate', async () => {
    // The trap in the screenshot. `joiningDate` on these records is frequently
    // the day an admin created the row, not the day the student began — and it
    // is never shown on this card. The copy promises only that "future dates
    // are not allowed", so a student picking a perfectly ordinary past date was
    // refused for violating a constraint they could not see and had no way to
    // satisfy. There is no other screen: they are stuck there for good.
    //
    // A start date after the portal registration is not an error. It just means
    // there is no pre-portal gap to credit.
    mockState.student = studentRegistered(90);                     // row created 90 days ago
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 50 * DAY) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('does not strand a student whose portal joiningDate is AFTER their real start', async () => {
    // The blocking case. `joiningDate` on these records is frequently the date
    // an admin created the row, not the day the student began — so a genuine
    // WhatsApp joiner picking their real (earlier) start could be refused with
    // no date they could pick instead. There is no way out of that card.
    mockState.student = studentRegistered(2);                      // registered 2 days ago
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 90 * DAY) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('still saves the joining date when the joiner type is missing from the body', async () => {
    // The wizard keeps joinerType in a page-level variable. A reload between
    // steps loses it, and the date the student just picked was then discarded
    // in silence — they proceed, and the whole step has done nothing.
    mockState.student = studentRegistered(10, { joinerType: 'whatsapp', joinerTypeSelected: true });
    const res = await post({ joiningDate: iso(Date.now() - 45 * DAY) });
    expect(res.status).toBe(200);
    expect(mockState.saved.internshipStartDate).toBeInstanceOf(Date);
  });
});

describe('the WhatsApp attendance figure', () => {
  it('credits the pre-portal stretch instead of reporting zero', async () => {
    // The heart of the feature. A student who started on WhatsApp before
    // registering has NO attendance rows for those days — no account existed —
    // so counting only rows gives 0 and tells them they have attended nothing.
    mockState.student = studentRegistered(10);
    mockState.attendance = [];

    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 30 * DAY) });
    expect(res.status).toBe(200);
    expect(res.body.student.presentCount).toBeGreaterThan(0);
    expect(res.body.student.calculatedAttendance).toBe(res.body.student.presentCount);
    expect(res.body.student.progress.creditHeldForReview).toBe(false);
  });

  /*
   * The same feature, one step too far.
   *
   * Nobody can check a day the student says they worked before they had an
   * account — there is no record to check it against. For an ordinary claim
   * that is fine. For a claim big enough to satisfy the whole 75% requirement
   * by itself, the student need attend nothing at all, and a student typing a
   * date into a box should not be able to decide that about themselves.
   *
   * It is held, not refused: a real four-month WhatsApp joiner exists, and
   * refusing would strand them on the last card of onboarding with nothing
   * else to press.
   */
  it('holds a claim that would meet the whole requirement on its own', async () => {
    mockState.student = studentRegistered(10);
    mockState.attendance = [];

    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 70 * DAY) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);              // accepted, not refused
    expect(res.body.student.progress.creditHeldForReview).toBe(true);
    expect(res.body.student.presentCount).toBe(0);    // worth nothing until HR says
    expect(mockState.saved.preportalCreditNeedsReview).toBe(true);
    expect(mockState.saved.internshipStartDate).toBeInstanceOf(Date);
  });

  it('refuses a start date in the future, and nothing else', async () => {
    const future = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() + 5 * DAY) });
    expect(future.status).toBe(400);
    expect(future.body.message).toMatch(/future/i);

    // Two years back is accepted — held, but accepted.
    const ancient = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 730 * DAY) });
    expect(ancient.status).toBe(200);
    expect(ancient.body.success).toBe(true);
  });

  it('will not be answered twice without an HR reset', async () => {
    // The "asked once" rule used to live only in the browser: the request could
    // simply be sent again, re-picking the start date and changing the employee
    // ID every Attendance row is keyed to.
    mockState.student = studentRegistered(10, { v2Onboarded: true });
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 20 * DAY) });
    expect(res.status).toBe(409);
    expect(res.body.alreadyCompleted).toBe(true);
  });

  it('moves the end date with the start date', async () => {
    mockState.student = studentRegistered(10);
    await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 30 * DAY) });
    expect(mockState.saved.internshipEndDate).toBeInstanceOf(Date);
  });

  it('reports presentCount rather than a hardcoded 0', async () => {
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 40 * DAY) });
    expect(res.body.student.presentCount).toBe(res.body.student.calculatedAttendance);
  });

  it('counts marked days on top of the credited ones', async () => {
    const marked = [1, 2, 3].map(n => ({
      status: 'Present',
      dateKey: iso(Date.now() - n * DAY),
      markedBy: 'self'
    }));
    mockState.attendance = marked;
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 70 * DAY) });
    expect(res.body.student.presentCount).toBeGreaterThanOrEqual(3);
  });

  it('measures the target against the real tenure, not a default 30', async () => {
    mockState.student = studentRegistered(10, { tenure: '3 Months' });
    const res = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 40 * DAY) });
    expect(res.body.student.totalTenureDays).toBe(90);
  });

  it('honours a coordinator’s absence correction', async () => {
    mockState.student = studentRegistered(10, { preportalAbsentDays: 5 });
    const withCorrection = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 30 * DAY) });

    mockState.student = studentRegistered(10, { preportalAbsentDays: 0 });
    mockState.saved = null;
    // The SAME date on both sides — otherwise the difference is the date, not
    // the correction.
    const without = await post({ joinerType: 'whatsapp', joiningDate: iso(Date.now() - 30 * DAY) });

    expect(withCorrection.body.student.presentCount)
      .toBe(without.body.student.presentCount - 5);
  });
});

describe('a normal (non-WhatsApp) joiner', () => {
  it('is recorded without any pre-portal credit', async () => {
    const res = await post({ joinerType: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.student.calculatedAttendance).toBe(0);
    expect(mockState.saved.internshipStartDate).toBeUndefined();
  });
});
