'use strict';

/*
 * The roll of honour is the one poster that takes uploaded images, and it is
 * the post the company cares most about. So the tests below are mostly about
 * the two ways it could embarrass somebody:
 *
 *   - a photograph that is not a photograph. The data URI comes from a
 *     browser file picker, which means it eventually comes from whatever the
 *     person had in their clipboard. A `javascript:` string, an http link, a
 *     PDF and an SVG all have to become "no photo" rather than a broken image
 *     or an external reference, because an SVG that reaches outside itself is
 *     rasterised blank and the post goes out with no picture at all.
 *   - type that collides. Nine names of unknown length in nine cells is how a
 *     generated poster ends up with one student's surname written through
 *     another's. Every baseline is therefore asserted to be inside the space
 *     it was given.
 *
 * There is no XML parser in this project's dependencies, so wellFormed below
 * is a small scanner: every '<' must open a tag that closes, every tag must
 * balance, and no raw ampersand may survive. That is enough to catch the real
 * failure, which is a person's name containing "&" taking the whole document
 * down.
 */

const roll = require('../../../../services/v2/linkedin/rollOfHonour');

/* A genuine 1x1 PNG. Small enough to paste, real enough that nothing in the
   accept path has to be relaxed for it. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const NAMES = [
  ['Priya Sharma', 'Infosys'],
  ['Arjun Mehta', 'TCS'],
  ['Kavya Nair', 'Zoho'],
  ['Rahul Verma', 'Wipro'],
  ['Sneha Iyer', 'Freshworks'],
  ['Imran Qureshi', 'Razorpay'],
  ['Divya Rao', 'Swiggy'],
  ['Aman Gupta', 'Zerodha'],
  ['Meera Pillai', 'Postman'],
  ['Rohit Das', 'CRED'],
  ['Neha Joshi', 'Groww'],
  ['Vikram Singh', 'Meesho'],
];

function students(n, extra) {
  return NAMES.slice(0, n).map(([name, company], i) => Object.assign(
    { name, company, role: 'Software Engineer', photoDataUri: i % 2 === 0 ? PNG : undefined },
    extra || {},
  ));
}

/* ── a small well-formedness scanner ─────────────────────────────────────── */

const TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
const VOID_TAGS = ['rect', 'circle', 'image', 'path', 'stop', 'line', 'use'];

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

/*
 * wellFormed above cannot see the other way a name takes the poster down.
 *
 * A lone surrogate — half of an emoji, left behind by a cut made in UTF-16
 * units — is still a single innocuous-looking character to every regex in this
 * file, but it is not a legal XML character, and the dashboard renders the
 * poster by calling encodeURIComponent on the document before base64-encoding
 * it into an <img src>. That call throws `URI malformed` on an orphan, so the
 * preview never gets a src and the post goes out with no image. The count is
 * asserted directly rather than by catching the throw, so a failure says which
 * string was cut rather than only that something was.
 */
function loneSurrogates(value) {
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { i += 1; continue; }
      out.push(i);
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      out.push(i);
    }
  }
  return out;
}

function attrValues(svg, attr) {
  const re = new RegExp(`${attr}="([^"]*)"`, 'g');
  const out = [];
  let m = re.exec(svg);
  while (m) { out.push(m[1]); m = re.exec(svg); }
  return out;
}

/* Everything the poster actually says, with the wrapping taken back out, so a
   headline that happens to break across two lines can still be asserted on. */
function words(svg) {
  return (svg.match(/>([^<]*)</g) || [])
    .map((s) => s.slice(1, -1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Every element of one kind, as plain attribute bags, so a test can reason
   about where things actually landed. */
function elements(svg, tagName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)>`, 'g');
  const out = [];
  let m = re.exec(svg);
  while (m) {
    const attrs = {};
    const pair = /([\w:.-]+)="([^"]*)"/g;
    let a = pair.exec(m[1]);
    while (a) { attrs[a[1]] = a[2]; a = pair.exec(m[1]); }
    out.push(attrs);
    m = re.exec(svg);
  }
  return out;
}

function numbers(svg, tagName, attr) {
  const re = new RegExp(`<${tagName}\\b[^>]*\\b${attr}="([-\\d.]+)"`, 'g');
  const out = [];
  let m = re.exec(svg);
  while (m) { out.push(Number(m[1])); m = re.exec(svg); }
  return out;
}

/* ── the shapes ──────────────────────────────────────────────────────────── */

describe('laying the faces out', () => {
  it('renders one, three, six and nine students', () => {
    [1, 3, 6, 9].forEach((n) => {
      const out = roll.build({ students: students(n) });
      wellFormed(out.svg);
      expect(out.count).toBe(n);
      expect(out.overflow).toBe(0);
      expect(out.width).toBe(1200);
      expect(out.height).toBe(1200);
      expect(out.layout).toEqual(roll.LAYOUTS[n]);
      /* Everybody who was passed in is on the poster. */
      NAMES.slice(0, n).forEach(([name, company]) => {
        expect(out.svg).toContain(`>${name}<`);
        expect(out.svg).toContain(`>${company}<`);
      });
    });
  });

  it('gives one student the whole poster and the rest a grid', () => {
    expect(roll.build({ students: students(1) }).layout.id).toBe('solo');
    expect(roll.build({ students: students(2) }).layout.id).toBe('row');
    expect(roll.build({ students: students(3) }).layout.rows).toBe(1);
    expect(roll.build({ students: students(5) }).layout.perRow).toEqual([3, 2]);
    expect(roll.build({ students: students(7) }).layout.rows).toBe(3);
    expect(roll.build({ students: students(9) }).layout.perRow).toEqual([3, 3, 3]);
  });

  it('shows nine and reports the rest', () => {
    const out = roll.build({ students: students(12) });
    wellFormed(out.svg);
    expect(roll.MAX_STUDENTS).toBe(9);
    expect(out.count).toBe(9);
    expect(out.total).toBe(12);
    expect(out.overflow).toBe(3);
    /* The poster says so too — quietly dropping three people is worse than
       being a line longer. */
    expect(out.svg).toContain('and 3 more');
    expect(out.svg).not.toContain('Rohit Das');
    expect(out.alt).toContain('and 3 more');
  });

  it('keeps every mark inside the poster and clear of the footer', () => {
    const out = roll.build({ students: students(9) });
    const H = out.height;
    const footRule = H - Math.round(H * 0.117);
    const site = H - Math.round(H * 0.058);

    const cys = numbers(out.svg, 'circle', 'cy');
    const rs = numbers(out.svg, 'circle', 'r');
    expect(cys.length).toBeGreaterThan(0);
    cys.forEach((cy, i) => {
      expect(cy - rs[i]).toBeGreaterThan(0);
      expect(cy + rs[i]).toBeLessThan(footRule);
    });

    /* Every baseline is either in the content area or is the site line under
       the footer rule. A name that lands anywhere else is a name written over
       something. */
    numbers(out.svg, 'text', 'y').forEach((y) => {
      expect(y > 0 && (y <= footRule || y === site)).toBe(true);
    });
  });

  it('keeps each row of faces clear of the row below it', () => {
    /* The collision this guards against is the one that ruins the poster
       without throwing: a company name in gold printed across the top of the
       next student's forehead. Rows are found from the portraits, and every
       line of type belonging to a row must finish above the next row's
       circle. */
    [6, 9].forEach((n) => {
      const out = roll.build({ students: students(n) });
      const circles = elements(out.svg, 'circle');
      const texts = elements(out.svg, 'text');
      const radius = Number(circles[0].r);
      const rows = circles.map((c) => Number(c.cy))
        .filter((cy, i, all) => all.indexOf(cy) === i)
        .sort((a, b) => a - b);
      expect(rows.length).toBe(roll.LAYOUTS[n].rows);

      /* Below the last row there is only the footer, which is not the grid's
         to collide with. */
      const footRule = out.height - Math.round(out.height * 0.117);
      rows.forEach((cy, i) => {
        const nextTop = i + 1 < rows.length ? rows[i + 1] - radius : footRule;
        const under = texts
          .map((t) => ({ y: Number(t.y), size: Number(t['font-size']) }))
          .filter((t) => t.y > cy + radius && t.y < nextTop);
        /* A name and a company for every face in the row, all of them in the
           gap between this row's portraits and the next row's. Anything that
           spilled would be missing from this count. */
        expect(under.length).toBe(roll.LAYOUTS[n].perRow[i] * 2);
        const lowest = Math.max.apply(null, under.map((t) => t.y + t.size * 0.3));
        expect(lowest).toBeLessThan(nextTop);
      });
    });
  });

  it('renders nothing gracefully when the names have not arrived yet', () => {
    [undefined, [], null, [{}, { name: '' }], 'not an array'].forEach((input) => {
      const out = roll.build({ students: input });
      wellFormed(out.svg);
      expect(out.count).toBe(0);
      expect(out.layout.id).toBe('empty');
      expect(words(out.svg)).toContain('Placed after their internship at TEN');
    });
    expect(roll.build().count).toBe(0);
  });

  it('offers a taller ground and falls back to the square', () => {
    const tall = roll.build({ students: students(6), size: 'portrait' });
    wellFormed(tall.svg);
    expect([tall.width, tall.height, tall.size]).toEqual([1080, 1350, 'portrait']);
    const odd = roll.build({ students: students(6), size: 'landscape' });
    expect([odd.width, odd.height, odd.size]).toEqual([1200, 1200, 'square']);
  });

  it('treats an inherited key as an unknown size or kind, not as a real one', () => {
    /* `size` and `kind` are free-form strings from the agent and the
       dashboard, so they eventually arrive as a property of Object.prototype.
       An unguarded lookup answers those: 'toString' would make the ground an
       inherited function and emit <svg width="undefined"> with NaN through the
       whole layout, and 'constructor' would make the kicker Object itself and
       throw `kicker.toUpperCase is not a function` mid-conversation. Both are
       documented to fall back. */
    ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'].forEach((key) => {
      const bySize = roll.build({ students: students(3), size: key });
      wellFormed(bySize.svg);
      expect([bySize.width, bySize.height, bySize.size]).toEqual([1200, 1200, 'square']);
      /* Checked on the root tag rather than on the whole string, because the
         logo's base64 happens to contain the letters NaN. */
      expect(bySize.svg.slice(0, bySize.svg.indexOf('>') + 1))
        .toContain('width="1200" height="1200" viewBox="0 0 1200 1200"');
      numbers(bySize.svg, 'circle', 'cy').forEach((cy) => expect(Number.isFinite(cy)).toBe(true));
      numbers(bySize.svg, 'text', 'y').forEach((y) => expect(Number.isFinite(y)).toBe(true));

      const byKind = roll.build({ students: students(3), kind: key });
      wellFormed(byKind.svg);
      expect(byKind.svg).toContain('PLACEMENT STORY');
    });
  });
});

/* ── the photographs ─────────────────────────────────────────────────────── */

describe('the photographs, which are untrusted', () => {
  it('draws a real photograph as a circle with a gold ring', () => {
    const out = roll.build({ students: [{ name: 'Priya Sharma', company: 'Infosys', photoDataUri: PNG }] });
    wellFormed(out.svg);
    expect(out.withPhotos).toBe(1);
    expect(out.svg).toContain(PNG);
    expect(out.svg).toContain('<clipPath id="rohsolo"><circle');
    expect(out.svg).toContain('clip-path="url(#rohsolo)"');
  });

  it('gives a student with no photograph their initials', () => {
    const out = roll.build({
      students: [
        { name: 'Priya Anand Sharma', company: 'Infosys' },
        { name: 'arjun mehta', company: 'TCS' },
      ],
    });
    wellFormed(out.svg);
    expect(out.withPhotos).toBe(0);
    /* First and last word, so the middle name does not take the second slot. */
    expect(out.svg).toContain('>PS<');
    expect(out.svg).toContain('>AM<');
  });

  it('refuses anything that is not plainly an image and falls back to initials', () => {
    const hostile = [
      'javascript:alert(1)',
      'http://example.com/priya.jpg',
      'https://example.com/priya.jpg',
      '/uploads/priya.jpg',
      'data:application/pdf;base64,JVBERi0xLjQK',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      /* An SVG can carry its own external href, its own style and its own
         script, so it is not an acceptable photograph however it is encoded. */
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:image/svg+xml,<svg onload="alert(1)"/>',
      /* Not base64 at all, and carrying a quote that would break out of the
         href attribute if it were ever written into the document. */
      'data:image/png,%89PNG"><script>alert(1)</script>',
      'data:image/png;base64,',
      { nope: true },
      42,
    ];
    hostile.forEach((photoDataUri) => {
      const out = roll.build({ students: [{ name: 'Priya Sharma', company: 'Infosys', photoDataUri }] });
      wellFormed(out.svg);
      expect(out.withPhotos).toBe(0);
      expect(out.svg).toContain('>PS<');
      /* Nothing hostile became a reference. The only href in the document is
         the TEN mark, which is read off disk and not from the form. */
      attrValues(out.svg, 'href').forEach((href) => {
        expect(href).not.toBe(photoDataUri);
        expect(href.startsWith('data:image/')).toBe(true);
      });
      expect(out.svg).not.toContain('script');
    });
  });

  it('refuses a photograph that is absurdly large', () => {
    const huge = `data:image/png;base64,${'A'.repeat(roll.MAX_PHOTO_CHARS)}`;
    const out = roll.build({ students: [{ name: 'Priya Sharma', company: 'Infosys', photoDataUri: huge }] });
    expect(out.withPhotos).toBe(0);
    expect(out.svg).toContain('>PS<');
    expect(out.svg.length).toBeLessThan(400000);
    /* Just under the ceiling is still a photograph — the limit exists to keep
       a camera original out, not to reject anything big. */
    const ok = `data:image/png;base64,${'A'.repeat(1000)}`;
    expect(roll.build({ students: [{ name: 'Priya Sharma', photoDataUri: ok }] }).withPhotos).toBe(1);
  });

  it('keeps the whole document inside a photograph budget, not just each upload', () => {
    /* Nine uploads each comfortably under MAX_PHOTO_CHARS are individually
       legal and together are an SVG the dashboard cannot show: it runs
       encodeURIComponent and then base64 over the entire document to build the
       <img src>, so the string is walked twice and grows by a third, and the
       rasteriser times out. The poster this module exists to protect would go
       out with no image at all. Past the budget a student is drawn with their
       initials instead, and withPhotos says so. */
    const photo = `data:image/png;base64,${'A'.repeat(600000)}`;
    expect(photo.length).toBeLessThan(roll.MAX_PHOTO_CHARS);
    const out = roll.build({
      students: NAMES.slice(0, 9).map(([name, company]) => ({ name, company, photoDataUri: photo })),
    });
    expect(out.count).toBe(9);
    expect(out.withPhotos).toBeLessThan(9);
    expect(out.withPhotos).toBeGreaterThan(0);
    expect(out.svg.length).toBeLessThan(roll.MAX_TOTAL_PHOTO_CHARS + 200000);
    /* The students who lost their photograph are still on the poster, with
       their initials — nobody is dropped to save bytes. */
    NAMES.slice(0, 9).forEach(([name]) => expect(out.svg).toContain(`>${name}<`));
    expect(out.svg).toContain('>MP<');
  });

  it('never reaches outside the document', () => {
    const out = roll.build({ students: students(9) });
    attrValues(out.svg, 'href').forEach((href) => {
      expect(href.startsWith('data:image/')).toBe(true);
    });
    /* The SVG namespace is the only URL allowed to be an attribute; it is a
       namespace name, not something the renderer fetches. */
    const body = out.svg.replace(' xmlns="http://www.w3.org/2000/svg"', '');
    expect(body).not.toContain('xlink:');
    expect(body).not.toMatch(/="https?:/);
    expect(body).not.toContain('<script');
    expect(body).not.toContain('@import');
    expect(body).not.toContain('<foreignObject');
    (body.match(/url\(([^)]*)\)/g) || []).forEach((u) => {
      expect(u.startsWith('url(#')).toBe(true);
    });
  });
});

/* ── the words ───────────────────────────────────────────────────────────── */

describe('the words on it', () => {
  it('escapes names and companies', () => {
    const out = roll.build({
      students: [
        { name: "O'Brien & Sons", company: 'Smith & Co <Ltd>' },
        { name: 'Ann "Annie" Rao', company: 'R&D Labs' },
      ],
      headline: 'Placed at R&D firms <2026>',
    });
    wellFormed(out.svg);
    expect(out.svg).toContain('O&apos;Brien &amp; Sons');
    expect(out.svg).toContain('Smith &amp; Co &lt;Ltd&gt;');
    expect(out.svg).toContain('R&amp;D');
    expect(out.svg).toContain('&quot;Annie&quot;');
    /* The alt text is an attribute, so it is escaped by the same route. */
    expect(out.svg).toMatch(/aria-label="[^"]*R&amp;D/);
  });

  it('takes the headline the agent gives it, and has one of its own', () => {
    expect(words(roll.build({ students: students(3) }).svg))
      .toContain('Placed after their internship at TEN');
    const out = roll.build({ students: students(3), headline: '  Six placements in one week  ' });
    expect(out.headline).toBe('Six placements in one week');
    expect(words(out.svg)).toContain('Six placements in one week');
    expect(out.alt.startsWith('Six placements in one week')).toBe(true);
  });

  it('prints the kicker for the kind of post it is', () => {
    expect(roll.build({ students: students(2) }).svg).toContain('PLACEMENT STORY');
    expect(roll.build({ students: students(2), kind: 'leadgen' }).svg)
      .toContain('FOR STUDENTS AND FRESHERS');
    /* An unknown kind is a placement, because that is what this poster is. */
    expect(roll.build({ students: students(2), kind: 'nonsense' }).svg)
      .toContain('PLACEMENT STORY');
  });

  it('cuts a long name to its cell rather than over its neighbour', () => {
    const long = 'Lakshminarayanan Venkataraman Subramanian';
    const out = roll.build({
      students: students(8).concat([{ name: long, company: 'A Very Long Company Name Private Limited' }]),
    });
    wellFormed(out.svg);
    expect(out.count).toBe(9);
    /* The full name is still in the alt text, where length costs nothing; it
       is the drawn line that has to give way. */
    expect(words(out.svg)).not.toContain(long);
    expect(out.alt).toContain('Lakshminarayanan');
    expect(words(out.svg)).toContain('…');
    /* Whatever was drawn is shorter than the name that was passed in. */
    const drawn = (out.svg.match(/>Lakshminarayanan[^<]*</) || [''])[0];
    expect(drawn.length).toBeGreaterThan(2);
    expect(drawn.length).toBeLessThan(long.length);
  });

  it('never cuts a name through the middle of a character', () => {
    /* An emoji is two UTF-16 units, so any cut made with .slice can land
       between them. The half left behind is not legal XML: the dashboard calls
       encodeURIComponent on the document before it can base64 it into an
       <img src>, and that throws on a lone surrogate, so the poster simply
       never renders. Every string on this poster is cut somewhere — names and
       companies against their cells, the headline against the width, the alt
       text against its 300 — so all of them are checked at once. */
    const rocket = '🚀';
    const out = roll.build({
      headline: `Placed ${rocket.repeat(60)}`,
      students: NAMES.slice(0, 9).map(([name], i) => ({
        name: `${name} ${rocket} Kumar`,
        company: `Rocketfuel ${rocket.repeat(12 + i)} Technologies Private Limited`,
      })),
    });
    wellFormed(out.svg);
    expect(loneSurrogates(out.svg)).toEqual([]);
    expect(loneSurrogates(out.alt)).toEqual([]);
    expect(out.alt.length).toBeLessThanOrEqual(300);
    /* The real consequence, asserted the way the browser meets it. */
    expect(() => encodeURIComponent(out.svg)).not.toThrow();
    expect(() => encodeURIComponent(out.alt)).not.toThrow();
    /* A single unbroken emoji token is the case that cuts mid-pair rather than
       at a space, so it gets its own pass. */
    const solo = roll.build({ students: [{ name: rocket.repeat(40), company: rocket.repeat(40) }] });
    wellFormed(solo.svg);
    expect(loneSurrogates(solo.svg)).toEqual([]);
  });

  it('never draws a line that is only an ellipsis', () => {
    /* When the last permitted line holds one long token, dropping the trailing
       word leaves nothing, and what used to be drawn was a line reading " …"
       on its own — which looks like the renderer gave up rather than like an
       elision. A mid-word cut is the right answer there, as it is in a cell. */
    const out = roll.build({
      size: 'portrait',
      students: [{ name: 'Lakshminarayanan Venkataraman Subramanian Balasubramanian', company: 'Infosys' }],
    });
    wellFormed(out.svg);
    (out.svg.match(/>([^<]*)</g) || []).forEach((drawn) => {
      expect(drawn.slice(1, -1).trim()).not.toBe('…');
    });
    /* The headline runs through the same helper, so it gets the same check. */
    const headline = roll.build({
      students: students(3),
      headline: 'Lakshminarayananxxxxxxxxxxxx Venkataramanianxxxxxxxxxxxxxxxxxxxx Subramanianxxxxxxxxxxxxxx',
    });
    wellFormed(headline.svg);
    (headline.svg.match(/>([^<]*)</g) || []).forEach((drawn) => {
      expect(drawn.slice(1, -1).trim()).not.toBe('…');
    });
  });

  it('shows the role only where there is room for it, and never an empty line', () => {
    const solo = roll.build({ students: [{ name: 'Priya Sharma', company: 'Infosys', role: 'Data Analyst' }] });
    expect(solo.svg).toContain('>Infosys<');
    expect(solo.svg).toContain('>Data Analyst<');
    /* In the grid the second line is the company; a student with only a role
       gets the role there rather than a blank line under their face. */
    const grid = roll.build({
      students: [
        { name: 'Priya Sharma', company: 'Infosys', role: 'Data Analyst' },
        { name: 'Arjun Mehta', role: 'Backend Engineer' },
      ],
    });
    expect(grid.svg).toContain('>Infosys<');
    expect(grid.svg).not.toContain('>Data Analyst<');
    expect(grid.svg).toContain('>Backend Engineer<');
  });

  it('describes the poster for a screen reader', () => {
    const out = roll.build({ students: students(3) });
    expect(out.alt).toContain('Priya Sharma at Infosys');
    expect(out.alt).toContain('The Entrepreneurship Network');
    expect(out.alt.length).toBeLessThanOrEqual(300);
  });

  it('accepts a bare name where the agent has nothing else', () => {
    const out = roll.build({ students: ['Priya Sharma', 'Arjun Mehta'] });
    wellFormed(out.svg);
    expect(out.count).toBe(2);
    expect(out.svg).toContain('>Priya Sharma<');
  });
});
