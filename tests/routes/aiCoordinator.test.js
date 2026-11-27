'use strict';

/**
 * @jest-environment node
 *
 * /api/v2/ai-coordinator (routes/v2/aiCoordinator.js): who may see which
 * domain's summary, and who may re-run a submission's pre-check.
 */

const mockSubs = {};
jest.mock('mongoose', () => {
    const actual = jest.requireActual('mongoose');
    return Object.assign(Object.create(actual), {
        model: (name, ...rest) => (name === 'Submission' && !rest.length
            ? { findById: (id) => ({ select: () => ({ lean: async () => mockSubs[id] || null }) }) }
            : actual.model(name, ...rest))
    });
});
jest.mock('../../services/aiCoordinatorJobs', () => ({ buildSummary: jest.fn(async (domain) => ({ success: true, domain })) }));
jest.mock('../../services/submissionPrecheck', () => ({ run: jest.fn(async () => ({ problems: [] })) }));

const jobs = require('../../services/aiCoordinatorJobs');
const precheck = require('../../services/submissionPrecheck');
const router = require('../../routes/v2/aiCoordinator');
const { requireStaff } = require('../../middleware/sessionAuth');

function route(method, path) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    return layer.route.stack.map((s) => s.handle);
}
async function call(method, path, req) {
    const handlers = route(method, path);
    let status = 200;
    let body;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await handlers[handlers.length - 1](Object.assign({ query: {}, params: {} }, req), res);
    return { status, body };
}

const ID = 'a'.repeat(24);
const coordinator = { coordinator: { username: 'web_lead', domain: 'Web Development' } };
const hr = { hrUser: { username: 'hr1' } };

beforeEach(() => {
    jobs.buildSummary.mockClear();
    precheck.run.mockClear();
    for (const k of Object.keys(mockSubs)) delete mockSubs[k];
});

it('both routes need a staff sign-in', () => {
    expect(route('get', '/summary')[0]).toBe(requireStaff);
    expect(route('post', '/precheck/:id')[0]).toBe(requireStaff);
});

describe('GET /summary', () => {
    it("a coordinator gets their own domain, whatever they ask for", async () => {
        await call('get', '/summary', Object.assign({ query: { domain: 'Data Science' } }, coordinator));
        expect(jobs.buildSummary).toHaveBeenCalledWith('Web Development');
    });
    it('HR names the domain, and must', async () => {
        await call('get', '/summary', Object.assign({ query: { domain: 'Data Science' } }, hr));
        expect(jobs.buildSummary).toHaveBeenCalledWith('Data Science');
        expect((await call('get', '/summary', hr)).status).toBe(400);
    });
});

describe('POST /precheck/:id', () => {
    it('refuses something that is not a submission id', async () => {
        expect((await call('post', '/precheck/:id', Object.assign({ params: { id: 'x' } }, coordinator))).status).toBe(400);
    });
    it("refuses another domain's submission", async () => {
        mockSubs[ID] = { domain: 'Data Science' };
        expect((await call('post', '/precheck/:id', Object.assign({ params: { id: ID } }, coordinator))).status).toBe(403);
        expect(precheck.run).not.toHaveBeenCalled();
    });
    it('refuses one already reviewed', async () => {
        mockSubs[ID] = { domain: 'Web Development', reviewedOnce: true };
        expect((await call('post', '/precheck/:id', Object.assign({ params: { id: ID } }, coordinator))).status).toBe(409);
    });
    it('runs it again without notifying the student, keeping what the first check knew about the screenshot', async () => {
        mockSubs[ID] = { domain: 'web development', image: '', aiCheck: { screenshot: { expected: false } } };
        const r = await call('post', '/precheck/:id', Object.assign({ params: { id: ID } }, coordinator));
        expect(r.body).toEqual({ success: true, aiCheck: { problems: [] } });
        expect(precheck.run).toHaveBeenCalledWith(ID, { screenshotExpected: false, notify: false });
    });
});
