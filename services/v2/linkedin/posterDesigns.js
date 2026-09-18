'use strict';

/**
 * The poster gallery: six ways to put one sentence on a picture.
 *
 * The flow this exists for is deliberately short. Somebody types a single
 * line — "We are hiring Python developers" — and instead of being asked to
 * describe a design they will never be able to describe, they are shown six
 * finished posters with their own sentence already set in each one. They
 * click the one they like. That is the whole interaction.
 *
 * So every design here has to survive being seen at thumbnail size next to
 * five others and still be told apart. That ruled out the obvious approach of
 * one layout in six colourways, which at 180 pixels wide is one poster shown
 * six times. Each of these instead changes the thing that reads first: the
 * ground (dark, gold, paper), the type's weight and scale, where the eye
 * lands, and what the decoration is made of. Squint at the six and you should
 * still be able to name them.
 *
 * What they share is the part that must not vary: the mark, the site, and
 * gold on near-black as the company's colours. A gallery whose members share
 * nothing is not a gallery, it is six posters from six companies.
 *
 * Everything is a pure string. No canvas, no fonts to load, no network — the
 * browser rasterises the chosen SVG to PNG at publish time, and an SVG that
 * reached outside itself for a font or an image would rasterise blank.
 */

const {
  COLOURS, BRAND, escapeXml, wrap, logoDataUri,
} = require('./posterStudio');
const glyphs = require('./domainGlyphs');

const FONT = 'Outfit, Inter, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* Advance width per character, as a fraction of the font size. Used to decide
   how many characters fit a line before anything is drawn — the only way to
   size text without a text-measuring API. */
const EM_BOLD = 0.56;
const EM_BLACK = 0.60;
const EM_REGULAR = 0.52;
/* Capitals are wider than the mixed-case average the figures above describe,
   because the average is mostly lower-case: in Arial Bold a cap runs about
   0.67 to 0.72 em against an 'i' at 0.28. The kicker is the one string set
   entirely in capitals, and measuring it with EM_BOLD under-read a
   twenty-five character strap-line by nearly forty pixels. */
const EM_CAPS = 0.68;

const SIZE = { width: 1200, height: 1200 };

/* ── shared helpers ─────────────────────────────────────────────────────── */

function charsThatFit(widthPx, fontSize, em) {
  return Math.max(6, Math.floor(widthPx / (fontSize * em)));
}

/**
 * The largest size from `sizes` at which `text` fits inside `maxLines`.
 *
 * Posters break when a long sentence is set at the size a short one wanted,
 * so the size is chosen from the text rather than fixed by the design. If
 * nothing fits, the smallest size is kept and the tail is elided: a poster
 * with an ellipsis is still a poster, a poster with overlapping lines is a
 * bug somebody publishes.
 */
function fit(text, { widthPx, sizes, maxLines, em = EM_BOLD }) {
  let chosen = null;
  for (let i = 0; i < sizes.length; i += 1) {
    const lines = wrap(text, charsThatFit(widthPx, sizes[i], em));
    chosen = { size: sizes[i], lines };
    if (lines.length <= maxLines) return chosen;
  }
  const lines = chosen.lines.slice(0, maxLines);
  if (chosen.lines.length > maxLines) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '').trim()} …`;
  }
  return { size: chosen.size, lines };
}

function text(x, y, content, o) {
  const opts = o || {};
  const attrs = [
    `x="${x}"`, `y="${y}"`,
    `font-family="${opts.font || FONT}"`,
    `font-size="${opts.size}"`,
    `font-weight="${opts.weight || 400}"`,
    `fill="${opts.fill || COLOURS.white}"`,
  ];
  if (opts.anchor) attrs.push(`text-anchor="${opts.anchor}"`);
  if (opts.spacing) attrs.push(`letter-spacing="${opts.spacing}"`);
  if (opts.opacity) attrs.push(`fill-opacity="${opts.opacity}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

function block(x, y, lines, o) {
  const lineHeight = o.lineHeight || Math.round(o.size * 1.12);
  const out = [];
  let cursor = y;
  for (let i = 0; i < lines.length; i += 1) {
    out.push(text(x, cursor, lines[i], o));
    cursor += lineHeight;
  }
  return { svg: out.join('\n'), bottom: cursor - lineHeight };
}

/**
 * The TEN mark as a rounded badge.
 *
 * The PNG has an opaque white ground, so it is clipped to a rounded rectangle
 * with a hairline: a white card reads as a deliberate badge, a raw white
 * square reads as a sticker somebody pasted on. When the file is missing the
 * badge is simply absent — a poster without a logo beats no poster at all.
 */
function mark(x, y, size, ring) {
  const logo = logoDataUri();
  if (!logo) return '';
  const r = Math.round(size * 0.18);
  const id = `m${x}${y}${size}`;
  return [
    `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>`,
    `<image href="${logo}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`,
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="none" stroke="${ring || COLOURS.gold}" stroke-opacity="0.7" stroke-width="2"/>`,
  ].join('\n');
}

/**
 * The domain glyph, as markup to be appended to a neighbouring element.
 *
 * It returns markup to *concatenate*, not an entry to push into the parts
 * array, and that is deliberate. Every design is `[...].join('\n')`, so an
 * empty entry would still contribute a newline and the six posters would all
 * change the day this feature landed — a diff nobody asked for on every
 * poster the company has ever previewed. Concatenating an empty string onto
 * an existing element leaves the document byte for byte as it was, which is
 * the promise this whole feature is built on: no glyph, no change.
 */
function glyphAt(glyph, x, y, size, opts) {
  if (!glyph) return '';
  const o = opts || {};
  return `\n${glyphs.draw({
    id: glyph.id, x, y, size, tint: o.tint, opacity: o.opacity,
  })}`;
}

/**
 * Where the kicker's last character lands.
 *
 * There is no text-measuring API here, so the glyph that sits beside the
 * kicker is placed with an em estimate plus the letter-spacing the kicker is
 * set with — spacing that is a fifth of the size is not a rounding error, and
 * leaving it out put the glyph on top of the last two words of "For students
 * and freshers".
 *
 * The estimate is EM_CAPS and not the EM_BOLD the headline fitter uses,
 * because the kicker is drawn `.toUpperCase()`. Measuring capitals with the
 * mixed-case figure is not a near miss: "FOR STUDENTS AND FRESHERS" really
 * ends around x=563 and EM_BOLD called it 525, so the mark was placed nine
 * pixels *inside* the final S instead of the twenty-eight clear of it that
 * the caller asks for. Under-reading is the dangerous direction here — a
 * glyph a little further out is a wider gap, a glyph a little too close is
 * two things printed on top of each other.
 */
function kickerEnd(kicker, size, spacingEm) {
  return 96 + Math.ceil(String(kicker).length * size * (EM_CAPS + spacingEm));
}

function open(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" height="${SIZE.height}" viewBox="0 0 ${SIZE.width} ${SIZE.height}" role="img" aria-label="${escapeXml(label)}">`;
}

/** The site, bottom-left, in every design. It is the one call to action. */
function footer(colour, opacity) {
  return text(96, 1130, BRAND.site.replace(/^https?:\/\//, ''), {
    size: 26, fill: colour, weight: 500, spacing: '0.04em', opacity: opacity || '0.75',
  });
}

/* ── the six designs ────────────────────────────────────────────────────── */

/*
 * Each renderer takes { line, kicker, glyph } and returns an SVG string.
 * `line` is the author's sentence, verbatim — the whole point of the gallery
 * is that their words end up on the picture, so no design paraphrases,
 * truncates by choice, or adds a sentence of its own.
 *
 * `glyph` is the domain mark, or null when the sentence is not about a
 * domain, which is the common case. Each design places it where that design
 * already had somewhere for it to go: beside the kicker, behind the bars, in
 * the wedge, in place of the dot. It is explicitly *not* one badge dropped in
 * the same corner of all six — six posters that differ only by a corner badge
 * are one poster, and the gallery exists to be told apart at thumbnail size.
 */

/** 1. Midnight — navy to black, gold hairline, editorial and quiet. */
function midnight({ line, kicker, glyph }) {
  const head = fit(line, { widthPx: 1008, sizes: [92, 80, 68, 58, 48], maxLines: 4 });
  const body = block(96, 380, head.lines, {
    size: head.size, weight: 700, spacing: '-0.02em', lineHeight: Math.round(head.size * 1.08),
  });
  return [
    open(line),
    `<defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${COLOURS.navy}"/><stop offset="1" stop-color="${COLOURS.ink}"/></linearGradient>
<radialGradient id="mgl" cx="0.85" cy="0.08" r="0.6">
<stop offset="0" stop-color="${COLOURS.gold}" stop-opacity="0.18"/><stop offset="1" stop-color="${COLOURS.gold}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="1200" height="1200" fill="url(#mg)"/>`,
    `<rect width="1200" height="1200" fill="url(#mgl)"/>`,
    `<rect x="24" y="24" width="1152" height="1152" fill="none" stroke="${COLOURS.goldDeep}" stroke-opacity="0.35" stroke-width="2"/>`,
    mark(972, 80, 132),
    /* The glyph sits on the kicker's own line, after the words: Midnight is
       the editorial one, and a mark that shares the strap-line's baseline
       reads as part of the sentence rather than as an applied sticker. */
    text(96, 150, kicker.toUpperCase(), { size: 22, fill: COLOURS.gold, weight: 600, spacing: '0.22em' })
      + glyphAt(glyph, kickerEnd(kicker, 22, 0.22) + 28, 106, 72),
    `<rect x="96" y="176" width="72" height="6" fill="${COLOURS.gold}"/>`,
    body.svg,
    `<rect x="96" y="1060" width="1008" height="1" fill="${COLOURS.gold}" fill-opacity="0.3"/>`,
    footer(COLOURS.muted),
    '</svg>',
  ].join('\n');
}

/** 2. Solar — a gold field and black slab type. The loudest of the six. */
function solar({ line, kicker, glyph }) {
  const head = fit(line, { widthPx: 1008, sizes: [104, 90, 78, 66, 54], maxLines: 4, em: EM_BLACK });
  const body = block(96, 400, head.lines, {
    size: head.size, weight: 800, fill: COLOURS.ink, spacing: '-0.03em', lineHeight: Math.round(head.size * 1.04),
  });
  return [
    open(line),
    `<defs><linearGradient id="sg" x1="0" y1="0" x2="0.3" y2="1">
<stop offset="0" stop-color="#ffd75e"/><stop offset="1" stop-color="${COLOURS.goldDeep}"/></linearGradient></defs>`,
    /* On the loudest design the glyph is not an icon, it is the ground: huge,
       bottom-left, and at a tenth of an opacity so it is a watermark in the
       gold rather than a second thing to read. It is emitted with the
       background, before the bars and long before the type, so everything
       else in the poster paints over it. */
    `<rect width="1200" height="1200" fill="url(#sg)"/>`
      + glyphAt(glyph, 40, 700, 380, { tint: COLOURS.ink, opacity: 0.12 }),
    /* Three heavy bars bottom-right: the only ornament, and it is made of the
       same rectangle the rule is, so it reads as system rather than clip-art. */
    `<rect x="840" y="980" width="264" height="18" fill="${COLOURS.ink}" fill-opacity="0.9"/>`,
    `<rect x="900" y="1014" width="204" height="18" fill="${COLOURS.ink}" fill-opacity="0.55"/>`,
    `<rect x="960" y="1048" width="144" height="18" fill="${COLOURS.ink}" fill-opacity="0.25"/>`,
    mark(972, 80, 132, COLOURS.ink),
    text(96, 150, kicker.toUpperCase(), { size: 22, fill: COLOURS.ink, weight: 700, spacing: '0.22em', opacity: '0.72' }),
    `<rect x="96" y="176" width="120" height="8" fill="${COLOURS.ink}"/>`,
    body.svg,
    footer(COLOURS.ink, '0.7'),
    '</svg>',
  ].join('\n');
}

/** 3. Split — a diagonal cut, type across the join. Movement. */
function split({ line, kicker, glyph }) {
  const head = fit(line, { widthPx: 1008, sizes: [88, 76, 64, 54, 46], maxLines: 4 });
  const body = block(96, 420, head.lines, {
    size: head.size, weight: 700, spacing: '-0.02em', lineHeight: Math.round(head.size * 1.08),
  });
  return [
    open(line),
    `<rect width="1200" height="1200" fill="${COLOURS.ink}"/>`,
    /* The gold wedge. Its edge runs through the headline block, so the type
       sits on both grounds at once — that tension is the design. */
    `<path d="M0 1200 L1200 720 L1200 1200 Z" fill="${COLOURS.gold}" fill-opacity="0.92"/>`,
    /* Inside the wedge, drawn in ink because that region is gold. The
       coordinates are chosen against the wedge's own edge (y = 1200 - x*0.4):
       at x=850 the gold starts at y=860, so a 150-unit box dropped at y=930
       cannot poke out onto the black and leave a dark mark on dark ground. */
    `<path d="M0 1200 L1200 720 L1200 760 L0 1200 Z" fill="${COLOURS.white}" fill-opacity="0.16"/>`
      + glyphAt(glyph, 850, 930, 150, { tint: COLOURS.ink, opacity: 0.85 }),
    mark(972, 80, 132),
    text(96, 150, kicker.toUpperCase(), { size: 22, fill: COLOURS.gold, weight: 600, spacing: '0.22em' }),
    `<rect x="96" y="176" width="72" height="6" fill="${COLOURS.gold}"/>`,
    body.svg,
    /*
     * The URL is set on the dark ground, not the wedge.
     *
     * The wedge rises from the bottom-left corner, so at the left margin its
     * edge is only about forty pixels from the foot of the poster — a line of
     * dark type placed there for "on gold" landed on near-black instead and
     * was invisible. Keeping it light and above the join is legible whatever
     * the headline length does to the composition.
     */
    text(96, 1112, BRAND.site.replace(/^https?:\/\//, ''), { size: 26, fill: COLOURS.muted, weight: 500, spacing: '0.04em' }),
    '</svg>',
  ].join('\n');
}

/** 4. Paper — off-white and navy. In a dark feed, light is the loud choice. */
function paper({ line, kicker, glyph }) {
  const head = fit(line, { widthPx: 1008, sizes: [90, 78, 66, 56, 48], maxLines: 4 });
  const body = block(96, 400, head.lines, {
    size: head.size, weight: 700, fill: '#12182b', spacing: '-0.02em', lineHeight: Math.round(head.size * 1.1),
  });
  return [
    open(line),
    `<rect width="1200" height="1200" fill="#f4f1ea"/>`,
    /* A single gold dot above the kicker, and a hairline under the headline.
       Restraint is the point: the whole design is two marks and the type.
       The glyph does not join them, it *replaces* the dot — on a design whose
       argument is that it has two marks, adding a third is the one change
       that would break it. Same centre, same colour, so the composition below
       never moves. */
    glyph
      ? glyphs.draw({ id: glyph.id, x: 74, y: 82, size: 60, tint: COLOURS.goldDeep })
      : `<circle cx="104" cy="112" r="10" fill="${COLOURS.goldDeep}"/>`,
    mark(972, 80, 132, COLOURS.goldDeep),
    text(96, 176, kicker.toUpperCase(), { size: 22, fill: '#6b6455', weight: 600, spacing: '0.22em' }),
    body.svg,
    `<rect x="96" y="${Math.min(1040, body.bottom + 56)}" width="1008" height="2" fill="${COLOURS.goldDeep}" fill-opacity="0.45"/>`,
    text(96, 1130, BRAND.site.replace(/^https?:\/\//, ''), { size: 26, fill: '#6b6455', weight: 500, spacing: '0.04em' }),
    '</svg>',
  ].join('\n');
}

/** 5. Spotlight — centred, a pool of light. For anything being celebrated. */
function spotlight({ line, kicker, glyph }) {
  const head = fit(line, { widthPx: 920, sizes: [86, 74, 64, 54, 46], maxLines: 4 });
  const lineH = Math.round(head.size * 1.12);
  const start = 600 - ((head.lines.length - 1) * lineH) / 2;
  const body = block(600, start, head.lines, {
    size: head.size, weight: 700, anchor: 'middle', spacing: '-0.02em', lineHeight: lineH,
  });
  return [
    open(line),
    `<defs><radialGradient id="sp" cx="0.5" cy="0.42" r="0.62">
<stop offset="0" stop-color="#1c2340"/><stop offset="0.55" stop-color="#0d1020"/><stop offset="1" stop-color="${COLOURS.ink}"/></radialGradient>
<radialGradient id="spg" cx="0.5" cy="0.42" r="0.42">
<stop offset="0" stop-color="${COLOURS.gold}" stop-opacity="0.2"/><stop offset="1" stop-color="${COLOURS.gold}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="1200" height="1200" fill="url(#sp)"/>`,
    `<rect width="1200" height="1200" fill="url(#spg)"/>`,
    /* A ring rather than a frame: it echoes the light instead of boxing it. */
    `<circle cx="600" cy="504" r="430" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.22" stroke-width="2"/>`,
    /* Centred, in the gap the mark and the kicker already leave between them
       (the mark ends at y=252, the kicker's caps start at about y=304), so
       the glyph joins the vertical stack on the poster's axis instead of
       breaking the symmetry that is the whole design. */
    mark(534, 120, 132) + glyphAt(glyph, 574, 252, 52),
    text(600, 320, kicker.toUpperCase(), { size: 22, fill: COLOURS.gold, weight: 600, spacing: '0.24em', anchor: 'middle' }),
    body.svg,
    `<rect x="540" y="1000" width="120" height="4" fill="${COLOURS.gold}"/>`,
    text(600, 1130, BRAND.site.replace(/^https?:\/\//, ''), { size: 26, fill: COLOURS.muted, weight: 500, spacing: '0.04em', anchor: 'middle' }),
    '</svg>',
  ].join('\n');
}

/** 6. Blueprint — a faint grid and monospaced labels. Reads as engineering. */
function blueprint({ line, kicker, glyph }) {
  const head = fit(line, { widthPx: 1008, sizes: [84, 72, 62, 52, 44], maxLines: 4 });
  const body = block(96, 440, head.lines, {
    size: head.size, weight: 700, spacing: '-0.015em', lineHeight: Math.round(head.size * 1.1),
  });
  return [
    open(line),
    `<defs><pattern id="bp" width="60" height="60" patternUnits="userSpaceOnUse">
<path d="M60 0 L0 0 0 60" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.07" stroke-width="1"/></pattern></defs>`,
    `<rect width="1200" height="1200" fill="#080b16"/>`,
    `<rect width="1200" height="1200" fill="url(#bp)"/>`,
    /* Corner ticks instead of a frame: the drawing-sheet reference that gives
       the design its name, and four rectangles rather than an imported glyph. */
    `<rect x="64" y="64" width="56" height="2" fill="${COLOURS.gold}" fill-opacity="0.6"/>`,
    `<rect x="64" y="64" width="2" height="56" fill="${COLOURS.gold}" fill-opacity="0.6"/>`,
    `<rect x="1080" y="1134" width="56" height="2" fill="${COLOURS.gold}" fill-opacity="0.6"/>`,
    `<rect x="1134" y="1080" width="2" height="56" fill="${COLOURS.gold}" fill-opacity="0.6"/>`,
    /* Top-right, under the mark and flush with its right edge, held back to
       a little over half opacity. On a sheet of drawing paper the marks in
       that corner are annotations, not illustrations — a glyph at full
       strength there would outshout the headline it is annotating. */
    mark(972, 80, 132) + glyphAt(glyph, 1040, 240, 64, { opacity: 0.6 }),
    text(96, 150, `// ${kicker.toUpperCase()}`, { size: 20, fill: COLOURS.gold, weight: 500, spacing: '0.16em', font: MONO }),
    `<rect x="96" y="180" width="1008" height="1" fill="${COLOURS.gold}" fill-opacity="0.25"/>`,
    body.svg,
    text(96, 1130, BRAND.site.replace(/^https?:\/\//, ''), { size: 24, fill: COLOURS.faint, weight: 400, spacing: '0.06em', font: MONO }),
    '</svg>',
  ].join('\n');
}

/**
 * The gallery, in the order it is offered.
 *
 * Midnight leads because it is the house style and the safest choice for
 * anything routine; Solar is second because it is the one people reach for
 * when a post has to stop a scroll. `note` is what the chooser shows under
 * each thumbnail — a person picking between six pictures deserves a word
 * about what each is for.
 */
const DESIGNS = [
  { id: 'midnight', name: 'Midnight', note: 'Navy and gold. The house style.', render: midnight },
  { id: 'solar', name: 'Solar', note: 'Gold field, black type. Loud.', render: solar },
  { id: 'split', name: 'Split', note: 'Diagonal cut. Movement.', render: split },
  { id: 'paper', name: 'Paper', note: 'Light ground. Stands out in the feed.', render: paper },
  { id: 'spotlight', name: 'Spotlight', note: 'Centred, lit. For celebrations.', render: spotlight },
  { id: 'blueprint', name: 'Blueprint', note: 'Grid and monospace. Technical.', render: blueprint },
];

const DESIGN_IDS = DESIGNS.map((d) => d.id);

/* Which design leads for which kind of post. A placement is a celebration, so
   Spotlight goes first; an opening wants to be seen, so Solar does. The rest
   of the gallery still follows — this reorders, it never hides. */
const PREFERRED = {
  placement: ['spotlight', 'midnight', 'solar', 'paper', 'split', 'blueprint'],
  opening: ['solar', 'midnight', 'split', 'blueprint', 'paper', 'spotlight'],
  leadgen: ['split', 'paper', 'solar', 'midnight', 'spotlight', 'blueprint'],
  general: ['midnight', 'paper', 'solar', 'spotlight', 'split', 'blueprint'],
};

const KICKERS = {
  opening: 'Internship opening',
  placement: 'Placement story',
  leadgen: 'For students and freshers',
  general: BRAND.short,
};

/**
 * The sentence that goes on the poster.
 *
 * A poster is not a post: the body of a LinkedIn update can run to a
 * paragraph, and a paragraph set at 90 points is unreadable at any size. So
 * the first sentence (or the first line) is what the picture carries, and the
 * rest of the post carries the detail. The author's words are used exactly —
 * only the selection is ours.
 */
function headlineFrom(source) {
  const raw = String(source == null ? '' : source).replace(/\r\n?/g, '\n').trim();
  if (!raw) return '';

  const firstLine = raw.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  /* A hashtag-only or link-only opening line is not a headline. */
  const usable = /^#|^https?:\/\//i.test(firstLine)
    ? (raw.split('\n').map((l) => l.trim()).find((l) => l && !/^#|^https?:\/\//i.test(l)) || firstLine)
    : firstLine;

  if (usable.length <= 120) return usable;
  const sentence = usable.split(/(?<=[.!?])\s+/)[0] || usable;
  if (sentence.length <= 160) return sentence;
  return `${sentence.slice(0, 157).replace(/\s+\S*$/, '')}…`;
}

/**
 * Render one design.
 *
 * @param {object} args
 * The domain glyph is looked up from the whole source, not from the headline
 * the poster ends up carrying. "We are hiring. Python interns, six weeks."
 * puts the domain in the second sentence, and matching only the first would
 * have thrown away the one word that tells us what the picture is about.
 *
 * @param {object} args
 * @param {string} args.design  a design id; anything unknown falls back to the house style
 * @param {string} args.line    the author's sentence
 * @param {string} [args.kind]  which kicker to print
 * @returns {{id, name, note, svg, width, height, alt, line, glyph}}
 */
function renderDesign({ design, line, kind } = {}) {
  const chosen = DESIGNS.filter((d) => d.id === design)[0] || DESIGNS[0];
  const headline = headlineFrom(line);
  const kicker = KICKERS[kind] || KICKERS.general;
  const glyph = glyphs.glyphFor(line);
  const svg = chosen.render({ line: headline, kicker, glyph });
  return {
    id: chosen.id,
    name: chosen.name,
    note: chosen.note,
    svg,
    width: SIZE.width,
    height: SIZE.height,
    line: headline,
    glyph: glyph ? glyph.id : null,
    alt: `${kicker}: ${headline} — ${BRAND.name}`,
  };
}

/**
 * The posters to offer for this draft, already carrying the author's line.
 *
 * Returns every design by default, best-suited first. They are rendered up
 * front rather than on demand because the chooser shows all of them at once,
 * and a gallery that fills in one thumbnail at a time looks broken.
 */
function suggest({ line, kind, count } = {}) {
  const order = PREFERRED[kind] || PREFERRED.general;
  const n = Number.isFinite(count) ? Math.max(1, Math.min(DESIGNS.length, Math.floor(count))) : DESIGNS.length;
  return order.slice(0, n).map((id) => renderDesign({ design: id, line, kind }));
}

module.exports = {
  DESIGNS, DESIGN_IDS, PREFERRED, KICKERS, SIZE,
  suggest, renderDesign, headlineFrom,
};
