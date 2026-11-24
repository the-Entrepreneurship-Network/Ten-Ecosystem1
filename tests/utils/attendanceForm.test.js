'use strict';

const { attendanceFormLink, FORM } = require('../../utils/attendanceForm');

const student = { name: 'Aarav Sharma', email: 'aarav@example.com', employeeId: 'TEN/WEB/1001', domain: 'Web Development', collegeName: 'Sample College' };

test('until the field ids are known, the form opens blank', () => {
  expect(attendanceFormLink(student, '2026-11-24')).toBe(FORM);
});

test('known fields are filled in, as a Google pre-filled link', () => {
  const link = attendanceFormLink(student, '2026-11-24', { name: 'entry.1', employeeId: 'entry.2', domain: 'entry.3', date: 'entry.4' });
  expect(link).toBe(`${FORM}?usp=pp_url&entry.1=Aarav%20Sharma&entry.2=TEN%2FWEB%2F1001&entry.3=Web%20Development&entry.4=2026-11-24`);
});

test('a detail the portal does not have is left for the student', () => {
  const link = attendanceFormLink({ employeeId: 'TEN/WEB/1001' }, '2026-11-24', { email: 'entry.9', employeeId: 'entry.2' });
  expect(link).toBe(`${FORM}?usp=pp_url&entry.2=TEN%2FWEB%2F1001`);
});

test('the name falls back to first and last name', () => {
  const link = attendanceFormLink({ firstName: 'Aarav', lastName: 'Sharma' }, '', { name: 'entry.1' });
  expect(link).toBe(`${FORM}?usp=pp_url&entry.1=Aarav%20Sharma`);
});
