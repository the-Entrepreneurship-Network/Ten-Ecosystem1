'use strict';

/**
 * Three installable apps, one notification orb, and one notification section.
 *
 * The portal was installable twice — as "TEN Portal" from the landing page and
 * as "TEN Internship Portal" from the dashboard. Notifications makes three, so
 * a student can keep alerts on their home screen without opening the whole
 * portal to check them.
 *
 * Two things have to hold for that to work at all, and neither is visible by
 * looking at the page:
 *
 *   - Each manifest needs its OWN `id`. A browser decides "have I already
 *     installed this?" from the id, so two manifests sharing one are a single
 *     install that merely changed its start page — the third app would silently
 *     replace the second.
 *
 *   - The icons have to differ. Three identical tiles on a home screen make the
 *     extra installs worse than useless.
 *
 * The other half of this change removed the dashboard's own bell and slide-in
 * panel. It was the SECOND notification system on that page: the sidebar
 * already linked to /notifications, which merges portal alerts with unread
 * messages, while the panel read a legacy endpoint that showed neither and
 * marked things read against a route that does not exist.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const readPublic = (f) => fs.readFileSync(path.join(root, 'public', f), 'utf8');
const readJson = (f) => JSON.parse(readPublic(f));

const portalJson = readJson('manifest.json');
const portalWeb = readJson('manifest.webmanifest');
const alerts = readJson('manifest-notifications.webmanifest');

describe('three apps, three identities', () => {
  it('the notifications app opens onto the notifications page', () => {
    expect(alerts.start_url).toBe('/notifications');
  });

  it('every manifest declares a distinct id', () => {
    // THE ONE THAT MATTERS. Without it the third install is not a third app.
    const ids = [portalJson.id || portalJson.start_url,
                 portalWeb.id || portalWeb.start_url,
                 alerts.id || alerts.start_url];
    expect(new Set(ids).size).toBe(3);
  });

  it('is named so it is tellable apart in an app list', () => {
    const names = [portalJson.name, portalWeb.name, alerts.name];
    expect(new Set(names).size).toBe(3);
    expect(alerts.name).toMatch(/notification/i);
  });

  it('carries its own short name, which is what a home screen shows', () => {
    expect(alerts.short_name).toBeTruthy();
    expect(alerts.short_name).not.toBe(portalWeb.short_name);
    expect(alerts.short_name.length).toBeLessThanOrEqual(12);
  });

  it('has a scope that contains its own start url', () => {
    expect(alerts.start_url.indexOf(alerts.scope)).toBe(0);
  });

  it('reaches /messages, so a message row opens in the app rather than a tab', () => {
    expect('/messages'.indexOf(alerts.scope)).toBe(0);
  });
});

describe('its icons are its own, and real', () => {
  const files = alerts.icons.map((i) => i.src);

  it('does not reuse the portal icons', () => {
    const portalIcons = portalWeb.icons.map((i) => i.src);
    files.forEach((f) => expect(portalIcons).not.toContain(f));
  });

  it('ships a maskable one, or Android crops the artwork', () => {
    expect(alerts.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it.each(alerts.icons.map((i) => [i.src, i.sizes]))('%s exists and is a real PNG', (src) => {
    const file = path.join(root, 'public', src);
    expect(fs.existsSync(file)).toBe(true);
    const head = fs.readFileSync(file).subarray(0, 8);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('declares the size each icon actually is', () => {
    for (const icon of alerts.icons) {
      const buf = fs.readFileSync(path.join(root, 'public', icon.src));
      // IHDR width and height live at bytes 16-23 of every PNG.
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});

describe('the page and the server agree the app exists', () => {
  const page = readPublic('notifications.html');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const sw = readPublic('sw.js');

  it('the notifications page links its own manifest', () => {
    expect(page).toContain('href="/manifest-notifications.webmanifest"');
    // Linking the portal manifest here is what made this page just another
    // door into the portal app.
    expect(page).not.toContain('href="/manifest.webmanifest"');
  });

  it('the server serves it as a manifest, not as a plain file', () => {
    // Served as anything but application/manifest+json, browsers ignore it and
    // the app quietly stops being installable.
    const at = server.indexOf('/manifest-notifications.webmanifest');
    expect(at).toBeGreaterThan(-1);
    expect(server.slice(at, at + 400)).toContain('application/manifest+json');
  });

  it('the service worker keeps the manifest available offline', () => {
    expect(sw).toContain('/manifest-notifications.webmanifest');
    expect(sw).toContain('/icons/notif-192.png');
  });

  it('the shell cache name was bumped, or the old list survives the deploy', () => {
    const m = sw.match(/SHELL_CACHE\s*=\s*'ten-shell-v(\d+)'/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(4);
  });
});

describe('the orb replaced the old bell, everywhere', () => {
  const dashboard = readPublic('student-dashboard.html');

  it('the dashboard no longer carries its own notification panel', () => {
    for (const gone of ['notif-panel', 'id="notifPanel"', 'toggleNotifPanel',
                        'notif-bell-btn', 'notifScroll', 'notifOverlay']) {
      expect(dashboard).not.toContain(gone);
    }
  });

  it('the dead mark-all-read call went with it', () => {
    // It posted to a route that does not exist, inside an empty catch: the
    // badge cleared on screen and the count came back on the next load. The
    // CALL is what must be gone — the comment that records why is not.
    expect(dashboard).not.toMatch(/fetch\(\s*['"]\/notifications\/mark-all-read/);
  });

  it('the sidebar still gets to the notification centre', () => {
    // Removing the panel must not remove the way in.
    expect(dashboard).toContain("window.location.href='/notifications'");
  });

  it.each([
    'student-dashboard.html', 'v2-tasks.html', 'my-certificates.html',
    'my-documents.html', 'notifications.html', 'messages.html', 'quiz-portal.html',
    'hr-portal.html', 'hr-ecosystem.html', 'coordinator-dashboard.html', 'ten-admin.html'
  ])('%s loads the orb', (file) => {
    expect(readPublic(file)).toContain('src="/notify-orb.js"');
  });
});

describe('the orb itself', () => {
  const orb = readPublic('notify-orb.js');

  it('only appears when something is actually pending', () => {
    expect(orb).toContain("if (total === 0) { hide(); return; }");
  });

  it('greets once per sign-in rather than on every page', () => {
    expect(orb).toContain('sessionStorage');
    expect(orb).toContain("cause === 'first'");
  });

  it('buzzes when something arrives while the portal is open', () => {
    expect(orb).toMatch(/navigator\.vibrate/);
    expect(orb).toContain('ten-orb-buzz');
  });

  it('stays out of the way on the page it would send you to', () => {
    expect(orb).toContain('onOwnPage');
  });

  it('keeps clear of the chat launcher on a phone', () => {
    // Both are round, fixed, and near the same z-index. Two of them fighting
    // over the bottom-right corner is how the mobile layout broke last time.
    expect(orb).toMatch(/bottom:calc\(128px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it('honours a reader who asked the system for less movement', () => {
    expect(orb).toContain('prefers-reduced-motion');
  });

  it('contains no raw non-ASCII outside comments', () => {
    // A .js response with no charset inherits the document's encoding, so a
    // literal separator renders as mojibake on any page missing a meta charset.
    const code = orb.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    const bad = code.split('').filter((c) => c.charCodeAt(0) > 127);
    expect(bad).toEqual([]);
  });
});
