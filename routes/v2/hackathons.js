'use strict';

/**
 * Hackathons and ideathons — events, team registration, and the team board.
 *
 * Mounted at /api/v2/hackathons.
 *
 * public/hackathon-portal/ was a complete landing page for a product that did
 * not exist: FIND MY TEAM, REGISTER MY TEAM, "we pair you by stack and
 * timezone", prize copy and a four-per-team rule, all pointing at
 * /register.html — the generic internship signup. A student who followed the
 * call to action registered for an internship.
 *
 * The public reads are deliberately unauthenticated: the portal is a marketing
 * page and the event list has to render for a visitor who has never signed in.
 * Registration is not — a team needs a real person attached to it.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const Hackathon     = require('../../models/Hackathon');
const HackathonTeam = require('../../models/HackathonTeam');

const { requireStudent } = require('../../middleware/sessionAuth');
const { requireRole } = require('../../middleware/roleGuard');
const { ROLES } = require('../../config/roles');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const staffOnly = requireRole(ROLES.HR, ROLES.ADMIN);

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many registration attempts. Please try again shortly.' }
});

/** The fields a visitor may see. Never the internal notes or createdBy. */
function publicEvent(doc, teamCount) {
    return {
        id: String(doc._id),
        slug: doc.slug,
        title: doc.title,
        mode: doc.mode,
        tagline: doc.tagline,
        description: doc.description,
        tracks: doc.tracks || [],
        prize: doc.prize,
        minTeamSize: doc.minTeamSize,
        maxTeamSize: doc.maxTeamSize,
        registrationClosesAt: doc.registrationClosesAt,
        startsAt: doc.startsAt,
        endsAt: doc.endsAt,
        venue: doc.venue,
        status: doc.status,
        teamCount: teamCount || 0
    };
}

// ── Public ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/hackathons — published events, soonest first.
 *
 * Returns an empty array when nothing is scheduled, and the portal says so.
 * That is the honest state for a network that has not announced an event yet,
 * and it is the reason nothing here is seeded with sample events.
 */
router.get('/', async (req, res) => {
    try {
        const filter = { published: true, status: { $ne: 'cancelled' } };
        if (req.query.mode === 'hackathon' || req.query.mode === 'ideathon') {
            filter.mode = req.query.mode;
        }

        const events = await Hackathon.find(filter).sort({ startsAt: 1, createdAt: -1 }).limit(50);
        if (!events.length) return res.json({ success: true, events: [], total: 0 });

        // One grouped count rather than a query per event.
        const counts = await HackathonTeam.aggregate([
            { $match: { hackathonId: { $in: events.map((e) => e._id) }, status: { $ne: 'withdrawn' } } },
            { $group: { _id: '$hackathonId', n: { $sum: 1 } } }
        ]);
        const byId = new Map(counts.map((c) => [String(c._id), c.n]));

        res.json({
            success: true,
            events: events.map((e) => publicEvent(e, byId.get(String(e._id)))),
            total: events.length
        });
    } catch (err) {
        console.error('[hackathons] list failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load events.', events: [] });
    }
});

/**
 * GET /api/v2/hackathons/me/teams — the events this student is signed up for.
 *
 * Declared before /:slug/teams deliberately. Express matches in registration
 * order and both are two segments, so the parameterised route would otherwise
 * swallow this one and look for an event with the slug "me".
 */
router.get('/me/teams', requireStudent, async (req, res) => {
    try {
        const email = String(req.student.email || '').toLowerCase();
        const teams = await HackathonTeam.find({
            $or: [{ leadEmail: email }, { 'members.email': email }]
        }).sort({ registeredAt: -1 }).limit(50).lean();

        res.json({ success: true, teams });
    } catch (err) {
        console.error('[hackathons] my teams failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your teams.', teams: [] });
    }
});

/** GET /api/v2/hackathons/:slug — one event. */
router.get('/:slug', async (req, res) => {
    try {
        const event = await Hackathon.findOne({ slug: String(req.params.slug).toLowerCase(), published: true });
        if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

        const teamCount = await HackathonTeam.countDocuments({
            hackathonId: event._id,
            status: { $ne: 'withdrawn' }
        });

        res.json({
            success: true,
            event: publicEvent(event, teamCount),
            registrationOpen: event.registrationOpen()
        });
    } catch (err) {
        console.error('[hackathons] fetch failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load that event.' });
    }
});

/**
 * GET /api/v2/hackathons/:slug/teams — the FIND MY TEAM board.
 *
 * Only teams that asked to be found, and only the fields needed to decide
 * whether to reach out. Member emails are never returned: contact goes through
 * the join request below, so the board cannot be scraped for addresses.
 */
router.get('/:slug/teams', async (req, res) => {
    try {
        const event = await Hackathon.findOne({ slug: String(req.params.slug).toLowerCase(), published: true });
        if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

        const teams = await HackathonTeam.find({
            hackathonId: event._id,
            lookingForMembers: true,
            status: { $in: ['registered', 'confirmed'] }
        }).sort({ registeredAt: -1 }).limit(100).lean();

        res.json({
            success: true,
            teams: teams.map((t) => ({
                id: String(t._id),
                name: t.name,
                track: t.track,
                pitch: t.pitch,
                timezone: t.timezone,
                wantedSkills: t.wantedSkills || [],
                size: (t.members || []).length,
                openSlots: Math.max(0, event.maxTeamSize - (t.members || []).length),
                skills: [...new Set((t.members || []).flatMap((m) => m.skills || []))].slice(0, 12)
            }))
        });
    } catch (err) {
        console.error('[hackathons] team board failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load teams.', teams: [] });
    }
});

// ── Registration ────────────────────────────────────────────────────────────

/**
 * POST /api/v2/hackathons/:slug/teams — register a team, or enter solo.
 *
 * A solo entrant is a one-member team with lookingForMembers set, which is what
 * puts them on the board above. That is the whole of "solo entry is fine, we
 * pair you by stack" — no separate matching table, no matching cron.
 */
router.post('/:slug/teams', requireStudent, registerLimiter, async (req, res) => {
    try {
        const event = await Hackathon.findOne({ slug: String(req.params.slug).toLowerCase(), published: true });
        if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

        if (!event.registrationOpen()) {
            return res.status(409).json({
                success: false,
                message: 'Registration for this event is not open.'
            });
        }

        const student = req.student;
        const body = req.body || {};

        const name = String(body.name || '').trim();
        if (name.length < 2) {
            return res.status(400).json({ success: false, message: 'Give your team a name.' });
        }

        const leadEmail = String(student.email || body.email || '').toLowerCase().trim();
        if (!leadEmail) {
            return res.status(400).json({ success: false, message: 'No email on your account to register with.' });
        }

        // The lead is always a member, so a "team" is never empty and the size
        // rules below have something to count.
        const members = [{
            studentId: student._id,
            employeeId: student.employeeId || '',
            name: student.name || `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Team lead',
            email: leadEmail,
            role: String(body.role || '').slice(0, 100),
            skills: Array.isArray(body.skills) ? body.skills.slice(0, 12).map(String) : [],
            isLead: true
        }];

        if (Array.isArray(body.members)) {
            body.members.slice(0, event.maxTeamSize - 1).forEach((m) => {
                const memberName  = String((m && m.name)  || '').trim();
                const memberEmail = String((m && m.email) || '').toLowerCase().trim();
                if (!memberName || !memberEmail) return;
                members.push({
                    name: memberName.slice(0, 200),
                    email: memberEmail.slice(0, 320),
                    role: String((m && m.role) || '').slice(0, 100),
                    skills: Array.isArray(m && m.skills) ? m.skills.slice(0, 12).map(String) : [],
                    isLead: false
                });
            });
        }

        if (members.length > event.maxTeamSize) {
            return res.status(400).json({
                success: false,
                message: `This event allows at most ${event.maxTeamSize} per team.`
            });
        }

        let team;
        try {
            team = await HackathonTeam.create({
                hackathonId: event._id,
                eventTitle: event.title,
                name: name.slice(0, 120),
                track: String(body.track || '').slice(0, 120),
                pitch: String(body.pitch || '').slice(0, 2000),
                members,
                lookingForMembers: members.length < event.maxTeamSize && body.lookingForMembers !== false,
                wantedSkills: Array.isArray(body.wantedSkills) ? body.wantedSkills.slice(0, 12).map(String) : [],
                timezone: String(body.timezone || 'IST').slice(0, 60),
                leadEmail
            });
        } catch (err) {
            if (err && err.code === 11000) {
                // Which unique index tripped decides which message is useful.
                const dupName = String(err.message || '').includes('name');
                return res.status(409).json({
                    success: false,
                    message: dupName
                        ? 'A team with that name is already registered for this event.'
                        : 'You have already registered a team for this event.'
                });
            }
            throw err;
        }

        res.json({ success: true, message: `${team.name} is registered for ${event.title}.`, team });
    } catch (err) {
        console.error('[hackathons] registration failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not register your team.' });
    }
});

/** POST /api/v2/hackathons/teams/:id/submit — hand in the build. */
router.post('/teams/:id/submit', requireStudent, async (req, res) => {
    try {
        const email = String(req.student.email || '').toLowerCase();
        const team = await HackathonTeam.findOne({ _id: req.params.id, leadEmail: email });
        if (!team) {
            return res.status(404).json({ success: false, message: 'Only the team lead can submit.' });
        }

        const url = String((req.body && req.body.submissionUrl) || '').trim();
        let parsed;
        try { parsed = new URL(url); } catch (_e) { parsed = null; }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            return res.status(400).json({ success: false, message: 'Give a link starting with http:// or https://' });
        }

        team.submissionUrl = parsed.toString().slice(0, 2000);
        team.submittedAt = new Date();
        await team.save();

        res.json({ success: true, message: 'Submission recorded.', team });
    } catch (err) {
        console.error('[hackathons] submit failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not record that submission.' });
    }
});

// ── Staff ───────────────────────────────────────────────────────────────────

/** POST /api/v2/hackathons/admin — announce an event. */
router.post('/admin', staffOnly, async (req, res) => {
    try {
        const body = req.body || {};
        const title = String(body.title || '').trim();
        if (!title) return res.status(400).json({ success: false, message: 'An event needs a title.' });

        const slug = String(body.slug || title)
            .toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
        if (!slug) return res.status(400).json({ success: false, message: 'Could not build a URL slug from that title.' });

        const event = await Hackathon.create({
            title: title.slice(0, 200),
            slug,
            mode: body.mode === 'ideathon' ? 'ideathon' : 'hackathon',
            tagline: String(body.tagline || '').slice(0, 300),
            description: String(body.description || '').slice(0, 6000),
            tracks: Array.isArray(body.tracks) ? body.tracks.slice(0, 20).map(String) : [],
            prize: String(body.prize || '').slice(0, 300),
            minTeamSize: Number(body.minTeamSize) || 1,
            maxTeamSize: Number(body.maxTeamSize) || 4,
            registrationOpensAt:  body.registrationOpensAt  ? new Date(body.registrationOpensAt)  : null,
            registrationClosesAt: body.registrationClosesAt ? new Date(body.registrationClosesAt) : null,
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
            endsAt:   body.endsAt   ? new Date(body.endsAt)   : null,
            venue: String(body.venue || 'Online').slice(0, 200),
            status: body.status || 'draft',
            published: body.published === true,
            publishedAt: body.published === true ? new Date() : null,
            createdBy: String((req.user && req.user._id) || '')
        });

        res.json({ success: true, event });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ success: false, message: 'An event with that slug already exists.' });
        }
        console.error('[hackathons] create failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not create that event.' });
    }
});

/** PATCH /api/v2/hackathons/admin/:id — edit or publish. */
router.patch('/admin/:id', staffOnly, async (req, res) => {
    try {
        const body = req.body || {};
        const update = {};

        ['title', 'tagline', 'description', 'prize', 'venue'].forEach((f) => {
            if (typeof body[f] === 'string') update[f] = body[f].slice(0, 6000);
        });
        if (Array.isArray(body.tracks)) update.tracks = body.tracks.slice(0, 20).map(String);
        ['registrationOpensAt', 'registrationClosesAt', 'startsAt', 'endsAt'].forEach((f) => {
            if (body[f]) update[f] = new Date(body[f]);
        });
        if (body.status) update.status = body.status;
        if (typeof body.published === 'boolean') {
            update.published = body.published;
            update.publishedAt = body.published ? new Date() : null;
        }

        if (!Object.keys(update).length) {
            return res.status(400).json({ success: false, message: 'Nothing to update.' });
        }

        const event = await Hackathon.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

        res.json({ success: true, event });
    } catch (err) {
        console.error('[hackathons] update failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not update that event.' });
    }
});

/** GET /api/v2/hackathons/admin/:id/teams — the full roster, emails included. */
router.get('/admin/:id/teams', staffOnly, async (req, res) => {
    try {
        const teams = await HackathonTeam.find({ hackathonId: req.params.id })
            .sort({ registeredAt: -1 })
            .lean();
        res.json({ success: true, teams, total: teams.length });
    } catch (err) {
        console.error('[hackathons] roster failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load the roster.' });
    }
});

module.exports = router;
