'use strict';

/**
 * The weekend autopilot — the tick that queues a hiring post with nobody
 * logged in.
 *
 * Everything it touches is injected, so this suite has no database, no
 * filesystem read and no cron. What it is really about is the handful of
 * decisions that only ever play out at ten past ten on a Saturday, where there
 * is nobody to notice them going wrong:
 *
 *   - it must do nothing on a Tuesday, and nothing at eight in the morning;
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
const weekend = require('../../../../services/v2/linkedin/weekendPost');

/* 10:30 IST on Saturday 19 September 2026, comfortably inside the slot. */
const SATURDAY = new Date('2026-09-19T05:00:00Z');
const SUNDAY = new Date('2026-09-20T05:00:00Z');
const TUESDAY = new Date('2026-09-22T05:00:00Z');

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
  it('queues nothing on a weekday', async () => {
    const d = deps();
    const res = await autopilot.tick(TUESDAY, d);
    expect(res.queued).toBe(false);
    expect(res.reason).toMatch(/not a weekend/);
    expect(d.LinkedInPost.create).not.toHaveBeenCalled();
  });

  it('queues nothing before the slot hour', async () => {
    const d = deps();
    /* 08:00 IST on the Saturday. */
    const res = await autopilot.tick(new Date('2026-09-19T02:30:00Z'), d);
    expect(res.queued).toBe(false);
    expect(res.reason).toMatch(/before the 10:00 IST slot/);
    expect(d.LinkedInPost.create).not.toHaveBeenCalled();
  });

  /*
   * A process that was down all Saturday and comes back on Tuesday must not
   * post Saturday's opening three days late; one that comes back at noon on
   * the same Saturday should still post it. That is what the window is for.
   */
  it('still queues a missed slot later the same day, but not after the day is out', async () => {
    expect(autopilot.due(new Date('2026-09-19T10:00:00Z')).ok).toBe(true);   // 15:30 IST
    const late = autopilot.due(new Date('2026-09-19T17:30:00Z'));            // 23:00 IST
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/closed/);
  });

  it('reads the IST calendar rather than the host clock', () => {
    /* 05:00 UTC on Friday is 10:30 IST on... still Friday. 04:45 UTC Saturday
       is 10:15 IST Saturday, which is in the slot. */
    expect(autopilot.due(new Date('2026-09-18T05:00:00Z')).ok).toBe(false);
    expect(autopilot.due(new Date('2026-09-19T04:45:00Z')).ok).toBe(true);
    expect(autopilot.due(SATURDAY).key).toBe('weekend:2026-09-19');
    expect(autopilot.due(SUNDAY).key).toBe('weekend:2026-09-20');
  });
});

describe('autopilot — what it queues', () => {
  it('saves the weekend post for the domain whose turn it is, ready to send', async () => {
    const d = deps();
    const res = await autopilot.tick(SATURDAY, d);
    expect(res.queued).toBe(true);

    const doc = d.LinkedInPost.created[0];
    const domain = weekend.pick(SATURDAY);
    expect(doc.domain).toBe(domain.name);
    expect(doc.final).toBe(weekend.body(domain));
    expect(doc.status).toBe('scheduled');
    expect(doc.source).toBe('autopilot');
    expect(doc.slot).toBe('weekend:2026-09-19');
    expect(doc.kind).toBe('opening');
    /* `draft` is what a person typed, and nobody typed this. */
    expect(doc.draft).toBe('');
  });

  it("attaches the domain poster as base64 and marks the post as carrying one", async () => {
    const d = deps();
    await autopilot.tick(SATURDAY, d);
    const doc = d.LinkedInPost.created[0];
    expect(d.readPoster).toHaveBeenCalledWith(weekend.pick(SATURDAY).slug);
    expect(doc.poster.withImage).toBe(true);
    expect(Buffer.from(doc.poster.png, 'base64').toString()).toBe('poster-bytes');
    expect(doc.poster.fields.alt).toContain('Intern');
  });

  it('posts without an image rather than not posting, when the poster is missing', async () => {
    const d = deps({ readPoster: jest.fn(() => undefined) });
    const res = await autopilot.tick(SATURDAY, d);
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
    const res = await autopilot.tick(SATURDAY, d);
    expect(res.queued).toBe(true);
    expect(res.withImage).toBe(false);
  });

  it('gives Saturday and Sunday different domains and different slots', async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    await autopilot.tick(SATURDAY, d);
    await autopilot.tick(SUNDAY, d);
    expect(model.created).toHaveLength(2);
    expect(model.created[0].domain).not.toBe(model.created[1].domain);
    expect(model.created[0].slot).not.toBe(model.created[1].slot);
  });
});

describe('autopilot — one post per slot', () => {
  it('queues once however many times it ticks in the same slot', async () => {
    const model = fakeModel();
    const d = deps({ LinkedInPost: model });
    const first = await autopilot.tick(SATURDAY, d);
    const second = await autopilot.tick(new Date(SATURDAY.getTime() + 10 * 60000), d);
    const third = await autopilot.tick(new Date(SATURDAY.getTime() + 20 * 60000), d);

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
    await autopilot.tick(SATURDAY, d);
    const loser = await autopilot.tick(SATURDAY, d);
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
    const res = await autopilot.tick(SATURDAY, d);
    expect(res.queued).toBe(false);
    expect(res.reason).toMatch(/content guard/);
    expect(d.LinkedInPost.create).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('queues anyway when the guard only asks for a revision', async () => {
    const d = deps({
      guard: { review: jest.fn(() => ({ verdict: 'revise', issues: [{ code: 'ai_slop', severity: 'revise' }] })) },
    });
    const res = await autopilot.tick(SATURDAY, d);
    expect(res.queued).toBe(true);
    expect(d.LinkedInPost.created[0].verdict).toBe('revise');
    /* The issues are kept so the history can explain the badge later. */
    expect(d.LinkedInPost.created[0].issues).toHaveLength(1);
  });

  it('queues when the guard itself throws, rather than losing the weekend to it', async () => {
    const d = deps({ guard: { review: jest.fn(() => { throw new Error('guard exploded'); }) } });
    const res = await autopilot.tick(SATURDAY, d);
    expect(res.queued).toBe(true);
  });

  it('reports a failed save instead of throwing out of the cron callback', async () => {
    const model = fakeModel();
    model.create = jest.fn(async () => { throw new Error('connection lost'); });
    const d = deps({ LinkedInPost: model });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await autopilot.tick(SATURDAY, d);
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
  it('lists the next weekend days and the domain each will get', () => {
    const rows = autopilot.forecast(TUESDAY, 4);
    expect(rows).toHaveLength(4);
    rows.forEach((r) => {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const dow = new Date(`${r.date}T12:00:00+05:30`).getUTCDay();
      expect([0, 6]).toContain(dow);
      expect(weekend.byName(r.domain)).toBeTruthy();
      expect(r.role).toMatch(/Intern$/);
    });
    /* Chronological, and each one matching what pick() will decide on the day. */
    expect(rows[0].date < rows[1].date).toBe(true);
    expect(rows[0].domain).toBe(weekend.pick(new Date(`${rows[0].date}T12:00:00+05:30`)).name);
  });

  it("drops today once its slot has closed", () => {
    const open = autopilot.forecast(new Date('2026-09-19T05:00:00Z'), 3);   // 10:30 IST Saturday
    const shut = autopilot.forecast(new Date('2026-09-19T17:30:00Z'), 3);   // 23:00 IST Saturday
    expect(open[0].date).toBe('2026-09-19');
    expect(shut[0].date).toBe('2026-09-20');
  });

  it('clamps how far ahead it will look', () => {
    expect(autopilot.forecast(TUESDAY, 0)).toHaveLength(4);
    expect(autopilot.forecast(TUESDAY, 99).length).toBeLessThanOrEqual(14);
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
    expect(out.schedule).toEqual({ hour: 10, days: ['Saturday', 'Sunday'], timezone: 'Asia/Kolkata' });
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
