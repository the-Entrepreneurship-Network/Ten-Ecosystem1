'use strict';

/**
 * @jest-environment node
 *
 * The AI Coordinator's shared helpers (services/aiCoordinator.js). It does not
 * chat: there is nothing here that answers a message. What stays: contact
 * details never reach Gemini, and the coordinators include the .env roster's.
 */

const chain = (rows) => { const q = { select: () => q, lean: async () => rows }; return q; };
jest.mock('../../models/Coordinator', () => ({
    find: () => chain([{ name: 'Ananya Rao', email: 'ananya@ten.test', username: 'web_lead', domain: 'Web Development' }]),
    distinct: async () => ['Web Development']
}));
jest.mock('../../models/Attendance', () => ({ find: () => chain([]) }));
jest.mock('../../models/new/StudentTaskProgress', () => ({ find: () => chain([]) }));
jest.mock('../../models/new/DomainTask', () => ({ find: () => chain([]) }));
const mockEngine = {};
jest.mock('../../models/InterviewSetting', () => ({
    findById: (id) => ({ lean: async () => (id === 'coordinator' ? mockEngine.doc : null) }),
    findByIdAndUpdate: async (id, update) => { mockEngine.saved.push(id); mockEngine.doc = Object.assign({}, mockEngine.doc, update.$set); return mockEngine.doc; }
}));
jest.mock('../../models/AiCoordinatorLog', () => ({ countDocuments: async (f) => { mockEngine.counted = f; return mockEngine.claudeThisMonth; } }));
jest.mock('../../utils/gemini', () => ({
    ready: () => mockEngine.geminiReady,
    ask: async (prompt, schema) => { mockEngine.asked.push(['gemini', schema]); return { draft: 'from Gemini' }; }
}));
jest.mock('../../utils/claude', () => ({
    MODELS: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    ready: () => mockEngine.claudeReady,
    ask: async (prompt, schema, model) => {
        mockEngine.asked.push(['claude', schema, model]);
        if (mockEngine.claudeFails) throw new Error('overloaded');
        return { draft: 'from Claude' };
    }
}));

const ai = require('../../services/aiCoordinator');

it('has no chat left in it', () => {
    for (const gone of ['onMessage', 'decide', 'directoryRow', 'profile', 'isAssistantId', 'identityFor', 'notifyCoordinators', 'ID']) {
        expect(ai).not.toHaveProperty(gone);
    }
});

it('never sends an address, a UPI ID or a phone number to Gemini', () => {
    const out = ai.scrub('mail me at priya.sharma@gmail.com or pay priya@okaxis, call +91 98765 43210 or 9876543210');
    expect(out).not.toMatch(/gmail|okaxis|9876543210/);
    expect(out).toContain('[address]');
    expect(out).toContain('[phone]');
});

it("a domain's coordinators are the database's and the .env roster's, once each", async () => {
    ai.attach({ roster: () => [
        { role: 'coordinator', id: 'web_admin', name: 'Web Development coordinator', domain: 'web development' },
        { role: 'coordinator', id: 'ananya@ten.test', name: 'Ananya Rao', domain: 'Web Development' },
        { role: 'coordinator', id: 'ds_admin', name: 'Data Science coordinator', domain: 'Data Science' },
        { role: 'hr', id: 'hr@ten.test', name: 'HR', domain: '' }
    ] });
    expect((await ai.coordinatorsFor('Web Development')).map((c) => c.id)).toEqual(['ananya@ten.test', 'web_admin']);
    expect((await ai.domainsWithCoordinators()).sort()).toEqual(['Data Science', 'Web Development']);
});

describe('which AI writes the reviews (the admin portal\'s Coordinator AI)', () => {
    beforeEach(() => Object.assign(mockEngine, {
        doc: null, saved: [], asked: [], counted: null, claudeThisMonth: 0, geminiReady: true, claudeReady: true, claudeFails: false
    }));
    const ask = () => ai.askReviewer('the prompt', 'GEMINI_SCHEMA', 'CLAUDE_SCHEMA');

    it('is Gemini, which is free, until the admin portal picks Claude', async () => {
        expect(await ask()).toEqual({ out: { draft: 'from Gemini' }, engine: 'gemini' });
        const s = await ai.engineSummary();
        expect(s).toMatchObject({ engine: 'gemini', claudeModel: 'claude-sonnet-5-5', claudeMonthlyCap: 500, claudeThisMonth: 0 });
        expect(s.models).toEqual([
            { id: 'claude-haiku-5-5', costPerReviewInr: 0.1 },
            { id: 'claude-sonnet-5-5', costPerReviewInr: 1.2 },
            { id: 'claude-opus-5-5', costPerReviewInr: 2.5 }
        ]);
    });

    it("is Claude when picked and under the month's limit; Gemini past it, without the key, or when Claude fails", async () => {
        expect(await ai.saveEngine({ engine: 'claude', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 2, by: 'admin' }))
            .toMatchObject({ engine: 'claude', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 2 });
        expect(mockEngine.saved).toEqual(['coordinator']);
        expect(await ask()).toEqual({ out: { draft: 'from Claude' }, engine: 'claude' });
        expect(mockEngine.asked[0]).toEqual(['claude', 'CLAUDE_SCHEMA', 'claude-haiku-5-5']);
        // The month's Claude reviews are counted from the pre-check log.
        expect(mockEngine.counted).toMatchObject({ kind: 'precheck', engine: 'claude' });

        mockEngine.claudeThisMonth = 2;
        expect((await ask()).engine).toBe('gemini');
        mockEngine.claudeThisMonth = 0;
        mockEngine.claudeReady = false;
        expect((await ask()).engine).toBe('gemini');
        mockEngine.claudeReady = true;
        mockEngine.claudeFails = true;
        expect(await ask()).toEqual({ out: { draft: 'from Gemini' }, engine: 'gemini' });
        // With no AI set up there is no answer, and no error: the review waits for a person.
        mockEngine.geminiReady = false;
        mockEngine.claudeReady = false;
        expect(ai.reviewerReady()).toBe(false);
        expect(await ask()).toBeNull();
    });

    it('refuses a setting it cannot use, and saves nothing', async () => {
        expect(await ai.saveEngine({ engine: 'gpt', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 1 })).toEqual({ error: 'Choose Gemini or Claude.' });
        expect(await ai.saveEngine({ engine: 'claude', claudeModel: 'claude-9', claudeMonthlyCap: 1 })).toEqual({ error: 'Choose a Claude model from the list.' });
        expect(await ai.saveEngine({ engine: 'claude', claudeModel: 'claude-haiku-5-5', claudeMonthlyCap: 1.5 })).toEqual({ error: 'The monthly limit is a whole number from 0 to 100000.' });
        expect(mockEngine.saved).toEqual([]);
    });
});
