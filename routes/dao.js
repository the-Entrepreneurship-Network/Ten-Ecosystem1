'use strict';

/**
 * The TEN DAO API.
 *
 * Students who hold Coins raise proposals about the portal and vote on them.
 * The rules — how a balance becomes voting weight, what quorum is, what a
 * deposit costs — all live in config/daoConfig.js, which is the file to edit;
 * nothing here hard-codes a governance number.
 *
 * What this router does NOT do is act on a passed proposal. A result is a
 * mandate, not a deploy hook: "passed" means the admin now has a recorded
 * decision with the votes behind it. Wiring outcomes straight into
 * configuration would mean a vote could switch off a paywall or a price, and
 * the first abuse of that would cost real money.
 */

const express = require('express');
const mongoose = require('mongoose');

const { findSessionStudent, sessionExpired } = require('../middleware/sessionAuth');
const { requireAdminAPI } = require('../middleware/adminAuth');
const DaoProposal = require('../models/new/DaoProposal');
const StudentCoin = require('../models/new/StudentCoin');
const { awardCoins, spendCoins } = require('../services/v2/coinService');
const dao = require('../config/daoConfig');

const router = express.Router();

/** How many proposals one student may have open at once. */
const MAX_OPEN_PER_AUTHOR = 3;

async function balanceOf(studentId) {
    const doc = await StudentCoin.findOne({ studentId }).lean();
    return doc ? (doc.totalCoins || 0) : 0;
}

/**
 * What a student is shown. The votes array itself never leaves the server —
 * who voted which way is nobody else's business, and the tally is the only
 * part anyone needs.
 */
function publicView(p, meId) {
    const tally = dao.tallyVotes(p.votes);
    const mine = (p.votes || []).find((v) => String(v.studentId) === String(meId || ''));
    return {
        id: String(p._id),
        title: p.title,
        body: p.body,
        authorName: p.authorName,
        status: p.status,
        closesAt: p.closesAt,
        closedAt: p.closedAt,
        outcomeReason: p.outcomeReason || '',
        depositCoins: p.depositCoins || 0,
        depositRefunded: !!p.depositRefunded,
        tally,
        myVote: mine ? mine.choice : null,
        myWeight: mine ? mine.weight : null
    };
}

/**
 * Close any proposal whose window has passed, and settle its deposit.
 *
 * ponytail: no cron. A proposal closes the first time anybody loads the list
 * after its deadline, which is fine because the list is the only thing that
 * reads a closed proposal. Move this to a scheduled job if a closed result
 * ever needs to be acted on without a student looking at it first.
 *
 * The close is a conditional update filtered on `status: 'open'`, so exactly
 * one caller wins the race and the refund below runs once.
 */
async function settleDue() {
    const due = await DaoProposal.find({ status: 'open', closesAt: { $lte: new Date() } })
        .select('_id votes depositCoins authorStudentId title')
        .limit(50)
        .lean();

    for (const p of due) {
        const outcome = dao.outcomeFor(dao.tallyVotes(p.votes));
        const claimed = await DaoProposal.findOneAndUpdate(
            { _id: p._id, status: 'open' },
            { $set: {
                status: outcome.passed ? 'passed' : 'rejected',
                closedAt: new Date(),
                outcomeReason: outcome.reason,
                depositSettled: true,
                depositRefunded: outcome.refundDeposit
            } },
            { new: true }
        );
        if (!claimed) continue; // another request closed it first

        if (outcome.refundDeposit && p.depositCoins > 0) {
            await awardCoins(p.authorStudentId,
                `DAO deposit refunded: ${p.title}`, p.depositCoins).catch((e) =>
                console.error('[dao] deposit refund failed:', e.message));
        }
    }
}

/** GET /api/dao/proposals — every proposal, open ones first. */
router.get('/proposals', async (req, res) => {
    try {
        await settleDue().catch((e) => console.error('[dao] settle failed:', e.message));

        const me = await findSessionStudent(req);
        const rows = await DaoProposal.find({})
            .sort({ status: 1, closesAt: -1 })
            .limit(100)
            .lean();

        return res.json({
            success: true,
            quorumVoters: dao.QUORUM_VOTERS,
            depositCoins: dao.PROPOSAL_DEPOSIT_COINS,
            votingDays: dao.VOTING_DAYS,
            proposals: rows.map((p) => publicView(p, me && me._id))
        });
    } catch (err) {
        console.error('[dao] list failed:', err);
        return res.status(500).json({ success: false, message: 'Could not load proposals.' });
    }
});

/**
 * GET /api/dao/me — my balance, my voice, and what it costs to propose.
 *
 * Answers 200 with `signedIn: false` rather than 401 when there is no
 * session. This is a read the panel fires on page load, and a 401 carrying
 * X-Session-Expired is the browser's signal to bounce to the login page — so
 * a passive panel answering 401 would throw a signed-out visitor off any page
 * that happens to embed it. The endpoints that actually spend coins or cast a
 * vote still 401, where the bounce is the correct response.
 */
router.get('/me', async (req, res) => {
    try {
        const me = await findSessionStudent(req);
        if (!me) {
            return res.json({
                success: true, signedIn: false, coins: 0, weight: 0, canPropose: false,
                depositCoins: dao.PROPOSAL_DEPOSIT_COINS,
                quorumVoters: dao.QUORUM_VOTERS,
                votingDays: dao.VOTING_DAYS
            });
        }

        const coins = await balanceOf(me._id);
        const openMine = await DaoProposal.countDocuments({
            authorStudentId: me._id, status: 'open'
        });

        return res.json({
            success: true,
            signedIn: true,
            name: me.name || 'Student',
            employeeId: me.employeeId || '',
            coins,
            weight: dao.weightFor(coins),
            canPropose: coins >= dao.PROPOSAL_DEPOSIT_COINS && openMine < MAX_OPEN_PER_AUTHOR,
            openProposals: openMine,
            maxOpenPerAuthor: MAX_OPEN_PER_AUTHOR,
            depositCoins: dao.PROPOSAL_DEPOSIT_COINS,
            quorumVoters: dao.QUORUM_VOTERS,
            votingDays: dao.VOTING_DAYS
        });
    } catch (err) {
        console.error('[dao] me failed:', err);
        return res.status(500).json({ success: false, message: 'Could not read your balance.' });
    }
});

/** POST /api/dao/proposals — raise one. Costs the deposit. */
router.post('/proposals', async (req, res) => {
    try {
        const me = await findSessionStudent(req);
        if (!me) return sessionExpired(res, 'Please sign in to raise a proposal.');

        const title = String((req.body && req.body.title) || '').trim();
        const body = String((req.body && req.body.body) || '').trim();
        if (title.length < 8 || title.length > 140) {
            return res.status(400).json({ success: false,
                message: 'Give it a title between 8 and 140 characters.' });
        }
        if (body.length < 20 || body.length > 4000) {
            return res.status(400).json({ success: false,
                message: 'Say what you are proposing in at least 20 characters.' });
        }

        const openMine = await DaoProposal.countDocuments({
            authorStudentId: me._id, status: 'open'
        });
        if (openMine >= MAX_OPEN_PER_AUTHOR) {
            return res.status(400).json({ success: false,
                message: `You already have ${openMine} proposals open. Wait for one to close.` });
        }

        const deposit = dao.PROPOSAL_DEPOSIT_COINS;
        const paid = await spendCoins(me._id, `DAO proposal deposit: ${title}`, deposit);
        if (!paid) {
            const coins = await balanceOf(me._id);
            return res.status(400).json({ success: false,
                message: `Raising a proposal stakes ${deposit} Coins. You have ${coins}. `
                       + 'You get them back if it reaches quorum.' });
        }

        try {
            const created = await DaoProposal.create({
                title,
                body,
                authorStudentId: me._id,
                authorEmployeeId: me.employeeId || '',
                authorName: me.name || 'Student',
                depositCoins: deposit,
                closesAt: dao.closesAtFrom()
            });
            return res.json({ success: true,
                message: `Proposal raised. ${deposit} Coins staked — returned if `
                       + `${dao.QUORUM_VOTERS} students vote.`,
                proposal: publicView(created.toObject(), me._id) });
        } catch (createErr) {
            // The coins are already gone. Give them back rather than keeping
            // payment for a proposal that does not exist.
            await awardCoins(me._id, `DAO deposit returned (proposal failed)`, deposit)
                .catch(() => {});
            throw createErr;
        }
    } catch (err) {
        console.error('[dao] create failed:', err);
        return res.status(500).json({ success: false, message: 'Could not raise the proposal.' });
    }
});

/** POST /api/dao/proposals/:id/vote — one vote per student, free. */
router.post('/proposals/:id/vote', async (req, res) => {
    try {
        const me = await findSessionStudent(req);
        if (!me) return sessionExpired(res, 'Please sign in to vote.');

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'No such proposal.' });
        }

        const choice = String((req.body && req.body.choice) || '').toLowerCase();
        if (!dao.CHOICES.includes(choice)) {
            return res.status(400).json({ success: false, message: 'Vote for, against or abstain.' });
        }

        const coins = await balanceOf(me._id);
        const weight = dao.weightFor(coins);
        if (weight < 1) {
            return res.status(403).json({ success: false,
                message: 'Earn your first Coin in the portal and you can vote.' });
        }

        /*
         * The duplicate check and the insert are one operation. Reading the
         * votes first and then pushing would let two clicks a few
         * milliseconds apart both pass the check and both be counted.
         */
        const updated = await DaoProposal.findOneAndUpdate(
            { _id: id, status: 'open', closesAt: { $gt: new Date() },
              'votes.studentId': { $ne: me._id } },
            { $push: { votes: {
                studentId: me._id,
                employeeId: me.employeeId || '',
                name: me.name || 'Student',
                choice,
                weight,
                coinsAtVote: coins,
                at: new Date()
            } } },
            { new: true }
        ).lean();

        if (!updated) {
            // Say which of the three reasons it was, rather than "failed".
            const p = await DaoProposal.findById(id).select('status closesAt votes').lean();
            if (!p) return res.status(404).json({ success: false, message: 'No such proposal.' });
            if ((p.votes || []).some((v) => String(v.studentId) === String(me._id))) {
                return res.status(400).json({ success: false, message: 'You have already voted on this.' });
            }
            return res.status(400).json({ success: false, message: 'Voting on this has closed.' });
        }

        return res.json({ success: true,
            message: `Voted ${choice} with ${weight} ${weight === 1 ? 'vote' : 'votes'}.`,
            proposal: publicView(updated, me._id) });
    } catch (err) {
        console.error('[dao] vote failed:', err);
        return res.status(500).json({ success: false, message: 'Could not record your vote.' });
    }
});

/**
 * POST /api/dao/proposals/:id/close — admin ends a vote early.
 *
 * Same code path as the deadline close, so an early close settles the deposit
 * by the same rule. Used for a proposal that has been overtaken by events, or
 * one that should not have been raised.
 */
router.post('/proposals/:id/close', requireAdminAPI, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'No such proposal.' });
        }
        const cancel = !!(req.body && req.body.cancel);

        const p = await DaoProposal.findById(id).lean();
        if (!p) return res.status(404).json({ success: false, message: 'No such proposal.' });
        if (p.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Already closed.' });
        }

        const outcome = dao.outcomeFor(dao.tallyVotes(p.votes));
        // A cancelled proposal always gets its deposit back: the author is not
        // being refused by the DAO, they are being overruled by us.
        const refund = cancel ? true : outcome.refundDeposit;

        const claimed = await DaoProposal.findOneAndUpdate(
            { _id: id, status: 'open' },
            { $set: {
                status: cancel ? 'cancelled' : (outcome.passed ? 'passed' : 'rejected'),
                closedAt: new Date(),
                outcomeReason: cancel ? 'Closed by an administrator.' : outcome.reason,
                depositSettled: true,
                depositRefunded: refund
            } },
            { new: true }
        ).lean();
        if (!claimed) return res.status(400).json({ success: false, message: 'Already closed.' });

        if (refund && p.depositCoins > 0) {
            await awardCoins(p.authorStudentId,
                `DAO deposit refunded: ${p.title}`, p.depositCoins).catch(() => {});
        }

        return res.json({ success: true, proposal: publicView(claimed, null) });
    } catch (err) {
        console.error('[dao] close failed:', err);
        return res.status(500).json({ success: false, message: 'Could not close the proposal.' });
    }
});

module.exports = router;
