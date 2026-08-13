'use strict';

/**
 * Web push, and the rules that keep it safe and quiet.
 *
 * Three things are asserted here because getting any of them wrong is either a
 * security problem or the kind of bug that only shows up as "my phone buzzes
 * forever":
 *
 *   1. A notification's click URL must be a same-origin path. A notification is
 *      a link the user has been trained to trust, and an absolute URL from an
 *      untrusted source abuses exactly that trust.
 *   2. A dead subscription must be deleted, not retried forever.
 *   3. Push failing must never throw into the thing that raised it — a chat
 *      message still sends whether or not the notification gets through.
 */

const mockSend = jest.fn();
const mockDelete = jest.fn().mockResolvedValue({ deletedCount: 1 });
const mockUpdate = jest.fn().mockResolvedValue({});
let mockSubs = [];

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args) => mockSend(...args),
  generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' })
}));

jest.mock('../../models/PushSubscription', () => ({
  find: () => ({ lean: () => Promise.resolve(mockSubs) }),
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  deleteOne: (...args) => mockDelete(...args),
  updateOne: (...args) => ({ catch: () => mockUpdate(...args) })
}));

const SUB = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'k', auth: 'a' }
};

let push;

beforeAll(() => {
  // The service reads its keys at require time.
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  jest.isolateModules(() => { push = require('../../services/pushService'); });
});

beforeEach(() => {
  mockSend.mockReset().mockResolvedValue({ statusCode: 201 });
  mockDelete.mockClear();
  mockSubs = [SUB];
});

describe('the click URL can only ever be a same-origin path', () => {
  const payloadFor = async (url) => {
    await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b', url });
    return JSON.parse(mockSend.mock.calls[0][1]);
  };

  it('keeps a normal path', async () => {
    expect((await payloadFor('/messages?to=TEN/WEB/1099')).url).toBe('/messages?to=TEN/WEB/1099');
  });

  it.each([
    'https://evil.example/steal',
    'http://evil.example',
    'javascript:alert(1)',
    '//evil.example/protocol-relative',
    'messages'
  ])('refuses %p and falls back to /', async (bad) => {
    expect((await payloadFor(bad)).url).toBe('/');
  });

  it('refuses a non-string', async () => {
    expect((await payloadFor({ toString: () => '/evil' })).url).toBe('/');
  });
});

describe('a notification is bounded', () => {
  it('truncates a very long body rather than sending it whole', async () => {
    await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'x'.repeat(5000) });
    expect(JSON.parse(mockSend.mock.calls[0][1]).body.length).toBe(300);
  });

  it('carries a 24-hour TTL, so an offline phone still gets it on waking', async () => {
    await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' });
    expect(mockSend.mock.calls[0][2]).toEqual({ TTL: 86400 });
  });

  it('defaults the tag, so untagged notifications still collapse', async () => {
    await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' });
    expect(JSON.parse(mockSend.mock.calls[0][1]).tag).toBe('ten-notification');
  });
});

describe('dead subscriptions are removed, not retried', () => {
  it.each([404, 410])('deletes the row on %i', async (statusCode) => {
    mockSend.mockRejectedValue(Object.assign(new Error('gone'), { statusCode }));
    const r = await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' });
    expect(r.removed).toBe(1);
    expect(r.sent).toBe(0);
    expect(mockDelete).toHaveBeenCalledWith({ endpoint: SUB.endpoint });
  });

  it('keeps the row on a temporary failure', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('busy'), { statusCode: 503 }));
    const r = await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' });
    expect(r.failed).toBe(1);
    expect(r.removed).toBe(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('push never breaks what triggered it', () => {
  it('resolves rather than throwing when delivery fails', async () => {
    mockSend.mockRejectedValue(new Error('network down'));
    await expect(push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' })).resolves.toEqual(
      expect.objectContaining({ sent: 0, failed: 1 })
    );
  });

  it('does nothing at all for a user with no devices', async () => {
    mockSubs = [];
    const r = await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' });
    expect(r).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does nothing when no user is named', async () => {
    expect(await push.sendToUser('', { title: 't' })).toEqual({ sent: 0, removed: 0, failed: 0 });
  });

  it('reaches every device a person has registered', async () => {
    mockSubs = [SUB, { endpoint: 'https://push.example/def', keys: { p256dh: 'k2', auth: 'a2' } }];
    const r = await push.sendToUser('TEN/WEB/1005', { title: 't', body: 'b' });
    expect(r.sent).toBe(2);
  });
});

describe('with no VAPID keys configured', () => {
  let offPush;
  beforeAll(() => {
    jest.isolateModules(() => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      offPush = require('../../services/pushService');
    });
  });

  it('reports itself as disabled', () => {
    expect(offPush.isEnabled()).toBe(false);
    expect(offPush.getPublicKey()).toBe('');
  });

  it('sends nothing and does not throw — the portal runs fine without push', async () => {
    mockSend.mockClear();
    await expect(offPush.sendToUser('TEN/WEB/1005', { title: 't' }))
      .resolves.toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
