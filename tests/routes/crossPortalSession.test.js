'use strict';

/**
 * @jest-environment node
 *
 * One browser, one cookie, several portals.
 *
 * HR reported "Your HR session has expired" in ordinary Chrome while the same
 * sign-in worked perfectly in a private window. The difference was not the
 * browser: it was that the admin console had been used in the ordinary one.
 *
 * Admin sign-in regenerates the session id, which is correct — it is what stops
 * session fixation — but regenerate() destroys the whole session, and the HR,
 * student and coordinator portals share it. So opening the admin console signed
 * the same person out of every other portal, and the HR page, which renders
 * from sessionStorage, went on looking signed in while every request behind it
 * answered 401.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const adminRoutes = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');
const hrPortal    = fs.readFileSync(path.join(root, 'public/hr-portal.html'), 'utf8');
const serverJs    = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

describe('signing into one portal does not sign you out of the others', () => {
  const login = adminRoutes.slice(0, adminRoutes.indexOf("router.post('/logout'"));

  it('the other roles are carried across the regeneration', () => {
    expect(login).toMatch(/for \(const role of \['student', 'hr', 'coordinator'\]\)/);
    expect(login).toMatch(/Object\.assign\(req\.session, carried\)/);
  });

  it('they are captured BEFORE regenerate, or there would be nothing left to carry', () => {
    const captured = login.indexOf('const carried = {}');
    const regen = login.indexOf('req.session.regenerate(');
    expect(captured).toBeGreaterThan(-1);
    expect(regen).toBeGreaterThan(captured);
  });

  it('the session id is still regenerated — fixation protection is not traded away', () => {
    expect(login).toMatch(/req\.session\.regenerate\(/);
  });

  it('carrying a role over does not grant one that was never authenticated', () => {
    // Only roles already present on the session are copied; nothing is invented.
    expect(login).toMatch(/if \(req\.session && req\.session\[role\]\) carried\[role\] = req\.session\[role\]/);
  });

  it('a real sign-out still ends everything', () => {
    // /logout is the deliberate "end my session" path and must stay total —
    // that is the one that matters on a shared or college machine.
    expect(serverJs).toMatch(/req\.session\.destroy\(/);
    expect(serverJs).toMatch(/res\.clearCookie\("ten\.sid"\)/);
  });
});

describe('a portal that renders from storage must confirm the server session', () => {
  it('the HR portal checks immediately, not seconds later', () => {
    // It used to poll after 2s, so HR could start working inside a dead session
    // and have everything they did fail quietly.
    expect(hrPortal).not.toMatch(/setTimeout\(loadPendingDocsBadge, 2000\)/);
    expect(hrPortal).toMatch(/^loadPendingDocsBadge\(\);$/m);
  });

  it('and says so once, rather than looping', () => {
    expect(hrPortal).toMatch(/_hrSessionExpiredNoticed/);
    expect(hrPortal).toMatch(/if \(_hrSessionExpiredNoticed\) return;/);
  });

  it('a 401 on that check is what triggers it', () => {
    expect(hrPortal).toMatch(/if \(r\.status === 401\) \{ handleHRSessionExpired\(\); return; \}/);
  });
});
