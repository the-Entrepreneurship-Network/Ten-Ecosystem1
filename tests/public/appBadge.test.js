'use strict';

/**
 * @jest-environment node
 *
 * The installed app shows a count on its icon, like any app: the same unread
 * number as the notification orb. And it offers notifications once, from a
 * button, only inside the installed app.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../public', f), 'utf8');

/** Run the service worker's push handler against stand-ins for the browser. */
async function pushWith({ unread, fetchFails = false, status = 200 }) {
    const listeners = {};
    const badge = [];
    const shown = [];
    const self = {
        addEventListener: (type, fn) => { listeners[type] = fn; },
        location: { origin: 'https://portal.example' },
        registration: { showNotification: async (t, o) => { shown.push({ t, o }); } },
        navigator: {
            setAppBadge: async (n) => { badge.push(n === undefined ? 'dot' : n); },
            clearAppBadge: async () => { badge.push('clear'); },
        },
        clients: {},
    };
    const fetch = async (url, opts) => {
        if (fetchFails) throw new Error('offline');
        expect(url).toBe('/api/notifications/unread-count');
        expect(opts.credentials).toBe('include');
        return { ok: status === 200, json: async () => ({ success: true, unread }) };
    };
    vm.runInNewContext(read('sw.js'), { self, fetch, caches: {}, URL, Promise, console });
    let done;
    listeners.push({ data: { json: () => ({ title: 'Task approved', body: 'Well done' }) }, waitUntil: (p) => { done = p; } });
    await done;
    return { badge, shown };
}

describe('when a notification arrives with the app closed', () => {
    it('shows it and puts the unread count on the icon', async () => {
        const { badge, shown } = await pushWith({ unread: 3 });
        expect(shown[0].t).toBe('Task approved');
        expect(badge).toEqual([3]);
    });

    it('clears the icon when nothing is unread any more', async () => {
        expect((await pushWith({ unread: 0 })).badge).toEqual(['clear']);
    });

    it('offline or signed out, still marks the icon with a dot', async () => {
        expect((await pushWith({ fetchFails: true })).badge).toEqual(['dot']);
        expect((await pushWith({ status: 401 })).badge).toEqual(['dot']);
    });
});

describe('while the app is open', () => {
    const orb = read('notify-orb.js');

    it('the icon follows the orb\'s own count, cleared at zero', () => {
        expect(orb).toContain('(total ? navigator.setAppBadge(total) : navigator.clearAppBadge())');
    });

    it('offers notifications only in the installed app, once per device, while the browser has not been asked', () => {
        const offer = orb.slice(orb.indexOf('function offerPush'), orb.indexOf('function onOwnPage'));
        expect(offer).toContain("matchMedia('(display-mode: standalone)')");
        expect(offer).toContain("Notification.permission !== 'default'");
        expect(offer).toContain('localStorage.getItem(OFFER_KEY)');
        expect(offer).toContain('s.serverEnabled');
    });

    it('never sits over the outage warning bar', () => {
        expect(orb).toContain("getElementById('ten-db-banner')");
    });

    it('asks the browser only from the reader\'s click, never on load', () => {
        const offer = orb.slice(orb.indexOf('function offerPush'), orb.indexOf('function onOwnPage'));
        const click = offer.indexOf("addEventListener('click'");
        expect(click).toBeGreaterThan(-1);
        expect(offer.indexOf('TenPush.enable()')).toBeGreaterThan(click);
    });
});
