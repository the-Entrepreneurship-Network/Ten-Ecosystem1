'use strict';

/**
 * @jest-environment node
 *
 * The landing page links out to the Business Playground in four places: the
 * header strip, the ecosystem card, and two footer links. The game runs on
 * Cloudflare Workers rather than on this server, so these are links out, and
 * the host in them is going to change exactly once — when the game moves from
 * ten-biz-game.tenetwork.workers.dev to a subdomain of the main site.
 *
 * That swap is the failure this file is here for. Four hard-coded hosts are
 * easy to change in three places and miss the fourth, and a missed one points
 * at a host that may have stopped answering. These tests do not care WHICH
 * host is used — only that every playground link agrees, and that the links
 * are still there at all.
 */

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
    path.join(__dirname, '../../public/index.html'), 'utf8');

/** Every href on the page that points at the playground, whatever its host. */
function playgroundHrefs() {
    const hrefs = [];
    const re = /href="([^"]+)"/g;
    let m;
    while ((m = re.exec(page)) !== null) {
        const href = m[1];
        if (/ten-biz-game|tenetwork\.workers\.dev|game\.entrepreneurshipnetwork\.net/i.test(href)) {
            hrefs.push(href);
        }
    }
    return hrefs;
}

function hostOf(href) {
    try { return new URL(href).host; } catch (_) { return null; }
}

describe('the playground is reachable from the landing page', () => {
    it('the header strip offers it', () => {
        const strip = page.slice(page.indexOf('class="hero-strip"'),
                                 page.indexOf('</header>'));
        expect(strip).toMatch(/PLAYGROUND<\/a>/);
    });

    it('the ecosystem band carries a card for it', () => {
        expect(page).toMatch(/class="eco-card eco-alt"/);
        expect(page).toMatch(/TEN Business Playground/);
        // Schools are the audience, and the card must say so — the rest of
        // this page speaks to interns and employers.
        expect(page).toMatch(/FOR SCHOOLS/);
    });

    it('the footer gives schools their own column', () => {
        const footer = page.slice(page.lastIndexOf('<!-- footer -->'));
        expect(footer).toMatch(/FOR SCHOOLS/);
        expect(footer).toMatch(/Teacher sign in/);
    });
});

describe('the links do not drift apart', () => {
    it('there are at least the four we placed', () => {
        expect(playgroundHrefs().length).toBeGreaterThanOrEqual(4);
    });

    it('every playground link uses the same host', () => {
        // The one that matters. When the subdomain lands, all of them move
        // together or none of them do.
        const hosts = new Set(playgroundHrefs().map(hostOf));
        expect(hosts.size).toBe(1);
        expect([...hosts][0]).toBeTruthy();
    });

    it('they are absolute https links that open safely', () => {
        // The game is a different origin, so these open in a new tab; without
        // rel=noopener the opened page gets a handle on this one.
        for (const href of playgroundHrefs()) {
            expect(href).toMatch(/^https:\/\//);
        }
        const anchors = page.match(/<a[^>]+href="[^"]*(?:ten-biz-game|game\.entrepreneurshipnetwork)[^"]*"[^>]*>/gi) || [];
        expect(anchors.length).toBeGreaterThanOrEqual(4);
        for (const a of anchors) {
            expect(a).toMatch(/target="_blank"/);
            expect(a).toMatch(/rel="noopener noreferrer"/);
        }
    });
});

describe('the new card does not disturb the existing one', () => {
    it('the main-site card is still there and still gold', () => {
        expect(page).toMatch(/THE MAIN WEBSITE/);
        expect(page).toMatch(/TEN is bigger than one internship/);
    });

    it('the band can hold both without one shoving the other sideways', () => {
        // Two cards in a flex row with no wrap would sit side by side and
        // squash; the card is a full-width panel, not a tile.
        const band = page.slice(page.indexOf('.eco-band {'),
                                page.indexOf('.eco-band {') + 220);
        expect(band).toMatch(/flex-wrap:\s*wrap/);
        expect(band).toMatch(/gap:/);
    });
});
