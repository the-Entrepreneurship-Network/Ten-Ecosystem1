'use strict';

/**
 * @jest-environment node
 *
 * css/mobile.css sets EVERY h1 to 21px (19px under 400px) with !important on
 * phones. Four headings became h1 for search engines (#348) while keeping
 * their old look; without their own !important they grew to 19-21px on every
 * phone (the home page's 12px strip line, coordinator sign-up's 11px line) or
 * shrank (the 26px Sign In title), and only a desktop-width check had been run.
 * The !important below is what holds their size; it is not decoration.
 */

const fs = require('fs');
const path = require('path');

const page = (f) => fs.readFileSync(path.join(__dirname, '../../public', f), 'utf8');

test('css/mobile.css still forces h1 sizes on phones (the reason for the rules below)', () => {
    expect(page('css/mobile.css')).toMatch(/h1 \{ font-size: \d+px !important; \}/);
});

test('the home page strip heading keeps the strip size', () => {
    expect(page('index.html')).toContain('.hero-strip h1 { font:inherit !important; margin:0; }');
});

test.each([['login.html', '26px'], ['coordinator-login.html', '24px']])('%s keeps its title size', (f, size) => {
    expect(page(f)).toContain(`font-size: ${size} !important;`);
    expect(page(f)).toContain('<h1 class="card-title');
});

test('the coordinator login keeps its smaller phone size too', () => {
    expect(page('coordinator-login.html')).toContain('.card-title { font-size: 20px !important; }');
});

test('coordinator sign-up keeps its 11px line', () => {
    expect(page('coordinator-register.html')).toContain('<h1 class="brand-sub" style="font-size: 11px !important;');
});
