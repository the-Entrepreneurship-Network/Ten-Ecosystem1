'use strict';

/**
 * Room addressing and access for private messages and admin oversight.
 *
 * These are the rules that decide who can read a private conversation, so
 * getting them wrong exposes one student's messages to another. They are
 * asserted here against the same logic the server runs, extracted from
 * server.js so the test cannot drift from the implementation.
 */

const fs = require('fs');
const path = require('path');

// server.js is a 9,000-line monolith that connects to Mongo on require, so the
// four pure functions under test are lifted out and evaluated in isolation.
const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

function lift(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server.js`);
  let depth = 0, i = source.indexOf('{', start);
  const from = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

// Room NAMING and membership moved into services/chatIdentity so server.js,
// routes/chatModeration.js and the socket layer could stop disagreeing about
// who a person is. canAccessRoom and canDeleteIn are still server.js's, and
// call into that module — so it is passed in rather than lifted.
const chatIdentity = require('../../services/chatIdentity');

// eslint-disable-next-line no-new-func
const ctx = new Function('chatIdentity', `
  const dmRoomFor      = chatIdentity.dmRoomFor;
  const dmParticipants = chatIdentity.dmParticipants;
  ${lift('roomsAllowedFor')}
  ${lift('canAccessRoom')}
  ${lift('canDeleteIn')}
  return { dmRoomFor, dmParticipants, roomsAllowedFor, canAccessRoom, canDeleteIn };
`)(chatIdentity);

const { dmRoomFor, dmParticipants, roomsAllowedFor, canAccessRoom, canDeleteIn } = ctx;

const student  = { role: 'student',     id: 'TEN/WEB/1005', domain: 'Web Development' };
const student2 = { role: 'student',     id: 'TEN/AI/2001',  domain: 'Data Science' };
const coord    = { role: 'coordinator', id: 'web@ten.com',  domain: 'Web Development' };
const hr       = { role: 'hr',          id: 'hr@ten.com',   domain: '' };
const admin    = { role: 'admin',       id: 'tenadmin',     domain: '' };

describe('dmRoomFor', () => {
  it('gives both participants the same room whichever way round', () => {
    expect(dmRoomFor('a', 'b')).toBe(dmRoomFor('b', 'a'));
  });

  it('survives ids containing slashes, dots and @', () => {
    const room = dmRoomFor('TEN/WEB/1005', 'hr.lead@ten.com');
    expect(dmParticipants(room)).toEqual(expect.arrayContaining(['TEN/WEB/1005', 'hr.lead@ten.com']));
  });

  it('is not confused with a group room', () => {
    expect(dmParticipants('general')).toBeNull();
    expect(dmParticipants('domain_Web Development')).toBeNull();
  });
});

describe('a private conversation is readable only by its participants', () => {
  const room = dmRoomFor(student.id, coord.id);

  it('lets the student in', () => expect(canAccessRoom(student, room)).toBe(true));
  it('lets the coordinator in', () => expect(canAccessRoom(coord, room)).toBe(true));

  it('keeps an unrelated student out', () => {
    // The one that matters: a student must never read someone else's DMs.
    expect(canAccessRoom(student2, room)).toBe(false);
  });

  it('keeps unrelated HR out', () => {
    expect(canAccessRoom(hr, room)).toBe(false);
  });

  it('lets an admin in — that is what oversight means', () => {
    expect(canAccessRoom(admin, room)).toBe(true);
  });

  it('lets either participant delete inside it', () => {
    expect(canDeleteIn(student, room)).toBe(true);
    expect(canDeleteIn(coord, room)).toBe(true);
  });

  it('does not let an outsider delete in it', () => {
    expect(canDeleteIn(student2, room)).toBe(false);
  });
});

describe('group rooms are unchanged for existing roles', () => {
  it('a student reaches their own domain room only', () => {
    expect(canAccessRoom(student, 'domain_Web Development')).toBe(true);
    expect(canAccessRoom(student, 'domain_Data Science')).toBe(false);
  });

  it('a student cannot reach staff rooms', () => {
    expect(canAccessRoom(student, 'hr_internal')).toBe(false);
    expect(canAccessRoom(student, 'hr_coordinators')).toBe(false);
  });

  it('a student still cannot delete in a group room', () => {
    expect(canDeleteIn(student, 'general')).toBe(false);
  });

  it('HR keeps its internal room', () => {
    expect(canAccessRoom(hr, 'hr_internal')).toBe(true);
  });

  it('everyone shares general', () => {
    [student, coord, hr, admin].forEach(u => expect(canAccessRoom(u, 'general')).toBe(true));
  });
});

describe('admin oversight', () => {
  it('reaches every domain room without belonging to one', () => {
    expect(canAccessRoom(admin, 'domain_Web Development')).toBe(true);
    expect(canAccessRoom(admin, 'domain_Cyber Security')).toBe(true);
  });

  it('is granted the staff rooms', () => {
    const rooms = roomsAllowedFor(admin);
    expect(rooms).toEqual(expect.arrayContaining(['general', 'hr_coordinators', 'hr_internal']));
  });

  it('is NOT auto-joined to private conversations', () => {
    // Access on request, yes; auto-join would mean subscribing to thousands
    // of rooms on every admin connection.
    expect(roomsAllowedFor(admin).some(r => String(r).indexOf('dm::') === 0)).toBe(false);
  });

  it('may delete anywhere it can read', () => {
    expect(canDeleteIn(admin, 'general')).toBe(true);
    expect(canDeleteIn(admin, dmRoomFor('a', 'b'))).toBe(true);
  });
});

describe('malformed rooms are refused rather than defaulting open', () => {
  it.each([null, undefined, '', 'dm::', 'dm::only-one-side', 'nonsense'])('%p', (room) => {
    expect(canAccessRoom(student, room)).toBe(false);
  });
});
