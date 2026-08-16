'use strict';

const Student = require('../../models/Student');
const Attendance = require('../../models/Attendance');

describe('Attendance Dashboard Google Form Integration', () => {
  it('should create attendance model record with self markedBy', () => {
    const att = new Attendance({
      studentId: '60c72b2f9b1e8a0015f8e123',
      employeeId: 'TEN-STU-000001',
      domain: 'Web Development',
      date: new Date(),
      dateKey: '2026-07-29',
      status: 'Present',
      markedBy: 'self'
    });

    expect(att.markedBy).toBe('self');
    expect(att.status).toBe('Present');
    expect(att.employeeId).toBe('TEN-STU-000001');
  });
});
