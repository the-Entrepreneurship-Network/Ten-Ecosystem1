'use strict';

/**
 * @jest-environment node
 *
 * The marketplace acts for the signed-in student and nobody else.
 *
 * Its routes used to work out who was asking from an `x-employee-id` header
 * (or an employeeId in the body or query), and with none of those picked the
 * most recently updated student in the database. So anyone could read a
 * student's coin balance by naming them, and spend it: checkout and
 * redeem-booster debit whoever that turned out to be. Coins spend as money
 * here (100 coins = ₹50).
 *
 * The real router is mounted with its models stubbed; nothing reaches MongoDB.
 */

const express = require('express');
const request = require('supertest');

const ME = { _id: '64b7f0c2a1b2c3d4e5f60718', employeeId: 'TEN/WEB/1234' };
const VICTIM = { _id: '64b7f0c2a1b2c3d4e5f60799', employeeId: 'TEN/WEB/9999' };

const asStudent = (s) => s && { ...s, activeBoosters: [], markModified() {}, save: async () => {} };

/**
 * Mount routes/v2/marketplace.js.
 *   session — the student the session resolves to, or null (signed out)
 *   coins   — coin balances, keyed by studentId
 */
function mount({ session = null, coins = {} } = {}) {
    jest.resetModules();
    const calls = { coinLookups: [], saves: [], studentLookups: 0 };
    const store = new Map(Object.entries(coins).map(([id, total]) => [id, { studentId: id, totalCoins: total, coinsHistory: [] }]));
    const asCoinDoc = (row) => Object.assign(row, {
        async save() { calls.saves.push({ studentId: String(this.studentId), totalCoins: this.totalCoins }); return this; }
    });

    // Every lookup by header, and the "most recent student" fallback, finds the
    // victim: if either ever comes back, it has someone to act for.
    jest.doMock('../../models/Student', () => ({
        findOne: () => {
            calls.studentLookups += 1;
            const found = Promise.resolve(asStudent(VICTIM));
            found.sort = async () => asStudent(VICTIM);
            return found;
        },
        findById: async () => { calls.studentLookups += 1; return asStudent(VICTIM); }
    }));
    jest.doMock('../../models/new/CoinRedemption', () => ({ find: () => ({ sort: () => ({ lean: async () => [] }) }) }));
    jest.doMock('../../models/Notification', () => ({}));
    jest.doMock('../../middleware/sessionAuth', () => ({ findSessionStudent: async () => asStudent(session) }));
    jest.doMock('../../models/new/StudentCoin', () => ({
        findOne: async ({ studentId }) => {
            calls.coinLookups.push(String(studentId));
            const row = store.get(String(studentId));
            return row ? asCoinDoc(row) : null;
        },
        create: async (init) => {
            const row = asCoinDoc({ coinsHistory: [], ...init });
            store.set(String(init.studentId), row);
            return row;
        }
    }));

    const router = require('../../routes/v2/marketplace');
    const app = express();
    app.use(express.json());
    app.use('/api/v2/marketplace', router);
    return { app, calls };
}

describe('signed out, the marketplace acts for nobody', () => {
    it('a header naming another student does not show their balance', async () => {
        const { app, calls } = mount({ coins: { [VICTIM._id]: 1000 } });
        const r = await request(app).get('/api/v2/marketplace/catalog').set('x-employee-id', VICTIM.employeeId);
        expect(r.status).toBe(200);
        expect(r.body.studentCoins).toBe(0);
        expect(calls.coinLookups).toEqual([]);
        expect(calls.studentLookups).toBe(0);
    });

    it('with nothing sent, it does not pick the most recently updated student', async () => {
        const { app, calls } = mount({ coins: { [VICTIM._id]: 1000 } });
        const r = await request(app).get('/api/v2/marketplace/catalog');
        expect(r.body.studentCoins).toBe(0);
        expect(calls.studentLookups).toBe(0);
    });

    it('nobody can spend another student\'s coins', async () => {
        const { app, calls } = mount({ coins: { [VICTIM._id]: 1000 } });
        const r = await request(app).post('/api/v2/marketplace/redeem-booster')
            .set('x-employee-id', VICTIM.employeeId)
            .send({ itemKey: 'booster_streak', employeeId: VICTIM.employeeId });
        expect(r.status).toBe(401);
        expect(calls.saves).toEqual([]);
    });

    it.each(['quote', 'checkout', 'verify-payment'])('%s asks for a sign-in, whatever the header claims', async (route) => {
        const { app, calls } = mount({ coins: { [VICTIM._id]: 1000 } });
        const r = await request(app).post('/api/v2/marketplace/' + route)
            .set('x-employee-id', VICTIM.employeeId)
            .send({ itemKey: 'mentorship_30', employeeId: VICTIM.employeeId });
        expect(r.status).toBe(401);
        expect(calls.saves).toEqual([]);
        expect(calls.studentLookups).toBe(0);
    });
});

describe('signed in, it acts for that student only', () => {
    it('shows and spends the signed-in student\'s own coins, ignoring any header', async () => {
        const { app, calls } = mount({ session: ME, coins: { [ME._id]: 400, [VICTIM._id]: 1000 } });
        const cat = await request(app).get('/api/v2/marketplace/catalog').set('x-employee-id', VICTIM.employeeId);
        expect(cat.body.studentCoins).toBe(400);

        const spend = await request(app).post('/api/v2/marketplace/redeem-booster')
            .set('x-employee-id', VICTIM.employeeId)
            .send({ itemKey: 'booster_streak' });
        expect(spend.status).toBe(200);
        expect(calls.saves).toEqual([{ studentId: ME._id, totalCoins: 250 }]);
        expect(calls.coinLookups.every((id) => id === ME._id)).toBe(true);
    });
});
