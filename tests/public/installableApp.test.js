'use strict';

/**
 * @jest-environment node
 *
 * The whole site installs as one app, "TEN Portal", from any page.
 *
 * What breaks it is invisible on the page itself: a page that links no
 * manifest cannot be installed from; a page that links a different one installs
 * a second copy of the site under another id; a changed `id` strands every
 * existing install; and the single-page portals are build output, so a
 * manifest added only to public/<portal>/index.html vanishes at the next build.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const pub = (f) => path.join(root, 'public', f);
const read = (f) => fs.readFileSync(f, 'utf8');
const manifest = JSON.parse(read(pub('manifest.webmanifest')));
const LINK = '<link rel="manifest" href="/manifest.webmanifest">';

// offline.html is the service worker's own fallback page; notifications.html
// is the separate "TEN Alerts" app with its own manifest.
const OWN_RULES = ['offline.html', 'notifications.html'];
const pages = fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.html') && !OWN_RULES.includes(f));
const PORTALS = ['student-portal', 'hackathon-portal', 'job-portal', 'resume-portal'];

describe('the manifest', () => {
    it('keeps the id existing installs were made under', () => {
        // Changing it does not rename the app: it makes a new one and leaves
        // every phone that installed the old one without updates.
        expect(manifest.id).toBe('/student-dashboard');
    });

    it('opens through /app, inside its own scope, as an app', () => {
        expect(manifest.start_url).toBe('/app');
        expect(manifest.scope).toBe('/');
        expect(manifest.display).toBe('standalone');
    });

    it.each(['192x192', '512x512'])('has a real %s icon', (size) => {
        const icon = manifest.icons.find((i) => i.sizes === size && i.purpose !== 'maskable');
        expect(icon).toBeDefined();
        expect(fs.existsSync(pub(icon.src.slice(1)))).toBe(true);
    });
});

describe('every page installs the same app', () => {
    it.each(pages)('%s links the portal manifest', (f) => {
        expect(read(pub(f))).toContain(LINK);
    });

    it('nothing links the old duplicate manifest', () => {
        expect(fs.existsSync(pub('manifest.json'))).toBe(false);
        for (const f of pages) expect(read(pub(f))).not.toContain('/manifest.json');
    });

    it.each(PORTALS)('%s carries it in its source and in its build', (portal) => {
        expect(read(path.join(root, `${portal}-app`, 'index.html'))).toContain(LINK);
        expect(read(pub(`${portal}/index.html`))).toContain(LINK);
    });
});

describe('the app works where it opens', () => {
    const { startPage } = require('../../routes/appStart');
    const FILE = { '/': 'index.html', '/student-dashboard': 'student-dashboard.html', '/founder-os': 'founder-os.html',
        '/mentor-dashboard': 'mentor-dashboard.html', '/investor-dashboard': 'investor-dashboard.html',
        '/contractor-dashboard': 'contractor-dashboard.html', '/coordinator-dashboard.html': 'coordinator-dashboard.html',
        '/hr-portal': 'hr-portal.html', '/ten-admin': 'ten-admin.html', '/learn': 'learn.html' };
    const sessions = [undefined, { student: { employeeId: 'x' } }, { ecosystemUserRole: 'founder' }, { ecosystemUserRole: 'mentor' },
        { ecosystemUserRole: 'investor' }, { ecosystemUserRole: 'contractor' }, { coordinator: {} }, { hr: {} }, { adminUser: {} }, { learner: {} }];

    it.each(sessions.map((s) => [startPage(s)]))('%s registers the service worker', (where) => {
        // The worker is what shows the offline page and delivers notifications
        // inside the installed app.
        expect(read(pub(FILE[where]))).toContain('src="/push-client.js"');
    });

    it('every asset the worker caches exists, or its install fails', () => {
        const sw = read(pub('sw.js'));
        const list = sw.match(/SHELL_ASSETS = \[([\s\S]*?)\];/)[1].match(/'\/[^']+'/g).map((s) => s.slice(2, -1));
        for (const f of list) expect(fs.existsSync(pub(f))).toBe(true);
    });

    it('iPhone finds a home-screen icon on any page', () => {
        const png = fs.readFileSync(pub('apple-touch-icon.png'));
        expect(png.readUInt32BE(16)).toBe(180);
    });
});

describe('the home page offers to install it', () => {
    const home = read(pub('index.html'));

    it('has a hidden button that the install script reveals', () => {
        expect(home).toMatch(/<span id="installWrap" hidden>[^<]*<button type="button" id="installApp"/);
        expect(home).toContain('src="/install-app.js"');
        // A button of its own line once revealed, and never before: a plain
        // "#installWrap { display:block }" would beat the hidden attribute.
        expect(home).toContain('#installWrap:not([hidden]) { display:block;');
        expect(home).not.toMatch(/#installWrap\s*\{[^}]*display/);
    });

    it('opens the browser\'s own install dialog, and says how on an iPhone', () => {
        const js = read(pub('install-app.js'));
        expect(js).toContain('beforeinstallprompt');
        expect(js).toContain('.prompt()');
        expect(js).toContain('ADD TO HOME SCREEN');
        expect(js).toContain('(display-mode: standalone)');
    });
});
