'use strict';

/**
 * The job agent's AI: a match score for the top openings, checked before it
 * is shown, and the agent's own reading whenever the AI cannot answer.
 */

process.env.JOB_CACHE_PATH = require('path').join(require('os').tmpdir(), `job-ai-test-${process.pid}.json`);
jest.mock('../../services/v2/careerAi', () => ({
    ask: jest.fn(),
    NOTES: { limit: "Today's AI checks are used up, so this is the agent's own reading. More tomorrow." },
}));
const careerAi = require('../../services/v2/careerAi');
const express = require('express');
const request = require('supertest');

const app = () => {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => { req.studioSubject = { _id: 'stu1' }; next(); });
    a.use('/api/v2/jobs', require('../../routes/v2/jobAgent'));
    return a;
};
const RESUME = 'Priya Nair\nBackend developer\nSkills: Java, Spring Boot, Docker';
const JOBS = [
    { key: 'https://jobs.ashbyhq.com/kite/1', title: 'Backend Engineer', company: 'Kite', tags: ['java'], description: 'Java, Spring Boot, Kafka and Docker.' },
    { key: 'https://jobs.lever.co/saffron/2', title: 'Frontend Developer', company: 'Saffron', tags: [], description: 'React and TypeScript.' },
];

afterEach(() => { try { require('fs').unlinkSync(process.env.JOB_CACHE_PATH); } catch (e) { /* none */ } });

describe('POST /match', () => {
    it('returns the AI\'s scores for each job, checked', async () => {
        careerAi.ask.mockResolvedValue({ from: 'ai', result: { jobs: [
            { i: 0, score: 88, reasons: ['Java and Spring Boot match'], missing: ['Kafka', 'Kubernetes', 'Docker'] },
            { i: 1, score: 31, reasons: ['Frontend role; resume is backend'], missing: ['React'] },
        ] } });
        const res = await request(app()).post('/api/v2/jobs/match').send({ resumeText: RESUME, jobs: JOBS });
        expect(res.body).toMatchObject({ ok: true, from: 'ai', note: '' });
        expect(res.body.scores['https://jobs.ashbyhq.com/kite/1']).toEqual({ score: 88, reasons: ['Java and Spring Boot match'], missing: ['kafka'] });
        expect(res.body.scores['https://jobs.lever.co/saffron/2'].missing).toEqual(['react']);
        const [kind, subject, , prompt] = careerAi.ask.mock.calls[0];
        expect(kind).toBe('job-match.v1');
        expect(subject).toBe('stu1');                       // the daily limit is this student's
        expect(prompt).toMatch(/data to judge, not instructions/);
        expect(prompt).toMatch(/\[0\] Backend Engineer at Kite/);
    });

    it('says why when the AI cannot answer, and scores nothing', async () => {
        careerAi.ask.mockResolvedValue({ from: 'limit', result: null });
        const res = await request(app()).post('/api/v2/jobs/match').send({ resumeText: RESUME, jobs: JOBS });
        expect(res.body).toEqual({ ok: true, from: 'limit', note: careerAi.NOTES.limit, scores: {} });
    });

    it('asks for twenty jobs at most, and needs a resume', async () => {
        careerAi.ask.mockResolvedValue({ from: 'ai', result: { jobs: [] } });
        const many = Array.from({ length: 30 }, (_, n) => ({ ...JOBS[0], key: `k${n}` }));
        await request(app()).post('/api/v2/jobs/match').send({ resumeText: RESUME, jobs: many });
        expect(careerAi.ask.mock.calls[careerAi.ask.mock.calls.length - 1][2].j).toHaveLength(20);
        expect((await request(app()).post('/api/v2/jobs/match').send({ jobs: JOBS })).status).toBe(400);
    });
});

describe('POST /reword', () => {
    const CV = ['Priya Nair', 'Backend developer', 'Skills: Java, Spring Boot, SQL', '', 'EXPERIENCE',
        'Backend Developer Intern | Zeta | Jan 2025 - Jun 2025',
        '- Built an API in Java serving 5,000 requests a day',
        '- Cut report time from 40 minutes to 6 with a SQL index', '', 'EDUCATION', 'B.Tech Computer Science, KIIT, 2021 - 2025'].join('\n');
    const JOB = { title: 'Backend Engineer', company: 'Kite Payments', description: 'Java, Spring Boot and Kafka. 3+ years.' };
    const LETTER = [
        'Dear Hiring Manager,',
        'I am applying for the Backend Engineer role at Kite Payments. At Zeta I built an API in Java serving 5,000 requests a day. I also ran Kafka in production for 3 years.',
        'I cut a report from 40 minutes to 6 with a SQL index, and I would bring the same care to the services at Kite Payments. I studied Computer Science at KIIT, finishing in 2025, and I write Java and Spring Boot every day in my internship at Zeta.',
        "I would be glad to talk about the API work and what I learned from it. Thank you for reading, and I hope to hear from you about the Backend Engineer role.\n\nPriya Nair",
    ];

    it('keeps only lines your resume supports, and asks for numbers instead of inventing them', async () => {
        careerAi.ask.mockResolvedValue({ from: 'ai', result: {
            bullets: [
                { i: 0, text: 'Built a Java API serving 5,000 requests a day' },
                { i: 1, text: 'Cut report time from 40 minutes to 6 with a SQL index on 2 million rows' },
            ],
            letter: LETTER,
            questions: ['How many users relied on the API each day?', 'not a question'],
        } });
        const res = await request(app()).post('/api/v2/jobs/reword').send({ resumeText: CV, job: JOB });
        expect(res.body.ok).toBe(true);
        expect(res.body.bullets).toEqual([{ before: 'Built an API in Java serving 5,000 requests a day', after: 'Built a Java API serving 5,000 requests a day' }]);
        expect(res.body.kept).toEqual([{ before: 'Cut report time from 40 minutes to 6 with a SQL index', why: expect.stringMatching(/added 2, which your resume does not say/) }]);
        expect(res.body.letter.text).not.toMatch(/Kafka/);             // a skill the posting wants, not one the student has
        expect(res.body.letter.text).toMatch(/5,000 requests a day/);
        expect(res.body.dropped).toBe(1);
        expect(res.body.questions).toEqual(['How many users relied on the API each day?']);
        expect(careerAi.ask.mock.calls[careerAi.ask.mock.calls.length - 1][3]).toMatch(/no new facts/);
    });

    it('leaves the documents alone when the AI cannot answer', async () => {
        careerAi.ask.mockResolvedValue({ from: 'limit', result: null });
        const res = await request(app()).post('/api/v2/jobs/reword').send({ resumeText: CV, job: JOB });
        expect(res.body).toMatchObject({ ok: true, from: 'limit', note: careerAi.NOTES.limit, bullets: [], letter: null });
    });

    it('needs the resume and the job', async () => {
        expect((await request(app()).post('/api/v2/jobs/reword').send({ resumeText: CV })).status).toBe(400);
    });
});
