'use strict';

/**
 * @jest-environment node
 *
 * The 11:55 pm class auto-mark (services/automationCron.js).
 *
 * When a student marked their own attendance (or was otherwise active on the
 * portal) and their coordinator has not marked the class by the end of the
 * day, the agent marks it Present for them. It had no test at all, and no
 * screen showed that it ran, so it was taken for never having been built.
 *
 * The real function runs against stubbed models; the clock is pinned to
 * 23:55 IST.
 */

const mockState = { students: [], rows: [], created: [], taskActivity: null };

jest.mock('../../models/Student', () => ({
    find: () => ({ select: () => ({ lean: async () => mockState.students }) })
}));
jest.mock('../../models/Attendance', () => {
    const matches = (q) => (r) => Object.keys(q).every((k) => r[k] === q[k]);
    return {
        find: (q) => ({ select: () => ({ lean: async () => mockState.rows.filter(matches(q)) }) }),
        findOne: async (q) => mockState.rows.find(matches(q)) || null,
        create: async (doc) => { mockState.created.push(doc); return doc; }
    };
});
jest.mock('../../models/new/StudentTaskProgress', () => ({ findOne: async () => mockState.taskActivity }));

const { autoMarkCoordinatorAttendance } = require('../../services/automationCron');

const FRIDAY_2355_IST = new Date('2026-11-27T18:25:00Z');
const SUNDAY_2355_IST = new Date('2026-11-29T18:25:00Z');
const STUDENT = { _id: 'sid1', employeeId: 'TEN/WEB/1001', domain: 'Web Development', tenure: '3 Months', joiningDate: '2026-11-10' };
const selfPresent = (dateKey) => ({ employeeId: STUDENT.employeeId, dateKey, markedBy: 'self', status: 'Present', domain: 'Web Development' });

function at(when) {
    jest.useFakeTimers({ now: when, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
}

beforeEach(() => {
    Object.assign(mockState, { students: [{ ...STUDENT }], rows: [], created: [], taskActivity: null });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('the 11:55 pm class auto-mark', () => {
    it('marks the class Present for a student who marked their own attendance', async () => {
        at(FRIDAY_2355_IST);
        mockState.rows.push(selfPresent('2026-11-27'));
        const r = await autoMarkCoordinatorAttendance();
        expect(r.marked).toBe(1);
        expect(mockState.created).toEqual([expect.objectContaining({
            employeeId: 'TEN/WEB/1001', dateKey: '2026-11-27', status: 'Present',
            markedBy: 'coordinator', coordinatorId: 'AUTO_SYSTEM', source: 'auto'
        })]);
    });

    it('leaves a coordinator\'s own mark alone, Absent included', async () => {
        at(FRIDAY_2355_IST);
        mockState.rows.push(selfPresent('2026-11-27'),
            { employeeId: STUDENT.employeeId, dateKey: '2026-11-27', markedBy: 'coordinator', status: 'Absent', domain: 'Web Development' });
        await autoMarkCoordinatorAttendance();
        expect(mockState.created).toEqual([]);
    });

    it('marks nothing on a Sunday', async () => {
        at(SUNDAY_2355_IST);
        mockState.rows.push(selfPresent('2026-11-29'));
        await autoMarkCoordinatorAttendance();
        expect(mockState.created).toEqual([]);
    });

    it('marks nothing for a student who did nothing that day', async () => {
        at(FRIDAY_2355_IST);
        mockState.rows.push(selfPresent('2026-11-26'));   // yesterday, not today
        await autoMarkCoordinatorAttendance();
        expect(mockState.created).toEqual([]);
    });
});
