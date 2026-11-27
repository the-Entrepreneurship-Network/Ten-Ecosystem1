'use strict';

/**
 * @jest-environment node
 *
 * The AI Meeting Room (services/aiMeeting.js): a question is answered by the
 * chat's own brain, a hand-over tells the coordinators, and a mock interview
 * asks five questions, scores each answer, and ends with a saved report.
 */

const mockDb = { sessions: [], logs: [], decide: null, notified: [], gemini: [], ready: true };
const chain = (rows) => { const q = { sort: () => q, limit: () => q, lean: async () => rows }; return q; };

jest.mock('../../models/MeetingSession', () => {
    class Session {
        constructor(doc) { Object.assign(this, { turns: [], overall: null, summary: '', endedAt: null, startedAt: new Date() }, doc); this._id = 's' + (mockDb.sessions.length + 1); }
        async save() { if (!mockDb.sessions.includes(this)) mockDb.sessions.push(this); return this; }
        static async create(doc) { const s = new Session(doc); await s.save(); return s; }
        static async findOne(f) { return mockDb.sessions.find((s) => s._id === String(f._id) && String(s.studentId) === String(f.studentId) && s.endedAt === null) || null; }
        static find(f) { return chain(mockDb.sessions.filter((s) => String(s.studentId) === String(f.studentId) && s.endedAt)); }
    }
    return Session;
});
jest.mock('../../models/AiCoordinatorLog', () => ({
    create: async (row) => { mockDb.logs.push(row); return row; },
    countDocuments: async (f) => mockDb.logs.filter((l) => l.kind === f.kind && f.source.$in.includes(l.source)).length
}));
jest.mock('../../utils/gemini', () => ({
    ready: () => mockDb.ready,
    ask: async (prompt) => { mockDb.gemini.push(prompt); const fn = mockDb.answer; return fn ? fn(prompt) : {}; },
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' }
}));
jest.mock('../../services/aiCoordinator', () => ({
    NAME: 'TEN AI Coordinator',
    scrub: (s) => String(s).replace(/\b[6-9]\d{9}\b/g, '[phone]'),
    decide: async (args) => mockDb.decide(args),
    notifyCoordinators: async (args) => { mockDb.notified.push(args); },
    contextFor: async () => 'Domain: Web Development\nAttendance: 80% so far.\nThis week: Week 2: Build a REST API.'
}));
jest.mock('mongoose', () => ({ Types: { ObjectId: { isValid: (id) => /^s\d+$/.test(String(id)) } } }));

const meeting = require('../../services/aiMeeting');
const student = { _id: 'stu1', employeeId: 'TEN/WEB/1005', name: 'Priya Nair', email: 'priya@x.in', domain: 'Web Development' };

beforeEach(() => {
    Object.assign(mockDb, { sessions: [], logs: [], notified: [], gemini: [], ready: true, decide: null, answer: null });
});

describe('ask a question', () => {
    it('answers with the chat\'s brain and logs it as the room\'s', async () => {
        mockDb.decide = async ({ text, employeeId, domain }) => ({ reply: `About "${text}" for ${employeeId} in ${domain}.`, source: 'saved' });
        const out = await meeting.ask({ student, text: '  how do I mark   attendance? ' });
        expect(out).toEqual({ reply: 'About "how do I mark attendance?" for TEN/WEB/1005 in Web Development.', source: 'saved', handover: false });
        expect(mockDb.logs).toEqual([expect.objectContaining({ kind: 'meeting', source: 'ask', employeeId: 'TEN/WEB/1005', question: 'how do I mark attendance?' })]);
        expect(mockDb.notified).toEqual([]);
    });

    it('a hand-over tells the coordinators, as the chat does', async () => {
        mockDb.decide = async () => ({ reply: 'Your coordinator has this.', source: 'money', handover: true });
        const out = await meeting.ask({ student, text: 'I paid but it is not showing' });
        expect(out.handover).toBe(true);
        expect(mockDb.notified).toEqual([{ student, employeeId: 'TEN/WEB/1005', domain: 'Web Development', reason: 'money' }]);
        expect(mockDb.logs[0]).toMatchObject({ kind: 'meeting', source: 'handover', reason: 'money' });
    });

    it('a Gemini answer counts towards the room\'s daily turns', async () => {
        mockDb.decide = async () => ({ reply: 'Yes, you can use React.', source: 'ai' });
        await meeting.ask({ student, text: 'can I use React?' });
        expect(mockDb.logs[0].source).toBe('ask-ai');
    });
});

describe('the mock interview', () => {
    const questions = ['What is a REST API?', 'How would you handle an error in Express?', 'Explain your current task.', 'What is a closure?', 'Why use Git?'];
    beforeEach(() => {
        mockDb.answer = (prompt) => {
            const m = prompt.match(/ask question (\d) of 5/);
            if (/The interview is starting/.test(prompt)) return { question: questions[0], done: false };
            if (m) return { score: 7, feedback: 'Clear and correct. Add an example next time.', question: questions[Number(m[1]) - 1], done: false };
            return { score: 9, feedback: 'Good.', question: '', done: true, summary: 'Strong on concepts; practise error handling. Next: build a small API with tests.', overall: 8 };
        };
    });

    it('starts with the first question, never sending who the student is', async () => {
        const s = await meeting.startInterview({ student });
        expect(s).toEqual({ sessionId: 's1', question: 'What is a REST API?', number: 1, of: 5 });
        expect(mockDb.gemini[0]).toContain('mock interviewer for an intern in the Web Development internship');
        expect(mockDb.gemini[0]).toContain('Attendance: 80% so far.');
        expect(mockDb.gemini[0]).not.toMatch(/Priya|priya@x\.in|TEN\/WEB\/1005/);
        expect(mockDb.sessions[0].turns).toEqual([expect.objectContaining({ question: 'What is a REST API?' })]);
    });

    it('scores each answer, asks the next, and ends the fifth with a saved report', async () => {
        const { sessionId } = await meeting.startInterview({ student });
        let out;
        for (let n = 1; n <= 5; n++) {
            out = await meeting.answerInterview({ student, sessionId, answer: `Answer ${n}, my number is 9876543210` });
            expect(out.error).toBeUndefined();
        }
        expect(out).toMatchObject({ score: 9, done: true, question: null, number: 5, of: 5 });
        expect(out.report).toMatchObject({ overall: 8, questions: 5, summary: 'Strong on concepts; practise error handling. Next: build a small API with tests.' });
        const s = mockDb.sessions[0];
        expect(s.endedAt).toBeInstanceOf(Date);
        expect(s.turns.map((t) => t.question)).toEqual(questions);
        expect(s.turns.slice(0, 4).every((t) => t.score === 7)).toBe(true);
        // Phone numbers in a spoken answer are removed before Gemini sees them; the transcript so far is included.
        expect(mockDb.gemini[2]).toContain('[phone]');
        expect(mockDb.gemini[2]).not.toContain('9876543210');
        expect(mockDb.gemini[5]).toContain('Q4: What is a closure?');
        expect(mockDb.gemini[5]).toContain('That was question 5 of 5');
        // Over, so another answer is refused.
        expect((await meeting.answerInterview({ student, sessionId, answer: 'more' })).error).toMatch(/over/);
        // And it is in the reports.
        expect(await meeting.reports({ student })).toEqual([expect.objectContaining({ id: 's1', overall: 8, questions: 5 })]);
    });

    it('finishing early reports what was answered, without an AI call', async () => {
        const { sessionId } = await meeting.startInterview({ student });
        await meeting.answerInterview({ student, sessionId, answer: 'An API over HTTP.' });
        const calls = mockDb.gemini.length;
        const { report } = await meeting.finishInterview({ student, sessionId });
        expect(mockDb.gemini.length).toBe(calls);
        expect(report).toMatchObject({ overall: 7, questions: 1 });
        expect(report.summary).toContain('You answered 1 of 5 questions, averaging 7/10.');
    });

    it('is honest when Gemini is away or the day\'s practice is used up', async () => {
        mockDb.ready = false;
        expect((await meeting.startInterview({ student })).error).toMatch(/not set up/);
        mockDb.ready = true;
        mockDb.answer = () => { throw new Error('503'); };
        expect((await meeting.startInterview({ student })).error).toBe(meeting._internal.BUSY);
        mockDb.logs = Array.from({ length: meeting.TURNS_PER_DAY }, () => ({ kind: 'meeting', source: 'interview' }));
        expect((await meeting.startInterview({ student })).error).toMatch(/practised a lot today/);
    });

    it('a student cannot answer in someone else\'s interview', async () => {
        const { sessionId } = await meeting.startInterview({ student });
        const other = Object.assign({}, student, { _id: 'stu2', employeeId: 'TEN/WEB/1006' });
        expect((await meeting.answerInterview({ student: other, sessionId, answer: 'x' })).error).toMatch(/over/);
    });
});
