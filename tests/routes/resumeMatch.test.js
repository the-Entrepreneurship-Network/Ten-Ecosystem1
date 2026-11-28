'use strict';

/**
 * The resume portal's job-description match: the share of the posting's
 * keywords the resume has, short forms included, and where each missing one
 * would go if it is true. Rules only.
 */

const express = require('express');
const request = require('supertest');

const app = () => { const a = express(); a.use(express.json()); a.use('/api/v2/resume', require('../../routes/v2/resumeAgent')); return a; };
const RESUME = 'Asha K\nFrontend developer\nSkills: JS, ReactJS, Postgres\n- Built a dashboard for 200 users';
const JD = 'We want a Frontend Engineer who knows JavaScript, React, TypeScript and Redux. PostgreSQL is a plus.';

it('counts short forms as the skill, and says where each missing keyword goes', async () => {
    const res = await request(app()).post('/api/v2/resume/match').send({ text: RESUME, jd: JD, title: 'Frontend Engineer' });
    expect(res.body.ok).toBe(true);
    expect(res.body.matched).toEqual(expect.arrayContaining(['javascript', 'react', 'postgresql']));
    const missing = Object.fromEntries(res.body.missing.map((m) => [m.term, m.where]));
    expect(missing).toMatchObject({ typescript: 'Skills', redux: 'Skills', engineer: 'Headline' });
    expect(res.body.missing.find((m) => m.term === 'typescript').tip).toMatch(/only if you have used it/);
    expect(missing.frontend).toBeUndefined();                 // the headline already says it
    expect(res.body.percent).toBeGreaterThan(0);
});

it('needs a resume, and a real job description', async () => {
    expect((await request(app()).post('/api/v2/resume/match').send({ jd: JD })).status).toBe(400);
    expect((await request(app()).post('/api/v2/resume/match').send({ text: RESUME, jd: 'short' })).status).toBe(400);
});
