'use strict';

/**
 * @jest-environment node
 *
 * Reading school usage out of the Business Playground.
 *
 * The game is a separate Worker with its own database and no shared accounts,
 * so this carries no identity — one server asking another for counts. Two
 * things have to hold.
 *
 * The key must stay on this server. It opens a door in another system, and
 * the moment it reaches the browser it belongs to everyone who opens the
 * admin page.
 *
 * And none of this may be able to break an admin screen. A school-usage panel
 * is the least important thing in that portal; the game being down, slow,
 * misconfigured or answering nonsense must all end as a panel saying so.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const adminSrc = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');
const pageSrc  = fs.readFileSync(path.join(root, 'public/ten-admin.html'), 'utf8');
const svcSrc   = fs.readFileSync(path.join(root, 'services/gameUsage.js'), 'utf8');

/** Load the service with httpFetch stubbed to whatever this test needs. */
function withFetch(impl, env = {}) {
    jest.resetModules();
    const calls = [];
    jest.doMock('../../services/v2/httpFetch', () => ({
        httpFetch: async (url, options) => { calls.push({ url, options }); return impl(url, options); }
    }));
    const prev = { ...process.env };
    Object.assign(process.env, { GAME_USAGE_KEY: 'a-long-enough-usage-key', ...env });
    const svc = require('../../services/gameUsage');
    return { svc, calls, restore: () => { process.env = prev; jest.dontMock('../../services/v2/httpFetch'); } };
}

const okBody = {
    schools: [{ name: 'DAV Public School', teachers: 2, classes: 3, pupils: 41, created_at: '2026-02-01' }],
    totals:  { schools: 1, teachers: 2, classes: 3, pupils: 41, runs: 77 }
};
const asRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
});

describe('the key stays on the server', () => {
    it('it is sent as a header to the game, not put in a URL', async () => {
        const { svc, calls, restore } = withFetch(async () => asRes(200, okBody));
        await svc.fetchUsage();
        expect(calls).toHaveLength(1);
        expect(calls[0].options.headers['x-usage-key']).toBe('a-long-enough-usage-key');
        // A key in a query string lands in access logs and Referer headers.
        expect(calls[0].url).not.toContain('a-long-enough-usage-key');
        restore();
    });

    it('the admin page never fetches the game directly', () => {
        // The browser asks the portal; the portal asks the game. A fetch from
        // the page would need the key in the page.
        const at = pageSrc.indexOf('async function loadSchools');
        expect(at).toBeGreaterThan(-1);
        const fn = pageSrc.slice(at, at + 3000);
        expect(fn).toMatch(/api\('\/game-usage'\)/);
        // It must not call the game's host, and must not send the game's
        // header itself. GAME_USAGE_KEY appears in this function as the NAME
        // of the variable an admin has to set, which is help text, not a
        // secret — so the check is on the host and the header, not the name.
        expect(fn).not.toMatch(/workers\.dev/);
        expect(fn).not.toMatch(/headers\s*:/);
    });

    it('the page names the variable but never sends the header', () => {
        // The distinction that matters: printing "set GAME_USAGE_KEY" tells
        // an admin what to do; sending x-usage-key from the browser would
        // mean the value had to be in the page.
        expect(pageSrc).not.toMatch(/x-usage-key/i);
        const mentions = pageSrc.match(/GAME_USAGE_KEY/g) || [];
        expect(mentions.length).toBeGreaterThan(0);     // the help text
        // ...and only ever as prose, never assigned a value.
        expect(pageSrc).not.toMatch(/GAME_USAGE_KEY\s*[=:]/);
    });

    it('the route is behind the admin guard', () => {
        expect(adminSrc).toMatch(/router\.get\('\/game-usage', requireAdminAPI/);
    });
});

describe('nothing here can take the admin down', () => {
    it('no key configured is reported, not attempted', async () => {
        const { svc, calls, restore } = withFetch(async () => asRes(200, okBody), { GAME_USAGE_KEY: '' });
        await expect(svc.fetchUsage()).resolves.toMatchObject({ ok: false, reason: 'not-configured' });
        expect(calls).toHaveLength(0);          // no pointless round trip
        restore();
    });

    it('a short key counts as unconfigured, matching the game', async () => {
        // The game refuses a configured value under eight characters, so a
        // short key here would always be rejected there. Say so before the
        // round trip rather than reporting it as the game refusing us.
        const { svc, restore } = withFetch(async () => asRes(200, okBody), { GAME_USAGE_KEY: 'abc' });
        await expect(svc.fetchUsage()).resolves.toMatchObject({ reason: 'not-configured' });
        restore();
    });

    it('a thrown socket error becomes a reason, not an exception', async () => {
        const { svc, restore } = withFetch(async () => { throw new Error('ECONNREFUSED 1.2.3.4:443'); });
        await expect(svc.fetchUsage()).resolves.toMatchObject({ ok: false, reason: 'unreachable' });
        restore();
    });

    it('the failure never carries the key out with it', async () => {
        const { svc, restore } = withFetch(async () => { throw new Error('connect failed'); });
        const out = await svc.fetchUsage();
        expect(JSON.stringify(out)).not.toContain('a-long-enough-usage-key');
        restore();
    });

    it('404 reads as a rejected key, because that is what the game sends', async () => {
        // The game answers 404 to a wrong key rather than confirming the route
        // exists. Reporting that as "not found" would send someone looking for
        // a moved endpoint instead of a mismatched secret.
        const { svc, restore } = withFetch(async () => asRes(404, { error: 'Not found.' }));
        await expect(svc.fetchUsage()).resolves.toMatchObject({ ok: false, reason: 'rejected' });
        restore();
    });

    it('a 500 from the game is an error, not a rejection', async () => {
        const { svc, restore } = withFetch(async () => asRes(500, {}));
        await expect(svc.fetchUsage()).resolves.toMatchObject({ ok: false, reason: 'error', status: 500 });
        restore();
    });

    it('a non-JSON body is handled', async () => {
        const { svc, restore } = withFetch(async () => ({
            ok: true, status: 200,
            json: async () => { throw new SyntaxError('Unexpected token <'); },
            text: async () => '<html>'
        }));
        await expect(svc.fetchUsage()).resolves.toMatchObject({ ok: false, reason: 'bad-json' });
        restore();
    });

    it('a request that hangs is bounded by a timeout', async () => {
        const { svc, calls, restore } = withFetch(async () => asRes(200, okBody));
        await svc.fetchUsage();
        expect(calls[0].options.timeoutMs).toBeGreaterThan(0);
        expect(calls[0].options.timeoutMs).toBeLessThanOrEqual(15000);
        restore();
    });

    it('the route answers 200 even when the game is down', () => {
        // A 500 here would make the browser noisier than the situation
        // deserves; the panel renders its own explanation.
        const at = adminSrc.indexOf("router.get('/game-usage'");
        const route = adminSrc.slice(at, at + 900);
        expect(route).toMatch(/res\.json\(\{\s*success: out\.ok/);
        expect(route).not.toMatch(/res\.status\(5\d\d\)/);
    });
});

describe('what the game sends is shaped before it is rendered', () => {
    it('a good answer comes back as numbers and strings', async () => {
        const { svc, restore } = withFetch(async () => asRes(200, okBody));
        const out = await svc.fetchUsage();
        expect(out.ok).toBe(true);
        expect(out.schools[0]).toEqual({
            name: 'DAV Public School', teachers: 2, classes: 3, pupils: 41, createdAt: '2026-02-01'
        });
        expect(out.totals.runs).toBe(77);
        restore();
    });

    it('rubbish from the other side does not reach the page as-is', async () => {
        // The game is deployed separately and can change without this app.
        const { svc, restore } = withFetch(async () => asRes(200, {
            schools: [{ name: { nope: 1 }, teachers: 'many', classes: null }],
            totals: 'not an object'
        }));
        const out = await svc.fetchUsage();
        expect(out.ok).toBe(true);
        expect(typeof out.schools[0].name).toBe('string');
        expect(out.schools[0].teachers).toBe(0);
        expect(out.totals.schools).toBe(0);
        restore();
    });

    it('missing schools is an empty list, not a crash', async () => {
        const { svc, restore } = withFetch(async () => asRes(200, {}));
        await expect(svc.fetchUsage()).resolves.toMatchObject({ ok: true, schools: [] });
        restore();
    });

    it('school names are escaped before they reach innerHTML', () => {
        // The name comes from another system, typed by a teacher there.
        const at = pageSrc.indexOf('async function loadSchools');
        const fn = pageSrc.slice(at, at + 2600);
        expect(fn).toMatch(/escIdea\(s\.name\)/);
    });
});
