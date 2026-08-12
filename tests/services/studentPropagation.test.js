'use strict';

/**
 * The bug these tests pin:
 *
 * HR extended a student from 1 Month to 3 Months. The record changed; the Task
 * Journey did not. Task rows are assigned once at enrolment and were never
 * revisited, and PUT /students/:id wrote `tenure` alone — not the
 * `v2DurationType` the journey actually reads, and not the task rows.
 *
 * normalizeCorePatch is the pure half of that fix and is tested directly here.
 * propagateStudentChange's side effects (task resync, notification) need Mongo,
 * so what is asserted below is the part that must hold with or without a
 * database: the derived fields, and the refusal of values that would put a
 * student on a plan no lookup table recognises.
 */

// The resync itself talks to Mongo. Stub it so these tests assert the
// contract — "a tenure or domain change reaches the Task Journey" — rather
// than the database.
jest.mock('../../services/v2/taskEngine', () => ({
  resyncTasksForStudent: jest.fn().mockResolvedValue({ added: 8, removed: 0, preserved: 0, inScope: 12 })
}));

const taskEngine = require('../../services/v2/taskEngine');

const {
  normalizeCorePatch,
  propagateStudentChange,
  COUPLED_FIELDS
} = require('../../services/studentPropagation');

const { TENURE_DAYS } = require('../../utils/tenure');

beforeEach(() => {
  taskEngine.resyncTasksForStudent.mockClear();
  taskEngine.resyncTasksForStudent.mockResolvedValue({ added: 8, removed: 0, preserved: 0, inScope: 12 });
});

describe('services/studentPropagation', () => {
  describe('normalizeCorePatch — tenure', () => {
    // The exact strings HR could previously type into a free-text box.
    it.each([
      ['3 Months', '3 Months', '3months'],
      ['3 months', '3 Months', '3months'],
      ['3months',  '3 Months', '3months'],
      ['45 Days',  '45 Days',  '45days'],
      ['1 Week',   '1 Week',   '1week'],
      ['6 Months', '6 Months', '6months']
    ])('canonicalises %p to label %p and durationType %p', (input, label, durationType) => {
      const { patch, error } = normalizeCorePatch({ tenure: input }, {});
      expect(error).toBeNull();
      expect(patch.tenure).toBe(label);
      expect(patch.v2DurationType).toBe(durationType);
    });

    it('always writes v2DurationType alongside tenure', () => {
      // This is the whole bug in one assertion: the Task Journey reads
      // v2DurationType, so a patch that sets tenure without it leaves the
      // journey on the old plan.
      const { patch } = normalizeCorePatch({ tenure: '3 Months' }, { tenure: '1 Month' });
      expect(patch).toHaveProperty('v2DurationType');
      expect(TENURE_DAYS[patch.v2DurationType]).toBeGreaterThan(0);
    });

    it('rejects a tenure no lookup table recognises', () => {
      const { patch, error } = normalizeCorePatch({ tenure: '2 Months' }, {});
      expect(patch).toBeNull();
      expect(error).toMatch(/Unknown tenure/);
    });

    it('leaves v2DurationType alone when tenure is not part of the patch', () => {
      const { patch } = normalizeCorePatch({ email: 'a@b.com' }, { tenure: '1 Month' });
      expect(patch).not.toHaveProperty('v2DurationType');
    });
  });

  describe('normalizeCorePatch — domain', () => {
    it('canonicalises a known domain', () => {
      const { patch, error } = normalizeCorePatch({ domain: 'web development' }, {});
      expect(error).toBeNull();
      expect(patch.domain).toBe('Web Development');
    });

    it('rejects a domain outside the enum rather than storing it', () => {
      // Storing an unrecognised domain silently detaches the student from the
      // DomainTask catalogue — they get an empty Task Journey and no error.
      const { patch, error } = normalizeCorePatch({ domain: 'Underwater Basket Weaving' }, {});
      expect(patch).toBeNull();
      expect(error).toMatch(/Unknown domain/);
    });
  });

  describe('normalizeCorePatch — internshipEndDate', () => {
    const start = new Date('2026-01-01T00:00:00Z');

    it('recomputes the end date when the tenure changes', () => {
      const { patch } = normalizeCorePatch({ tenure: '3 Months' }, { joiningDate: start });
      expect(patch.internshipEndDate).toBeInstanceOf(Date);
      expect(patch.internshipEndDate.getTime()).toBeGreaterThan(start.getTime());
    });

    it('recomputes the end date when only the start date moves', () => {
      const { patch } = normalizeCorePatch(
        { internshipStartDate: start },
        { tenure: '1 Month' }
      );
      expect(patch.internshipEndDate).toBeInstanceOf(Date);
    });

    it('a longer tenure produces a later end date than a shorter one', () => {
      const short = normalizeCorePatch({ tenure: '1 Month' },  { joiningDate: start }).patch;
      const long  = normalizeCorePatch({ tenure: '6 Months' }, { joiningDate: start }).patch;
      expect(long.internshipEndDate.getTime()).toBeGreaterThan(short.internshipEndDate.getTime());
    });

    it('does not invent an end date when there is no start date to work from', () => {
      const { patch } = normalizeCorePatch({ tenure: '1 Month' }, {});
      expect(patch.internshipEndDate).toBeUndefined();
    });
  });

  describe('propagateStudentChange', () => {
    it('does nothing when no coupled field changed', async () => {
      const student = { _id: 'x', employeeId: 'TEN/WEB/1', tenure: '1 Month', domain: 'Web Development' };
      const report = await propagateStudentChange({
        student,
        before: { tenure: '1 Month', domain: 'Web Development' },
        notify: false
      });
      expect(report.changed).toEqual([]);
      expect(report.tasks).toBeNull();
    });

    it('resyncs the Task Journey when the tenure changes — the reported bug', async () => {
      const student = { _id: 'x', employeeId: 'TEN/WEB/1', tenure: '3 Months', domain: 'Web Development' };
      const report = await propagateStudentChange({
        student,
        before: { tenure: '1 Month', domain: 'Web Development' },
        notify: false
      });
      expect(report.changed).toContain('tenure');
      expect(taskEngine.resyncTasksForStudent).toHaveBeenCalledWith(student);
      expect(report.tasks.added).toBe(8);
    });

    it('resyncs the Task Journey when the domain changes', async () => {
      const student = { _id: 'x', employeeId: 'TEN/WEB/1', tenure: '1 Month', domain: 'Data Science' };
      const report = await propagateStudentChange({
        student,
        before: { tenure: '1 Month', domain: 'Web Development' },
        notify: false
      });
      expect(report.changed).toContain('domain');
      expect(taskEngine.resyncTasksForStudent).toHaveBeenCalledWith(student);
    });

    it('does not touch the Task Journey for an unrelated field', async () => {
      const student = { _id: 'x', employeeId: 'TEN/WEB/1', tenure: '1 Month', domain: 'Web Development' };
      await propagateStudentChange({
        student,
        before: { tenure: '1 Month', domain: 'Web Development' },
        notify: false
      });
      expect(taskEngine.resyncTasksForStudent).not.toHaveBeenCalled();
    });

    it('flags an already-issued offer letter as stale when the tenure moves', async () => {
      const student = {
        _id: 'x', employeeId: 'TEN/WEB/1', tenure: '3 Months', domain: 'Web Development',
        offerLetterStatus: 'issued'
      };
      const report = await propagateStudentChange({
        student,
        before: { tenure: '1 Month' },
        notify: false
      });
      expect(report.offerLetterStale).toBe(true);
    });

    it('treats an unchanged date as unchanged even across Date/string forms', async () => {
      const iso = '2026-01-01T00:00:00.000Z';
      const student = { _id: 'x', employeeId: 'TEN/WEB/1', joiningDate: new Date(iso) };
      const report = await propagateStudentChange({
        student,
        before: { joiningDate: iso },
        notify: false
      });
      expect(report.changed).not.toContain('joiningDate');
    });

    it('never throws out of a failed resync', async () => {
      // The caller's save has already succeeded by this point. A resync that
      // blows up must be reported, not turned into a 500 on a write that
      // actually worked.
      taskEngine.resyncTasksForStudent.mockRejectedValueOnce(new Error('db down'));
      const report = await propagateStudentChange({
        student: { _id: 'x', employeeId: 'TEN/WEB/1', tenure: '3 Months', domain: 'Web Development' },
        before: { tenure: '1 Month' },
        notify: false
      });
      expect(report.changed).toContain('tenure');
      expect(report.warnings.join(' ')).toMatch(/db down/);
    });
  });

  describe('COUPLED_FIELDS', () => {
    it('covers every field with downstream meaning', () => {
      // If a field is added here, docs/data-propagation.md must describe what
      // it drives — that is the whole point of the list being explicit.
      expect(COUPLED_FIELDS).toEqual(
        expect.arrayContaining(['tenure', 'domain', 'joiningDate', 'internshipStartDate'])
      );
    });
  });
});
