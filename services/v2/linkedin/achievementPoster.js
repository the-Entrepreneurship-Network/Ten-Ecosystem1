'use strict';

/**
 * The achievement poster — one person, their photograph, their numbers.
 *
 * The client showed us a student-profile poster and said "exactly in this
 * format": a figure photographed against a dark ground with a warm burst
 * behind them, their name in gold at the lower left, three stat lines stacked
 * at the right, and a headline underneath naming what they were selected for.
 * It is not a design brief so much as a shape, and the shape is the product:
 * the same picture, every time, with a different person in it.
 *
 * Which means the only interesting decisions in this file are about what
 * happens when the inputs are not what the shape expects:
 *
 *   1. The picture carries facts, never prose. "65+ merged PRs" belongs on a
 *      poster; "an incredible journey of growth" belongs in the post text,
 *      where it can be read and skipped. So every slot here is short, and the
 *      ones that are not short are fitted down or elided rather than allowed
 *      to run into the slot below. A generated poster with two lines of type
 *      written through each other is the one failure nobody forgives, because
 *      it goes out under a real person's name.
 *
 *   2. Every image is untrusted. The photograph and both logos arrive as
 *      `data:` URIs pasted by a browser, which means they eventually come from
 *      whatever the staff member had in their clipboard. A poster is not the
 *      place to discover somebody supplied a PDF, a `javascript:` string, or
 *      five megabytes of camera original. Anything this module cannot verify
 *      is refused and replaced with the text it stands for — initials for a
 *      face, a name for a logo — and the refusal is reported back in the
 *      result so the agent can say "I could not read that logo, so I printed
 *      the name instead" instead of the author finding out in the feed.
 *
 *   3. The document is self-contained. It is rasterised in the browser through
 *      <img> into <canvas>, and an SVG that reaches outside itself for a font,
 *      a stylesheet or an image taints the canvas: toDataURL() throws and the
 *      post goes out with no picture at all. So there are no external hrefs,
 *      the fonts are a plain family stack with system fallbacks, and the burst
 *      behind the figure is drawn as paths rather than imported as artwork.
 *
 *   4. Every id is unique per render. Six posters can appear on one chooser
 *      page at once, and two <clipPath> elements sharing an id leave the
 *      second poster wearing the first one's crop — a bug that only shows up
 *      in the gallery, never in a single-poster test. Ids therefore carry a
 *      caller-supplied `uid`, or a hash of the inputs when the caller did not
 *      supply one.
 *
 * There is deliberately no domain glyph here. The slot a glyph would occupy —
 * a mark on the dark ground beside the figure — belongs to the organisation
 * the person was selected for, and a generic "software" icon standing where a
 * reader expects a company would be read as that company's logo.
 */

const {
  COLOURS, BRAND, escapeXml, wrap, logoDataUri,
} = require('./posterStudio');

const FONT = 'Outfit, Inter, Arial, sans-serif';

/* Advance width per character as a fraction of the font size — the same
   constants posterDesigns.js fits its headlines with, copied rather than
   imported so this module depends only on posterStudio. The gallery and this
   poster are built on the same agent turn, and a require cycle between them
   would surface as a half-initialised module rather than as a loud error. */
const EM_BOLD = 0.56;
const EM_BLACK = 0.60;
const EM_REGULAR = 0.52;

/**
 * Four numbers, and then stop.
 *
 * The reference carries three. Four still reads as a column; the fifth turns
 * a stack of claims into a table of contents, and the values shrink to the
 * size of the labels. Anything past the cap is dropped and reported, so the
 * agent can put the rest in the post text where there is room for them.
 */
const MAX_STATS = 4;

/*
 * The ceilings, measured on the data URI string rather than on decoded bytes.
 *
 * Measuring the string is the cheap honest check: it is the thing that will be
 * concatenated into the document, and base64 runs about a third larger than
 * the bytes it carries, so these limits are conservative in the direction that
 * matters. Three megabytes of photograph is already far more than a figure
 * needs at 744 pixels across; above it the usual cause is a camera original,
 * and building a thirty-megabyte string hangs the tab that has to rasterise
 * it. Logos get a tighter limit because a logo that large is not a logo.
 */
const MAX_PHOTO_CHARS = 3 * 1024 * 1024;
const MAX_LOGO_CHARS = 2 * 1024 * 1024;

/*
 * The accepted grammars, split head from body so neither half has to scan a
 * multi-megabyte string more than once.
 *
 * Photographs are raster only. `image/svg+xml` is absent on purpose: a
 * photograph is never an SVG, and an SVG nested in an SVG is a document with
 * its own hrefs and its own stylesheet — exactly the external reference this
 * poster must not contain.
 *
 * Logos may be SVG because real logos usually are, and an SVG referenced from
 * an <image> element is rendered in the browser's secure static mode: no
 * script, no external loads, no interactivity. That is the same protection the
 * whole poster relies on, so allowing it here widens nothing.
 *
 * Only standard base64 is accepted in either case — no percent-encoded
 * payloads — and that restriction is also what makes the value safe to drop
 * straight into an attribute, because the base64 alphabet contains none of the
 * five characters XML cares about.
 */
const PHOTO_HEAD = /^data:image\/(?:png|jpe?g|webp);base64,/i;
const LOGO_HEAD = /^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/*
 * The two shapes this poster is offered in. The link-preview landscape
 * (1200x627) is not among them: a standing figure in 627 pixels of height is a
 * photograph of a head, and the stat column has nowhere to stack. A caller
 * asking for anything else gets the square, and the shape it actually got is
 * reported back in the result.
 */
const SIZES = {
  square: { id: 'square', width: 1200, height: 1200 },
  portrait: { id: 'portrait', width: 1080, height: 1350 },
};

const DEFAULTS = {
  kicker: 'The next generation',
  /* The reference calls its series "Humans of <company>". The format is the
     thing we were asked to match, so the format survives and the identity is
     swapped — the client's own words: "you have to just change the company
     name, the company logo, and everything, but the format will be the same." */
  series: `Humans of ${BRAND.short}`,
  footerNote: `${BRAND.short} | CLASS OF BUILDERS`,
};

/* ── small helpers, in the house style of posterDesigns.js ───────────────── */

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/* Geometry reaches the document as attribute text, so it is rounded here.
   `scale(0.5600000000000001)` is valid SVG and unreadable in a diff, and a NaN
   from a bad input produces an attribute the renderer rejects outright — which
   is a blank poster rather than a wrong one. */
function n(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function charsThatFit(widthPx, fontSize, em) {
  return Math.max(4, Math.floor(widthPx / (fontSize * em)));
}

/**
 * The largest size from `sizes` at which `value` fits inside `maxLines`.
 *
 * The size is chosen from the text rather than fixed by the design, because
 * "SELECTED FOR ANTHROPIC'S OPEN SOURCE PROGRAM" and "HIRED" are the same slot
 * and cannot be the same size. If nothing fits, the smallest size is kept and
 * the tail is elided: a poster with an ellipsis is still a poster, a poster
 * with overlapping lines is a bug somebody publishes.
 */
function fit(value, { widthPx, sizes, maxLines, em = EM_BOLD }) {
  let chosen = null;
  for (let i = 0; i < sizes.length; i += 1) {
    const lines = wrap(value, charsThatFit(widthPx, sizes[i], em));
    chosen = { size: sizes[i], lines };
    if (lines.length <= maxLines) return chosen;
  }
  const lines = chosen.lines.slice(0, maxLines);
  if (chosen.lines.length > maxLines) {
    /*
     * Drop the trailing word — but only when a word survives dropping it.
     * /\s*\S*$/ matches the *whole* string when the kept line has no internal
     * space, which is exactly the case a long single-token name produces:
     * "Venkatanarasimharajuvaripeta Rao" wraps to two lines, the first of them
     * one 28-character word, and the naive replace left the slot rendering as
     * a bare " …" under the person's own poster. A token with nowhere to break
     * is therefore cut mid-word instead, the same rule clip() already uses.
     */
    const line = lines[maxLines - 1];
    const kept = line.replace(/\s*\S*$/, '').trim();
    lines[maxLines - 1] = kept
      ? `${kept} …`
      : `${line.slice(0, Math.max(1, line.length - 1))}…`;
  }
  return { size: chosen.size, lines };
}

/**
 * One line cut to the width it has been given.
 *
 * A stat label and a subtitle get one line and no more, so this elides rather
 * than wraps. The whole trailing word is dropped when doing so still leaves
 * half a line — "Backend intern, class…" reads better than "Backend intern, c…"
 * — but a single unbroken token is cut mid-word, because dropping the only
 * word would leave an empty slot.
 */
function clip(value, widthPx, fontSize, em) {
  const source = clean(value);
  const max = charsThatFit(widthPx, fontSize, em);
  if (!source || source.length <= max) return source;
  const cut = source.slice(0, Math.max(1, max - 1));
  const whole = cut.replace(/\s+\S*$/, '').trim();
  return `${whole.length >= Math.ceil(max / 2) ? whole : cut.trim()}…`;
}

function text(x, y, content, o) {
  const opts = o || {};
  const attrs = [
    `x="${n(x)}"`, `y="${n(y)}"`,
    `font-family="${opts.font || FONT}"`,
    `font-size="${n(opts.size)}"`,
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
  return { svg: out.join('\n'), bottom: cursor - lineHeight, top: y - o.size };
}

/* ── the untrusted part ─────────────────────────────────────────────────── */

/**
 * The photograph, or '' if it is not one.
 *
 * Everything this rejects has been seen in some form: a `javascript:` URI
 * pasted into a text field, an `http://` link to somebody's profile picture
 * (which would taint the canvas and lose the whole image, not just the face),
 * a PDF from a file picker with no accept filter, and an SVG that could carry
 * a stylesheet. The function is a whitelist on purpose: anything it does not
 * recognise is not a photograph, and a face it cannot verify becomes initials.
 */
function safePhoto(value) {
  if (typeof value !== 'string') return '';
  const uri = value.trim();
  if (!uri || uri.length > MAX_PHOTO_CHARS) return '';
  const head = PHOTO_HEAD.exec(uri);
  if (!head) return '';
  const body = uri.slice(head[0].length);
  /* An empty payload passes the head test and renders as a broken-image glyph
     on the company's proudest post, so the body is checked for content as well
     as for alphabet. */
  if (!body || !BASE64_BODY.test(body)) return '';
  return uri;
}

/** The same check for an uploaded logo, one type wider and one megabyte smaller. */
function safeLogo(value) {
  if (typeof value !== 'string') return '';
  const uri = value.trim();
  if (!uri || uri.length > MAX_LOGO_CHARS) return '';
  const head = LOGO_HEAD.exec(uri);
  if (!head) return '';
  const body = uri.slice(head[0].length);
  if (!body || !BASE64_BODY.test(body)) return '';
  return uri;
}

/**
 * The initials that stand in for a missing photograph.
 *
 * First and last word, so "Priya Anand Sharma" is PS rather than PA. The name
 * is walked with Array.from because indexing a string by [0] returns half of
 * any character outside the basic plane, and half a character renders as a
 * replacement box two hundred pixels tall.
 */
function initialsFor(name) {
  const words = clean(name).split(' ').filter(Boolean);
  if (!words.length) return '';
  const first = Array.from(words[0])[0] || '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] || '') : '';
  return (first + last).toUpperCase();
}

/**
 * The prefix every minted id carries.
 *
 * A caller that renders more than one poster into a page passes its own `uid`
 * and the ids can never collide. A caller that does not gets a hash of the
 * inputs, which collides only between two posters that are about the same
 * person with the same headline — that is to say, between two copies of the
 * same picture, where sharing a clip path changes nothing.
 *
 * The given uid is filtered rather than escaped: an id goes into a `url(#…)`
 * reference as well as an attribute, and a uid carrying a quote or a bracket
 * would produce a document that parses but never resolves its own clip.
 *
 * The readable part of the prefix is truncated, so the hash of the *whole*
 * uid is appended to it. Truncation alone was the collision this module exists
 * to prevent wearing a disguise: descriptive uids share long prefixes —
 * 'linkedin-achievement-card-01' and '…-02' agree for twenty-six characters —
 * and two posters dropped into one chooser page then mint byte-identical
 * clipPath and mask ids, leaving the second one cropped and faded by the
 * first one's defs. Filtering collides too ('poster#1' and 'poster1' reduce to
 * the same letters), which is why the hash is taken before the filter.
 */
function fnv(value) {
  let h = 2166136261;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function prefixFrom(uid, seed) {
  const raw = String(uid == null ? '' : uid);
  const given = raw.replace(/[^A-Za-z0-9_-]/g, '');
  if (given) return `ap${given.slice(0, 16)}${fnv(raw)}`;
  return `ap${fnv(seed || '')}`;
}

/* ── layout ─────────────────────────────────────────────────────────────── */

/**
 * Every measurement, as a fraction of the ground.
 *
 * Expressing the layout this way rather than as two tables of constants is
 * what lets the portrait shape exist at all: the square was designed first,
 * each number was then written as the fraction of the width or the height it
 * happened to be, and the taller ground inherits the composition instead of
 * being re-tuned by hand and drifting away from it.
 *
 * The vertical budget is the part worth reading, because it is what keeps the
 * type apart. Top matter ends around 0.19 of the height; the stat column runs
 * from there to 0.565, where the company mark sits; the name and subtitle land
 * at 0.642 and 0.677; the headline is anchored at its *bottom* at 0.875 and
 * grows upward, so a three-line headline at the largest size still stops about
 * forty pixels clear of the subtitle's descenders. The footer bar owns the
 * last 0.075 and nothing else may enter it.
 */
function layoutFor(ground) {
  const W = ground.width;
  const H = ground.height;
  const M = Math.round(W * 0.08);
  const footerHeight = Math.round(H * 0.075);
  const footerTop = H - footerHeight;
  const photoTop = Math.round(H * 0.20);
  const statsX = Math.round(W * 0.643);

  return {
    W,
    H,
    M,
    footerHeight,
    footerTop,
    lockupSize: Math.round(W * 0.07),
    lockupY: Math.round(H * 0.062),
    kickerY: Math.round(H * 0.097),
    kickerSize: Math.round(W * 0.0183),
    ruleY: Math.round(H * 0.113),
    ruleWidth: Math.round(W * 0.06),
    seriesY: Math.round(H * 0.152),
    seriesSize: Math.round(W * 0.0283),
    photoX: 0,
    photoW: Math.round(W * 0.62),
    photoTop,
    photoHeight: footerTop - photoTop,
    statsX,
    statsW: W - M - statsX,
    statsTop: Math.round(H * 0.191),
    statValueSize: Math.round(W * 0.040),
    statLabelSize: Math.round(W * 0.0167),
    companyY: Math.round(H * 0.565),
    companySize: Math.round(W * 0.095),
    nameY: Math.round(H * 0.642),
    nameWidth: statsX - M - 24,
    nameSizes: [0.0533, 0.0467, 0.04, 0.0333, 0.0283].map((f) => Math.round(W * f)),
    subY: Math.round(H * 0.677),
    subSize: Math.round(W * 0.0233),
    headBottom: Math.round(H * 0.875),
    headWidth: W - 2 * M,
    headSizes: [0.0567, 0.05, 0.0433, 0.0367, 0.0317].map((f) => Math.round(W * f)),
    burst: {
      cx: Math.round(W * 0.38),
      cy: Math.round(H * 0.44),
      inner: Math.round(W * 0.145),
      outer: Math.round(W * 0.40),
    },
  };
}

/* ── the drawn pieces ───────────────────────────────────────────────────── */

/**
 * The warm burst behind the figure, as tapered spokes.
 *
 * The reference has a sunburst behind the subject, and the obvious way to get
 * one is to paste in a radial artwork — which would be either an external
 * reference (a blank poster) or a hundred kilobytes of base64 on every render.
 * Twenty triangles and a radial gradient cost a few hundred bytes, tint with
 * the rest of the palette, and scale to any ground without resampling.
 *
 * Alternating spokes are shorter and fainter. A ring of twenty identical rays
 * reads as a clock face; the alternation is what makes it read as light.
 */
function burstSpokes(l) {
  const { cx, cy, inner, outer } = l.burst;
  const spokes = 20;
  const halfWidth = inner * 0.13;
  const parts = [];
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    /* The perpendicular, scaled to the half-width of the spoke's base. The
       spoke tapers to a point at its far end, so only the base needs it. */
    const px = -uy * halfWidth;
    const py = ux * halfWidth;
    const long = i % 2 === 0;
    const reach = outer * (long ? 1 : 0.68);
    const d = [
      `M${n(cx + ux * inner + px)} ${n(cy + uy * inner + py)}`,
      `L${n(cx + ux * reach)} ${n(cy + uy * reach)}`,
      `L${n(cx + ux * inner - px)} ${n(cy + uy * inner - py)}`,
      'Z',
    ].join(' ');
    parts.push(`<path d="${d}" fill="${COLOURS.gold}" fill-opacity="${long ? '0.16' : '0.09'}"/>`);
  }
  return parts.join('\n');
}

/**
 * A logo as a rounded badge.
 *
 * Uploaded marks are usually PNGs on an opaque white ground, so they are
 * clipped to a rounded rectangle: a white card on near-black reads as a
 * deliberate badge, a raw white square reads as a sticker somebody pasted on.
 * The clip id is passed in rather than derived here, because the caller is the
 * only thing that knows how many badges this document already has.
 */
function badge(uri, { x, y, size, id, ring, opacity }) {
  const r = Math.round(size * 0.18);
  const parts = [
    `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" rx="${r}"/></clipPath>`,
    `<image href="${uri}" x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${id})"${opacity ? ` opacity="${opacity}"` : ''}/>`,
  ];
  if (ring) {
    parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" rx="${r}" fill="none" stroke="${ring}" stroke-opacity="0.7" stroke-width="2"/>`);
  }
  return parts.join('\n');
}

/**
 * The stat column: a value, a label, and a hairline above each.
 *
 * The labels are clipped to one line rather than wrapped to two, and that is a
 * layout decision as much as a typographic one. Four two-line labels need more
 * vertical room than the column has between the top matter and the company
 * mark, and a column that sometimes runs long is a column that sometimes
 * writes "to the Anthropic team" over a logo. One line elided is always the
 * same height, and the labels this poster carries — "merged PRs", "of Claude
 * Max 20x" — fit it comfortably.
 */
function statColumn(l, stats) {
  if (!stats.length) return '';
  const band = l.companyY - 24 - l.statsTop;
  const step = clamp(Math.floor(band / stats.length), 96, 148);
  const parts = [];
  for (let i = 0; i < stats.length; i += 1) {
    const top = l.statsTop + i * step;
    const value = fit(stats[i].value, {
      widthPx: l.statsW,
      sizes: [l.statValueSize, Math.round(l.statValueSize * 0.82), Math.round(l.statValueSize * 0.66)],
      maxLines: 1,
      em: EM_BLACK,
    });
    parts.push(`<rect x="${l.statsX}" y="${top}" width="${l.statsW}" height="1" fill="${COLOURS.gold}" fill-opacity="0.35"/>`);
    parts.push(text(l.statsX, top + value.size + 14, value.lines[0] || '', {
      size: value.size, weight: 800, spacing: '-0.02em',
    }));
    if (stats[i].label) {
      parts.push(text(l.statsX, top + value.size + 14 + l.statLabelSize + 16,
        clip(stats[i].label, l.statsW, l.statLabelSize, EM_REGULAR), {
          size: l.statLabelSize, weight: 500, fill: COLOURS.muted, spacing: '0.06em',
        }));
    }
  }
  return parts.join('\n');
}

/* ── normalising the input ──────────────────────────────────────────────── */

/**
 * Turn whatever the agent passed into the fields this poster can draw.
 *
 * A stat with no value is dropped rather than drawn: a form with a spare empty
 * row at the bottom would otherwise contribute a hairline and a blank to the
 * column, and would count towards the cap and push a real number off.
 */
function normalise(person) {
  const p = typeof person === 'string' ? { name: person } : (person || {});
  const rawStats = Array.isArray(p.stats) ? p.stats : [];
  const stats = [];
  for (let i = 0; i < rawStats.length; i += 1) {
    const raw = rawStats[i];
    /* Anything that is not an object is a value. The narrower `typeof raw ===
       'string'` test dropped a plain number on the floor — `[65, '6 months']`
       out of a spreadsheet or a JSON body lost the 65 entirely, and lost it
       silently, because `65 || {}` is the number itself and a Number has no
       .value. A dropped fact is not counted in statsDropped either, so the
       agent had no way to notice. null and undefined still fall through to
       the empty-row guard below. */
    const entry = (raw !== null && typeof raw === 'object') ? raw : { value: raw };
    const value = clean(entry.value);
    const label = clean(entry.label);
    if (!value && !label) continue;
    stats.push({ value: value || label, label: value ? label : '' });
  }
  return {
    name: clean(p.name),
    subtitle: clean(p.subtitle),
    kicker: clean(p.kicker) || DEFAULTS.kicker,
    series: clean(p.series) || DEFAULTS.series,
    headline: clean(p.headline),
    footerNote: clean(p.footerNote) || DEFAULTS.footerNote,
    photoDataUri: p.photoDataUri,
    kept: stats.slice(0, MAX_STATS),
    dropped: Math.max(0, stats.length - MAX_STATS),
  };
}

/* ── build ──────────────────────────────────────────────────────────────── */

/**
 * Build the poster.
 *
 * @param {object}   args
 * @param {object}   args.person                 { name, subtitle, photoDataUri, stats, headline, kicker, series, footerNote }
 * @param {string}   [args.uid]                  prefix for every minted id; derived from the inputs when absent
 * @param {string}   [args.size]                 'square' (default) or 'portrait'
 * @param {string}   [args.orgLogoDataUri]       the publisher's mark; falls back to TEN's
 * @param {string}   [args.orgName]              printed beside that mark
 * @param {string}   [args.companyLogoDataUri]   the organisation the person was selected for
 * @param {string}   [args.companyName]          printed when that logo is missing or refused
 * @returns {{svg, width, height, alt, usedPhoto, usedOrgLogo, usedCompanyLogo, fallbacks, statCount, statsDropped, size}}
 */
function build(args) {
  const a = args || {};
  const ground = SIZES[a.size === 'portrait' ? 'portrait' : 'square'];
  const l = layoutFor(ground);
  const p = normalise(a.person);

  const orgName = clean(a.orgName) || BRAND.name;
  const companyName = clean(a.companyName);

  /*
   * What was supplied, and what survived. `fallbacks` names only the slots
   * where the caller supplied something that was refused — an absent logo is
   * not a fallback, it is simply a poster without that logo, and reporting the
   * two the same way would have the agent apologising for uploads nobody made.
   */
  const fallbacks = [];

  const photo = safePhoto(p.photoDataUri);
  if (!photo && clean(p.photoDataUri)) fallbacks.push('photo');

  const suppliedOrg = safeLogo(a.orgLogoDataUri);
  if (!suppliedOrg && clean(a.orgLogoDataUri)) fallbacks.push('orgLogo');
  /* No usable upload means the house mark, which is what this slot is: the
     poster's own publisher, and that is us until somebody says otherwise. */
  const orgLogo = suppliedOrg || logoDataUri();

  const companyLogo = safeLogo(a.companyLogoDataUri);
  if (!companyLogo && clean(a.companyLogoDataUri)) fallbacks.push('companyLogo');

  const prefix = prefixFrom(a.uid, [p.name, p.headline, orgName, companyName, ground.id].join('|'));
  const ids = {
    bloom: `${prefix}bl`,
    fade: `${prefix}fd`,
    clip: `${prefix}cp`,
    mask: `${prefix}mk`,
    org: `${prefix}og`,
    company: `${prefix}co`,
  };

  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${l.W}" height="${l.H}" viewBox="0 0 ${l.W} ${l.H}" role="img" aria-label="${escapeXml(altFor(p, orgName, companyName))}">`);

  const defs = [
    `<radialGradient id="${ids.bloom}" cx="${l.burst.cx / l.W}" cy="${l.burst.cy / l.H}" r="0.55">`,
    `<stop offset="0" stop-color="#ffb45c" stop-opacity="0.34"/>`,
    `<stop offset="0.55" stop-color="${COLOURS.goldDeep}" stop-opacity="0.12"/>`,
    `<stop offset="1" stop-color="${COLOURS.gold}" stop-opacity="0"/>`,
    '</radialGradient>',
  ];
  if (photo) {
    /*
     * The cut-out. The clip keeps the photograph inside its column — a wide
     * group shot would otherwise slide under the stat values — and the mask
     * fades its last third into the ground so the figure stands *in* the
     * poster rather than on a visible rectangle. The gradient is in user space
     * so its stops are the photograph's own top and bottom, not the viewport's:
     * an objectBoundingBox gradient here fades correctly in the square and
     * wrongly in the portrait, which is the kind of bug that only appears in
     * the shape nobody previewed.
     */
    defs.push(`<linearGradient id="${ids.fade}" x1="0" y1="${l.photoTop}" x2="0" y2="${l.footerTop}" gradientUnits="userSpaceOnUse">`
      + '<stop offset="0" stop-color="#ffffff"/>'
      + '<stop offset="0.62" stop-color="#ffffff"/>'
      + '<stop offset="1" stop-color="#000000"/>'
      + '</linearGradient>');
    defs.push(`<clipPath id="${ids.clip}"><rect x="${l.photoX}" y="${l.photoTop}" width="${l.photoW}" height="${l.photoHeight}"/></clipPath>`);
    defs.push(`<mask id="${ids.mask}" maskUnits="userSpaceOnUse" x="${l.photoX}" y="${l.photoTop}" width="${l.photoW}" height="${l.photoHeight}">`
      + `<rect x="${l.photoX}" y="${l.photoTop}" width="${l.photoW}" height="${l.photoHeight}" fill="url(#${ids.fade})"/>`
      + '</mask>');
  }
  parts.push(`<defs>${defs.join('\n')}</defs>`);

  /* Ground, burst, bloom — in that order, so everything else paints over. */
  parts.push(`<rect width="${l.W}" height="${l.H}" fill="${COLOURS.ink}"/>`);
  parts.push(burstSpokes(l));
  parts.push(`<rect width="${l.W}" height="${l.H}" fill="url(#${ids.bloom})"/>`);

  /* The figure. */
  if (photo) {
    parts.push(`<image href="${photo}" x="${l.photoX}" y="${l.photoTop}" width="${l.photoW}" height="${l.photoHeight}" preserveAspectRatio="xMidYMax slice" clip-path="url(#${ids.clip})" mask="url(#${ids.mask})"/>`);
  } else {
    /*
     * No usable photograph: a gold-tinted disc with the initials in it, sized
     * and placed so the name below still has the room it was given. It is a
     * deliberate mark rather than a placeholder — a poster whose subject never
     * sent a picture should look composed, not unfinished.
     *
     * The disc sits higher and smaller than the centre of the photograph's box
     * because the name is drawn at the largest size in the ladder on a bare
     * poster: at 0.35 of the band and 0.27 of the column the stroked bottom of
     * the ring landed forty pixels *inside* the cap band of the gold name, so
     * the ring swept through the letters. This is the default path for every
     * subject who did not send a picture, so it is also the state most people
     * will see.
     */
    const cx = Math.round(l.photoW * 0.5);
    const cy = l.photoTop + Math.round(l.photoHeight * 0.30);
    const r = Math.round(l.photoW * 0.25);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${COLOURS.gold}" fill-opacity="0.12"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.75" stroke-width="3"/>`);
    const initials = initialsFor(p.name);
    if (initials) {
      parts.push(text(cx, cy + Math.round(r * 0.34), initials, {
        size: Math.round(r * 0.86), weight: 800, fill: COLOURS.gold, anchor: 'middle', spacing: '0.02em',
      }));
    }
  }

  /*
   * Top matter: kicker, hairline, series title.
   *
   * The lockup's geometry is settled first because the kicker's budget is
   * whatever the lockup leaves. They share a band ten pixels deep — the kicker
   * baseline at 0.097 of the height, the org name at the lockup's own — and the
   * kicker was the one user string on this poster that reached the document
   * with neither fit() nor clip() in front of it. A series title like "Humans
   * of the Entrepreneurship Network, 2025 cohort" was written straight through
   * the publisher's name and then off the right edge of the canvas.
   *
   * The lockup name is right-anchored, so the leftmost column it can reach is
   * its anchor less the width it is itself clipped to; the kicker stops a
   * gutter short of that. Its effective em carries the 0.24em tracking it is
   * set with, because charsThatFit measures glyph advance and knows nothing
   * about letter-spacing — at this tracking the real advance is nearer 0.80em
   * than 0.56, so ignoring it overruns the budget by nearly half again.
   */
  const lockX = l.W - l.M - l.lockupSize;
  const orgNameSize = Math.round(l.W * 0.0183);
  const orgNameWidth = l.W * 0.42;
  const lockupTextEnd = orgLogo ? lockX - 18 : l.W - l.M;
  const kickerWidth = Math.max(120, lockupTextEnd - orgNameWidth - l.M - 24);

  parts.push(text(l.M, l.kickerY, clip(p.kicker, kickerWidth, l.kickerSize, EM_BOLD + 0.24).toUpperCase(), {
    size: l.kickerSize, weight: 700, fill: COLOURS.gold, spacing: '0.24em',
  }));
  parts.push(`<rect x="${l.M}" y="${l.ruleY}" width="${l.ruleWidth}" height="2" fill="${COLOURS.gold}" fill-opacity="0.8"/>`);
  parts.push(text(l.M, l.seriesY, clip(p.series, l.W * 0.5, l.seriesSize, EM_BOLD), {
    size: l.seriesSize, weight: 600, fill: COLOURS.white, spacing: '-0.01em', opacity: '0.92',
  }));

  /* The publisher's lockup, top-right: the mark, and the name beside it. */
  if (orgLogo) {
    parts.push(badge(orgLogo, {
      x: lockX, y: l.lockupY, size: l.lockupSize, id: ids.org, ring: COLOURS.gold,
    }));
  }
  parts.push(text(lockupTextEnd, l.lockupY + Math.round(l.lockupSize * 0.62),
    clip(orgName, orgNameWidth, orgNameSize, EM_REGULAR), {
      size: orgNameSize, weight: 600, fill: COLOURS.muted, anchor: 'end', spacing: '0.08em',
    }));

  /* The numbers. */
  parts.push(statColumn(l, p.kept));

  /*
   * The other organisation, low on the ground to the right of the figure —
   * where the reference puts the mark of the programme the student was taken
   * into. When there is no usable logo the name is set in its place rather
   * than leaving a hole, because the poster's whole claim is *who* selected
   * them and a blank corner does not make it.
   */
  if (companyLogo) {
    parts.push(badge(companyLogo, {
      x: l.statsX, y: l.companyY, size: l.companySize, id: ids.company, opacity: '0.92',
    }));
  } else if (companyName) {
    const co = fit(companyName, {
      widthPx: l.statsW,
      sizes: [Math.round(l.W * 0.0317), Math.round(l.W * 0.0267), Math.round(l.W * 0.0217)],
      maxLines: 2,
      em: EM_BOLD,
    });
    parts.push(block(l.statsX, l.companyY + co.size + 10, co.lines, {
      size: co.size, weight: 700, fill: COLOURS.gold, spacing: '-0.01em',
    }).svg);
  }

  /* Name and subtitle, bottom-left, over the fading photograph. */
  if (p.name) {
    const name = fit(p.name.toUpperCase(), {
      widthPx: l.nameWidth, sizes: l.nameSizes, maxLines: 1, em: EM_BLACK,
    });
    parts.push(text(l.M, l.nameY, name.lines[0] || '', {
      size: name.size, weight: 800, fill: COLOURS.gold, spacing: '-0.02em',
    }));
  }
  if (p.subtitle) {
    parts.push(text(l.M, l.subY, clip(p.subtitle, l.nameWidth, l.subSize, EM_REGULAR), {
      size: l.subSize, weight: 500, fill: COLOURS.muted,
    }));
  }

  /*
   * The headline, anchored at its bottom and grown upward.
   *
   * Drawing it downward from a fixed first baseline is the obvious way and the
   * wrong one: a three-line headline then ends up in the footer bar, and the
   * only way to stop it is to forbid three lines. Anchoring the last baseline
   * instead means the block can only ever grow towards the subtitle, and the
   * size ladder is chosen so that even three lines at the largest size stop
   * clear of it.
   */
  if (p.headline) {
    const head = fit(p.headline.toUpperCase(), {
      widthPx: l.headWidth, sizes: l.headSizes, maxLines: 3, em: EM_BLACK,
    });
    const lineHeight = Math.round(head.size * 1.06);
    const first = l.headBottom - (head.lines.length - 1) * lineHeight;
    parts.push(block(l.M, first, head.lines, {
      size: head.size, weight: 800, fill: COLOURS.white, spacing: '-0.03em', lineHeight,
    }).svg);
  }

  /* The footer bar. Full width, gold, near-black type — the one band of the
     poster that is the same on every render, which is what makes a series of
     them look like a series. */
  parts.push(`<rect x="0" y="${l.footerTop}" width="${l.W}" height="${l.footerHeight}" fill="${COLOURS.gold}"/>`);
  const footY = l.footerTop + Math.round(l.footerHeight * 0.63);

  /*
   * The note and the URL share this one baseline, so the note's budget is
   * measured from the URL rather than guessed. A flat 0.55 of the width was
   * both too generous and measured wrong: the URL is right-anchored and eats
   * some 540 pixels of that same line, and clipping at EM_BOLD ignored the
   * note's own 0.1em tracking, so a custom footerNote of forty-odd characters
   * was set straight through the address in the gold bar. The default note is
   * short enough to have hidden it.
   */
  const siteLabel = BRAND.site.replace(/^https?:\/\//, '');
  const siteSize = Math.round(l.W * 0.0175);
  const siteWidth = siteLabel.length * siteSize * (EM_REGULAR + 0.04);
  const noteSize = Math.round(l.W * 0.0217);
  const noteWidth = Math.max(120, l.W - 2 * l.M - siteWidth - 32);

  parts.push(text(l.M, footY, clip(p.footerNote, noteWidth, noteSize, EM_BOLD + 0.1).toUpperCase(), {
    size: noteSize, weight: 800, fill: COLOURS.ink, spacing: '0.1em',
  }));
  parts.push(text(l.W - l.M, footY, siteLabel, {
    size: siteSize, weight: 600, fill: COLOURS.ink, anchor: 'end', spacing: '0.04em', opacity: '0.75',
  }));

  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    width: l.W,
    height: l.H,
    size: ground.id,
    alt: altFor(p, orgName, companyName),
    usedPhoto: Boolean(photo),
    usedOrgLogo: Boolean(orgLogo),
    usedCompanyLogo: Boolean(companyLogo),
    fallbacks,
    statCount: p.kept.length,
    statsDropped: p.dropped,
  };
}

/**
 * What a screen reader gets, and what LinkedIn stores as the image's
 * description. It is built from the same facts the picture carries, in the
 * order they are read, and capped — an alt text longer than the post is not an
 * accessibility feature.
 */
function altFor(p, orgName, companyName) {
  const stats = p.kept.map((s) => [s.value, s.label].filter(Boolean).join(' ')).join('; ');
  return [
    p.kicker,
    [p.name, p.subtitle].filter(Boolean).join(' — '),
    p.headline,
    companyName,
    stats,
    orgName,
  ].filter(Boolean).join('. ').slice(0, 300);
}

module.exports = {
  build,
  MAX_STATS,
  MAX_PHOTO_CHARS,
  MAX_LOGO_CHARS,
  SIZES,
  DEFAULTS,
  safePhoto,
  safeLogo,
  initialsFor,
};
