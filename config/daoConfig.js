'use strict';

/**
 * TEN DAO — the governance rules, in one file.
 *
 * The token is the Coin that already exists. There is no second ledger and no
 * new currency: a student's balance in StudentCoin IS their stake, and this
 * file is what turns that balance into voice. Minting a parallel governance
 * token would mean two numbers that have to agree about the same student
 * forever, and eventually they would not.
 *
 * Three decisions here are worth reading before changing a number.
 *
 * 1. Voice is the SQUARE ROOT of the balance, not the balance.
 *    10,000 coins is 100 votes; 100 coins is 10. A 100x gap in balance
 *    becomes a 10x gap in voice. Straight one-coin-one-vote hands the DAO
 *    permanently to whoever enrolled earliest — the portal mints about 1,120
 *    coins a month to an active student, so a six-month head start is a 6x
 *    balance no newcomer can ever close. A DAO the newest cohort cannot move
 *    is a suggestion box with extra steps.
 *
 * 2. Voting costs nothing and changes no balance.
 *    The weight is read once, at vote time, and written onto the vote. If
 *    voting burned coins, only students with a surplus could afford an
 *    opinion, which is the opposite of the point.
 *
 * 3. RAISING a proposal costs coins, and the cost comes back.
 *    The deposit is refunded when the proposal draws enough voters to have
 *    been worth reading, and burned when it does not. That is the spam filter
 *    — better than a rate limit, because it prices the thing being abused —
 *    and it is the one coin sink in the portal that costs us nothing to
 *    honour. A perk shop would be a second sink, but a perk needs somebody to
 *    actually honour it, so it is not invented here.
 *
 * Why these are not blockchain: on-chain votes at this portal's volume would
 * run about ₹12,500/month in gas, roughly three times the entire AWS bill.
 * The governance is real — the voting rules below are enforced in code and
 * every vote is recorded with the balance it was cast on. What it is not is
 * trustless, and nothing in the portal claims otherwise.
 */

/** Coins staked to raise a proposal. Refunded if the proposal reaches quorum. */
const PROPOSAL_DEPOSIT_COINS =
    parseInt(process.env.DAO_PROPOSAL_DEPOSIT, 10) || 200;

/**
 * Distinct voters needed for a result to count.
 *
 * Deliberately a head count, not a share of total voting weight. A share
 * would need the sum of every holder's weight re-aggregated on every close,
 * and "10 students voted" is a sentence a student can check for themselves.
 */
const QUORUM_VOTERS = parseInt(process.env.DAO_QUORUM_VOTERS, 10) || 10;

/** How long a proposal stays open. */
const VOTING_DAYS = parseInt(process.env.DAO_VOTING_DAYS, 10) || 7;

const CHOICES = Object.freeze(['for', 'against', 'abstain']);

/**
 * Voting weight for a balance.
 *
 * Any holder of at least one coin gets at least one vote — that floor is the
 * point of the DAO, so it is explicit rather than a side effect of Math.floor.
 * A zero balance is zero votes: you have to have done something in the portal
 * to vote on where it goes.
 */
function weightFor(coins) {
    const n = Number(coins);
    if (!Number.isFinite(n) || n < 1) return 0;
    return Math.max(1, Math.floor(Math.sqrt(n)));
}

/** Add up a proposal's votes. Pure — takes the array, touches no database. */
function tallyVotes(votes) {
    const t = { for: 0, against: 0, abstain: 0, voters: 0,
                forWeight: 0, againstWeight: 0, abstainWeight: 0 };
    for (const v of votes || []) {
        if (!v || !CHOICES.includes(v.choice)) continue;
        const w = Number(v.weight) || 0;
        t.voters += 1;
        t[v.choice] += 1;
        t[v.choice + 'Weight'] += w;
    }
    return t;
}

/**
 * What a tally means.
 *
 * Abstain counts toward quorum but not toward the result — which is exactly
 * what abstaining is for: being present without taking a side. A tie fails;
 * the status quo wins when the DAO is split, because changing the portal on a
 * coin flip is worse than leaving it alone.
 */
function outcomeFor(tally) {
    const t = tally || tallyVotes([]);
    const quorumMet = t.voters >= QUORUM_VOTERS;
    const passed = quorumMet && t.forWeight > t.againstWeight;
    let reason;
    if (!quorumMet) reason = `Needed ${QUORUM_VOTERS} voters, got ${t.voters}.`;
    else if (passed) reason = `Carried: ${t.forWeight} for, ${t.againstWeight} against.`;
    else if (t.forWeight === t.againstWeight) reason = `Tied at ${t.forWeight} — no change.`;
    else reason = `Rejected: ${t.againstWeight} against, ${t.forWeight} for.`;
    return { quorumMet, passed, reason, refundDeposit: quorumMet };
}

/** When a proposal raised now stops accepting votes. */
function closesAtFrom(from) {
    const start = from ? new Date(from) : new Date();
    return new Date(start.getTime() + VOTING_DAYS * 24 * 60 * 60 * 1000);
}

module.exports = {
    PROPOSAL_DEPOSIT_COINS,
    QUORUM_VOTERS,
    VOTING_DAYS,
    CHOICES,
    weightFor,
    tallyVotes,
    outcomeFor,
    closesAtFrom
};
