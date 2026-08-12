'use strict';

/**
 * resyncTasksForStudent is the half of the propagation fix that touches stored
 * state, so it is the half that can lose a student's work if it is wrong.
 *
 * These tests run it against an in-memory stand-in for the two models it uses,
 * exercising the real function — the add/remove/preserve rules below are the
 * ones that ship, not a restatement of them.
 */

const mockStore = {
  tasks: [],     // DomainTask documents
  progress: []   // StudentTaskProgress documents
};

let mockNextId = 1;
const mockOid = () => `id${mockNextId++}`;

/** Good enough for the queries taskEngine actually issues. */
function mockMatches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in'  in cond) return cond.$in.map(String).includes(String(value));
      if ('$nin' in cond) return !cond.$nin.map(String).includes(String(value));
    }
    return String(value) === String(cond);
  });
}

jest.mock('../../models/new/DomainTask', () => ({
  find: (query) => ({ lean: async () => mockStore.tasks.filter((t) => mockMatches(t, query)) }),
  findById: (id) => ({ lean: async () => mockStore.tasks.find((t) => String(t._id) === String(id)) || null })
}));

jest.mock('../../models/new/StudentTaskProgress', () => ({
  find: (query) => ({ lean: async () => mockStore.progress.filter((p) => mockMatches(p, query)) }),
  async bulkWrite(ops) {
    let upsertedCount = 0;
    for (const op of ops) {
      const { filter, update } = op.updateOne;
      const existing = mockStore.progress.find((p) => mockMatches(p, filter));
      if (!existing) {
        mockStore.progress.push({ _id: mockOid(), ...update.$setOnInsert });
        upsertedCount++;
      }
    }
    return { upsertedCount };
  },
  async updateMany(query, update) {
    let n = 0;
    for (const p of mockStore.progress) {
      if (mockMatches(p, query)) { Object.assign(p, update.$set); n++; }
    }
    return { modifiedCount: n };
  },
  async deleteMany(query) {
    const before = mockStore.progress.length;
    mockStore.progress = mockStore.progress.filter((p) => !mockMatches(p, query));
    return { deletedCount: before - mockStore.progress.length };
  }
}));

const taskEngine = require('../../services/v2/taskEngine');

const STUDENT = { _id: 'stu1', employeeId: 'TEN/WEB/9001', domain: 'Web Development' };

function seedCatalogue(domain, durationType, weeks) {
  for (let w = 1; w <= weeks; w++) {
    mockStore.tasks.push({
      _id: mockOid(), domain, durationType, weekNumber: w,
      taskTitle: `${domain} ${durationType} W${w}`, coinReward: 25
    });
  }
}

const rowsFor = (durationType, domain = 'Web Development') => {
  const ids = mockStore.tasks
    .filter((t) => t.domain === domain && t.durationType === durationType)
    .map((t) => String(t._id));
  return mockStore.progress.filter((p) => ids.includes(String(p.taskId)));
};

beforeEach(() => {
  mockStore.tasks = [];
  mockStore.progress = [];
  mockNextId = 1;
  seedCatalogue('Web Development', '1month', 4);
  seedCatalogue('Web Development', '3months', 12);
  seedCatalogue('Data Science',    '1month', 4);
});

describe('taskEngine.resyncTasksForStudent', () => {
  it('adds the extra weeks when a tenure is extended — the reported bug', async () => {
    // Enrolled on 1 Month.
    await taskEngine.assignTasksForStudent({ ...STUDENT, tenure: '1 Month' });
    expect(mockStore.progress).toHaveLength(4);

    // HR extends to 3 Months.
    const report = await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '3 Months' });

    expect(report.inScope).toBe(12);
    expect(report.added).toBe(12);       // the 3months catalogue is a distinct task set
    expect(rowsFor('3months')).toHaveLength(12);
  });

  it('removes the now-unearned weeks when a tenure is shortened', async () => {
    await taskEngine.assignTasksForStudent({ ...STUDENT, tenure: '3 Months' });
    expect(mockStore.progress).toHaveLength(12);

    const report = await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '1 Month' });

    expect(report.removed).toBe(12);
    expect(report.preserved).toBe(0);
    expect(rowsFor('1month')).toHaveLength(4);
    expect(rowsFor('3months')).toHaveLength(0);
  });

  it('never deletes work the student has already done', async () => {
    await taskEngine.assignTasksForStudent({ ...STUDENT, tenure: '3 Months' });

    // Three rows carry real work, one of each kind the rule protects.
    const rows = rowsFor('3months');
    Object.assign(rows[0], { status: 'approved', coinsAwarded: 25 });
    Object.assign(rows[1], { status: 'submitted', submissionUrl: 'https://example.invalid/pr/1' });
    Object.assign(rows[2], { quiz_attempts: 2 });

    const report = await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '1 Month' });

    expect(report.preserved).toBe(3);
    expect(report.removed).toBe(9);

    const survivors = rowsFor('3months');
    expect(survivors).toHaveLength(3);
    expect(survivors.find((r) => r.status === 'approved').coinsAwarded).toBe(25);
    expect(survivors.find((r) => r.status === 'submitted').submissionUrl).toBeTruthy();
  });

  it('moves the student onto the new domain when the domain changes', async () => {
    await taskEngine.assignTasksForStudent({ ...STUDENT, tenure: '1 Month' });
    expect(rowsFor('1month', 'Web Development')).toHaveLength(4);

    await taskEngine.resyncTasksForStudent({ ...STUDENT, domain: 'Data Science', tenure: '1 Month' });

    expect(rowsFor('1month', 'Data Science')).toHaveLength(4);
    expect(rowsFor('1month', 'Web Development')).toHaveLength(0);
  });

  it('is a no-op when nothing about the student changed', async () => {
    await taskEngine.assignTasksForStudent({ ...STUDENT, tenure: '1 Month' });

    const report = await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '1 Month' });

    expect(report.added).toBe(0);
    expect(report.removed).toBe(0);
    expect(mockStore.progress).toHaveLength(4);
  });

  it('leaves the journey alone when the domain has no task catalogue', async () => {
    await taskEngine.assignTasksForStudent({ ...STUDENT, tenure: '1 Month' });
    mockStore.tasks = mockStore.tasks.filter((t) => t.domain !== 'Web Development');

    const report = await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '1 Month' });

    // Missing seed data must never be read as "this student has no tasks".
    expect(report.removed).toBe(0);
    expect(mockStore.progress).toHaveLength(4);
  });

  it('caps a 15-days student at two weeks of the borrowed 1-month set', async () => {
    const report = await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '15 Days' });
    expect(report.inScope).toBe(2);
    expect(mockStore.progress).toHaveLength(2);
  });

  it('keeps week 1 available and later weeks locked after a resync', async () => {
    await taskEngine.resyncTasksForStudent({ ...STUDENT, tenure: '3 Months' });

    const byWeek = (w) => {
      const task = mockStore.tasks.find((t) => t.durationType === '3months' && t.weekNumber === w);
      return mockStore.progress.find((p) => String(p.taskId) === String(task._id));
    };
    expect(byWeek(1).status).toBe('available');
    expect(byWeek(2).status).toBe('locked');
  });

  it('returns a zero report for a student with no id rather than throwing', async () => {
    const report = await taskEngine.resyncTasksForStudent({ domain: 'Web Development', tenure: '1 Month' });
    expect(report).toEqual({ added: 0, removed: 0, preserved: 0, inScope: 0 });
  });
});
