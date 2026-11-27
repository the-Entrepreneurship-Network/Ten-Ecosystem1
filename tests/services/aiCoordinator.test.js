'use strict';

/**
 * @jest-environment node
 *
 * The AI Coordinator (services/aiCoordinator.js): what it hands to a person,
 * when it uses a saved answer, what it tells Gemini, and what a reply in a
 * conversation looks like. The collections are small stand-ins; the help
 * desk's matcher and its real starter answers run for real.
 */

const mockDb = { messages: [], logs: [], notes: [], coordinators: [], todayAi: 0 };
const mockGemini = { ready: true, ask: jest.fn() };

const chain = (rows) => {
    const q = {
        select: () => q, sort: () => q, limit: () => q,
        lean: () => Promise.resolve(typeof rows === 'function' ? rows() : rows),
        then: (ok, bad) => Promise.resolve(typeof rows === 'function' ? rows() : rows).then(ok, bad)
    };
    return q;
};

jest.mock('../../models/Message', () => ({
    findOne: (f) => chain(() => mockDb.messages.filter((m) => m.chatRoom === f.chatRoom && m.senderId === f.senderId)
        .sort((a, b) => b.timestamp - a.timestamp)[0] || null),
    find: (f) => chain(() => mockDb.messages.filter((m) => m.chatRoom === f.chatRoom && m.senderRole === f.senderRole &&
        m.timestamp > f.timestamp.$gt).sort((a, b) => a.timestamp - b.timestamp))
}));
jest.mock('../../models/Student', () => ({ findOne: () => chain(() => mockDb.student || null) }));
jest.mock('../../models/Coordinator', () => ({ find: () => chain(() => mockDb.coordinators), distinct: async () => [] }));
jest.mock('../../models/Attendance', () => ({ find: () => chain([]) }));
jest.mock('../../models/Notification', () => ({ create: async (n) => { mockDb.notes.push(n); return n; } }));
jest.mock('../../models/SupportAnswer', () => ({
    find: () => chain(() => require('../../services/supportDesk/starterAnswers').map((a) => Object.assign({ _id: a.key, active: true }, a)))
}));
jest.mock('../../models/AiCoordinatorLog', () => ({
    create: async (row) => { mockDb.logs.push(row); return row; },
    countDocuments: async () => mockDb.todayAi
}));
jest.mock('../../models/new/StudentTaskProgress', () => ({ find: () => chain([]) }));
jest.mock('../../models/new/DomainTask', () => ({ find: () => chain([]) }));
jest.mock('../../utils/gemini', () => ({
    ready: () => mockGemini.ready,
    ask: (...a) => mockGemini.ask(...a),
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN' }
}));
jest.mock('../../utils/sseHub', () => ({ broadcastNotification: jest.fn() }));
jest.mock('../../services/pushService', () => ({ sendToUser: jest.fn(async () => ({ sent: 0 })) }));
jest.mock('../../services/supportDesk/facts', () => ({
    STATIC: { portalUrl: 'https://portal.test', loginUrl: 'https://portal.test/student-login', registerUrl: 'https://portal.test/register', verifyUrl: 'https://portal.test/verify-document', complaintsEmail: 'complaints@ten.test' },
    valuesFor: async (s) => ({ firstName: 'Priya', employeeId: s.employeeId, domain: s.domain, plan: '1 Month (free)' })
}));
jest.mock('../../services/supportDesk/agent', () => ({
    seedStarters: async () => {},
    _internal: { render: jest.requireActual('../../services/supportDesk/agent')._internal.render }
}));

const ai = require('../../services/aiCoordinator');
const { handoverReason, scrub, decide, reply, INTRO } = ai._internal;

const STUDENT = {
    _id: 'stu1', employeeId: 'TEN/WEB/1005', name: 'Priya Sharma', email: 'priya.sharma@gmail.com',
    whatsapp: '9876543210', domain: 'Web Development', tenure: '1 Month'
};
const ROOM = 'dm::TEN/WEB/1005::ten-ai';
const identity = { role: 'student', id: 'TEN/WEB/1005', aliases: ['TEN/WEB/1005', 'priya.sharma@gmail.com'], name: 'Priya Sharma', domain: 'Web Development' };
let t0 = 1000;
const say = (text) => mockDb.messages.push({ _id: 'm' + (++t0), chatRoom: ROOM, senderId: identity.id, senderRole: 'student', message: text, timestamp: new Date(t0) });

beforeEach(() => {
    mockDb.messages = []; mockDb.logs = []; mockDb.notes = []; mockDb.todayAi = 0;
    mockDb.student = STUDENT;
    mockDb.coordinators = [{ name: 'Ananya Rao', email: 'ananya@ten.test', username: 'web_lead', domain: 'Web Development' }];
    mockGemini.ready = true;
    mockGemini.ask.mockReset();
    delete process.env.AI_COORDINATOR;
});

describe('what goes to a person', () => {
    it.each([
        ['I paid the fee but the payment is not showing', 'money'],
        ['I want a refund', 'money'],
        ['money got deducted twice', 'money'],
        ['my task was wrongly rejected, please recheck', 'marks'],
        ['this is unfair, I deserve more marks, it is not fair', 'marks'],
        ['I want to complain about my coordinator', 'complaint'],
        ['I am sick and in hospital this week', 'personal'],
        ['family emergency, I need leave', 'personal'],
        ['I feel like I want to end my life', 'safety']
    ])('"%s" → %s', (text, reason) => {
        expect(handoverReason(text)).toBe(reason);
    });

    it.each([
        'how do I pay the fee?',
        'how do I mark attendance',
        'where is my offer letter',
        'why was my task rejected?',
        'this deadline is killing me lol',
        'I accidentally closed the quiz'
    ])('"%s" is a question it may answer', (text) => {
        expect(handoverReason(text)).toBeNull();
    });
});

it('never sends an address, a UPI ID or a phone number to Gemini', () => {
    const out = scrub('mail me at priya.sharma@gmail.com or pay priya@okaxis, call +91 98765 43210 or 9876543210');
    expect(out).not.toMatch(/gmail|okaxis|9876543210/);
    expect(out).toContain('[address]');
    expect(out).toContain('[phone]');
});

describe('deciding the reply', () => {
    it('a clear saved answer is used as it is, with the student\'s own details, and no AI', async () => {
        const out = await decide({ text: 'what is my employee id', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out.source).toBe('saved');
        expect(out.reply).toContain('TEN/WEB/1005');
        expect(mockGemini.ask).not.toHaveBeenCalled();
    });

    it('a money problem goes to the coordinator, by name, without asking Gemini', async () => {
        const out = await decide({ text: 'I paid but it is not showing', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out).toMatchObject({ source: 'money', handover: true });
        expect(out.reply).toContain('your coordinator, Ananya Rao');
        expect(mockGemini.ask).not.toHaveBeenCalled();
    });

    it('a self-harm message gets the helpline as well as a person', async () => {
        const out = await decide({ text: 'I want to kill myself', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out.handover).toBe(true);
        expect(out.reply).toContain('14416');
    });

    it('anything else goes to Gemini with the student\'s record, never their contact details', async () => {
        mockGemini.ask.mockResolvedValue({ reply: 'Yes, you can build it as a chatbot. Your ID is {{employeeId}}.', handover: false });
        const out = await decide({ text: 'can I build my project as a chatbot? reach me on 9876543210', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out.source).toBe('ai');
        expect(out.reply).toBe('Yes, you can build it as a chatbot. Your ID is TEN/WEB/1005.');
        const prompt = mockGemini.ask.mock.calls[0][0];
        expect(prompt).toContain('You are an AI. Never claim to be a person');
        expect(prompt).toContain('Domain: Web Development');
        expect(prompt).toContain('Their coordinator: Ananya Rao.');
        expect(prompt).not.toMatch(/9876543210|priya\.sharma@gmail\.com|TEN\/WEB\/1005|Priya Sharma/);
    });

    it('when Gemini says a person must take it, a person does', async () => {
        mockGemini.ask.mockResolvedValue({ reply: 'I am not sure.', handover: true, reason: 'not in the facts' });
        const out = await decide({ text: 'can I change my internship start date to next month?', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out).toMatchObject({ source: 'ai', handover: true, reason: 'not in the facts' });
    });

    it('when Gemini fails, the question goes to a person instead of getting a guess', async () => {
        mockGemini.ask.mockRejectedValue(new Error('Gemini returned 429'));
        const out = await decide({ text: 'can I build my project as a chatbot?', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out).toMatchObject({ source: 'unanswered', handover: true });
    });

    it('with no Gemini key the same happens', async () => {
        mockGemini.ready = false;
        const out = await decide({ text: 'can I build my project as a chatbot?', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out).toMatchObject({ source: 'unanswered', handover: true });
    });

    it('past the day\'s AI replies it says so instead of calling Gemini or the coordinator', async () => {
        mockDb.todayAi = ai._internal.AI_PER_DAY;
        const out = await decide({ text: 'can I build my project as a chatbot?', student: STUDENT, domain: 'Web Development', employeeId: STUDENT.employeeId });
        expect(out.source).toBe('limit');
        expect(out.handover).toBeUndefined();
        expect(mockGemini.ask).not.toHaveBeenCalled();
    });
});

describe('a reply in the conversation', () => {
    let delivered;
    let emitted;
    beforeEach(() => {
        delivered = [];
        emitted = [];
        ai.attach({
            deliver: async (who, payload) => {
                delivered.push({ who, payload });
                mockDb.messages.push({ _id: 'ai' + (++t0), chatRoom: payload.room, senderId: who.id, senderRole: who.role, message: payload.text, timestamp: new Date(t0) });
                return { success: true };
            },
            io: { to: (ch) => ({ emit: (ev, data) => emitted.push({ ch, ev, data }) }) },
            roster: () => []
        });
    });

    it('answers everything since its last message as one question, as the AI, and introduces itself first', async () => {
        say('hi');
        say('what is my employee id');
        await reply(identity, ROOM);
        expect(delivered).toHaveLength(1);
        const { who, payload } = delivered[0];
        expect(who).toMatchObject({ role: 'assistant', id: 'ten-ai', name: 'TEN AI Coordinator' });
        expect(payload.text.startsWith(INTRO)).toBe(true);
        expect(payload.text).toContain('TEN/WEB/1005');
        expect(payload.replyTo).toBe(mockDb.messages[1]._id);
        expect(emitted.map((e) => e.data.typing)).toEqual([true, false]);
        expect(emitted[0].ch).toBe('user::TEN/WEB/1005');
        expect(mockDb.logs[0]).toMatchObject({ kind: 'answer', source: 'saved', employeeId: 'TEN/WEB/1005', domain: 'Web Development' });

        say('where is my offer letter');
        mockGemini.ask.mockResolvedValue({ reply: 'It is in My Documents once it is issued.', handover: false });
        await reply(identity, ROOM);
        expect(delivered[1].payload.text.startsWith(INTRO)).toBe(false);
    });

    it('a hand-over tells the coordinators who and what about, but not the message', async () => {
        say('I am depressed and cannot work, please help');
        await reply(identity, ROOM);
        expect(delivered[0].payload.text).toContain("I've passed your message to your coordinator, Ananya Rao.");
        expect(mockDb.notes).toHaveLength(1);
        const note = mockDb.notes[0];
        expect(note).toMatchObject({ targetType: 'coordinator-domain', targetDomain: 'Web Development', from: 'TEN AI Coordinator' });
        expect(note.message).toContain('TEN/WEB/1005');
        expect(note.message).toContain('a personal matter');
        expect(note.message).not.toMatch(/depressed/);
        // The words are kept for the staff-only summary.
        expect(mockDb.logs[0]).toMatchObject({ kind: 'handover', source: 'personal' });
        expect(mockDb.logs[0].question).toContain('depressed');
    });

    it('a photo with no words gets asked for words', async () => {
        mockDb.messages.push({ _id: 'img1', chatRoom: ROOM, senderId: identity.id, senderRole: 'student', message: '', imageUrl: '/uploads/chat/x.png', timestamp: new Date(++t0) });
        await reply(identity, ROOM);
        expect(delivered[0].payload.text).toContain("I can't read photos yet");
    });
});

describe('which messages it answers', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });
    const deliver = jest.fn(async () => ({ success: true }));

    it('only a student, only in their own conversation with it, and not when switched off', () => {
        ai.attach({ deliver, io: null });
        const spy = jest.spyOn(global, 'setTimeout');
        ai.onMessage({ role: 'coordinator', id: 'web_lead' }, { chatRoom: ROOM });
        ai.onMessage(identity, { chatRoom: 'domain_Web Development' });
        ai.onMessage(identity, { chatRoom: 'dm::TEN/WEB/1005::web_lead' });
        process.env.AI_COORDINATOR = 'off';
        ai.onMessage(identity, { chatRoom: ROOM });
        expect(spy).not.toHaveBeenCalled();
        delete process.env.AI_COORDINATOR;
        ai.onMessage(identity, { chatRoom: ROOM });
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        jest.clearAllTimers();
    });
});

it('shows itself in the directory and the profile as an AI', () => {
    expect(ai.directoryRow({ domain: 'Web Development' })).toEqual({ id: 'ten-ai', name: 'TEN AI Coordinator', role: 'assistant', domain: 'Web Development' });
    const p = ai.profile({ domain: 'Web Development' });
    expect(p.role).toBe('assistant');
    expect(p.about).toMatch(/An AI assistant, not a person/);
    expect(ai.isAssistantId(' TEN-AI ')).toBe(true);
});
