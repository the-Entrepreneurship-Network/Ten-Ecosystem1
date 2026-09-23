'use strict';

/**
 * The Growth OS, checked against its own source.
 *
 * Every assertion here is a property that, if it regressed, would either send
 * mail nobody can stop or block mail a student has earned. They are text
 * assertions rather than live calls because this suite has no database and no
 * SMTP; the arithmetic that CAN run for real is in
 * tests/config/growthQuota.test.js.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// Comments describe intent; they must never satisfy an assertion about code.
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const FILES = [
  'config/growthQuota.js', 'models/GrowthCampaign.js', 'models/GrowthQuotaGrant.js',
  'services/growthQuota.js', 'services/growthSegments.js', 'services/growthSender.js',
  'services/growthTracking.js', 'middleware/growthAuth.js', 'routes/growth.js'
];

describe('every file parses', () => {
  it.each(FILES)('%s', (f) => {
    execFileSync(process.execPath, ['--check', path.join(root, f)]);
  });
});

describe('the quota cannot be bypassed', () => {
  it('the campaign sender checks before every message, not once per run', () => {
    /*
     * A check at the top of the loop only knows what was true when the run
     * started. The Monday cron and a hand-sent campaign overlap, and the one
     * that started first would happily spend the other's allowance.
     */
    const src = code('services/growthSender.js');
    const loopAt = src.indexOf('for (let i = 0');
    expect(loopAt).toBeGreaterThan(-1);
    expect(src.slice(loopAt)).toContain('quota.canSend(1)');
  });

  it('the weekly cron checks it too — the UI is not the enforcement point', () => {
    // If the cap lived only in the dashboard, the ~1,550-message Monday run
    // would sail straight past it and the cap would be decorative.
    const src = code('server.js');
    const at = src.indexOf('async function runActivityMailer');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 4000)).toContain('growthQuota.canSend(1)');
  });

  it('running out stops the run and counts who was missed', () => {
    // Skipped recipients are reported, never silently dropped.
    const src = code('services/growthSender.js');
    expect(src).toContain('skipped += recipients.length - i');
    expect(code('server.js')).toContain('quotaSkipped');
  });

  it('an extension can never push a period past the ceiling', () => {
    const src = code('services/growthQuota.js');
    expect(src).toContain('grantable');
    expect(src).toContain('Q.EXTENSION_MAX - granted');
  });
});

describe('unsubscribe is honoured', () => {
  it('every segment filters opted-out students in the query', () => {
    // In the query, not the loop: a new caller cannot forget a base filter.
    const src = code('services/growthSegments.js');
    expect(src).toContain('emailOptOut');
    const at = src.indexOf('function baseFilter');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 300)).toContain('$ne: true');
  });

  it('the weekly cron excludes them as well', () => {
    expect(code('server.js')).toContain('Student.find({ emailOptOut: { $ne: true } })');
  });

  it('every campaign mail carries an unsubscribe link', () => {
    expect(code('services/growthSender.js')).toContain('unsubscribeUrl');
    expect(code('server.js')).toContain('growthTracking.unsubscribeUrl');
  });

  it('unsubscribing covers every row holding that address', () => {
    /*
     * One person can hold several Student rows — one per domain — under a
     * single address. Opting out only the row whose id was in the link leaves
     * the others mailing them, which reads as ignoring the request.
     */
    const src = code('routes/growth.js');
    expect(src).toContain('Student.updateMany({ email: me.email }');
  });

  it('opting out never blocks a certificate', () => {
    // Only marketing types consult the flag; transactional mail is untouched.
    expect(code('config/growthQuota.js')).not.toContain("'offer'");
    expect(require('../../config/growthQuota').MARKETING_TYPES).not.toContain('offer');
  });
});

describe('the public tracking routes are safe', () => {
  it('the click route takes its destination from the campaign, never the request', () => {
    /*
     * A `?url=` parameter here would be an open redirect on the domain
     * students are being taught to trust — a phishing link that starts on
     * the real site.
     */
    const src = code('routes/growth.js');
    const at = src.indexOf("trackingRouter.get('/c/");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, at + 900);
    expect(handler).toContain('c.ctaUrl');
    expect(handler).not.toMatch(/req\.query/);
  });

  it('every tracking route verifies its signature', () => {
    const src = code('routes/growth.js');
    // Slice to the NEXT route rather than a fixed window: the unsubscribe
    // handler carries a page template before it acts, and a window that
    // happens to stop short would pass this test by not looking.
    for (const route of ["'/o/", "'/c/", "'/u/"]) {
      const at = src.indexOf('trackingRouter.get(' + route);
      expect(at).toBeGreaterThan(-1);
      const next = src.indexOf('trackingRouter.get(', at + 1);
      const handler = src.slice(at, next === -1 ? src.length : next);
      expect(handler).toContain('tracking.verify(');
    }
  });

  it('signing fails closed when SESSION_SECRET is missing', () => {
    // Otherwise the HMAC would be a constant anyone could reproduce, and the
    // unsubscribe link would work for any student id.
    const src = code('services/growthTracking.js');
    expect(src).toContain("if (!key) return ''");
    expect(src).toContain('if (!expected || !sig');
  });

  it('signatures are compared in constant time', () => {
    expect(code('services/growthTracking.js')).toContain('timingSafeEqual');
  });

  it('the pixel route avoids the Express 5 suffix trap', () => {
    /*
     * Express 5 uses path-to-regexp v8, where `:sig.gif` no longer parses the
     * way it did in v4 — and a pixel that 404s is a feature that silently
     * reports nothing.
     */
    const src = code('routes/growth.js');
    expect(src).not.toContain(':sig.gif');
    expect(src).toContain("'/o/:campaignId/:uid/:file'");
  });
});

describe('the Growth OS sign-in is its own', () => {
  it('uses its own credentials, not the admin hash', () => {
    const src = code('middleware/growthAuth.js');
    expect(src).toContain('GROWTH_PASSWORD_HASH');
    expect(src).toContain('GROWTH_USERNAME');
    expect(src).not.toContain('ADMIN_PASSWORD_HASH');
  });

  it('has no default password and no cleartext fallback', () => {
    const src = code('middleware/growthAuth.js');
    expect(src).toContain("process.env.GROWTH_PASSWORD_HASH || ''");
    expect(src).toContain('bcrypt.compare');
  });

  it('compares even when the username is wrong, so timing tells nothing', () => {
    const src = code('middleware/growthAuth.js');
    const at = src.indexOf('!== GROWTH_USERNAME');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 260)).toContain('bcrypt.compare');
  });

  it('rate-limits the login', () => {
    expect(code('routes/growth.js')).toContain('rateLimit');
  });

  it('signing in does not sign the same browser out of the other portals', () => {
    /*
     * One cookie serves every role. A bare regenerate() throws the rest of the
     * session away, so opening the Growth OS in a second tab would silently
     * end the student's or HR's session in the first.
     */
    const src = code('routes/growth.js');
    expect(src).toContain('carried');
    expect(src).toContain("'coordinator'");
    expect(src).toContain('regenerate');
  });

  it('every API route behind the login is guarded', () => {
    const src = code('routes/growth.js');
    const routes = src.match(/^api\.(get|post)\('[^']+'/gm) || [];
    expect(routes.length).toBeGreaterThan(4);
    for (const r of routes) {
      const at = src.indexOf(r);
      const line = src.slice(at, src.indexOf('\n', at + r.length) + 1);
      // /login is the one that cannot require a session to reach.
      if (line.includes("'/login'")) continue;
      expect(line).toContain('requireGrowthAPI');
    }
  });
});

describe('the weekly mail is now measurable', () => {
  it('it is recorded as a campaign so it appears in the dashboard', () => {
    expect(code('server.js')).toContain('GrowthCampaign.create(');
  });

  it('its button and pixel are per person, so a click identifies a student', () => {
    const src = code('server.js');
    expect(src).toContain('growthTracking.clickUrl(cid, uid)');
    expect(src).toContain('growthTracking.openUrl(cid, uid)');
  });

  it('it carries a real offer rather than asking for nothing', () => {
    // "We miss you, come back" sold nothing and linked to no product.
    const src = read('server.js');
    const at = src.indexOf('inactive-reengagement');
    expect(src.slice(at, at + 1800)).toMatch(/₹500/);
  });
});

describe('recipients are people, not rows', () => {
  it('the segment de-duplicates by address', () => {
    /*
     * Student holds one row per DOMAIN, so somebody on two domains is two
     * rows under one address. Mailing rows rather than people is what sent
     * the same mail twice every Monday before.
     */
    const src = code('services/growthSegments.js');
    const at = src.indexOf('function recipientsFor');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 700)).toContain('seen.has(addr)');
  });
});
