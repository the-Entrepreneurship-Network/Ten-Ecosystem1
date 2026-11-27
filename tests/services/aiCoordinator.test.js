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
