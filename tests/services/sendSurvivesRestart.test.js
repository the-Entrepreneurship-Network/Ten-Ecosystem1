'use strict';

/**
 * A batch must survive the process that started it.
 *
 * 187 colleges at one mail every two seconds is six and a quarter MINUTES of
 * looping inside node. Merging a pull request runs a deploy, a deploy runs
 * `pm2 restart`, and the restart landed in the middle of that loop: thirteen
 * mails went out, the dashboard said nothing, and the other hundred and
 * seventy-four never happened.
 *
 * The fix is that the batch is claimed in the DATABASE before any of it is
 * sent, so the queue is a fact on disk rather than an array in memory. These
 * tests check the three outcomes that follow from that — crash, quota stop,
 * clean finish — plus the property that makes all of it safe: a contact that
 * has been mailed can never be picked up again.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const src = code('services/collegeOutreach.js');
const runFn = src.slice(src.indexOf('async function run('), src.indexOf('async function resumeInterrupted'));

describe('the batch is claimed before anything is sent', () => {
  test('rows are moved to queued in one update, up front', () => {
    expect(runFn).toMatch(/updateMany\(/);
    expect(runFn).toMatch(/\$set: \{ status: 'queued' \}/);
  });

  test('the claim itself cannot claim a row twice', () => {
    // `status: 'new'` in the filter is what makes two requests a millisecond
    // apart claim disjoint sets rather than the same rows.
    expect(runFn).toMatch(/status: 'new'\s*\}\s*,\s*\{ \$set: \{ status: 'queued' \} \}/);
  });

  test('the loop sends what was claimed, not what was in memory', () => {
    expect(runFn).toMatch(/find\(\{ status: 'queued'/);
  });

  test('a ticked selection still cannot widen who is claimed', () => {
    expect(runFn).toMatch(/const filter = \{ status: 'new', optOut: \{ \$ne: true \} \}/);
    expect(runFn).toMatch(/filter\._id = \{ \$in: ids \}/);
    expect(runFn).not.toMatch(/delete\s+filter\./);
  });
});

describe('what happens when the run stops', () => {
  test('a clean stop hands the unsent rows back, so none are stuck', () => {
    expect(runFn).toMatch(/\$in: untouched \}, status: 'queued' \}, \{ \$set: \{ status: 'new' \} \}/);
  });

  test('the hand-back is in a finally, so a quota stop also releases them', () => {
    expect(runFn).toMatch(/\} finally \{/);
    const tail = runFn.slice(runFn.indexOf('} finally {'));
    expect(tail).toMatch(/status: 'new'/);
  });

  /*
   * The whole design in one assertion: a process that DIES never reaches the
   * finally, so its rows stay queued — and that is the signal, not a bug.
   */
  test('a boot finishes any batch left queued by a dead process', () => {
    const resume = src.slice(src.indexOf('async function resumeInterrupted'));
    expect(resume).toMatch(/countDocuments\(\{ status: 'queued'/);
    expect(resume).toMatch(/run\(\{ resume: true/);
    expect(code('server.js')).toMatch(/resumeInterrupted\(\)/);
  });

  test('resuming can be turned off without touching code', () => {
    expect(src.slice(src.indexOf('async function resumeInterrupted')))
      .toMatch(/COLLEGE_RESUME_ON_BOOT/);
  });
});

describe('nothing can be mailed twice', () => {
  /*
   * This is what makes resume-on-boot safe to do without asking. sendOne
   * flips the contact the moment the transport accepts the mail, so a row
   * that has been sent is no longer `queued` and no later run can find it.
   */
  test('a contact leaves the queue as its mail is accepted', () => {
    const one = src.slice(src.indexOf('async function sendOne'));
    expect(one).toMatch(/status === 'sent' \? 'mailed' : 'bounced'/);
  });

  test('the queue query only ever returns queued rows', () => {
    expect(runFn).toMatch(/find\(\{ status: 'queued', optOut: \{ \$ne: true \} \}\)/);
  });

  test('an opted-out college is excluded at every step', () => {
    expect(runFn).toMatch(/optOut: \{ \$ne: true \}/);
    expect(src.slice(src.indexOf('async function resumeInterrupted')))
      .toMatch(/optOut: \{ \$ne: true \}/);
  });

  test('the model allows the state the queue depends on', () => {
    expect(read('models/CollegeContact.js')).toMatch(/'new', 'queued', 'mailed'/);
  });
});

describe('two sends cannot overlap', () => {
  test('a second run while one is going returns the status instead', () => {
    // Two loops would each throttle to two seconds and together send one a
    // second, which is the throttle gone.
    expect(runFn).toMatch(/if \(currentSend\.running\) return sendStatus\(\)/);
  });
});

describe('the dashboard stops going quiet', () => {
  const html = read('public/growth-os.html');

  test('progress is polled, not announced once and forgotten', () => {
    expect(html).toMatch(/call\('\/colleges\/send\/status'\)/);
    // The interval itself lives in one constant — see growthRateLimit.test.js,
    // which is where the number is pinned. Here it only matters THAT it polls.
    expect(html).toMatch(/setTimeout\(pollSend, POLL_MS\)/);
  });

  test('it says how many of how many, while it runs', () => {
    const fn = html.slice(html.indexOf('async function pollSend'));
    expect(fn.slice(0, 1200)).toMatch(/st\.sent/);
    expect(fn.slice(0, 1200)).toMatch(/st\.total/);
  });

  test('a batch stopped by the quota says so rather than looking finished', () => {
    expect(html.slice(html.indexOf('async function pollSend'), html.indexOf('async function pollSend') + 1200))
      .toMatch(/quotaStopped/);
  });

  test('a send already running when the page opens is picked up', () => {
    const at = html.indexOf('loadQuota(); loadSegments();');
    expect(html.slice(at, at + 400)).toMatch(/pollSend\(\)/);
  });

  test('a claimed row is counted, not hidden', () => {
    // Without a Sending column a queued row vanishes from Waiting and is
    // counted nowhere, so an interrupted batch reads as if it had been sent.
    expect(html).toMatch(/\['Sending', by\.queued \|\| 0\]/);
  });

  test('the estimate tells the truth about how long it takes', () => {
    const fn = html.slice(html.indexOf('async function startCollegeSend'));
    expect(fn.slice(0, 700)).toMatch(/r\.queued \* 2\) \/ 60/);
  });
});

describe('the rate is the one that was asked for', () => {
  /* Read from source, not required: this module pulls in nodemailer, which
     the test environment has no reason to install. */
  test('one mail every two seconds', () => {
    const m = src.match(/GROWTH_SEND_THROTTLE_MS, 10\) \|\| (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBe(2000);
  });

  test('and it is tunable without a deploy', () => {
    expect(src).toMatch(/GROWTH_SEND_THROTTLE_MS/);
  });

  test('a batch of 200 is allowed in one press', () => {
    // The route caps a batch at 500, so 200 ticked is one send, not three.
    expect(runFn).toMatch(/Math\.min\(500/);
  });
});
