'use strict';

/**
 * @jest-environment node
 *
 * The AI Coordinator's review of the waiting submissions and its report of what
 * it did (services/aiCoordinatorJobs.js). The collections are small stand-ins;
 * the pre-check itself is tested in submissionPrecheck.test.js, and the review
 * function it is handed stands in for server.js's reviewSubmission().
 */

const mockState = {};
function mockReset() {
    Object.assign(mockState, { submissions: [], logs: [], mails: [], sent: [], runs: [], reviews: [], checks: {}, profile: 'help@ten.in' });
}
mockReset();

const chain = (rows) => {
    const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => rows };
    return q;
};
const mockWaiting = (s, f) => s.status === f.status && !s.reviewedOnce
    && (!('aiCheck' in f) || s.aiCheck == null)
    && (!f.submittedAt || s.submittedAt < f.submittedAt.$lt);
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
    create: async (row) => { mockState.logs.push(Object.assign({ createdAt: new Date() }, row)); return row; }
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
    // Stands in for the pre-check: stores the check this test chose for the
    // submission and logs it, as the real one does.
    run: async (id, opts) => {
        mockState.runs.push({ id: String(id), opts });
        const sub = mockState.submissions.find((s) => s._id === String(id));
        if (!sub || sub.reviewedOnce) return null;
        const check = Object.assign({ at: new Date(), by: 'ai', match: 'yes', problems: [], draft: 'Good work.', link: { verdict: 'opens' }, repo: null },
            mockState.checks[sub._id] || {});
        sub.aiCheck = check;
        mockState.logs.push({ kind: 'precheck', employeeId: sub.employeeId, question: sub.task, source: check.problems.length ? 'changes' : 'approve', reply: check.problems.join(' '), createdAt: new Date() });
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
// server.js's reviewSubmission(), as the coordinator's Approve button uses it.
const review = jest.fn(async ({ id, status, feedback, from, reviewedBy }) => {
    const sub = mockState.submissions.find((s) => s._id === String(id));
    if (!sub) return { success: false, message: 'Submission not found' };
    if (sub.reviewedOnce) return { success: false, alreadyReviewed: true };
    Object.assign(sub, { status, feedback, reviewedOnce: true, reviewedBy, reviewedFrom: from });
    return { success: true };
});
jobs.attach({ review });

const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
const sub = (id, extra) => Object.assign({
    _id: id, employeeId: 'TEN/WEB/' + id.slice(1).padStart(4, '0'), domain: 'Web Development', task: 'Week 1: Landing page',
    status: 'Pending', reviewedOnce: false, aiCheck: null, githubLink: 'https://site.example.in', image: '',
    submittedAt: ago(10)
}, extra);
const freshCheck = (extra) => Object.assign({ at: new Date(Date.now() - 3600 * 1000), by: 'ai', match: 'yes', problems: [], draft: 'Good work.', link: { verdict: 'opens' }, repo: null }, extra);
// Undoes quoted-printable soft breaks and header folding.
const unfold = (mail) => mail.replace(/=\r?\n/g, '').replace(/\r?\n[ \t]+/g, ' ');

beforeEach(() => {
    mockReset();
    wait.mockClear();
    review.mockClear();
    delete process.env.AI_COORDINATOR;
    delete process.env.AI_COORDINATOR_REVIEW;
    delete process.env.GITHUB_TOKEN;
    process.env.SUPPORT_COPY_TO = 'growth@ten.in';
});
afterAll(() => { delete process.env.SUPPORT_COPY_TO; });

describe('the decision on a pre-checked submission', () => {
    const { decide } = jobs._internal;
    const check = (extra) => Object.assign({ by: 'ai', match: 'yes', problems: [], draft: 'Nice.', link: { verdict: 'opens' }, repo: null }, extra);

    it('approves only when every check passed and Gemini read it', () => {
        expect(decide(check())).toEqual({ status: 'Approved', feedback: 'Nice.' });
        expect(decide(check({ match: 'partly' }))).toEqual({ status: 'Approved', feedback: 'Nice.' });
        expect(decide(check({ match: 'unclear' }))).toEqual({ status: 'Approved', feedback: 'Nice.' });
        // A public repository counts as opened even when the link check was unsure.
        expect(decide(check({ link: { verdict: 'unknown' }, repo: { public: true, empty: false } }))).toEqual({ status: 'Approved', feedback: 'Nice.' });
    });

    it('asks for changes when a check failed or the work is not the task', () => {
        expect(decide(check({ problems: ['The GitHub repository is private or does not exist. Make it public.'], draft: 'Fix: make it public.' })))
            .toEqual({ status: 'Rejected', feedback: 'Fix: make it public.' });
        expect(decide(check({ match: 'no', draft: 'This is not the landing page task.' })))
            .toEqual({ status: 'Rejected', feedback: 'This is not the landing page task.' });
    });

    it('waits for a person otherwise, and never decides without Gemini', () => {
        expect(decide(null)).toEqual({ wait: 'no pre-check yet' });
        expect(decide(check({ by: 'rules' }))).toEqual({ wait: 'Gemini did not read it' });
        expect(decide(check({ link: { verdict: 'unknown' } }))).toEqual({ wait: 'the link could not be checked' });
        expect(decide(check({ link: { verdict: 'down' } }))).toEqual({ wait: 'the link could not be checked' });
        // A check that failed is never "approve", even with Gemini's blessing.
        expect(decide(check({ by: 'rules', problems: ['There is no link to the work.'], draft: 'Add the link.' }))).toEqual({ status: 'Rejected', feedback: 'Add the link.' });
    });
});

describe('the review of the waiting submissions', () => {
    it('pre-checks where nothing fresh exists, decides the clear cases through the review path, leaves the rest', async () => {
        mockState.submissions = [
            sub('s1', { submittedAt: ago(20), aiCheck: freshCheck({ repo: { public: true, fullName: 'a/b' } }) }),   // reused, approved
            sub('s2', { submittedAt: ago(15) }),                                                                     // checked now, approved
            sub('s3', { submittedAt: ago(12), image: '/uploads/shot.png' }),                                          // checked now, private: changes
            sub('s4', { submittedAt: ago(8), aiCheck: freshCheck({ by: 'rules' }) }),                                // checked again (Gemini may be back); still none: waits
            sub('s5', { submittedAt: ago(90) }),                                                                     // older than 60 days: checked, not decided
            sub('s6', { submittedAt: ago(5), aiCheck: freshCheck({ link: { verdict: 'unknown' } }) }),               // waits: link not checked
            sub('s7', { submittedAt: ago(30), reviewedOnce: true, status: 'Approved' }),                             // a person's: untouched
            sub('s8', { submittedAt: ago(3), aiCheck: freshCheck({ at: new Date(Date.now() - 2 * DAY) }) })          // stale check: made again
        ];
        mockState.checks.s3 = { problems: ['The GitHub repository is private or does not exist. Make it public.'], draft: 'Before it can be approved: make it public.', repo: { public: false } };
        mockState.checks.s4 = { by: 'rules' };

        const out = await jobs.reviewBacklog();

        expect(out).toMatchObject({ waiting: 7, older: 1, checked: 5, approved: 3, changes: 1, waited: 2, left: 3, stopped: '' });
        // Oldest first within the 60 days, the older one last; a screenshot is expected only where one was attached.
        expect(mockState.runs.map((r) => r.id)).toEqual(['s2', 's3', 's4', 's8', 's5']);
        expect(mockState.runs.every((r) => r.opts.notify === false)).toBe(true);
        expect(mockState.runs[1].opts.screenshotExpected).toBe(true);

        // Every decision went through the coordinator's own review function, as the AI's.
        expect(review.mock.calls.map((c) => [String(c[0].id), c[0].status])).toEqual([['s1', 'Approved'], ['s2', 'Approved'], ['s3', 'Rejected'], ['s8', 'Approved']]);
        expect(review.mock.calls.every((c) => c[0].from === 'TEN AI Coordinator' && c[0].reviewedBy === 'ai')).toBe(true);
        const s3 = mockState.submissions.find((s) => s._id === 's3');
        expect(s3).toMatchObject({ status: 'Rejected', reviewedOnce: true, reviewedBy: 'ai', feedback: 'Before it can be approved: make it public.' });
        for (const id of ['s4', 's5', 's6']) expect(mockState.submissions.find((s) => s._id === id)).toMatchObject({ status: 'Pending', reviewedOnce: false });
        expect(mockState.submissions.find((s) => s._id === 's7').reviewedBy).toBeUndefined();

        // Logged, and reported to the team inbox.
        expect(mockState.logs.filter((l) => l.kind === 'review').map((l) => [l.employeeId, l.source, l.question])).toEqual([
            ['TEN/WEB/0001', 'approve', 'Week 1: Landing page'], ['TEN/WEB/0002', 'approve', 'Week 1: Landing page'],
            ['TEN/WEB/0003', 'changes', 'Week 1: Landing page'], ['TEN/WEB/0008', 'approve', 'Week 1: Landing page']
        ]);
        const mail = unfold(mockState.sent[0]);
        expect(mail).toContain('Subject: [ai-coordinator] review backlog: 3 approved, 1 asked for changes, 3 still waiting');
        expect(mail).toContain('3. Reviewed submissions: 4 (3 approved, 1 asked for changes), after 5 pre-check(s).');
        expect(mail).toContain('"Week 1: Landing page" -> asked for changes: Before it can be approved: make it public.');
        expect(mail).toContain('Still waiting for a coordinator: 3. Of these, 0 have no pre-check yet, 2 could not be checked automatically or Gemini did not read them (a person should look), and 1 are older than 60 days (left for a person).');
        // A pause only after a check that went to the network.
        expect(wait).toHaveBeenCalledTimes(5);
    });

    it('after a GitHub repository without GITHUB_TOKEN, the long pause; with it, the short one', async () => {
        mockState.submissions = [sub('s1', { githubLink: 'https://github.com/a/b' }), sub('s2', { submittedAt: ago(9) })];
        mockState.checks.s1 = { repo: { public: true, fullName: 'a/b' } };
        await jobs.reviewBacklog();
        expect(wait.mock.calls).toEqual([[150 * 1000], [10 * 1000]]);

        mockReset(); wait.mockClear();
        process.env.GITHUB_TOKEN = 'x';
        mockState.submissions = [sub('s1', { githubLink: 'https://github.com/a/b' })];
        mockState.checks.s1 = { repo: { public: true, fullName: 'a/b' } };
        await jobs.reviewBacklog();
        expect(wait.mock.calls).toEqual([[10 * 1000]]);
    });

    it('past the day\'s pre-check limit it makes no new checks but still decides the fresh ones', async () => {
        const limit = jobs._internal.PRECHECKS_PER_DAY;
        mockState.logs = Array.from({ length: limit }, () => ({ kind: 'precheck', createdAt: new Date() }));
        mockState.submissions = [sub('s1'), sub('s2', { submittedAt: ago(9), aiCheck: freshCheck() })];
        const out = await jobs.reviewBacklog();
        expect(mockState.runs).toEqual([]);
        expect(out).toMatchObject({ checked: 0, approved: 1, waited: 1, left: 1 });
        expect(out.stopped).toMatch(/the rest go tomorrow/);
        expect(unfold(mockState.sent[0])).toContain('review backlog: 1 approved, 0 asked for changes, 1 still waiting');
    });

    it('with AI_COORDINATOR_REVIEW=off it pre-checks and decides nothing', async () => {
        process.env.AI_COORDINATOR_REVIEW = 'off';
        mockState.submissions = [sub('s1'), sub('s2', { submittedAt: ago(9), aiCheck: freshCheck() })];
        const out = await jobs.reviewBacklog();
        expect(mockState.runs.map((r) => r.id)).toEqual(['s1']);
        expect(review).not.toHaveBeenCalled();
        expect(out).toMatchObject({ checked: 1, approved: 0, changes: 0, left: 2 });
    });

    it('a submission a person reviewed in the meantime is left as theirs', async () => {
        mockState.submissions = [sub('s1', { aiCheck: freshCheck() })];
        review.mockImplementationOnce(async () => ({ success: false, alreadyReviewed: true }));
        const out = await jobs.reviewBacklog();
        expect(out).toMatchObject({ approved: 0, changes: 0, waited: 0 });
        expect(mockState.logs.filter((l) => l.kind === 'review')).toEqual([]);
    });

    it('nothing waiting: nothing done, no email', async () => {
        mockState.submissions = [sub('s1', { reviewedOnce: true, status: 'Approved' })];
        expect(await jobs.reviewBacklog()).toMatchObject({ waiting: 0, checked: 0, approved: 0, left: 0 });
        expect(mockState.sent).toHaveLength(0);
    });

    it('does nothing when switched off, and runs once at a time', async () => {
        mockState.submissions = [sub('s1'), sub('s2', { submittedAt: ago(9) })];
        process.env.AI_COORDINATOR = 'off';
        expect(await jobs.reviewBacklog()).toBeNull();
        delete process.env.AI_COORDINATOR;

        const first = jobs.reviewBacklog();
        expect(await jobs.reviewBacklog()).toBeNull();
        expect((await first).approved).toBe(2);
    });
});

describe('the report', () => {
    const NOW = new Date('2026-11-28T04:50:00Z'); // 10:20 in India
    const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);

    it('counts each thing the AI did in the last 24 hours, and keeps contact details out', async () => {
        mockState.logs = [
            { kind: 'answer', source: 'saved', employeeId: 'TEN/WEB/1001', question: 'how do I mark attendance', reply: 'Mark it every day, Monday to Saturday.', createdAt: hoursAgo(1) },
            { kind: 'answer', source: 'ai', employeeId: 'TEN/WEB/1002', question: 'mail me at priya@gmail.com or 9876543210', reply: 'You can ask me here.', createdAt: hoursAgo(2) },
            { kind: 'handover', source: 'money', employeeId: 'TEN/WEB/1003', question: 'I paid but it is not showing', createdAt: hoursAgo(3) },
            { kind: 'precheck', source: 'approve', employeeId: 'TEN/WEB/1004', question: 'Week 1: Landing page', reply: '', createdAt: hoursAgo(4) },
            { kind: 'review', source: 'approve', employeeId: 'TEN/WEB/1004', question: 'Week 1: Landing page', reply: 'Clean page. Add alt text next time.', createdAt: hoursAgo(4) },
            { kind: 'review', source: 'changes', employeeId: 'TEN/WEB/1005', question: 'Week 2: API', reply: 'The GitHub repository is private or does not exist. Make it public.', createdAt: hoursAgo(5) },
            { kind: 'reminder', source: 'inactive', createdAt: hoursAgo(6) },
            { kind: 'reminder', source: 'inactive', createdAt: hoursAgo(6) },
            { kind: 'reminder', source: 'week', createdAt: hoursAgo(6) },
            { kind: 'summary', domain: 'Web Development', createdAt: hoursAgo(7) },
            { kind: 'answer', source: 'saved', question: 'older than a day', createdAt: hoursAgo(30) }
        ];
        mockState.mails = [
            { mailType: 'ai_coordinator_summary', status: 'sent', sentAt: hoursAgo(7) },
            { mailType: 'ai_coordinator_summary', status: 'failed', sentAt: hoursAgo(7) }
        ];
        mockState.submissions = [
            sub('s1', { aiCheck: freshCheck({ link: { verdict: 'unknown' } }) }),
            sub('s2'),
            sub('s3', { submittedAt: new Date(NOW.getTime() - 70 * DAY), aiCheck: freshCheck() })
        ];

        const text = jobs._internal.reportText(await jobs.buildReport(NOW));
        expect(text).toContain('1. Answered students in Messages: 2 (1 from saved answers, 1 by Gemini).');
        expect(text).toContain('"how do I mark attendance" -> "Mark it every day, Monday to Saturday."');
        expect(text).toContain('2. Handed over to a coordinator: 1 (money: 1).');
        expect(text).toContain('3. Reviewed submissions: 2 (1 approved, 1 asked for changes), after 1 pre-check(s).');
        expect(text).toContain('"Week 1: Landing page" -> approved: Clean page. Add alt text next time.');
        expect(text).toContain('"Week 2: API" -> asked for changes: The GitHub repository is private');
        expect(text).toContain('Still waiting for a coordinator: 3. Of these, 1 have no pre-check yet, 1 could not be checked automatically or Gemini did not read them (a person should look), and 1 are older than 60 days (left for a person).');
        expect(text).toContain('4. Reminders: 3 (2 sign-in, 1 unfinished week, 0 weekly progress).');
        expect(text).toContain('5. Coordinator summaries: 1 domain(s); 1 email(s) sent, 1 failed.');
        expect(text).not.toContain('older than a day');
        expect(text).not.toContain('priya@gmail.com');
        expect(text).not.toContain('9876543210');
    });

    it('the daily one says so in its subject, and with no team inbox it is only logged', async () => {
        await jobs.sendReport(NOW);
        expect(unfold(mockState.sent[0])).toContain('Subject: [ai-coordinator] daily report: 0 answered, 0 reviewed, 0 reminders');

        delete process.env.SUPPORT_COPY_TO;
        const out = await jobs.sendReport(NOW);
        expect(out.sent).toBe(false);
        expect(out.text).toContain('1. Answered students in Messages: 0');
        expect(mockState.sent).toHaveLength(1);
    });
});
