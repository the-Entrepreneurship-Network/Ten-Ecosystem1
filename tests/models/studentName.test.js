'use strict';

/**
 * The admin console printed `undefined` in the Name column for a number of
 * students, and its Edit form was pre-filled from what the table had rendered —
 * so opening a broken row and pressing Save wrote the word "undefined" into the
 * database as the student's real name. That is why it spread.
 *
 * These pin the three places it is now stopped: the model on write, the console
 * on read, and the admin list query so a nameless record is still findable.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const root = path.join(__dirname, '../..');
const Student = require(path.join(root, 'models/Student'));
const { deriveStudentName, isUsableName, applyNameToDoc, applyNameToUpdate } = Student;

describe('what counts as a name', () => {
  it('rejects the values that look like one but are not', () => {
    ['undefined', 'null', 'NaN', '-', '—', '', '   '].forEach((v) => {
      expect(isUsableName(v)).toBe(false);
    });
  });

  it('rejects them whatever the case', () => {
    // The literal written back by the Edit form was lowercase "undefined",
    // but "Undefined" would read just as broken.
    ['Undefined', 'NULL', 'Null'].forEach((v) => expect(isUsableName(v)).toBe(false));
  });

  it('accepts a real name, including a short one', () => {
    ['Kanishka Sharma', 'Ana', "O'Brien", 'Ravi'].forEach((v) => {
      expect(isUsableName(v)).toBe(true);
    });
  });

  it('rejects a non-string', () => {
    [undefined, null, 42, {}, []].forEach((v) => expect(isUsableName(v)).toBe(false));
  });
});

describe('deriving a name', () => {
  it('keeps a usable name as it is', () => {
    expect(deriveStudentName({ name: 'Kanishka Sharma' })).toBe('Kanishka Sharma');
  });

  it('falls back to firstName and lastName', () => {
    expect(deriveStudentName({ name: 'undefined', firstName: 'Kanishka', lastName: 'Sharma' }))
      .toBe('Kanishka Sharma');
    expect(deriveStudentName({ firstName: 'Kanishka' })).toBe('Kanishka');
  });

  it('skips a junk firstName rather than joining it in', () => {
    expect(deriveStudentName({ firstName: 'undefined', lastName: 'Sharma' })).toBe('Sharma');
  });

  it('falls back to the email local part, tidied', () => {
    expect(deriveStudentName({ email: 'kanishka.sharma05@gmail.com' })).toBe('Kanishka Sharma05');
    expect(deriveStudentName({ email: 'ravi_kumar@x.com' })).toBe('Ravi Kumar');
  });

  it('returns empty when there is genuinely nothing', () => {
    expect(deriveStudentName({})).toBe('');
    expect(deriveStudentName({ name: 'undefined', email: 'not-an-email' })).toBe('');
  });

  it('trims', () => {
    expect(deriveStudentName({ name: '  Kanishka Sharma  ' })).toBe('Kanishka Sharma');
  });
});

describe('the model refuses to store a broken name', () => {
  const runPreSave = (doc) => applyNameToDoc(doc);

  it('fills in a missing name on save', () => {
    const doc = runPreSave({ firstName: 'Kanishka', lastName: 'Sharma', email: 'k@x.com' });
    expect(doc.name).toBe('Kanishka Sharma');
  });

  it('replaces the literal "undefined" on save', () => {
    const doc = runPreSave({ name: 'undefined', firstName: 'Kanishka', lastName: 'Sharma' });
    expect(doc.name).toBe('Kanishka Sharma');
  });

  it('leaves a good name alone', () => {
    const doc = runPreSave({ name: 'Kanishka Sharma', firstName: 'Someone', lastName: 'Else' });
    expect(doc.name).toBe('Kanishka Sharma');
  });

  const runPreUpdate = (update) => applyNameToUpdate(update);

  it('drops an attempt to write "undefined" as the name', () => {
    // This is the exact write the Edit form used to make.
    const u = runPreUpdate({ $set: { name: 'undefined', email: 'k@x.com' } });
    expect(u.$set.name).toBeUndefined();
    expect(u.$set.email).toBe('k@x.com');
  });

  it('drops a blank name too, rather than wiping a good one', () => {
    const u = runPreUpdate({ $set: { name: '   ' } });
    expect(u.$set.name).toBeUndefined();
  });

  it('keeps name in step when only firstName/lastName are updated', () => {
    const u = runPreUpdate({ $set: { firstName: 'Kanishka', lastName: 'Sharma' } });
    expect(u.$set.name).toBe('Kanishka Sharma');
  });

  it('does not overwrite a name the caller supplied deliberately', () => {
    const u = runPreUpdate({ $set: { name: 'Preferred Name', firstName: 'Kanishka' } });
    expect(u.$set.name).toBe('Preferred Name');
  });

  it('handles an update with no $set wrapper', () => {
    const u = runPreUpdate({ name: 'undefined' });
    expect(u.name).toBeUndefined();
  });

  it('leaves an unrelated update untouched', () => {
    const u = runPreUpdate({ $set: { lastActiveDate: 'today' } });
    expect(u.$set).toEqual({ lastActiveDate: 'today' });
  });

  it('registers on every update method, not just findOneAndUpdate', () => {
    ['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((op) => {
      expect((Student.schema.s.hooks._pres.get(op) || []).length).toBeGreaterThan(0);
    });
  });
});

describe('the admin console', () => {
  const adminPage = fs.readFileSync(path.join(root, 'public/ten-admin.html'), 'utf8');
  const adminRoutes = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');

  it('never interpolates a raw name into the row', () => {
    expect(adminPage).not.toContain('<td>${s.name}</td>');
    expect(adminPage).toContain('_studentName(s)');
  });

  it('says the name is missing instead of printing "undefined"', () => {
    expect(adminPage).toMatch(/— missing —/);
  });

  it('passes onclick arguments as escaped JSON, not bare interpolation', () => {
    // "O'Brien" used to break the handler outright.
    expect(adminPage).toMatch(/function _arg\(v\)\{ return _aEsc\(JSON\.stringify\(/);
    expect(adminPage).not.toContain("editStudent('${s._id}','${s.name}'");
    expect(adminPage).not.toContain("resetStudentPw('${s._id}','${s.name}'");
  });

  it('serves firstName and lastName so the console can fall back to them', () => {
    const at = adminRoutes.indexOf("router.get('/students'");
    const block = adminRoutes.slice(at, at + 1600);
    expect(block).toMatch(/\.select\('name firstName lastName employeeId/);
  });

  it('finds a nameless student by their first or last name', () => {
    const at = adminRoutes.indexOf("router.get('/students'");
    const block = adminRoutes.slice(at, at + 1600);
    expect(block).toContain('{ firstName: { $regex: search, $options: \'i\' } }');
    expect(block).toContain('{ lastName: { $regex: search, $options: \'i\' } }');
  });

  it('still lets an admin set the name by hand', () => {
    expect(adminRoutes).toMatch(/ADMIN_EDITABLE_FIELDS = \[\s*'name'/);
  });
});

describe('the backfill script', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/backfill-student-names.js'), 'utf8');

  it('is a dry run unless --apply is passed', () => {
    expect(script).toContain("const APPLY = process.argv.includes('--apply')");
    expect(script).toMatch(/if \(!APPLY\) \{[\s\S]*?Dry run/);
  });

  it('reuses the model\'s own resolver rather than a second copy of the rules', () => {
    expect(script).toContain("require('../models/Student')");
    expect(script).toContain('deriveStudentName');
  });

  it('refuses to write a name that is not usable', () => {
    expect(script).toContain('writes.filter(w => isUsableName(w.updateOne.update.$set.name))');
  });

  it('reports what it could not resolve rather than inventing something', () => {
    expect(script).toContain('UNRESOLVED');
  });
});

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
});
