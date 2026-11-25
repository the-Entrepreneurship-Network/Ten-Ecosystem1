'use strict';

/**
 * HR's help-desk API: HR and admins only, answers editable, starter answers
 * switched off rather than deleted (deleted, the next start would restore them).
 */
const express = require('express');
const request = require('supertest');

function mount(session) {
    jest.resetModules();
    const answers = [
        { _id: '64b000000000000000000001', question: 'Employee ID', answer: 'Register.', starterKey: 'employee-id', active: true },
        { _id: '64b000000000000000000002', question: 'Stipend', answer: 'No stipend.', source: 'taught', active: true }
    ];
    const SupportAnswer = {
        find: jest.fn(() => ({ sort: async () => answers })),
        create: jest.fn(async (doc) => Object.assign({ _id: 'new' }, doc)),
        findById: jest.fn(async (id) => answers.find((a) => a._id === id) || null),
        findByIdAndUpdate: jest.fn(async (id, u) => {
            const a = answers.find((x) => x._id === id);
            return a ? Object.assign(a, u.$set) : null;
        }),
        updateOne: jest.fn(async () => ({})),
        deleteOne: jest.fn(async () => ({}))
    };
    const SupportTicket = {
        countDocuments: jest.fn(async () => 0),
        find: jest.fn(() => ({ sort: () => ({ limit: async () => [] }) }))
    };
    const agent = {
        mode: () => 'draft', lastRun: { at: null }, LABEL: {},
        seedStarters: jest.fn(async () => {}),
        tryQuestion: jest.fn(async () => ({ answers: [], sensitive: false, reply: null })),
        sendAllDrafts: jest.fn(async () => ({ sent: 0, handled: 0, failed: 0 }))
    };
    jest.doMock('../../models/SupportAnswer', () => SupportAnswer);
    jest.doMock('../../models/SupportTicket', () => SupportTicket);
    jest.doMock('../../services/supportDesk/agent', () => agent);
    const bugAgent = {
        ENGINES: ['claude', 'gemini', 'off'],
        summary: jest.fn(async () => ({ engine: 'claude', down: false })),
        setEngine: jest.fn(async (engine) => ({ engine, down: false }))
    };
    jest.doMock('../../services/supportDesk/bugAgent', () => bugAgent);
    jest.doMock('../../services/supportDesk/gmail', () => ({ configured: () => false }));
    jest.doMock('../../services/supportDesk/facts', () => ({ PLACEHOLDERS: [{ key: 'employeeId', label: 'their Employee ID' }] }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = session; next(); });
    app.use('/api/support-desk', require('../../routes/supportDesk'));
    return { app, SupportAnswer, agent, bugAgent };
}

const HR = { hr: { username: 'hr1', email: 'hr@ten.in' } };

beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterAll(() => console.warn.mockRestore());

test('students, coordinators and strangers are turned away', async () => {
    for (const session of [{ student: { employeeId: 'TEN/WEB/1' } }, { coordinator: { username: 'c' } }, {}]) {
        const { app } = mount(session);
        expect((await request(app).get('/api/support-desk/answers')).status).toBe(401);
        expect((await request(app).post('/api/support-desk/try').send({ text: 'hi' })).status).toBe(401);
    }
});

test('HR sees the status, with the placeholders a personal answer can use', async () => {
    const { app } = mount(HR);
    const res = await request(app).get('/api/support-desk/status');
    expect(res.body).toEqual(expect.objectContaining({ success: true, mode: 'draft', connected: false }));
    expect(res.body.placeholders[0].key).toBe('employeeId');
    expect(res.body.bugAgent).toEqual({ engine: 'claude', down: false });
});

test('listing the answers puts the starter answers in first', async () => {
    const { app, agent } = mount(HR);
    const res = await request(app).get('/api/support-desk/answers');
    expect(agent.seedStarters).toHaveBeenCalled();
    expect(res.body.answers).toHaveLength(2);
});

test('a new answer needs a question and an answer, and is marked as HR\'s', async () => {
    const { app, SupportAnswer } = mount(HR);
    expect((await request(app).post('/api/support-desk/answers').send({ question: 'Q' })).status).toBe(400);
    const res = await request(app).post('/api/support-desk/answers')
        .send({ question: ' Offer letter? ', examples: 'when offer letter\n\n offer letter not received ', answer: 'Soon.' });
    expect(res.status).toBe(200);
    expect(SupportAnswer.create).toHaveBeenCalledWith({
        question: 'Offer letter?', examples: ['when offer letter', 'offer letter not received'], answer: 'Soon.', source: 'hr'
    });
});

test('an edit is remembered as HR\'s, so a later release does not overwrite it', async () => {
    const { app, SupportAnswer } = mount(HR);
    await request(app).put('/api/support-desk/answers/64b000000000000000000001').send({ answer: 'Edited.' });
    expect(SupportAnswer.findByIdAndUpdate).toHaveBeenCalledWith('64b000000000000000000001',
        { $set: { answer: 'Edited.', edited: true } }, { new: true });
    expect((await request(app).put('/api/support-desk/answers/not-an-id').send({ answer: 'x' })).status).toBe(404);
});

test('deleting a starter answer switches it off; any other answer is deleted', async () => {
    const { app, SupportAnswer } = mount(HR);
    await request(app).delete('/api/support-desk/answers/64b000000000000000000001');
    expect(SupportAnswer.updateOne).toHaveBeenCalledWith({ _id: '64b000000000000000000001' }, { $set: { active: false, edited: true } });
    expect(SupportAnswer.deleteOne).not.toHaveBeenCalled();
    await request(app).delete('/api/support-desk/answers/64b000000000000000000002');
    expect(SupportAnswer.deleteOne).toHaveBeenCalledWith({ _id: '64b000000000000000000002' });
});

test('Send all is for HR only, and waits until the mailbox is connected', async () => {
    expect((await request(mount({}).app).post('/api/support-desk/send-drafts')).status).toBe(401);
    const { app, agent } = mount(HR);
    const res = await request(app).post('/api/support-desk/send-drafts');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not connected/);
    expect(agent.sendAllDrafts).not.toHaveBeenCalled();
});

test('HR switches who handles website bug reports; only Claude, Gemini or Off, and only HR', async () => {
    expect((await request(mount({}).app).post('/api/support-desk/bug-agent').send({ engine: 'gemini' })).status).toBe(401);
    const { app, bugAgent } = mount(HR);
    const res = await request(app).post('/api/support-desk/bug-agent').send({ engine: 'gemini' });
    expect(res.body).toEqual({ success: true, bugAgent: { engine: 'gemini', down: false } });
    expect((await request(app).post('/api/support-desk/bug-agent').send({ engine: 'chatgpt' })).status).toBe(400);
    expect(bugAgent.setEngine).toHaveBeenCalledTimes(1);
});
