'use strict';

/**
 * The count behind the notification orb.
 *
 * The orb is a round badge that only appears when something is actually
 * waiting, so this endpoint has to answer three things at once and answer them
 * honestly:
 *
 *   how many      — a badge showing a number nobody has is furniture
 *   of what kind  — "2 new messages" is worth a glance; "2" is not
 *   and where     — a click has to land in the conversation, not in a list the
 *                   reader then has to search
 *
 * It is called on every portal page every 45 seconds, so the failure mode that
 * matters most is a broken one: an error here must never put a red badge on
 * every page in the portal.
 */

const express = require('express');
const request = require('supertest');

const HOUR = 3600 * 1000;
const now = Date.now();

const mockState = { notifications: [], messages: [], reads: {}, fail: false };

function mockQ(result) {
  const o = {
    lean: () => o, select: () => o, sort: () => o, limit: () => o,
    then: (r, j) => Promise.resolve(result).then(r, j),
    catch: (j) => Promise.resolve(result).catch(j)
  };
  return o;
}

/** Enough of a Message model to drive the handler's two queries. */
function mockMatchMessages(filter) {
  return mockState.messages.filter((m) => {
    if (filter.chatRoom && m.chatRoom !== filter.chatRoom) return false;
    if (filter.senderId && filter.senderId.$nin) {
      const nin = filter.senderId.$nin.map((s) => String(s).toLowerCase());
      if (nin.indexOf(String(m.senderId).toLowerCase()) !== -1) return false;
    }
    if (filter.timestamp && filter.timestamp.$gt && !(m.timestamp > filter.timestamp.$gt)) return false;
    return true;
  });
}

jest.mock('../../models/Message', () => ({
  distinct: async (_field, filter) => {
    if (mockState.fail) throw new Error('database is down');
    const rx = filter.chatRoom;
    const rooms = Array.from(new Set(mockState.messages.map((m) => m.chatRoom)));
    return rooms.filter((r) => (rx instanceof RegExp ? rx.test(r) : r === rx));
  },
  find: (filter) => {
    const hits = mockMatchMessages(filter).sort((a, b) => b.timestamp - a.timestamp);
    return mockQ(hits);
  },
  countDocuments: async (filter) => mockMatchMessages(filter).length
}));

jest.mock('../../models/Notification', () => ({
  countDocuments: async () => mockState.notifications.filter((n) => !n.read).length,
  findOne: () => {
    const unread = mockState.notifications.filter((n) => !n.read)
      .sort((a, b) => b.createdAt - a.createdAt);
    return mockQ(unread[0] || null);
  },
  find: () => mockQ(mockState.notifications),
  updateMany: async () => ({})
}));

jest.mock('../../models/ChatRead', () => ({
  mapFor: async () => mockState.reads,
  markRead: async () => ({})
}));

jest.mock('../../models/Student', () => ({
  findOne: () => mockQ({ domain: 'Artificial Intelligence' })
}));

const router = require('../../routes/notificationFeed');

function appWith(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/notifications', router);
  return app;
}

const STUDENT = { student: { employeeId: 'TEN/AI/1663', name: 'Anmol', domain: 'Artificial Intelligence' } };
const HR = { hr: { username: 'hrdirector', email: 'hr.director@ten.com', name: 'Priya' } };

const get = (session) => request(appWith(session)).get('/api/notifications/unread-count');

beforeEach(() => {
  mockState.notifications = [];
  mockState.messages = [];
  mockState.reads = {};
  mockState.fail = false;
});

describe('how many, and of what kind', () => {
  it('is zero when there is nothing — so the orb never appears', () => {
    return get(STUDENT).then((res) => {
      expect(res.body.unread).toBe(0);
      expect(res.body.notifications).toBe(0);
      expect(res.body.messages).toBe(0);
    });
  });

  it('splits messages from portal notifications', async () => {
    mockState.notifications = [{ read: false, title: 'Attendance marked', createdAt: new Date(now - 3 * HOUR) }];
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::coach@ten.com', senderId: 'coach@ten.com', senderName: 'Coach', message: 'hi', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(STUDENT);
    expect(res.body.notifications).toBe(1);
    expect(res.body.messages).toBe(1);
    expect(res.body.unread).toBe(2);
  });

  it('counts a conversation once, not once per message', async () => {
    // Forty messages from one person is one thing to look at.
    mockState.messages = Array.from({ length: 40 }, (_, i) => ({
      chatRoom: 'dm::TEN/AI/1663::coach@ten.com', senderId: 'coach@ten.com',
      senderName: 'Coach', message: 'm' + i, timestamp: new Date(now - i * 1000)
    }));
    const res = await get(STUDENT);
    expect(res.body.messages).toBe(1);
  });

  it('does not count messages the reader has already seen', async () => {
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::coach@ten.com', senderId: 'coach@ten.com', message: 'old', timestamp: new Date(now - 4 * HOUR) }
    ];
    mockState.reads = { 'dm::TEN/AI/1663::coach@ten.com': new Date(now - 2 * HOUR) };
    const res = await get(STUDENT);
    expect(res.body.messages).toBe(0);
  });

  it('does not count the reader\'s own messages', async () => {
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::coach@ten.com', senderId: 'TEN/AI/1663', message: 'mine', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(STUDENT);
    expect(res.body.messages).toBe(0);
  });
});

describe('where a click should go', () => {
  it('into the conversation when a message is the newest thing', async () => {
    mockState.notifications = [{ read: false, title: 'Older update', createdAt: new Date(now - 5 * HOUR) }];
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::coach@ten.com', senderId: 'coach@ten.com', senderName: 'Coach', message: 'hi', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(STUDENT);
    expect(res.body.latest.kind).toBe('message');
    expect(res.body.latest.url).toBe('/messages?to=' + encodeURIComponent('coach@ten.com'));
    expect(res.body.latest.title).toBe('Coach');
  });

  it('to the notification centre when a portal update is the newest', async () => {
    mockState.notifications = [{ read: false, title: 'Certificate approved', createdAt: new Date(now - HOUR) }];
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::coach@ten.com', senderId: 'coach@ten.com', message: 'older', timestamp: new Date(now - 6 * HOUR) }
    ];
    const res = await get(STUDENT);
    expect(res.body.latest.kind).toBe('portal');
    expect(res.body.latest.url).toBe('/notifications');
  });

  it('falls back to the notification centre when there is nothing at all', async () => {
    const res = await get(STUDENT);
    expect(res.body.latest).toEqual({ kind: 'none', url: '/notifications', title: '' });
  });

  it('escapes an employee ID with slashes into the link', async () => {
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::TEN/WEB/1005', senderId: 'TEN/WEB/1005', senderName: 'Ravi', message: 'hi', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(STUDENT);
    expect(res.body.latest.url).toBe('/messages?to=TEN%2FWEB%2F1005');
  });
});

describe('staff are found under every id they are known by', () => {
  it('counts a conversation named with the HR username', async () => {
    // The canonical id for staff is their email, but rooms exist under both.
    // Matching one spelling is what made the inbox answer "Forbidden".
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::hrdirector', senderId: 'TEN/AI/1663', senderName: 'Anmol', message: 'hello', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(HR);
    expect(res.body.messages).toBe(1);
  });

  it('counts a conversation named with the HR email', async () => {
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::hr.director@ten.com', senderId: 'TEN/AI/1663', message: 'hello', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(HR);
    expect(res.body.messages).toBe(1);
  });

  it('does not count an HR user\'s own messages sent under their other id', async () => {
    // Sent as "hrdirector", read as "hr.director@ten.com" — still theirs.
    mockState.messages = [
      { chatRoom: 'dm::TEN/AI/1663::hr.director@ten.com', senderId: 'hrdirector', message: 'mine', timestamp: new Date(now - HOUR) }
    ];
    const res = await get(HR);
    expect(res.body.messages).toBe(0);
  });
});

describe('it never breaks the page it sits on', () => {
  it('answers a zero count rather than an error when the database is down', async () => {
    // Every portal page polls this. A 500 would paint a broken badge on all of
    // them, which is worse than showing nothing.
    mockState.fail = true;
    const res = await get(STUDENT);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.unread).toBe(0);
    expect(res.body.latest.url).toBe('/notifications');
  });

  it('turns away someone who is not signed in', async () => {
    const res = await get({});
    expect(res.status).toBe(401);
  });
});
