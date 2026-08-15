'use strict';

/**
 * The chat group for a student's domain.
 *
 * Mounted at /api/v2/groups.
 *
 * public/groups.html resolved a domain to an invite link through a chain of
 * if statements returning "https://chat.whatsapp.com/web-dev-ten",
 * "https://chat.whatsapp.com/mern-ten" and so on. A real WhatsApp invite is an
 * opaque token, so every one of those links was dead, and moving a group meant
 * editing HTML and redeploying.
 */

const express = require('express');

const DomainGroup = require('../../models/DomainGroup');
const { sessionEmployeeId } = require('../../middleware/sessionAuth');
const { requireRole } = require('../../middleware/roleGuard');
const { ROLES } = require('../../config/roles');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const staffOnly = requireRole(ROLES.HR, ROLES.ADMIN);

// A student is told to click this. Only real chat hosts, only https.
const ALLOWED_HOSTS = [
    'chat.whatsapp.com',
    't.me',
    'telegram.me',
    'discord.gg',
    'discord.com'
];

function safeInvite(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    let parsed;
    try { parsed = new URL(value); } catch (_e) { return null; }
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const ok = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) return null;
    return parsed.toString().slice(0, 2000);
}

/**
 * GET /api/v2/groups — every active group.
 *
 * Public: the page is a directory and a signed-out visitor may look at it.
 * An empty list is the honest answer before anyone has entered a real invite,
 * and the page says the groups are being set up rather than showing a dead link.
 */
router.get('/', async (req, res) => {
    try {
        const groups = await DomainGroup.find({ active: true })
            .select('domain label inviteUrl platform note -_id')
            .sort({ domain: 1 })
            .lean();
        res.json({ success: true, groups, total: groups.length });
    } catch (err) {
        console.error('[groups] list failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load groups.', groups: [] });
    }
});

/** GET /api/v2/groups/mine — the group for the signed-in student's domain. */
router.get('/mine', async (req, res) => {
    try {
        const employeeId = sessionEmployeeId(req);
        if (!employeeId) return res.json({ success: true, group: null, signedIn: false });

        const Student = require('../../models/Student');
        const student = await Student.findOne({ employeeId }).select('domain').lean();
        if (!student || !student.domain) {
            return res.json({ success: true, group: null, signedIn: true, domain: null });
        }

        const group = await DomainGroup.findOne({ domain: student.domain, active: true })
            .select('domain label inviteUrl platform note -_id')
            .lean();

        res.json({ success: true, signedIn: true, domain: student.domain, group: group || null });
    } catch (err) {
        console.error('[groups] mine failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your group.' });
    }
});

/** PUT /api/v2/groups/:domain — set or replace a domain's invite. */
router.put('/:domain', staffOnly, async (req, res) => {
    try {
        const domain = String(req.params.domain || '').trim();
        if (!domain) return res.status(400).json({ success: false, message: 'Which domain?' });

        const body = req.body || {};
        const inviteUrl = safeInvite(body.inviteUrl);
        if (!inviteUrl) {
            return res.status(400).json({
                success: false,
                message: `The invite must be an https link on one of: ${ALLOWED_HOSTS.join(', ')}`
            });
        }

        const group = await DomainGroup.findOneAndUpdate(
            { domain },
            {
                domain,
                label: String(body.label || '').slice(0, 200),
                inviteUrl,
                platform: ['whatsapp', 'telegram', 'discord', 'slack', 'other'].includes(body.platform)
                    ? body.platform : 'whatsapp',
                active: body.active !== false,
                note: String(body.note || '').slice(0, 500),
                updatedBy: String((req.user && req.user._id) || '')
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, group });
    } catch (err) {
        console.error('[groups] upsert failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not save that group.' });
    }
});

/** DELETE /api/v2/groups/:domain — retire a group without losing the record. */
router.delete('/:domain', staffOnly, async (req, res) => {
    try {
        const group = await DomainGroup.findOneAndUpdate(
            { domain: String(req.params.domain || '').trim() },
            { active: false },
            { new: true }
        );
        if (!group) return res.status(404).json({ success: false, message: 'No group for that domain.' });
        res.json({ success: true, group });
    } catch (err) {
        console.error('[groups] retire failed:', err.message);
        res.status(500).json({ success: false, message: 'Could not retire that group.' });
    }
});

module.exports = router;
