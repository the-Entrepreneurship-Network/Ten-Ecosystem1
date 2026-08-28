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
