'use strict';

/**
 * Attendance has to be counted per domain.
 *
 * A student may hold two domains, and the two are separate internships: they
 * mark each one, and each one has its own percentage. The rules that make that
 * true live in utils/attendanceDomain.js, and the two failure modes they exist
 * to prevent are both asserted here —
 *
 *   - a second domain that cannot be marked because the first one was, and
 *   - a history that silently stops counting because the rows carry no domain.
 */

const {
  domainKey,
  studentDomains,
  primaryDomain,
  hasMultipleDomains,
  resolveActiveDomain,
  recordMatchesDomain,
  filterByDomain,
  domainForWrite
} = require('../../utils/attendanceDomain');

const single = { employeeId: 'TEN/WEB/1005', domain: 'Web Development' };

// The shape the live registration form produces: ONE record, ONE employeeId,
// two domains. This is the student who could not mark twice.
const dualOneRecord = {
  employeeId: 'TEN/WEB/1006',
  domain: 'Web Development',
  domains: ['Web Development', 'Data Science']
};

// The shape POST /register produces: two records linked to each other.
const dualLinked = {
  employeeId: 'TEN/WEB/1007',
  domain: 'Web Development',
  linkedDomains: [
    { domain: 'Web Development', employeeId: 'TEN/WEB/1007' },
    { domain: 'Cyber Security',  employeeId: 'TEN/CYBER/1008' }
  ]
};

const row = (domain, extra) => Object.assign({ status: 'Present', markedBy: 'self' }, extra, { domain });

describe('domainKey', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(domainKey('  web development ')).toBe(domainKey('Web Development'));
  });

  it('collapses a known alias onto its canonical name', () => {
    expect(domainKey('WEB DEVELOPMENT')).toBe('web development');
  });

  it('treats an absent value as "no domain recorded"', () => {
    expect(domainKey('')).toBe('');
    expect(domainKey(null)).toBe('');
    expect(domainKey(undefined)).toBe('');
  });
});

describe('studentDomains', () => {
  it('reads the single-domain shape', () => {
    expect(studentDomains(single)).toEqual(['Web Development']);
  });

  it('reads the one-record two-domain shape', () => {
    expect(studentDomains(dualOneRecord)).toEqual(['Web Development', 'Data Science']);
  });

  it('reads the linked two-record shape', () => {
    expect(studentDomains(dualLinked)).toEqual(['Web Development', 'Cyber Security']);
  });

  it('does not repeat the primary domain when it also appears in the list', () => {
    expect(studentDomains(dualOneRecord).filter(d => d === 'Web Development')).toHaveLength(1);
  });

  it('survives a student with nothing on record', () => {
    expect(studentDomains(null)).toEqual([]);
    expect(studentDomains({})).toEqual([]);
  });
});

describe('resolveActiveDomain', () => {
  it('honours a domain the student is actually enrolled in', () => {
    expect(resolveActiveDomain(dualOneRecord, 'Data Science')).toBe('Data Science');
  });

  it('matches case-insensitively', () => {
    expect(resolveActiveDomain(dualOneRecord, 'data science')).toBe('Data Science');
  });

  it('refuses a domain the student does not hold', () => {
    // Otherwise a caller could scope someone else's domain onto this student
    // and read an empty history as though they had never attended.
    expect(resolveActiveDomain(dualOneRecord, 'Finance')).toBe('Web Development');
  });

  it('falls back to the primary domain when none is asked for', () => {
    expect(resolveActiveDomain(dualOneRecord, undefined)).toBe('Web Development');
  });
});

describe('a student with two domains marks each one separately', () => {
  it('writes the requested domain, not the primary', () => {
    expect(domainForWrite(dualOneRecord, 'Data Science')).toBe('Data Science');
  });

  it('gives the two domains different write keys, so the unique index lets both through', () => {
    // {employeeId, dateKey, markedBy, domain} — the domain is what separates
    // them. With the old three-key index these two marks collided and the
    // second domain could never be marked.
    const a = domainForWrite(dualOneRecord, 'Web Development');
    const b = domainForWrite(dualOneRecord, 'Data Science');
    expect(a).not.toBe(b);
  });

  it('counts only the rows for the domain being viewed', () => {
    const records = [
      row('Web Development', { dateKey: '2026-08-10' }),
      row('Web Development', { dateKey: '2026-08-11' }),
      row('Data Science',    { dateKey: '2026-08-11' })
    ];
    expect(filterByDomain(records, 'Web Development', dualOneRecord)).toHaveLength(2);
    expect(filterByDomain(records, 'Data Science', dualOneRecord)).toHaveLength(1);
  });

  it('does the same for the linked two-record shape', () => {
    const records = [row('Web Development'), row('Cyber Security'), row('Cyber Security')];
    expect(filterByDomain(records, 'Cyber Security', dualLinked)).toHaveLength(2);
  });
});

describe('rows written before Attendance.domain was populated still count', () => {
  // Attendance.domain defaults to "". Filtering with an anchored regex in Mongo
  // dropped every one of those rows, which is why a student's own history
  // stopped counting.
  const legacy = [row(''), row(undefined), row('Web Development')];

  it('attributes a blank row to the primary domain', () => {
    expect(filterByDomain(legacy, 'Web Development', dualOneRecord)).toHaveLength(3);
  });

  it('does not lend those rows to the second domain', () => {
    expect(filterByDomain(legacy, 'Data Science', dualOneRecord)).toHaveLength(0);
  });

  it('keeps every row for a single-domain student, whatever the label says', () => {
    // A single-domain student has no second bucket for a row to belong to.
    // Rejecting one because its stored label drifted would erase real
    // attendance, which is the bug, not the fix.
    const mixed = [row(''), row('web development'), row('Something Else')];
    expect(filterByDomain(mixed, 'Web Development', single)).toHaveLength(3);
  });
});

describe('recordMatchesDomain', () => {
  it('is true for a single-domain student regardless of the row', () => {
    expect(recordMatchesDomain(row('Anything'), 'Web Development', single)).toBe(true);
  });

  it('is false for the wrong domain of a dual-domain student', () => {
    expect(recordMatchesDomain(row('Data Science'), 'Web Development', dualOneRecord)).toBe(false);
  });

  it('is false for a missing record', () => {
    expect(recordMatchesDomain(null, 'Web Development', dualOneRecord)).toBe(false);
  });
});

describe('primaryDomain / hasMultipleDomains', () => {
  it('names the primary domain', () => {
    expect(primaryDomain(dualOneRecord)).toBe('Web Development');
  });

  it('knows when there is only one', () => {
    expect(hasMultipleDomains(single)).toBe(false);
    expect(hasMultipleDomains(dualOneRecord)).toBe(true);
    expect(hasMultipleDomains(dualLinked)).toBe(true);
  });
});
