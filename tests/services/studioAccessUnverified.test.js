'use strict';

const fs = require('fs');
const path = require('path');
const studioAccess = require('../../services/studioAccess');

const root = path.join(__dirname, '../..');
/** Assert against live code, never a comment quoting the old code. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const before = new Date(studioAccess.UNVERIFIED_UNTIL.getTime() - 86400000);
const after = new Date(studioAccess.UNVERIFIED_UNTIL.getTime() + 86400000);

describe('typing a transaction number is not paying', () => {
  /*
   * SETTLED was ['success', 'pending_verification'], and 'pending_verification'
   * is the state a payment is in when the student has typed a reference into
   * the box and nobody has looked at it. So anyone could open the Course, the
   * Resume Portal and the Job Portal by typing anything at all — every paid
   * product in the Studio, for free, on the live site.
   */
  it('an unchecked reference written today opens nothing', () => {
    expect(studioAccess.isSettled({ status: 'pending_verification', createdAt: after })).toBe(false);
  });

  it('a confirmed payment still opens everything', () => {
    expect(studioAccess.isSettled({ status: 'success' })).toBe(true);
  });

  it('a student who has access today does not lose it', () => {
    /*
     * Some of them really did pay — the reference simply was never checked, and
     * the Studio is what they are using. Taking it back without looking would
     * punish the honest ones for a bug that was ours. The backlog is listed by
     * scripts/list-unverified-studio-access.js so a person can check it, and the
     * cutoff moves forward afterwards.
     */
    expect(studioAccess.isSettled({ status: 'pending_verification', createdAt: before })).toBe(true);
  });

  it('a payment that was never even attempted opens nothing, before or after', () => {
    expect(studioAccess.isSettled({ status: 'pending', createdAt: before })).toBe(false);
    expect(studioAccess.isSettled({ status: 'pending', createdAt: after })).toBe(false);
  });

  it('a grandfathered row with no date is not trusted', () => {
    // Without a date there is nothing to compare, and "no date" must not read as
    // "old enough".
    expect(studioAccess.isSettled({ status: 'pending_verification' })).toBe(false);
    expect(studioAccess.isSettled({ status: 'pending_verification', createdAt: null })).toBe(false);
  });

  it('the cutoff can be moved without a deploy', () => {
    const src = strip(fs.readFileSync(path.join(root, 'services/studioAccess.js'), 'utf8'));
    expect(src).toContain('process.env.STUDIO_UNVERIFIED_GRANDFATHER_UNTIL');
    expect(src).toContain("const SETTLED = ['success'];");
  });

  it('unverified rows are still fetched, so they can be judged rather than hidden', () => {
    // Dropping them from the query would make every grandfathered student look
    // unpaid, which is the same outage by a different route.
    const src = strip(fs.readFileSync(path.join(root, 'services/studioAccess.js'), 'utf8'));
    expect(src).toContain("status: { $in: [...SETTLED, 'pending_verification', 'pending'] }");
  });
});

describe('pages and routes that nothing could reach are gone', () => {
  it('the four dead pages are deleted', () => {
    ['student-portal.html', 'register-hub.html', 'preview-changes.html', 'payment-success.html']
      .forEach((page) => {
        expect(fs.existsSync(path.join(root, 'public', page))).toBe(false);
      });
  });

  it('the three that ARE reachable were kept', () => {
    // success.html and groups.html have routes and inbound links, and
    // resume-dashboard.html is linked twice from the built Resume Portal bundle.
    ['success.html', 'groups.html', 'resume-dashboard.html'].forEach((page) => {
      expect(fs.existsSync(path.join(root, 'public', page))).toBe(true);
    });
  });

  it('the unmounted payment router that had no auth on initiate is gone', () => {
    // It took studentId straight from the request body, so mounting it would
    // have handed anyone the ability to create orders against any student.
    expect(fs.existsSync(path.join(root, 'routes/paymentRoutes.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'controllers/paymentController.js'))).toBe(false);
  });
});
