'use strict';

/**
 * Investor desk — venture interest and portfolio holdings.
 *
 * Mounted at /api/v2/investor-desk. The path avoids /api/investor, which is
 * already taken by the investor *profile* routes.
 *
 * public/investor-dashboard.html made two claims it could not keep. "Express
 * Venture Interest" told the investor that the interest was "logged in central
 * databases" while only prepending a div, and the portfolio dialog added a row
 * that disappeared on refresh. Interest now reaches the founder, and a holding
 * survives a page reload.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const InvestorInterest = require('../../models/InvestorInterest');
const InvestorHolding  = require('../../models/InvestorHolding');
const InvestorProfile  = require('../../models/InvestorProfile');
const StartupProfile   = require('../../models/StartupProfile');
const EcosystemNotification = require('../../models/EcosystemNotification');

const { requireRole } = require('../../middleware/roleGuard');
const { ROLES } = require('../../config/roles');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const onlyInvestor = requireRole(ROLES.INVESTOR);
const investorOrFounder = requireRole(ROLES.INVESTOR, ROLES.FOUNDER);

// Expressing interest sends a founder a notification. Cheap to send, not free
// to receive.
const interestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many interest requests in the last hour. Please try again shortly.' }
});

async function profileOf(userId) {
    try {
        return await InvestorProfile.findOne({ userId }).lean();
    } catch (_e) {
        return null;
    }
}

// ── Investor side ───────────────────────────────────────────────────────────

/** GET /api/v2/investor-desk/overview — the whole dashboard in one request. */
router.get('/overview', onlyInvestor, async (req, res) => {
    try {
        const userId = req.user._id;
        const [profile, interests, holdings] = await Promise.all([
            profileOf(userId),
            InvestorInterest.find({ investorId: userId }).sort({ createdAt: -1 }).limit(100).lean(),
            InvestorHolding.find({ investorId: userId }).sort({ investedOn: -1 }).limit(200).lean()
        ]);

        const deployed = holdings
            .filter((h) => h.status === 'active')
            .reduce((sum, h) => sum + (h.amount || 0), 0);

        res.json({
            success: true,
            profile: profile ? {
                fundName: profile.fundName || '',
                investorType: profile.investorType || '',
                stagePreference: profile.stagePreference || [],
                verificationStatus: profile.verificationStatus
            } : null,
            interests,
            holdings,
            totals: {
                interests: interests.length,
                pendingInterests: interests.filter((i) => i.status === 'pending').length,
                holdings: holdings.filter((h) => h.status === 'active').length,
                deployed
            }
        });
    } catch (err) {
        console.error('[investor] overview failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your desk.' });
    }
});

/**
 * GET /api/v2/investor-desk/startups — the discovery grid.
 *
 * The dashboard listed four startups written into the markup — Krypton Solar
 * and friends, with invented team sizes and traction — so every investor
 * "discovered" the same four companies, none of which existed. These are the
 * real startup profiles on the network.
 */
router.get('/startups', onlyInvestor, async (req, res) => {
    try {
        const startups = await StartupProfile.find({ isActive: true })
            .select('startupName industry stage description teamSize website fundingStage verificationStatus')
            .sort({ updatedAt: -1 })
            .limit(60)
            .lean();

        // Which ones has this investor already reached out to? The grid greys
        // those buttons rather than letting the unique index reject the click.
        const mine = await InvestorInterest.find({ investorId: req.user._id })
            .select('startupName -_id')
            .lean();
        const contacted = new Set(mine.map((i) => i.startupName));

        res.json({
            success: true,
            startups: startups.map((s) => ({
                id: String(s._id),
                name: s.startupName,
                industry: s.industry || '',
                stage: s.stage || s.fundingStage || '',
                description: s.description || '',
                teamSize: s.teamSize || 0,
                verified: s.verificationStatus === 'approved',
                contacted: contacted.has(s.startupName)
            }))
        });
    } catch (err) {
        console.error('[investor] startups failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load startups.', startups: [] });
    }
});

/** POST /api/v2/investor-desk/interests — register interest in a startup. */
router.post('/interests', onlyInvestor, interestLimiter, async (req, res) => {
    try {
        const userId = req.user._id;
        const body = req.body || {};

        const startupName = String(body.startupName || '').trim();
        if (!startupName) {
            return res.status(400).json({ success: false, message: 'Which startup?' });
        }

        // Link to the real startup when the investor picked one off the
        // directory, so the founder gets told rather than the row just sitting
        // in the investor's own list.
        let startup = null;
        if (body.startupId) {
            startup = await StartupProfile.findById(body.startupId).lean();
        }
        if (!startup) {
            startup = await StartupProfile.findOne({
                startupName: new RegExp(`^${startupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
            }).lean();
        }

        const profile = await profileOf(userId);

        let interest;
        try {
            interest = await InvestorInterest.create({
                investorId: userId,
                investorName: (profile && profile.fundName) || '',
                startupId: startup ? startup._id : null,
                startupName: startupName.slice(0, 200),
                // StartupProfile keys the owner as founderId, not userId.
                founderId: startup ? (startup.founderId || null) : null,
                message: String(body.message || '').slice(0, 2000)
            });
        } catch (err) {
            if (err && err.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message: 'You have already registered interest in this startup.'
                });
            }
            throw err;
        }

        if (interest.founderId) {
            try {
                await EcosystemNotification.create({
                    userId: interest.founderId,
                    type: 'system_announcement',
                    title: 'An investor registered interest',
                    message: `${interest.investorName || 'An investor'} expressed interest in ${interest.startupName}.`,
                    link: '/founder-os.html#investors',
                    data: { interestId: String(interest._id) }
                });
            } catch (err) {
                console.error('[investor] founder notification failed:', err.message);
            }
        }

        res.json({
            success: true,
            message: interest.founderId
                ? 'Interest registered — the founder has been notified.'
                : 'Interest registered. This startup is not on the network yet, so nobody was notified.',
            interest
        });
    } catch (err) {
        console.error('[investor] interest failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not register that interest.' });
    }
});

/** POST /api/v2/investor-desk/holdings — record a position. */
router.post('/holdings', onlyInvestor, async (req, res) => {
    try {
        const body = req.body || {};

        const startupName = String(body.startupName || '').trim();
        if (!startupName) return res.status(400).json({ success: false, message: 'Which startup?' });

        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
            return res.status(400).json({ success: false, message: 'Enter the amount as a number.' });
        }

        let equityPct = null;
        if (body.equityPct !== undefined && body.equityPct !== null && body.equityPct !== '') {
            // Accepts "4.5" and "4.5%" — the dialog placeholder shows the latter.
            equityPct = Number(String(body.equityPct).replace('%', '').trim());
            if (!Number.isFinite(equityPct) || equityPct < 0 || equityPct > 100) {
                return res.status(400).json({ success: false, message: 'Equity must be between 0 and 100 percent.' });
            }
        }

        const holding = await InvestorHolding.create({
            investorId: req.user._id,
            startupId: body.startupId || null,
            startupName: startupName.slice(0, 200),
            amount,
            equityPct,
            stage: ['pre_seed', 'seed', 'series_a', 'series_b', 'later', 'other'].includes(body.stage)
                ? body.stage : 'seed',
            investedOn: body.investedOn ? new Date(body.investedOn) : new Date(),
            notes: String(body.notes || '').slice(0, 2000)
        });

        res.json({ success: true, message: 'Holding recorded.', holding });
    } catch (err) {
        console.error('[investor] holding failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not record that holding.' });
    }
});

/** DELETE /api/v2/investor-desk/holdings/:id — remove one of your own rows. */
router.delete('/holdings/:id', onlyInvestor, async (req, res) => {
    try {
        const removed = await InvestorHolding.findOneAndDelete({
            _id: req.params.id,
            investorId: req.user._id
        });
        if (!removed) return res.status(404).json({ success: false, message: 'Holding not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error('[investor] holding delete failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not remove that holding.' });
    }
});

// ── Founder side ────────────────────────────────────────────────────────────

/**
 * PATCH /api/v2/investor-desk/interests/:id — the founder answers.
 *
 * The investor and the founder are the only two parties to this row, and only
 * the founder may change its status; the investor's own PATCH would let them
 * mark their own interest "accepted".
 */
router.patch('/interests/:id', investorOrFounder, async (req, res) => {
    try {
        const status = String((req.body && req.body.status) || '');
        if (!['accepted', 'declined', 'meeting_scheduled', 'closed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Unknown status.' });
        }

        const interest = await InvestorInterest.findById(req.params.id);
        if (!interest) return res.status(404).json({ success: false, message: 'Interest not found.' });

        const isFounder = String(interest.founderId || '') === String(req.user._id);
        if (!isFounder) {
            return res.status(403).json({ success: false, message: 'Only the founder can answer this.' });
        }

        interest.status = status;
        interest.respondedAt = new Date();
        interest.founderNote = String((req.body && req.body.founderNote) || '').slice(0, 2000);
        if (req.body && req.body.meetingAt) interest.meetingAt = new Date(req.body.meetingAt);
        await interest.save();

        try {
            await EcosystemNotification.create({
                userId: interest.investorId,
                type: 'system_announcement',
                title: `${interest.startupName} responded`,
                message: `Your interest in ${interest.startupName} is now "${status.replace('_', ' ')}".`,
                link: '/investor-dashboard.html',
                data: { interestId: String(interest._id) }
            });
        } catch (err) {
            console.error('[investor] investor notification failed:', err.message);
        }

        res.json({ success: true, interest });
    } catch (err) {
        console.error('[investor] interest update failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not update that interest.' });
    }
});

/** GET /api/v2/investor-desk/inbound — interest in the founder's startups. */
router.get('/inbound', requireRole(ROLES.FOUNDER), async (req, res) => {
    try {
        const rows = await InvestorInterest.find({ founderId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        res.json({ success: true, interests: rows });
    } catch (err) {
        console.error('[investor] inbound failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load investor interest.' });
    }
});

module.exports = router;
