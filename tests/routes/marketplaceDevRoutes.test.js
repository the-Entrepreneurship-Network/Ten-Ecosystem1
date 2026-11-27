'use strict';

/**
 * @jest-environment node
 *
 * The marketplace router once carried testing helpers that a production server
 * answered for anyone: one deleted every payment, redemption and notification
 * in the database, one deleted a student's certificate redemptions, one listed
 * every mentor account whole, and one added 250 coins per call to whichever
 * student the request named. Coins spend as money here (100 coins = ₹50).
 *
 * The first three are gone. The fourth is the real "Claim 250 Welcome Bonus
 * Coins" button's endpoint, so it stays — for the signed-in student only, once.
 *
 * The real router is mounted with its models stubbed; nothing reaches MongoDB.
 */

const express = require('express');
const request = require('supertest');

const STUDENT = { _id: '64b7f0c2a1b2c3d4e5f60718', employeeId: 'TEN/WEB/1234', name: 'Asha' };
const OTHER = { _id: '64b7f0c2a1b2c3d4e5f60799', employeeId: 'TEN/WEB/9999', name: 'Ravi' };

/**
 * Mount routes/v2/marketplace.js.
 *   session — the student findSessionStudent resolves, or null (signed out)
 *   coins   — pre-existing StudentCoin rows, keyed by studentId
 */
function mount({ session = null, coins = {} } = {}) {
    jest.resetModules();
    const calls = { deleteMany: [], updateMany: [], saves: [], coinLookups: 0, mentorReads: 0 };
    const store = new Map(Object.entries(coins));

    const destructive = (name) => ({
        deleteMany: async (q) => { calls.deleteMany.push([name, q]); return { deletedCount: 0 }; },
        updateMany: async (q, u) => { calls.updateMany.push([name, q, u]); return {}; }
    });

    // Header lookups find a real-looking student: if the welcome bonus ever
    // trusted the x-employee-id header again, it would have someone to pay.
    jest.doMock('../../models/Student', () => ({
        ...destructive('Student'),
        findOne: () => ({ sort: async () => OTHER, then: (ok) => ok(OTHER) }),
        findById: async () => OTHER
    }));
    jest.doMock('../../models/new/CoinRedemption', () => destructive('CoinRedemption'));
    jest.doMock('../../models/Notification', () => destructive('Notification'));
    jest.doMock('../../models/Payment', () => destructive('Payment'));
    jest.doMock('../../models/PaymentTransaction', () => destructive('PaymentTransaction'));
    jest.doMock('../../models/EcosystemNotification', () => destructive('EcosystemNotification'));
    jest.doMock('../../models/EcosystemUser', () => ({
        find: () => ({ lean: async () => { calls.mentorReads += 1; return [{ passwordHash: 'x' }]; } })
    }));
    jest.doMock('../../models/MentorProfile', () => ({
        find: () => ({ lean: async () => { calls.mentorReads += 1; return []; } })
    }));
    jest.doMock('../../middleware/sessionAuth', () => ({ findSessionStudent: async () => session }));
    jest.doMock('../../models/new/StudentCoin', () => {
        function StudentCoin(init) {
            Object.assign(this, { totalCoins: 0, coinsHistory: [] }, init);
        }
        StudentCoin.prototype.save = async function save() {
            calls.saves.push({ totalCoins: this.totalCoins, history: this.coinsHistory.length });
            store.set(String(this.studentId), this);
            return this;
        };
        StudentCoin.findOne = async ({ studentId }) => {
            calls.coinLookups += 1;
            const row = store.get(String(studentId));
            if (!row) return null;
            return row instanceof StudentCoin ? row : Object.assign(new StudentCoin({ studentId }), row);
        };
        return StudentCoin;
    });

    const router = require('../../routes/v2/marketplace');
    const app = express();
    app.use(express.json());
    app.use('/api/v2/marketplace', router);
    return { app, calls, store };
}

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('the testing helpers are not on a production server', () => {
    it('nothing answers the data reset, and nothing is deleted', async () => {
        const { app, calls } = mount();
        const r = await request(app).post('/api/v2/marketplace/dev-reset-flow')
            .set('x-employee-id', STUDENT.employeeId);
        expect(r.status).toBe(404);
        expect(calls.deleteMany).toEqual([]);
        expect(calls.updateMany).toEqual([]);
    });

    it('nothing answers the certificate-redemption reset', async () => {
        const { app, calls } = mount({ session: STUDENT });
        const r = await request(app).post('/api/v2/marketplace/dev-reset-certs');
        expect(r.status).toBe(404);
        expect(calls.deleteMany).toEqual([]);
    });

    it('nothing lists the mentor accounts', async () => {
        const { app, calls } = mount();
        const r = await request(app).get('/api/v2/marketplace/test/debug-mentors');
        expect(r.status).toBe(404);
        expect(calls.mentorReads).toBe(0);
    });
});

describe('the welcome bonus', () => {
    it('is refused without a sign-in, whatever the header claims', async () => {
        const { app, calls } = mount({ session: null });
        const r = await request(app).post('/api/v2/marketplace/dev-add-coins')
            .set('x-employee-id', OTHER.employeeId)
            .send({ employeeId: OTHER.employeeId, coins: 250 });
        expect(r.status).toBe(401);
        expect(calls.coinLookups).toBe(0);
        expect(calls.saves).toEqual([]);
    });

    it('pays the signed-in student 250 coins, once', async () => {
        const { app, calls } = mount({ session: STUDENT });
        const first = await request(app).post('/api/v2/marketplace/dev-add-coins');
        expect(first.status).toBe(200);
        expect(calls.saves).toEqual([{ totalCoins: 250, history: 1 }]);

        const again = await request(app).post('/api/v2/marketplace/dev-add-coins');
        expect(again.status).toBe(409);
        expect(calls.saves).toHaveLength(1);
    });

    it('adds to an existing balance rather than replacing it', async () => {
        const { app, calls } = mount({
            session: STUDENT,
            coins: { [STUDENT._id]: { totalCoins: 40, coinsHistory: [{ action: 'Task approved', coins: 40 }] } }
        });
        expect((await request(app).post('/api/v2/marketplace/dev-add-coins')).status).toBe(200);
        expect(calls.saves).toEqual([{ totalCoins: 290, history: 2 }]);
    });

    it('does not pay again a student who claimed under the old code', async () => {
        // The history line the old endpoint wrote is what marks a claim, so
        // everyone who already pressed the button is already done.
        const { app, calls } = mount({
            session: STUDENT,
            coins: { [STUDENT._id]: { totalCoins: 750, coinsHistory: [{ action: 'Claimed Welcome / Dev Test Coins', coins: 250 }] } }
        });
        expect((await request(app).post('/api/v2/marketplace/dev-add-coins')).status).toBe(409);
        expect(calls.saves).toEqual([]);
    });
});

describe('the page', () => {
    it('no longer carries helpers that call the removed routes', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/ten-extras.js'), 'utf8');
        expect(src).not.toMatch(/dev-reset-flow|dev-reset-certs|debug-mentors|devResetFlow|devResetCerts/);
        // The welcome-bonus button still calls its endpoint.
        expect(src).toContain('fetch("/api/v2/marketplace/dev-add-coins"');
    });
});
