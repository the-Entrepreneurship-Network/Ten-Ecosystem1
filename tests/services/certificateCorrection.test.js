'use strict';

/**
 * @jest-environment node
 *
 * Correcting a certificate that has already been issued.
 *
 * The scenario this exists for: a certificate is generated and emailed, the
 * student reads it and says the name or the dates are wrong, and HR fixes it.
 *
 * Two rules. The printed name may be corrected without rewriting the student's
 * account — the account name is what they sign in with and are matched by, and
 * a typo on a PDF is not a reason to touch it. And a document already in a
 * student's hands may be corrected once: a reissue replaces the copy they were
 * sent and the copy a verifier may have seen, so a document that can be
 * rewritten without limit is not evidence of anything.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const certsSrc = fs.readFileSync(path.join(root, 'routes/v2/certificates.js'), 'utf8');
const cd = require('../../services/certificateDates');

/**
 * The /hr-issue handler, bounded by the next top-level router call rather than
 * a guessed character count. A fixed window silently cut the handler in half
 * and let an assertion pass for the wrong reason.
 */
function hrIssueRoute() {
    const at = certsSrc.indexOf('router.post("/hr-issue"');
    expect(at).toBeGreaterThan(-1);
    const rest = certsSrc.slice(at + 20);
    const next = rest.search(/\nrouter\.(get|post|put|patch|delete)\(/);
    return next === -1 ? certsSrc.slice(at) : certsSrc.slice(at, at + 20 + next);
}

/** A student carrying an override row for one certificate type. */
const withRow = (type, row, extra = {}) => ({
    name: 'Asha Verma',
    employeeId: 'TEN/WEB/1234',
    certificateDates: { [type]: row },
    ...extra
});

describe('the printed name', () => {
    it('falls back to the account name when nothing was corrected', () => {
        expect(cd.nameFor({ name: 'Asha Verma' }, 'LOC')).toBe('Asha Verma');
        expect(cd.nameFor({ fullName: 'Asha Verma' }, 'LOC')).toBe('Asha Verma');
        expect(cd.nameFor(null, 'LOC')).toBe('');
    });

    it('is the correction once one is stored', () => {
        const s = withRow('LOC', { name: 'Aasha Verma' });
        expect(cd.nameFor(s, 'LOC')).toBe('Aasha Verma');
        // Per type: correcting the LoC must not silently rewrite the LoR.
        expect(cd.nameFor(s, 'LOR')).toBe('Asha Verma');
    });

    it('the PDF reads the correction, not the account', () => {
        // The bug this repeats: buildCertPDF used to read student.name
        // directly, so a corrected name never reached the document.
        const at = certsSrc.indexOf('const mapData = {');
        const block = certsSrc.slice(at, at + 400);
        expect(block).toMatch(/studentName:\s*certDates\.nameFor\(student, certType\)/);
        expect(block).not.toMatch(/studentName:\s*student\.name/);
    });
});

describe('what a name may be', () => {
    it('empty means leave it alone, not clear it', () => {
        // A date-only correction sends no name. That must not blank the one
        // already stored, or the next reissue prints "Student Name".
        for (const v of [undefined, null, '', '   ']) {
            expect(cd.validateName(v)).toEqual({ ok: true, name: null });
        }
    });

    it('trims and collapses whitespace', () => {
        expect(cd.validateName('  Asha   Verma  ')).toEqual({ ok: true, name: 'Asha Verma' });
    });

    it('refuses what a certificate cannot carry', () => {
        expect(cd.validateName('A').ok).toBe(false);
        expect(cd.validateName('x'.repeat(101)).ok).toBe(false);
        expect(cd.validateName('<script>').ok).toBe(false);
    });

    it('accepts the names Indian students actually have', () => {
        // A stricter pattern rejects real people. These must all pass.
        for (const n of ['R. Nair', "S'ouza", 'Jean-Paul Rao', 'Sri Indu Devi', 'M K Gupta']) {
            expect(cd.validateName(n).ok).toBe(true);
        }
    });
});

describe('a document is corrected once', () => {
    it('an untouched document is not locked', () => {
        expect(cd.correctionLocked({}, 'LOC')).toBe(false);
        expect(cd.correctionLocked(withRow('LOC', { start: new Date() }), 'LOC')).toBe(false);
    });

    it('a corrected one is', () => {
        expect(cd.correctionLocked(withRow('LOC', { corrected: true }), 'LOC')).toBe(true);
        // Per type again.
        expect(cd.correctionLocked(withRow('LOC', { corrected: true }), 'LOR')).toBe(false);
    });

    it('the route refuses the second correction, and says who made the first', () => {
        const route = hrIssueRoute();
        expect(route).toMatch(/certDates\.correctionLocked\(student, type\)/);
        expect(route).toMatch(/alreadyCorrected:\s*true/);
        expect(route).toMatch(/status\(409\)/);
        // Named, so the next person knows who to ask rather than re-editing.
        expect(route).toMatch(/prev\.setBy/);
    });

    it('the lock only applies once the document exists', () => {
        // Overrides on an unissued document are HR filling in what the record
        // could not derive. Locking those would mean a document could be
        // issued wrong and never put right.
        const route = hrIssueRoute();
        expect(route).toMatch(/alreadyIssued\s*&&\s*certDates\.correctionLocked/);
        expect(route).toMatch(/corrected:\s*alreadyIssued\s*\?\s*true/);
    });

    it('it is enforced on the server, not only in the page', () => {
        // A stale tab or a direct POST walks past a hidden button.
        const route = hrIssueRoute();
        const guardAt = route.indexOf('correctionLocked');
        const generateAt = route.indexOf('generateAndSaveCert');
        expect(guardAt).toBeGreaterThan(-1);
        expect(generateAt).toBeGreaterThan(guardAt);   // refused before anything is written
    });
});

describe('a name-only correction is allowed through', () => {
    it('the route does not demand a date when only the name changed', () => {
        // validateOverride answers "Nothing to change" when both dates are
        // absent, which is right for a date edit and wrong for a name edit.
        const route = hrIssueRoute();
        expect(route).toMatch(/if \(startDate \|\| endDate \|\| studentName\)/);
        expect(route).toMatch(/\(startDate \|\| endDate\) && !check\.ok/);
    });

    it('validateOverride still refuses an empty date edit on its own', () => {
        expect(cd.validateOverride({}, { name: 'A' }, 'LOC')).toMatchObject({ ok: false });
    });
});

describe('the change leaves a trace', () => {
    it('the audit note names what was altered', () => {
        const route = hrIssueRoute();
        expect(route).toMatch(/name printed as/);
        expect(route).toMatch(/Correction to an already-issued document/);
    });

    it('the stored row keeps who and when', () => {
        const row = cd.overrideFor(withRow('LOC', {
            name: 'Asha Verma', corrected: true, setBy: 'K Gupta', setByLevel: 7, at: new Date('2026-11-18')
        }), 'LOC');
        expect(row.name).toBe('Asha Verma');
        expect(row.corrected).toBe(true);
        expect(row.setBy).toBe('K Gupta');
        expect(row.setByLevel).toBe(7);
        expect(row.at).toBeInstanceOf(Date);
    });
});

describe('the HR form offers the name, and shuts when the correction is spent', () => {
  /**
   * `_diDates` builds the editable panel. It is pulled out of the page and run
   * here rather than asserted on as text: whether the field is disabled, and
   * whether a typed name is escaped into a value attribute, are things a regex
   * over the source cannot actually answer.
   */
  const page = fs.readFileSync(path.join(root, 'public/hr-portal.html'), 'utf8');

  function diDates() {
    const start = page.indexOf('function _diDates(dates){');
    const end = page.indexOf('\nasync function directIssueCheck()');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const src = `
      function _diEsc(s){ return String(s==null?'':s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
      ${page.slice(start, end)}
      return _diDates;`;
    // eslint-disable-next-line no-new-func
    return new Function(src)();
  }

  const FRESH = {
    start: '2026-01-10', end: '2026-02-24', source: { start: 'joining', end: 'derived' },
    overriddenBy: '', printedName: 'Asha Verma', nameOverridden: false,
    corrected: false, editable: true, minLevel: 3
  };
  const LOCKED = {
    ...FRESH, printedName: 'Aasha Verma', nameOverridden: true,
    corrected: true, editable: false, overriddenBy: 'K Gupta'
  };

  it('shows a name field prefilled with what will print', () => {
    const html = diDates()(FRESH);
    expect(html).toContain('id="directStudentName"');
    expect(html).toContain('value="Asha Verma"');
    expect(html).toContain('from the student record');
    // The dates must survive the addition.
    expect(html).toContain('directStartDate');
    expect(html).toContain('directEndDate');
  });

  it('the field is open while a correction is still available', () => {
    const html = diDates()(FRESH);
    expect(/id="directStudentName"[^>]*disabled/.test(html)).toBe(false);
    expect(html).not.toContain('already been corrected once');
  });

  it('once corrected, it shows the override, locks, and says why', () => {
    const html = diDates()(LOCKED);
    expect(html).toContain('value="Aasha Verma"');
    expect(html).toContain('corrected by hand');
    expect(/id="directStudentName"[^>]*disabled/.test(html)).toBe(true);
    expect(html).toContain('already been corrected once');
  });

  it('a typed name is escaped into the value attribute', () => {
    // HR types this. Unescaped, a quote closes the attribute.
    const html = diDates()({ ...FRESH, printedName: 'A" onfocus="alert(1)' });
    expect(html).not.toContain('onfocus="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('the name is only sent when it was actually changed', () => {
    // Echoing the record's own value back would freeze it as a hand-set
    // correction on a document nobody meant to touch — and spend the one
    // correction that document is allowed.
    expect(page).toMatch(/nEl\.value\.trim\(\) !== nEl\.defaultValue\.trim\(\)/);
  });

  it('the precheck tells the form what will print and whether it is spent', () => {
    expect(certsSrc).toMatch(/printedName:\s*certDates\.nameFor\(student, type\)/);
    expect(certsSrc).toMatch(/corrected:\s*!!\(issued && corrected\)/);
    expect(certsSrc).toMatch(/editable:\s*certDates\.mayEditDates\(req\.session\) && !\(issued && corrected\)/);
  });
});
