'use strict';

/*
 * Poster studio — the brand poster that rides along with a LinkedIn post.
 *
 * Every poster is a plain SVG string built here on the server and rasterised
 * in the browser (Image -> canvas -> PNG) just before publishing. That one
 * fact shapes everything below:
 *
 *   - No external resources. A canvas that draws an <img> whose SVG pulls in
 *     an external href, stylesheet or web font is "tainted" and toDataURL()
 *     throws a SecurityError — the poster would silently never attach. So the
 *     TEN mark is embedded as a base64 data URI and the fonts are a plain
 *     font-family stack with system fallbacks (Outfit/Inter render where they
 *     are installed, Arial where they are not, and the layout was sized so
 *     either looks intentional).
 *   - Every string that came from a person is passed through escapeXml. A
 *     headline containing "R&D" or "<3" used to break the whole document —
 *     the browser rendered a blank image and the post went out without a
 *     poster and without an error.
 *   - Text is wrapped by hand (wrap()). SVG has no automatic line breaking,
 *     and a 90-character headline on one line simply runs off the canvas.
 *
 * Four templates: opening (an internship opening), placement (a student's
 * placement), leadgen (attract freshers/students), general. Two sizes:
 * square 1200x1200 (LinkedIn's best-performing feed image) and landscape
 * 1200x627 (the link-preview ratio).
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES = ['opening', 'placement', 'leadgen', 'general'];

const BRAND = {
  name: 'The Entrepreneurship Network',
  short: 'TEN',
  site: 'https://virtualinternships.entrepreneurshipnetwork.net',
  siteLabel: 'virtualinternships.entrepreneurshipnetwork.net',
};

const COLOURS = {
  ink: '#0a0600',
  navy: '#141a2e',
  gold: '#f5c542',
  goldDeep: '#d4af37',
  white: '#ffffff',
  muted: '#c9cbd6',
  faint: '#8b90a3',
};

const FONT = 'Outfit, Inter, Arial, sans-serif';

const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'TEN_mark_white.png');

/*
 * The mark is ~107 KB on disk and ~143 KB as base64. It is read once and kept
 * for the life of the process: a poster is built on every agent turn that
 * shows a preview, and re-reading a file per keystroke is the kind of thing
 * that is invisible in development and shows up as disk waits under PM2.
 *
 * `undefined` means "not tried yet", `''` means "tried, not there". The
 * distinction matters so a missing file is not retried on every build.
 */
let logoCache;

function logoDataUri() {
  if (logoCache !== undefined) return logoCache;
  try {
    const bytes = fs.readFileSync(LOGO_PATH);
    logoCache = 'data:image/png;base64,' + bytes.toString('base64');
  } catch (e) {
    /* No mark, no image — the poster still renders with the text wordmark,
       which is better than a broken image glyph or a thrown build. */
    logoCache = '';
  }
  return logoCache;
}

/** Test seam: forget the cached mark so the missing-file path can be exercised. */
function resetLogoCache() {
  logoCache = undefined;
}

/**
 * The five characters XML cares about. Applied to every user-supplied string
 * before it is placed in the document; the base64 image data never contains
 * any of them so it is passed through untouched.
 */
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Greedy word wrap into lines of at most `maxCharsPerLine` characters.
 *
 * A single word longer than the limit is split hard rather than left to
 * overflow — a pasted URL or an unbroken product name is the usual cause, and
 * an overflowing line is cut off by the canvas edge with no warning.
 * Explicit newlines in the input start a new line.
 */
function wrap(text, maxCharsPerLine) {
  const max = Math.max(1, Math.floor(Number(maxCharsPerLine) || 1));
  const out = [];
  const paragraphs = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { if (out.length) out.push(''); continue; }
    let line = '';
    for (let word of words) {
      while (word.length > max) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, max));
        word = word.slice(max);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  /* A trailing blank from a trailing newline is never wanted on a poster. */
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/* ── layout helpers ──────────────────────────────────────────────────────── */

/*
 * Approximate glyph width as a fraction of the font size. Outfit at weight 700
 * averages a little over half an em; Arial Bold is close enough that a line
 * fitted for one does not overflow in the other.
 */
const EM_BOLD = 0.56;
const EM_REGULAR = 0.52;

function charsThatFit(widthPx, fontSize, em) {
  return Math.max(4, Math.floor(widthPx / (fontSize * em)));
}

/**
 * Pick the largest headline size whose wrapped text fits in `maxLines`. A
 * six-word headline gets the big display size; a two-sentence one steps down
 * until it fits instead of spilling into the facts block below.
 */
function fitText(text, { widthPx, sizes, maxLines, em = EM_BOLD }) {
  let chosen = null;
  for (const size of sizes) {
    const lines = wrap(text, charsThatFit(widthPx, size, em));
    chosen = { size, lines };
    if (lines.length <= maxLines) return chosen;
  }
  /* Nothing fit: keep the smallest size and truncate with an ellipsis so the
     poster is still a poster rather than a wall of overlapping text. */
  const lines = chosen.lines.slice(0, maxLines);
  if (chosen.lines.length > maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.replace(/\s*\S*$/, '').trim() + ' …';
  }
  return { size: chosen.size, lines };
}

function textEl(x, y, content, { size, fill = COLOURS.white, weight = 400, anchor = 'start', spacing = '', extra = '' } = {}) {
  const attrs = [
    `x="${x}"`, `y="${y}"`,
    `font-family="${FONT}"`, `font-size="${size}"`, `font-weight="${weight}"`, `fill="${fill}"`,
  ];
  if (anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
  if (spacing) attrs.push(`letter-spacing="${spacing}"`);
  if (extra) attrs.push(extra);
  return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

/** Lines of text, one <text> per line, returning the y just below the block. */
function textBlock(x, y, lines, opts) {
  const lineHeight = opts.lineHeight || Math.round(opts.size * 1.15);
  const parts = [];
  let cursor = y;
  for (const line of lines) {
    parts.push(textEl(x, cursor, line, opts));
    cursor += lineHeight;
  }
  return { svg: parts.join('\n'), bottom: cursor };
}

const LAYOUTS = {
  square: {
    width: 1200, height: 1200, margin: 96,
    logo: 132,
    kickerY: 150, ruleY: 176,
    headlineY: 250, headlineSizes: [88, 76, 66, 56, 48], headlineMaxLines: 3,
    subSize: 34, subMaxLines: 2,
    factLabel: 20, factValue: 34, factRow: 96, factCols: 2,
    pointSize: 36,
    /* Everything above `contentFloor` is content; the CTA line has a fixed
       slot just above the footer rule so it never collides with the facts. */
    contentFloor: 950, ctaY: 1004,
    footerRule: 1050, footerY: 1120,
  },
  landscape: {
    width: 1200, height: 627, margin: 72,
    logo: 96,
    kickerY: 108, ruleY: 130,
    headlineY: 196, headlineSizes: [60, 52, 46, 40, 34], headlineMaxLines: 2,
    subSize: 26, subMaxLines: 2,
    factLabel: 16, factValue: 26, factRow: 74, factCols: 3,
    pointSize: 26,
    contentFloor: 470, ctaY: 500,
    footerRule: 535, footerY: 585,
  },
};

const KICKERS = {
  opening: 'Internship opening',
  placement: 'Placement story',
  leadgen: 'For students and freshers',
  general: 'The Entrepreneurship Network',
};

/* ── fields ──────────────────────────────────────────────────────────────── */

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/**
 * Turn whatever the composer extracted into a complete field set for a
 * template. The headline is never empty: a poster with a blank headline is
 * the "we forgot to fill this in" look, and the deterministic default reads
 * as intentional copy.
 */
function fieldsFor(kind, extracted) {
  const e = extracted || {};
  const template = TEMPLATES.includes(kind) ? kind : 'general';
  const role = clean(e.role);
  const domain = clean(e.domain);
  const studentName = clean(e.studentName);
  const company = clean(e.company);
  const position = clean(e.position);

  if (template === 'opening') {
    return {
      headline: clean(e.headline) || (role ? `We are hiring: ${role} intern` : 'Virtual internship openings'),
      sub: clean(e.sub) || (domain ? `${domain} at ${BRAND.name}` : `Learn by doing at ${BRAND.name}`),
      role, domain,
      mode: clean(e.mode), stipend: clean(e.stipend), duration: clean(e.duration), applyBy: clean(e.applyBy),
      ctaUrl: clean(e.ctaUrl) || BRAND.site,
    };
  }
  if (template === 'placement') {
    const where = [position ? `as ${position}` : '', company ? `at ${company}` : ''].filter(Boolean).join(' ');
    return {
      headline: clean(e.headline) || (studentName ? `Congratulations, ${studentName}` : 'Another TEN intern placed'),
      sub: clean(e.sub) || (where ? `Placed ${where}` : `From a ${BRAND.short} internship to a full-time role`),
      studentName, position, company, domain,
      quote: clean(e.quote),
    };
  }
  if (template === 'leadgen') {
    const points = Array.isArray(e.points) ? e.points.map(clean).filter(Boolean).slice(0, 3) : [];
    return {
      headline: clean(e.headline) || 'Start your career with a virtual internship',
      sub: clean(e.sub) || 'Real projects, mentors and a certificate that recruiters recognise',
      points: points.length ? points : ['Work on live projects from day one', 'Mentors from industry, not slides', 'Certificate and placement support'],
      ctaUrl: clean(e.ctaUrl) || BRAND.site,
    };
  }
  return {
    headline: clean(e.headline) || BRAND.name,
    sub: clean(e.sub) || 'Internships, mentorship and placements for students across India',
  };
}

/* ── template bodies ─────────────────────────────────────────────────────── */

function factsBlock(L, y, facts) {
  const rows = facts.filter((f) => f.value);
  if (!rows.length) return { svg: '', bottom: y };
  const colWidth = Math.floor((L.width - 2 * L.margin) / L.factCols);
  const valueChars = charsThatFit(colWidth - 24, L.factValue, EM_REGULAR);
  const parts = [];
  let cursor = y;
  for (let i = 0; i < rows.length; i += L.factCols) {
    /* The row's visual bottom is the value baseline plus descenders; the
       footer band below it is not negotiable, so a row that would cross it is
       dropped rather than drawn over the wordmark. */
    if (cursor + Math.round(L.factValue * 1.3) + 12 > L.contentFloor) break;
    const slice = rows.slice(i, i + L.factCols);
    slice.forEach((f, col) => {
      const x = L.margin + col * colWidth;
      parts.push(textEl(x, cursor, f.label.toUpperCase(), { size: L.factLabel, fill: COLOURS.gold, weight: 600, spacing: '0.14em' }));
      const value = wrap(f.value, valueChars)[0] || '';
      parts.push(textEl(x, cursor + Math.round(L.factValue * 1.3), value, { size: L.factValue, fill: COLOURS.white, weight: 500 }));
    });
    cursor += L.factRow;
  }
  return { svg: parts.join('\n'), bottom: cursor };
}

function pointsBlock(L, y, points) {
  const parts = [];
  let cursor = y;
  const chars = charsThatFit(L.width - 2 * L.margin - 56, L.pointSize, EM_REGULAR);
  const lineHeight = Math.round(L.pointSize * 1.3);
  for (const point of points) {
    if (cursor + lineHeight > L.contentFloor) break;
    const lines = wrap(point, chars).slice(0, 2);
    /* A small gold disc as the bullet: it survives every font fallback,
       unlike a "•" glyph that some fallbacks draw at half size. */
    parts.push(`<circle cx="${L.margin + 10}" cy="${cursor - Math.round(L.pointSize * 0.32)}" r="8" fill="${COLOURS.gold}"/>`);
    const block = textBlock(L.margin + 44, cursor, lines, { size: L.pointSize, fill: COLOURS.white, weight: 400, lineHeight });
    parts.push(block.svg);
    cursor = block.bottom + Math.round(lineHeight * 0.35);
  }
  return { svg: parts.join('\n'), bottom: cursor };
}

function ctaLine(L, contentBottom, url) {
  /* The CTA has its own slot above the footer rule. It is only drawn when the
     content above has left it clear; a URL drawn over the last fact row is
     worse than no URL at all (the post text carries the link anyway). */
  if (!url || contentBottom > L.ctaY - Math.round(L.factValue * 1.4)) return '';
  const label = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const size = Math.round(L.factValue * 0.85);
  const chars = charsThatFit(L.width - 2 * L.margin - 200, size, EM_REGULAR);
  return [
    textEl(L.margin, L.ctaY, 'APPLY AT', { size: L.factLabel, fill: COLOURS.gold, weight: 600, spacing: '0.14em' }),
    textEl(L.margin + 140, L.ctaY, wrap(label, chars)[0] || '', { size, fill: COLOURS.white, weight: 500 }),
  ].join('\n');
}

/* ── build ───────────────────────────────────────────────────────────────── */

/**
 * Build a poster. Returns the SVG string plus its dimensions and an alt text
 * (the alt is also what the LinkedIn image gets as its accessibility label).
 */
function build({ template, fields, size = 'square' } = {}) {
  const tpl = TEMPLATES.includes(template) ? template : 'general';
  const L = LAYOUTS[size === 'landscape' ? 'landscape' : 'square'];
  const f = fieldsFor(tpl, fields || {});
  const contentWidth = L.width - 2 * L.margin;
  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" role="img" aria-label="${escapeXml(f.headline)}">`);
  parts.push(`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${COLOURS.navy}"/>
<stop offset="1" stop-color="${COLOURS.ink}"/>
</linearGradient>
<radialGradient id="glow" cx="0.85" cy="0.1" r="0.6">
<stop offset="0" stop-color="${COLOURS.gold}" stop-opacity="0.16"/>
<stop offset="1" stop-color="${COLOURS.gold}" stop-opacity="0"/>
</radialGradient>
</defs>`);
  parts.push(`<rect width="${L.width}" height="${L.height}" fill="url(#bg)"/>`);
  parts.push(`<rect width="${L.width}" height="${L.height}" fill="url(#glow)"/>`);
  /* A thin gold frame inset from the edge: the one detail that reads as
     "designed" rather than "generated" at feed size. */
  parts.push(`<rect x="24" y="24" width="${L.width - 48}" height="${L.height - 48}" fill="none" stroke="${COLOURS.goldDeep}" stroke-opacity="0.35" stroke-width="2"/>`);

  /* Mark, top-right. The PNG has an opaque white ground, so it is clipped to
     a rounded badge with a gold hairline: a rounded white card on navy reads
     as a deliberate badge, a raw white square reads as a pasted sticker. */
  const logo = logoDataUri();
  if (logo) {
    const lx = L.width - L.margin - L.logo;
    const ly = L.margin - 16;
    const r = Math.round(L.logo * 0.18);
    parts.push(`<clipPath id="mark"><rect x="${lx}" y="${ly}" width="${L.logo}" height="${L.logo}" rx="${r}"/></clipPath>`);
    parts.push(`<image href="${logo}" x="${lx}" y="${ly}" width="${L.logo}" height="${L.logo}" preserveAspectRatio="xMidYMid slice" clip-path="url(#mark)"/>`);
    parts.push(`<rect x="${lx}" y="${ly}" width="${L.logo}" height="${L.logo}" rx="${r}" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.7" stroke-width="2"/>`);
  }

  /* Kicker and rule. */
  parts.push(textEl(L.margin, L.kickerY, KICKERS[tpl].toUpperCase(), { size: L.factLabel + 2, fill: COLOURS.gold, weight: 600, spacing: '0.22em' }));
  parts.push(`<rect x="${L.margin}" y="${L.ruleY}" width="72" height="6" fill="${COLOURS.gold}"/>`);

  /* Headline. The mark sits above the headline's first baseline in both
     layouts, so the full content width is available to it. */
  const head = fitText(f.headline, { widthPx: contentWidth, sizes: L.headlineSizes, maxLines: L.headlineMaxLines });
  const headBlock = textBlock(L.margin, L.headlineY + head.size * 0.4, head.lines, {
    size: head.size, fill: COLOURS.white, weight: 700, spacing: '-0.02em', lineHeight: Math.round(head.size * 1.08),
  });
  parts.push(headBlock.svg);
  let cursor = headBlock.bottom + Math.round(L.subSize * 0.6);

  /* Sub line. */
  if (f.sub) {
    const subLines = wrap(f.sub, charsThatFit(contentWidth, L.subSize, EM_REGULAR)).slice(0, L.subMaxLines);
    const subBlock = textBlock(L.margin, cursor, subLines, { size: L.subSize, fill: COLOURS.muted, weight: 400, lineHeight: Math.round(L.subSize * 1.35) });
    parts.push(subBlock.svg);
    cursor = subBlock.bottom + Math.round(L.subSize * 1.1);
  }

  /* Template-specific body. */
  if (tpl === 'opening') {
    const facts = factsBlock(L, cursor + L.factLabel, [
      { label: 'Role', value: f.role },
      { label: 'Domain', value: f.domain },
      { label: 'Mode', value: f.mode },
      { label: 'Stipend', value: f.stipend },
      { label: 'Duration', value: f.duration },
      { label: 'Apply by', value: f.applyBy },
    ]);
    parts.push(facts.svg);
    parts.push(ctaLine(L, facts.bottom, f.ctaUrl));
  } else if (tpl === 'placement') {
    const facts = factsBlock(L, cursor + L.factLabel, [
      { label: 'Name', value: f.studentName },
      { label: 'Position', value: f.position },
      { label: 'Company', value: f.company },
      { label: 'Domain', value: f.domain },
    ]);
    parts.push(facts.svg);
    cursor = facts.bottom + 8;
    if (f.quote && cursor + L.subSize * 2 < L.contentFloor) {
      const quoteSize = Math.round(L.subSize * 0.95);
      const quoteLines = wrap(`“${f.quote}”`, charsThatFit(contentWidth, quoteSize, EM_REGULAR)).slice(0, 3);
      const quoteBlock = textBlock(L.margin, cursor + quoteSize, quoteLines, {
        size: quoteSize, fill: COLOURS.muted, weight: 400, lineHeight: Math.round(quoteSize * 1.35), extra: 'font-style="italic"',
      });
      parts.push(quoteBlock.svg);
    }
  } else if (tpl === 'leadgen') {
    const points = pointsBlock(L, cursor + L.pointSize, f.points);
    parts.push(points.svg);
    parts.push(ctaLine(L, points.bottom, f.ctaUrl));
  }

  /* Footer: rule, wordmark bottom-left, site bottom-right. */
  parts.push(`<rect x="${L.margin}" y="${L.footerRule}" width="${contentWidth}" height="2" fill="${COLOURS.gold}" fill-opacity="0.45"/>`);
  parts.push(textEl(L.margin, L.footerY, BRAND.short, { size: Math.round(L.factValue * 1.5), fill: COLOURS.gold, weight: 800, spacing: '0.06em' }));
  parts.push(textEl(L.margin, L.footerY + Math.round(L.factLabel * 1.7), BRAND.name, { size: L.factLabel, fill: COLOURS.muted, weight: 500, spacing: '0.08em' }));
  parts.push(textEl(L.width - L.margin, L.footerY, BRAND.siteLabel, { size: L.factLabel + 2, fill: COLOURS.muted, weight: 500, anchor: 'end' }));

  parts.push('</svg>');

  const alt = altFor(tpl, f);
  return { svg: parts.join('\n'), width: L.width, height: L.height, template: tpl, alt, fields: f };
}

function altFor(tpl, f) {
  const bits = [f.headline, f.sub];
  if (tpl === 'opening') bits.push([f.role, f.domain, f.mode, f.stipend, f.duration, f.applyBy ? `apply by ${f.applyBy}` : ''].filter(Boolean).join(', '));
  if (tpl === 'placement') bits.push([f.studentName, f.position, f.company].filter(Boolean).join(', '));
  if (tpl === 'leadgen') bits.push((f.points || []).join('; '));
  bits.push(BRAND.name);
  return bits.filter(Boolean).join('. ').slice(0, 300);
}

module.exports = { TEMPLATES, build, fieldsFor, wrap, escapeXml, logoDataUri, resetLogoCache, BRAND, COLOURS };
