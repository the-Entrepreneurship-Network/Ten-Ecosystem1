'use strict';

/**
 * The autopilot — the tick that queues a hiring post with nobody logged in.
 *
 * Everything it touches is injected, so this suite has no database, no
 * filesystem read and no cron. What it is really about is the handful of
 * decisions that only ever play out at three in the morning, where there is
 * nobody to notice them going wrong:
 *
 *   - every instant must belong to exactly one two-hour slot, and a worker
 *     that wakes up late must queue the slot it is in, not the ones it missed;
 *   - two workers ticking at the same second must produce one post, not two,
 *     and the loser must treat its duplicate-key error as success rather than
 *     as a fault worth logging every ten minutes;
 *   - a missing poster costs the post its image and not the post;
 *   - a blocked text stops the whole thing, because the guard is the last
 *     check before an unattended job puts words on the company page.
 *
 * It must also never throw. It runs from a cron callback under PM2, where an
 * unhandled rejection takes the web process down — and the portal failing to
 * serve pages because a LinkedIn post could not be queued would be an absurd
 * way to lose a morning.
 */

const autopilot = require('../../../../services/v2/linkedin/autopilot');
const posts = require('../../../../services/v2/linkedin/domainPost');

/* A fixed IST wall-clock instant, so no test straddles a slot boundary. */
const ist = (s) => new Date(`${s}+05:30`);

/* 14:30 IST on a Tuesday — an ordinary slot, which under the weekend job
   this replaced was no slot at all. */
const SLOT = ist('2026-09-22T14:30:00');
const NEXT_SLOT = ist('2026-09-22T16:30:00');

function fakeModel() {
  const docs = [];
  const created = [];
  return {
    docs,
    created,
    create: jest.fn(async (doc) => {
      if (doc.slot && docs.some((d) => d.slot === doc.slot)) {
        const e = new Error('E11000 duplicate key error collection: linkedinposts index: slot_1');
        e.code = 11000;
        throw e;
      }
      const saved = Object.assign({ _id: `id${docs.length + 1}` }, doc);
      docs.push(saved);
      created.push(doc);
      return saved;
    }),
  };
}

function deps(over) {
  return Object.assign({
    LinkedInPost: fakeModel(),
    guard: { review: jest.fn(() => ({ verdict: 'ok', issues: [] })) },
    readPoster: jest.fn(() => Buffer.from('poster-bytes')),
  }, over || {});
}

describe('autopilot — when it runs', () => {
  /*
   * The weekend job this replaced had a lot of ways to say "not now": not a
   * weekend, before the hour, after the window. All of them are gone. The
   * clock never stops and neither does the rotation, so every instant belongs
   * to a slot — including three in the morning on a Tuesday, which was the
   * point of the change.
   */
  it('has a slot for every instant, including nights and weekdays', () => {
    [
      '2026-09-22T03:10:00+05:30', // Tuesday, 3am
      '2026-09-19T00:00:00+05:30', // Saturday, midnight
      '2026-09-23T13:45:00+05:30', // Wednesday afternoon
      '2026-12-25T23:59:00+05:30', // Christmas night
    ].forEach((when) => {
      const d = autopilot.due(new Date(when));
      expect(d.ok).toBe(true);
      expect(d.key).toMatch(/^slot:\d{4}-\d{2}-\d{2}T\d{2}$/);
    });
  });

  it('puts every minute of a two-hour bucket in the same slot', () => {
    const early = autopilot.due(ist('2026-09-19T14:00:00'));
    const late = autopilot.due(ist('2026-09-19T15:59:00'));
    const next = autopilot.due(ist('2026-09-19T16:00:00'));
    expect(early.key).toBe(late.key);
    expect(next.key).not.toBe(early.key);
    expect(early.key).toBe('slot:2026-09-19T14');
  });

  it('reads the IST clock, not the host clock', () => {
    /* 18:30 UTC is midnight IST the next day. */
    expect(autopilot.due(new Date('2026-09-18T18:30:00Z')).key).toBe('slot:2026-09-19T00');
    expect(autopilot.due(new Date('2026-09-18T18:29:00Z')).key).toBe('slot:2026-09-18T22');
  });

  /*
   * A process that was down for six hours comes back and queues the slot it is
   * standing in, not the three it slept through. A post four hours late is
   * competing with the one about to go out on time.
   */
  it('does not try to catch up on slots it slept through', async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    await autopilot.tick(ist('2026-09-19T14:30:00'), d);
    await autopilot.tick(ist('2026-09-19T20:30:00'), d);
    expect(model.created).toHaveLength(2);
    expect(model.created.map((c) => c.slot)).toEqual(['slot:2026-09-19T14', 'slot:2026-09-19T20']);
  });

  it('gets through all fourteen domains in a lap, and keeps going', async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    let t = ist('2026-09-19T00:00:00').getTime();
    for (let i = 0; i < 14; i += 1) {
      /* eslint-disable-next-line no-await-in-loop */
      await autopilot.tick(new Date(t), d);
      t += 2 * 3600000;
    }
    expect(model.created).toHaveLength(14);
    expect(new Set(model.created.map((c) => c.domain)).size).toBe(14);
    expect(new Set(model.created.map((c) => c.slot)).size).toBe(14);
  });
});

describe('autopilot — what it queues', () => {
  it('saves the post for the domain whose turn it is, ready to send', async () => {
    const d = deps();
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(true);

    const doc = d.LinkedInPost.created[0];
    const domain = posts.pick(SLOT);
    expect(doc.domain).toBe(domain.name);
    expect(doc.final).toBe(posts.body(domain));
    expect(doc.status).toBe('scheduled');
    expect(doc.source).toBe('autopilot');
    expect(doc.slot).toBe('slot:2026-09-22T14');
    expect(doc.kind).toBe('opening');
    /* `draft` is what a person typed, and nobody typed this. */
    expect(doc.draft).toBe('');
  });

  it("attaches the domain poster as base64 and marks the post as carrying one", async () => {
    const d = deps();
    await autopilot.tick(SLOT, d);
    const doc = d.LinkedInPost.created[0];
    expect(d.readPoster).toHaveBeenCalledWith(posts.pick(SLOT).slug);
    expect(doc.poster.withImage).toBe(true);
    expect(Buffer.from(doc.poster.png, 'base64').toString()).toBe('poster-bytes');
    expect(doc.poster.fields.alt).toContain('Intern');
  });

  it('posts without an image rather than not posting, when the poster is missing', async () => {
    const d = deps({ readPoster: jest.fn(() => undefined) });
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(true);
    expect(res.withImage).toBe(false);
    const doc = d.LinkedInPost.created[0];
    expect(doc.poster.withImage).toBe(false);
    expect(doc.poster.png).toBe('');
    expect(doc.final).toBeTruthy();
    expect(doc.history[0].note).toMatch(/text only/);
  });

  it('survives a poster read that throws outright', async () => {
    const d = deps({ readPoster: jest.fn(() => { throw new Error('EACCES'); }) });
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(true);
    expect(res.withImage).toBe(false);
  });

  it('gives consecutive slots different domains and different slot keys', async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    await autopilot.tick(SLOT, d);
    await autopilot.tick(NEXT_SLOT, d);
    expect(model.created).toHaveLength(2);
    expect(model.created[0].domain).not.toBe(model.created[1].domain);
    expect(model.created[0].slot).not.toBe(model.created[1].slot);
  });
});

describe('autopilot — one post per slot', () => {
  it('queues once however many times it ticks in the same slot', async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    const first = await autopilot.tick(SLOT, d);
    const second = await autopilot.tick(new Date(SLOT.getTime() + 10 * 60000), d);
    const third = await autopilot.tick(new Date(SLOT.getTime() + 20 * 60000), d);

    expect(first.queued).toBe(true);
    expect(second.queued).toBe(false);
    expect(second.reason).toMatch(/already queued/);
    expect(third.queued).toBe(false);
    expect(model.docs).toHaveLength(1);
  });

  it("treats the losing worker duplicate key as normal, not as an error", async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await autopilot.tick(SLOT, d);
    const loser = await autopilot.tick(SLOT, d);
    expect(loser.reason).toMatch(/already queued/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('autopilot — refusing to post', () => {
  it('queues nothing when the content guard blocks the text', async () => {
    const d = deps({
      guard: {
        review: jest.fn(() => ({
          verdict: 'block',
          issues: [{ code: 'personal_contact', severity: 'block', excerpt: '+91 98765 43210' }],
        })),
      },
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(false);
    expect(res.reason).toMatch(/content guard/);
    expect(d.LinkedInPost.create).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('queues anyway when the guard only asks for a revision', async () => {
    const d = deps({
      guard: { review: jest.fn(() => ({ verdict: 'revise', issues: [{ code: 'ai_slop', severity: 'revise' }] })) },
    });
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(true);
    expect(d.LinkedInPost.created[0].verdict).toBe('revise');
    /* The issues are kept so the history can explain the badge later. */
    expect(d.LinkedInPost.created[0].issues).toHaveLength(1);
  });

  it('queues when the guard itself throws, rather than losing the slot to it', async () => {
    const d = deps({ guard: { review: jest.fn(() => { throw new Error('guard exploded'); }) } });
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(true);
  });

  it('reports a failed save instead of throwing out of the cron callback', async () => {
    const model = fakeModel();
    model.create = jest.fn(async () => { throw new Error('connection lost'); });
    const d = deps({ LinkedInPost: model });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await autopilot.tick(SLOT, d);
    expect(res.queued).toBe(false);
    expect(res.reason).toBe('save failed');
    expect(res.error).toMatch(/connection lost/);
    spy.mockRestore();
  });

  it('never rejects, whatever the date it is handed', async () => {
    const d = deps();
    await expect(autopilot.tick(undefined, d)).resolves.toBeTruthy();
    await expect(autopilot.tick(new Date('nonsense'), d)).resolves.toBeTruthy();
    await expect(autopilot.tick(null, d)).resolves.toBeTruthy();
  });
});

describe('autopilot — the forecast', () => {
  it('lists the next slots and the domain each will get', () => {
    const rows = autopilot.forecast(SLOT, 4);
    expect(rows).toHaveLength(4);
    rows.forEach((r) => {
      expect(r.slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
      expect(posts.byName(r.domain)).toBeTruthy();
      expect(r.role).toMatch(/Intern$/);
      /* Whatever the forecast says a slot will get is what pick() decides
         when that slot arrives — otherwise the dashboard is telling people
         something the job will not do. */
      expect(r.domain).toBe(posts.pick(new Date(r.at)).name);
    });
  });

  it('is chronological, two hours apart, with no repeats inside a lap', () => {
    const rows = autopilot.forecast(SLOT, 6);
    for (let i = 1; i < rows.length; i += 1) {
      const gap = new Date(rows[i].at) - new Date(rows[i - 1].at);
      expect(gap).toBe(2 * 3600000);
    }
    expect(new Set(rows.map((r) => r.domain)).size).toBe(6);
  });

  /*
   * The slot you are standing in is either already queued or about to be, so
   * listing it under "coming up" would have a reader waiting two hours for
   * something that went out five minutes ago.
   */
  it('starts at the next slot, not the current one', () => {
    const rows = autopilot.forecast(ist('2026-09-22T14:30:00'), 2);
    expect(rows[0].slot).toBe('2026-09-22T16');
    expect(rows[0].domain).not.toBe(posts.pick(ist('2026-09-22T14:30:00')).name);
  });

  it('clamps how far ahead it will look', () => {
    expect(autopilot.forecast(SLOT, 0)).toHaveLength(6);
    expect(autopilot.forecast(SLOT, 99).length).toBeLessThanOrEqual(14);
  });
});

describe('autopilot — the feed every portal shows', () => {
  function feedDeps(rows, count) {
    const chain = (value) => {
      const q = { sort: () => q, limit: () => q, select: () => q, lean: () => Promise.resolve(value) };
      return q;
    };
    const find = jest.fn(() => chain(rows));
    return {
      find,
      deps: {
        LinkedInPost: {
          find,
          countDocuments: jest.fn(async () => (count == null ? rows.length : count)),
        },
      },
    };
  }

  const PUBLISHED = {
    _id: 'p1',
    domain: 'Python Development',
    final: '🚀 WE ARE #HIRING #INTERNS\n\nthe rest of it',
    publishedAt: new Date('2026-09-19T04:30:00Z'),
    dryRun: false,
    linkedin: { url: 'https://linkedin.test/1' },
    poster: { withImage: true, fields: { alt: 'Hiring poster: Python Development Intern' } },
  };

  it('asks only for published posts', async () => {
    const f = feedDeps([PUBLISHED]);
    await autopilot.feed(f.deps);
    expect(f.find).toHaveBeenCalledWith({ status: 'published' });
    expect(f.deps.LinkedInPost.countDocuments).toHaveBeenCalledWith({ status: 'published' });
  });

  it('hands back the whole post text, not an excerpt', async () => {
    const out = await autopilot.feed(feedDeps([PUBLISHED]).deps);
    expect(out.posts[0].text).toBe(PUBLISHED.final);
    expect(out.posts[0].text).toContain('the rest of it');
  });

  it('counts every published post, not just the page it returned', async () => {
    const out = await autopilot.feed(feedDeps([PUBLISHED], 137).deps);
    expect(out.count).toBe(137);
    expect(out.posts).toHaveLength(1);
  });

  it('marks a dry run as not live', async () => {
    const out = await autopilot.feed(feedDeps([
      Object.assign({}, PUBLISHED, { dryRun: true }),
    ]).deps);
    expect(out.posts[0].live).toBe(false);
  });

  it('carries no error, no status and no scheduling field', async () => {
    const out = await autopilot.feed(feedDeps([
      Object.assign({}, PUBLISHED, {
        error: 'something internal', status: 'published',
        scheduledFor: new Date('2026-09-19T04:30:00Z'), slot: 'slot:2026-09-19T10',
      }),
    ]).deps);
    expect(Object.keys(out.posts[0]).sort()).toEqual(
      ['alt', 'at', 'domain', 'id', 'image', 'live', 'text', 'url'],
    );
    expect(JSON.stringify(out)).not.toContain('something internal');
    expect(JSON.stringify(out)).not.toContain('slot:');
  });

  it('is empty rather than broken when nothing has been published', async () => {
    const out = await autopilot.feed(feedDeps([], 0).deps);
    expect(out).toEqual({ count: 0, posts: [] });
  });
});

describe('autopilot — where a post image comes from', () => {
  it('uses the committed plate for a domain in the rotation', () => {
    expect(autopilot.imageUrlFor({ _id: 'x', domain: 'Cyber Security', poster: { withImage: true } }))
      .toBe('/assets/linkedin-posters/cyber.jpg');
  });

  it('falls back to the stored bytes for a domain it does not know', () => {
    expect(autopilot.imageUrlFor({ _id: 'abc', domain: 'Underwater Basket Weaving', poster: { withImage: true } }))
      .toBe('/api/v2/linkedin/feed/abc/image');
  });

  /* A text-only post has no image, and inventing a URL for it would give
     every reader a broken picture instead of a post with no picture. */
  it('gives a text-only post no url at all', () => {
    expect(autopilot.imageUrlFor({ _id: 'x', domain: 'Cyber Security', poster: { withImage: false } })).toBe('');
    expect(autopilot.imageUrlFor({ _id: 'x', domain: 'Nothing', poster: { withImage: false } })).toBe('');
  });

  it('survives a post with no poster field at all', () => {
    expect(autopilot.imageUrlFor({ _id: 'x', domain: 'Nothing' })).toBe('');
    expect(autopilot.imageUrlFor({})).toBe('');
  });
});

describe('autopilot — the numbers the dashboard shows', () => {
  function statsDeps(rows) {
    const chain = (value) => {
      const q = { sort: () => q, limit: () => q, select: () => q, lean: () => Promise.resolve(value) };
      return q;
    };
    return {
      LinkedInPost: {
        aggregate: jest.fn(async () => [
          { _id: 'published', n: 9 },
          { _id: 'failed', n: 1 },
          { _id: 'scheduled', n: 1 },
          { _id: 'publishing', n: 1 },
        ]),
        find: jest.fn((filter) => chain(
          filter.status.$in.indexOf('published') >= 0 ? rows.recent : rows.upcoming,
        )),
      },
    };
  }

  it('counts by status and folds publishing in with scheduled', async () => {
    const d = statsDeps({ recent: [], upcoming: [] });
    const out = await autopilot.stats(d);
    expect(out.published).toBe(9);
    expect(out.failed).toBe(1);
    /* A post mid-flight is still a post that has not gone out. */
    expect(out.scheduled).toBe(2);
    expect(out.total).toBe(12);
    expect(out.schedule).toEqual({ everyHours: 2, perDay: 12, timezone: 'Asia/Kolkata' });
  });

  it('shapes each row for the card and keeps the poster payload out of it', async () => {
    const d = statsDeps({
      recent: [{
        _id: 'x1', domain: 'Python Development', status: 'published', source: 'autopilot',
        final: 'first line\nsecond line', publishedAt: new Date('2026-09-19T05:00:00Z'),
        dryRun: true, linkedin: { url: 'https://linkedin.test/1' }, error: '',
        poster: { withImage: true, png: 'SHOULDNOTAPPEAR' },
      }],
      upcoming: [{ _id: 'x2', domain: 'Space', scheduledFor: new Date('2026-09-20T04:30:00Z'), status: 'scheduled', source: 'autopilot' }],
    });
    const out = await autopilot.stats(d);

    expect(out.recent[0]).toEqual(expect.objectContaining({
      id: 'x1', domain: 'Python Development', status: 'published',
      source: 'autopilot', dryRun: true, withImage: true,
      url: 'https://linkedin.test/1', excerpt: 'first line',
    }));
    expect(JSON.stringify(out)).not.toContain('SHOULDNOTAPPEAR');
    expect(out.upcoming[0].domain).toBe('Space');
  });

  it('keeps the history short, whatever it is asked for', async () => {
    const d = statsDeps({ recent: [], upcoming: [] });
    await autopilot.stats(d, 5000);
    await autopilot.stats(d, 'nonsense');
    await autopilot.stats(d, -1);
    /* The limit is applied to the query rather than to the answer, so what is
       proved here is only that none of these throws and each still runs. */
    expect(d.LinkedInPost.find).toHaveBeenCalledTimes(6);
  });
});
