'use strict';

/**
 * The site on a phone.
 *
 * A sweep of every main page at 390px found one defect on nearly all of them:
 * the back links, the footer strip, the section links in the header and the
 * "Register here" under a login form measure 14–31px tall. They are hit with
 * the pad of a thumb — about 44px across — so every one of them is a miss
 * waiting to happen. The browser check that found it is the real test; this
 * one holds the fixes in place.
 */

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const MOBILE = read('public/css/mobile.css');
const MESSAGES = read('public/messages.html');
const WIDGET = read('public/chat-widget.js');

describe('touch targets', () => {
  it('every small control gets a real 44px, on coarse pointers only', () => {
    expect(MOBILE).toContain('@media (pointer: coarse)');
    const block = MOBILE.slice(MOBILE.lastIndexOf('@media (pointer: coarse)'));
    expect(block).toContain('min-height: 44px');
    // The patterns this codebase actually uses for its controls.
    ['.hero-strip a', '.nh-credits a', '.back', '.ghost', '.linky', 'footer a', 'nav a']
      .forEach((sel) => expect(block).toContain(sel));
  });

  /*
   * Height, not an invisible pseudo-element. The pseudo-element version was
   * silently covered by a later sibling on two of the five pages tested, and a
   * hit area you cannot see is a hit area you cannot tell is broken.
   */
  it('grows the control itself rather than a box nobody can see', () => {
    const block = MOBILE.slice(MOBILE.lastIndexOf('@media (pointer: coarse)'));
    expect(block).toContain('display: inline-flex');
    expect(block).not.toContain('::after');
  });

  it('leaves a mouse alone', () => {
    // Every touch rule is inside a coarse-pointer or narrow-width query.
    const stray = MOBILE.split(/@media[^{]+\{/).shift();
    expect(stray).not.toContain('min-height: 44px');
  });
});

describe('a conversation on a phone', () => {
  /*
   * Bubbles were pinned to the top, so a short conversation was three of them
   * under the header and a screen of nothing above the box you type in.
   */
  it('puts the messages against the composer, not under the header', () => {
    expect(MESSAGES).toContain(".msgs::before{content:'';margin-top:auto;}");
    expect(WIDGET).toContain(".tc-msgs::before{content:'';margin-top:auto;}");
  });

  /*
   * With the Android keyboard open `vh` still measures the whole screen, so
   * the box being typed into sat underneath the keyboard — on every portal
   * that carries the widget, which is all of them.
   */
  it('keeps the composer above the keyboard', () => {
    expect(MESSAGES).toContain('interactive-widget=resizes-content');
    expect(WIDGET).toContain('height:90dvh');
    expect(WIDGET).not.toContain('height:90vh');
    expect(MESSAGES).toContain('env(safe-area-inset-bottom)');
    expect(WIDGET).toContain('env(safe-area-inset-bottom)');
  });
});

describe('the hero image fits the screen it is on', () => {
  it('does not put a quarter of the picture off each side of a phone', () => {
    const app = read('hackathon-portal-app/src/App.tsx');
    expect(app).toContain('h-[46vh]');
    expect(app).toContain('sm:h-[78vh]');
    expect(app).not.toMatch(/className="h-\[78vh\] w-auto max-w-none/);
  });
});

/*
 * Three pages were wider than the phone they were on.
 *
 * mobile.css already sets `html, body { overflow-x: hidden }`, so none of them
 * scrolled sideways — the part that ran past the right edge was simply cut
 * off, with no way to reach it. That is the worse of the two failures and the
 * reason this went unnoticed: the page looks composed, it is just missing
 * whatever sat beyond 390px.
 *
 * Measured, not guessed: a headless run over every page in public/ at 390px,
 * collecting elements whose right edge cleared the viewport and whose
 * ancestors did not clip them. ten-network lost two of three feature cards,
 * edit.html lost the Update button, ten-admin lost the logout button and the
 * right half of every stat card. These assertions hold those three fixes.
 */
describe('nothing is cut off the right edge of a phone', () => {
  /** The body of a CSS rule, bounded by its own braces rather than a slice. */
  const ruleBody = (css, selector) => {
    const at = css.indexOf(selector + ' {') >= 0
      ? css.indexOf(selector + ' {')
      : css.indexOf(selector + '{');
    expect(at).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  it('ten-network sizes its card grid against the screen, not its content', () => {
    /*
     * body is `display:flex; flex-direction:column`, so with only a pixel cap
     * the grid sized itself from its own content and came out 936px wide —
     * three 280px tracks — on a 390px phone. The cap has to be bounded by the
     * container as well, or the grid never learns how narrow the screen is.
     */
    const grid = ruleBody(read('public/ten-network.html'), '.features-grid');
    expect(grid).toMatch(/max-width:\s*min\(1100px,\s*100%\)/);
    expect(grid).not.toMatch(/max-width:\s*1100px\s*;/);
  });

  it('edit.html lets its form card shrink, and keeps the inputs inside it', () => {
    const html = read('public/edit.html');
    const card = ruleBody(html, '.container');
    // 400px fixed plus 30px of body padding each side needs 460px.
    expect(card).toMatch(/max-width:\s*400px/);
    expect(card).not.toMatch(/(?<!-)width:\s*400px/);   // not `max-width`
    // The inputs are width:100% with 10px padding; content-box added 20px.
    expect(ruleBody(html, '*')).toMatch(/box-sizing:\s*border-box/);
  });

  it('ten-admin drops its fixed rail instead of sitting behind it', () => {
    /*
     * A 220px fixed sidebar with a matching margin-left left ~170px for the
     * console itself. Below 760px the rail becomes a scrolling strip of tabs
     * above the content, and the content reclaims the full width.
     */
    const html = read('public/ten-admin.html');
    const at = html.indexOf('@media (max-width:760px)');
    expect(at).toBeGreaterThan(-1);
    const block = html.slice(at, html.indexOf('/* SECTIONS */', at));
    expect(block).toMatch(/\.sidebar\{[^}]*position:static/);
    expect(block).toMatch(/\.content\{[^}]*margin-left:0/);
    /*
     * The row belongs on the <nav>, not on .sidebar: the sidebar's only flex
     * child is that wrapper, so turning the sidebar into a row laid the
     * wrapper sideways and left all seventeen items stacked inside it. That
     * version measured as fixed and looked wrong, which is why it is pinned.
     */
    expect(block).toMatch(/\.sidebar nav\{[^}]*display:flex/);
    expect(block).toMatch(/\.sidebar nav\{[^}]*overflow-x:auto/);
  });

  it('leaves every one of them alone on a desktop', () => {
    // Each fix is either inside a width query or bounded by min(), so a wide
    // screen keeps the 1100px grid, the 400px card and the 220px rail.
    const admin = read('public/ten-admin.html');
    expect(ruleBody(admin, '.sidebar')).toMatch(/position:fixed/);
    expect(ruleBody(admin, '.content')).toMatch(/margin-left:220px/);
    expect(ruleBody(read('public/edit.html'), '.container')).toMatch(/max-width:\s*400px/);
  });
});
