'use strict';

const fs = require('fs');
const path = require('path');
const cd = require('../../services/certificateDates');

const root = path.join(__dirname, '../..');
/** Assert against live code, never against a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

describe('which dates a generated document prints', () => {
  /*
   * A WhatsApp joiner's internship starts BEFORE their portal account exists,
   * so joiningDate and internshipStartDate are deliberately different values.
   * The certificate is about the internship.
   */
  it('prints the internship start, not the day the portal account was made', () => {
    const student = { joiningDate: '2026-03-01', internshipStartDate: '2026-02-01' };
    expect(iso(cd.datesFor(student, 'LOC').start)).toBe('2026-02-01');
  });

  it('falls back to the joining date only when there is no internship start', () => {
    expect(iso(cd.datesFor({ joiningDate: '2026-03-01' }, 'LOC').start)).toBe('2026-03-01');
  });

  /*
   * internshipEndDate is null on a great many students, and every PDF template
   * falls back to the literal string "End Date" — so those documents printed
   * the words "End Date" where the date belongs.
   */
  it.each([
    ['1week',   '2026-02-08'],
    ['15days',  '2026-02-16'],
    ['1month',  '2026-03-03'],
    ['45days',  '2026-03-18'],
    ['3months', '2026-05-02'],
    ['6months', '2026-07-31']
  ])('derives the end date for a %s tenure instead of printing "End Date"', (tenure, expected) => {
    const student = { internshipStartDate: '2026-02-01', tenure };
    const d = cd.datesFor(student, 'LOC');
    expect(iso(d.end)).toBe(expected);
    expect(d.source.end).toBe('derived');
  });

  it('reads v2DurationType when that is where the tenure lives', () => {
    const d = cd.datesFor({ internshipStartDate: '2026-02-01', v2DurationType: '1month' }, 'LOC');
    expect(iso(d.end)).toBe('2026-03-03');
  });

  it('uses the stored end date when there is one', () => {
    const student = { internshipStartDate: '2026-02-01', internshipEndDate: '2026-04-15', tenure: '1month' };
    expect(iso(cd.datesFor(student, 'LOC').end)).toBe('2026-04-15');
    expect(cd.datesFor(student, 'LOC').source.end).toBe('stored');
  });

  it('derives nothing from a tenure it does not recognise', () => {
    // Better an empty date than a confidently wrong one on a legal document.
    expect(cd.datesFor({ internshipStartDate: '2026-02-01', tenure: 'forever' }, 'LOC').end).toBeNull();
  });

  it('survives a student with no dates at all', () => {
    const d = cd.datesFor({}, 'LOC');
    expect(d.start).toBeNull();
    expect(d.end).toBeNull();
  });

  it('the templates that print "End Date" are the reason this exists', () => {
    // If a template stops falling back to the literal, this test can go.
    const svc = fs.readFileSync(path.join(root, 'services/v2/locService.js'), 'utf8');
    expect(svc).toContain('data.endDate || "End Date"');
  });
});

describe('an HR date override', () => {
  const student = {
    internshipStartDate: '2026-02-01',
    internshipEndDate: '2026-03-03',
    certificateDates: { LOC: { start: '2026-01-15', end: '2026-04-20', setBy: 'VP HR' } }
  };

  it('wins over the derived dates', () => {
    const d = cd.datesFor(student, 'LOC');
    expect(iso(d.start)).toBe('2026-01-15');
    expect(iso(d.end)).toBe('2026-04-20');
    expect(d.source).toEqual({ start: 'hr', end: 'hr' });
  });

  /*
   * Per document type. A Letter of Completion and an Offer Letter describe
   * different spans; one shared pair would make correcting either one silently
   * rewrite the other.
   */
  it('applies to that one document type and no other', () => {
    expect(iso(cd.datesFor(student, 'OFFER').start)).toBe('2026-02-01');
    expect(iso(cd.datesFor(student, 'OFFER').end)).toBe('2026-03-03');
  });

  it('reads a Mongoose Map as happily as a lean object', () => {
    const asMap = { internshipStartDate: '2026-02-01',
      certificateDates: new Map([['LOC', { start: '2026-01-15', end: null }]]) };
    expect(iso(cd.datesFor(asMap, 'LOC').start)).toBe('2026-01-15');
  });

  it('one date may be corrected while the other stays derived', () => {
    const half = { internshipStartDate: '2026-02-01', internshipEndDate: '2026-03-03',
      certificateDates: { LOR: { start: '2026-01-15', end: null } } };
    const d = cd.datesFor(half, 'LOR');
    expect(iso(d.start)).toBe('2026-01-15');
    expect(iso(d.end)).toBe('2026-03-03');
    expect(d.source).toEqual({ start: 'hr', end: 'stored' });
  });
});

describe('validating what HR typed', () => {
  const student = { internshipStartDate: '2026-02-01', internshipEndDate: '2026-03-03' };

  it('refuses an end before its start', () => {
    const r = cd.validateOverride({ startDate: '2026-05-01', endDate: '2026-04-01' }, student, 'LOC');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/before the start/);
  });

  /*
   * Correcting only the start must be checked against the end that will
   * actually print, not against nothing — otherwise a start pushed past a
   * derived end produces a document that reads backwards.
   */
  it('checks a lone start against the end that will print', () => {
    const r = cd.validateOverride({ startDate: '2026-06-01' }, student, 'LOC');
    expect(r.ok).toBe(false);
  });

  it('accepts a lone start that still precedes the end', () => {
    expect(cd.validateOverride({ startDate: '2026-02-10' }, student, 'LOC').ok).toBe(true);
  });

  it.each([
    ['1926-02-01', 'a year typed a century out'],
    ['2226-02-01', 'a year typed two centuries ahead']
  ])('rejects %s (%s)', (startDate) => {
    expect(cd.validateOverride({ startDate }, student, 'LOC').ok).toBe(false);
  });

  it('rejects text that is not a date', () => {
    expect(cd.validateOverride({ startDate: 'last tuesday' }, student, 'LOC').ok).toBe(false);
  });

  it('rejects an empty change', () => {
    expect(cd.validateOverride({}, student, 'LOC').ok).toBe(false);
  });
});

describe('who may retype a date', () => {
  it.each([
    [{ hr: { level: 3 } }, true,  'level 3'],
    [{ hr: { level: 8 } }, true,  'level 8'],
    [{ hr: { level: 2 } }, false, 'level 2'],
    [{ hr: {} },           false, 'no level at all — defaults to 1'],
    [{ adminUser: { username: 'tenadmin' } }, true, 'admin'],
    [{ coordinator: { username: 'web' } },    false, 'a coordinator'],
    [{},                   false, 'nobody']
  ])('%#: %s', (session, allowed) => {
    expect(cd.mayEditDates(session)).toBe(allowed);
  });

  it('is the level the plan named', () => {
    expect(cd.DATE_EDIT_MIN_LEVEL).toBe(3);
  });
});

describe('the one funnel every document goes through reads it', () => {
  const certs = strip(fs.readFileSync(path.join(root, 'routes/v2/certificates.js'), 'utf8'));

  it('buildCertPDF asks certificateDates, not the dead schema fields', () => {
    expect(certs).toContain('certDates.datesFor(student, certType)');
    // These three are not fields on the Student schema and never were, so
    // every one of them was an always-undefined fallback.
    expect(certs).not.toContain('student.startDate ||');
    expect(certs).not.toContain('student.endDate ||');
    expect(certs).not.toContain('student.completionDate ||');
  });

  it('the override is stored before the PDF is built', () => {
    // A document printing one pair of dates while the record holds another is
    // unverifiable, which is the whole point of storing the document.
    const at = certs.indexOf('certificateDates.${type}');
    const gen = certs.indexOf('generateAndSaveCert(student._id, type, student');
    expect(at).toBeGreaterThan(-1);
    expect(gen).toBeGreaterThan(at);
  });

  it('a level below the bar is refused, not silently ignored', () => {
    expect(certs).toContain('certDates.mayEditDates(req.session)');
    expect(certs).toContain('res.status(403)');
  });

  it('the change lands in the audit trail', () => {
    expect(certs).toContain('dateNote');
  });
});

describe('the HR screen', () => {
  const hr = strip(fs.readFileSync(path.join(root, 'public/hr-portal.html'), 'utf8'));

  it('shows the two dates before the document exists', () => {
    // Both inputs are built by _diDates(), so the ids appear as its arguments.
    expect(hr).toContain("field('directStartDate', 'Start'");
    expect(hr).toContain("field('directEndDate',   'End'");
    expect(hr).toContain('_diDates(d.dates)');
  });

  /*
   * Echoing an unchanged derived date back would freeze it as a hand-set
   * override on a document nobody meant to correct — and from then on the
   * document would stop tracking a corrected internship date.
   */
  it('sends only a date that was actually changed', () => {
    expect(hr).toContain("sEl.value !== sEl.defaultValue");
    expect(hr).toContain("eEl.value !== eEl.defaultValue");
  });
});
