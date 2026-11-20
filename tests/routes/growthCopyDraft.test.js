'use strict';

/**
 * @jest-environment node
 *
 * POST /api/growth/copy/draft, and the button that calls it.
 *
 * services/growthCopy.js is tested on its own (tests/services/growthCopy.test.js)
 * — that is where the link allow-list and the segment check live. What is left
 * here is the seam: the route must sit behind growth auth, must hand the brief
 * through untouched, must show the user the two failures that are theirs to fix
 * (no brief, no AI key), and must NOT show them the raw text of a failure that
 * is not — an upstream model error can carry quota detail, request ids or
 * worse, and it belongs in the log, not in a toast.
 *
 * The real router is mounted on a bare app with a fake session, and the copy
 * service is stubbed so each failure can be produced on demand.
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

/** Mount routes/growth.js with growthCopy.draft replaced by `impl`. */
function mount(impl, { signedIn = true } = {}) {
    jest.resetModules();
    const seen = [];
    jest.doMock('../../services/growthCopy', () => ({
        draft: async (brief) => { seen.push(brief); return impl(brief); }
    }));
    const { api } = require('../../routes/growth');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = signedIn
            ? { growthUser: { username: 'growth', lastActivity: Date.now() } }
            : {};
        next();
    });
    app.use('/api/growth', api);
    return { app, seen };
}

const DRAFT = {
    name: 'n', subject: 's', heading: 'h', bodyText: 'b',
    ctaLabel: 'c', ctaUrl: 'https://portal.example/overview', segment: 'dormant14'
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // growthAuth reports a missing GROWTH_PASSWORD_HASH when it loads; true of
    // every test environment and not what this file is about.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('POST /copy/draft', () => {
    it('is behind growth auth', async () => {
        const { app, seen } = mount(async () => DRAFT, { signedIn: false });
        const r = await request(app).post('/api/growth/copy/draft').send({ brief: 'x' });
        expect(r.status).toBe(401);
        expect(seen).toHaveLength(0);              // never reaches the model
    });

    it('returns the draft, and passes the brief through untouched', async () => {
        const { app, seen } = mount(async () => DRAFT);
        const r = await request(app).post('/api/growth/copy/draft')
            .send({ brief: 'nudge dormant students to finish' });
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ success: true, draft: DRAFT });
        expect(seen).toEqual(['nudge dormant students to finish']);
    });

    it.each([
        ['an empty brief', 'Describe the campaign in a sentence first.'],
        ['no AI key', 'No AI key on this server — write the campaign by hand, or ask an admin to set GEMINI_API_KEY.']
    ])('shows the user %s, because it is theirs to fix', async (_label, message) => {
        const { app } = mount(async () => { throw new Error(message); });
        const r = await request(app).post('/api/growth/copy/draft').send({ brief: '' });
        expect(r.status).toBe(400);
        expect(r.body).toEqual({ success: false, error: message });
    });

    it('does not show the user what an upstream failure said', async () => {
        // A model error can carry quota detail, request ids, key fragments.
        // The user gets a retry line; the detail goes to the log.
        const secret = 'Gemini 429: quota exceeded for project 123456 key AIza…';
        const { app } = mount(async () => { throw new Error(secret); });
        const r = await request(app).post('/api/growth/copy/draft').send({ brief: 'x' });
        expect(r.status).toBe(502);
        expect(r.body.success).toBe(false);
        expect(JSON.stringify(r.body)).not.toContain('429');
        expect(JSON.stringify(r.body)).not.toContain('AIza');
        expect(r.body.error).toMatch(/try again, or write it by hand/);
        expect(console.error).toHaveBeenCalled();  // it is not swallowed, just not shown
    });

    it('sends nothing and saves nothing', async () => {
        // A draft is a suggestion for a form. If this route ever wrote a
        // campaign or queued a send, a vague brief could reach students
        // without anyone pressing Save.
        const src = fs.readFileSync(path.join(__dirname, '../../routes/growth.js'), 'utf8');
        const at = src.indexOf("api.post('/copy/draft'");
        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, src.indexOf('\napi.', at + 1));
        expect(body).not.toMatch(/GrowthCampaign\.|sender\.|\.send\(|\.save\(/);
    });
});

describe('the Draft with AI button', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/growth-os.html'), 'utf8');
    const at = html.indexOf("$('aiDraftBtn').addEventListener");
    const handler = html.slice(at, html.indexOf('\n  });', at));

    it('is on the page, with somewhere to type the brief', () => {
        expect(html).toContain('id="aiBrief"');
        expect(html).toContain('id="aiDraftBtn"');
        expect(html).toContain('id="aiNote"');
    });

    it('posts the brief to the draft route', () => {
        expect(at).toBeGreaterThan(-1);
        expect(handler).toMatch(/call\('\/copy\/draft'/);
        expect(handler).toMatch(/method: 'POST'/);
    });

    it('fills every field the campaign form has', () => {
        for (const id of ['cName', 'cSubject', 'cHeading', 'cBody', 'cCtaLabel', 'cCtaUrl']) {
            expect(handler).toContain(`$('${id}').value`);
        }
    });

    it('shows the server\'s reason when it fails, and always re-enables the button', () => {
        expect(handler).toMatch(/catch \(e\)[\s\S]*\$\('aiNote'\)\.textContent = e\.message/);
        expect(handler).toMatch(/finally \{[\s\S]*btn\.disabled = false/);
    });
});
