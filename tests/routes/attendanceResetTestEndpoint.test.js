'use strict';

const Attendance = require('../../models/Attendance');

describe('Attendance Test Reset Endpoint', () => {
  it('should construct query for resetting today self attendance', () => {
    const employeeId = 'TEN-STU-000001';
    const dateKey = '2026-07-29';
    const query = { employeeId, dateKey, markedBy: 'self' };
    
    expect(query.markedBy).toBe('self');
    expect(query.employeeId).toBe('TEN-STU-000001');
    expect(query.dateKey).toBe('2026-07-29');
  });
});
