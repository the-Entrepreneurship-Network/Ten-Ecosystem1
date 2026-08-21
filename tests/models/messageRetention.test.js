'use strict';

/**
 * Private messages are kept for 30 days. Group messages are kept.
 *
 * The retention policy lives in one place — the pre-validate hook on the
 * Message schema — so that every path that creates a message (the socket
 * handler, a REST fallback, a future import) gets it without having to
 * remember. These tests pin both halves of it, because getting either wrong is
 * silent: too broad and a domain room's history disappears, too narrow and
 * private conversations are kept forever.
 */

const mongoose = require('mongoose');
const Message = require('../../models/Message');

const DAY = 24 * 60 * 60 * 1000;

/** Run the schema's validation without touching a database. */
async function validated(fields) {
  const doc = new Message(Object.assign({
    senderId: 'TEN/WEB/1005',
    senderName: 'Test Intern',
    senderRole: 'student',
    message: 'hello'
  }, fields));
  await doc.validate();
  return doc;
}

afterAll(async () => { await mongoose.disconnect().catch(() => {}); });

describe('a direct message expires', () => {
  it('is stamped 30 days out', async () => {
    const doc = await validated({ chatRoom: 'dm::TEN/WEB/1005::hr@ten.com' });
    expect(doc.expiresAt).toBeInstanceOf(Date);
    const gap = doc.expiresAt.getTime() - doc.timestamp.getTime();
    expect(Math.round(gap / DAY)).toBe(30);
  });

  it('measures from the message time, not from now', async () => {
    // Backdating a message must backdate its expiry too, otherwise importing
    // old history would give it a fresh 30 days.
    const then = new Date(Date.now() - 20 * DAY);
    const doc = await validated({ chatRoom: 'dm::a::b', timestamp: then });
    expect(Math.round((doc.expiresAt.getTime() - then.getTime()) / DAY)).toBe(30);
    // ...so this one is 10 days from being deleted.
    expect(Math.round((doc.expiresAt.getTime() - Date.now()) / DAY)).toBe(10);
  });

  it('leaves an expiry that was set explicitly alone', async () => {
    const fixed = new Date(Date.now() + 5 * DAY);
    const doc = await validated({ chatRoom: 'dm::a::b', expiresAt: fixed });
    expect(doc.expiresAt.getTime()).toBe(fixed.getTime());
  });
});

describe('a group message does not', () => {
  it.each([
    'general',
    'domain_Web Development',
    'hr_internal',
    'hr_coordinators',
    'doubts'
  ])('%s', async (room) => {
    const doc = await validated({ chatRoom: room });
    expect(doc.expiresAt).toBeNull();
  });

  it('clears an expiry set on a group room by mistake', async () => {
    // Otherwise a stray value would quietly delete a domain room's history.
    const doc = await validated({ chatRoom: 'general', expiresAt: new Date(Date.now() + DAY) });
    expect(doc.expiresAt).toBeNull();
  });

  it('is not fooled by a room merely containing "dm"', async () => {
    const doc = await validated({ chatRoom: 'domain_Admin' });
    expect(doc.expiresAt).toBeNull();
  });
});

describe('the TTL index is declared correctly', () => {
  it('expires at the stamped time rather than N seconds after it', () => {
    const ttl = Message.schema.indexes().find(([keys]) => keys.expiresAt);
    expect(ttl).toBeDefined();
    // expireAfterSeconds: 0 is what makes expiresAt a per-document deadline.
    // Any other value would shift every deletion by that amount.
    expect(ttl[1].expireAfterSeconds).toBe(0);
  });

  it('still indexes room + time, which is how history is read', () => {
    const byRoom = Message.schema.indexes().find(([k]) => k.chatRoom === 1 && k.timestamp === -1);
    expect(byRoom).toBeDefined();
  });
});

describe('isDirectMessageRoom', () => {
  it.each([
    ['dm::a::b', true],
    ['dm::TEN/WEB/1005::hr@ten.com', true],
    ['general', false],
    ['domain_Web Development', false],
    ['', false],
    [null, false],
    [undefined, false]
  ])('%p → %p', (room, expected) => {
    expect(Message.isDirectMessageRoom(room)).toBe(expected);
  });
});
