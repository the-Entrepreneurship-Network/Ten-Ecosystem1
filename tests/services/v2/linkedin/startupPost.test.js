'use strict';

/**
 * The post that goes out the moment the change is deployed.
 *
 * The requirement is simple to say and easy to get subtly wrong: merging this
 * should put a post on the company page straight away, and the two-hourly
 * rotation carries on from there. Without a kick at start-up the first post
 * waits for the next five-minute cron edge and then the next minute edge to
 * publish — up to six minutes of a page that looks like nothing shipped.
 *
 * What is proved here is the whole chain rather than either half of it: the
 * autopilot queues on boot, the scheduler sweeps a moment later and hands the
 * post to the LinkedIn client, and the second boot in the same slot posts
 * nothing. That last one is the important one. The start-up kick runs on every
 * restart, not just the first, so the thing standing between a redeploy and a
 * duplicate post is the unique index on `slot` — and a test that only covered
 * the happy path would pass just as well with that protection removed.
 *
 * node-cron is mocked because a real registered task outlives the suite and
 * hangs the run, and NODE_ENV is moved off 'test' for the same reason start()
 * refuses to run under it.
 */

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

/* Required inside each test rather than here: jest.resetModules() below hands
   the module under test a fresh copy of node-cron, and a reference captured at
   file scope would be a different object than the one start() calls. */
let cron;

/* Mongoose warns when it sees fake timers. It is not under test here and the
   warning is noise on every run. */
process.env.SUPPRESS_JEST_WARNINGS = 'true';

/*
 * One in-memory collection shared by the autopilot (which inserts) and the
 * scheduler (which claims and publishes), because the point of the test is
 * that the second sees what the first wrote.
 */
function makeCollection() {
  const docs = [];
  let seq = 0;

  const Model = {
    docs,
    create: jest.fn(async (doc) => {
      /* The unique sparse index on `slot`, which is the only thing stopping a
         restart inside an already-posted slot from posting again. */
      if (doc.slot && docs.some((d) => d.slot === doc.slot)) {
        const e = new Error('E11000 duplicate key error collection: linkedinposts index: slot_1');
        e.code = 11000;
        throw e;
      }
      seq += 1;
      const saved = Object.assign({ _id: `id${seq}`, history: [] }, doc);
      docs.push(saved);
      return saved;
    }),
    /* The scheduler's atomic claim: flip one due 'scheduled' row to
       'publishing' and hand it back. */
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const due = docs.find((d) => d.status === 'scheduled'
        && new Date(d.scheduledFor).getTime() <= new Date(filter.scheduledFor.$lte).getTime());
      if (!due) return null;
      Object.assign(due, update.$set);
      return due;
    }),
    findByIdAndUpdate: jest.fn(async (id, update) => {
      const doc = docs.find((d) => String(d._id) === String(id));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return doc || null;
    }),
  };
  return Model;
}

describe('the post that goes out on deploy', () => {
  const REAL_ENV = process.env.NODE_ENV;
  let autopilot;
  let scheduler;
  let client;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    /* start() refuses to run under NODE_ENV=test, which is the guard that
       keeps cron out of every other suite. */
    process.env.NODE_ENV = 'production';
    delete process.env.LINKEDIN_AUTOPILOT_DISABLED;
    delete process.env.LINKEDIN_SCHEDULER_DISABLED;

    cron = require('node-cron');
    autopilot = require('../../../../services/v2/linkedin/autopilot');
    scheduler = require('../../../../services/v2/linkedin/scheduler');
    client = require('../../../../services/v2/linkedin/linkedinClient');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.NODE_ENV = REAL_ENV;
  });

  it('schedules a first check seconds after start-up, not at the next cron edge', () => {
    autopilot.start();
    expect(cron.schedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function));
    /* Something is pending that is not the cron — the boot kick. */
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    expect(autopilot.FIRST_TICK_MS).toBeLessThanOrEqual(30 * 1000);
  });

  it('sweeps for publishing after the autopilot has had time to queue', () => {
    /* Ordering, not magic numbers: the sweep must land after the queue, or the
       first post waits a full minute for the next tick anyway. */
    expect(scheduler.FIRST_SWEEP_MS).toBeGreaterThan(autopilot.FIRST_TICK_MS);
    expect(scheduler.FIRST_SWEEP_MS).toBeLessThanOrEqual(60 * 1000);
  });

  it('queues a post within seconds of boot, and publishes it', async () => {
    const Model = makeCollection();
    const publish = jest.spyOn(client, 'publish')
      .mockResolvedValue({ ok: true, postUrn: 'urn:li:share:1', url: 'https://linkedin.test/1' });

    autopilot.start();
    scheduler.start();

    /* Run the boot kick, then let its promise chain settle, then the sweep. */
    jest.advanceTimersByTime(autopilot.FIRST_TICK_MS);
    await autopilot.tick(new Date(), { LinkedInPost: Model });
    expect(Model.docs).toHaveLength(1);
    expect(Model.docs[0].status).toBe('scheduled');
    expect(Model.docs[0].final).toContain('WE ARE #HIRING #INTERNS');

    const out = await scheduler.runDue(new Date(), { LinkedInPost: Model, linkedinClient: client });
    expect(out.published).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].text).toContain('Apply for');
    expect(Model.docs[0].status).toBe('published');
  });

  /*
   * The kick runs on every boot. Redeploying twice inside one two-hour slot
   * must not put two posts on the page, and what prevents it is the unique
   * index rather than anything in the code path — several PM2 workers booting
   * together is the same situation.
   */
  it('posts nothing on a second boot inside the same slot', async () => {
    const Model = makeCollection();
    const now = new Date('2026-09-22T09:00:00Z');

    const first = await autopilot.tick(now, { LinkedInPost: Model });
    expect(first.queued).toBe(true);

    /* Redeploy twenty minutes later — same two-hour bucket. */
    const second = await autopilot.tick(new Date(now.getTime() + 20 * 60000), { LinkedInPost: Model });
    expect(second.queued).toBe(false);
    expect(second.reason).toMatch(/already queued/);
    expect(Model.docs).toHaveLength(1);
  });

  it('posts again once the clock crosses into the next slot', async () => {
    const Model = makeCollection();
    const now = new Date('2026-09-22T09:00:00Z');

    await autopilot.tick(now, { LinkedInPost: Model });
    const next = await autopilot.tick(new Date(now.getTime() + 2 * 3600000), { LinkedInPost: Model });

    expect(next.queued).toBe(true);
    expect(Model.docs).toHaveLength(2);
    expect(Model.docs[0].domain).not.toBe(Model.docs[1].domain);
  });

  it('starts neither cron when the kill switches are set', () => {
    process.env.LINKEDIN_AUTOPILOT_DISABLED = '1';
    process.env.LINKEDIN_SCHEDULER_DISABLED = '1';
    jest.resetModules();
    const ap = require('../../../../services/v2/linkedin/autopilot');
    const sch = require('../../../../services/v2/linkedin/scheduler');

    expect(ap.start()).toBeNull();
    expect(sch.start()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
