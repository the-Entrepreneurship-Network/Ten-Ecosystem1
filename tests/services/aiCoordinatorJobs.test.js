'use strict';

/**
 * @jest-environment node
 *
 * The AI Coordinator's reminders and the coordinators' daily summary
 * (services/aiCoordinatorJobs.js). The attendance rules run for real; the
 * collections are small stand-ins, and the keyed log refuses a second row with
 * the same key, as the unique index does.
 */

const mockState = {};
function mockReset() {
    Object.assign(mockState, {
        students: [], attendance: [], signIns: [], submissions: [], logs: [], keys: new Set(),
        notes: [], mails: [], mailRows: [], progress: {}, coordinators: {}, domains: ['Web Development']
    });
}
mockReset();

const chain = (rows) => {
    const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => rows };
    return q;
};
const mockMatches = (row, f) => !f || !f.domain || f.domain.test(row.domain || '');

jest.mock('mongoose', () => ({
    connection: { readyState: 1 },
    model: () => ({ find: (f) => chain(mockState.submissions.filter((s) => mockMatches(s, f) && s.status === f.status && !s.reviewedOnce)) })
}));
jest.mock('../../models/Student', () => ({
    find: (f) => {
        if (f && f.employeeId && f.employeeId.$in) return chain(mockState.students.filter((s) => f.employeeId.$in.includes(s.employeeId)));
        return chain(mockState.students.filter((s) => mockMatches(s, f) && !s.internshipCompleted));
    }
}));
jest.mock('../../models/Attendance', () => ({
    find: (f) => chain(mockState.attendance.filter((a) => f.employeeId.$in.includes(a.employeeId)))
}));
jest.mock('../../models/LoginEvent', () => ({ aggregate: async () => mockState.signIns }));
jest.mock('../../models/MailHistory', () => ({ create: async (row) => { mockState.mailRows.push(row); return row; } }));
jest.mock('../../models/AiCoordinatorLog', () => ({
    create: async (row) => {
        if (row.key && mockState.keys.has(row.key)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        if (row.key) mockState.keys.add(row.key);
        mockState.logs.push(row);
        return row;
    },
    find: (f) => chain(mockState.logs.filter((l) => mockMatches(l, f) && f.kind.$in.includes(l.kind) && l.createdAt >= f.createdAt.$gte))
}));
jest.mock('../../models/Notification', () => function Note(doc) {
    Object.assign(this, doc);
    this.$locals = {};
    this.save = async () => { mockState.notes.push(this); return this; };
});
jest.mock('../../utils/mailer', () => Object.assign({}, jest.requireActual('../../utils/mailer'), {
    mailerReady: () => true,
    createEmailTransporter: () => ({ sendMail: async (m) => { mockState.mails.push(m); return { messageId: 'x' }; } })
}));
jest.mock('../../services/aiCoordinator', () => ({
    NAME: 'TEN AI Coordinator',
    enabled: () => !/^off$/i.test(process.env.AI_COORDINATOR || ''),
    HANDOVER_LABEL: { money: 'money', personal: 'a personal matter' },
    progressOf: async (s) => mockState.progress[s.employeeId] || { total: 0, approved: 0, week: null, current: [], approvedAt: [] },
    coordinatorsFor: async (d) => mockState.coordinators[d] || [],
    domainsWithCoordinators: async () => mockState.domains
}));

const jobs = require('../../services/aiCoordinatorJobs');

// Friday 27 November 2026, 10:05 in India. The internships began on Monday 2 November.
const FRIDAY = new Date('2026-11-27T04:35:00Z');
const THURSDAY = new Date('2026-11-26T04:35:00Z');
const SUNDAY = new Date('2026-11-29T04:35:00Z');
const daysBefore = (now, n) => new Date(now.getTime() - n * 24 * 3600 * 1000);

const student = (employeeId, extra = {}) => Object.assign({
    _id: 'id-' + employeeId, employeeId, name: 'Student ' + employeeId.slice(-4), email: employeeId.slice(-4) + '@mail.test',
    domain: 'Web Development', tenure: '1 Month', joiningDate: '2026-11-02', createdAt: new Date('2026-11-02T05:00:00Z')
}, extra);

beforeEach(() => { mockReset(); delete process.env.AI_COORDINATOR; });

describe('the sign-in reminder', () => {
    beforeEach(() => {
        mockState.students = [
            student('TEN/WEB/1001'),                               // 5 days without signing in
            student('TEN/WEB/1002'),                               // signed in yesterday
            student('TEN/WEB/1003'),                               // 20 days: the Monday mail's job
            student('TEN/WEB/1004', { emailOptOut: true }),        // 4 days, unsubscribed from email
            student('TEN/WEB/1005', { internshipCompleted: true }) // finished: never reminded
        ];
        mockState.signIns = [
            { _id: 'TEN/WEB/1001', at: daysBefore(FRIDAY, 5) },
            { _id: 'TEN/WEB/1002', at: daysBefore(FRIDAY, 1) },
            { _id: 'TEN/WEB/1003', at: daysBefore(FRIDAY, 20) },
            { _id: 'TEN/WEB/1004', at: daysBefore(FRIDAY, 4) },
            { _id: 'TEN/WEB/1005', at: daysBefore(FRIDAY, 6) }
        ];
        mockState.attendance = [
            { employeeId: 'TEN/WEB/1001', dateKey: '2026-11-02', status: 'Present', markedBy: 'self', domain: 'Web Development' },
            { employeeId: 'TEN/WEB/1001', dateKey: '2026-11-03', status: 'Present', markedBy: 'self', domain: 'Web Development' }
        ];
    });

    it('goes to students away for 3 to 13 days, once, and by email only if they did not unsubscribe', async () => {
        const out = await jobs.runReminders(FRIDAY);
        expect(out.inactive).toBe(2);
        expect(out.week).toBeUndefined();
        expect(out.weekly).toBeUndefined();
        const to = mockState.notes.map((n) => n.targetEmployeeId);
        expect(to).toEqual(['TEN/WEB/1001', 'TEN/WEB/1004']);
        const first = mockState.notes[0];
        expect(first).toMatchObject({ title: "You haven't signed in for 5 days", from: 'TEN AI Coordinator', targetType: 'student' });
        expect(first.message).toMatch(/yours is \d+% so far/);
        expect(first.$locals.skipEmail).toBeUndefined();
        expect(mockState.notes[1].$locals.skipEmail).toBe(true);

        // The next morning, the same absence is not reminded about again.
        await jobs.runReminders(new Date(FRIDAY.getTime() + 24 * 3600 * 1000));
        expect(mockState.notes.filter((n) => n.targetEmployeeId === 'TEN/WEB/1001')).toHaveLength(1);
    });

    it('does nothing when switched off', async () => {
        process.env.AI_COORDINATOR = 'off';
        expect(await jobs.runReminders(FRIDAY)).toEqual({ skipped: true });
        expect(mockState.notes).toHaveLength(0);
    });
});

describe('Thursdays and Sundays', () => {
    beforeEach(() => {
        mockState.students = [student('TEN/WEB/1001'), student('TEN/WEB/1002')];
        mockState.signIns = [{ _id: 'TEN/WEB/1001', at: daysBefore(THURSDAY, 1) }, { _id: 'TEN/WEB/1002', at: daysBefore(THURSDAY, 1) }];
        mockState.progress['TEN/WEB/1001'] = {
            total: 6, approved: 3, week: 2,
            current: [{ title: 'Build the API', status: 'available' }, { title: 'Write tests', status: 'submitted' }],
            approvedAt: [daysBefore(SUNDAY, 2), daysBefore(SUNDAY, 10)]
        };
    });

    it('on Thursday, a student with an unfinished week is told what is left, in the portal only', async () => {
        const out = await jobs.runReminders(THURSDAY);
        expect(out.week).toBe(1);
        const note = mockState.notes.find((n) => n.title.startsWith('Week 2'));
        expect(note).toMatchObject({ title: 'Week 2: 2 tasks left', targetEmployeeId: 'TEN/WEB/1001' });
        expect(note.message).toContain('"Build the API", "Write tests"');
        expect(note.message).toContain('open Week 3');
        expect(note.$locals.skipEmail).toBe(true);
        await jobs.runReminders(THURSDAY);
        expect(mockState.notes.filter((n) => n.title.startsWith('Week 2'))).toHaveLength(1);
    });

    it('on Sunday, the week in one line: tasks approved this week, attendance, what is next', async () => {
        mockState.signIns = [{ _id: 'TEN/WEB/1001', at: daysBefore(SUNDAY, 1) }, { _id: 'TEN/WEB/1002', at: daysBefore(SUNDAY, 1) }];
        const out = await jobs.runReminders(SUNDAY);
        expect(out.weekly).toBe(2);
        const mine = mockState.notes.find((n) => n.targetEmployeeId === 'TEN/WEB/1001');
        expect(mine.title).toBe('Your week at TEN');
        expect(mine.message).toMatch(/^1 task approved this week \(3 of 6 so far\), attendance \d+% \(75% is needed\)\. Next: "Build the API"\.$/);
        expect(mine.$locals.skipEmail).toBe(true);
    });
});

describe("the coordinators' summary", () => {
    // The summary runs "on" FRIDAY, but the attendance figures it reads count
    // working days up to the real clock. Pin the clock to FRIDAY as well, or
    // the "two days in" student below ages with every real day: from 28 Nov
    // she had three working days and was judged, and these tests failed.
    beforeAll(() => jest.useFakeTimers({ now: FRIDAY, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
    afterAll(() => jest.useRealTimers());
    beforeEach(() => {
        mockState.students = [
            student('TEN/WEB/1001', { name: 'Asha Verma' }),
            student('TEN/WEB/1002', { name: 'Ravi Kumar' }),
            student('TEN/WEB/1003', { name: 'Neha Singh', joiningDate: '2026-11-26' }),   // two days in: not judged yet
            student('TEN/DS/2001', { name: 'Other Domain', domain: 'Data Science' })
        ];
        // Asha came every working day; Ravi came twice; Neha has just started.
        const days = ['02', '03', '04', '05', '06', '07', '09', '10', '11', '12', '13', '14', '16', '17', '18', '19', '20', '21', '23', '24', '25', '26', '27'];
        mockState.attendance = days.map((d) => ({ employeeId: 'TEN/WEB/1001', dateKey: '2026-11-' + d, status: 'Present', markedBy: 'self', domain: 'Web Development' }))
            .concat(['02', '03'].map((d) => ({ employeeId: 'TEN/WEB/1002', dateKey: '2026-11-' + d, status: 'Present', markedBy: 'self', domain: 'Web Development' })));
        mockState.submissions = [
            { _id: 'sub1', employeeId: 'TEN/WEB/1001', domain: 'Web Development', task: 'Landing page', status: 'Pending', submittedAt: daysBefore(FRIDAY, 3), aiCheck: { problems: [] } },
            { _id: 'sub2', employeeId: 'TEN/WEB/1002', domain: 'Web Development', task: 'API', status: 'Pending', submittedAt: daysBefore(FRIDAY, 1), aiCheck: { problems: ['No screenshot is attached.'] } },
            { _id: 'sub3', employeeId: 'TEN/WEB/1002', domain: 'Web Development', task: 'Old', status: 'Approved', reviewedOnce: true, submittedAt: daysBefore(FRIDAY, 9) },
            { _id: 'sub4', employeeId: 'TEN/DS/2001', domain: 'Data Science', task: 'EDA', status: 'Pending', submittedAt: daysBefore(FRIDAY, 2) }
        ];
        mockState.logs = [
            { kind: 'answer', source: 'saved', employeeId: 'TEN/WEB/1001', domain: 'Web Development', question: 'where is my offer letter', createdAt: daysBefore(FRIDAY, 0.2) },
            { kind: 'answer', source: 'ai', employeeId: 'TEN/WEB/1002', domain: 'Web Development', question: 'can I use React?', createdAt: daysBefore(FRIDAY, 0.3) },
            { kind: 'handover', source: 'money', employeeId: 'TEN/WEB/1002', domain: 'Web Development', question: 'I paid but it is not showing', createdAt: daysBefore(FRIDAY, 0.5) },
            { kind: 'answer', source: 'saved', employeeId: 'TEN/WEB/1001', domain: 'Web Development', question: 'last week', createdAt: daysBefore(FRIDAY, 3) }
        ];
        mockState.coordinators['Web Development'] = [
            { id: 'ananya@ten-coordinators.in', name: 'Ananya Rao', email: 'ananya@ten-coordinators.in' },
            { id: 'web_admin', name: 'Web Development coordinator', email: '' }
        ];
    });

    it('says what is waiting and who is under 75%, for one domain, and nothing about chat', async () => {
        const s = await jobs.buildSummary('Web Development', FRIDAY);
        expect(s.pending).toMatchObject({ count: 2, oldestDays: 3 });
        expect(s.pending.items.map((i) => [i.employeeId, i.name, i.ai])).toEqual([['TEN/WEB/1001', 'Asha Verma', 'ready'], ['TEN/WEB/1002', 'Ravi Kumar', 'problems']]);
        expect(s.lowAttendance.map((a) => a.employeeId)).toEqual(['TEN/WEB/1002']);
        expect(s).not.toHaveProperty('handovers');
        expect(s).not.toHaveProperty('answered');
    });

    it('in the morning: a dashboard notice for the domain, an email to coordinators with an address, once a day', async () => {
        const out = await jobs.runSummaries(FRIDAY);
        expect(out).toEqual({ domains: 1, emails: 1 });
        expect(mockState.mails).toHaveLength(1);
        expect(mockState.mails[0].to).toBe('ananya@ten-coordinators.in');
        expect(mockState.mails[0].subject).toBe("Web Development: today's summary from the AI Coordinator");
        expect(mockState.mails[0].html).toContain('Ravi Kumar');
        expect(mockState.mails[0].html).not.toContain('I paid but it is not showing');
        expect(mockState.mails[0].html).not.toMatch(/handed over|What the AI answered/i);
        const notice = mockState.notes.find((n) => n.targetType === 'coordinator-domain');
        expect(notice).toMatchObject({ targetDomain: 'Web Development', title: "Today's AI summary", type: 'info', message: '2 submission(s) waiting, 1 under 75% attendance. Open the AI Assistant tab for the details.' });
        expect(mockState.mailRows[0]).toMatchObject({ mailType: 'ai_coordinator_summary', recipientEmail: 'ananya@ten-coordinators.in' });

        expect(await jobs.runSummaries(FRIDAY)).toEqual({ domains: 0, emails: 0 });
        expect(mockState.mails).toHaveLength(1);
    });

    it('a quiet domain gets nothing', async () => {
        mockState.domains = ['Cyber Security'];
        expect(await jobs.runSummaries(FRIDAY)).toEqual({ domains: 0, emails: 0 });
        expect(mockState.notes).toHaveLength(0);
    });
});
