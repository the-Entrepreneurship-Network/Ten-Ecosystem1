'use strict';

const EcosystemUser = require('../../models/EcosystemUser');
const Student = require('../../models/Student');

describe('Single Active Session Validation', () => {
  it('should allow setting activeSessionToken on EcosystemUser', () => {
    const user = new EcosystemUser({
      role: 'student',
      fullName: 'Session Test User',
      email: 'session.test@example.com',
      password: 'hashedpassword',
      activeSessionToken: 'ten_sess_123456789'
    });

    expect(user.activeSessionToken).toBe('ten_sess_123456789');
  });

  it('should allow setting activeSessionToken on Student schema', () => {
    const student = new Student({
      firstName: 'Session',
      lastName: 'Student',
      email: 'student.session@example.com',
      activeSessionToken: 'ten_sess_987654321'
    });

    expect(student.activeSessionToken).toBe('ten_sess_987654321');
  });
});
