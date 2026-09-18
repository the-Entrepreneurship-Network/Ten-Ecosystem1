'use strict';

/*
 * The achievement poster goes out under a real person's name, so these tests
 * are about the three ways it could embarrass one:
 *
 *   - an upload that is not what it claims. The photograph and both logos come
 *     from a browser file picker, which means they eventually come from
 *     whatever was in somebody's clipboard. A `javascript:` string, an http
 *     link, a PDF and a five-megabyte blob all have to become "no image"
 *     rather than a broken glyph or an external reference — an SVG that
 *     reaches outside itself is rasterised blank and the post goes out with no
 *     picture at all.
 *   - type that collides. A long name, a long subtitle and a three-line
 *     headline share one column, so every baseline in that column is asserted
 *     to sit at least a full font size below the one before it.
 *   - ids that collide. Two posters on one page sharing a clipPath id leave
 *     the second one wearing the first one's crop, which no single-poster test
 *     can see. Two renders with different uids are therefore compared.
 *
 * There is no XML parser in this project's dependencies, so wellFormed below
 * is a small scanner: every '<' must open a tag that closes, every tag must
 * balance, attributes must be quoted pairs, and no raw ampersand may survive.
 * That is enough to catch the real failure, which is a name containing "&"
 * taking the whole document down.
 */

const poster = require('../../../../services/v2/linkedin/achievementPoster');

/* A genuine 1x1 PNG and a genuine 1x1 GIF. Small enough to paste, real enough
   that nothing in the accept path has to be relaxed for them. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

const PERSON = {
  name: 'Ananya Krishnan',
  subtitle: 'Backend intern, class of 2025',
  headline: "Selected for Anthropic's open source program",
  kicker: 'The next generation',
  photoDataUri: PNG,
  stats: [
    { value: '65+', label: 'merged PRs' },
    { value: '6 months', label: 'of Claude Max 20x' },
    { value: 'Access', label: 'to the Anthropic team' },
  ],
};

/* ── a small well-formedness scanner ─────────────────────────────────────── */

const TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
const VOID_TAGS = ['rect', 'circle', 'ellipse', 'image', 'path', 'stop', 'line', 'use', 'polygon'];

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
 * Self-containment: the one property that decides whether the poster survives
 * being drawn into a canvas. Every href must be a data URI, and nothing may
 * pull in a font, a stylesheet or an xlink.
 */
function selfContained(svg) {
  const hrefs = [];
  const re = /href="([^"]*)"/g;
  let m = re.exec(svg);
  while (m) { hrefs.push(m[1]); m = re.exec(svg); }
  hrefs.forEach((h) => expect(h.slice(0, 11)).toBe('data:image/'));
  expect(svg).not.toContain('xlink:');
  expect(svg).not.toContain('<style');
  expect(svg).not.toContain('@import');
  /* The namespace declaration is the one URL allowed in the document — it is
     never fetched. Everything else that looks like a URL would be. */
  const body = svg.replace(/xmlns="[^"]*"/g, '');
  expect(body).not.toContain('http://');
  expect(body).not.toContain('https://');
  return hrefs;
}

function idsOf(svg) {
  const out = [];
  const re = /\bid="([^"]*)"/g;
  let m = re.exec(svg);
  while (m) { out.push(m[1]); m = re.exec(svg); }
  return out;
}

function refsOf(svg) {
  const out = [];
  const re = /url\(#([^)]*)\)/g;
  let m = re.exec(svg);
  while (m) { out.push(m[1]); m = re.exec(svg); }
  return out;
}

/** Every <text> as { x, y, size, content }, in document order. */
function texts(svg) {
  const out = [];
  const re = /<text ([^>]*)>([^<]*)<\/text>/g;
  let m = re.exec(svg);
  while (m) {
    const attrs = {};
    const ar = /([\w:.-]+)="([^"]*)"/g;
    let a = ar.exec(m[1]);
    while (a) { attrs[a[1]] = a[2]; a = ar.exec(m[1]); }
    out.push({
      x: Number(attrs.x),
      y: Number(attrs.y),
      size: Number(attrs['font-size']),
      anchor: attrs['text-anchor'] || 'start',
      content: m[2],
    });
    m = re.exec(svg);
  }
  return out;
}

/* ── the shape ───────────────────────────────────────────────────────────── */

describe('the poster itself', () => {
  it('renders a complete person', () => {
    const out = poster.build({ person: PERSON, uid: 'one', companyName: 'Anthropic' });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.width).toBe(1200);
    expect(out.height).toBe(1200);
    expect(out.size).toBe('square');
    expect(out.usedPhoto).toBe(true);
    expect(out.fallbacks).toEqual([]);
    expect(out.statCount).toBe(3);
    expect(out.statsDropped).toBe(0);

    /* The facts the client asked for, and no prose. */
    expect(out.svg).toContain('>ANANYA KRISHNAN<');
    expect(out.svg).toContain('>Backend intern, class of 2025<');
    expect(out.svg).toContain('>65+<');
    expect(out.svg).toContain('>merged PRs<');
    expect(out.svg).toContain('>Anthropic<');
    /* The headline is wrapped, so it is asserted line by line rather than as
       one string — and the apostrophe survives as an entity. */
    expect(texts(out.svg).map((t) => t.content).join(' '))
      .toContain('SELECTED FOR ANTHROPIC&apos;S OPEN SOURCE PROGRAM');
    expect(out.svg).toContain('>TEN | CLASS OF BUILDERS<');
    expect(out.alt).toContain('Ananya Krishnan');
    expect(out.alt.length).toBeLessThanOrEqual(300);
  });

  it('renders the portrait ground with the same composition', () => {
    const out = poster.build({ person: PERSON, uid: 'p', size: 'portrait' });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1350);
    expect(out.size).toBe('portrait');
    /* An unknown shape is the square, not a throw. */
    expect(poster.build({ person: PERSON, size: 'banner' }).size).toBe('square');
  });

  it('renders with almost nothing, and with nothing at all', () => {
    const two = poster.build({ person: { name: 'Ravi Menon', stats: [{ value: '3', label: 'offers' }] }, uid: 'two' });
    wellFormed(two.svg);
    expect(two.usedPhoto).toBe(false);
    expect(two.statCount).toBe(1);
    /* No photograph and no upload attempted is not a fallback, it is a poster
       without a photograph. */
    expect(two.fallbacks).toEqual([]);
    expect(two.svg).toContain('>RM<');

    const empty = poster.build({});
    wellFormed(empty.svg);
    selfContained(empty.svg);
    expect(empty.statCount).toBe(0);
    expect(empty.usedPhoto).toBe(false);
    /* The defaults still name the series and the publisher, so an empty
       poster reads as a template rather than as a mistake. */
    expect(empty.svg).toContain('>THE NEXT GENERATION<');
    expect(empty.svg).toContain('>Humans of TEN<');
    expect(empty.svg).toContain('>The Entrepreneurship Network<');
  });

  it('keeps the initials disc off the name below it', () => {
    /* The no-photograph path is the default for anyone who did not send a
       picture, and the disc used to be centred low enough that its stroked
       bottom arc swept through the cap band of the gold name. */
    const out = poster.build({ person: { name: 'Ravi Menon' }, uid: 'disc' });
    wellFormed(out.svg);
    const circles = out.svg.match(/<circle [^>]*>/g) || [];
    expect(circles.length).toBe(2);
    const at = (tag, key) => Number((new RegExp(`${key}="([^"]*)"`).exec(tag) || [])[1]);
    const discBottom = at(circles[0], 'cy') + at(circles[0], 'r') + 2;
    const name = texts(out.svg).filter((t) => t.content === 'RAVI MENON')[0];
    expect(name).toBeTruthy();
    /* The name is set at the top of its size ladder here, so its cap top is the
       tightest this clearance ever gets. */
    expect(discBottom).toBeLessThan(name.y - name.size);
  });

  it('accepts a person given as a bare name', () => {
    const out = poster.build({ person: 'Sana Qureshi' });
    wellFormed(out.svg);
    expect(out.svg).toContain('>SANA QURESHI<');
    expect(out.svg).toContain('>SQ<');
  });
});

/* ── type that must not collide ─────────────────────────────────────────── */

describe('fitting the words', () => {
  it('keeps a very long headline inside three lines and off the footer', () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, {
        headline: 'Selected for the Anthropic open source fellowship programme for the 2025 cohort of student maintainers',
        name: 'Lakshminarayanan Venkataraman',
        subtitle: 'Distributed systems and developer tooling, class of 2025',
      }),
      uid: 'long',
    });
    wellFormed(out.svg);

    const all = texts(out.svg);
    const footerTop = 1110;
    const footerBaseline = footerTop + Math.round(90 * 0.63);
    all.forEach((t) => {
      expect(t.y).toBeGreaterThan(0);
      /* Everything is either in the content area or is one of the two lines
         set inside the gold bar. A baseline anywhere else is type written over
         the footer. */
      expect(t.y <= footerTop - 8 || t.y === footerBaseline).toBe(true);
    });

    /* The left column holds the series, the name, the subtitle, the headline
       and the footer note. Sorted by baseline, each one must clear the one
       above it by at least its own font size. */
    const column = all.filter((t) => t.x === 96 && t.anchor === 'start').sort((a, b) => a.y - b.y);
    expect(column.length).toBeGreaterThan(4);
    for (let i = 1; i < column.length; i += 1) {
      expect(column[i].y - column[i - 1].y).toBeGreaterThanOrEqual(column[i].size);
    }
  });

  it('elides rather than overflowing a 60-character subtitle', () => {
    const subtitle = 'Backend engineering intern and open source maintainer, 2025';
    expect(subtitle.length).toBeGreaterThanOrEqual(59);
    const out = poster.build({ person: Object.assign({}, PERSON, { subtitle }), uid: 'sub' });
    wellFormed(out.svg);
    const line = texts(out.svg).filter((t) => t.content.indexOf('Backend') === 0)[0];
    expect(line).toBeTruthy();
    /* 652 pixels at 28px and half an em is about 44 characters; anything
       longer must have come back clipped. */
    expect(line.content.length).toBeLessThan(subtitle.length);
    expect(line.content.slice(-1)).toBe('…');
  });

  it('keeps a name that is one unbreakable word', () => {
    /* wrap() hard-splits nothing here — the word is shorter than the line — so
       the name wrapped to two lines and the ellipsis path ran on a line with no
       internal space. /\s*\S*$/ matches the whole of such a line, and the slot
       used to render as a bare " …": the person's name absent from a poster
       published under it. */
    const out = poster.build({ person: { name: 'Venkatanarasimharajuvaripeta Rao' }, uid: 'oneword' });
    wellFormed(out.svg);
    const name = texts(out.svg).filter((t) => t.content.indexOf('VENKATA') === 0)[0];
    expect(name).toBeTruthy();
    expect(name.content.length).toBeGreaterThan(8);
    expect(out.svg).not.toContain('> …<');

    /* The same rule protects the number a stat exists to carry. */
    const stat = poster.build({
      person: { name: 'A B', stats: [{ value: 'Rs1200000perannumCTC', label: 'package' }] },
      uid: 'onewordstat',
    });
    expect(stat.svg).not.toContain('> …<');
    expect(texts(stat.svg).some((t) => t.content.indexOf('Rs12') === 0)).toBe(true);
  });

  it('keeps a long kicker clear of the publisher lockup', () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, { kicker: 'Humans of the Entrepreneurship Network, 2025 cohort' }),
      uid: 'kick',
    });
    wellFormed(out.svg);
    const all = texts(out.svg);
    const kicker = all.filter((t) => t.x === 96 && t.content.indexOf('HUMANS') === 0)[0];
    const lockup = all.filter((t) => t.anchor === 'end' && t.content === 'The Entrepreneurship Network')[0];
    expect(kicker).toBeTruthy();
    expect(lockup).toBeTruthy();
    /* They sit ten pixels apart vertically, so the only thing keeping them off
       each other is width. 0.24em of tracking is part of the advance. */
    expect(Math.abs(kicker.y - lockup.y)).toBeLessThan(kicker.size);
    const kickerRight = kicker.x + kicker.content.length * kicker.size * 0.8;
    const lockupLeft = lockup.x - lockup.content.length * lockup.size * 0.6;
    expect(kickerRight).toBeLessThan(lockupLeft);
    expect(kicker.content.slice(-1)).toBe('…');
    /* The default still fits untouched — the budget is a guard, not a haircut. */
    expect(poster.build({ person: PERSON, uid: 'k2' }).svg).toContain('>THE NEXT GENERATION<');
  });

  it('keeps a long footer note clear of the site URL on the same baseline', () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, { footerNote: 'Entrepreneurship Network | Class of Builders 2025' }),
      uid: 'foot',
    });
    wellFormed(out.svg);
    const all = texts(out.svg);
    const note = all.filter((t) => t.x === 96 && t.content.indexOf('ENTREPRENEURSHIP') === 0)[0];
    const site = all.filter((t) => t.content.indexOf('virtualinternships') === 0)[0];
    expect(note).toBeTruthy();
    expect(site).toBeTruthy();
    expect(note.y).toBe(site.y);
    const noteRight = note.x + note.content.length * note.size * 0.66;
    const siteLeft = site.x - site.content.length * site.size * 0.56;
    expect(noteRight).toBeLessThan(siteLeft);
  });

  it("survives O'Brien & Sons", () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, { name: "O'Brien & Sons" }),
      companyName: 'Smith & Wesson <Ltd>',
      orgName: 'Tata & Sons',
      uid: 'esc',
    });
    wellFormed(out.svg);
    expect(out.svg).toContain('>O&apos;BRIEN &amp; SONS<');
    expect(out.svg).toContain('&lt;Ltd&gt;');
    expect(out.svg).toContain('Tata &amp; Sons');
    /* The alt text is not markup, so it carries the characters themselves. */
    expect(out.alt).toContain("O'Brien & Sons");
  });
});

/* ── the stat column ────────────────────────────────────────────────────── */

describe('the numbers', () => {
  it('draws a single stat and caps six at four', () => {
    const one = poster.build({ person: Object.assign({}, PERSON, { stats: [{ value: '1', label: 'offer' }] }), uid: 's1' });
    wellFormed(one.svg);
    expect(one.statCount).toBe(1);
    expect(one.statsDropped).toBe(0);

    const six = poster.build({
      person: Object.assign({}, PERSON, {
        stats: [1, 2, 3, 4, 5, 6].map((i) => ({ value: `${i}0+`, label: `thing ${i}` })),
      }),
      uid: 's6',
    });
    wellFormed(six.svg);
    expect(poster.MAX_STATS).toBe(4);
    expect(six.statCount).toBe(4);
    expect(six.statsDropped).toBe(2);
    expect(six.svg).toContain('>40+<');
    /* The fifth and sixth are not silently drawn somewhere off the edge. */
    expect(six.svg).not.toContain('>50+<');
    expect(six.svg).not.toContain('>60+<');
    expect(six.alt).not.toContain('50+');
  });

  it('drops empty rows instead of drawing blank ones', () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, {
        stats: [{ value: '', label: '' }, null, { value: '9', label: 'weeks' }, 'Mentored by three engineers'],
      }),
      uid: 'sparse',
    });
    wellFormed(out.svg);
    expect(out.statCount).toBe(2);
    expect(out.svg).toContain('>9<');
    expect(out.svg).toContain('>weeks<');
  });

  it('keeps a bare number instead of losing it', () => {
    /* A stats array out of a spreadsheet or a JSON body arrives as scalars. The
       Number went to `raw || {}`, which is the Number, which has no .value — so
       the fact vanished from the picture and from statsDropped alike. */
    const out = poster.build({
      person: Object.assign({}, PERSON, { stats: [65, '6 months', { value: 12, label: 'weeks' }] }),
      uid: 'numbers',
    });
    wellFormed(out.svg);
    expect(out.statCount).toBe(3);
    expect(out.statsDropped).toBe(0);
    expect(out.svg).toContain('>65<');
    expect(out.svg).toContain('>6 months<');
    expect(out.svg).toContain('>12<');
  });

  it('keeps every stat baseline clear of the company mark below it', () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, {
        stats: [1, 2, 3, 4].map((i) => ({ value: `${i}00+`, label: 'a label that is quite long indeed' })),
      }),
      uid: 'stats4',
    });
    const companyY = Math.round(1200 * 0.565);
    texts(out.svg).filter((t) => t.x === Math.round(1200 * 0.643)).forEach((t) => {
      expect(t.y).toBeLessThan(companyY);
    });
  });
});

/* ── untrusted images ───────────────────────────────────────────────────── */

describe('refusing what it cannot verify', () => {
  const HOSTILE = [
    'javascript:alert(1)',
    'http://example.com/face.jpg',
    'https://example.com/face.jpg',
    'data:application/pdf;base64,JVBERi0xLjQK',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+',
    'data:image/png;base64,',
    'data:image/png;utf8,<svg/>',
    'data:image/png;base64,not base64 at all!',
    '   ',
    42,
    {},
  ];

  it('falls back to initials for every hostile photograph', () => {
    HOSTILE.forEach((bad) => {
      const out = poster.build({ person: Object.assign({}, PERSON, { photoDataUri: bad }), uid: 'hostile' });
      wellFormed(out.svg);
      selfContained(out.svg);
      expect(out.usedPhoto).toBe(false);
      expect(out.svg).toContain('>AK<');
      expect(poster.safePhoto(bad)).toBe('');
    });
  });

  it('reports the refusal so the agent can say so', () => {
    const out = poster.build({
      person: Object.assign({}, PERSON, { photoDataUri: 'http://example.com/face.jpg' }),
      companyLogoDataUri: 'javascript:alert(1)',
      orgLogoDataUri: 'data:text/html;base64,PGI+',
      companyName: 'Anthropic',
      uid: 'report',
    });
    expect(out.fallbacks).toEqual(['photo', 'orgLogo', 'companyLogo']);
    expect(out.usedPhoto).toBe(false);
    expect(out.usedCompanyLogo).toBe(false);
    /* The org slot still has a mark, because its fallback is the house mark
       rather than nothing — but the refusal is reported all the same. */
    expect(out.usedOrgLogo).toBe(true);
    expect(out.svg).toContain('>Anthropic<');
  });

  it('refuses an image that is too large to be one', () => {
    const huge = `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}`;
    expect(poster.safePhoto(huge)).toBe('');
    expect(poster.safeLogo(huge)).toBe('');
    const out = poster.build({ person: Object.assign({}, PERSON, { photoDataUri: huge }), companyLogoDataUri: huge, companyName: 'Anthropic', uid: 'huge' });
    expect(out.usedPhoto).toBe(false);
    expect(out.usedCompanyLogo).toBe(false);
    expect(out.svg.length).toBeLessThan(1024 * 1024);
    expect(out.svg).toContain('>Anthropic<');
  });

  it('embeds a photograph and a logo it can verify', () => {
    const out = poster.build({
      person: PERSON,
      orgLogoDataUri: PNG,
      orgName: 'Polaris School',
      companyLogoDataUri: SVG_LOGO,
      companyName: 'Anthropic',
      uid: 'good',
    });
    wellFormed(out.svg);
    const hrefs = selfContained(out.svg);
    expect(out.usedPhoto).toBe(true);
    expect(out.usedOrgLogo).toBe(true);
    expect(out.usedCompanyLogo).toBe(true);
    expect(out.fallbacks).toEqual([]);
    expect(hrefs).toContain(PNG);
    expect(hrefs).toContain(SVG_LOGO);
    expect(out.svg).toContain('>Polaris School<');
    /* The logo is there, so the name is not also set on the ground beside the
       figure — one mark or one name, never both. */
    expect(out.svg).not.toContain('>Anthropic<');
  });

  it('names both organisations when there are no logos at all', () => {
    const out = poster.build({
      person: PERSON,
      orgName: 'Polaris School',
      companyName: 'Anthropic',
      uid: 'nologos',
    });
    wellFormed(out.svg);
    selfContained(out.svg);
    expect(out.svg).toContain('>Polaris School<');
    expect(out.svg).toContain('>Anthropic<');
    expect(out.usedCompanyLogo).toBe(false);
    expect(out.fallbacks).toEqual([]);
  });
});

/* ── ids ────────────────────────────────────────────────────────────────── */

describe('ids', () => {
  it('mints unique ids within a render and across two uids', () => {
    const a = poster.build({ person: PERSON, uid: 'alpha', companyLogoDataUri: PNG, orgLogoDataUri: PNG });
    const b = poster.build({ person: PERSON, uid: 'bravo', companyLogoDataUri: PNG, orgLogoDataUri: PNG });

    const aIds = idsOf(a.svg);
    const bIds = idsOf(b.svg);
    expect(aIds.length).toBeGreaterThan(3);
    expect(new Set(aIds).size).toBe(aIds.length);
    expect(new Set(bIds).size).toBe(bIds.length);
    aIds.forEach((id) => expect(bIds).not.toContain(id));

    /* Nothing may reference an id the document does not define — a dangling
       url(#…) is a poster with no clip and no mask, which is the photograph
       painted as a hard rectangle over the type. */
    [a, b].forEach((out) => {
      const defined = idsOf(out.svg);
      refsOf(out.svg).forEach((ref) => expect(defined).toContain(ref));
    });
  });

  it('separates two uids that share a long prefix', () => {
    /* Descriptive uids agree for a long way — 'linkedin-achievement-card-01'
       and '…-02' for twenty-six characters — and the prefix used to be a
       truncation of them. Two such posters on one chooser page minted the same
       clipPath and mask ids, so the second one wore the first one's crop and
       the first one's fade. Different shapes, to make the failure obvious. */
    const a = poster.build({
      person: PERSON, uid: 'linkedin-achievement-poster-square', companyLogoDataUri: PNG, orgLogoDataUri: PNG,
    });
    const b = poster.build({
      person: PERSON, uid: 'linkedin-achievement-poster-portrait', size: 'portrait', companyLogoDataUri: PNG, orgLogoDataUri: PNG,
    });
    const aIds = idsOf(a.svg);
    const bIds = idsOf(b.svg);
    expect(aIds.length).toBeGreaterThan(3);
    aIds.forEach((id) => expect(bIds).not.toContain(id));

    /* Filtering collides as well as truncation does: the punctuation is
       stripped, so two uids that differ only in it must still separate. */
    const hash = poster.build({ person: PERSON, uid: 'poster#1' });
    const plain = poster.build({ person: PERSON, uid: 'poster1' });
    const hashIds = idsOf(hash.svg);
    idsOf(plain.svg).forEach((id) => expect(hashIds).not.toContain(id));
    hashIds.forEach((id) => expect(/^[A-Za-z0-9_-]+$/.test(id)).toBe(true));
  });

  it('derives an id prefix from the inputs when no uid is given', () => {
    const a = poster.build({ person: PERSON });
    const b = poster.build({ person: Object.assign({}, PERSON, { name: 'Someone Else' }) });
    const aIds = idsOf(a.svg);
    idsOf(b.svg).forEach((id) => expect(aIds).not.toContain(id));
  });

  it('refuses to let a uid escape its attribute', () => {
    const out = poster.build({ person: PERSON, uid: '" onload="alert(1)' });
    wellFormed(out.svg);
    /* The quote and the space are gone, so the injected attribute never
       becomes one — what survives is a harmless run of letters inside an id. */
    expect(out.svg).not.toMatch(/\son[a-z]+=/);
    idsOf(out.svg).forEach((id) => expect(/^[A-Za-z0-9_-]+$/.test(id)).toBe(true));
  });
});
