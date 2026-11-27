'use strict';

/**
 * The application tracker on the student's account, shared by both portals.
 * Sending an application starts the clock on the drafted follow-ups.
 */

const rows = [];
const match = (r, q) => Object.entries(q).every(([k, v]) => (v === null ? r[k] == null : r[k] === v));
const apply = (r, u) => {
    Object.assign(r, u.$set || {});
    Object.entries(u.$addToSet || {}).forEach(([k, v]) => { r[k] = [...new Set([...(r[k] || []), ...(v.$each || [v])])]; });
    r.updatedAt = new Date();
    return r;
};
jest.mock('../../models/JobTrack', () => ({
    schema: { path: () => ({ enumValues: ['found', 'tailored', 'emailed', 'applied', 'interview', 'offer', 'closed'] }) },
    find: jest.fn((q) => ({ sort: () => ({ limit: () => ({ lean: async () => rows.filter((r) => match(r, q)) }) }) })),
    findOneAndUpdate: jest.fn(async (q, u, o) => {
        let r = rows.find((x) => match(x, q));
        if (!r && o && o.upsert) { r = { status: 'found', followUps: [], followUpsSent: [], createdAt: new Date(), ...(u.$setOnInsert || {}) }; rows.push(r); }
        return r ? apply(r, u) : null;
    }),
    updateOne: jest.fn(async (q, u, o) => {
        if (!rows.find((x) => match(x, q)) && o && o.upsert) rows.push({ status: 'found', createdAt: new Date(), ...(u.$setOnInsert || {}) });
    }),
    deleteOne: jest.fn(async (q) => { const i = rows.findIndex((x) => match(x, q)); if (i >= 0) rows.splice(i, 1); }),
}));

const express = require('express');
const request = require('supertest');

const app = (who = { _id: 'stu1', employeeId: 'TEN/WEB/1001' }) => {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => { req.studioSubject = who; next(); });
    a.use('/api/v2/jobs/tracker', require('../../routes/v2/jobTracker'));
    a.use('/api/v2/resume/tracker', require('../../routes/v2/jobTracker'));
    return a;
};
const URL1 = 'https://jobs.ashbyhq.com/kite/1';

beforeEach(() => { rows.length = 0; });

it('keeps one row per job, and both portals see it', async () => {
    await request(app()).put('/api/v2/jobs/tracker').send({ url: URL1, company: 'Kite', role: 'Backend Engineer', fit: 4, status: 'tailored',
        followUps: [{ afterDays: 4, subject: 'Following up', body: 'Hi again' }, { afterDays: 10, subject: 'Last note', body: 'Hi' }] });
    await request(app()).put('/api/v2/resume/tracker').send({ url: URL1, status: 'applied' });   // "Apply" in the resume portal
    const res = await request(app()).get('/api/v2/jobs/tracker');
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ url: URL1, company: 'Kite', status: 'applied', followUps: [{ afterDays: 4 }, { afterDays: 10 }] });
    expect(res.body.rows[0].appliedAt).toBeTruthy();                  // the follow-up clock started
});

it('marks a follow-up sent, and keeps another student out', async () => {
    await request(app()).put('/api/v2/jobs/tracker').send({ url: URL1, status: 'emailed' });
    await request(app()).put('/api/v2/jobs/tracker').send({ url: URL1, followUpsSent: [4] });
    expect((await request(app()).get('/api/v2/jobs/tracker')).body.rows[0].followUpsSent).toEqual([4]);
    expect((await request(app({ _id: 'stu2', employeeId: 'TEN/WEB/1002' })).get('/api/v2/jobs/tracker')).body.rows).toEqual([]);
});

it('brings this browser\'s old rows across once, and refuses a row without a link or a status it does not know', async () => {
    await request(app()).post('/api/v2/jobs/tracker/import').send({ rows: [{ url: URL1, role: 'Backend Engineer', status: 'applied' }, { url: 'not a link' }] });
    await request(app()).post('/api/v2/jobs/tracker/import').send({ rows: [{ url: URL1, role: 'Changed' }] });
    const got = (await request(app()).get('/api/v2/jobs/tracker')).body.rows;
    expect(got).toHaveLength(1);
    expect(got[0].role).toBe('Backend Engineer');
    expect((await request(app()).put('/api/v2/jobs/tracker').send({ status: 'applied' })).status).toBe(400);
    expect((await request(app()).put('/api/v2/jobs/tracker').send({ url: URL1, status: 'hired-ish' })).status).toBe(400);
});

it('removes a row', async () => {
    await request(app()).put('/api/v2/jobs/tracker').send({ url: URL1, status: 'found' });
    await request(app()).delete(`/api/v2/jobs/tracker?url=${encodeURIComponent(URL1)}`);
    expect((await request(app()).get('/api/v2/jobs/tracker')).body.rows).toEqual([]);
});
