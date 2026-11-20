'use strict';

/**
 * @jest-environment node
 *
 * Save a campaign as a template, and find it again in the picker.
 *
 * A template here is a flag on a campaign, not a copy of it: a campaign's copy
 * is never edited after it is created, so the campaign IS the template and
 * there is no second record to drift. What is worth holding:
 *
 *   - the picker still shows the built-ins when the database is having a bad
 *     moment, because they are code and cannot fail;
 *   - a hand-picked campaign does not suggest "picked" as an audience, which
 *     is not a segment the picker can select;
 *   - a malformed id is the caller's 400, and a database failure is a 500 —
 *     not both reported as "Bad campaign id";
 *   - a toggle that succeeded is never reported as failed, which it would be
 *     if a second, unneeded query ran after the write and threw;
 *   - the picker can be reloaded without listing every template twice.
 *
 * The real router is mounted with GrowthCampaign stubbed.
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const ID = '64b7f0c2a1b2c3d4e5f60718';

/**
 * Mount routes/growth.js with the models it touches stubbed.
 *   saved     — rows GrowthCampaign.find({isTemplate:true}) resolves to
 *   findFails — make that query reject
 *   updated   — what findByIdAndUpdate resolves to (null = not found)
 *   updFails  — make findByIdAndUpdate reject
 */
function mount({ saved = [], findFails = false, updated = undefined, updFails = false, signedIn = true } = {}) {
    jest.resetModules();
    const calls = { find: [], update: [], payment: 0 };
    jest.doMock('../../models/GrowthCampaign', () => ({
        find: (q) => {
            calls.find.push(q);
            const chain = {
                sort: () => chain,
                limit: () => chain,
                lean: () => (findFails ? Promise.reject(new Error('mongo down')) : Promise.resolve(saved))
            };
            return chain;
        },
        findByIdAndUpdate: async (id, update, opts) => {
            calls.update.push({ id, update, opts });
            if (updFails) throw new Error('mongo down');
            // Sent, with a click: exactly the campaign revenueFor would query
            // payments for, if the route still called it.
            return updated === undefined
                ? { _id: id, name: 'n', status: 'sent', sentAt: new Date(), clickedStudentIds: [ID], ...update }
                : updated;
        }
    }));
    // Any Payment query throws: if the toggle still ran revenueFor after the
    // write, a successful update would come back as a 500.
    jest.doMock('../../models/Payment', () => ({
        find: () => { calls.payment += 1; throw new Error('payments down'); }
    }));
    const { api, templateFromCampaign } = require('../../routes/growth');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = signedIn ? { growthUser: { username: 'growth', lastActivity: Date.now() } } : {};
        next();
    });
    app.use('/api/growth', api);
    return { app, calls, templateFromCampaign };
}

const CAMPAIGN = {
    _id: ID, name: 'September Studio push', subject: 'Your Studio, ₹150 off',
    heading: 'Everything in one place', bodyText: 'Para one.\n\nPara two.',
    ctaLabel: "See what's included", ctaUrl: 'https://portal.example/studio.html',
    segment: 'freeTenure', createdAt: new Date('2026-11-01T10:00:00Z'), isTemplate: true
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('a campaign, read as a template', () => {
    let templateFromCampaign;
    beforeEach(() => { ({ templateFromCampaign } = mount()); });

    it('carries the copy across unchanged', () => {
        const t = templateFromCampaign(CAMPAIGN);
        expect(t).toMatchObject({
            label: 'September Studio push', subject: CAMPAIGN.subject, heading: CAMPAIGN.heading,
            bodyText: CAMPAIGN.bodyText, ctaLabel: CAMPAIGN.ctaLabel, ctaUrl: CAMPAIGN.ctaUrl,
            suggestedSegment: 'freeTenure', saved: true
        });
        expect(t.description).toContain('2026-11-01');
    });

    it('cannot collide with a built-in key', () => {
        const { TEMPLATES } = require('../../config/growthTemplates');
        const key = templateFromCampaign(CAMPAIGN).key;
        expect(key).toBe('saved:' + ID);
        expect(TEMPLATES.map((b) => b.key)).not.toContain(key);
    });

    it('does not suggest "picked" as an audience', () => {
        // The picked student ids are not part of the copy, and "picked" is not
        // a segment the picker can select.
        expect(templateFromCampaign({ ...CAMPAIGN, segment: 'picked' }).suggestedSegment).toBe('');
    });

    it('fills a missing optional field with blank rather than undefined', () => {
        const t = templateFromCampaign({ ...CAMPAIGN, heading: undefined, ctaLabel: undefined, ctaUrl: undefined });
        expect([t.heading, t.ctaLabel, t.ctaUrl]).toEqual(['', '', '']);
    });
});

describe('GET /templates', () => {
    it('lists the built-ins, then the saved ones', async () => {
        const { app, calls } = mount({ saved: [CAMPAIGN] });
        const r = await request(app).get('/api/growth/templates');
        expect(r.status).toBe(200);
        const keys = r.body.templates.map((t) => t.key);
        const { TEMPLATES } = require('../../config/growthTemplates');
        expect(keys.slice(0, TEMPLATES.length)).toEqual(TEMPLATES.map((t) => t.key));
        expect(keys[keys.length - 1]).toBe('saved:' + ID);
        expect(calls.find).toEqual([{ isTemplate: true }]);
    });

    it('still shows the built-ins when the database is down', async () => {
        const { app } = mount({ findFails: true });
        const r = await request(app).get('/api/growth/templates');
        expect(r.status).toBe(200);
        const { TEMPLATES } = require('../../config/growthTemplates');
        expect(r.body.templates).toHaveLength(TEMPLATES.length);
    });

    it('is behind growth auth', async () => {
        const { app, calls } = mount({ signedIn: false });
        expect((await request(app).get('/api/growth/templates')).status).toBe(401);
        expect(calls.find).toHaveLength(0);
    });
});

describe('saving and removing', () => {
    it('POST saves it, DELETE removes it', async () => {
        const save = mount();
        const r1 = await request(save.app).post(`/api/growth/campaigns/${ID}/template`);
        expect(r1.status).toBe(200);
        expect(save.calls.update[0]).toMatchObject({ id: ID, update: { isTemplate: true } });
        expect(r1.body.campaign.isTemplate).toBe(true);

        const remove = mount();
        const r2 = await request(remove.app).delete(`/api/growth/campaigns/${ID}/template`);
        expect(r2.status).toBe(200);
        expect(remove.calls.update[0]).toMatchObject({ id: ID, update: { isTemplate: false } });
        expect(r2.body.campaign.isTemplate).toBe(false);
    });

    it('a malformed id is a 400, and never reaches the database', async () => {
        const { app, calls } = mount();
        const r = await request(app).post('/api/growth/campaigns/not-an-id/template');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('Bad campaign id');
        expect(calls.update).toHaveLength(0);
    });

    it('an id that matches nothing is a 404', async () => {
        const { app } = mount({ updated: null });
        expect((await request(app).post(`/api/growth/campaigns/${ID}/template`)).status).toBe(404);
    });

    it('a database failure is a 500, not "Bad campaign id"', async () => {
        const { app } = mount({ updFails: true });
        const r = await request(app).post(`/api/growth/campaigns/${ID}/template`);
        expect(r.status).toBe(500);
        expect(r.body.error).not.toMatch(/Bad campaign id/);
    });

    it('a toggle that succeeded is reported as succeeded', async () => {
        // Payments are down in this harness. If the route still looked up
        // revenue after the write, a successful save would come back 500.
        const { app, calls } = mount();
        const r = await request(app).post(`/api/growth/campaigns/${ID}/template`);
        expect(r.status).toBe(200);
        expect(calls.payment).toBe(0);
    });

    it('is behind growth auth', async () => {
        const { app, calls } = mount({ signedIn: false });
        expect((await request(app).post(`/api/growth/campaigns/${ID}/template`)).status).toBe(401);
        expect((await request(app).delete(`/api/growth/campaigns/${ID}/template`)).status).toBe(401);
        expect(calls.update).toHaveLength(0);
    });
});

describe('the page', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/growth-os.html'), 'utf8');
    const loaderAt = html.indexOf('async function loadTemplates()');
    const loader = html.slice(loaderAt, html.indexOf('\n  }\n', loaderAt));

    it('clears the picker before refilling it', () => {
        // It runs again after every save or remove; appending would list each
        // built-in once per reload.
        expect(loaderAt).toBeGreaterThan(-1);
        const clear = loader.indexOf('while (sel.children.length > 1) sel.removeChild(sel.lastChild);');
        const fill = loader.indexOf('sel.appendChild(g)');
        expect(clear).toBeGreaterThan(-1);
        expect(fill).toBeGreaterThan(clear);
    });

    it('offers the toggle on every campaign, with the right verb', () => {
        expect(html).toContain("tb.textContent = c.isTemplate ? 'Remove template' : 'Save as template';");
        expect(html).toMatch(/method: c\.isTemplate \? 'DELETE' : 'POST'/);
    });

    it('refreshes both lists after a change', () => {
        expect(html).toContain('await Promise.all([loadCampaigns(), loadTemplates()]);');
    });

    it('gives a reused template one date, not one per reuse', () => {
        // A campaign made from a template is named "Label — date"; saved and
        // reused, appending today's date would make "Label — date — date".
        expect(html).toContain("t.label.replace(/ — \\d{4}-\\d{2}-\\d{2}$/, '') + ' — ' +");
    });
});
