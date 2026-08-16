'use strict';

/**
 * Who a person is in chat, and why two portals disagreed about it.
 *
 * Both failures reported from the live portal came from the same place: three
 * separate resolvers, each with its own idea of a staff member's id.
 *
 *   - An admin clicking any conversation was thrown out to the login page.
 *     server.js's resolver had no admin branch at all, so GET
 *     /chat/messages/:room answered 401, and public/session-guard.js treats
 *     every same-origin 401 as "you have been signed out".
 *
 *   - An HR user opening a conversation saw a red "Forbidden" where the
 *     messages should be — on a conversation their own inbox had just listed.
 *     The inbox called them by their email, the message endpoint by their
 *     username, so the room name one built failed the check the other ran. The
 *     same mismatch put the WRONG PERSON in the profile panel: with neither id
 *     matching, "the other participant" fell through to the first name in the
 *     room, which is sometimes yourself.
 *
 * The rule these tests pin: a canonical id for anything new, and an alias list
 * for matching what already exists. Aliases are not a nicety — conversations
 * are already stored under both spellings, and canonicalising without them
 * would leave those messages in the database and reachable by nobody.
 */

const ci = require('../../services/chatIdentity');

const HR_SESSION = { hr: { username: 'hrdirector', email: 'hr.director@ten.com', name: 'Priya', level: 7 } };
const STUDENT_SESSION = { student: { employeeId: 'TEN/AI/1663', name: 'Anmol Kumar', domain: 'Artificial Intelligence', email: 'anmol@example.com' } };
const ADMIN_SESSION = { adminUser: { username: 'tenadmin' } };
const COORD_SESSION = { coordinator: { username: 'web_admin', email: 'web@ten.com', name: 'Ravi', domain: 'Web Development' } };

describe('an admin has a chat identity at all — this is the redirect bug', () => {
  it('resolves an admin session', () => {
    const me = ci.identityFromSession(ADMIN_SESSION);
    expect(me).not.toBeNull();
    expect(me.role).toBe('admin');
    expect(me.id).toBe('tenadmin');
  });

  it('returns null only when nobody is signed in', () => {
    expect(ci.identityFromSession({})).toBeNull();
    expect(ci.identityFromSession(null)).toBeNull();
    expect(ci.identityFromSession(undefined)).toBeNull();
  });

  it('lets an admin session win over another role on the same browser', () => {
    const me = ci.identityFromSession({ adminUser: { username: 'tenadmin' }, student: { employeeId: 'TEN/AI/1' } });
    expect(me.role).toBe('admin');
  });
});

describe('one canonical id, and every alias kept for matching', () => {
  it('calls a staff member by their email, consistently', () => {
    expect(ci.identityFromSession(HR_SESSION).id).toBe('hr.director@ten.com');
    expect(ci.identityFromSession(COORD_SESSION).id).toBe('web@ten.com');
  });

  it('still answers to the username a conversation may have been named with', () => {
    const me = ci.identityFromSession(HR_SESSION);
    expect(ci.isSelf(me, 'hrdirector')).toBe(true);
    expect(ci.isSelf(me, 'hr.director@ten.com')).toBe(true);
  });

  it('falls back to the username when there is no email', () => {
    const me = ci.identityFromSession({ hr: { username: 'legacyhr', name: 'Legacy' } });
    expect(me.id).toBe('legacyhr');
  });

  it('is not confused by case or stray spaces', () => {
    const me = ci.identityFromSession(HR_SESSION);
    expect(ci.isSelf(me, 'HR.Director@TEN.com')).toBe(true);
    expect(ci.isSelf(me, '  hrdirector  ')).toBe(true);
  });

  it('does not answer to somebody else', () => {
    const me = ci.identityFromSession(HR_SESSION);
    expect(ci.isSelf(me, 'someone.else@ten.com')).toBe(false);
    expect(ci.isSelf(me, '')).toBe(false);
    expect(ci.isSelf(me, null)).toBe(false);
  });
});

describe('room membership — the "Forbidden" people saw', () => {
  const hr = ci.identityFromSession(HR_SESSION);
  const student = ci.identityFromSession(STUDENT_SESSION);

  const roomByEmail = ci.dmRoomFor('TEN/AI/1663', 'hr.director@ten.com');
  const roomByUsername = ci.dmRoomFor('TEN/AI/1663', 'hrdirector');

  it('names one room per pair, whichever side asks', () => {
    expect(ci.dmRoomFor('a@x', 'b@x')).toBe(ci.dmRoomFor('b@x', 'a@x'));
  });

  it('admits the HR user to a room named with their email', () => {
    expect(ci.isParticipant(hr, roomByEmail)).toBe(true);
  });

  it('admits the HR user to a room named with their username', () => {
    // THE BUG. This room is listed in their inbox and used to fail the check
    // on the endpoint that loads its messages.
    expect(ci.isParticipant(hr, roomByUsername)).toBe(true);
  });

  it('admits the student to both spellings of the same conversation', () => {
    expect(ci.isParticipant(student, roomByEmail)).toBe(true);
    expect(ci.isParticipant(student, roomByUsername)).toBe(true);
  });

  it('keeps a stranger out', () => {
    const other = ci.identityFromSession({ student: { employeeId: 'TEN/WEB/9999' } });
    expect(ci.isParticipant(other, roomByEmail)).toBe(false);
  });

  it('treats a group room as not a private conversation', () => {
    expect(ci.isParticipant(hr, 'general')).toBe(false);
    expect(ci.dmParticipants('domain_Artificial Intelligence')).toBeNull();
    expect(ci.dmParticipants('dm::only-one-id')).toBeNull();
    expect(ci.dmParticipants(null)).toBeNull();
  });
});

describe('who the conversation is with — the wrong profile in the panel', () => {
  const hr = ci.identityFromSession(HR_SESSION);
  const student = ci.identityFromSession(STUDENT_SESSION);
  const roomByUsername = ci.dmRoomFor('TEN/AI/1663', 'hrdirector');

  it('is the other person, not yourself, under either spelling', () => {
    expect(ci.otherParticipant(hr, roomByUsername)).toBe('TEN/AI/1663');
    expect(ci.otherParticipant(student, roomByUsername)).toBe('hrdirector');
  });

  it('returns null rather than guessing when the room is not yours', () => {
    // Guessing is what put a person's own profile beside somebody else's
    // conversation: nothing matched, so the old code picked the first id in the
    // room name, which was sometimes the reader.
    const outsider = ci.identityFromSession({ student: { employeeId: 'TEN/WEB/9999' } });
    expect(ci.otherParticipant(outsider, roomByUsername)).toBeNull();
  });

  it('returns null for a room, not a private conversation', () => {
    expect(ci.otherParticipant(hr, 'general')).toBeNull();
  });
});

describe('the inbox query finds conversations under every alias', () => {
  const hr = ci.identityFromSession(HR_SESSION);
  const filter = ci.dmRoomFilterFor(hr);

  it('matches a room named with the email', () => {
    expect(filter.chatRoom.test(ci.dmRoomFor('TEN/AI/1663', 'hr.director@ten.com'))).toBe(true);
  });

  it('matches a room named with the username', () => {
    expect(filter.chatRoom.test(ci.dmRoomFor('TEN/AI/1663', 'hrdirector'))).toBe(true);
  });

  it('matches whichever side of the name the id sorted onto', () => {
    // "TEN/AI/1663" sorts before "hrdirector", but "AAA/1" sorts after it, so
    // the id lands on both sides depending on who the other person is.
    expect(filter.chatRoom.test(ci.dmRoomFor('zzz/9', 'hrdirector'))).toBe(true);
    expect(filter.chatRoom.test(ci.dmRoomFor('AAA/1', 'hrdirector'))).toBe(true);
  });

  it('does not match somebody else\'s conversation', () => {
    expect(filter.chatRoom.test(ci.dmRoomFor('TEN/AI/1663', 'someone@ten.com'))).toBe(false);
  });

  it('does not match a room that merely starts with the same characters', () => {
    // "hrdirector2" must not fall into "hrdirector"'s inbox.
    expect(filter.chatRoom.test(ci.dmRoomFor('zzz/9', 'hrdirector2'))).toBe(false);
  });

  it('treats a dot in an email as a literal, not a wildcard', () => {
    const me = ci.identityFromSession({ hr: { username: 'x', email: 'a.b@ten.com' } });
    expect(ci.dmRoomFilterFor(me).chatRoom.test(ci.dmRoomFor('zzz/9', 'aXb@ten.com'))).toBe(false);
  });

  it('matches nothing at all for an empty identity', () => {
    expect(ci.dmRoomFilterFor(null).chatRoom.test('dm::a::b')).toBe(false);
  });
});

describe('database matching keeps both spellings', () => {
  it('offers the id as stored and lowercased, because $in is case-sensitive', () => {
    const me = ci.identityFromSession({ hr: { username: 'HRDirector', email: 'HR.Director@TEN.com' } });
    const ids = ci.matchIds(me);
    expect(ids).toContain('HR.Director@TEN.com');
    expect(ids).toContain('hr.director@ten.com');
    expect(ids).toContain('HRDirector');
    expect(ids).toContain('hrdirector');
  });

  it('has no duplicates when the id is already lowercase', () => {
    const ids = ci.matchIds(ci.identityFromSession(STUDENT_SESSION));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a student is identified by employee ID', () => {
  it('uses the employee ID as the canonical id', () => {
    expect(ci.identityFromSession(STUDENT_SESSION).id).toBe('TEN/AI/1663');
  });

  it('carries the domain through, since it decides their domain room', () => {
    expect(ci.identityFromSession(STUDENT_SESSION).domain).toBe('Artificial Intelligence');
  });

  it('is nobody without an employee ID', () => {
    expect(ci.identityFromSession({ student: { name: 'No ID' } })).toBeNull();
  });

  it('treats a slash in an employee ID as a literal in the inbox query', () => {
    const me = ci.identityFromSession(STUDENT_SESSION);
    const filter = ci.dmRoomFilterFor(me);
    expect(filter.chatRoom.test(ci.dmRoomFor('TEN/AI/1663', 'x@ten.com'))).toBe(true);
  });
});

describe('an inbox is your own conversations, not everyone\'s', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../routes/chatModeration.js'), 'utf8');

  it('does not hand an admin every private conversation in the portal', () => {
    // `/^dm::/` for admins turned their inbox into a surveillance feed, and
    // put other people's conversations on screen before their own. Oversight
    // still exists — it lives on the admin moderation desk.
    const at = source.indexOf('router.get("/dm/threads"');
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 1800);
    // The CODE must not branch on role here — the comment recording why may.
    expect(block).not.toMatch(/chatRoom:\s*\/\^dm::\//);
    expect(block).not.toMatch(/me\.role === "admin"\s*\n?\s*\?/);
    expect(block).toContain('dmRoomFilterFor(me)');
  });

  it('keeps the deliberate oversight route for admins', () => {
    expect(source).toContain('router.get("/admin/rooms"');
  });
});
