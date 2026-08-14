'use strict';

/**
 * Week 1 approved, Week 2 still saying "Complete Week 1 to unlock".
 *
 * Unlocking only ever happened at the moment a coordinator approved a task.
 * But passing the quiz is how most students actually finish one, and that path
 * wrote `status: "approved"` straight to the progress row and stopped there —
 * so the student was left looking at an approved week above a locked one, with
 * no action available to them.
 *
 * Two halves: the quiz path now unlocks, and a journey that is already stuck
 * repairs itself on read, so nobody needs a migration to get moving again.
 */

const mockState = { tasks: [], progress: [], updates: [] };

function mockQ(result) {
  const o = {
    lean: () => o, select: () => o, sort: () => o, limit: () => o,
    then: (r, j) => Promise.resolve(result).then(r, j),
    catch: (j) => Promise.resolve(result).catch(j)
  };
  return o;
}

jest.mock('../../models/new/DomainTask', () => ({
  find: (filter) => mockQ(mockState.tasks.filter((t) => {
    if (filter.domain && t.domain !== filter.domain) return false;
    if (filter.durationType && t.durationType !== filter.durationType) return false;
    if (filter.weekNumber !== undefined) {
      const w = filter.weekNumber;
      if (w && w.$in) return w.$in.indexOf(t.weekNumber) !== -1;
      if (t.weekNumber !== w) return false;
    }
    return true;
  })),
  findById: (id) => mockQ(mockState.tasks.find((t) => String(t._id) === String(id)) || null)
}));

jest.mock('../../models/new/StudentTaskProgress', () => ({
  find: () => mockQ(mockState.progress),
  findOne: () => mockQ(mockState.progress[0] || null),
  countDocuments: async (filter) => mockState.progress.filter((p) =>
    p.status === filter.status &&
    filter.taskId.$in.some((id) => String(id) === String(p.taskId))).length,
  updateMany: async (filter, update) => {
    const ids = (filter.taskId && filter.taskId.$in) || [];
    let n = 0;
    for (const p of mockState.progress) {
      if (!ids.some((id) => String(id) === String(p.taskId))) continue;
      if (filter.status && p.status !== filter.status) continue;
      p.status = update.$set.status;
      n++;
    }
    mockState.updates.push({ ids: ids.map(String), set: update.$set });
    return { modifiedCount: n };
  },
  bulkWrite: async () => ({ upsertedCount: 0 })
}));

jest.mock('../../services/v2/coinService', () => ({
  awardCoins: async () => ({ awarded: 0 }),
  getBalance: async () => ({ totalCoins: 0, rupeeValue: 0 })
}));

const taskEngine = require('../../services/v2/taskEngine');

const STUDENT = { _id: 'stud1', domain: 'Python Development', tenure: '1 Month', v2DurationType: '1month' };

/** Four weeks, one task each — the shape in the screenshot. */
function seed(statuses) {
  mockState.tasks = statuses.map((_, i) => ({
    _id: 't' + (i + 1), domain: 'Python Development', durationType: '1month',
    weekNumber: i + 1, taskTitle: 'Week ' + (i + 1), coinReward: 25
  }));
  mockState.progress = statuses.map((s, i) => ({
    _id: 'p' + (i + 1), studentId: 'stud1', taskId: 't' + (i + 1), status: s
  }));
  mockState.updates = [];
}

const statusOf = (weeks, n) => weeks.find((w) => w.week === n).tasks[0].status;

describe('finishing a week opens the next one', () => {
  it('unlocks week 2 once week 1 is approved', async () => {
    seed(['approved', 'locked', 'locked', 'locked']);
    const res = await taskEngine.tryUnlockNextWeek(STUDENT, 't1');
    expect(res.unlocked).toBe(1);
    expect(mockState.progress[1].status).toBe('available');
  });

  it('leaves week 3 alone until week 2 is done', async () => {
    seed(['approved', 'available', 'locked', 'locked']);
    await taskEngine.tryUnlockNextWeek(STUDENT, 't1');
    expect(mockState.progress[2].status).toBe('locked');
  });

  it('does nothing while the current week is unfinished', async () => {
    seed(['available', 'locked', 'locked', 'locked']);
    const res = await taskEngine.tryUnlockNextWeek(STUDENT, 't1');
    expect(res.unlocked).toBe(0);
  });
});

describe('a journey already stuck repairs itself on read', () => {
  it('opens the week that should have opened', async () => {
    // THE REPORTED STATE: week 1 approved by quiz, week 2 never unlocked.
    seed(['approved', 'locked', 'locked', 'locked']);
    const { weeks } = await taskEngine.getStudentTasks(STUDENT);
    expect(statusOf(weeks, 2)).toBe('available');
    expect(statusOf(weeks, 3)).toBe('locked');
  });

  it('catches up a student stuck for several weeks', async () => {
    seed(['approved', 'approved', 'locked', 'locked']);
    const { weeks } = await taskEngine.getStudentTasks(STUDENT);
    expect(statusOf(weeks, 3)).toBe('available');
    expect(statusOf(weeks, 4)).toBe('locked');
  });

  it('writes nothing when there is nothing to repair', async () => {
    seed(['approved', 'available', 'locked', 'locked']);
    await taskEngine.getStudentTasks(STUDENT);
    expect(mockState.updates).toEqual([]);
  });

  it('leaves a fresh journey alone', async () => {
    seed(['available', 'locked', 'locked', 'locked']);
    const { weeks } = await taskEngine.getStudentTasks(STUDENT);
    expect(statusOf(weeks, 2)).toBe('locked');
    expect(mockState.updates).toEqual([]);
  });

  it('does not resurrect a week the student already finished', async () => {
    seed(['approved', 'approved', 'approved', 'locked']);
    const { weeks } = await taskEngine.getStudentTasks(STUDENT);
    expect(statusOf(weeks, 3)).toBe('approved');
    expect(statusOf(weeks, 4)).toBe('available');
  });
});

describe('the quiz path unlocks too', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../routes/v2/studentPortal.js'), 'utf8');

  it('calls the unlock after approving on a pass', () => {
    const at = source.indexOf('/student/quiz-result');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 2200);
    expect(block).toContain('quizPassed: true');
    expect(block).toContain('taskEngine.tryUnlockNextWeek(student, taskId)');
  });

  it('no longer swallows the failure silently', () => {
    // `catch(e) { /* silent */ }` is how this went unnoticed.
    const at = source.indexOf('/student/quiz-result');
    expect(source.slice(at, at + 2200)).not.toContain('/* silent */');
  });
});
