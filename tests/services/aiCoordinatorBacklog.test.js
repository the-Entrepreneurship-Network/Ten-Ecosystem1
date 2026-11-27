'use strict';

/**
 * @jest-environment node
 *
 * The AI Coordinator's pre-check backlog and its report of what it did
 * (services/aiCoordinatorJobs.js). The collections are small stand-ins; the
 * pre-check itself is tested in submissionPrecheck.test.js.
 */

const mockState = {};
function mockReset() {
    Object.assign(mockState, { submissions: [], logs: [], mails: [], sent: [], runs: [], profile: 'help@ten.in' });
}
mockReset();

const chain = (rows) => {
    const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => rows };
    return q;
};
const mockWaiting = (s, f) => s.status === f.status && !s.reviewedOnce && (!('aiCheck' in f) || s.aiCheck == null);
const mockSince = (row, range, field) => (!range.$gt || row[field] > range.$gt) && (!range.$gte || row[field] >= range.$gte)
    && (!range.$lte || row[field] <= range.$lte);

jest.mock('mongoose', () => ({
    connection: { readyState: 1, once: () => {} },
    model: () => ({
        find: (f) => chain(mockState.submissions.filter((s) => mockWaiting(s, f)).sort((a, b) => a.submittedAt - b.submittedAt)),
        countDocuments: async (f) => mockState.submissions.filter((s) => mockWaiting(s, f)).length
    })
}));
// Loaded by the jobs file for the reminders and summaries; not used here.
jest.mock('../../models/Student', () => ({}));
jest.mock('../../models/Attendance', () => ({}));
jest.mock('../../models/LoginEvent', () => ({}));
jest.mock('../../models/Notification', () => function Note() {});
jest.mock('../../models/AiCoordinatorLog', () => ({
    find: (f) => chain(mockState.logs.filter((l) => mockSince(l, f.createdAt, 'createdAt')).sort((a, b) => b.createdAt - a.createdAt)),
    countDocuments: async (f) => mockState.logs.filter((l) => l.kind === f.kind && mockSince(l, f.createdAt, 'createdAt')).length,
    create: async (row) => { mockState.logs.push(row); return row; }
}));
jest.mock('../../models/MailHistory', () => ({
    find: (f) => chain(mockState.mails.filter((m) => m.mailType === f.mailType && mockSince(m, f.sentAt, 'sentAt'))),
    create: async (row) => row
}));
jest.mock('../../services/aiCoordinator', () => ({
    NAME: 'TEN AI Coordinator',
    enabled: () => !/^off$/i.test(process.env.AI_COORDINATOR || ''),
    scrub: (s) => String(s).replace(/[^\s@]+@[^\s@]+/g, '[address]').replace(/\b[6-9]\d{9}\b/g, '[phone]'),
    HANDOVER_LABEL: { money: 'money', marks: 'marks or a review' }
}));
jest.mock('../../services/submissionPrecheck', () => ({
    // Stands in for the pre-check: stores a check and logs it, as the real one does.
    run: async (id, opts) => {
        mockState.runs.push({ id: String(id), opts });
        const sub = mockState.submissions.find((s) => s._id === String(id));
        const check = { decision: 'approve', problems: [], repo: sub.githubLink.includes('github.com') ? { public: true } : null };
        sub.aiCheck = check;
        mockState.logs.push({ kind: 'precheck', employeeId: sub.employeeId, question: sub.task, source: 'approve', reply: '', createdAt: new Date() });
        return check;
    }
}));
jest.mock('../../services/supportDesk/gmail', () => ({
    configured: () => true,
    profile: async () => ({ emailAddress: mockState.profile }),
    send: async (raw) => { mockState.sent.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
}));

const jobs = require('../../services/aiCoordinatorJobs');
const wait = jest.fn(async () => {});
jobs._internal.wait = wait;

const sub = (id, extra) => Object.assign({
    _id: id, employeeId: 'TEN/WEB/' + id.slice(1).padStart(4, '0'), domain: 'Web Development', task: 'Week 1: Landing page',
    status: 'Pending', reviewedOnce: false, aiCheck: null, githubLink: 'https://site.example.in', image: '',
    submittedAt: new Date('2026-11-10T05:00:00Z')
}, extra);
// Undoes quoted-printable soft breaks and header folding.
const unfold = (mail) => mail.replace(/=\r?\n/g, '').replace(/\r?\n[ \t]+/g, ' ');

beforeEach(() => {
    mockReset();
    wait.mockClear();
    delete process.env.AI_COORDINATOR;
    delete process.env.GITHUB_TOKEN;
    process.env.SUPPORT_COPY_TO = 'growth@ten.in';
});
afterAll(() => { delete process.env.SUPPORT_COPY_TO; });

describe('the pre-check backlog', () => {
    it('checks every waiting submission that never had one, oldest first, then sends the report', async () => {
        mockState.submissions = [
            sub('s3', { submittedAt: new Date('2026-11-20T05:00:00Z'), image: '/uploads/shot.png' }),
            sub('s1', { submittedAt: new Date('2026-11-01T05:00:00Z'), githubLink: 'https://github.com/priya/landing' }),
            sub('s2', { submittedAt: new Date('2026-11-05T05:00:00Z'), aiCheck: { decision: 'changes' } }),
            sub('s4', { submittedAt: new Date('2026-11-02T05:00:00Z'), reviewedOnce: true }),
            sub('s5', { submittedAt: new Date('2026-11-03T05:00:00Z'), status: 'Approved' })
        ];
        const out = await jobs.precheckBacklog();

        expect(out).toEqual({ waiting: 2, checked: 2, left: 0, stopped: '' });
        // Oldest first; a screenshot is expected only where one was attached.
        expect(mockState.runs).toEqual([
            { id: 's1', opts: { screenshotExpected: false } },
            { id: 's3', opts: { screenshotExpected: true } }
        ]);
        // After a GitHub repository, without a token: the long pause. None after the last one.
        expect(wait.mock.calls).toEqual([[5 * 60 * 1000]]);

        expect(mockState.sent).toHaveLength(1);
        const mail = unfold(mockState.sent[0]);
        expect(mail).toContain('To: growth@ten.in');
        expect(mail).toContain('Subject: [ai-coordinator] pre-check backlog: 2 checked, 0 still without one');
        expect(mail).toContain('3. Pre-checked submissions: 2 (2 look ready, 0 need changes).');
        // s2 already had a pre-check and still waits for its coordinator.
        expect(mail).toContain('Waiting for a coordinator now: 3, of which 0 still have no pre-check.');
    });

    it('with GITHUB_TOKEN set, the short pause only', async () => {
        process.env.GITHUB_TOKEN = 'x';
        mockState.submissions = [
            sub('s1', { githubLink: 'https://github.com/a/b' }),
            sub('s2', { githubLink: 'https://github.com/a/c', submittedAt: new Date('2026-11-11T05:00:00Z') })
        ];
        await jobs.precheckBacklog();
        expect(wait.mock.calls).toEqual([[10 * 1000]]);
    });

    it('stops at the day\'s limit of pre-checks, and the rest wait for tomorrow', async () => {
        const limit = jobs._internal.PRECHECKS_PER_DAY;
        mockState.logs = Array.from({ length: limit - 1 }, () => ({ kind: 'precheck', createdAt: new Date() }));
        mockState.submissions = [sub('s1'), sub('s2', { submittedAt: new Date('2026-11-11T05:00:00Z') })];
        const out = await jobs.precheckBacklog();
        expect(out.checked).toBe(1);
        expect(out.left).toBe(1);
        expect(out.stopped).toMatch(/the rest go tomorrow/);
        expect(unfold(mockState.sent[0])).toContain('pre-check backlog: 1 checked, 1 left for tomorrow');
    });

    it('nothing waiting: nothing checked, no email', async () => {
        mockState.submissions = [sub('s1', { aiCheck: { decision: 'approve' } })];
        expect(await jobs.precheckBacklog()).toEqual({ waiting: 0, checked: 0, left: 0, stopped: '' });
        expect(mockState.sent).toHaveLength(0);
    });

    it('does nothing when switched off, and runs once at a time', async () => {
        mockState.submissions = [sub('s1'), sub('s2', { submittedAt: new Date('2026-11-11T05:00:00Z') })];
        process.env.AI_COORDINATOR = 'off';
        expect(await jobs.precheckBacklog()).toBeNull();
        delete process.env.AI_COORDINATOR;

        const first = jobs.precheckBacklog();
        expect(await jobs.precheckBacklog()).toBeNull();
        expect((await first).checked).toBe(2);
    });
});

describe('the report', () => {
    const NOW = new Date('2026-11-28T04:50:00Z'); // 10:20 in India
    const ago = (h) => new Date(NOW.getTime() - h * 3600 * 1000);

    it('counts each thing the AI did in the last 24 hours, and keeps contact details out', async () => {
        mockState.logs = [
            { kind: 'answer', source: 'saved', employeeId: 'TEN/WEB/1001', question: 'how do I mark attendance', reply: 'Mark it every day, Monday to Saturday.', createdAt: ago(1) },
            { kind: 'answer', source: 'ai', employeeId: 'TEN/WEB/1002', question: 'mail me at priya@gmail.com or 9876543210', reply: 'You can ask me here.', createdAt: ago(2) },
            { kind: 'handover', source: 'money', employeeId: 'TEN/WEB/1003', question: 'I paid but it is not showing', createdAt: ago(3) },
            { kind: 'precheck', source: 'approve', employeeId: 'TEN/WEB/1004', question: 'Week 1: Landing page', reply: '', createdAt: ago(4) },
            { kind: 'precheck', source: 'changes', employeeId: 'TEN/WEB/1005', question: 'Week 2: API', reply: 'The GitHub repository is private or does not exist. Make it public.', createdAt: ago(5) },
            { kind: 'reminder', source: 'inactive', createdAt: ago(6) },
            { kind: 'reminder', source: 'inactive', createdAt: ago(6) },
            { kind: 'reminder', source: 'week', createdAt: ago(6) },
            { kind: 'summary', domain: 'Web Development', createdAt: ago(7) },
            { kind: 'answer', source: 'saved', question: 'older than a day', createdAt: ago(30) }
        ];
        mockState.mails = [
            { mailType: 'ai_coordinator_summary', status: 'sent', sentAt: ago(7) },
            { mailType: 'ai_coordinator_summary', status: 'failed', sentAt: ago(7) }
        ];
        mockState.submissions = [sub('s1', { aiCheck: { decision: 'approve' } }), sub('s2')];

        const text = jobs._internal.reportText(await jobs.buildReport(NOW));
        expect(text).toContain('1. Answered students in Messages: 2 (1 from saved answers, 1 by Gemini).');
        expect(text).toContain('"how do I mark attendance" -> "Mark it every day, Monday to Saturday."');
        expect(text).toContain('2. Handed over to a coordinator: 1 (money: 1).');
        expect(text).toContain('3. Pre-checked submissions: 2 (1 look ready, 1 need changes).');
        expect(text).toContain('"Week 2: API" -> needs changes: The GitHub repository is private');
        expect(text).toContain('Waiting for a coordinator now: 2, of which 1 still have no pre-check.');
        expect(text).toContain('4. Reminders: 3 (2 sign-in, 1 unfinished week, 0 weekly progress).');
        expect(text).toContain('5. Coordinator summaries: 1 domain(s); 1 email(s) sent, 1 failed.');
        expect(text).not.toContain('older than a day');
        expect(text).not.toContain('priya@gmail.com');
        expect(text).not.toContain('9876543210');
    });

    it('the daily one says so in its subject, and with no team inbox it is only logged', async () => {
        await jobs.sendReport(NOW);
        expect(unfold(mockState.sent[0])).toContain('Subject: [ai-coordinator] daily report: 0 answered, 0 pre-checked, 0 reminders');

        delete process.env.SUPPORT_COPY_TO;
        const out = await jobs.sendReport(NOW);
        expect(out.sent).toBe(false);
        expect(out.text).toContain('1. Answered students in Messages: 0');
        expect(mockState.sent).toHaveLength(1);
    });
});
