'use strict';

/**
 * @jest-environment node
 *
 * The Interview Room (services/aiMeeting.js): open every second Sunday, one
 * interview per student per opening; eight questions built from the student's
 * own tasks; each answer scored; the camera totals kept; a report saved,
 * logged and emailed at the end.
 */

const mockDb = { sessions: [], logs: [], gemini: [], mails: [], ready: true, answer: null, assignments: [], progress: [], domainTasks: [], submissions: [], mailerReady: true };
const chain = (rows) => { const q = { sort: () => q, limit: () => q, select: () => q, lean: async () => rows, then: (res, rej) => Promise.resolve(rows).then(res, rej) }; return q; };

jest.mock('../../models/MeetingSession', () => {
    class Session {
        constructor(doc) { Object.assign(this, { turns: [], topics: [], proctor: null, overall: null, summary: '', emailed: false, endedAt: null, startedAt: new Date() }, doc); this._id = 's' + (mockDb.sessions.length + 1); }
        async save() { if (!mockDb.sessions.includes(this)) mockDb.sessions.push(this); return this; }
        static async create(doc) { const s = new Session(doc); await s.save(); return s; }
        static findOne(f) {
            const rows = mockDb.sessions.filter((s) => String(s.studentId) === String(f.studentId) &&
                (f._id === undefined || s._id === String(f._id)) &&
                (f.endedAt === undefined || s.endedAt === f.endedAt) &&
                (!f.startedAt || (s.startedAt >= f.startedAt.$gte && s.startedAt <= f.startedAt.$lte)));
            rows.sort((a, b) => b.startedAt - a.startedAt);
            const q = { sort: () => q, then: (res, rej) => Promise.resolve(rows[0] || null).then(res, rej) };
            return q;
        }
        static find(f) { return chain(mockDb.sessions.filter((s) => String(s.studentId) === String(f.studentId) && s.endedAt)); }
    }
    return Session;
});
jest.mock('../../models/AiCoordinatorLog', () => ({
    create: async (row) => { mockDb.logs.push(row); return row; },
    countDocuments: async (f) => mockDb.logs.filter((l) => l.kind === f.kind && f.source.$in.includes(l.source)).length
}));
jest.mock('../../models/TaskAssignment', () => ({ find: () => chain(mockDb.assignments) }));
jest.mock('../../models/new/StudentTaskProgress', () => ({ find: () => chain(mockDb.progress) }));
jest.mock('../../models/new/DomainTask', () => ({ find: () => chain(mockDb.domainTasks) }));
jest.mock('../../utils/gemini', () => ({
    ready: () => mockDb.ready,
    ask: async (prompt) => { mockDb.gemini.push(prompt); const fn = mockDb.answer; return fn ? fn(prompt) : {}; },
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' }
}));
jest.mock('../../utils/mailer', () => ({
    mailerReady: () => mockDb.mailerReady,
    isSendableAddress: (a) => /@/.test(String(a || '')),
    escapeHtml: (s) => String(s).replace(/</g, '&lt;'),
    renderEmail: (o) => `${o.heading}|${o.name}|${o.bodyHtml}|${o.panel.html}|${o.cta.url}`,
    createEmailTransporter: () => ({ sendMail: async (m) => { mockDb.mails.push(m); } }),
    EMAIL_FROM: 'TEN <noreply@test>', PORTAL_URL: 'https://portal.test'
}));
jest.mock('../../services/aiCoordinator', () => ({
    NAME: 'TEN AI Coordinator',
    scrub: (s) => String(s).replace(/\b[6-9]\d{9}\b/g, '[phone]'),
    contextFor: async () => 'Domain: Web Development\nAttendance: 80% so far.\nTask Journey: 3 of 8 tasks approved. Current week: 2.'
}));
jest.mock('mongoose', () => ({
    Types: { ObjectId: { isValid: (id) => /^s\d+$/.test(String(id)) } },
    model: () => ({ find: () => chain(mockDb.submissions) })
}));

const meeting = require('../../services/aiMeeting');
const student = { _id: 'stu1', employeeId: 'TEN/WEB/1005', name: 'Priya Nair', email: 'priya@x.in', domain: 'Web Development' };
const SUNDAY = new Date('2026-12-13T06:00:00Z');   // an interview Sunday, 11:30 IST
const MONDAY = new Date('2026-12-14T06:00:00Z');

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(SUNDAY);
    delete process.env.INTERVIEW_OPEN;
    Object.assign(mockDb, { sessions: [], logs: [], gemini: [], mails: [], ready: true, answer: null, mailerReady: true,
        assignments: [{ title: 'Week 1: Landing page', description: 'Build a responsive landing page with a contact form.' }, { title: 'Week 2: REST API', description: 'An Express API with validation and error handling.' }],
        progress: [{ taskId: 't1', status: 'approved' }],
        domainTasks: [{ taskTitle: 'Git basics', taskDescription: 'Branches, commits, pull requests.' }],
        submissions: [{ task: 'Week 1: Landing page' }, { task: 'Deploy to Render' }] });
});
afterEach(() => { jest.useRealTimers(); });

const questions = ['What breaks in your contact form if the server is slow?', 'How does Express tell a 400 from a 500?', 'Why validate on the server when the form already validates?',
    'What does a pull request give a team that a commit does not?', 'How would you debug a 502 after deploying to Render?', 'What is idempotency, and which of your endpoints need it?',
    'Where would you add a cache in your API, and what goes wrong?', 'How do you keep a secret out of a public repository?'];
function geminiAsks() {
    mockDb.answer = (prompt) => {
        const m = prompt.match(/ask question (\d) of 8/);
        if (/The interview is starting/.test(prompt)) return { question: questions[0], done: false };
        if (m) return { score: 6, feedback: 'Right idea, no example. A strong answer names the status code and shows the handler.', question: questions[Number(m[1]) - 1], done: false };
        return { score: 9, feedback: 'Complete.', question: '', done: true, summary: 'Strengths: clear on HTTP. Gaps: deployment debugging. Work on: reading server logs; writing one test per endpoint.', overall: 7 };
    };
}
async function fullInterview(proctor) {
    const { sessionId } = await meeting.startInterview({ student });
    let out;
    for (let n = 1; n <= 8; n++) out = await meeting.answerInterview({ student, sessionId, answer: `Answer ${n}`, seconds: 40 + n, proctor: n === 1 ? proctor : { checker: 'mediapipe' } });
    return { sessionId, out };
}

describe('when the room is open', () => {
    it('opens on the anchor Sunday and every fourteenth day after, India time', () => {
        expect(meeting.schedule(new Date('2026-11-28T20:00:00Z'))).toMatchObject({ open: true, today: '2026-11-29', next: '2026-11-29', following: '2026-12-13' });   // 01:30 IST Sunday
        expect(meeting.schedule(new Date('2026-11-29T18:40:00Z'))).toMatchObject({ open: false, today: '2026-11-30', next: '2026-12-13', following: '2026-12-27' }); // 00:10 IST Monday
        expect(meeting.schedule(new Date('2026-12-06T06:00:00Z'))).toMatchObject({ open: false, today: '2026-12-06', next: '2026-12-13', following: '2026-12-27' }); // the Sunday in between
        expect(meeting.schedule(SUNDAY)).toMatchObject({ open: true, next: '2026-12-13', following: '2026-12-27' });
        expect(meeting.schedule(new Date('2026-11-20T06:00:00Z'))).toMatchObject({ open: false, next: '2026-11-29', following: '2026-12-13' });                       // before the first one
    });

    it('INTERVIEW_OPEN=always opens it on any day, for a trial', () => {
        process.env.INTERVIEW_OPEN = 'always';
        expect(meeting.schedule(MONDAY)).toMatchObject({ open: true, today: '2026-12-14', next: '2026-12-14', following: '2026-12-27' });
    });

    it('tells the page the state: closed, open, resume, taken', async () => {
        jest.setSystemTime(MONDAY);
        expect(await meeting.status({ student })).toMatchObject({ state: 'closed', sessionId: null, schedule: { open: false, nextLabel: 'Sunday, 27 December 2026' }, reports: [] });
        jest.setSystemTime(SUNDAY);
        expect((await meeting.status({ student })).state).toBe('open');
        geminiAsks();
        const { sessionId } = await meeting.startInterview({ student });
        expect(await meeting.status({ student })).toMatchObject({ state: 'resume', sessionId });
        await meeting.finishInterview({ student, sessionId });
        expect(await meeting.status({ student })).toMatchObject({ state: 'taken', sessionId: null });
    });

    it('refuses to start on a closed day, naming the next Sunday', async () => {
        jest.setSystemTime(MONDAY);
        expect(await meeting.startInterview({ student })).toEqual({ error: 'The interview opens every second Sunday. Next: Sunday, 27 December 2026 (IST).', closed: true });
        expect(mockDb.gemini).toEqual([]);
    });

    it('allows one interview per opening, and resumes an unfinished one', async () => {
        geminiAsks();
        const first = await meeting.startInterview({ student });
        await meeting.answerInterview({ student, sessionId: first.sessionId, answer: 'The request hangs and the user clicks twice.' });
        expect(await meeting.startInterview({ student })).toEqual({ sessionId: first.sessionId, question: questions[1], number: 2, of: 8, resumed: true });
        await meeting.finishInterview({ student, sessionId: first.sessionId });
        expect(await meeting.startInterview({ student })).toEqual({ error: "You have taken this fortnight's interview. The next one is on Sunday, 27 December 2026 (IST).", closed: true });
    });
});

describe('the questions', () => {
    it('are built from every task the student has had, deduplicated, never from who they are', async () => {
        geminiAsks();
        const s = await meeting.startInterview({ student });
        expect(s).toEqual({ sessionId: 's1', question: questions[0], number: 1, of: 8 });
        const p = mockDb.gemini[0];
        expect(p).toContain('fortnightly technical interview');
        expect(p).toContain('- Week 1: Landing page: Build a responsive landing page with a contact form.');
        expect(p).toContain('- Week 2: REST API: An Express API with validation and error handling.');
        expect(p).toContain('- Git basics: Branches, commits, pull requests.');
        expect(p).toContain('- Deploy to Render');
        expect(p.match(/Week 1: Landing page/g)).toHaveLength(1);
        expect(p).toContain('never the task text itself');
        expect(p).toContain('Attendance: 80% so far.');
        expect(p).not.toMatch(/Priya|priya@x\.in|TEN\/WEB\/1005/);
        expect(mockDb.sessions[0].topics).toHaveLength(4);
    });

    it('still interview on the fundamentals when there is no task list', async () => {
        Object.assign(mockDb, { assignments: [], progress: [], submissions: [] });
        geminiAsks();
        await meeting.startInterview({ student });
        expect(mockDb.gemini[0]).toContain('No task list is available; interview on the fundamentals of this domain.');
    });
});

describe('the interview', () => {
    const proctor = { checker: 'mediapipe', attentiveMs: 930000, awayMs: 50000, noFaceMs: 20000, awayEpisodes: 2, multiFaceEpisodes: 0, cameraOffEpisodes: 1 };

    it('scores eight answers strictly, keeps the time and camera totals, and ends with the marks, the report, the log and the email', async () => {
        geminiAsks();
        const { out } = await fullInterview(proctor);
        expect(out).toMatchObject({ score: 9, done: true, question: null, number: 8, of: 8 });
        expect(out.report).toMatchObject({
            overall: 7, questions: 8, marks: { got: 51, of: 80 }, emailed: true,
            attention: 'Eyes on the camera 93% of the time; looked away 2 time(s); face out of frame 20 s; camera off 1 time(s).',
            summary: 'Strengths: clear on HTTP. Gaps: deployment debugging. Work on: reading server logs; writing one test per endpoint.'
        });
        const s = mockDb.sessions[0];
        expect(s.endedAt).toBeInstanceOf(Date);
        expect(s.turns.map((t) => t.question)).toEqual(questions);
        expect(s.turns.map((t) => t.seconds)).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
        expect(s.proctor).toEqual(proctor);
        expect(mockDb.gemini[4]).toContain('Score it from 0 to 10, strictly');
        expect(mockDb.gemini[8]).toContain('That was question 8 of 8');
        expect(mockDb.gemini[8]).toContain('Q7: Where would you add a cache');
        // The daily report sees the result.
        expect(mockDb.logs.filter((l) => l.source === 'interview')).toHaveLength(9);
        expect(mockDb.logs[mockDb.logs.length - 1]).toMatchObject({ kind: 'meeting', source: 'report', employeeId: 'TEN/WEB/1005', question: '8 of 8 answered', reply: expect.stringContaining('overall 7/10. Eyes on the camera 93%') });
        // The student gets the report by email: marks, what to improve, every question.
        expect(mockDb.mails).toHaveLength(1);
        expect(mockDb.mails[0]).toMatchObject({ to: 'priya@x.in', from: 'TEN <noreply@test>', subject: 'Your interview marks: 7/10 (Sunday, 13 December 2026)' });
        expect(mockDb.mails[0].html).toContain('Your fortnightly interview report|Priya Nair|');
        expect(mockDb.mails[0].html).toContain('<b style="font-size:20px;">7/10</b> (51 of 80 across 8 questions)');
        expect(mockDb.mails[0].html).toContain('What to improve before the next interview:</b> Strengths: clear on HTTP.');
        expect(mockDb.mails[0].html).toContain('Eyes on the camera 93%');
        expect(mockDb.mails[0].html).toContain(questions[7]);
        expect(mockDb.mails[0].html).toContain('https://portal.test/meeting');
        expect(await meeting.reports({ student })).toEqual([expect.objectContaining({ id: 's1', overall: 7, marks: { got: 51, of: 80 } })]);
    });

    it('adds up the camera totals the page sends with each answer', async () => {
        geminiAsks();
        const { sessionId } = await meeting.startInterview({ student });
        await meeting.answerInterview({ student, sessionId, answer: 'a', proctor: { checker: 'mediapipe', attentiveMs: 1000, awayEpisodes: 1 } });
        await meeting.answerInterview({ student, sessionId, answer: 'b', proctor: { checker: 'mediapipe', attentiveMs: 500, noFaceMs: 250, cameraOffEpisodes: 1 } });
        await meeting.answerInterview({ student, sessionId, answer: 'c' });
        expect(mockDb.sessions[0].proctor).toEqual({ checker: 'mediapipe', attentiveMs: 1500, awayMs: 0, noFaceMs: 250, awayEpisodes: 1, multiFaceEpisodes: 0, cameraOffEpisodes: 1 });
    });

    it('scrubs a phone number said aloud before Gemini hears it, and refuses a second answer or someone else\'s session', async () => {
        geminiAsks();
        const { sessionId } = await meeting.startInterview({ student });
        await meeting.answerInterview({ student, sessionId, answer: 'Call me on 9876543210, the form hangs.' });
        expect(mockDb.gemini[1]).toContain('[phone]');
        expect(mockDb.gemini[1]).not.toContain('9876543210');
        const other = Object.assign({}, student, { _id: 'stu2', employeeId: 'TEN/WEB/1006' });
        expect((await meeting.answerInterview({ student: other, sessionId, answer: 'x' })).error).toMatch(/over/);
    });

    it('stopping early reports what was answered, without an AI call, and still emails', async () => {
        geminiAsks();
        const { sessionId } = await meeting.startInterview({ student });
        await meeting.answerInterview({ student, sessionId, answer: 'It hangs.', proctor: { checker: 'unavailable' } });
        const calls = mockDb.gemini.length;
        const { report } = await meeting.finishInterview({ student, sessionId, proctor: { checker: 'unavailable', attentiveMs: -5, awayEpisodes: 'x' } });
        expect(mockDb.gemini.length).toBe(calls);
        expect(report).toMatchObject({ overall: 6, questions: 1, marks: { got: 6, of: 10 }, attention: 'Camera on; the attention check was not available on this device.' });
        expect(report.summary).toContain('You stopped after 1 of 8 questions, averaging 6/10');
        expect(mockDb.sessions[0].proctor).toEqual({ checker: 'unavailable', attentiveMs: 0, awayMs: 0, noFaceMs: 0, awayEpisodes: 0, multiFaceEpisodes: 0, cameraOffEpisodes: 0 });
        expect(mockDb.mails[0].subject).toBe('Your interview marks: 6/10 (Sunday, 13 December 2026)');
        expect(mockDb.logs[mockDb.logs.length - 1]).toMatchObject({ source: 'report', question: '1 of 8 answered' });
    });

    it('a failed email does not lose the report', async () => {
        geminiAsks();
        mockDb.mailerReady = false;
        const { out } = await fullInterview(proctor);
        expect(out.report.emailed).toBe(false);
        expect(mockDb.sessions[0].endedAt).toBeInstanceOf(Date);
        expect(mockDb.mails).toEqual([]);
    });

    it('is honest when Gemini is away or the day\'s turns are used up, and an answer that failed can be given again', async () => {
        mockDb.ready = false;
        expect((await meeting.startInterview({ student })).error).toMatch(/not set up/);
        mockDb.ready = true;
        geminiAsks();
        const { sessionId } = await meeting.startInterview({ student });
        mockDb.answer = () => { throw new Error('503'); };
        expect((await meeting.answerInterview({ student, sessionId, answer: 'x' })).error).toBe(meeting._internal.BUSY);
        expect(mockDb.sessions[0].turns[0].answer).toBe('');
        geminiAsks();
        expect((await meeting.answerInterview({ student, sessionId, answer: 'x' })).score).toBe(6);
        mockDb.logs = Array.from({ length: meeting.TURNS_PER_DAY }, () => ({ kind: 'meeting', source: 'interview' }));
        expect((await meeting.answerInterview({ student, sessionId, answer: 'y' })).error).toMatch(/many times today/);
    });

    it('describes the camera totals for the report', () => {
        const { attentionText, proctorOf } = meeting._internal;
        expect(attentionText(null)).toBe('Camera totals were not received.');
        expect(attentionText(proctorOf({ checker: 'mediapipe', attentiveMs: 500, awayMs: 500, noFaceMs: 0, awayEpisodes: 1, multiFaceEpisodes: 2 })))
            .toBe('Eyes on the camera 50% of the time; looked away 1 time(s); face out of frame 0 s; another face seen 2 time(s).');
        expect(proctorOf('nonsense')).toBeNull();
        expect(proctorOf({ checker: 'evil', attentiveMs: 1e12 }).attentiveMs).toBe(1e8);
    });
});
