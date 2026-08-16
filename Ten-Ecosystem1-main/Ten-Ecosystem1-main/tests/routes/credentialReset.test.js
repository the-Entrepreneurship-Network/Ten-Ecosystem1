'use strict';

/**
 * An admin gives a locked-out student a way back in, and the student takes the
 * account back.
 *
 * Students who are registered and working get stuck: an email mistyped at
 * registration that no reset link will ever reach, a forgotten password on an
 * account whose email is wrong. Nobody but an admin can fix either.
 *
 * The risk in fixing it is leaving the account permanently on a password
 * somebody else chose and knows. So the reset raises a flag, and the student's
 * next sign-in asks them to set their own — and to confirm their own email, if
 * that was changed too. Two independent steps, because the two changes are
 * independent.
 *
 * These drive the real handlers.
 */

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const mockState = { student: null, others: [], audit: [] };

function mockQ(result) {
  const o = {
    lean: () => o, select: () => o, sort: () => o, limit: () => o,
    then: (r, j) => Promise.resolve(result).then(r, j),
    catch: (j) => Promise.resolve(result).catch(j)
  };
  return o;
}

/** A Student document with a working save(). */
function makeStudent(overrides) {
  const doc = Object.assign({
    _id: 'stud1',
    employeeId: 'TEN/AI/1663',
    name: 'Anmol Kumar',
    email: 'anmol@example.com',
    password: bcrypt.hashSync('OriginalPass1', 4),
    mustChangePassword: false,
    mustChangeEmail: false,
    previousEmail: null,
    credentialResetAt: null,
    credentialResetBy: null,
    isLockedOut: true,
    failedLoginAttempts: 5,
    lockoutUntil: new Date(),
    activeSessionToken: 'ten_sess_old',
    passwordResetToken: 'stale-token',
    passwordResetExpiry: new Date()
  }, overrides || {});
  doc.save = async function () { return this; };
  return doc;
}

jest.mock('../../models/Student', () => ({
  findById: (id) => mockQ(mockState.student && mockState.student._id === id ? mockState.student : null),
  findOne: (filter) => {
    if (filter && filter.employeeId) {
      return mockQ(mockState.student && mockState.student.employeeId === filter.employeeId ? mockState.student : null);
    }
    // The uniqueness check: does any OTHER student already hold this email?
    if (filter && filter.email) {
      const rx = filter.email;
      const hit = mockState.others.find(o => rx.test(o.email));
      return mockQ(hit || null);
    }
    return mockQ(null);
  }
}));

jest.mock('../../models/AuditLog', () => ({
  create: async (entry) => { mockState.audit.push(entry); return entry; }
}));

// The admin router pulls in a great deal it does not need for these two
// endpoints. Everything below is stubbed to keep the test on the handler.
jest.mock('../../models/Payment', () => ({ findOne: () => mockQ(null), find: () => mockQ([]), countDocuments: async () => 0 }));
jest.mock('../../models/HR', () => ({ find: () => mockQ([]), findById: () => mockQ(null), countDocuments: async () => 0 }));
jest.mock('../../models/Coordinator', () => ({ find: () => mockQ([]), findById: () => mockQ(null), countDocuments: async () => 0 }));
jest.mock('../../services/studentPropagation', () => ({ propagateStudentChange: async () => ({}) }));
jest.mock('node-cron', () => ({ schedule: () => ({ stop() {} }) }));

const adminRouter = require('../../routes/adminPortal');
const studentSecurityRouter = require('../../routes/studentSecurity');

/** An app with a fixed session, so identity is never taken from the request. */
function appWith(session, mountPath, router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use(mountPath, router);
  return app;
}

// `lastActivity` because requireAdminAPI expires an idle admin session; a
// missing timestamp reads as stale and answers 401.
const ADMIN_SESSION = { adminUser: { username: 'tenadmin', lastActivity: Date.now() } };
const STUDENT_SESSION = { student: { _id: 'stud1', employeeId: 'TEN/AI/1663', email: 'anmol@example.com' } };

const adminApp = () => appWith(ADMIN_SESSION, '/api/admin', adminRouter);
const studentApp = (session) => appWith(session || STUDENT_SESSION, '/api/student/security', studentSecurityRouter);

beforeEach(() => {
  mockState.student = makeStudent();
  mockState.others = [];
  mockState.audit = [];
});

describe('the admin sets a working password', () => {
  it('replaces the password and flags the account', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026' });

    expect(res.status).toBe(200);
    expect(res.body.changed).toEqual(['password']);
    expect(await bcrypt.compare('TempPass2026', mockState.student.password)).toBe(true);
    expect(mockState.student.mustChangePassword).toBe(true);
  });

  it('clears the lockout, because a locked account makes the new password look wrong too', async () => {
    await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026' });

    expect(mockState.student.isLockedOut).toBe(false);
    expect(mockState.student.failedLoginAttempts).toBe(0);
    expect(mockState.student.lockoutUntil).toBeNull();
  });

  it('ends any session opened with the old password', async () => {
    // If the reason for the reset was somebody else in the account, leaving
    // their session alive defeats the whole exercise.
    await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026' });

    expect(mockState.student.activeSessionToken).toBeNull();
    expect(mockState.student.passwordResetToken).toBeNull();
  });

  it('records who did it and when, and never the password', async () => {
    await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026' });

    expect(mockState.student.credentialResetBy).toBe('tenadmin');
    expect(mockState.student.credentialResetAt).toBeInstanceOf(Date);

    const entry = mockState.audit[0];
    expect(entry.performedBy).toBe('tenadmin');
    const dump = JSON.stringify(entry);
    expect(dump).not.toContain('TempPass2026');
    expect(dump).not.toContain(mockState.student.password);
  });

  it('refuses a password too short to be worth setting', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(mockState.student.mustChangePassword).toBe(false);
  });

  it('refuses a request that changes nothing', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials').send({});
    expect(res.status).toBe(400);
  });

  it('leaves the prompt off when the admin says so', async () => {
    await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026', requireChange: false });
    expect(mockState.student.mustChangePassword).toBe(false);
  });

  it('still answers the older password-only route', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-password')
      .send({ newPassword: 'TempPass2026' });
    expect(res.status).toBe(200);
    expect(mockState.student.mustChangePassword).toBe(true);
  });
});

describe('the admin corrects the email', () => {
  it('updates it, keeps what it was, and flags the account', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newEmail: 'Anmol.Kumar@Example.com' });

    expect(res.status).toBe(200);
    expect(mockState.student.email).toBe('anmol.kumar@example.com');   // normalised
    expect(mockState.student.previousEmail).toBe('anmol@example.com');
    expect(mockState.student.mustChangeEmail).toBe(true);
  });

  it('refuses an address already on another account', async () => {
    // Email is a sign-in identifier, and the email branch of /login resolves
    // exactly one student.
    mockState.others = [{ employeeId: 'TEN/WEB/1005', email: 'taken@example.com' }];
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newEmail: 'taken@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('TEN/WEB/1005');
    expect(mockState.student.email).toBe('anmol@example.com');
  });

  it('refuses something that is not an email address', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newEmail: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('changes both at once, which is the usual case', async () => {
    const res = await request(adminApp())
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026', newEmail: 'fixed@example.com' });

    expect(res.body.changed).toEqual(['password', 'email']);
    expect(mockState.student.mustChangePassword).toBe(true);
    expect(mockState.student.mustChangeEmail).toBe(true);
  });
});

describe('nobody but an admin can do it', () => {
  it('turns away a student session', async () => {
    const res = await request(appWith(STUDENT_SESSION, '/api/admin', adminRouter))
      .post('/api/admin/students/stud1/reset-credentials')
      .send({ newPassword: 'TempPass2026' });
    expect(res.status).toBe(401);
    expect(mockState.student.mustChangePassword).toBe(false);
  });
});

describe('the student then sets their own password', () => {
  beforeEach(() => {
    mockState.student.mustChangePassword = true;
    mockState.student.password = bcrypt.hashSync('TempPass2026', 4);
  });

  it('reports what is outstanding', async () => {
    mockState.student.mustChangeEmail = true;
    const res = await request(studentApp()).get('/api/student/security/status');
    expect(res.body).toMatchObject({ mustChangePassword: true, mustChangeEmail: true });
  });

  it('accepts a new password without asking for the admin-set one again', async () => {
    // They typed it moments ago to get in, and the session proves it. Asking
    // again is friction with no security value.
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });

    expect(res.status).toBe(200);
    expect(await bcrypt.compare('MyOwnPass99', mockState.student.password)).toBe(true);
    expect(mockState.student.mustChangePassword).toBe(false);
  });

  it('refuses to keep the password the admin issued', async () => {
    // Otherwise the account ends up exactly where it started.
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ newPassword: 'TempPass2026', confirmPassword: 'TempPass2026' });

    expect(res.status).toBe(400);
    expect(mockState.student.mustChangePassword).toBe(true);
  });

  it('refuses a mismatched confirmation, and says which field', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass98' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('confirmPassword');
  });

  it('refuses one that is too short', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ newPassword: 'short', confirmPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('newPassword');
  });

  it('tells the page the email step is still to come', async () => {
    mockState.student.mustChangeEmail = true;
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });
    expect(res.body.mustChangeEmail).toBe(true);
  });
});

describe('a student changing their password of their own accord', () => {
  it('must prove the current one', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('currentPassword');
  });

  it('is refused when the current one is wrong', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ currentPassword: 'WrongPass1', newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('currentPassword');
  });

  it('goes through with the right one', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/password')
      .send({ currentPassword: 'OriginalPass1', newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });
    expect(res.status).toBe(200);
    expect(await bcrypt.compare('MyOwnPass99', mockState.student.password)).toBe(true);
  });
});

describe('the student then confirms their email', () => {
  beforeEach(() => {
    mockState.student.mustChangeEmail = true;
    mockState.student.email = 'admin.guessed@example.com';
    mockState.student.previousEmail = 'anmol@example.com';
  });

  it('accepts the address as it stands', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/email').send({ keepCurrent: true });
    expect(res.status).toBe(200);
    expect(mockState.student.email).toBe('admin.guessed@example.com');
    expect(mockState.student.mustChangeEmail).toBe(false);
  });

  it('replaces it when the admin guessed wrong', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/email').send({ newEmail: 'Real.Address@Example.com' });
    expect(res.status).toBe(200);
    expect(mockState.student.email).toBe('real.address@example.com');
    expect(mockState.student.previousEmail).toBe('admin.guessed@example.com');
    expect(mockState.student.mustChangeEmail).toBe(false);
  });

  it('refuses an address another student already uses', async () => {
    mockState.others = [{ employeeId: 'TEN/WEB/1005', email: 'taken@example.com' }];
    const res = await request(studentApp())
      .post('/api/student/security/email').send({ newEmail: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(mockState.student.mustChangeEmail).toBe(true);
  });

  it('refuses something that is not an email address', async () => {
    const res = await request(studentApp())
      .post('/api/student/security/email').send({ newEmail: 'nope' });
    expect(res.status).toBe(400);
    expect(mockState.student.mustChangeEmail).toBe(true);
  });

  it('keeps the session in step, so the page does not show the old address', async () => {
    const session = { student: { _id: 'stud1', employeeId: 'TEN/AI/1663', email: 'admin.guessed@example.com' } };
    await request(studentApp(session))
      .post('/api/student/security/email').send({ newEmail: 'real.address@example.com' });
    expect(session.student.email).toBe('real.address@example.com');
  });
});

describe('identity comes from the session, never from the caller', () => {
  it('turns away a request with no session', async () => {
    const res = await request(studentApp({}))
      .post('/api/student/security/password')
      .send({ newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });
    expect(res.status).toBe(401);
  });

  it('ignores an employee ID in the body', async () => {
    // Naming somebody else must change the caller's own account, not theirs.
    mockState.student.mustChangePassword = true;
    await request(studentApp())
      .post('/api/student/security/password')
      .send({ employeeId: 'TEN/WEB/9999', newPassword: 'MyOwnPass99', confirmPassword: 'MyOwnPass99' });
    expect(mockState.student.mustChangePassword).toBe(false);
  });
});
