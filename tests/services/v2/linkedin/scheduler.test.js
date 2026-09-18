'use strict';

/*
 * The scheduler has two jobs and a rule.
 *
 * The first job is understanding what a person means by "tomorrow 10am" —
 * always in India time, because that is where the people writing these posts
 * are, and a post scheduled in UTC goes out five and a half hours early.
 *
 * The second is publishing what is due without ever publishing it twice. The
 * app runs under PM2 with more than one worker, every one of them ticking the
 * same cron against the same collection, so the claim has to be a single
 * atomic operation. That is the rule, and it is the thing most worth a test:
 * a duplicate post on the company page is visible to 46,000 followers.
 *
 * No mongoose, no network, no cron. Everything is injected.
 */

const scheduler = require('../../../../services/v2/linkedin/scheduler');

/* A fixed "now" so the arithmetic is checkable: 18 Sept 2026, 09:00 IST,
   which is 03:30 UTC. Every expectation below is written in IST and compared
   through the same offset. */
const NOW = new Date('2026-09-18T03:30:00.000Z');
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** The wall-clock reading of a Date in India, for legible assertions. */
function ist(d) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16),
  };
}

describe('reading a time a person typed', () => {
  it('understands "tomorrow 10am" as 10:00 India time', () => {
    const when = scheduler.parseWhen('tomorrow 10am', NOW, 'Asia/Kolkata');
    expect(when).toBeInstanceOf(Date);
    expect(ist(when)).toEqual({ date: '2026-09-19', time: '10:00' });
  });

  it('understands a time later today', () => {
    const when = scheduler.parseWhen('today 6:30 pm', NOW, 'Asia/Kolkata');
    expect(ist(when)).toEqual({ date: '2026-09-18', time: '18:30' });
  });

  it('understands a weekday', () => {
    /* 18 Sept 2026 is a Friday, so the next Monday is the 21st. */
    const when = scheduler.parseWhen('monday 9am', NOW, 'Asia/Kolkata');
    expect(ist(when)).toEqual({ date: '2026-09-21', time: '09:00' });
  });

  it('understands a relative offset', () => {
    const when = scheduler.parseWhen('in 2 hours', NOW, 'Asia/Kolkata');
    expect(when.getTime()).toBe(NOW.getTime() + 2 * 3600 * 1000);
  });

  it('understands a written date', () => {
    const when = scheduler.parseWhen('20 Sep 10:00', NOW, 'Asia/Kolkata');
    expect(ist(when)).toEqual({ date: '2026-09-20', time: '10:00' });
  });

  it('accepts an ISO timestamp as given', () => {
    const when = scheduler.parseWhen('2026-09-25T12:00:00.000Z', NOW, 'Asia/Kolkata');
    expect(when.toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('refuses a time that has already passed', () => {
    expect(scheduler.parseWhen('today 6am', NOW, 'Asia/Kolkata')).toBeNull();
    expect(scheduler.parseWhen('2020-01-01T00:00:00.000Z', NOW, 'Asia/Kolkata')).toBeNull();
  });

  it('refuses what it cannot read, rather than guessing', () => {
    ['', '   ', 'soon', 'whenever you like', 'the day after the thing', null, undefined]
      .forEach((input) => {
        expect(scheduler.parseWhen(input, NOW, 'Asia/Kolkata')).toBeNull();
      });
  });

  it('defaults to India time when no zone is named', () => {
    const named = scheduler.parseWhen('tomorrow 10am', NOW, 'Asia/Kolkata');
    const defaulted = scheduler.parseWhen('tomorrow 10am', NOW);
    expect(defaulted.getTime()).toBe(named.getTime());
  });
});

/* ── the tick ───────────────────────────────────────────────────────────── */

/** A stand-in for the model, with just the two calls the scheduler makes. */
function fakeModel(queue) {
  const pending = queue.slice();
  return {
    findOneAndUpdate: jest.fn(async () => pending.shift() || null),
    findByIdAndUpdate: jest.fn(async () => ({})),
  };
}

const duePost = (over) => Object.assign({
  _id: 'post-1',
  final: 'We are hiring Python interns. Apply at the link.',
  kind: 'opening',
  poster: {},
}, over || {});

describe('publishing what is due', () => {
  it('claims a post atomically, so two workers cannot both send it', async () => {
    const LinkedInPost = fakeModel([duePost()]);
    const linkedinClient = { publish: jest.fn(async () => ({ ok: true, url: 'https://www.linkedin.com/feed/update/urn:li:share:1' })) };

    await scheduler.runDue(NOW, { LinkedInPost, linkedinClient });

    const [filter, update] = LinkedInPost.findOneAndUpdate.mock.calls[0];
    /* The filter and the write are one operation: whichever worker's update
       lands first is the only one that still matches 'scheduled'. */
    expect(filter.status).toBe('scheduled');
    expect(filter.scheduledFor).toEqual({ $lte: NOW });
    expect(update.$set.status).toBe('publishing');
  });

  it('publishes the stored final text and reports it', async () => {
    const LinkedInPost = fakeModel([duePost()]);
    const linkedinClient = { publish: jest.fn(async () => ({ ok: true, url: 'https://www.linkedin.com/feed/update/urn:li:share:9' })) };

    const out = await scheduler.runDue(NOW, { LinkedInPost, linkedinClient });

    expect(out).toEqual({ published: 1, failed: 0 });
    expect(linkedinClient.publish).toHaveBeenCalledTimes(1);
    expect(linkedinClient.publish.mock.calls[0][0].text).toBe('We are hiring Python interns. Apply at the link.');
  });

  it('sends the poster that was rasterised when the post was scheduled', async () => {
    /* The browser draws the PNG; by publishing time there is no browser, so
       the bytes have to have travelled with the schedule request. */
    const png = Buffer.from('fake-png-bytes').toString('base64');
    const LinkedInPost = fakeModel([duePost({ poster: { png } })]);
    const linkedinClient = { publish: jest.fn(async () => ({ ok: true })) };

    await scheduler.runDue(NOW, { LinkedInPost, linkedinClient });

    const sent = linkedinClient.publish.mock.calls[0][0].png;
    expect(Buffer.isBuffer(sent)).toBe(true);
    expect(sent.toString()).toBe('fake-png-bytes');
  });

  it('records a refusal as failed instead of losing the post', async () => {
    const LinkedInPost = fakeModel([duePost()]);
    const linkedinClient = { publish: jest.fn(async () => ({ ok: false, error: 'token rejected' })) };

    const out = await scheduler.runDue(NOW, { LinkedInPost, linkedinClient });

    expect(out.failed).toBe(1);
    expect(out.published).toBe(0);
    const recorded = LinkedInPost.findByIdAndUpdate.mock.calls[0][1];
    expect(recorded.$set.status).toBe('failed');
    /* The reason has to survive, or nobody can tell why it did not go out. */
    expect(JSON.stringify(recorded)).toMatch(/token rejected/);
  });

  it('survives a client that throws', async () => {
    const LinkedInPost = fakeModel([duePost()]);
    const linkedinClient = { publish: jest.fn(async () => { throw new Error('socket hang up'); }) };

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(scheduler.runDue(NOW, { LinkedInPost, linkedinClient })).resolves.toEqual(
        expect.objectContaining({ failed: 1 }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('does nothing, quietly, when nothing is due', async () => {
    const LinkedInPost = fakeModel([]);
    const linkedinClient = { publish: jest.fn() };

    await expect(scheduler.runDue(NOW, { LinkedInPost, linkedinClient })).resolves.toEqual({ published: 0, failed: 0 });
    expect(linkedinClient.publish).not.toHaveBeenCalled();
  });

  it('works through several due posts in one tick', async () => {
    const LinkedInPost = fakeModel([duePost({ _id: 'a' }), duePost({ _id: 'b' }), duePost({ _id: 'c' })]);
    const linkedinClient = { publish: jest.fn(async () => ({ ok: true })) };

    const out = await scheduler.runDue(NOW, { LinkedInPost, linkedinClient });
    expect(out.published).toBe(3);
  });

  it('survives a database that is down', async () => {
    const LinkedInPost = {
      findOneAndUpdate: jest.fn(async () => { throw new Error('no primary available'); }),
      findByIdAndUpdate: jest.fn(),
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(scheduler.runDue(NOW, { LinkedInPost, linkedinClient: { publish: jest.fn() } }))
        .resolves.toEqual({ published: 0, failed: 0 });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the cron', () => {
  it('does not start under test, where a live timer would outlast the suite', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(() => scheduler.start()).not.toThrow();
  });
});
