'use strict';

/**
 * @jest-environment node
 *
 * Refer & Earn (services/referrals.js).
 *
 * The collections it reads are an in-memory store here, with the few query
 * operators the service uses, and the real coinService runs on top of it. So
 * these tests check what a student ends up with: coins in the balance, rows in
 * the ledger, the stage and the money on the page.
 */

const mockDb = {};
const mockCalls = { notes: [] };

jest.mock('mongoose', () => ({ connection: { readyState: 1 } }));
jest.mock('../../utils/mailer', () => ({ PORTAL_URL: 'https://portal.test' }));
jest.mock('../../models/Notification', () => ({
    notifyStudent: async (student, note) => { mockCalls.notes.push({ to: student.employeeId, ...note }); return {}; }
}));

/* A small stand-in for a Mongoose model over mockDb[name]. */
function mockModel(name, uniques = []) {
    const rows = () => (mockDb[name] = mockDb[name] || []);
    const get = (doc, path) => path.split('.').reduce((v, k) => {
        if (v == null) return undefined;
        return Array.isArray(v) ? v.map((x) => (x == null ? undefined : x[k])) : v[k];
    }, doc);
    const same = (a, b) => (a instanceof Date || b instanceof Date)
        ? new Date(a).getTime() === new Date(b).getTime()
        : a !== undefined && b !== undefined && a !== null && b !== null ? String(a) === String(b) : a === b;
    const any = (actual, test) => Array.isArray(actual) ? actual.some(test) : test(actual);
    const num = (v) => (v instanceof Date ? v.getTime() : Number(v));
    function matchOne(actual, cond) {
        if (cond instanceof RegExp) return any(actual, (v) => typeof v === 'string' && cond.test(v));
        if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((k) => k[0] === '$')) {
            return Object.entries(cond).every(([op, v]) => {
                if (op === '$in') return v.some((x) => any(actual, (a) => same(a, x)));
                if (op === '$nin') return !v.some((x) => any(actual, (a) => same(a, x)));
                if (op === '$ne') return !any(actual, (a) => same(a, v));
                if (op === '$exists') return (actual !== undefined) === !!v;
                if (op === '$gt') return actual != null && num(actual) > num(v);
                if (op === '$gte') return actual != null && num(actual) >= num(v);
                throw new Error('operator not in the stand-in: ' + op);
            });
        }
        return any(actual, (a) => same(a, cond));
    }
    const matches = (doc, q = {}) => Object.entries(q).every(([path, cond]) => matchOne(get(doc, path), cond));
    const copy = (d) => (d == null ? d : JSON.parse(JSON.stringify(d), (k, v) =>
        typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) ? new Date(v) : v));
    const setPath = (doc, path, value) => {
        const keys = path.split('.');
        let at = doc;
        for (const k of keys.slice(0, -1)) at = at[k] = at[k] || {};
        at[keys[keys.length - 1]] = value;
    };
    const clash = (doc, except) => uniques.some((field) => {
        const v = get(doc, field);
        return v !== undefined && rows().some((r) => r !== except && same(get(r, field), v));
    });
    const dup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    let nextId = 1;

    class Query {
        constructor(run) { this.run = run; this.order = null; }
        select() { return this; }
        lean() { return this; }
        sort(spec) { this.order = spec; return this; }
        distinct(field) { return Promise.resolve(this.run()).then((list) => [...new Set(list.map((d) => String(get(d, field))))]); }
        then(ok, bad) {
            return Promise.resolve().then(() => {
                let out = this.run();
                if (Array.isArray(out) && this.order) {
                    const [[k, dir]] = Object.entries(this.order);
                    out = [...out].sort((a, b) => (num(get(a, k)) - num(get(b, k))) * dir);
                }
                return copy(out);
            }).then(ok, bad);
        }
    }
    const apply = (doc, update) => {
        for (const [k, v] of Object.entries(update.$set || {})) setPath(doc, k, v);
        for (const [k, v] of Object.entries(update.$inc || {})) setPath(doc, k, (get(doc, k) || 0) + v);
        for (const [k, v] of Object.entries(update.$push || {})) setPath(doc, k, [...(get(doc, k) || []), v]);
    };

    return {
        find: (q) => new Query(() => rows().filter((d) => matches(d, q))),
        findOne: (q) => new Query(() => rows().find((d) => matches(d, q)) || null),
        findById: (id) => new Query(() => rows().find((d) => same(d._id, id)) || null),
        distinct: async (field, q) => [...new Set(rows().filter((d) => matches(d, q)).map((d) => get(d, field)))],
        async create(doc) {
            await null;
            const row = { _id: name + '-' + nextId++, createdAt: new Date(), ...copy(doc) };
            if (clash(row)) throw dup();
            rows().push(row);
            return copy(row);
        },
        async updateOne(q, update) {
            await null;
            const doc = rows().find((d) => matches(d, q));
            if (!doc) return { matchedCount: 0, modifiedCount: 0 };
            const next = copy(doc);
            apply(next, update);
            if (clash(next, doc)) throw dup();
            Object.assign(doc, next);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(q, update) {
            await null;
            const doc = rows().find((d) => matches(d, q));
            if (!doc) return null;
            apply(doc, update);
            return copy(doc);
        }
    };
}

jest.mock('../../models/Student', () => mockModel('Student', ['referralCode']));
jest.mock('../../models/Payment', () => mockModel('Payment'));
jest.mock('../../models/ReferralReward', () => mockModel('ReferralReward', ['key']));
jest.mock('../../models/new/DomainTask', () => mockModel('DomainTask'));
jest.mock('../../models/new/StudentTaskProgress', () => mockModel('StudentTaskProgress'));
jest.mock('../../models/new/StudentCoin', () => mockModel('StudentCoin', ['studentId']));

const mongoose = require('mongoose');
const coinService = require('../../services/v2/coinService');
const referrals = require('../../services/referrals');
const { SIGNUP_REF } = require('../../utils/signupRef');

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-12-01T06:00:00.000Z');
const at = (days) => new Date(T0.getTime() + days * DAY);

let seq = 0;
function student(over = {}) {
    seq += 1;
    const s = { _id: 'stu' + seq, name: 'Student ' + seq, email: `s${seq}@example.com`, whatsapp: '90000000' + String(seq).padStart(2, '0'),
        employeeId: 'TEN/WEB/' + (1000 + seq), domain: 'Web Development', createdAt: T0, ambassador: { status: '' }, ...over };
    mockDb.Student.push(s);
    return s;
}
async function referrer(over) {
    const r = student(over);
    await referrals.ensureCode(r);
    return mockDb.Student.find((s) => s._id === r._id);
}
const friendOf = (r, over = {}) => student({ signupRef: 'stu-' + r.referralCode, ...over });
function pay(s, amount, over = {}) {
    const p = { _id: 'pay' + (++seq), studentId: s._id, amount, status: 'success', purpose: 'tenure_1month', verifiedAt: at(1), createdAt: at(1), ...over };
    mockDb.Payment.push(p);
    return p;
}
function week1(s, { approved = 1, open = 0 } = {}) {
    for (let i = 0; i < approved + open; i++) {
        const task = { _id: 'task-w1-' + s._id + '-' + i, weekNumber: 1 };
        mockDb.DomainTask.push(task);
        mockDb.StudentTaskProgress.push({ _id: 'prog' + (++seq), studentId: s._id, taskId: task._id, status: i < approved ? 'approved' : 'available' });
    }
}
const coinsOf = (s) => ((mockDb.StudentCoin || []).find((c) => c.studentId === s._id) || { totalCoins: 0, coinsHistory: [] });
const referralCoins = (s) => coinsOf(s).coinsHistory.filter((h) => h.refKey).reduce((t, h) => t + h.coins, 0);
const rewards = (kind) => mockDb.ReferralReward.filter((r) => !kind || r.kind === kind);
const fresh = (s) => mockDb.Student.find((x) => x._id === s._id);
const settleFor = async (r, now = at(2)) => {
    const me = fresh(r);
    const friends = mockDb.Student.filter((s) => s.signupRef === 'stu-' + me.referralCode && s._id !== me._id);
    return referrals.settle(me, friends, now);
};

beforeEach(() => {
    for (const k of ['Student', 'Payment', 'ReferralReward', 'DomainTask', 'StudentTaskProgress', 'StudentCoin']) mockDb[k] = [];
    mockCalls.notes = [];
    mongoose.connection.readyState = 1;
});

describe('the rules', () => {
    it.each([
        [0, false, 'starter', 5], [4, false, 'starter', 5], [5, false, 'promoter', 10], [25, false, 'promoter', 10],
        [10, true, 'ambassador', 10], [19, true, 'ambassador', 10], [20, true, 'ambassador', 20]
    ])('%i paying friends, ambassador %p: %s at %i%%', (paying, amb, key, rate) => {
        expect(referrals.stageFor(paying, amb)).toMatchObject({ key, rate });
    });

    it.each([
        [{ status: 'success', amount: 1000 }, true],
        [{ status: 'pending_verification', amount: 1000 }, false],
        [{ status: 'refunded', amount: 1000 }, false],
        [{ status: 'success', amount: 0 }, false],
        [{ status: 'success', amount: 300, metadata: { grantedBy: 'tenure_bundle' } }, false]
    ])('real money: %j → %p', (p, real) => expect(referrals.isRealPayment(p)).toBe(real));

    it('the same email or phone number is the same person', () => {
        const a = { email: 'Priya@Example.com ', whatsapp: '+91 98765 43210' };
        expect(referrals.isSamePerson(a, { email: 'priya@example.com', whatsapp: '' })).toBe(true);
        expect(referrals.isSamePerson(a, { email: 'other@example.com', whatsapp: '9876543210' })).toBe(true);
        expect(referrals.isSamePerson(a, { email: 'other@example.com', whatsapp: '9876500000' })).toBe(false);
        expect(referrals.isSamePerson({ email: '' }, { email: '' })).toBe(false);
    });

    it('a friend is shown by first name and initial only', () => {
        expect(referrals.shortName({ name: 'Priya Sharma' })).toBe('Priya S.');
        expect(referrals.shortName({ name: 'Priya' })).toBe('Priya');
        expect(referrals.shortName({ firstName: 'Ravi', lastName: 'kumar' })).toBe('Ravi K.');
        expect(referrals.shortName({})).toBe('A friend');
    });
});

describe('the link', () => {
    it('is made once, and is a ref the sign-up form keeps', async () => {
        const r = student();
        const code = await referrals.ensureCode(r);
        expect(await referrals.ensureCode({ _id: r._id })).toBe(code);
        expect(SIGNUP_REF.test('stu-' + code)).toBe(true);
        expect(referrals.linkFor(code)).toBe('https://portal.test/register?ref=stu-' + code);
    });

    it('two first visits at once still give one code', async () => {
        const r = student();
        const [a, b] = await Promise.all([referrals.ensureCode({ _id: r._id }), referrals.ensureCode({ _id: r._id })]);
        expect(a).toBe(b);
        expect(fresh(r).referralCode).toBe(a);
    });
});

describe('coins for both students', () => {
    it('signing up alone earns nothing', async () => {
        const r = await referrer();
        friendOf(r);
        await settleFor(r);
        expect(rewards()).toHaveLength(0);
        expect(mockDb.StudentCoin).toHaveLength(0);
    });

    it('100 each when the friend finishes week 1, once however often it settles', async () => {
        const r = await referrer();
        const f = friendOf(r);
        week1(f, { approved: 2 });
        await settleFor(r);
        await settleFor(r);
        expect(referralCoins(r)).toBe(100);
        expect(referralCoins(f)).toBe(100);
        expect(rewards('week1_coins')).toHaveLength(1);
        expect(mockCalls.notes.map((n) => n.to)).toEqual([r.employeeId, f.employeeId]);
    });

    it('not while part of week 1 is still open', async () => {
        const r = await referrer();
        const f = friendOf(r);
        week1(f, { approved: 1, open: 1 });
        await settleFor(r);
        expect(referralCoins(r)).toBe(0);
    });

    it('200 each on the first approved payment, and not again for the next one', async () => {
        const r = await referrer();
        const f = friendOf(r);
        pay(f, 1000);
        pay(f, 300, { verifiedAt: at(1.5) });
        await settleFor(r);
        expect(referralCoins(r)).toBe(200);
        expect(referralCoins(f)).toBe(200);
        expect(rewards('paid_coins')).toHaveLength(1);
    });

    it('a payment waiting for approval, or a waived fee, earns nothing', async () => {
        const r = await referrer();
        const f = friendOf(r);
        pay(f, 1000, { status: 'pending_verification' });
        pay(f, 0, { metadata: { grantedBy: 'tenure_bundle' } });
        await settleFor(r);
        expect(rewards()).toHaveLength(0);
    });

    it('two settles at the same moment still pay each student once', async () => {
        const r = await referrer();
        const f = friendOf(r);
        week1(f);
        pay(f, 1000);
        await Promise.all([settleFor(r), settleFor(r), settleFor(r)]);
        expect(referralCoins(r)).toBe(300);
        expect(referralCoins(f)).toBe(300);
        expect(rewards('commission')).toHaveLength(1);
        // A first coin opens the wallet with its 250 welcome coins, once.
        expect(coinsOf(f).totalCoins).toBe(250 + 300);
    });

    it('an award that failed is paid on the next settle, once', async () => {
        const r = await referrer();
        const f = friendOf(r);
        week1(f);
        const real = coinService.awardCoins;
        let calls = 0;
        coinService.awardCoins = async (...args) => {
            calls += 1;
            if (calls === 2) throw new Error('database hiccup');      // the friend's award
            return real(...args);
        };
        try {
            await expect(settleFor(r)).rejects.toThrow('database hiccup');
        } finally {
            coinService.awardCoins = real;
        }
        expect(referralCoins(r)).toBe(100);
        expect(referralCoins(f)).toBe(0);
        await settleFor(r);
        await settleFor(r);
        expect(referralCoins(r)).toBe(100);
        expect(referralCoins(f)).toBe(100);
    });
});

describe('the referrer\'s share of each payment', () => {
    it('is the stage rate, pending for 15 days, then available', async () => {
        const r = await referrer();
        const f = friendOf(r);
        pay(f, 1000, { verifiedAt: at(1) });
        const s1 = await referrals.summarize(fresh(r), at(2));
        expect(s1.stage).toMatchObject({ key: 'starter', rate: 5 });
        expect(s1.earnings).toMatchObject({ pending: 50, available: 0 });
        expect(new Date(s1.earnings.nextUnlock).getTime()).toBe(at(16).getTime());
        const s2 = await referrals.summarize(fresh(r), at(16));
        expect(s2.earnings).toMatchObject({ pending: 0, available: 50 });
        expect(s2.earnings.history[0]).toMatchObject({ rate: 5, amount: 50, status: 'available' });
    });

    it('counts the paying friend whose payment it is: the fifth pays at 10%', async () => {
        const r = await referrer();
        const friends = [1, 2, 3, 4, 5].map((i) => {
            const f = friendOf(r);
            pay(f, 1000, { verifiedAt: at(i) });
            return f;
        });
        pay(friends[0], 500, { verifiedAt: at(6) });
        await settleFor(r, at(7));
        const rates = rewards('commission').sort((a, b) => a.paidAt - b.paidAt).map((c) => [c.base, c.rate, c.amount]);
        expect(rates).toEqual([[1000, 5, 50], [1000, 5, 50], [1000, 5, 50], [1000, 5, 50], [1000, 10, 100], [500, 10, 50]]);
        const s = await referrals.summarize(fresh(r), at(7));
        expect(s.stage).toMatchObject({ key: 'promoter', rate: 10 });
        expect(s.next).toMatchObject({ name: 'Campus Ambassador', at: 10, remaining: 5, apply: true });
    });

    it('an approved Campus Ambassador gets 20% from the 20th paying friend', async () => {
        const r = await referrer({ ambassador: { status: 'approved', college: 'NIT Trichy', collegeKey: 'nittrichy' } });
        for (let i = 1; i <= 20; i++) pay(friendOf(r), 1000, { verifiedAt: at(i) });
        await settleFor(r, at(21));
        const byDay = rewards('commission').sort((a, b) => a.paidAt - b.paidAt).map((c) => c.rate);
        expect(byDay.slice(0, 19).every((x) => x === 10)).toBe(true);
        expect(byDay[19]).toBe(20);
    });

    it('only for payments in the friend\'s first 12 months', async () => {
        const r = await referrer();
        const f = friendOf(r, { createdAt: T0 });
        pay(f, 1000, { verifiedAt: at(400) });
        await settleFor(r, at(401));
        expect(rewards()).toHaveLength(0);
    });

    it('is reversed by a refund, and back if the payment is approved again; coins stay', async () => {
        const r = await referrer();
        const f = friendOf(r);
        const p = pay(f, 1000);
        await settleFor(r);
        p.status = 'refunded';
        await settleFor(r);
        let s = await referrals.summarize(fresh(r), at(30));
        expect(s.earnings).toMatchObject({ pending: 0, available: 0, reversed: 50 });
        expect(s.earnings.history[0].status).toBe('reversed');
        expect(referralCoins(r)).toBe(200);
        p.status = 'success';
        s = await referrals.summarize(fresh(r), at(30));
        expect(s.earnings).toMatchObject({ available: 50, reversed: 0 });
    });
});

describe('who counts', () => {
    it('a "friend" with the referrer\'s phone number earns nothing, and is shown as not counted', async () => {
        const r = await referrer({ whatsapp: '+91 98765 43210' });
        const f = friendOf(r, { whatsapp: '9876543210' });
        week1(f);
        pay(f, 1000);
        const s = await referrals.summarize(fresh(r), at(2));
        expect(rewards()).toHaveLength(0);
        expect(s.counts.paying).toBe(0);
        expect(s.friends[0]).toMatchObject({ counted: false, paying: false });
    });

    it('a frozen referrer earns nothing new, and is caught up when unfrozen', async () => {
        const r = await referrer();
        const f = friendOf(r);
        pay(f, 1000);
        await referrals.setFrozen(r._id, true);
        let s = await referrals.summarize(fresh(r), at(2));
        expect(s.frozen).toBe(true);
        expect(rewards()).toHaveLength(0);
        await referrals.setFrozen(r._id, false);
        s = await referrals.summarize(fresh(r), at(2));
        expect(s.counts.paying).toBe(1);
        expect(rewards().map((x) => x.kind).sort()).toEqual(['commission', 'paid_coins']);
    });

    it('a friend sees whose link they joined with', async () => {
        const r = await referrer({ name: 'Rahul Verma' });
        const f = friendOf(r);
        const s = await referrals.summarize(fresh(f), at(2));
        expect(s.referredBy).toEqual({ name: 'Rahul V.' });
    });
});

describe('Campus Ambassador', () => {
    async function withPaying(n, over) {
        const r = await referrer(over);
        for (let i = 0; i < n; i++) pay(friendOf(r), 500);
        return r;
    }

    it('can be applied for at 10 paying friends, not before', async () => {
        const nine = await withPaying(9, { collegeName: 'NIT Trichy' });
        await expect(referrals.applyAmbassador(fresh(nine), {}, at(2))).rejects.toMatchObject({ code: 'not_yet', status: 403 });
        const ten = await withPaying(10, { collegeName: 'NIT Trichy' });
        expect((await referrals.summarize(fresh(ten), at(2))).ambassador.canApply).toBe(true);
        await expect(referrals.applyAmbassador(fresh(ten), {}, at(2))).resolves.toMatchObject({ status: 'applied', college: 'NIT Trichy' });
        await expect(referrals.applyAmbassador(fresh(ten), {}, at(2))).rejects.toMatchObject({ code: 'already' });
    });

    it('one per college: the second approval is refused until the first is revoked', async () => {
        const a = await withPaying(10, { collegeName: 'NIT Trichy' });
        const b = await withPaying(10, { collegeName: 'N.I.T. trichy' });
        await referrals.applyAmbassador(fresh(a), {}, at(2));
        await referrals.applyAmbassador(fresh(b), {}, at(2));
        await referrals.decideAmbassador(a._id, 'approve', 'tenadmin', '', at(3));
        expect(fresh(a).ambassador).toMatchObject({ status: 'approved', decidedBy: 'tenadmin' });
        await expect(referrals.decideAmbassador(b._id, 'approve', 'tenadmin', '', at(3))).rejects.toMatchObject({ code: 'college_taken' });
        await referrals.decideAmbassador(a._id, 'revoke', 'tenadmin', 'graduated', at(4));
        await referrals.decideAmbassador(b._id, 'approve', 'tenadmin', '', at(4));
        expect(fresh(b).ambassador.status).toBe('approved');
        expect(mockCalls.notes.filter((n) => n.title === 'You are a TEN Campus Ambassador')).toHaveLength(2);
    });

    it('a rejection tells the student why, and they can apply again', async () => {
        const a = await withPaying(10, { collegeName: 'NIT Trichy' });
        await referrals.applyAmbassador(fresh(a), {}, at(2));
        await referrals.decideAmbassador(a._id, 'reject', 'tenadmin', 'Please apply with your college ID', at(3));
        expect(mockCalls.notes.pop().message).toContain('Please apply with your college ID');
        const s = await referrals.summarize(fresh(a), at(3));
        expect(s.ambassador).toMatchObject({ status: 'rejected', canApply: true, note: 'Please apply with your college ID' });
        await expect(referrals.applyAmbassador(fresh(a), { college: 'NIT Trichy' }, at(4))).resolves.toMatchObject({ status: 'applied' });
    });
});

describe('the sweep', () => {
    it('does nothing while the database is not connected', async () => {
        mongoose.connection.readyState = 0;
        expect(await referrals.settleAll(at(2))).toEqual({ skipped: 'database not connected' });
    });

    it('settles every referrer with a recent friend, counting all of their friends', async () => {
        const r = await referrer();
        const old = friendOf(r, { createdAt: at(-500) });
        pay(old, 1000, { verifiedAt: at(-490), createdAt: at(-490) });     // paid long ago: still a paying friend
        const recent = friendOf(r, { createdAt: at(0) });
        pay(recent, 1000, { verifiedAt: at(1) });
        const quiet = await referrer();
        friendOf(quiet, { createdAt: at(-500) });                          // nobody recent: not swept
        const t = await referrals.settleAll(at(2));
        expect(t).toMatchObject({ referrers: 1, friends: 2, failed: 0 });
        expect(referralCoins(recent)).toBe(200);
        const recentCommission = rewards('commission').find((c) => c.friendId === recent._id);
        expect(recentCommission.rate).toBe(5);
        expect(rewards('commission')).toHaveLength(2);
    });
});

describe('the admin overview', () => {
    it('totals rewards per referrer and lists applications', async () => {
        const r = await referrer({ collegeName: 'NIT Trichy' });
        const f = friendOf(r);
        week1(f);
        pay(f, 1000);
        await settleFor(r);
        const o = await referrals.adminOverview(at(2));
        expect(o.totals).toMatchObject({ referrers: 1, friends: 1, paying: 1, coins: 600, pending: 50, available: 0 });
        expect(o.referrers[0]).toMatchObject({ id: r._id, joined: 1, paying: 1, pending: 50, frozen: false });
    });
});

describe('awardCoins with a refKey (services/v2/coinService.js)', () => {
    it('pays a keyed award once, however often it is asked', async () => {
        const s = student();
        const a = await coinService.awardCoins(s._id, 'Referral bonus', 100, { refKey: 'k1' });
        const b = await coinService.awardCoins(s._id, 'Referral bonus', 100, { refKey: 'k1' });
        expect(a.awarded).toBe(100);
        expect(b).toMatchObject({ awarded: 0, duplicate: true });
        expect(coinsOf(s).totalCoins).toBe(250 + 100);
    });

    it('awards without a key still all count, as before', async () => {
        const s = student();
        await coinService.awardCoins(s._id, 'TASK_APPROVED', 20);
        await coinService.awardCoins(s._id, 'TASK_APPROVED', 20);
        expect(coinsOf(s).totalCoins).toBe(250 + 40);
    });

    it('two different keyed awards racing to open one wallet both count', async () => {
        // The case that lost a friend's 200 coins in the first version: the
        // wallet opened by one award was taken as proof the other was paid.
        const s = student();
        await Promise.all([
            coinService.awardCoins(s._id, 'Week 1 bonus', 100, { refKey: 'week1' }),
            coinService.awardCoins(s._id, 'First payment bonus', 200, { refKey: 'paid' }),
            coinService.awardCoins(s._id, 'First payment bonus', 200, { refKey: 'paid' })
        ]);
        expect(coinsOf(s).totalCoins).toBe(250 + 300);
        expect(coinsOf(s).coinsHistory.map((h) => h.refKey).filter(Boolean).sort()).toEqual(['paid', 'week1']);
    });
});
