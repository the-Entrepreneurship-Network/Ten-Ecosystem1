'use strict';

/**
 * The daily nudges: a drafted follow-up whose day has come, and new openings
 * that fit what a student hunted for. Phone and portal only; email is the
 * weekly digest a student asked for.
 */

const DAY = 86400000;
const NOW = new Date('2026-11-28T04:13:00Z');
const mockTracks = [];
const mockAlerts = [];
const mockNotes = [];
const opening = (title, company, daysAgo, extra = {}) => ({
    source: 'Remotive', title, company, location: 'Bengaluru, India', type: 'full_time', tags: ['java', 'spring boot'],
    url: `https://jobs.lever.co/${company.toLowerCase().replace(/\W+/g, '')}/1`, posted: new Date(NOW - daysAgo * DAY).toISOString(),
    description: 'Java and Spring Boot services. 0-1 years. Freshers welcome.', fromStore: true, ...extra,
});
const mockShelf = [
    opening('Junior Backend Engineer', 'Kite Payments', 1),
    opening('Java Developer', 'Saffron Labs', 2),
    opening('Backend Developer', 'Old Co', 30),                                  // too old to be news
    opening('Marketing Executive', 'Brand Co', 1, { tags: ['seo'], description: 'Campaigns and SEO.' }),   // not their work
];

jest.mock('../../models/JobTrack', () => ({
    schema: { path: () => ({ enumValues: ['found', 'tailored', 'emailed', 'applied', 'interview', 'offer', 'closed'] }) },
    find: jest.fn(() => ({ lean: async () => mockTracks.filter((t) => ['applied', 'emailed'].includes(t.status) && t.employeeId) })),
    updateOne: jest.fn(async (q, u) => { const t = mockTracks.find((x) => x._id === q._id); t.nudged = [...new Set([...(t.nudged || []), ...u.$addToSet.nudged.$each])]; }),
}));
jest.mock('../../models/JobAlert', () => ({
    find: jest.fn(() => ({ lean: async () => mockAlerts.filter((a) => a.alerts && a.employeeId) })),
    updateOne: jest.fn(async (q, u) => {
        const a = mockAlerts.find((x) => x._id === q._id);
        Object.assign(a, u.$set);
        a.seen = [...(a.seen || []), ...u.$push.seen.$each].slice(-500);
    }),
}));
jest.mock('../../models/Notification', () => jest.fn().mockImplementation(function Note(doc) {
    Object.assign(this, doc);
    this.$locals = {};
    this.save = async () => { mockNotes.push({ ...doc, skipEmail: !!this.$locals.skipEmail }); return this; };
}));
jest.mock('../../services/v2/jobStore', () => ({ find: jest.fn(async () => mockShelf.map((j) => ({ ...j }))), keyOf: () => '' }));

const { followUps, jobAlerts } = require('../../services/v2/careerAlerts');
const PROFILE = { role: 'backend developer', seniority: 'entry', location: 'india', skills: ['java', 'spring boot', 'postgresql'], years: 0 };

beforeEach(() => { mockTracks.length = 0; mockAlerts.length = 0; mockNotes.length = 0; });

describe('follow-ups', () => {
    it('reminds on the day a drafted follow-up is due, once, by phone and not by email', async () => {
        mockTracks.push({ _id: 1, employeeId: 'TEN/WEB/1001', status: 'applied', company: 'Kite Payments', role: 'Backend Engineer',
            appliedAt: new Date(NOW - 5 * DAY), followUps: [{ afterDays: 4 }, { afterDays: 10 }], followUpsSent: [], nudged: [] });
        expect(await followUps(NOW)).toBe(1);
        expect(mockNotes[0]).toMatchObject({ title: 'Day 4: follow up with Kite Payments', targetEmployeeId: 'TEN/WEB/1001', skipEmail: true });
        expect(await followUps(NOW)).toBe(0);                                   // already reminded
        expect(await followUps(new Date(NOW.getTime() + 6 * DAY))).toBe(1);     // day 10 comes
        expect(mockNotes[1].title).toBe('Day 10: follow up with Kite Payments');
    });

    it('stays quiet for a follow-up the student marked sent, and for a learner with no portal inbox', async () => {
        mockTracks.push({ _id: 1, employeeId: 'TEN/WEB/1001', status: 'emailed', appliedAt: new Date(NOW - 5 * DAY), followUps: [{ afterDays: 4 }], followUpsSent: [4], nudged: [] });
        mockTracks.push({ _id: 2, employeeId: '', status: 'applied', appliedAt: new Date(NOW - 5 * DAY), followUps: [{ afterDays: 4 }] });
        expect(await followUps(NOW)).toBe(0);
        expect(mockNotes).toEqual([]);
    });
});

describe('job alerts', () => {
    it('tells the phone about new openings that fit, once, and only those', async () => {
        mockAlerts.push({ _id: 1, employeeId: 'TEN/WEB/1001', alerts: true, weeklyEmail: false, profile: PROFILE, seen: ['java developer|saffron labs'] });
        expect((await jobAlerts(NOW)).alerted).toBe(1);
        expect(mockNotes).toHaveLength(1);
        expect(mockNotes[0]).toMatchObject({ title: '1 new job fits your resume', skipEmail: true });
        expect(mockNotes[0].message).toMatch(/^Junior Backend Engineer at Kite Payments\./);
        expect(mockNotes[0].message).not.toMatch(/Old Co|Brand Co|Saffron/);       // too old, not their work, already seen
        expect((await jobAlerts(NOW)).alerted).toBe(0);                         // now seen
    });

    it('emails the weekly digest only to a student who asked for it, once a week', async () => {
        mockAlerts.push({ _id: 1, employeeId: 'TEN/WEB/1001', alerts: true, weeklyEmail: true, profile: PROFILE, seen: [] });
        mockAlerts.push({ _id: 2, employeeId: 'TEN/WEB/1002', alerts: true, weeklyEmail: false, profile: PROFILE, seen: [] });
        const out = await jobAlerts(NOW);
        expect(out).toEqual({ alerted: 2, emailed: 1 });
        const digest = mockNotes.filter((n) => !n.skipEmail);
        expect(digest).toHaveLength(1);
        expect(digest[0]).toMatchObject({ targetEmployeeId: 'TEN/WEB/1001' });
        expect(digest[0].title).toMatch(/^Your weekly job digest: 2 openings fit/);
        expect((await jobAlerts(new Date(NOW.getTime() + 2 * DAY))).emailed).toBe(0);
    });

    it('sends nothing to a student who switched alerts off', async () => {
        mockAlerts.push({ _id: 1, employeeId: 'TEN/WEB/1001', alerts: false, profile: PROFILE, seen: [] });
        expect((await jobAlerts(NOW)).alerted).toBe(0);
        expect(mockNotes).toEqual([]);
    });
});
