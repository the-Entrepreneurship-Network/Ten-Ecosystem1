'use strict';

/**
 * @jest-environment node
 *
 * The Interview Room (services/aiMeeting.js): open every second Sunday; one
 * interview per student, at the level they choose; INTERVIEW_OPEN=always is a
 * repeatable trial that uses up nobody's attempt; eight questions built from
 * the student's own tasks; Gemini or Claude as the admin portal says, within
 * the monthly limit; the camera totals kept; a report saved, logged and emailed.
 */

const mockDb = {
    sessions: [], logs: [], gemini: [], claude: [], mails: [], setting: null, ready: true, claudeReady: false,
    answer: null, claudeAnswer: null, assignments: [], progress: [], domainTasks: [], submissions: [], mailerReady: true
};
const chain = (rows) => { const q = { sort: () => q, limit: () => q, select: () => q, lean: async () => rows, then: (res, rej) => Promise.resolve(rows).then(res, rej) }; return q; };
const mockMatch = (doc, f) => Object.entries(f).every(([k, v]) => {
    const have = doc[k];
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        if ('$ne' in v && (have === v.$ne || (v.$ne === true && have === true))) return false;
        if ('$ne' in v && v.$ne === null && have == null) return false;
        if ('$gte' in v && !(have >= v.$gte)) return false;
        if ('$lte' in v && !(have <= v.$lte)) return false;
        return true;
    }
    return k === 'studentId' || k === '_id' ? String(have) === String(v) : have === v;
});

jest.mock('../../models/MeetingSession', () => {
    class Session {
        constructor(doc) { Object.assign(this, { turns: [], topics: [], proctor: null, overall: null, summary: '', emailed: false, endedAt: null, trial: false, startedAt: new Date() }, doc); this._id = 's' + (mockDb.sessions.length + 1); }
        async save() { if (!mockDb.sessions.includes(this)) mockDb.sessions.push(this); return this; }
        static async create(doc) { const s = new Session(doc); await s.save(); return s; }
        static findOne(f) {
            const rows = mockDb.sessions.filter((s) => mockMatch(s, f)).sort((a, b) => b.startedAt - a.startedAt);
            const q = { sort: () => q, then: (res, rej) => Promise.resolve(rows[0] || null).then(res, rej) };
            return q;
        }
        static async exists(f) { return mockDb.sessions.some((s) => mockMatch(s, f)) ? { _id: 'x' } : null; }
        static async countDocuments(f) { return mockDb.sessions.filter((s) => mockMatch(s, f)).length; }
        static find(f) { return chain(mockDb.sessions.filter((s) => mockMatch(s, f)).sort((a, b) => b.startedAt - a.startedAt)); }
    }
    return Session;
});
jest.mock('../../models/InterviewSetting', () => ({
    findById: () => ({ lean: async () => mockDb.setting }),
    findByIdAndUpdate: async (id, u) => { mockDb.setting = Object.assign({ _id: id }, mockDb.setting || {}, u.$set); return mockDb.setting; }
}));
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
jest.mock('../../utils/claude', () => ({
    MODELS: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    ready: () => mockDb.claudeReady,
    ask: async (prompt, schema, model) => { mockDb.claude.push({ prompt, schema, model }); const fn = mockDb.claudeAnswer || mockDb.answer; return fn(prompt); }
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
const NEXT_OPENING = new Date('2026-12-27T06:00:00Z');

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(SUNDAY);
    delete process.env.INTERVIEW_OPEN;
    Object.assign(mockDb, { sessions: [], logs: [], gemini: [], claude: [], mails: [], setting: null, ready: true, claudeReady: false,
        answer: null, claudeAnswer: null, mailerReady: true,
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
const start = (difficulty = 'medium', who = student) => meeting.startInterview({ student: who, difficulty });
async function fullInterview(proctor, difficulty) {
    const { sessionId } = await start(difficulty);
    let out;
    for (let n = 1; n <= 8; n++) out = await meeting.answerInterview({ student, sessionId, answer: `Answer ${n}`, seconds: 40 + n, proctor: n === 1 ? proctor : { checker: 'mediapipe' } });
    return { sessionId, out };
}

describe('when the room is open', () => {
    it('opens on the anchor Sunday and every fourteenth day after, India time', () => {
        expect(meeting.schedule(new Date('2026-11-28T20:00:00Z'))).toMatchObject({ open: true, trial: false, today: '2026-11-29', next: '2026-11-29', following: '2026-12-13' });   // 01:30 IST Sunday
        expect(meeting.schedule(new Date('2026-11-29T18:40:00Z'))).toMatchObject({ open: false, today: '2026-11-30', next: '2026-12-13', following: '2026-12-27' }); // 00:10 IST Monday
        expect(meeting.schedule(new Date('2026-12-06T06:00:00Z'))).toMatchObject({ open: false, today: '2026-12-06', next: '2026-12-13', following: '2026-12-27' }); // the Sunday in between
        expect(meeting.schedule(SUNDAY)).toMatchObject({ open: true, next: '2026-12-13', following: '2026-12-27' });
        expect(meeting.schedule(new Date('2026-11-20T06:00:00Z'))).toMatchObject({ open: false, next: '2026-11-29', following: '2026-12-13' });                       // before the first one
    });

    it('INTERVIEW_OPEN=always opens it on any day, as a trial', () => {
        process.env.INTERVIEW_OPEN = 'always';
        expect(meeting.schedule(MONDAY)).toMatchObject({ open: true, trial: true, today: '2026-12-14', next: '2026-12-14', following: '2026-12-27' });
    });

    it('tells the page the state: closed, open, resume, taken, with the levels', async () => {
        jest.setSystemTime(MONDAY);
        expect(await meeting.status({ student })).toMatchObject({ state: 'closed', sessionId: null, levels: ['easy', 'medium', 'hard'], schedule: { open: false, nextLabel: 'Sunday, 27 December 2026' }, reports: [] });
        jest.setSystemTime(SUNDAY);
        expect((await meeting.status({ student })).state).toBe('open');
        geminiAsks();
        const { sessionId } = await start('hard');
        expect(await meeting.status({ student })).toMatchObject({ state: 'resume', sessionId, difficulty: 'hard' });
        await meeting.finishInterview({ student, sessionId });
        expect(await meeting.status({ student })).toMatchObject({ state: 'taken', sessionId: null });
    });

    it('refuses to start on a closed day, naming the next Sunday', async () => {
        jest.setSystemTime(MONDAY);
        expect(await start()).toEqual({ error: 'The interview opens every second Sunday. Next: Sunday, 27 December 2026 (IST).', closed: true });
        expect(mockDb.gemini).toEqual([]);
    });
});

describe('one attempt per student', () => {
    it('needs a level, resumes an unfinished interview, and after it is over refuses for good, even at the next opening', async () => {
        geminiAsks();
        expect(await start('impossible')).toEqual({ error: 'Choose easy, medium or hard first.' });
        expect(mockDb.gemini).toEqual([]);
        const first = await start('easy');
        await meeting.answerInterview({ student, sessionId: first.sessionId, answer: 'The request hangs and the user clicks twice.' });
        expect(await start('hard')).toEqual({ sessionId: first.sessionId, question: questions[1], number: 2, of: 8, difficulty: 'easy', resumed: true });
        await meeting.finishInterview({ student, sessionId: first.sessionId });
        const taken = { error: 'You have taken your interview. Your report is on this page and in your email.', closed: true };
        expect(await start('hard')).toEqual(taken);
        jest.setSystemTime(NEXT_OPENING);
        expect(await start('hard')).toEqual(taken);
        expect((await meeting.status({ student })).state).toBe('taken');
        // Another student still has theirs.
        expect((await start('medium', Object.assign({}, student, { _id: 'stu2', employeeId: 'TEN/WEB/1006' }))).question).toBe(questions[0]);
    });

    it('the trial is repeatable and uses up nobody\'s attempt', async () => {
        process.env.INTERVIEW_OPEN = 'always';
        jest.setSystemTime(MONDAY);
        geminiAsks();
        for (let i = 0; i < 2; i++) {
            const { sessionId } = await start('hard');
            await meeting.finishInterview({ student, sessionId });
        }
        expect(mockDb.sessions.map((s) => [s.trial, s.difficulty, !!s.endedAt])).toEqual([[true, 'hard', true], [true, 'hard', true]]);
        expect((await meeting.status({ student })).state).toBe('open');
        // The trial over, the student still has their real attempt on the next opening.
        delete process.env.INTERVIEW_OPEN;
        jest.setSystemTime(NEXT_OPENING);
        expect((await meeting.status({ student })).state).toBe('open');
        const real = await start('medium');
        expect(real.question).toBe(questions[0]);
        expect(mockDb.sessions[2].trial).toBe(false);
    });

    it('an interview left open on an earlier day is closed with its report, and counts as the attempt', async () => {
        geminiAsks();
        const { sessionId } = await start('medium');
        await meeting.answerInterview({ student, sessionId, answer: 'It hangs.' });
        jest.setSystemTime(NEXT_OPENING);
        expect(await meeting.status({ student })).toMatchObject({ state: 'taken', sessionId: null });
        const s = mockDb.sessions[0];
        expect(s.endedAt).toBeInstanceOf(Date);
        expect(s.turns).toHaveLength(1);
        expect(s.summary).toBe('You stopped after 1 of 8 questions, averaging 6/10; the unanswered questions count as not attempted.');
        expect(mockDb.mails).toHaveLength(1);
    });
});

describe('the questions', () => {
    it('are built from every task the student has had, deduplicated, at the chosen level, never from who they are', async () => {
        geminiAsks();
        const s = await start('hard');
        expect(s).toEqual({ sessionId: 's1', question: questions[0], number: 1, of: 8, difficulty: 'hard' });
        const p = mockDb.gemini[0];
        expect(p).toContain("This is the intern's technical interview");
        expect(p).toContain('Level: HARD.');
        expect(p).not.toContain('Level: EASY.');
        expect(p).toContain('- Week 1: Landing page: Build a responsive landing page with a contact form.');
        expect(p).toContain('- Week 2: REST API: An Express API with validation and error handling.');
        expect(p).toContain('- Git basics: Branches, commits, pull requests.');
        expect(p).toContain('- Deploy to Render');
        expect(p.match(/Week 1: Landing page/g)).toHaveLength(1);
        expect(p).toContain('never the task text itself');
        expect(p).toContain('Attendance: 80% so far.');
        expect(p).not.toMatch(/Priya|priya@x\.in|TEN\/WEB\/1005/);
        expect(mockDb.sessions[0]).toMatchObject({ difficulty: 'hard', engine: 'gemini', trial: false });
        expect(mockDb.sessions[0].topics).toHaveLength(4);
    });

    it('each level asks differently, and every later question keeps the level', async () => {
        geminiAsks();
        await start('easy');
        await meeting.answerInterview({ student, sessionId: 's1', answer: 'x' });
        expect(mockDb.gemini[0]).toContain('Level: EASY.');
        expect(mockDb.gemini[1]).toContain('Level: EASY.');
        const { interviewPrompt } = meeting._internal;
        const p = (difficulty) => interviewPrompt({ domain: 'Web', context: '', topics: [], turns: [], number: 1, difficulty });
        expect(p('medium')).toContain('Level: MEDIUM.');
        expect(p('hard')).toContain('dig into every weak or vague answer');
    });

    it('still interview on the fundamentals when there is no task list', async () => {
        Object.assign(mockDb, { assignments: [], progress: [], submissions: [] });
        geminiAsks();
        await start();
        expect(mockDb.gemini[0]).toContain('No task list is available; interview on the fundamentals of this domain.');
    });
});

describe('which AI: Gemini or Claude, as the admin portal says', () => {
    it('Gemini by default; Claude when chosen and its key is set, with the chosen model, for the whole interview', async () => {
        geminiAsks();
        await start();
        expect(mockDb.sessions[0].engine).toBe('gemini');
        expect(mockDb.claude).toEqual([]);

        mockDb.setting = { engine: 'claude', claudeModel: 'claude-sonnet-5-5', claudeMonthlyCap: 50 };
        mockDb.claudeReady = true;
        const other = Object.assign({}, student, { _id: 'stu2', employeeId: 'TEN/WEB/1006' });
        const { sessionId } = await start('medium', other);
        expect(mockDb.sessions[1]).toMatchObject({ engine: 'claude', claudeModel: 'claude-sonnet-5-5' });
        expect(mockDb.claude[0]).toMatchObject({ model: 'claude-sonnet-5-5' });
        expect(mockDb.claude[0].schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['score', 'feedback', 'question', 'done', 'summary', 'overall'] });
        // Switched back to Gemini mid-interview: this interview keeps Claude.
        mockDb.setting.engine = 'gemini';
        await meeting.answerInterview({ student: other, sessionId, answer: 'x' });
        expect(mockDb.claude).toHaveLength(2);
    });

    it('no key, or the month\'s limit reached: Gemini takes new interviews', async () => {
        geminiAsks();
        mockDb.setting = { engine: 'claude', claudeModel: 'claude-opus-5-5', claudeMonthlyCap: 1 };
        mockDb.claudeReady = false;
        await start();
        expect(mockDb.sessions[0].engine).toBe('gemini');
        mockDb.claudeReady = true;
        await start('medium', Object.assign({}, student, { _id: 'stu2' }));
        expect(mockDb.sessions[1].engine).toBe('claude');
        await start('medium', Object.assign({}, student, { _id: 'stu3' }));
        expect(mockDb.sessions[2].engine).toBe('gemini');
        expect(await meeting.aiSummary()).toMatchObject({ engine: 'claude', claudeModel: 'claude-opus-5-5', claudeMonthlyCap: 1, claudeThisMonth: 1, claudeReady: true, geminiReady: true });
    });

    it('a turn Claude fails is answered by Gemini', async () => {
        geminiAsks();
        mockDb.setting = { engine: 'claude', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 50 };
        mockDb.claudeReady = true;
        mockDb.claudeAnswer = () => { throw new Error('Claude declined (cyber)'); };
        const s = await start();
        expect(s.question).toBe(questions[0]);
        expect(mockDb.claude).toHaveLength(1);
        expect(mockDb.gemini).toHaveLength(1);
        expect(mockDb.sessions[0].engine).toBe('claude');
    });

    it('the admin portal\'s setting is checked before it is saved', async () => {
        expect(await meeting.saveAiSettings({ engine: 'gpt', claudeModel: 'claude-opus-5-5', claudeMonthlyCap: 5 })).toEqual({ error: 'Choose Gemini or Claude.' });
        expect(await meeting.saveAiSettings({ engine: 'claude', claudeModel: 'claude-3-opus', claudeMonthlyCap: 5 })).toEqual({ error: 'Choose a Claude model from the list.' });
        expect(await meeting.saveAiSettings({ engine: 'claude', claudeModel: 'claude-opus-5-5', claudeMonthlyCap: -1 })).toEqual({ error: 'The monthly limit is a whole number from 0 to 100000.' });
        expect(await meeting.saveAiSettings({ engine: 'claude', claudeModel: 'claude-opus-5-5', claudeMonthlyCap: 2.5 })).toMatchObject({ error: expect.any(String) });
        const out = await meeting.saveAiSettings({ engine: 'claude', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 200, by: 'tenadmin' });
        expect(out).toMatchObject({ engine: 'claude', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 200, updatedBy: 'tenadmin' });
        expect(out.models).toEqual([
            { id: 'claude-haiku-5-5', costPerInterviewInr: 0.5 }, { id: 'claude-sonnet-5-5', costPerInterviewInr: 9 }, { id: 'claude-opus-5-5', costPerInterviewInr: 18 }
        ]);
    });
});

describe('the interview', () => {
    const proctor = { checker: 'mediapipe', attentiveMs: 930000, awayMs: 50000, noFaceMs: 20000, awayEpisodes: 2, multiFaceEpisodes: 0, cameraOffEpisodes: 1 };

    it('scores eight answers strictly, keeps the time and camera totals, and ends with the marks, the report, the log and the email', async () => {
        geminiAsks();
        const { out } = await fullInterview(proctor, 'hard');
        expect(out).toMatchObject({ score: 9, done: true, question: null, number: 8, of: 8 });
        expect(out.report).toMatchObject({
            overall: 7, questions: 8, difficulty: 'hard', trial: false, marks: { got: 51, of: 80 }, emailed: true,
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
        expect(mockDb.logs.filter((l) => l.source === 'interview')).toHaveLength(9);
        expect(mockDb.logs[mockDb.logs.length - 1]).toMatchObject({ kind: 'meeting', source: 'report', employeeId: 'TEN/WEB/1005', question: '8 of 8 answered, hard, gemini', reply: expect.stringContaining('overall 7/10. Eyes on the camera 93%') });
        expect(mockDb.mails).toHaveLength(1);
        expect(mockDb.mails[0]).toMatchObject({ to: 'priya@x.in', from: 'TEN <noreply@test>', subject: 'Your interview marks: 7/10, Hard (Sunday, 13 December 2026)' });
        expect(mockDb.mails[0].html).toContain('Your interview report|Priya Nair|');
        expect(mockDb.mails[0].html).toContain('Level: <b>Hard</b>. Overall mark: <b style="font-size:20px;">7/10</b> (51 of 80 across 8 questions)');
        expect(mockDb.mails[0].html).toContain('What to improve before the next interview:</b> Strengths: clear on HTTP.');
        expect(mockDb.mails[0].html).toContain('Eyes on the camera 93%');
        expect(mockDb.mails[0].html).toContain(questions[7]);
        expect(mockDb.mails[0].html).toContain('https://portal.test/meeting');
        expect(await meeting.reports({ student })).toEqual([expect.objectContaining({ id: 's1', overall: 7, difficulty: 'hard', marks: { got: 51, of: 80 } })]);
    });

    it('adds up the camera totals the page sends with each answer', async () => {
        geminiAsks();
        const { sessionId } = await start();
        await meeting.answerInterview({ student, sessionId, answer: 'a', proctor: { checker: 'mediapipe', attentiveMs: 1000, awayEpisodes: 1 } });
        await meeting.answerInterview({ student, sessionId, answer: 'b', proctor: { checker: 'mediapipe', attentiveMs: 500, noFaceMs: 250, cameraOffEpisodes: 1 } });
        await meeting.answerInterview({ student, sessionId, answer: 'c' });
        expect(mockDb.sessions[0].proctor).toEqual({ checker: 'mediapipe', attentiveMs: 1500, awayMs: 0, noFaceMs: 250, awayEpisodes: 1, multiFaceEpisodes: 0, cameraOffEpisodes: 1 });
    });

    it('scrubs a phone number said aloud before the AI hears it, and refuses a second answer or someone else\'s session', async () => {
        geminiAsks();
        const { sessionId } = await start();
        await meeting.answerInterview({ student, sessionId, answer: 'Call me on 9876543210, the form hangs.' });
        expect(mockDb.gemini[1]).toContain('[phone]');
        expect(mockDb.gemini[1]).not.toContain('9876543210');
        const other = Object.assign({}, student, { _id: 'stu2', employeeId: 'TEN/WEB/1006' });
        expect((await meeting.answerInterview({ student: other, sessionId, answer: 'x' })).error).toMatch(/over/);
    });

    it('stopping early reports what was answered, without an AI call, and still emails', async () => {
        geminiAsks();
        const { sessionId } = await start('easy');
        await meeting.answerInterview({ student, sessionId, answer: 'It hangs.', proctor: { checker: 'unavailable' } });
        const calls = mockDb.gemini.length;
        const { report } = await meeting.finishInterview({ student, sessionId, proctor: { checker: 'unavailable', attentiveMs: -5, awayEpisodes: 'x' } });
        expect(mockDb.gemini.length).toBe(calls);
        expect(report).toMatchObject({ overall: 6, questions: 1, difficulty: 'easy', marks: { got: 6, of: 10 }, attention: 'Camera on; the attention check was not available on this device.' });
        expect(report.summary).toBe('You stopped after 1 of 8 questions, averaging 6/10; the unanswered questions count as not attempted.');
        expect(mockDb.sessions[0].proctor).toEqual({ checker: 'unavailable', attentiveMs: 0, awayMs: 0, noFaceMs: 0, awayEpisodes: 0, multiFaceEpisodes: 0, cameraOffEpisodes: 0 });
        expect(mockDb.mails[0].subject).toBe('Your interview marks: 6/10, Easy (Sunday, 13 December 2026)');
        expect(mockDb.logs[mockDb.logs.length - 1]).toMatchObject({ source: 'report', question: '1 of 8 answered, easy, gemini' });
    });

    it('a failed email does not lose the report', async () => {
        geminiAsks();
        mockDb.mailerReady = false;
        const { out } = await fullInterview(proctor);
        expect(out.report.emailed).toBe(false);
        expect(mockDb.sessions[0].endedAt).toBeInstanceOf(Date);
        expect(mockDb.mails).toEqual([]);
    });

    it('is honest when no AI is set up or the day\'s turns are used up, and an answer that failed can be given again', async () => {
        mockDb.ready = false;
        expect((await start()).error).toMatch(/not set up/);
        mockDb.ready = true;
        geminiAsks();
        const { sessionId } = await start();
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
