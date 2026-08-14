'use strict';

/**
 * The HR position chooser, and the level surviving the trip to the portal.
 *
 * The landing page used to link straight at hr-portal.html. That skipped the
 * step where an HR person says which of the eight positions they are signing
 * in as — and because the portal decides what a level can see from that
 * choice, skipping it dropped everyone onto Level 1 and made the page look
 * broken to anyone above it.
 *
 * The chain is three files long and every link has to hold:
 *
 *   index.html      chooser  →  /hr-login?level=N
 *   hr-login.html   sign in  →  /hr-portal?level=N
 *   hr-portal.html  reads ?level= and preselects the switcher
 *
 * hr-login.html was the link that broke it: it navigated to a bare
 * '/hr-portal' and threw the level away. These tests pin all three, because a
 * single well-meaning edit to any one of them silently restores the bug — the
 * page still works, it just lands on the wrong position, which is the sort of
 * thing nobody reports as a bug.
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../public', f), 'utf8');

const landing = read('index.html');
const login = read('hr-login.html');
const portal = read('hr-portal.html');

describe('the landing page asks which position, rather than linking straight in', () => {
  it('routes the HR button through the chooser, not at the portal', () => {
    expect(landing).toMatch(/openHrLevelChooser\(\)/);
    // A direct href to the portal is the regression: it skips the question.
    expect(landing).not.toMatch(/href="hr-portal\.html"/);
  });

  it('offers all eight positions', () => {
    const block = landing.slice(landing.indexOf('var HR_LEVELS'), landing.indexOf('var _hrChosenLevel'));
    for (let n = 1; n <= 8; n++) {
      expect(block).toMatch(new RegExp('\\[' + n + ','));
    }
  });

  it('sends the chosen level on to the login page', () => {
    expect(landing).toMatch(/'\/hr-login\?level=' \+ encodeURIComponent\(_hrChosenLevel/);
  });

  it('still offers the "no credentials" route to the WhatsApp group', () => {
    // Someone without credentials must not be dropped on a login form they
    // cannot get through.
    expect(landing).toMatch(/function hrCredNo\(\)/);
    expect(landing).toMatch(/chat\.whatsapp\.com/);
  });
});

describe('the login page carries the level through — this is what was broken', () => {
  it('reads the level from its own URL', () => {
    expect(login).toMatch(/function chosenHrLevel\(\)/);
    expect(login).toMatch(/URLSearchParams\(window\.location\.search\)\.get\('level'\)/);
  });

  it('accepts only the eight real positions', () => {
    expect(login).toMatch(/raw >= 1 && raw <= 8/);
  });

  it('forwards it to the portal on a successful sign-in', () => {
    expect(login).toMatch(/'\/hr-portal\?level=' \+ level/);
    // The bare redirect is the bug. It may only appear as the no-level
    // fallback, never on its own line.
    expect(login).not.toMatch(/window\.location\.href = '\/hr-portal';/);
  });

  it('names the position being signed into', () => {
    expect(login).toMatch(/HR_LEVEL_NAMES/);
    expect(login).toMatch(/Signing in as Level/);
  });
});

describe('the portal preselects the position it was sent', () => {
  it('reads ?level= on load', () => {
    const at = portal.indexOf('function initHRActiveLevel()');
    expect(at).toBeGreaterThan(-1);
    const body = portal.slice(at, at + 400);
    expect(body).toMatch(/urlParams\.get\('level'\)/);
    expect(body).toMatch(/savedLevel < 1 \|\| savedLevel > 8/);
  });

  it('keeps the level when a switch sends someone back to sign in again', () => {
    // Confirming a switch to Level 6 and being returned as Level 1 undoes the
    // very thing that was just confirmed.
    expect(portal).toMatch(/'\/hr-login\?level=' \+ encodeURIComponent\(targetLvl\)/);
  });
});

describe('the three files agree on what the eight positions are called', () => {
  const titles = {
    1: 'Jr HR Associate',
    2: 'Sr HR Associate',
    3: 'Jr HR Manager',
    4: 'Sr HR Manager',
    5: 'HR Associate Director',
    6: 'Jr HR Director',
    7: 'HR Director & HRBP',
    8: 'Vice President'
  };

  Object.entries(titles).forEach(([level, title]) => {
    it(`level ${level} is "${title}" everywhere`, () => {
      // A person picks a title on the landing page and must see the same
      // title on the login card and in the portal's switcher. Divergent
      // labels read as having landed in the wrong place.
      expect(landing).toContain(title);
      expect(login).toContain(title.replace('&', '&'));
      // The portal escapes the ampersand in its <option> markup.
      expect(portal).toContain(title.replace('&', '&amp;'));
    });
  });
});
