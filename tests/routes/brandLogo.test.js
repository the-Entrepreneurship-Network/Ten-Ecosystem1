'use strict';

/**
 * The company logo, on the page that is the front door.
 *
 * public/register.html drew its own mark in the markup: a circle and two
 * strokes roughly shaping a "T", as an inline SVG. That is not the TEN logo.
 * The company mark is two hands cupping an infinity symbol, and it had been in
 * the repo the whole time as ten-logo.png — nine other pages already used it.
 *
 * Every student, founder, mentor, investor and contractor who joins passes
 * through that page, so it was the worst place in the portal to show a
 * placeholder.
 *
 * These tests pin the fix, and — more importantly — pin the two logo VARIANTS
 * that must not be "tidied" into one. The certificates depend on having both.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
/** Assert against live markup, never a comment quoting the old markup. */
const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, '');

describe('the registration page shows the real logo', () => {
  const page = strip(read('public/register.html'));

  it('the hand-drawn stand-in is gone', () => {
    // The exact path data of the fake mark. If this ever comes back, it will
    // be because somebody pasted the old header in again.
    expect(page).not.toContain('M15 15 H25 V19 H15');
    expect(page).not.toContain('M20 19 V25');
  });

  it('and the real file is used instead', () => {
    expect(page).toContain('src="ten-logo.png"');
    expect(exists('public/ten-logo.png')).toBe(true);
  });

  it('it is described for a screen reader by the company name', () => {
    expect(page).toContain('alt="The Entrepreneurship Network"');
  });

  it('it is given explicit dimensions, so the header does not jump while it loads', () => {
    const at = page.indexOf('src="ten-logo.png"');
    const tag = page.slice(page.lastIndexOf('<img', at), page.indexOf('>', at));
    expect(tag).toContain('width="56"');
    expect(tag).toContain('height="56"');
    expect(tag).toContain('object-contain');
  });

  it('it sits on the same plate the other sign-in pages use', () => {
    /*
     * ten-logo.png has its own navy baked in rather than transparency, so on a
     * darker page it would read as a pasted rectangle. student-login.html
     * already solved this with .brand-logo-ring — a dark plate with a gold
     * edge and glow — and this matches it rather than inventing a second look.
     */
    expect(page).toContain('bg-[#121316]');
    expect(page).toContain('border-[#D4AF37]/45');
    expect(read('public/student-login.html')).toContain('.brand-logo-ring');
  });
});

describe('the logo files: one of each, and no copies', () => {
  it('the two unused ones are deleted', () => {
    /*
     * ten_premium_logo.jpg was byte-identical to ten-logo.png (and was a PNG
     * despite the extension); ten-3d-logo.jpg was a different image that no
     * page, stylesheet or script referenced. 816 KB between them.
     */
    expect(exists('public/ten_premium_logo.jpg')).toBe(false);
    expect(exists('public/ten-3d-logo.jpg')).toBe(false);
  });

  it('nothing still points at them', () => {
    const files = fs.readdirSync(path.join(root, 'public'))
      .filter((f) => /\.(html|css|js)$/i.test(f));
    files.forEach((f) => {
      const src = read('public/' + f);
      expect(src).not.toContain('ten_premium_logo');
      expect(src).not.toContain('ten-3d-logo');
    });
  });

  it('BOTH certificate variants survive — they are not duplicates to merge', () => {
    /*
     * This is the one that matters. hr-portal.html builds the printed
     * documents, and it picks a variant per background:
     *
     *   TEN_logo_dark_transparent.png   dark mark, for the white certificate
     *   TEN_logo_gold_for_navy_bg.png   gold mark, for the navy certificate
     *
     * The gold one happens to be byte-identical to ten-logo.png, which makes it
     * look like a duplicate worth deleting. It is not: the certificates
     * reference it by a name that says what it is for, and repointing or
     * removing it would take the logo off a printed document — the one artefact
     * a student shows an employer.
     */
    expect(exists('public/assets/TEN_logo_dark_transparent.png')).toBe(true);
    expect(exists('public/assets/TEN_logo_gold_for_navy_bg.png')).toBe(true);

    const hr = read('public/hr-portal.html');
    expect(hr).toContain('/assets/TEN_logo_dark_transparent.png');
    expect(hr).toContain('/assets/TEN_logo_gold_for_navy_bg.png');
  });

  it('the pages that already showed the logo still do', () => {
    // The fix must not have moved the file out from under them.
    ['student-login.html', 'student-dashboard.html', 'login.html',
      'hr-login.html', 'coordinator-login.html']
      .forEach((p) => expect(read('public/' + p)).toContain('ten-logo.png'));
  });
});
