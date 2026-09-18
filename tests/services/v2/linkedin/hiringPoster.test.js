'use strict';

/*
 * The hiring poster has one property that matters more than everything else
 * put together: a card is drawn only when its fact has a value. A poster with
 * three facts must look like a poster made for three facts, not like a poster
 * made for nine with six holes punched in it. Most of the file below is that
 * claim, tested from several directions at once — the count of cards, their
 * geometry, and the absence of both empty labels and the string "undefined".
 *
 * The rest is the two ways a generated poster gets published broken:
 *
 *   - A logo that is not a logo. It comes from a browser file picker, which
 *     means it eventually comes from whatever somebody had in their clipboard.
 *     A `javascript:` string, an `http://` link, a PDF and a five-megabyte
 *     blob all have to become "no logo, print the name" rather than a broken
 *     image or an external reference — an SVG that reaches outside itself
 *     taints the canvas it is rasterised on and the post goes out with no
 *     picture at all.
 *   - An id collision. Six posters are previewed on one page, so two renders
 *     with different uids may never share an id; if they do, the second
 *     poster is clipped by the first one's clipPath and only the gallery
 *     shows it.
 *
 * There is no XML parser in this project's dependencies, so wellFormed below
 * is a small scanner: every '<' must open a tag that closes, every tag must
 * balance, and no raw ampersand may survive. That is enough to catch the real
 * failure, which is a company called "O'Brien & Sons" taking the whole
 * document down.
 */

const poster = require('../../../../services/v2/linkedin/hiringPoster');

/* A genuine 1x1 PNG. Small enough to paste, real enough that nothing in the
   accept path has to be relaxed for it. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ALL_FACTS = {
  org: 'Acme Labs',
  role: 'Python Development Intern',
  domain: 'Python Development',
  batch: '2026 and 2027',
  openings: '12',
  mode: 'Online',
  location: 'Bengaluru',
  duration: '3 months',
  stipend: 'Rs 8,000 per month',
  skills: 'Python, Django, SQL',
  eligibility: 'Any UG or PG student',
  applyBy: '30 September 2026',
  afterLpa: 'Alumni at 6-12 LPA',
};

/* ── a small well-formedness scanner ─────────────────────────────────────── */

const TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
const VOID_TAGS = ['rect', 'circle', 'ellipse', 'image', 'path', 'stop', 'line', 'use'];

function wellFormed(svg) {
  expect(typeof svg).toBe('string');
  expect(svg.startsWith('<svg ')).toBe(true);
  expect(svg.trim().endsWith('</svg>')).toBe(true);

  /* Every '<' in the document must be the start of a tag we can parse. A stray
     one means a piece of user text reached the document unescaped. */
  const opens = (svg.match(/</g) || []).length;
  const parsed = svg.match(TAG) || [];
  expect(parsed.length).toBe(opens);

  const stack = [];
  TAG.lastIndex = 0;
  let m = TAG.exec(svg);
  while (m) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosed = /\/>$/.test(m[0]) || VOID_TAGS.indexOf(name) !== -1;
    if (closing) {
      expect(stack.pop()).toBe(name);
    } else if (!selfClosed) {
      stack.push(name);
    }
    /* Attributes must be quoted pairs and nothing else. */
    const attrs = m[3].replace(/\/$/, '').trim();
    if (attrs) {
      expect(attrs.replace(/[\w:.-]+="[^"]*"/g, '').trim()).toBe('');
    }
    m = TAG.exec(svg);
  }
  expect(stack).toEqual([]);

  /* Raw ampersands are the whole reason escapeXml exists. */
  expect(svg.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, '')).not.toContain('&');
  return svg;
}

/**
 * Nothing in the document may reach outside it. This is the assertion that
 * stands between us and a canvas that throws SecurityError on toDataURL.
 */
function selfContained(svg) {
  attrValues(svg, 'href').forEach((v) => expect(v.slice(0, 5)).toBe('data:'));
  expect(svg).not.toMatch(/xlink:href/);
  expect(svg).not.toMatch(/@import|<style|<script|<foreignObject/i);
  /* The one URL-shaped attribute that is allowed is the SVG namespace. */
  expect(svg.match(/https?:\/\//g) || []).toEqual(['http://']);
  return svg;
}

function attrValues(svg, attr) {
  const re = new RegExp(`${attr}="([^"]*)"`, 'g');
  const out = [];
  let m = re.exec(svg);
  while (m) { out.push(m[1]); m = re.exec(svg); }
  return out;
}

/* Everything the poster actually says, with the wrapping taken back out, so a
   value that happens to break across two lines can still be asserted on. */
function words(svg) {
  return (svg.match(/>([^<]*)</g) || [])
    .map((s) => s.slice(1, -1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* The card panels, which are the only rects drawn in the card fill. */
const CARD_RE = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" rx="18" fill="#161d33"\/>/g;

function cardRects(svg) {
  const out = [];
  CARD_RE.lastIndex = 0;
  let m = CARD_RE.exec(svg);
  while (m) {
    out.push({
      x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]),
    });
    m = CARD_RE.exec(svg);
  }
  return out;
}

function ids(svg) {
  return attrValues(svg, 'id');
}

const TEXT_RE = /<text ([^>]*)>([^<]*)</g;
const ICON_RE = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)" fill="#f5c542" fill-opacity="0\.14"\/>/g;

function matchAll(svg, re) {
  const out = [];
  re.lastIndex = 0;
  let m = re.exec(svg);
  while (m) { out.push(m); m = re.exec(svg); }
  return out;
}

function attrOf(blob, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(blob);
  return m ? m[1] : '';
}

/**
 * Every <text> in the document, with its attributes read by name.
 *
 * They used to be matched positionally, with letter-spacing as an optional
 * group sitting after a lazy `[^>]*?` — which the engine is free to satisfy by
 * matching nothing and letting the trailing `[^>]*` swallow the attribute. It
 * did, for every text of every render, so the spacing always came back
 * undefined and everythingInsideItsCard measured labels at 0.56em: the exact
 * budget the module sizes them against, which makes the assertion arithmetic
 * that cannot fail. Recompiling the module with LABEL_EM back at EM_BOLD — the
 * regression the module's own comment exists to prevent — overflowed labels out
 * of their cards in their thousands while this file stayed green. Reading the
 * attributes by name is what turns the guard back into a guard.
 */
function texts(svg) {
  return matchAll(svg, TEXT_RE).map((m) => ({
    x: Number(attrOf(m[1], 'x')),
    y: Number(attrOf(m[1], 'y')),
    size: Number(attrOf(m[1], 'font-size')),
    spacing: Number(attrOf(m[1], 'letter-spacing').replace('em', '')) || 0,
    anchor: attrOf(m[1], 'text-anchor'),
    value: m[2],
  }));
}

/**
 * Where a line of text starts and ends, estimated with the same em constants
 * the module fits with. An entity is six characters in the document and one
 * character on the poster, so it is folded back before counting — otherwise
 * the call to action, which carries two quotation marks, measures a third
 * wider than it is drawn.
 */
function span(t) {
  const chars = t.value.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, 'x').length;
  const width = chars * t.size * (0.56 + t.spacing);
  return t.anchor === 'middle'
    ? { left: t.x - width / 2, right: t.x + width / 2 }
    : { left: t.x, right: t.x + width };
}

/**
 * The assertion the card layout exists to satisfy.
 *
 * Nothing drawn inside a card may leave it, and nothing may be drawn on top of
 * the icon. Both were real: at three rows the icon's circle was large enough
 * to sit straight through the label beside it, and a value set at the size a
 * one-row card wanted hung out of the bottom of a three-row one and over the
 * card below. Widths are estimated with the same em constants the module fits
 * with — including the label's letter-spacing, which on a fifteen-character
 * label is two whole characters of width.
 */
function everythingInsideItsCard(svg) {
  const cards = cardRects(svg);
  const drawn = texts(svg);
  const icons = matchAll(svg, ICON_RE).map((m) => ({
    cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]),
  }));

  expect(icons).toHaveLength(cards.length);

  cards.forEach((c) => {
    const icon = icons.filter((i) => i.cx > c.x && i.cx < c.x + c.width
      && i.cy > c.y && i.cy < c.y + c.height)[0];
    expect(icon).toBeDefined();
    expect(icon.cy - icon.r).toBeGreaterThan(c.y);
    expect(icon.cy + icon.r).toBeLessThan(c.y + c.height);

    const inside = drawn.filter((t) => t.x >= c.x && t.x < c.x + c.width
      && t.y > c.y && t.y <= c.y + c.height + 8);
    /* A label and at least one line of value. */
    expect(inside.length).toBeGreaterThanOrEqual(2);

    inside.forEach((t) => {
      const top = t.y - t.size * 0.75;
      const bottom = t.y + t.size * 0.24;
      expect(top).toBeGreaterThan(c.y);
      expect(bottom).toBeLessThanOrEqual(c.y + c.height);

      expect(span(t).right).toBeLessThan(c.x + c.width);

      /* Text that shares the icon's band must start to the right of it. */
      const sharesTheIconsLine = bottom > icon.cy - icon.r && top < icon.cy + icon.r;
      if (sharesTheIconsLine) expect(t.x).toBeGreaterThanOrEqual(icon.cx + icon.r);
    });

    /* Consecutive baselines in a card never sit on top of one another. */
    for (let i = 1; i < inside.length; i += 1) {
      expect(inside[i].y - inside[i - 1].y).toBeGreaterThanOrEqual(inside[i].size * 0.9);
    }
  });
  return svg;
}

/* ── a card only exists when its fact does ───────────────────────────────── */

describe('drawing only the facts that are there', () => {
  it('draws every fact when every fact is supplied', () => {
    const out = poster.build({ facts: ALL_FACTS, uid: 'all' });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.width).toBe(1200);
    expect(out.height).toBe(1200);
    /* Every key in FACT_ORDER carries a value here, and a role was supplied,
       so the domain card is not suppressed. */
    expect(out.cards).toEqual(poster.FACT_ORDER);
    expect(cardRects(out.svg)).toHaveLength(poster.FACT_ORDER.length);
    const said = words(out.svg);
    poster.FACT_ORDER.forEach((key) => {
      expect(said).toContain(poster.FACT_LABELS[key].toUpperCase());
      expect(said).toContain(ALL_FACTS[key]);
    });
  });

  it('draws two cards for two facts and no empty ones', () => {
    const out = poster.build({ facts: { mode: 'Hybrid', stipend: 'Unpaid' }, uid: 'two' });
    wellFormed(out.svg);
    expect(out.cards).toEqual(['mode', 'stipend']);
    expect(cardRects(out.svg)).toHaveLength(2);

    /* No label belonging to an absent fact may appear. This is the assertion
       that fails if somebody ever reintroduces a fixed nine-slot grid. */
    const said = words(out.svg);
    ['Duration', 'Eligibility', 'Required skills', 'Apply by', 'Openings', 'Batch', 'Location']
      .forEach((label) => expect(said).not.toContain(label.toUpperCase()));
  });

  /* Asserted on the text content rather than the document: the embedded mark
     is 140 KB of base64, and three characters of that alphabet in a row spell
     "NaN" often enough that scanning the whole string is a coin toss. */
  it('never prints the word undefined, whatever is missing', () => {
    [{}, { role: 'Intern' }, { facts: undefined }, ALL_FACTS].forEach((facts) => {
      const said = words(poster.build({ facts, uid: 'u' }).svg);
      expect(said).not.toContain('undefined');
      expect(said).not.toContain('null');
      expect(said).not.toContain('NaN');
    });
  });

  it('renders a poster with no facts at all', () => {
    const out = poster.build({});
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.cards).toEqual([]);
    expect(cardRects(out.svg)).toHaveLength(0);
    /* It still says who is hiring and what to do about it. */
    const said = words(out.svg);
    expect(said).toContain('IS HIRING');
    expect(said).toContain('The Entrepreneurship Network');
    expect(said).toContain('COMMENT');
  });

  it('gives three cards the full width rather than three slivers', () => {
    const three = cardRects(poster.build({
      facts: { mode: 'Online', duration: '6 months', stipend: 'Rs 10,000' }, uid: 'a',
    }).svg);
    const five = cardRects(poster.build({
      facts: {
        mode: 'Online', duration: '6 months', stipend: 'Rs 10,000', batch: '2026', openings: '4',
      },
      uid: 'b',
    }).svg);

    expect(three).toHaveLength(3);
    expect(five).toHaveLength(5);

    /* Each row fills the content width, whatever it holds. */
    [three, five].forEach((row) => {
      expect(row[0].x).toBe(96);
      const last = row[row.length - 1];
      expect(last.x + last.width).toBeGreaterThanOrEqual(1100);
      expect(last.x + last.width).toBeLessThanOrEqual(1104);
      /* One row: every card shares a top edge. */
      row.forEach((c) => expect(c.y).toBe(row[0].y));
    });

    /* And three of them are wider than five of them, which is the whole
       point — a fixed column width is what made three facts look like three
       slivers pinned to the left margin. */
    expect(three[0].width).toBeGreaterThan(five[0].width * 1.5);
  });

  it('flows eleven facts over three rows and keeps them clear of the gold bar', () => {
    const out = poster.build({ facts: ALL_FACTS, uid: 'rows' });
    const rects = cardRects(out.svg);
    const tops = rects.map((r) => r.y).filter((y, i, all) => all.indexOf(y) === i);
    expect(tops).toHaveLength(3);
    /* Nothing may reach the call-to-action bar at y=1020. */
    rects.forEach((r) => expect(r.y + r.height).toBeLessThan(1020));
    /* Rows do not overlap each other either. */
    for (let i = 1; i < tops.length; i += 1) {
      const above = rects.filter((r) => r.y === tops[i - 1])[0];
      expect(tops[i]).toBeGreaterThanOrEqual(above.y + above.height);
    }
  });

  /*
   * Every card count, on both grounds. Eleven facts is the busiest the poster
   * can be and one fact is the emptiest, and the arrangement changes shape
   * three times in between; each of those is a chance for the icon, the label
   * and the value to end up on top of one another.
   */
  it('keeps every label, value and icon inside its own card at every count', () => {
    const ground = ['square', 'portrait'];
    for (let n = 1; n <= poster.FACT_ORDER.length; n += 1) {
      /* Taken from both ends of FACT_ORDER, because the labels at the end are
         the long ones and the cards at the start are the narrow ones. */
      [poster.FACT_ORDER.slice(0, n), poster.FACT_ORDER.slice(-n)].forEach((keys) => {
        ground.forEach((size) => {
          const facts = { role: 'Intern' };
          keys.forEach((k) => { facts[k] = ALL_FACTS[k] || 'Yes'; });
          const out = poster.build({ facts, size, uid: `g${n}${size}` });
          wellFormed(out.svg);
          expect(cardRects(out.svg)).toHaveLength(n);
          everythingInsideItsCard(out.svg);
        });
      });
    }
  });

  it('sets every label in the grid at one size', () => {
    const out = poster.build({ facts: ALL_FACTS, uid: 'labels' });
    const sizes = texts(out.svg)
      .filter((t) => /^[A-Z ]+$/.test(t.value) && poster.FACT_ORDER
        .some((k) => poster.FACT_LABELS[k].toUpperCase() === t.value))
      .map((t) => t.size);
    expect(sizes).toHaveLength(poster.FACT_ORDER.length);
    expect(new Set(sizes).size).toBe(1);
  });

  /*
   * The card panels are opaque and are painted after the gold role strips, so
   * a first row that starts even slightly too high does not crowd the role —
   * it slices the lozenge off through the middle of its second line. It used
   * to: a long org wraps the headline to two lines, a long role wraps the
   * strip to two, and the grid's start had a ceiling but no floor, so eleven
   * cards began 26 pixels above the bottom of the strip they then covered.
   */
  it('starts the grid below the role strip when both headline and role wrap', () => {
    const out = poster.build({
      facts: Object.assign({}, ALL_FACTS, {
        org: 'TEN Foundation for Student Entrepreneurship',
        role: 'Machine Learning and Data Science Research Intern',
      }),
      uid: 'wrapped',
    });
    wellFormed(out.svg);

    /* The role strips are the gold lozenges on the left margin. */
    const strips = matchAll(out.svg, /<rect x="96" y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)" rx="[-\d.]+" fill="#f5c542"\/>/g)
      .map((m) => Number(m[1]) + Number(m[2]));
    expect(strips.length).toBe(2);

    const rects = cardRects(out.svg);
    expect(rects).toHaveLength(poster.FACT_ORDER.length);
    const top = Math.min.apply(null, rects.map((r) => r.y));
    expect(top).toBeGreaterThanOrEqual(Math.max.apply(null, strips));
    /* And the other end still holds: nothing reaches the gold bar. */
    rects.forEach((r) => expect(r.y + r.height).toBeLessThan(1020));
    everythingInsideItsCard(out.svg);
  });

  /*
   * The facts arrive as one bag from a form and an LLM's extraction, so a
   * boolean from a checkbox, a NaN from a failed parse, a zero from an
   * untouched number input and a half-built object are all things that turn
   * up. Each of them used to be stringified onto the poster — "[object
   * Object]" as the role, "NaN" under DURATION — and, worse, counted as
   * collected, so `missing` told the agent not to ask for them.
   */
  it('treats a value that is not text as absent, whatever its type', () => {
    const out = poster.build({
      facts: {
        role: {}, stipend: 0, openings: 0, duration: NaN, mode: false, applyBy: Infinity,
        batch: [], location: () => 'x',
      },
      uid: 'types',
    });
    wellFormed(out.svg);
    expect(out.cards).toEqual([]);
    expect(cardRects(out.svg)).toHaveLength(0);
    expect(out.missing).toEqual(poster.REQUIRED_FACTS);

    const said = words(out.svg);
    ['NaN', 'Infinity', 'object Object', 'false', 'undefined'].forEach((junk) => {
      expect(said).not.toContain(junk);
    });
    expect(out.alt).toBe('The Entrepreneurship Network is hiring.');

    /* A real number is still a fact, and so is a zero somebody typed. */
    const typed = poster.build({ facts: { openings: 12, batch: '0' }, uid: 'num' });
    expect(typed.cards).toEqual(['batch', 'openings']);
    expect(words(typed.svg)).toContain('12');
  });

  it('does not print the domain twice when it stood in for the role', () => {
    const withRole = poster.build({ facts: { role: 'Data Intern', domain: 'Data Science' }, uid: 'r' });
    expect(withRole.cards).toContain('domain');

    const withoutRole = poster.build({ facts: { domain: 'Data Science' }, uid: 'n' });
    expect(withoutRole.cards).not.toContain('domain');
    /* It is on the poster once, as the line under the headline. */
    const said = words(withoutRole.svg);
    expect(said).toContain('DATA SCIENCE');
    expect(said.match(/DATA SCIENCE/g)).toHaveLength(1);
  });
});

/* ── what the agent still has to ask for ─────────────────────────────────── */

describe('missing', () => {
  it('lists exactly the required facts that had no value', () => {
    expect(poster.build({}).missing).toEqual(poster.REQUIRED_FACTS);
    expect(poster.build({ facts: ALL_FACTS }).missing).toEqual([]);

    const some = poster.build({
      facts: { role: 'UI Intern', domain: 'UI/UX', mode: 'Online' },
    });
    expect(some.missing).toEqual(['duration', 'stipend', 'applyBy']);
  });

  it('treats blank and whitespace-only values as absent', () => {
    const out = poster.build({
      facts: {
        role: '   ', domain: '', mode: '\n\t', duration: 'x', stipend: 'y', applyBy: 'z',
      },
    });
    expect(out.missing).toEqual(['role', 'domain', 'mode']);
    expect(out.cards).toEqual(['duration', 'stipend', 'applyBy']);
  });

  it('keeps every required fact inside the vocabulary it draws', () => {
    poster.REQUIRED_FACTS.forEach((key) => {
      expect(key === 'role' || poster.FACT_ORDER.indexOf(key) !== -1).toBe(true);
    });
    poster.FACT_ORDER.forEach((key) => {
      expect(typeof poster.FACT_LABELS[key]).toBe('string');
      expect(poster.FACT_LABELS[key].length).toBeGreaterThan(0);
    });
  });
});

/* ── type that has to survive real input ─────────────────────────────────── */

describe('awkward text', () => {
  it('sets a sixty-character role without breaking the layout', () => {
    const role = 'Senior Full Stack Web Development and Cloud Deployment Intern';
    expect(role.length).toBeGreaterThanOrEqual(60);
    const out = poster.build({ facts: Object.assign({}, ALL_FACTS, { role }), uid: 'long' });
    wellFormed(out.svg);
    selfContained(out.svg);
    /* The strips carrying the role never run past the right margin. */
    attrValues(out.svg, 'width')
      .map(Number)
      .filter((w) => Number.isFinite(w))
      .forEach((w) => expect(w).toBeLessThanOrEqual(1200));
    cardRects(out.svg).forEach((r) => expect(r.y + r.height).toBeLessThan(1020));
  });

  it('escapes an organisation called O\'Brien & Sons', () => {
    const out = poster.build({
      facts: Object.assign({}, ALL_FACTS, { org: "O'Brien & Sons" }),
      companyName: "O'Brien & Sons <Recruiting>",
      uid: 'esc',
    });
    wellFormed(out.svg);
    expect(out.svg).toContain('O&apos;Brien &amp; Sons');
    expect(out.svg).toContain('&lt;RECRUITING&gt;');
    expect(out.alt).toContain("O'Brien & Sons");
  });

  it('renders the portrait ground when asked and the square otherwise', () => {
    const portrait = poster.build({ facts: ALL_FACTS, size: 'portrait', uid: 'p' });
    wellFormed(portrait.svg);
    expect(portrait.ground).toBe('portrait');
    expect(portrait.width).toBe(1080);
    expect(portrait.height).toBe(1350);

    /* 'billboard' is the ordinary typo. The three after it are the ones that
       cost us the poster: a plain `GROUNDS[size]` reaches Object.prototype, so
       a size naming a member of it resolved to a truthy non-ground, the
       fallback never fired, and the document went out as width="undefined"
       with NaN for every coordinate — a picture the browser renders as
       nothing, published with no error anywhere. */
    ['billboard', 'toString', 'constructor', '__proto__', 'hasOwnProperty', '']
      .forEach((size) => {
        const odd = poster.build({ facts: ALL_FACTS, size, uid: `o${size}` });
        wellFormed(odd.svg);
        expect(odd.ground).toBe('square');
        expect(odd.width).toBe(1200);
        expect(odd.height).toBe(1200);
        /* Asserted on the text content, not the document: the embedded mark is
           140 KB of base64 and spells "NaN" by chance often enough that
           scanning the whole string is a coin toss. */
        expect(words(odd.svg)).not.toContain('undefined');
        expect(odd.svg).not.toMatch(/(?:x|y|cx|cy|r|width|height)="(?:NaN|undefined)"/);
        expect(cardRects(odd.svg)).toHaveLength(poster.FACT_ORDER.length);
      });
  });

  /*
   * The two organisation names were the only strings on the poster not put
   * through a fitter, and both are set with heavy tracking — 0.22em on the
   * employer, which is a quarter of the line the estimate never counted. A
   * fifty-character name therefore ran past the right margin, and a
   * seventy-character one ran off the canvas with `usedCompanyLogo: false`
   * as the agent's only hint that anything was wrong.
   */
  it('keeps a long organisation name inside the margins', () => {
    const out = poster.build({
      facts: ALL_FACTS,
      orgName: 'The National Institute of Entrepreneurship and Small Business Development',
      companyName: 'National Institute of Technology Karnataka Surathkal Recruitment Cell',
      uid: 'names-long',
    });
    wellFormed(out.svg);

    texts(out.svg).forEach((t) => {
      const line = span(t);
      expect(line.left).toBeGreaterThanOrEqual(96);
      expect(line.right).toBeLessThanOrEqual(1104);
    });
  });

  /* The default call to action is 46 characters and was fitted at the plain
     bold em while being drawn at 0.06em of tracking, so it overran both
     margins by about 38 pixels. It sits on a full-bleed bar, so nothing was
     cropped — it just broke the margin every other line on the poster keeps. */
  it('keeps the call to action inside the margins on both grounds', () => {
    ['square', 'portrait'].forEach((size) => {
      const out = poster.build({ facts: ALL_FACTS, size, uid: `cta${size}` });
      const bar = texts(out.svg).filter((t) => t.anchor === 'middle')[0];
      expect(bar).toBeDefined();
      const margin = size === 'portrait' ? 88 : 96;
      expect(span(bar).left).toBeGreaterThanOrEqual(margin);
      expect(span(bar).right).toBeLessThanOrEqual(out.width - margin);
    });
  });
});

/* ── logos: the format is fixed, the identity is swappable ───────────────── */

describe('logos', () => {
  it('embeds a valid company logo and reports that it used it', () => {
    const out = poster.build({
      facts: ALL_FACTS, companyLogoDataUri: PNG, companyName: 'Acme Labs', uid: 'logo',
    });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.usedCompanyLogo).toBe(true);
    expect(out.svg).toContain(PNG);
  });

  it('refuses a hostile logo and prints the name instead', () => {
    const hostile = [
      'javascript:alert(1)',
      'http://example.com/logo.png',
      'https://example.com/logo.png',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:application/pdf;base64,JVBERi0=',
      'data:image/png;base64,',
      'data:image/png;base64,not base64 at all!',
      `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}`,
      PNG.replace('base64', 'utf8'),
      {},
      null,
    ];
    hostile.forEach((value) => {
      const out = poster.build({
        facts: ALL_FACTS,
        companyLogoDataUri: value,
        orgLogoDataUri: value,
        companyName: 'Acme Labs',
        uid: 'hostile',
      });
      wellFormed(out.svg);
      selfContained(out.svg);
      expect(out.usedCompanyLogo).toBe(false);
      expect(out.usedOrgLogo).toBe(false);
      /* The name is what the poster needed to say in the first place. */
      expect(words(out.svg)).toContain('ACME LABS');
      expect(out.svg).not.toContain('javascript:');
      expect(out.svg).not.toContain('example.com');
    });
  });

  /*
   * A PNG is opaque bytes; an SVG is a document, and a document can reach out
   * of the poster from inside the base64 where the MIME check cannot see it.
   * An uploaded mark carrying an @import and an <image href="http://…"> passed
   * every check this module had and shipped verbatim — the self-containment
   * invariant the whole file is built around, enforced only at the top level,
   * on the one path that carries untrusted content into the document.
   */
  it('refuses an svg logo that reaches outside the document', () => {
    const asUri = (markup) => `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;
    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.example/p.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="//evil.example/p.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("http://evil.example/x.css");</style></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("http://evil.example")</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body/></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(http://evil.example/p.svg#g)"/></svg>',
    ];
    hostile.forEach((markup) => {
      const out = poster.build({
        facts: ALL_FACTS, companyLogoDataUri: asUri(markup), companyName: 'Acme Labs', uid: 'svg',
      });
      wellFormed(out.svg);
      selfContained(out.svg);
      expect(out.usedCompanyLogo).toBe(false);
      expect(out.svg).not.toContain('evil.example');
      /* The fallback was already the right one: print the name. */
      expect(words(out.svg)).toContain('ACME LABS');
    });
  });

  it('still embeds an svg logo that only references itself', () => {
    const inert = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>';
    const uri = `data:image/svg+xml;base64,${Buffer.from(inert).toString('base64')}`;
    const out = poster.build({ facts: ALL_FACTS, companyLogoDataUri: uri, uid: 'inert' });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.usedCompanyLogo).toBe(true);
    expect(out.svg).toContain(uri);
  });

  it('names both organisations when no logo was supplied at all', () => {
    const out = poster.build({
      facts: Object.assign({}, ALL_FACTS, { org: 'Acme Labs' }),
      orgName: 'The Entrepreneurship Network',
      companyName: 'Northwind Systems',
      uid: 'names',
    });
    wellFormed(out.svg);
    expect(out.usedOrgLogo).toBe(false);
    expect(out.usedCompanyLogo).toBe(false);
    const said = words(out.svg);
    expect(said).toContain('Acme Labs');
    expect(said).toContain('The Entrepreneurship Network');
    expect(said).toContain('NORTHWIND SYSTEMS');
  });

  it('does not print the publisher name twice when it is already the headline', () => {
    const out = poster.build({ facts: { org: 'Acme Labs' }, orgName: 'Acme Labs', uid: 'dup' });
    const said = words(out.svg);
    expect(said.match(/Acme Labs/g)).toHaveLength(1);
  });

  it('accepts logos passed inside facts as well as at the top level', () => {
    const out = poster.build({ facts: Object.assign({}, ALL_FACTS, { companyLogoDataUri: PNG }) });
    expect(out.usedCompanyLogo).toBe(true);
  });
});

/* ── the gallery bug ─────────────────────────────────────────────────────── */

describe('ids', () => {
  it('shares no id between two renders with different uids', () => {
    const a = ids(poster.build({ facts: ALL_FACTS, uid: 'alpha' }).svg);
    const b = ids(poster.build({ facts: ALL_FACTS, uid: 'beta' }).svg);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    a.forEach((id) => expect(b).not.toContain(id));
    /* And every reference inside a document resolves inside that document. */
    [[a, poster.build({ facts: ALL_FACTS, uid: 'alpha' }).svg]].forEach(([list, svg]) => {
      (svg.match(/url\(#([^)]+)\)/g) || []).forEach((ref) => {
        expect(list).toContain(ref.slice(5, -1));
      });
    });
  });

  it('strips characters an xml id cannot carry out of the uid', () => {
    const out = poster.build({ facts: ALL_FACTS, uid: 'draft:12.3 #weird' });
    ids(out.svg).forEach((id) => expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/));
  });

  it('still mints usable ids with no uid at all', () => {
    const out = poster.build({ facts: ALL_FACTS });
    const list = ids(out.svg);
    expect(list.length).toBeGreaterThan(0);
    list.forEach((id) => expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/));
    /* Two different posters still differ. */
    const other = ids(poster.build({ facts: { role: 'Something else' } }).svg);
    list.forEach((id) => expect(other).not.toContain(id));
  });

  /*
   * And they differ on facts the seed used not to look at. The seed was org,
   * role, domain, ground and missing, so two posters that differ only in
   * stipend, location and openings — five cards against seven, plainly
   * different pictures — minted byte-identical ids. It is harmless only while
   * every id'd definition depends on nothing but the ground; the first
   * content-dependent def, a per-card clip or a photo mask, brings the gallery
   * bug back silently.
   */
  it('mints different ids for posters that differ in any fact at all', () => {
    const base = {
      org: 'Acme Labs',
      role: 'Python Intern',
      domain: 'Python Development',
      mode: 'Online',
      duration: '3 months',
      stipend: 'Rs 8,000',
      applyBy: '30 Sep',
    };
    const variants = [
      Object.assign({}, base, { stipend: 'Rs 25,000', location: 'Pune', openings: '40' }),
      Object.assign({}, base, { skills: 'Django' }),
      Object.assign({}, base, { batch: '2027' }),
    ];
    const first = ids(poster.build({ facts: base }).svg);
    expect(first.length).toBeGreaterThan(0);
    variants.forEach((facts) => {
      const other = ids(poster.build({ facts }).svg);
      first.forEach((id) => expect(other).not.toContain(id));
    });

    /* The logos and the call to action vary the document too. */
    [{ companyLogoDataUri: PNG }, { cta: 'APPLY NOW' }, { companyName: 'Northwind' }]
      .forEach((extra) => {
        const other = ids(poster.build(Object.assign({ facts: base }, extra)).svg);
        first.forEach((id) => expect(other).not.toContain(id));
      });
  });
});

/* ── the optional dependency ─────────────────────────────────────────────── */

describe('without the domain glyphs', () => {
  afterEach(() => {
    jest.dontMock('../../../../services/v2/linkedin/domainGlyphs');
    jest.resetModules();
  });

  /* domainGlyphs.js is being written in parallel with this file and is
     decoration, not information. A module that throws at require time would
     take the whole agent down on a turn that only wanted to show a preview, so
     the require is guarded — and this is the test that says so. */
  it('still renders when the module cannot be loaded at all', () => {
    jest.resetModules();
    jest.doMock('../../../../services/v2/linkedin/domainGlyphs', () => {
      throw new Error('not built yet');
    });
    /* eslint-disable-next-line global-require */
    const bare = require('../../../../services/v2/linkedin/hiringPoster');
    const out = bare.build({ facts: ALL_FACTS, uid: 'noglyph' });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.cards).toHaveLength(bare.FACT_ORDER.length);
    /* Every card still has its icon; the domain one degrades to a plain
       filled circle rather than vanishing and leaving a hole in the row. */
    expect(everythingInsideItsCard(out.svg)).toBe(out.svg);
  });
});

/* ── the label a screen reader gets ──────────────────────────────────────── */

describe('alt text', () => {
  it('reads out the same spec sheet the picture shows', () => {
    const out = poster.build({ facts: ALL_FACTS, companyName: 'Acme Labs' });
    expect(out.alt).toContain('is hiring');
    expect(out.alt).toContain('Python Development Intern');
    expect(out.alt.length).toBeLessThanOrEqual(300);
  });

  it('is still a sentence when there are no facts', () => {
    const out = poster.build({});
    expect(out.alt).toBe('The Entrepreneurship Network is hiring.');
  });
});
