'use strict';

/**
 * Refer & Earn.
 *
 * A student's link is /register?ref=stu-<code>. A friend who signs up through
 * it keeps that ref as their signupRef (public/ref.js, utils/signupRef.js), and
 * that ref is the whole connection between the two students.
 *
 * What a referral earns. Everything is worked out again from what has
 * happened, so settling twice, or twice at the same moment, changes nothing:
 *   - the friend finishes their first week (every week-1 task approved):
 *     100 coins each;
 *   - the friend's first approved payment: 200 coins each, and the friend now
 *     counts as a paying friend;
 *   - every approved payment in the friend's first 12 months: a share for the
 *     referrer at their stage's rate. It unlocks 15 days after the payment,
 *     and it is reversed if the payment stops being approved (a refund).
 *
 * Stages, by paying friends: Starter 5%; Promoter from 5, 10%. From 10 the
 * student can apply to be Campus Ambassador, one per college, approved by an
 * admin: 10%, then 20% from 20 paying friends. A payment pays the friend's own
 * referrer only, never anyone above them.
 *
 * Signing up earns nothing by itself. A friend with the referrer's email or
 * phone number earns nothing either way. An admin can freeze a referrer: no
 * new rewards while frozen; they are caught up when the freeze is lifted.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const Payment = require('../models/Payment');
const ReferralReward = require('../models/ReferralReward');
const DomainTask = require('../models/new/DomainTask');
const StudentTaskProgress = require('../models/new/StudentTaskProgress');
const coinService = require('./v2/coinService');

const REF_PREFIX = 'stu-';
const DAY = 24 * 60 * 60 * 1000;

const RULES = Object.freeze({
    coinsWeek1: 100,
    coinsFirstPayment: 200,
    promoterAt: 5,
    ambassadorAt: 10,
    topRateAt: 20,
    rates: Object.freeze({ starter: 5, promoter: 10, ambassador: 10, ambassadorTop: 20 }),
    unlockDays: 15,
    windowMonths: 12,
    minWithdrawal: 500
});
const WINDOW_MS = 365 * DAY;

/* ------------------------------------------------------------------ codes */

// No 0/o, 1/l/i: a code read out over the phone survives.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function newCode() {
    return [...crypto.randomBytes(7)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** The student's code, made and saved the first time it is asked for. */
async function ensureCode(student) {
    if (student.referralCode) return student.referralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const res = await Student.updateOne(
                { _id: student._id, referralCode: { $exists: false } },
                { $set: { referralCode: newCode() } }
            );
            // Made now, or made a moment ago by another request: either way,
            // the stored one is the code.
            const fresh = await Student.findById(student._id).select('referralCode').lean();
            if (fresh && fresh.referralCode) {
                student.referralCode = fresh.referralCode;
                return fresh.referralCode;
            }
            if (!res.matchedCount) break;
        } catch (err) {
            if (!err || err.code !== 11000) throw err;   // that code is taken: draw another
        }
    }
    throw new Error('Could not make a referral code');
}

function linkFor(code) {
    const { PORTAL_URL } = require('../utils/mailer');
    return PORTAL_URL + '/register?ref=' + REF_PREFIX + code;
}

/* ------------------------------------------------------------------ rules */

/** The stage and rate for this many paying friends. */
function stageFor(paying, isAmbassador) {
    if (isAmbassador) {
        return { key: 'ambassador', name: 'Campus Ambassador',
            rate: paying >= RULES.topRateAt ? RULES.rates.ambassadorTop : RULES.rates.ambassador };
    }
    if (paying >= RULES.promoterAt) return { key: 'promoter', name: 'Promoter', rate: RULES.rates.promoter };
    return { key: 'starter', name: 'Starter', rate: RULES.rates.starter };
}

/** Money a friend really paid: approved, more than ₹0, not a fee waiver. */
function isRealPayment(p) {
    return !!p && p.status === 'success' && Number(p.amount) > 0 && !(p.metadata && p.metadata.grantedBy);
}

const paidAtOf = (p) => new Date(p.verifiedAt || p.createdAt);
const joinedAtOf = (s) => new Date(s.createdAt || s._id.getTimestamp());
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const mail = (v) => String(v || '').trim().toLowerCase();

/** Same email or same phone number: the "friend" is the referrer. */
function isSamePerson(a, b) {
    if (mail(a.email) && mail(a.email) === mail(b.email)) return true;
    const pa = digits(a.whatsapp), pb = digits(b.whatsapp);
    return pa.length === 10 && pa === pb;
}

/** "Priya S." — enough for the referrer to know who it is, no more. */
function shortName(s) {
    const parts = String(s.name || [s.firstName, s.lastName].filter(Boolean).join(' ')).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'A friend';
    return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.' : parts[0];
}

function collegeKeyOf(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ----------------------------------------------------------------- settle */

const FRIEND_FIELDS = '_id name firstName lastName email whatsapp createdAt signupRef employeeId domain';
const REFERRER_FIELDS = '_id name firstName lastName email whatsapp referralCode referralFrozen ambassador employeeId domain';

/** Friends whose every week-1 task is approved. */
async function week1Done(friendIds) {
    if (!friendIds.length) return new Set();
    const week1 = await DomainTask.find({ weekNumber: 1 }).distinct('_id');
    if (!week1.length) return new Set();
    const rows = await StudentTaskProgress.find({ studentId: { $in: friendIds }, taskId: { $in: week1 } })
        .select('studentId status').lean();
    const tally = new Map();
    for (const r of rows) {
        const t = tally.get(String(r.studentId)) || { all: 0, approved: 0 };
        t.all += 1;
        if (r.status === 'approved') t.approved += 1;
        tally.set(String(r.studentId), t);
    }
    return new Set([...tally].filter(([, t]) => t.all > 0 && t.approved === t.all).map(([id]) => id));
}

/** Create a reward once. Another settle may have just made it: that is fine. */
async function createOnce(doc) {
    try {
        return await ReferralReward.create(doc);
    } catch (err) {
        if (err && err.code === 11000) return null;
        throw err;
    }
}

/** An in-app note (no email: these come often) for a student. Never throws. */
function tell(student, title, message) {
    const Notification = require('../models/Notification');
    return Notification.notifyStudent(student, { title, message, type: 'success', email: false });
}

/**
 * Pay both students the coins on a coin reward. Each award happens once, and
 * only an award that happened now is announced.
 */
async function payCoins(row, label, referrer, friend) {
    const mine = await coinService.awardCoins(row.referrerId, label.referrer, row.coins, { refKey: row.key + ':referrer' });
    const theirs = await coinService.awardCoins(row.friendId, label.friend, row.coins, { refKey: row.key + ':friend' });
    await ReferralReward.updateOne({ _id: row._id }, { $set: { coinsDone: true } });
    if (mine.awarded) await tell(referrer, `+${row.coins} coins from Refer & Earn`, label.referrerNote);
    if (theirs.awarded) await tell(friend, `+${row.coins} coins`, label.friendNote);
}

/**
 * Bring one referrer's rewards up to date with what their friends have done.
 *
 * Only these friends' rewards are looked at: a reward for a friend left out of
 * `friends` is not touched, so the sweep may pass only recent sign-ups.
 */
async function settle(referrer, friends, now = new Date()) {
    const ids = friends.map((f) => f._id);
    const [payments, week1, rewards] = await Promise.all([
        ids.length
            ? Payment.find({ studentId: { $in: ids }, status: 'success', amount: { $gt: 0 } })
                .select('_id studentId amount status metadata verifiedAt createdAt').lean()
            : [],
        week1Done(ids),
        ids.length ? ReferralReward.find({ referrerId: referrer._id, friendId: { $in: ids } }).lean() : []
    ]);

    const state = friends.map((f) => {
        const eligible = !isSamePerson(referrer, f);
        const joined = joinedAtOf(f);
        const pays = !eligible ? [] : payments
            .filter((p) => String(p.studentId) === String(f._id) && isRealPayment(p)
                && paidAtOf(p) - joined <= WINDOW_MS)
            .sort((a, b) => paidAtOf(a) - paidAtOf(b));
        return { friend: f, eligible, week1: eligible && week1.has(String(f._id)), pays,
            firstPaidAt: pays.length ? paidAtOf(pays[0]) : null };
    });

    // Paying friends at a moment: friends whose first payment came by then.
    const firstPaid = state.filter((s) => s.firstPaidAt).map((s) => s.firstPaidAt.getTime());
    const payingAt = (t) => firstPaid.filter((x) => x <= t).length;
    const isAmbassador = !!(referrer.ambassador && referrer.ambassador.status === 'approved');

    const byKey = new Map(rewards.map((r) => [r.key, r]));
    const writes = { created: 0, coinsPaid: 0, reversed: 0, restored: 0 };

    if (!referrer.referralFrozen) {
        const host = shortName(referrer);
        for (const s of state) {
            if (!s.eligible) continue;
            const who = shortName(s.friend);
            const base = { referrerId: referrer._id, friendId: s.friend._id, status: 'active' };
            const coinRows = [];
            if (s.week1) coinRows.push({ ...base, key: 'week1:' + s.friend._id, kind: 'week1_coins', coins: RULES.coinsWeek1, coinsDone: false,
                label: { referrer: `Referral: ${who} finished week 1`, friend: 'Referral bonus: you finished week 1',
                    referrerNote: `${who} finished week 1 of their internship. They got ${RULES.coinsWeek1} coins too.`,
                    friendNote: `For finishing week 1. You joined with ${host}'s link, so they got ${RULES.coinsWeek1} coins too.` } });
            if (s.pays.length) coinRows.push({ ...base, key: 'paid:' + s.friend._id, kind: 'paid_coins', coins: RULES.coinsFirstPayment, coinsDone: false,
                paymentId: s.pays[0]._id,
                label: { referrer: `Referral: ${who}'s first payment`, friend: 'Referral bonus: your first payment',
                    referrerNote: `${who}'s first payment is approved, so they now count as a paying friend. They got ${RULES.coinsFirstPayment} coins too.`,
                    friendNote: `For your first approved payment. You joined with ${host}'s link, so they got ${RULES.coinsFirstPayment} coins too.` } });

            for (const { label, ...doc } of coinRows) {
                let row = byKey.get(doc.key);
                if (!row) {
                    row = await createOnce(doc);
                    if (!row) continue;          // another settle made it, and pays it
                    writes.created += 1;
                }
                if (!row.coinsDone) {
                    await payCoins(row, label, referrer, s.friend);
                    writes.coinsPaid += 1;
                }
            }

            for (const p of s.pays) {
                const key = 'commission:' + p._id;
                if (byKey.has(key)) continue;
                const paidAt = paidAtOf(p);
                const rate = stageFor(payingAt(paidAt.getTime()), isAmbassador).rate;
                const made = await createOnce({ ...base, key, kind: 'commission', paymentId: p._id,
                    base: Number(p.amount), rate, amount: Math.round(Number(p.amount) * rate) / 100,
                    paidAt, availableAt: new Date(paidAt.getTime() + RULES.unlockDays * DAY) });
                if (made) writes.created += 1;
            }
        }
    }

    // A commission follows its payment: reversed when the payment is no longer
    // approved money, and back again if it is approved once more.
    const stillPaid = new Set(state.flatMap((s) => s.pays.map((p) => String(p._id))));
    for (const r of rewards) {
        if (r.kind !== 'commission') continue;
        const ok = stillPaid.has(String(r.paymentId));
        if (r.status === 'active' && !ok) {
            await ReferralReward.updateOne({ _id: r._id, status: 'active' }, { $set: { status: 'reversed', reversedAt: now } });
            writes.reversed += 1;
        } else if (r.status === 'reversed' && ok) {
            await ReferralReward.updateOne({ _id: r._id, status: 'reversed' }, { $set: { status: 'active', reversedAt: null } });
            writes.restored += 1;
        }
    }

    return { state, paying: firstPaid.length, isAmbassador, writes };
}

const friendsOf = (referrer) => Student.find({ signupRef: REF_PREFIX + referrer.referralCode, _id: { $ne: referrer._id } })
    .select(FRIEND_FIELDS).lean();

/**
 * Settle every referrer whose friends signed up recently enough to earn.
 * The scheduled sweep (startSweep) runs this every 30 minutes.
 */
async function settleAll(now = new Date()) {
    if (mongoose.connection.readyState !== 1) return { skipped: 'database not connected' };
    // Referrers with a friend who can still earn: a friend earns for 12 months,
    // and a month more covers a late refund. Each is then settled with ALL
    // their friends, because a stage counts every paying friend, however old.
    const since = new Date(now.getTime() - WINDOW_MS - 31 * DAY);
    const refs = await Student.distinct('signupRef', { signupRef: /^stu-/, createdAt: { $gte: since } });
    const codes = refs.map((r) => r.slice(REF_PREFIX.length));
    const referrers = codes.length
        ? await Student.find({ referralCode: { $in: codes } }).select(REFERRER_FIELDS).lean()
        : [];
    const totals = { referrers: referrers.length, friends: 0, created: 0, coinsPaid: 0, reversed: 0, restored: 0, failed: 0 };
    // ponytail: one referrer at a time. Fine for thousands of referrers; run
    // them in small batches if a sweep ever takes longer than its 30 minutes.
    for (const r of referrers) {
        try {
            const mine = await friendsOf(r);
            totals.friends += mine.length;
            const { writes } = await settle(r, mine, now);
            for (const k of Object.keys(writes)) totals[k] += writes[k];
        } catch (err) {
            totals.failed += 1;
            console.error('[referrals] settle failed for', String(r._id), err.message);
        }
    }
    return totals;
}

/* ---------------------------------------------------------------- summary */

/**
 * Everything the Refer & Earn page shows the signed-in student. Settles their
 * referrals first, so the page is never behind what has happened.
 */
async function summarize(student, now = new Date()) {
    const code = await ensureCode(student);
    const me = await Student.findById(student._id).select(REFERRER_FIELDS + ' collegeName college signupRef').lean();
    const friends = await friendsOf(me);
    const { state, paying, isAmbassador } = await settle(me, friends, now);
    const rows = await ReferralReward.find({ referrerId: me._id }).sort({ createdAt: -1 }).lean();

    const stage = stageFor(paying, isAmbassador);
    const amb = me.ambassador || {};
    let next = null;
    if (stage.key === 'starter') {
        next = { name: 'Promoter', rate: RULES.rates.promoter, at: RULES.promoterAt, remaining: RULES.promoterAt - paying };
    } else if (stage.key === 'promoter' && paying < RULES.ambassadorAt) {
        next = { name: 'Campus Ambassador', rate: RULES.rates.ambassador, at: RULES.ambassadorAt, remaining: RULES.ambassadorAt - paying, apply: true };
    } else if (stage.key === 'ambassador' && paying < RULES.topRateAt) {
        next = { name: 'Campus Ambassador at 20%', rate: RULES.rates.ambassadorTop, at: RULES.topRateAt, remaining: RULES.topRateAt - paying };
    }

    const money = (n) => Math.round(n * 100) / 100;
    const commissions = rows.filter((r) => r.kind === 'commission');
    const sum = (list) => money(list.reduce((t, r) => t + (r.amount || 0), 0));
    const pending = commissions.filter((r) => r.status === 'active' && new Date(r.availableAt) > now);
    const available = commissions.filter((r) => r.status === 'active' && new Date(r.availableAt) <= now);
    const nameOf = new Map(friends.map((f) => [String(f._id), shortName(f)]));

    let referredBy = null;
    if (me.signupRef && me.signupRef.startsWith(REF_PREFIX)) {
        const r = await Student.findOne({ referralCode: me.signupRef.slice(REF_PREFIX.length) }).select('name firstName lastName').lean();
        if (r && String(r._id) !== String(me._id)) referredBy = { name: shortName(r) };
    }

    return {
        code,
        link: linkFor(code),
        frozen: !!me.referralFrozen,
        stage,
        next,
        counts: { joined: friends.length, week1: state.filter((s) => s.week1).length, paying },
        coins: rows.filter((r) => r.kind !== 'commission' && r.coinsDone).reduce((t, r) => t + r.coins, 0),
        earnings: {
            pending: sum(pending),
            available: sum(available),
            reversed: sum(commissions.filter((r) => r.status === 'reversed')),
            nextUnlock: pending.length ? new Date(Math.min(...pending.map((r) => new Date(r.availableAt).getTime()))) : null,
            history: commissions.map((r) => ({
                friend: nameOf.get(String(r.friendId)) || 'A friend',
                rate: r.rate,
                amount: r.amount,
                paidAt: r.paidAt,
                availableAt: r.availableAt,
                status: r.status === 'reversed' ? 'reversed' : new Date(r.availableAt) > now ? 'pending' : 'available'
            }))
        },
        friends: state
            .sort((a, b) => joinedAtOf(b.friend) - joinedAtOf(a.friend))
            .map((s) => ({
                name: shortName(s.friend),
                joinedAt: joinedAtOf(s.friend),
                week1: s.week1,
                paying: !!s.firstPaidAt,
                counted: s.eligible
            })),
        ambassador: {
            status: amb.status || '',
            college: amb.college || me.collegeName || me.college || '',
            note: amb.status === 'rejected' ? amb.note || '' : '',
            canApply: !me.referralFrozen && paying >= RULES.ambassadorAt && !['applied', 'approved'].includes(amb.status)
        },
        referredBy,
        rules: RULES
    };
}

/* ------------------------------------------------------------- ambassador */

class ReferralError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

async function applyAmbassador(student, { college } = {}, now = new Date()) {
    const s = await summarize(student, now);
    if (s.frozen) throw new ReferralError('frozen', 'Your referral rewards are on hold. Write to the help desk to sort it out.', 403);
    if (['applied', 'approved'].includes(s.ambassador.status)) throw new ReferralError('already', s.ambassador.status === 'approved' ? 'You are already a Campus Ambassador.' : 'Your application is already with TEN.', 409);
    if (s.counts.paying < RULES.ambassadorAt) {
        throw new ReferralError('not_yet', `You can apply at ${RULES.ambassadorAt} paying friends. You have ${s.counts.paying}.`, 403);
    }
    const name = String(college || s.ambassador.college || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!collegeKeyOf(name)) throw new ReferralError('college_needed', 'Enter the name of your college.');
    const res = await Student.updateOne(
        { _id: student._id, 'ambassador.status': { $nin: ['applied', 'approved'] } },
        { $set: { ambassador: { status: 'applied', college: name, collegeKey: collegeKeyOf(name), appliedAt: now,
            decidedAt: null, decidedBy: '', note: '' } } }
    );
    if (!res.matchedCount) throw new ReferralError('already', 'Your application is already with TEN.', 409);
    return { status: 'applied', college: name };
}

/** approve | reject | revoke. One approved ambassador per college. */
async function decideAmbassador(studentId, action, adminName, note = '', now = new Date()) {
    const s = await Student.findById(studentId).select('name employeeId domain ambassador').lean();
    if (!s) throw new ReferralError('not_found', 'Student not found.', 404);
    const amb = { ...(s.ambassador || {}) };
    amb.college = String(amb.college || '').trim();
    const from = { approve: 'applied', reject: 'applied', revoke: 'approved' }[action];
    if (!from) throw new ReferralError('bad_action', 'Action must be approve, reject or revoke.');
    if (amb.status !== from) throw new ReferralError('wrong_state', `This application is "${amb.status || 'none'}", not "${from}".`, 409);

    if (action === 'approve') {
        const clash = await Student.findOne({ _id: { $ne: s._id }, 'ambassador.status': 'approved', 'ambassador.collegeKey': amb.collegeKey })
            .select('name employeeId').lean();
        if (clash) {
            throw new ReferralError('college_taken',
                `${amb.college} already has a Campus Ambassador (${clash.name || 'a student'}, ${clash.employeeId || 'no ID'}). Revoke theirs first, or reject this one.`, 409);
        }
    }
    const status = { approve: 'approved', reject: 'rejected', revoke: '' }[action];
    await Student.updateOne({ _id: s._id, 'ambassador.status': from }, { $set: {
        'ambassador.status': status, 'ambassador.decidedAt': now, 'ambassador.decidedBy': String(adminName || ''),
        'ambassador.note': String(note || '').slice(0, 300) } });

    if (action !== 'revoke') {
        // Emailed too (the Notification model mirrors personal notes to mail).
        const Notification = require('../models/Notification');
        const reason = String(note || '').trim().slice(0, 200);
        await Notification.notifyStudent(s, action === 'approve'
            ? { title: 'You are a TEN Campus Ambassador', type: 'success',
                message: `Your application for ${amb.college} is approved. Your referral rate is now ${RULES.rates.ambassador}%, and ${RULES.rates.ambassadorTop}% from ${RULES.topRateAt} paying friends. Open Refer & Earn to see it.` }
            : { title: 'Your Campus Ambassador application', type: 'info',
                message: `Your application for ${amb.college} was not approved${reason ? ': ' + reason : '.'} You stay a Promoter at ${RULES.rates.promoter}%.` });
    }
    return { status };
}

async function setFrozen(studentId, frozen) {
    const res = await Student.updateOne({ _id: studentId }, { $set: { referralFrozen: !!frozen } });
    if (!res.matchedCount) throw new ReferralError('not_found', 'Student not found.', 404);
    return { frozen: !!frozen };
}

/* ------------------------------------------------------------------ admin */

/**
 * Totals, every referrer with a friend, and the ambassador applications.
 * "Paying" here counts the paying friends already rewarded, so a frozen
 * referrer's new ones are not in it until the freeze is lifted.
 */
async function adminOverview(now = new Date()) {
    // ponytail: reads every reward row. Fine for tens of thousands; aggregate
    // in the database when it grows past that.
    const [rows, friends, applications] = await Promise.all([
        ReferralReward.find({}).select('kind referrerId coins coinsDone amount status availableAt').lean(),
        Student.find({ signupRef: /^stu-/ }).select('signupRef').lean(),
        Student.find({ 'ambassador.status': { $in: ['applied', 'approved'] } })
            .select('name employeeId email collegeName ambassador referralFrozen').lean()
    ]);
    const joinedBy = new Map();
    for (const f of friends) {
        const code = f.signupRef.slice(REF_PREFIX.length);
        joinedBy.set(code, (joinedBy.get(code) || 0) + 1);
    }
    const referrers = joinedBy.size
        ? await Student.find({ referralCode: { $in: [...joinedBy.keys()] } })
            .select('name employeeId email collegeName referralCode referralFrozen ambassador').lean()
        : [];

    const per = new Map();
    const blank = () => ({ paying: 0, coins: 0, pending: 0, available: 0, reversed: 0 });
    const totals = { referrers: referrers.length, friends: friends.length, ...blank() };
    for (const r of rows) {
        const t = per.get(String(r.referrerId)) || blank();
        if (r.kind === 'paid_coins') t.paying += 1;
        if (r.kind !== 'commission' && r.coinsDone) t.coins += r.coins * 2;     // both students
        if (r.kind === 'commission') {
            const bucket = r.status === 'reversed' ? 'reversed' : new Date(r.availableAt) > now ? 'pending' : 'available';
            t[bucket] += r.amount;
        }
        per.set(String(r.referrerId), t);
    }
    for (const t of per.values()) for (const k of Object.keys(t)) totals[k] += t[k];
    const money = (n) => Math.round(n * 100) / 100;
    for (const k of ['pending', 'available', 'reversed']) totals[k] = money(totals[k]);

    return {
        totals,
        referrers: referrers.map((s) => {
            const t = per.get(String(s._id)) || blank();
            return { id: String(s._id), name: s.name || '', employeeId: s.employeeId || '', college: s.collegeName || '',
                code: s.referralCode, joined: joinedBy.get(s.referralCode) || 0, paying: t.paying, coins: t.coins,
                pending: money(t.pending), available: money(t.available), reversed: money(t.reversed),
                frozen: !!s.referralFrozen, ambassador: (s.ambassador && s.ambassador.status) || '' };
        }).sort((a, b) => b.paying - a.paying || b.joined - a.joined),
        applications: applications.map((s) => ({
            id: String(s._id), name: s.name || '', employeeId: s.employeeId || '', email: s.email || '',
            college: s.ambassador.college, status: s.ambassador.status, appliedAt: s.ambassador.appliedAt,
            paying: (per.get(String(s._id)) || blank()).paying, frozen: !!s.referralFrozen,
            collegeTaken: s.ambassador.status === 'applied' && applications.some((o) => o.ambassador.status === 'approved'
                && String(o._id) !== String(s._id) && o.ambassador.collegeKey === s.ambassador.collegeKey)
        })).sort((a, b) => (a.status === 'applied' ? 0 : 1) - (b.status === 'applied' ? 0 : 1))
    };
}

/* ------------------------------------------------------------------ sweep */

let sweepStarted = false;

/** Every 30 minutes, on the cron worker only (server.js decides which). */
function startSweep() {
    if (sweepStarted) return;
    sweepStarted = true;
    const cron = require('node-cron');
    cron.schedule('*/30 * * * *', () => {
        settleAll().then((t) => {
            if (t.created || t.coinsPaid || t.reversed || t.restored || t.failed) console.log('[referrals] sweep:', JSON.stringify(t));
        }).catch((err) => console.error('[referrals] sweep failed:', err.message));
    }, { timezone: 'Asia/Kolkata' });
    console.log('[referrals] settle sweep scheduled every 30 minutes');
}

module.exports = {
    RULES, REF_PREFIX, ReferralError,
    ensureCode, linkFor, stageFor, isRealPayment, isSamePerson, shortName, collegeKeyOf,
    settle, settleAll, summarize, applyAmbassador, decideAmbassador, setFrozen, adminOverview, startSweep
};
