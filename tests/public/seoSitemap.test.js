'use strict';

/**
 * @jest-environment node
 *
 * What a search engine is told about the site: robots.txt names the sitemap,
 * and every page the sitemap lists must be one Google can actually index —
 * not noindex, with a description, and with a canonical link that names the
 * same URL. A sitemap entry whose page says "my real address is elsewhere"
 * or "do not index me" is a contradiction Search Console reports as an error.
 *
 * The single-page portals are build output under public/<portal>/; their
 * head comes from <portal>-app/index.html, so the two must carry the same
 * canonical or the next vite build silently drops it.
 */

const fs = require('fs');
const path = require('path');

const pub = (f) => path.join(__dirname, '../../public', f);
const SITE = 'https://virtualinternships.entrepreneurshipnetwork.net';
const sitemap = fs.readFileSync(pub('sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/** The file express serves for a sitemap URL (see the page routes in server.js). */
function fileFor(url) {
    const p = url.slice(SITE.length);
    if (p === '/verify-document') return 'verify.html';
    if (p.endsWith('/')) return `${p.slice(1)}index.html`;
    return /\.html$/.test(p) ? p.slice(1) : `${p.slice(1)}.html`;
}

const head = (html) => html.slice(0, html.indexOf('</head>'));
const canonicalOf = (html) => (head(html).match(/<link rel="canonical" href="([^"]+)"/) || [])[1];

test('robots.txt points search engines at the sitemap', () => {
    expect(fs.readFileSync(pub('robots.txt'), 'utf8')).toContain(`Sitemap: ${SITE}/sitemap.xml`);
});

test('the sitemap lists the home page and only this site', () => {
    expect(urls).toContain(`${SITE}/`);
    for (const u of urls) expect(u.startsWith(SITE + '/')).toBe(true);
});

test.each(urls)('%s is indexable and names itself as canonical', (url) => {
    const html = fs.readFileSync(pub(fileFor(url)), 'utf8');
    expect(canonicalOf(html)).toBe(url);
    expect(head(html)).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    expect(head(html)).toMatch(/<meta name="description" content="[^"]{50,160}"/);
});

test.each(['student-portal', 'hackathon-portal'])('%s: source and build carry the same canonical', (portal) => {
    const src = fs.readFileSync(path.join(__dirname, `../../${portal}-app/index.html`), 'utf8');
    const built = fs.readFileSync(pub(`${portal}/index.html`), 'utf8');
    expect(canonicalOf(built)).toBe(`${SITE}/${portal}/`);
    expect(canonicalOf(src)).toBe(canonicalOf(built));
});

test('signed-in pages stay out of search results', () => {
    for (const f of ['student-dashboard.html', 'my-documents.html', 'my-certificates.html', 'messages.html', 'hr-portal.html']) {
        expect(head(fs.readFileSync(pub(f), 'utf8'))).toContain('<meta name="robots" content="noindex">');
    }
});
