"use strict";

/**
 * Who a person is, in chat — one answer, used everywhere.
 *
 * A private conversation's room name is built from the two participants' ids:
 * `dm::TEN/AI/1663::hr.director@ten.com`. Membership is therefore a property of
 * the NAME, and everything depends on every part of the portal agreeing on what
 * a given person's id is.
 *
 * They did not agree. There were three separate resolvers:
 *
 *   routes/chatModeration.js  identityOf()             HR -> email || username
 *   server.js                 chatIdentityFromSession() HR -> username || email
 *   server.js                 verifyChatIdentity()      HR -> email for DB
 *                                                             accounts, the
 *                                                             username key for
 *                                                             legacy ones
 *
 * ...and the middle one had no admin branch at all.
 *
 * Two visible failures came out of that, both reported from the live portal:
 *
 *   - An admin clicking any conversation was bounced to the login page.
 *     `chatIdentityFromSession` returned null for an admin session, so
 *     GET /chat/messages/:room answered 401, and every portal reads a 401 as
 *     "you have been signed out".
 *
 *   - An HR user opening a conversation saw a red "Forbidden" where the
 *     messages should be, while the profile panel beside it loaded correctly.
 *     The inbox is served by chatModeration (id = email) and the messages by
 *     server.js (id = username), so the very room the inbox had just listed
 *     failed its own membership check. The same mismatch made the profile panel
 *     show the wrong person: with neither id matching, "the other participant"
 *     fell through to the first name in the room, which is sometimes yourself.
 *
 * The fix is this module, plus one rule: an identity carries a CANONICAL id for
 * anything new, and a list of ALIASES for matching what already exists.
 *
 * Aliases are not optional. Real conversations are already stored under both
 * spellings, and canonicalising alone would orphan every one of them — the
 * messages would still be in the database and no longer reachable by anyone.
 * Any check that asks "is this person in this room?", "did I send this?" or
 * "who is the other participant?" resolves against the whole alias set.
 */

/** Case-insensitive, whitespace-trimmed, and never a blank entry. */
function normalize(value) {
    if (value === undefined || value === null) return "";
    const s = String(value).trim();
    return s;
}

/** Build the alias list: canonical first, no blanks, no duplicates, order kept. */
function uniq(values) {
    const seen = new Set();
    const out = [];
    for (const v of values) {
        const s = normalize(v);
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

/**
 * Chat identity from a session, for every role including admin.
 *
 * Returns null when nobody is signed in — callers answer 401.
 *
 * The canonical id for staff is their email where they have one. That matches
 * the inbox and the directory, which is where conversations are started today;
 * the username remains an alias so conversations started before this still
 * open.
 */
function identityFromSession(session) {
    const s = session || {};

    // Admin first. An admin session outranks any other that happens to be on
    // the same browser, and this branch simply did not exist on the HTTP side,
    // which is what redirected admins to the login page.
    if (s.adminUser) {
        const username = normalize(s.adminUser.username) || "admin";
        return {
            role: "admin",
            id: username,
            aliases: uniq([username, "admin"]),
            name: normalize(s.adminUser.name) || username || "Admin",
            domain: ""
        };
    }

    if (s.hr) {
        const email = normalize(s.hr.email);
        const username = normalize(s.hr.username);
        const id = email || username;
        if (!id) return null;
        return {
            role: "hr",
            id,
            aliases: uniq([email, username]),
            name: normalize(s.hr.name) || username || email,
            domain: "",
            level: s.hr.level || 1
        };
    }

    if (s.coordinator) {
        const email = normalize(s.coordinator.email);
        const username = normalize(s.coordinator.username);
        const id = email || username;
        if (!id) return null;
        return {
            role: "coordinator",
            id,
            aliases: uniq([email, username]),
            name: normalize(s.coordinator.name) || username || email,
            domain: normalize(s.coordinator.domain)
        };
    }

    if (s.student) {
        const employeeId = normalize(s.student.employeeId);
        if (!employeeId) return null;
        return {
            role: "student",
            id: employeeId,
            // A student is identified by employee ID on every surface, so there
            // is nothing to reconcile. The email is listed anyway because a
            // student who is later promoted keeps their old conversations.
            aliases: uniq([employeeId, normalize(s.student.email)]),
            name: normalize(s.student.name) || employeeId,
            domain: normalize(s.student.domain)
        };
    }

    return null;
}

/** Every id this person may appear as, lowercased, for matching. */
function aliasSet(identity) {
    const out = new Set();
    if (!identity) return out;
    const list = Array.isArray(identity.aliases) && identity.aliases.length
        ? identity.aliases
        : [identity.id];
    for (const a of list) {
        const s = normalize(a);
        if (s) out.add(s.toLowerCase());
    }
    return out;
}

/**
 * Ids for an exact-match database query ($in / $nin).
 *
 * aliasSet() lowercases for comparison in JavaScript, but Mongo's $in is
 * case-sensitive, so a stored `senderId` of "HRDirector" would not match a
 * lowercased alias. Both spellings go in.
 */
function matchIds(identity) {
    const out = [];
    const seen = new Set();
    const source = (identity && Array.isArray(identity.aliases) && identity.aliases.length)
        ? identity.aliases
        : [identity && identity.id];
    for (const a of source) {
        const s = normalize(a);
        if (!s) continue;
        for (const form of [s, s.toLowerCase()]) {
            if (seen.has(form)) continue;
            seen.add(form);
            out.push(form);
        }
    }
    return out;
}

/** True when `candidate` is one of this person's ids. */
function isSelf(identity, candidate) {
    const c = normalize(candidate);
    if (!c) return false;
    return aliasSet(identity).has(c.toLowerCase());
}

/**
 * The room name for a private conversation between two people.
 *
 * Sorted, so both participants derive the same name from either direction —
 * one room per pair, not one per sender. The separator is a double colon
 * because employee IDs contain slashes (TEN/WEB/1005) and usernames contain
 * dots and @.
 */
function dmRoomFor(a, b) {
    return "dm::" + [normalize(a), normalize(b)].sort().join("::");
}

/** The two participant ids in a DM room, or null if it is not one. */
function dmParticipants(room) {
    if (typeof room !== "string" || room.indexOf("dm::") !== 0) return null;
    const parts = room.slice(4).split("::");
    return parts.length === 2 && parts[0] && parts[1] ? parts : null;
}

/** Is this person one of the two people in this private conversation? */
function isParticipant(identity, room) {
    const pair = dmParticipants(room);
    if (!pair) return false;
    const mine = aliasSet(identity);
    return pair.some(p => mine.has(normalize(p).toLowerCase()));
}

/**
 * The OTHER person in a private conversation, from this person's point of view.
 *
 * Returns null rather than guessing when neither id belongs to the caller —
 * guessing is what put the wrong profile on screen. A caller that gets null
 * should treat the room as not theirs.
 */
function otherParticipant(identity, room) {
    const pair = dmParticipants(room);
    if (!pair) return null;
    const mine = aliasSet(identity);
    const other = pair.find(p => !mine.has(normalize(p).toLowerCase()));
    if (other === undefined) return null;          // a conversation with oneself
    // Neither side is us: not our conversation.
    if (!pair.some(p => mine.has(normalize(p).toLowerCase()))) return null;
    return other;
}

/**
 * A MongoDB filter matching every DM room this person is in.
 *
 * The room name embeds both ids, so this is a regex over the name rather than
 * a lookup — there is no membership collection. Every alias is included, or a
 * conversation started under the other spelling of their id vanishes from
 * their inbox.
 */
function escapeRegex(value) {
    return normalize(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dmRoomFilterFor(identity) {
    const aliases = Array.from(aliasSet(identity));
    if (!aliases.length) return { chatRoom: /^$/ };     // matches nothing
    const alternatives = aliases
        .map(a => escapeRegex(a))
        .map(a => "(?:" + a + "::|.*::" + a + "$)")
        .join("|");
    // Case-insensitive: emails are stored lowercased in some places and as
    // typed in others, and a room name is not going to be re-cased after the
    // fact.
    return { chatRoom: new RegExp("^dm::(?:" + alternatives + ")", "i") };
}

module.exports = {
    identityFromSession,
    aliasSet,
    matchIds,
    isSelf,
    dmRoomFor,
    dmParticipants,
    isParticipant,
    otherParticipant,
    dmRoomFilterFor,
    escapeRegex
};
