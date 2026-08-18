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
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// public/paytm-qr.jpeg is corrupt in the repository — it begins with UTF-8
// replacement characters instead of the JPEG magic bytes, so it has never
// rendered anywhere it was used. The QR is generated per request instead, and
// it carries the amount, so the payer's UPI app pre-fills it.
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_e) { /* /qr degrades to 404 */ }

const Hackathon     = require('../../models/Hackathon');
const HackathonTeam = require('../../models/HackathonTeam');
const { BUSINESS_UPI } = require('../../config/payment');

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

/** Deep link so a phone opens its UPI app with the amount already filled. */
function upiLink(amount) {
    return 'upi://pay?' + [
        'pa=' + encodeURIComponent(BUSINESS_UPI.upiId),
        'pn=' + encodeURIComponent(BUSINESS_UPI.payeeName),
        'am=' + encodeURIComponent(String(amount)),
        'cu=INR',
        'tn=' + encodeURIComponent('TEN Hackathon entry')
    ].join('&');
}

/**
 * Team codes are the whole auth story here: no email, no password. So they are
 * drawn from the CSPRNG, not Math.random, and skip the characters people
 * misread when copying one off a screen (0/O, 1/I).
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function newTeamCode() {
    const bytes = crypto.randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
}

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
        entryFee: doc.entryFee == null ? 200 : doc.entryFee,
        minTeamSize: doc.minTeamSize,
        maxTeamSize: doc.maxTeamSize,
        registrationClosesAt: doc.registrationClosesAt,
        startsAt: doc.startsAt,
        endsAt: doc.endsAt,
        venue: doc.venue,
        status: doc.status,
        teamCount: teamCount || 0,
        // What the entrant scans and pays. qrImage is generated below from this
        // same UPI identity, with the amount baked in; the id and payee are also
        // sent as text so a scanner failure is not a dead end.
        payment: {
            upiId: BUSINESS_UPI.upiId,
            payeeName: BUSINESS_UPI.payeeName,
            qrImage: `/api/v2/hackathons/qr?amount=${doc.entryFee == null ? 200 : doc.entryFee}`,
            amount: doc.entryFee == null ? 200 : doc.entryFee
        }
    };
}

// ── Public ──────────────────────────────────────────────────────────────────

/**
 * The always-on registration pool.
 *
 * The portal promises "register once and you are in the pool for every
 * hackathon and ideathon TEN runs". With no event in the database that promise
 * was a dead end: REGISTER MY TEAM scrolled to a section offering only "check
 * your status". So when nothing is published, we open this one instead of
 * showing an empty page. Staff rename, schedule, or close it from the admin
 * console like any other event — and once they have touched it, we never
 * recreate it behind their backs.
 */
const POOL_SLUG = 'ten-hackathon-ideathon';

async function ensurePoolEvent() {
    const existing = await Hackathon.findOne({ slug: POOL_SLUG });
    if (existing) {
        // Staff closed or cancelled it — that is a decision, not a gap to fill.
        return existing.published && existing.status !== 'cancelled' ? existing : null;
    }
    try {
        return await Hackathon.create({
            title: 'TEN Hackathon & Ideathon',
            slug: POOL_SLUG,
            mode: 'hackathon',
            tagline: 'Register once — you are in the pool for every hackathon and ideathon TEN runs.',
            description: 'Build in 48 hours or pitch an idea in 24. Register your team, pay the '
                + 'entry fee, and we place you in the next event with your track and team on file.',
            tracks: [],
            minTeamSize: 1,
            maxTeamSize: 4,
            venue: 'Online',
            status: 'registration_open',
            published: true,
            publishedAt: new Date(),
            createdBy: 'system'
        });
    } catch (err) {
        // Two first requests raced; the other one won.
        if (err && err.code === 11000) return Hackathon.findOne({ slug: POOL_SLUG });
        throw err;
    }
}

/**
 * GET /api/v2/hackathons — published events, soonest first.
 *
 * Never returns an empty list unless staff have deliberately closed the pool:
 * a portal whose only call to action is "register" must always have something
 * to register for.
 */
router.get('/', async (req, res) => {
    try {
        const filter = { published: true, status: { $ne: 'cancelled' } };
        if (req.query.mode === 'hackathon' || req.query.mode === 'ideathon') {
            filter.mode = req.query.mode;
        }

        let events = await Hackathon.find(filter).sort({ startsAt: 1, createdAt: -1 }).limit(50);
        if (!events.length) {
            const pool = await ensurePoolEvent();
            events = pool && (!filter.mode || pool.mode === filter.mode) ? [pool] : [];
        }
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

/**
 * GET /api/v2/hackathons/registration-status?email=&ref= — check my status.
 *
 * No login. The email (and optional reference id) is only a lookup key, never
 * mailed to. Declared before /:slug for the same reason as /me/teams above —
 * otherwise the parameterised route swallows it. Returns each matching team's
 * payment/confirmation state so the portal can unlock once an admin approves.
 */
router.get('/registration-status', async (req, res) => {
    try {
        const email = String(req.query.email || '').toLowerCase().trim();
        const ref   = String(req.query.ref || '').trim();
        const or = [];
        if (/^[a-f0-9]{24}$/i.test(ref)) or.push({ _id: ref });
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) or.push({ leadEmail: email });
        if (!or.length) return res.status(400).json({ success: false, message: 'Enter the email you registered with.' });

        const teams = await HackathonTeam.find({ $or: or }).sort({ createdAt: -1 }).limit(20).lean();
        res.json({
            success: true,
            registrations: teams.map((t) => ({
                reference: String(t._id),
                code: t.code || '',
                team: t.name,
                event: t.eventTitle,
                paymentStatus: t.paymentStatus,
                confirmed: t.paymentStatus === 'confirmed',
                rejectionReason: t.paymentStatus === 'rejected' ? (t.rejectionReason || '') : '',
                submissionUrl: t.submissionUrl || ''
            }))
        });
    } catch (err) {
        console.error('[hackathons] status lookup failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not check status.' });
    }
});

// ── The team's own code: invite link + login, with no email anywhere ────────

const joinLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,                       // a venue shares one NAT; 10 would lock out a floor
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please try again shortly.' }
});

/**
 * GET /api/v2/hackathons/qr?amount=200 — the UPI QR as a PNG.
 *
 * Declared before /:slug so the slug route does not swallow it.
 */
router.get('/qr', async (req, res) => {
    try {
        if (!QRCode) return res.status(404).end();
        const amount = Math.min(100000, Math.max(0, Number(req.query.amount) || 200));
        const png = await QRCode.toBuffer(upiLink(amount), {
            type: 'png', width: 480, margin: 1,
            color: { dark: '#000000', light: '#ffffff' }
        });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(png);
    } catch (err) {
        console.error('[hackathons] qr failed:', err.message);
        res.status(500).end();
    }
});

/**
 * What a team sees about itself. Deliberately excludes the lead's email and
 * phone: the code travels in an invite link, and a forwarded link must not hand
 * a stranger the organiser's contact details.
 */
function teamPayload(team, event) {
    const max = (event && event.maxTeamSize) || 4;
    return {
        code: team.code,
        name: team.name,
        track: team.track || '',
        pitch: team.pitch || '',
        status: team.status,
        paymentStatus: team.paymentStatus,
        paymentAmount: team.paymentAmount || 0,
        paymentRef: team.paymentRef || '',
        rejectionReason: team.paymentStatus === 'rejected' ? (team.rejectionReason || '') : '',
        confirmed: team.paymentStatus === 'confirmed',
        members: (team.members || []).map((m) => ({
            name: m.name, role: m.role || '', skills: m.skills || [], isLead: !!m.isLead
        })),
        maxTeamSize: max,
        seatsLeft: Math.max(0, max - (team.members || []).length),
        lookingForMembers: !!team.lookingForMembers,
        wantedSkills: team.wantedSkills || [],
        submissionUrl: team.submissionUrl || '',
        submittedAt: team.submittedAt,
        registeredAt: team.registeredAt,
        event: event ? {
            title: event.title, slug: event.slug, mode: event.mode,
            startsAt: event.startsAt, endsAt: event.endsAt, venue: event.venue,
            prize: event.prize, tracks: event.tracks || []
        } : null
    };
}

/** Find a team by its code, plus the event it belongs to. */
async function findByCode(code) {
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (clean.length < 6) return {};
    const team = await HackathonTeam.findOne({ code: clean });
    if (!team) return {};
    const event = await Hackathon.findById(team.hackathonId);
    return { team, event };
}

/** GET /api/v2/hackathons/team/:code — sign in and load the dashboard. */
router.get('/team/:code', async (req, res) => {
    try {
        const { team, event } = await findByCode(req.params.code);
        if (!team) return res.status(404).json({ success: false, message: 'No team found for that code.' });
        res.json({ success: true, team: teamPayload(team, event) });
    } catch (err) {
        console.error('[hackathons] team lookup failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load that team.' });
    }
});

/**
 * POST /api/v2/hackathons/team/:code/join — accept an invite.
 *
 * A name is all it takes. There is no email in this portal, so the invite link
 * is the proof of invitation, and the team size cap is enforced here rather
 * than trusted from the browser.
 */
router.post('/team/:code/join', joinLimiter, async (req, res) => {
    try {
        const { team, event } = await findByCode(req.params.code);
        if (!team) return res.status(404).json({ success: false, message: 'That invite link is not valid.' });
        if (team.status === 'withdrawn' || team.status === 'disqualified') {
            return res.status(409).json({ success: false, message: 'This team is no longer taking part.' });
        }

        const name = String((req.body && req.body.name) || '').trim();
        if (name.length < 2) return res.status(400).json({ success: false, message: 'Enter your name.' });

        const max = (event && event.maxTeamSize) || 4;
        if ((team.members || []).length >= max) {
            return res.status(409).json({ success: false, message: `This team is full (${max} members).` });
        }
        if ((team.members || []).some((m) => m.name.toLowerCase() === name.toLowerCase())) {
            return res.status(409).json({ success: false, message: 'Someone with that name is already on the team.' });
        }

        team.members.push({
            name: name.slice(0, 200),
            role: String((req.body && req.body.role) || '').slice(0, 100),
            skills: Array.isArray(req.body && req.body.skills) ? req.body.skills.slice(0, 12).map(String) : [],
            isLead: false
        });
        if (team.members.length >= max) team.lookingForMembers = false;
        await team.save();

        res.json({ success: true, message: `You are on ${team.name}.`, team: teamPayload(team, event) });
    } catch (err) {
        console.error('[hackathons] join failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not join that team.' });
    }
});

/** PATCH /api/v2/hackathons/team/:code — edit the pitch / open the team up. */
router.patch('/team/:code', joinLimiter, async (req, res) => {
    try {
        const { team, event } = await findByCode(req.params.code);
        if (!team) return res.status(404).json({ success: false, message: 'No team found for that code.' });
        const b = req.body || {};

        if (typeof b.pitch === 'string') team.pitch = b.pitch.slice(0, 2000);
        if (typeof b.lookingForMembers === 'boolean') team.lookingForMembers = b.lookingForMembers;
        if (Array.isArray(b.wantedSkills)) team.wantedSkills = b.wantedSkills.slice(0, 12).map(String);
        // A full team is never listed as looking, whatever the browser says.
        if ((team.members || []).length >= ((event && event.maxTeamSize) || 4)) team.lookingForMembers = false;

        await team.save();
        res.json({ success: true, team: teamPayload(team, event) });
    } catch (err) {
        console.error('[hackathons] team update failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not save that.' });
    }
});

/**
 * POST /api/v2/hackathons/team/:code/submit — hand in the build.
 *
 * Only once an admin has confirmed the payment, so an unverified team cannot
 * occupy a judging slot.
 */
router.post('/team/:code/submit', joinLimiter, async (req, res) => {
    try {
        const { team, event } = await findByCode(req.params.code);
        if (!team) return res.status(404).json({ success: false, message: 'No team found for that code.' });
        if (team.paymentStatus !== 'confirmed') {
            return res.status(409).json({ success: false, message: 'Submissions open once an admin confirms your payment.' });
        }

        const raw = String((req.body && req.body.submissionUrl) || '').trim();
        let parsed;
        try { parsed = new URL(raw); } catch (_e) { parsed = null; }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            return res.status(400).json({ success: false, message: 'Give a link starting with http:// or https://' });
        }

        team.submissionUrl = parsed.toString().slice(0, 2000);
        team.submittedAt = new Date();
        await team.save();
        res.json({ success: true, message: 'Submission recorded.', team: teamPayload(team, event) });
    } catch (err) {
        console.error('[hackathons] code submit failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not record that submission.' });
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
            status: { $in: ['registered', 'confirmed'] },
            // A team awaiting payment approval isn't on the board yet — only
            // confirmed teams and legacy logged-in (unpaid) ones appear.
            paymentStatus: { $in: ['confirmed', 'unpaid'] }
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

/**
 * POST /api/v2/hackathons/:slug/register-public — register + pay, no login.
 *
 * The hackathon portal is deliberately separate from the student login: anyone
 * can enter with a form (name, email, phone, team, members) and a UPI reference
 * for the entry fee they paid by scanning the QR. The team is stored
 * payment-pending and an ADMIN verifies the reference before it is confirmed.
 * No email is sent anywhere; the email is only a lookup key for "check status".
 *
 * When the email system lands later, this is where a confirmation mail and an
 * account-with-credentials would hook on — nothing here needs to change.
 */
router.post('/:slug/register-public', registerLimiter, async (req, res) => {
    try {
        const event = await Hackathon.findOne({ slug: String(req.params.slug).toLowerCase(), published: true });
        if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });
        if (!event.registrationOpen()) {
            return res.status(409).json({ success: false, message: 'Registration for this event is not open.' });
        }

        const body = req.body || {};
        const teamName  = String(body.teamName || '').trim();
        const leadName  = String(body.leadName || '').trim();
        const leadEmail = String(body.leadEmail || '').toLowerCase().trim();
        const leadPhone = String(body.leadPhone || '').replace(/[^\d+]/g, '').slice(0, 20);
        const utr       = String(body.utr || '').trim();

        if (teamName.length < 2) return res.status(400).json({ success: false, message: 'Give your team a name.' });
        if (leadName.length  < 2) return res.status(400).json({ success: false, message: 'Enter your name.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) {
            return res.status(400).json({ success: false, message: 'Enter a valid email.' });
        }
        if (leadPhone.replace(/\D/g, '').length < 10) {
            return res.status(400).json({ success: false, message: 'Enter a valid phone number.' });
        }
        // The UTR is the proof of payment the admin verifies. Bank UTRs are 12
        // digits; other UPI refs vary, so accept 6+ alphanumerics.
        if (!/^[a-zA-Z0-9]{6,}$/.test(utr)) {
            return res.status(400).json({ success: false, message: 'Enter the UPI reference (UTR) from your payment app.' });
        }

        const members = [{
            name: leadName.slice(0, 200),
            email: leadEmail.slice(0, 320),
            role: String(body.role || '').slice(0, 100),
            skills: Array.isArray(body.skills) ? body.skills.slice(0, 12).map(String) : [],
            isLead: true
        }];
        if (Array.isArray(body.members)) {
            body.members.slice(0, Math.max(0, event.maxTeamSize - 1)).forEach((m) => {
                const mn = String((m && m.name) || '').trim();
                const me = String((m && m.email) || '').toLowerCase().trim();
                if (!mn || !me) return;
                members.push({ name: mn.slice(0, 200), email: me.slice(0, 320),
                    role: String((m && m.role) || '').slice(0, 100),
                    skills: Array.isArray(m && m.skills) ? m.skills.slice(0, 12).map(String) : [],
                    isLead: false });
            });
        }
        if (members.length > event.maxTeamSize) {
            return res.status(400).json({ success: false, message: `This event allows at most ${event.maxTeamSize} per team.` });
        }

        let team = null;
        // The code is the entrant's only key to this team, so a collision is
        // ours to retry away rather than something to report back to them.
        for (let attempt = 0; attempt < 5 && !team; attempt++) {
        try {
            team = await HackathonTeam.create({
                code: newTeamCode(),
                hackathonId: event._id,
                eventTitle: event.title,
                name: teamName.slice(0, 120),
                track: String(body.track || '').slice(0, 120),
                pitch: String(body.pitch || '').slice(0, 2000),
                members,
                lookingForMembers: members.length < event.maxTeamSize && body.lookingForMembers !== false,
                wantedSkills: Array.isArray(body.wantedSkills) ? body.wantedSkills.slice(0, 12).map(String) : [],
                timezone: String(body.timezone || 'IST').slice(0, 60),
                leadEmail,
                leadPhone,
                status: 'registered',
                // Pending until an admin verifies the reference. The amount is
                // the event's own fee, never anything the form sent.
                paymentStatus: 'pending',
                paymentRef: utr.slice(0, 60),
                paymentAmount: event.entryFee == null ? 200 : event.entryFee,
                paidAt: new Date()
            });
        } catch (err) {
            if (err && err.code === 11000) {
                // A code clash is ours to fix, not the entrant's — try again.
                if (/code_1|\bcode\b/.test(String(err.message || ''))) continue;
                const dupName = String(err.message || '').includes('name');
                return res.status(409).json({ success: false, message: dupName
                    ? 'A team with that name is already registered for this event.'
                    : 'This email has already registered a team for this event. Use "Check status".' });
            }
            throw err;
        }
        }
        if (!team) {
            return res.status(500).json({ success: false, message: 'Could not allocate a team code. Please try again.' });
        }

        res.json({
            success: true,
            message: 'Payment received. An admin will verify it shortly.',
            reference: String(team._id),
            code: team.code,
            paymentStatus: team.paymentStatus,
            team: { id: String(team._id), name: team.name, event: event.title }
        });
    } catch (err) {
        console.error('[hackathons] public registration failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not register. Please try again.' });
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
