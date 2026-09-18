'use strict';

/**
 * Domain glyphs.
 *
 * Two things are being protected here and they pull in opposite directions.
 *
 * The first is that a glyph must never break a poster. These marks are
 * rasterised in the browser through <img> to <canvas>, where one external
 * reference taints the canvas and one stray '&' makes the whole document
 * unparseable — and in both cases the failure is silent: the post goes out
 * with no image and no error. So every glyph is inspected as text.
 *
 * The second is that adding glyphs must not have changed the six posters that
 * already existed. The hashes below were taken from the designs before the
 * placement edit went in, with a sentence that names no domain. If any of
 * them moves, the feature stopped being additive and every previously
 * approved poster silently re-rendered.
 */

const crypto = require('crypto');

const glyphs = require('../../../../services/v2/linkedin/domainGlyphs');
const designs = require('../../../../services/v2/linkedin/posterDesigns');
const { logoDataUri } = require('../../../../services/v2/linkedin/posterStudio');
const { DOMAIN_NAMES } = require('../../../../config/domains');

const NEUTRAL = 'We have news to share with everyone today';
const DOMAIN_LINE = 'We are hiring Python developers for a six-week internship';

/* Captured from posterDesigns.js before the glyph placement was added. */
const BASELINE = {
  midnight: '14b514cef8469e0ac552abb2775b31785135e6716431712e79624ed19bb35fdc',
  solar: '6032e7f17e88e25fac057e220b00a0ff6fd3812bdc581189c6101623ecc9fb8b',
  split: 'fb86283eb633aa2300424e2e5eaa510c138437abd80e5afc9ba598846736b13c',
  paper: 'ca009637a1efa921394dfc1611cc5e00f81268b8ac36e4c12ca3fa9f56d48d12',
  spotlight: '44a5f0379308250563ed5df6532afb531db033ae40245c110a49f96cfbc87aff',
  blueprint: 'f595215ae7d066656b484faba16f94403eb7d70fe07d11e1a12e00bbfffedda3',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('domainGlyphs — the drawings', () => {
  test('every glyph draws something, and IDS agrees with GLYPHS', () => {
    expect(glyphs.IDS.length).toBe(glyphs.GLYPHS.length);
    expect(new Set(glyphs.IDS).size).toBe(glyphs.IDS.length);
    glyphs.GLYPHS.forEach((g) => {
      expect(typeof g.label).toBe('string');
      expect(g.aliases.length).toBeGreaterThan(0);
      expect(Array.isArray(g.keywords)).toBe(true);
      expect(glyphs.draw({ id: g.id, x: 10, y: 10, size: 64 }).length).toBeGreaterThan(40);
    });
  });

  test('every glyph is self-contained SVG: no external reference, no raw ampersand', () => {
    glyphs.IDS.forEach((id) => {
      const svg = glyphs.draw({ id, x: 0, y: 0, size: 64 });
      /* An href of any kind is the canvas-tainting failure; there is no
         legitimate reason for a drawn glyph to have one at all. */
      expect(svg).not.toMatch(/href\s*=/i);
      expect(svg).not.toMatch(/<image/i);
      expect(svg).not.toMatch(/url\(\s*['"]?https?:/i);
      expect(svg).not.toMatch(/@import|<script|<style|<foreignObject/i);
      /* Raw '&' would make the document unparseable. */
      expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+);)/);
      /* Balanced, and a single group. */
      expect(svg.startsWith('<g ')).toBe(true);
      expect(svg.endsWith('</g>')).toBe(true);
      expect((svg.match(/<g[\s>]/g) || []).length).toBe(1);
      expect((svg.match(/<\/g>/g) || []).length).toBe(1);
    });
  });

  test('a glyph parses as XML when dropped into an svg root', () => {
    /* No XML parser is a dependency here, so the check is the one the browser
       would fail on: every tag we emit is one of a known set, every tag is
       self-closed, and every attribute is quoted. */
    const allowed = /^(path|circle|rect|ellipse|g|line|polygon|polyline)$/;
    glyphs.IDS.forEach((id) => {
      const svg = glyphs.draw({ id, x: 0, y: 0, size: 100 });
      const tags = svg.match(/<([a-zA-Z]+)/g) || [];
      tags.forEach((t) => expect(allowed.test(t.slice(1))).toBe(true));
      /* Every child element closes itself; only the group uses </g>. */
      const children = svg.slice(svg.indexOf('>') + 1, -4);
      expect(children).not.toMatch(/<\/(?!g>)/);
      expect(children.replace(/\/>/g, '')).not.toMatch(/>/);
      /* No unquoted attribute values, which is how a stray number sneaks in. */
      expect(svg).not.toMatch(/=[^"]/);
    });
  });

  test('the tint is used, and an unsafe tint falls back to gold instead of injecting markup', () => {
    const tinted = glyphs.draw({ id: 'python', x: 0, y: 0, size: 64, tint: '#0a0600' });
    expect(tinted).toContain('fill="#0a0600"');

    const hostile = glyphs.draw({
      id: 'python', x: 0, y: 0, size: 64, tint: '#fff" onload="alert(1)',
    });
    expect(hostile).not.toContain('onload');
    expect(hostile).toContain(`fill="${glyphs.DEFAULT_TINT}"`);
  });

  test('opacity is applied only when asked for', () => {
    expect(glyphs.draw({ id: 'web', x: 0, y: 0, size: 64 })).not.toContain('opacity=');
    expect(glyphs.draw({ id: 'web', x: 0, y: 0, size: 64, opacity: 0.12 })).toContain('opacity="0.12"');
  });

  test('the transform carries the requested position and scale', () => {
    expect(glyphs.draw({ id: 'cyber', x: 96, y: 200, size: 50 }))
      .toContain('transform="translate(96 200) scale(0.5)"');
  });

  test('an unknown id, and a size that is not a size, draw nothing', () => {
    expect(glyphs.draw({ id: 'quidditch', x: 0, y: 0, size: 64 })).toBe('');
    expect(glyphs.draw({})).toBe('');
    expect(glyphs.draw()).toBe('');
    expect(glyphs.draw({ id: 'python', x: 0, y: 0, size: 0 })).toBe('');
    expect(glyphs.draw({ id: 'python', x: 0, y: 0, size: 'big' })).toBe('');
  });
});

describe('domainGlyphs — glyphFor', () => {
  test('matches the obvious aliases', () => {
    const cases = [
      ['We are hiring Python developers', 'python'],
      ['Django internship, remote', 'python'],
      ['React and frontend interns wanted', 'web'],
      ['Web Dev openings for freshers', 'web'],
      ['Applications open for Data Science', 'data'],
      ['Digital Marketing internship', 'marketing'],
      ['UI/UX interns, apply by Friday', 'uiux'],
      ['Cyber Security cohort starts Monday', 'cyber'],
      ['ML interns wanted', 'ml'],
      ['Our AI team is growing', 'ml'],
      ['Machine Learning openings', 'ml'],
      ['Human Resources internship', 'hr'],
      ['Finance internship, six weeks', 'finance'],
      ['Content Writing roles open', 'writing'],
      ['Android Development internship', 'mobile'],
      ['Flutter interns wanted', 'mobile'],
      ['Graphic Design internship', 'design'],
      ['Business Development interns', 'business'],
      ['DevOps with AWS cohort', 'devops'],
      ['Java Development internship', 'java'],
      ['Software Engineering interns', 'software'],
      ['Space Intern applications open', 'space'],
      ['Venture Capital internship', 'vc'],
    ];
    cases.forEach(([line, id]) => {
      const hit = glyphs.glyphFor(line);
      expect(hit && hit.id).toBe(id);
    });
  });

  test('is case-insensitive', () => {
    ['PYTHON INTERNSHIP', 'python internship', 'PyThOn Internship'].forEach((line) => {
      expect(glyphs.glyphFor(line).id).toBe('python');
    });
  });

  test('is word-boundary safe', () => {
    /* "javascript" contains "java"; matching it as Java is the bug this test
       exists for — the poster came out with a coffee cup on a React post. */
    expect(glyphs.glyphFor('We need a JavaScript developer').id).toBe('web');
    /* "py" inside "happy", "ai" inside "email", "ml" inside "html",
       "space" inside "workspace" — none of these name a domain. */
    expect(glyphs.glyphFor('A happy team, email us')).toBeNull();
    expect(glyphs.glyphFor('Our workspace is open')).toBeNull();
  });

  test('returns null when the text is not about a domain', () => {
    expect(glyphs.glyphFor('we have news')).toBeNull();
    expect(glyphs.glyphFor('')).toBeNull();
    expect(glyphs.glyphFor('   ')).toBeNull();
    expect(glyphs.glyphFor(null)).toBeNull();
    expect(glyphs.glyphFor(undefined)).toBeNull();
    expect(glyphs.glyphFor(42)).toBeNull();
  });

  test('a domain name outranks a keyword from another domain', () => {
    /* "recruitment" is an HR keyword and "Python" is a Python alias. The post
       is about a Python internship; HR is how it is being filled. */
    expect(glyphs.glyphFor('Recruitment open for Python interns').id).toBe('python');
  });

  test('two domains named with equal authority produce null rather than a guess', () => {
    /* The refusal has to hold however the two domains are spelled. These four
       sentences are the same situation — two domains named, no honest way to
       pick one — and the first used to be the only one that produced null,
       because 'hr' and 'bd' happen to be the same number of characters. The
       other three printed the longer name's glyph on a post about both. */
    expect(glyphs.glyphFor('Openings in HR and BD')).toBeNull();
    expect(glyphs.glyphFor('Openings in HR and Business Development')).toBeNull();
    expect(glyphs.glyphFor('Openings in Web Development and Data Science')).toBeNull();
    expect(glyphs.glyphFor('Python and Java internships')).toBeNull();

    /* Two names for one domain is not ambiguity, and must still resolve. */
    expect(glyphs.glyphFor('Machine Learning, or ML if you prefer').id).toBe('ml');
    expect(glyphs.glyphFor('MERN stack web development').id).toBe('web');
  });

  test('a link in the post does not choose the glyph', () => {
    /* The agent hands glyphFor the whole finished post, link included. A
       short link's path is not prose: each of these sentences names no domain
       at all, and each used to come back with one because '/' and '-' read as
       word boundaries around a two-letter alias. */
    [
      'Big news from the team. Register at https://bit.ly/ten-ai before Friday.',
      'Our results are in. More at https://ten.co/hr',
      'Applications close Sunday. Form: https://forms.gle/ab/ui',
      'Celebrating 500 placements! Details at https://x.co/py',
      'Write to us at careers-hr@example.com for details',
      'Everything is at www.example.com/ml today',
    ].forEach((line) => expect(glyphs.glyphFor(line)).toBeNull());

    /* The rest of the sentence is still read — only the link is dropped. */
    expect(glyphs.glyphFor('Python internship. Apply at https://ten.co/x').id).toBe('python');
  });

  test('hyphenated spellings match the same domain as the spaced ones', () => {
    [
      ['Full Stack Development internship', 'Full-stack Development internship', 'web'],
      ['Data Science internship', 'Data-Science internship', 'data'],
      ['Front end intern wanted', 'Front-end intern wanted', 'web'],
      ['Cyber Security cohort', 'Cyber-Security cohort', 'cyber'],
      ['Machine Learning roles', 'Machine-Learning roles', 'ml'],
    ].forEach(([spaced, hyphenated, id]) => {
      expect(glyphs.glyphFor(spaced).id).toBe(id);
      expect(glyphs.glyphFor(hyphenated).id).toBe(id);
    });
  });

  test('a version number on a technology does not hide it', () => {
    /* A word cannot grow to the right by a digit and mean something else, and
       these are the spellings people actually type. */
    expect(glyphs.glyphFor('Hiring Python3 developers').id).toBe('python');
    expect(glyphs.glyphFor('HTML5 and CSS3 workshop').id).toBe('web');
    expect(glyphs.glyphFor('Java21 migration internship').id).toBe('java');
    /* The left-hand boundary still does all the work it did before. */
    expect(glyphs.glyphFor('A happy team, email us')).toBeNull();
  });

  test('an ordinary English word that happens to be a domain name is not a domain', () => {
    /* "space" is the one short domain name that is also a common noun. */
    expect(glyphs.glyphFor('Only a little space left in this batch')).toBeNull();
    expect(glyphs.glyphFor('Space Intern applications open').id).toBe('space');
    expect(glyphs.glyphFor('Space Research internship').id).toBe('space');
  });

  test('every domain in config/domains.js has a glyph', () => {
    DOMAIN_NAMES.forEach((name) => {
      const hit = glyphs.glyphFor(name);
      /* Not a formatted message: `hit === null ? 'no glyph' : hit.id` is a
         string either way, so asserting it is a string passed even when the
         lookup failed — the one failure this test exists to catch. */
      expect(hit).not.toBeNull();
      expect(glyphs.IDS).toContain(hit.id);
    });
  });
});

describe('the six designs with and without a glyph', () => {
  test('a sentence with no domain renders the designs exactly as before', () => {
    /* The baseline was taken with the TEN mark present. Where the PNG is
       missing the mark block is absent from every poster and the hashes
       cannot match, so the byte check is skipped rather than made to lie —
       the structural assertion below still runs. */
    const hasMark = Boolean(logoDataUri());
    designs.DESIGN_IDS.forEach((id) => {
      const out = designs.renderDesign({ design: id, line: NEUTRAL, kind: 'general' });
      expect(out.glyph).toBeNull();
      expect(out.svg).not.toContain('<g transform="translate(');
      if (hasMark) expect(`${id}:${sha256(out.svg)}`).toBe(`${id}:${BASELINE[id]}`);
    });
  });

  test('a sentence about a domain puts the glyph on all six, each in its own place', () => {
    const seen = new Set();
    designs.DESIGN_IDS.forEach((id) => {
      const out = designs.renderDesign({ design: id, line: DOMAIN_LINE, kind: 'opening' });
      expect(out.glyph).toBe('python');
      expect(out.svg).toContain('<g transform="translate(');
      expect(out.svg.startsWith('<svg')).toBe(true);
      expect(out.svg.endsWith('</svg>')).toBe(true);
      expect((out.svg.match(/<g[\s>]/g) || []).length).toBe(1);
      expect((out.svg.match(/<\/g>/g) || []).length).toBe(1);
      /* No external reference anywhere in the finished poster; the mark is a
         data: URI and the glyph must not have added anything else. */
      const hrefs = out.svg.match(/href="([^"]*)"/g) || [];
      hrefs.forEach((h) => expect(h.startsWith('href="data:')).toBe(true));
      expect(out.svg).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+);)/);

      const placement = (out.svg.match(/<g transform="translate\(([^)]*)\)/) || [])[1];
      seen.add(placement);
    });
    /* Six designs, six different positions: a glyph bolted into the same
       corner of all six would make the gallery one poster shown six times. */
    expect(seen.size).toBe(designs.DESIGN_IDS.length);
  });

  test('Paper replaces its gold dot rather than adding a third mark', () => {
    const without = designs.renderDesign({ design: 'paper', line: NEUTRAL });
    const withGlyph = designs.renderDesign({ design: 'paper', line: DOMAIN_LINE });
    expect(without.svg).toContain('<circle cx="104" cy="112" r="10"');
    expect(withGlyph.svg).not.toContain('<circle cx="104" cy="112" r="10"');
  });

  test('Solar holds its glyph back to a watermark so the type still reads', () => {
    const out = designs.renderDesign({ design: 'solar', line: DOMAIN_LINE });
    expect(out.svg).toContain('opacity="0.12"');
  });

  test('Midnight clears the kicker for every kicker it can be given', () => {
    /*
     * Midnight is the one design that places the glyph by measuring text, and
     * the measurement has no font to ask. The leadgen kicker is the long one
     * — "FOR STUDENTS AND FRESHERS" — and the mixed-case em estimate this
     * originally used put the mark nine pixels inside its final S. Nothing
     * asserted the clearance, which is why that shipped.
     *
     * So the width is recomputed here from Arial Bold's own cap advances
     * rather than from any constant posterDesigns exports: if that estimate
     * drifts back down, this fails even though every other test still passes.
     */
    const CAP_EM = {
      A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
      J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
      S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, ' ': 278,
    };
    const SIZE_PX = 22;
    const SPACING_PX = 0.22 * SIZE_PX;

    /* Where the kicker's last character actually stops inking: the advances
       of every character, plus the letter-spacing between them. The spacing
       after the final character is not ink, so it is not counted. */
    function inkEnd(kicker) {
      const caps = kicker.toUpperCase();
      let sum = 0;
      for (let i = 0; i < caps.length; i += 1) {
        sum += CAP_EM[caps[i]] == null ? 722 : CAP_EM[caps[i]];
      }
      return 96 + (sum / 1000) * SIZE_PX + SPACING_PX * (caps.length - 1);
    }

    const kinds = Object.keys(designs.KICKERS);
    expect(kinds.length).toBeGreaterThan(0);
    kinds.forEach((kind) => {
      const out = designs.renderDesign({ design: 'midnight', line: DOMAIN_LINE, kind });
      expect(out.glyph).toBe('python');
      const x = Number((out.svg.match(/<g transform="translate\((-?[\d.]+) /) || [])[1]);
      expect(Number.isFinite(x)).toBe(true);
      /* The design asks for 28 units of air after the words. Allowing a
         little less than that keeps this a test of the overlap and not of the
         exact estimate; what it will not tolerate is the mark landing on the
         text, which is what a value at or below inkEnd means. */
      expect(x).toBeGreaterThan(inkEnd(designs.KICKERS[kind]) + 16);
      /* And it must still stop short of the TEN mark's left edge at x=972. */
      expect(x + 72).toBeLessThan(972);
    });
  });

  test('suggest() carries the glyph through the whole gallery', () => {
    const gallery = designs.suggest({ line: DOMAIN_LINE, kind: 'opening' });
    expect(gallery.length).toBe(designs.DESIGN_IDS.length);
    gallery.forEach((poster) => expect(poster.glyph).toBe('python'));
  });
});
