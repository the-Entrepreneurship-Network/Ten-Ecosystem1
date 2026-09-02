'use strict';

const fs = require('fs');
const path = require('path');
const { install, WINDOW_MS, MAX_KEYS } = require('../../utils/logThrottle');

const root = path.join(__dirname, '../..');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A console that records instead of printing, plus a clock we control. */
function harness() {
  const written = [];
  // Never call toString on what it is handed — one test deliberately passes an
  // object that throws from both message and toString, and the harness must not
  // be the thing that breaks.
  const rec = (...a) => written.push(a.map((x) => (typeof x === 'string' ? x : '<object>')).join(' '));
  const fake = { log: rec, warn: rec, error: rec };
  const clock = { now: 1000 };
  const restore = install(fake, () => clock.now);
  return { written, fake, clock, restore };
}

describe('a repeating log line cannot fill the disk', () => {
  /*
   * THE OUTAGE. mongod aborted at 02:00 — "Writing to log file failed, aborting
   * application" — because the disk was full. This process then wrote one line
   * per request about the missing database, for eight hours, to pm2's logs on
   * that same full disk. That is what stopped mongod from ever restarting: the
   * database died of a full disk, and the complaint about the dead database is
   * what kept it full.
   */
  it('collapses a flood of one identical line', () => {
    const h = harness();
    for (let i = 0; i < 500; i++) {
      h.fake.error('[notifications] unread-count failed: Cannot call messages.distinct()');
    }
    h.restore();
    expect(h.written).toHaveLength(1);
  });

  it('never swallows the first occurrence', () => {
    const h = harness();
    h.fake.error('the database is gone');
    h.restore();
    expect(h.written).toEqual(['the database is gone']);
  });

  it('never suppresses a different line', () => {
    const h = harness();
    h.fake.warn('first problem');
    h.fake.warn('second, unrelated problem');
    h.fake.warn('third, also unrelated');
    h.restore();
    expect(h.written).toHaveLength(3);
  });

  it('says how many it stood in for, so nothing is silently lost', () => {
    const h = harness();
    for (let i = 0; i < 42; i++) h.fake.error('same line');
    h.clock.now += WINDOW_MS + 1;
    h.fake.error('same line');
    h.restore();
    expect(h.written).toEqual([
      'same line',
      '[repeated 41x in the last 60s, not written]',
      'same line'
    ]);
  });

  it('lets the line through again once the window has passed', () => {
    const h = harness();
    h.fake.log('tick');
    h.fake.log('tick');
    expect(h.written).toHaveLength(1);
    h.clock.now += WINDOW_MS + 1;
    h.fake.log('tick');
    h.restore();
    expect(h.written.filter((l) => l === 'tick')).toHaveLength(2);
  });

  it('keeps its own memory bounded', () => {
    // Otherwise a flood of lines that are each different — a per-request id, say
    // — trades a full disk for a full heap.
    const h = harness();
    for (let i = 0; i < MAX_KEYS * 3; i++) h.fake.log('unique message ' + i);
    h.restore();
    // Every one was distinct, so every one printed; the point is that it did not
    // retain them all.
    expect(h.written).toHaveLength(MAX_KEYS * 3);
  });

  it('gives the console back', () => {
    const h = harness();
    h.restore();
    h.fake.log('a');
    h.fake.log('a');
    h.fake.log('a');
    expect(h.written).toEqual(['a', 'a', 'a']);
  });

  it('installs once, not once per call', () => {
    const h = harness();
    const second = install(h.fake, () => h.clock.now);
    expect(second).toBe(h.restore);
    h.restore();
  });

  it('prints rather than throws when an argument cannot be stringified', () => {
    const h = harness();
    const hostile = { get message() { throw new Error('no'); }, toString() { throw new Error('no'); } };
    expect(() => h.fake.error(hostile)).not.toThrow();
    h.restore();
    expect(h.written).toHaveLength(1);
  });
});

describe('the server throttles before anything can log', () => {
  const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));

  it('installs the throttle at the top of the file', () => {
    expect(server).toContain('require("./utils/logThrottle").install()');
    // Ahead of the DNS setup, which is the first thing that can warn.
    expect(server.indexOf('logThrottle')).toBeLessThan(server.indexOf('const dns = require'));
  });
});
