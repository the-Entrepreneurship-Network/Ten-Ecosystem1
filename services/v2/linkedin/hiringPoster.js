'use strict';

/**
 * The hiring spec sheet — a recruitment poster that is all facts and no prose.
 *
 * The client showed us a real recruitment poster and said "exactly in this
 * format": a headline so loud it is most of the page, the role beneath it, and
 * then rows of small labelled cards — COMPANY, POSITION, LOCATION, EXPERIENCE,
 * JOB TYPE across the top, ELIGIBILITY, REQUIRED SKILL, EXPECTED SALARY wider
 * beneath — with a call to action along the foot. Ours carries the internship
 * facts instead, but the shape is theirs.
 *
 * The instruction that mattered most was "the poster should not write anything
 * elaborate, only meaningful things". So nothing here composes a sentence. The
 * persuasion lives in the post text, which a reader can expand; the picture is
 * a spec sheet they can read at a glance in a feed. Every string on it either
 * came from the author or is a fixed label.
 *
 * Three constraints run through the whole file:
 *
 *   1. **A card exists only when its fact has a value.** This is the single
 *      property the design lives or dies on. An earlier draft drew nine slots
 *      and left the empty ones blank, and a poster with three facts came out
 *      as a poster for nine with six holes punched in it — which reads as a
 *      template somebody forgot to fill in, not as a short advert. So the
 *      cards are built from the facts that exist, the row shape is chosen from
 *      how many that turned out to be, and each card is sized to its row.
 *      Three facts are three cards across the full width, not three slivers
 *      huddled on the left. The word "undefined" cannot appear on the poster
 *      because a missing value never reaches the drawing code at all.
 *
 *   2. **The SVG is self-contained.** It is rasterised in the browser through
 *      <img> to <canvas> before publishing. An external href, web font or
 *      stylesheet taints that canvas, toDataURL() throws a SecurityError, and
 *      the post goes out with no picture and no error. Images are therefore
 *      `data:` URIs or they are not drawn, and the fonts are a plain stack
 *      with system fallbacks.
 *
 *   3. **Every id is unique per render.** Six posters are previewed on one
 *      page at a time. Two clipPaths called "mark" in one document leave the
 *      second poster wearing the first one's clip — a bug that only appears in
 *      the gallery and never in a single-poster test. Every id this file mints
 *      carries a prefix derived from the caller's `uid`.
 *
 * The identity is swappable by design. The client's words: "you have to just
 * change the company name, the company logo, and everything — but the format
 * will be the same." So no third-party mark is bundled; logos arrive as
 * `data:` URIs from an upload and are validated like any other untrusted
 * input, and when one cannot be read the organisation's *name* is printed
 * instead so the poster still says who is hiring.
 */

const {
  COLOURS, BRAND, escapeXml, wrap, logoDataUri,
} = require('./posterStudio');

/*
 * The domain glyphs are a nice-to-have, not a dependency.
 *
 * They are being written in parallel with this file and they are drawing, not
 * information: a card with a plain gold disc where a Python mark would have
 * been is a slightly duller poster, whereas a module that throws at require
 * time takes the whole LinkedIn agent down on a turn that only wanted to show
 * a preview. So the require is guarded and every call through it degrades to
 * the plain filled circle below.
 */
let glyphs = null;
try {
  /* eslint-disable-next-line global-require */
  glyphs = require('./domainGlyphs');
} catch (e) {
  /* glyphs are optional */
}

const FONT = 'Outfit, Inter, Arial, sans-serif';

/* Advance width per character as a fraction of the font size — the same
   constants posterDesigns.js fits its headlines with. Copied rather than
   imported so this module depends only on posterStudio: both are rendered on
   the same turn, and a require cycle between them would be a silent
   partial-module bug rather than a loud one. */
const EM_BOLD = 0.56;
const EM_BLACK = 0.60;

/* ── what the poster can say ────────────────────────────────────────────── */

/**
 * The canonical order the cards appear in.
 *
 * Order is a design decision, not arithmetic. The short values lead because
 * row one holds up to five cards and a five-column row is narrow; the long
 * ones (the skills list, the eligibility sentence, what alumni went on to
 * earn) come last, where the rows are wider. Change this array and you change
 * the poster's reading order — that is the point of exporting it.
 *
 * `domain` is a card and also, when there is no role, the line under the
 * headline. The builder drops the card in that case: the same two words set
 * twice within 200 pixels reads as a bug, not as emphasis.
 */
const FACT_ORDER = [
  'domain',
  'batch',
  'openings',
  'mode',
  'duration',
  'location',
  'stipend',
  'applyBy',
  'skills',
  'eligibility',
  'afterLpa',
];

/**
 * What each card is labelled, and which mark sits in its icon circle.
 *
 * `glyphFrom` names the fact whose text is fed to the domain-glyph matcher —
 * only the two facts that actually describe a subject. Everything else gets a
 * drawn geometric mark from ICONS below, because a pin means location to
 * everybody and no glyph library is needed to say so.
 */
const FACT_LABELS = {
  domain: 'Domain',
  batch: 'Batch',
  openings: 'Openings',
  mode: 'Mode',
  duration: 'Duration',
  location: 'Location',
  stipend: 'Stipend',
  applyBy: 'Apply by',
  skills: 'Required skills',
  eligibility: 'Eligibility',
  /* The client's own framing: this field is not the internship's pay, it is
     what people who did it went on to earn. Labelling it "Salary" next to
     "Stipend" would be read as a contradiction on the same poster. */
  afterLpa: 'Alumni outcomes',
};

const FACT_ICONS = {
  domain: { glyphFrom: 'domain', icon: 'spark' },
  batch: { icon: 'calendar' },
  openings: { icon: 'people' },
  mode: { icon: 'monitor' },
  duration: { icon: 'clock' },
  location: { icon: 'pin' },
  stipend: { icon: 'rupee' },
  applyBy: { icon: 'flag' },
  skills: { glyphFrom: 'skills', icon: 'spark' },
  eligibility: { icon: 'cap' },
  afterLpa: { icon: 'rise' },
};

/**
 * What the agent must collect before this poster is worth drawing.
 *
 * Six questions: what the work is, which domain it sits in, whether it is
 * online or offline, how long it runs, what it pays, and by when to apply. A
 * poster missing any of those sends the reader to the comments to ask, which
 * is exactly the work the poster existed to save. `build()` reports which of
 * them were absent rather than refusing to draw — a preview of an incomplete
 * poster is how the author discovers what is incomplete.
 *
 * `org` is deliberately not here: it has a default. Nor are `openings`,
 * `location`, `skills`, `eligibility` and `afterLpa` — they are worth having
 * and the poster is still true without them.
 */
const REQUIRED_FACTS = ['role', 'domain', 'mode', 'duration', 'stipend', 'applyBy'];

const DEFAULT_CTA = 'COMMENT "INTERESTED" AND WE WILL SEND THE LINK';

/*
 * The ceiling on an uploaded logo, measured on the data URI string.
 *
 * Base64 runs about a third larger than the bytes it carries, so two million
 * characters is roughly a 1.5 MB image. A wordmark needs a tiny fraction of
 * that; anything above it is somebody attaching a print-resolution original,
 * and embedding it would make an SVG string large enough to stall the tab
 * that has to rasterise it.
 */
const MAX_LOGO_CHARS = 2 * 1024 * 1024;

/*
 * The accepted logo grammar, split so neither half has to scan a
 * two-megabyte string more than once.
 *
 * `image/svg+xml` is allowed here where the roll of honour refuses it,
 * because a logo genuinely is vector artwork and it arrives as a `data:` URI
 * referenced from an <image> element — a context that does not run scripts
 * and cannot reach the network. Only standard base64 is accepted, no
 * percent-encoded payloads: that alphabet contains none of the five
 * characters XML cares about, which is what makes the value safe to drop
 * straight into an attribute.
 */
const LOGO_HEAD = /^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,/i;
const LOGO_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/*
 * The SVG branch, and why it is the one upload that has to be opened.
 *
 * A PNG is opaque bytes: whatever is inside it, the renderer draws pixels. An
 * SVG is a document, and a document can reach out of the poster — an
 * `@import`, or an <image href="http://…"> inside the uploaded mark — which is
 * exactly the thing this module promises never to do. Checking the MIME type
 * and the base64 alphabet does not see any of it, because it is all inside the
 * payload: the poster ships, the canvas it is rasterised on is tainted by the
 * outbound request, toDataURL() throws, and the post goes out with no picture.
 *
 * So for `svg+xml` only, the payload is decoded and read. Anything that
 * executes (<script>, <foreignObject>), pulls in a stylesheet, or references
 * a target that is neither a `data:` URI nor a local `#` fragment means this
 * is not a logo we can embed. The fallback is already correct and already
 * tested: we print the organisation's name instead.
 */
const SVG_HEAD = /^data:image\/svg\+xml;base64,/i;
const SVG_BANNED = /<script|<foreignObject|<iframe|<!ENTITY|@import/i;
const SVG_REFS = /(?:xlink:href|href)\s*=\s*"([^"]*)"|(?:xlink:href|href)\s*=\s*'([^']*)'|url\(\s*["']?([^"')]*)/gi;

/*
 * The two shapes this poster is offered in. Anything else falls back to the
 * square, which is LinkedIn's best-performing feed image; the ground actually
 * used is reported back in the result so a caller that asked for something
 * unsupported can see what it got.
 */
const GROUNDS = {
  square: { id: 'square', width: 1200, height: 1200, margin: 96 },
  portrait: { id: 'portrait', width: 1080, height: 1350, margin: 88 },
};

/**
 * How many cards go in each row, for each number of cards.
 *
 * Spelled out rather than computed because this is the composition, not
 * arithmetic. The reference poster is five narrow cards over three wide ones,
 * so that is what eight looks like. Six is three over three and never five
 * over one, because a lone card on its own row reads as an afterthought.
 * Nine is five over four rather than five-three-one for the same reason.
 *
 * Nothing above eleven can occur — FACT_ORDER has eleven entries — but a
 * twelfth fact added later must not silently fall off the poster, so the
 * fallback below spreads anything unlisted over rows of five.
 */
const ROWS = {
  1: [1],
  2: [2],
  3: [3],
  4: [4],
  5: [5],
  6: [3, 3],
  7: [4, 3],
  8: [5, 3],
  9: [5, 4],
  10: [5, 5],
  11: [5, 3, 3],
};

function rowsFor(count) {
  if (count <= 0) return [];
  if (ROWS[count]) return ROWS[count];
  const out = [];
  let left = count;
  while (left > 0) {
    out.push(Math.min(5, left));
    left -= 5;
  }
  return out;
}

/* ── small helpers, in the house style of posterDesigns.js ──────────────── */

/**
 * A fact reduced to the string the poster may print, or '' if it is not one.
 *
 * The type check is not defensive programming for its own sake. The facts
 * arrive as one bag assembled from a form and an LLM's extraction, so a
 * numeric `openings`, a boolean `mode` from a checkbox, a `NaN` from a failed
 * parse and an `{}` from a half-built object are all things that turn up in
 * practice — and an unguarded `String(value)` prints every one of them.
 * "[object Object]" set as the role on a gold lozenge, or "NaN" under
 * DURATION, is worse than the missing card, and worse still is that the fact
 * counts as collected: `missing` then tells the agent not to ask for a
 * duration it never got.
 *
 * A finite non-zero number is kept and stringified, because "12" openings
 * typed into a number field is a real answer. Numeric zero is not: every fact
 * here is a quantity or a description, and "0" under OPENINGS on a hiring
 * poster says nobody is being hired — which is the one thing the poster cannot
 * afford to say by accident, and an unfilled number input is where that zero
 * comes from. An author who genuinely means zero can still type it, because a
 * string "0" is a string and survives untouched. Everything else that is not a
 * string becomes absent, which is the one state the rest of this file already
 * handles correctly everywhere.
 */
function clean(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? String(value) : '';
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function charsThatFit(widthPx, fontSize, em) {
  return Math.max(4, Math.floor(widthPx / (fontSize * em)));
}

/**
 * The largest size from `sizes` at which `value` fits inside `maxLines`.
 *
 * There is no text-measuring API on the server, so the size is chosen from
 * the text rather than fixed by the design. If nothing fits, the smallest
 * size is kept and the tail is elided: a poster with an ellipsis is still a
 * poster, a poster with overlapping lines is a bug somebody publishes.
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
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '').trim()} …`;
  }
  return { size: chosen.size, lines };
}

/**
 * One line of text cut to the width it has been given.
 *
 * `fit` is the wrong tool for a value that gets exactly one line, and the way
 * it is wrong is instructive: asked to squeeze "Python Development" into a
 * one-line box it wraps to two lines, keeps the first, strips the trailing
 * word from it — leaving nothing — and prints a lone ellipsis. A card whose
 * value is "…" is worse than no card. So a single line is clipped rather than
 * wrapped. The whole trailing word is dropped when doing so still leaves half
 * a line, because "Python Develop…" reads better than "Python D…", but a
 * single unbroken token is cut mid-word rather than reduced to nothing.
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
 * A 32-bit FNV-1a hash, rendered in base 36.
 *
 * Only ever used to derive an id prefix when the caller did not supply a
 * `uid`. It does not need to be a good hash, it needs to be short, stable and
 * free of characters an XML id cannot hold.
 */
function hash(value) {
  const s = String(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * The prefix every id in this document carries.
 *
 * The caller's `uid` is stripped to the characters an XML id may contain —
 * the agent passes things like a draft id, and a colon or a dot in there
 * produces an id that `url(#...)` cannot reference, which silently drops the
 * clip and shows the logo's raw white square.
 *
 * With no uid the prefix is derived from the facts themselves. Two posters
 * built from identical facts then share ids, and that is deliberately fine:
 * identical ids referencing identical definitions resolve to the same clip,
 * so the only way to collide is to draw the same poster twice. Two *different*
 * posters, which is the gallery case this guards, always differ.
 */
function idPrefix(uid, seed) {
  const safe = String(uid == null ? '' : uid).replace(/[^A-Za-z0-9_-]/g, '');
  return `hp${safe ? safe.slice(0, 32) : hash(seed)}`;
}

/* ── the untrusted part ─────────────────────────────────────────────────── */

/**
 * An uploaded logo, or an empty string if it is not one.
 *
 * Everything this rejects has been seen in some form: a `javascript:` string
 * pasted from a clipboard, an `http://` link to the company's press-kit PNG
 * (which taints the canvas and loses the entire image, not just the logo), a
 * PDF from a file picker with no accept filter, and a data URI with an empty
 * payload that passes a naive prefix check and renders as a broken-image
 * glyph on the company's recruitment post.
 *
 * It is a whitelist on purpose. Anything not recognised is not a logo, and a
 * logo we cannot verify becomes the organisation's name in type — which is
 * what the poster needed to say in the first place.
 */
function safeLogo(value) {
  if (typeof value !== 'string') return '';
  const uri = value.trim();
  if (!uri || uri.length > MAX_LOGO_CHARS) return '';
  const head = LOGO_HEAD.exec(uri);
  if (!head) return '';
  const body = uri.slice(head[0].length);
  if (!body || !LOGO_BODY.test(body)) return '';
  if (SVG_HEAD.test(uri) && svgReachesOut(body)) return '';
  return uri;
}

/** True when a base64 SVG payload contains anything that leaves the document. */
function svgReachesOut(body) {
  let markup = '';
  try {
    markup = Buffer.from(body, 'base64').toString('utf8');
  } catch (e) {
    /* A payload we cannot even decode is not a logo. */
    return true;
  }
  if (SVG_BANNED.test(markup)) return true;
  SVG_REFS.lastIndex = 0;
  let m = SVG_REFS.exec(markup);
  while (m) {
    const target = String(m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]) || '').trim();
    if (target && target.charAt(0) !== '#' && !/^data:/i.test(target)) return true;
    m = SVG_REFS.exec(markup);
  }
  return false;
}

/* ── icons ──────────────────────────────────────────────────────────────── */

/*
 * The marks that are not domain glyphs.
 *
 * Each is drawn inside a 100x100 box with the origin top-left, exactly as
 * domainGlyphs.js does, so the two sets can share one placement transform and
 * sit at the same optical weight in the same circle. Filled shapes inherit
 * the group's fill; stroked ones set `fill="none"` and their own
 * stroke-width, and the group carries `stroke-width="0"` so a filled shape is
 * never accidentally outlined as well — at 26 pixels that turns a crisp
 * silhouette into a smudge.
 *
 * They are kept to four or five elements each because they are seen at about
 * 26 pixels on the card. Detail finer than a pixel of the drawing is not
 * subtle, it is invisible, and it only makes the document longer.
 */
const ICONS = {
  /* A month grid with its two binder rings. */
  calendar: [
    '<rect x="14" y="26" width="72" height="62" rx="10" fill="none" stroke-width="8"/>',
    '<path d="M14 46 h72" fill="none" stroke-width="8"/>',
    '<path d="M34 14 v22" fill="none" stroke-width="8" stroke-linecap="round"/>',
    '<path d="M66 14 v22" fill="none" stroke-width="8" stroke-linecap="round"/>',
  ],

  /* Two people, one behind the other: seats, not a person. */
  people: [
    '<circle cx="40" cy="32" r="14" fill="none" stroke-width="8"/>',
    '<path d="M14 84 a26 26 0 0 1 52 0" fill="none" stroke-width="8" stroke-linecap="round"/>',
    '<circle cx="74" cy="40" r="10" fill="none" stroke-width="7"/>',
    '<path d="M70 84 a16 16 0 0 1 22 -10" fill="none" stroke-width="7" stroke-linecap="round"/>',
  ],

  /* A screen on a stand: online, offline or hybrid is a question about where
     the work happens, and a monitor is the shortest way to ask it. */
  monitor: [
    '<rect x="12" y="20" width="76" height="52" rx="9" fill="none" stroke-width="8"/>',
    '<path d="M50 72 v12" fill="none" stroke-width="8"/>',
    '<path d="M32 86 h36" fill="none" stroke-width="8" stroke-linecap="round"/>',
  ],

  clock: [
    '<circle cx="50" cy="50" r="36" fill="none" stroke-width="8"/>',
    '<path d="M50 26 V52 L68 62" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
  ],

  pin: [
    '<path d="M50 90 C30 66 18 54 18 40 a32 32 0 0 1 64 0 c0 14 -12 26 -32 50 z" fill="none" stroke-width="8" stroke-linejoin="round"/>',
    '<circle cx="50" cy="40" r="11" fill="none" stroke-width="8"/>',
  ],

  /* The rupee sign as geometry rather than as a character. A "₹" glyph is
     missing from several of the fallback fonts this poster may be rasterised
     with, and a missing glyph is a replacement box printed on the stipend. */
  rupee: [
    '<path d="M30 20 h40" fill="none" stroke-width="8" stroke-linecap="round"/>',
    '<path d="M30 38 h40" fill="none" stroke-width="8" stroke-linecap="round"/>',
    '<path d="M30 56 h20 a18 18 0 0 0 0 -36" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M38 56 L70 88" fill="none" stroke-width="8" stroke-linecap="round"/>',
  ],

  /* A pennant: a deadline is a marker in time, not another calendar. */
  flag: [
    '<path d="M26 12 V90" fill="none" stroke-width="8" stroke-linecap="round"/>',
    '<path d="M26 22 h50 l-13 18 13 18 h-50 z" fill="none" stroke-width="8" stroke-linejoin="round"/>',
  ],

  /* A mortar board. */
  cap: [
    '<path d="M10 40 L50 22 L90 40 L50 58 Z" fill="none" stroke-width="8" stroke-linejoin="round"/>',
    '<path d="M26 47 V68 c0 9 11 15 24 15 s24 -6 24 -15 V47" fill="none" stroke-width="8" stroke-linejoin="round"/>',
  ],

  /* Rising columns: where the people who did this ended up. */
  rise: [
    '<path d="M14 86 h72" fill="none" stroke-width="8" stroke-linecap="round"/>',
    '<rect x="22" y="56" width="15" height="22" rx="4"/>',
    '<rect x="43" y="42" width="15" height="36" rx="4"/>',
    '<rect x="64" y="26" width="15" height="52" rx="4"/>',
  ],

  /* The fallback, and the shape this file degrades to when domainGlyphs is
     absent entirely: a plain filled disc. It says nothing, which is the
     correct thing for an icon to say when we do not know the subject. */
  spark: [
    '<circle cx="50" cy="50" r="22"/>',
  ],
};

/*
 * A tint is written straight into a fill attribute, so it is checked rather
 * than escaped — the same guard domainGlyphs.js applies, for the same reason:
 * a colour that one day arrives from a settings row must not be able to close
 * the attribute and inject markup into the poster.
 */
const SAFE_TINT = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;

function tintOf(value) {
  const tint = String(value == null ? '' : value).trim();
  return SAFE_TINT.test(tint) ? tint : COLOURS.gold;
}

function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function drawIcon(name, x, y, size, tint) {
  const shapes = ICONS[name] || ICONS.spark;
  const k = Number(size) / 100;
  /* A group scaled by NaN is not an invisible icon, it is a subtree the
     renderer discards — and in some engines the whole document with it. */
  if (!Number.isFinite(k) || k <= 0) return '';
  const attrs = [
    `transform="translate(${num(x)} ${num(y)}) scale(${num(k)})"`,
    `fill="${tintOf(tint)}"`,
    `stroke="${tintOf(tint)}"`,
    'stroke-width="0"',
  ];
  return `<g ${attrs.join(' ')}>${shapes.join('')}</g>`;
}

/** The domain glyph id for a piece of text, or '' when there is no match. */
function glyphIdFor(value) {
  if (!glyphs || typeof glyphs.glyphFor !== 'function') return '';
  try {
    const found = glyphs.glyphFor(value);
    return found && found.id ? String(found.id) : '';
  } catch (e) {
    /* A glyph is decoration; a throw from it must not cost us the poster. */
    return '';
  }
}

function drawGlyph(id, x, y, size, tint, opacity) {
  if (!id || !glyphs || typeof glyphs.draw !== 'function') return '';
  try {
    return glyphs.draw({
      id, x, y, size, tint, opacity,
    }) || '';
  } catch (e) {
    return '';
  }
}

/* ── pieces of the poster ───────────────────────────────────────────────── */

/**
 * A logo as a rounded badge.
 *
 * Most uploaded marks are PNGs with an opaque white ground, so the image is
 * clipped to a rounded rectangle with a hairline: a white card on near-black
 * reads as a deliberate badge, a raw white square reads as a sticker somebody
 * pasted on. `preserveAspectRatio="xMidYMid meet"` rather than `slice`,
 * because a wordmark is usually wider than it is tall and slicing it crops the
 * company's name in half.
 */
function badge(uri, x, y, size, id) {
  if (!uri) return '';
  const r = Math.round(size * 0.18);
  return [
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${COLOURS.white}" fill-opacity="0.06"/>`,
    `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>`,
    `<image href="${uri}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${id})"/>`,
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.7" stroke-width="2"/>`,
  ].join('\n');
}

/**
 * The largest size from `ladder` at which the whole value fits on one line,
 * or the smallest size with the tail clipped. Stepping the size down before
 * reaching for the scissors is what keeps "Bengaluru" large and "Rs 8,000 per
 * month" merely smaller, instead of both being cut to the same width.
 *
 * `em` is a parameter and not a constant because the two organisation names in
 * the top band are set with heavy tracking, and a line measured at the plain
 * bold em then runs a quarter of its length past the margin it was fitted to.
 */
function oneLine(value, widthPx, ladder, em) {
  const source = clean(value);
  const width = em || EM_BOLD;
  for (let i = 0; i < ladder.length; i += 1) {
    if (charsThatFit(widthPx, ladder[i], width) >= source.length) {
      return { size: ladder[i], lines: [source] };
    }
  }
  const size = ladder[ladder.length - 1];
  return { size, lines: [clip(source, widthPx, size, width)] };
}

/*
 * The labels are letter-spaced by 0.14em, and that spacing is not a rounding
 * error: on a fifteen-character label it is two whole characters of width.
 * Estimating label widths with the plain bold em is what let "REQUIRED SKILLS"
 * run out through the right edge of a narrow card and under the one beside it.
 */
const LABEL_SPACING = 0.14;
const LABEL_EM = EM_BOLD + LABEL_SPACING;

/*
 * The same arithmetic for the three other tracked lines on the poster.
 *
 * Each of these is a letter-spacing that is written into the document and was
 * not written into the estimate that chose the size — the identical mistake
 * the label pair above exists to prevent, made three more times. At 0.22em the
 * employer's name is nearly a third wider than the fitter believed, which is
 * how a fifty-character name ends up with its tail outside the canvas.
 */
const CTA_SPACING = 0.06;
const CTA_EM = EM_BOLD + CTA_SPACING;
const ORG_NAME_SPACING = 0.08;
const ORG_NAME_EM = EM_BOLD + ORG_NAME_SPACING;
const COMPANY_NAME_SPACING = 0.22;
const COMPANY_NAME_EM = EM_BOLD + COMPANY_NAME_SPACING;

/**
 * The internal geometry of a card of a given size.
 *
 * Split out from the drawing so the grid can ask the same questions the card
 * will answer — chiefly how much width is left for a label — before any markup
 * exists. Everything is a fraction of the card's own height, because the height
 * is not known until we know how many rows there are: a three-row poster gets
 * cards two thirds the height of a one-row poster, and hard-coded baselines put
 * the value through the floor of one of them.
 *
 * There are two arrangements, and which one applies is decided by height alone:
 *
 *   - **above** (150 px and taller): the icon on its own line, the label under
 *     it, the value under that. The classic spec-sheet card, and it needs the
 *     vertical room for three stacked things.
 *   - **beside** (under 150 px): the icon becomes a chip to the left of the
 *     label, sharing its line, and the value runs full width underneath. A
 *     three-row grid has about a hundred pixels per card, and stacking an icon,
 *     a label and two lines of value in that space put the icon's circle
 *     straight through the label — which is what this arrangement exists to
 *     prevent. The cost is that the label no longer has the full card width,
 *     which is why the grid measures before it draws.
 */
function metrics(width, height) {
  const inset = clamp(Math.round(width * 0.11), 16, 26);
  const pad = clamp(Math.round(height * 0.13), 12, 26);
  const iconR = clamp(Math.round(height * 0.13), 11, 20);
  const stacked = height >= 150;
  const labelCeiling = clamp(Math.round(height * 0.12), 11, 18);
  const chip = stacked ? 0 : (iconR * 2 + Math.round(iconR * 0.6));
  return {
    inset,
    pad,
    iconR,
    stacked,
    labelCeiling,
    iconCy: pad + iconR,
    labelX: inset + chip,
    labelAvail: Math.max(24, width - inset * 2 - chip),
    valueAvail: Math.max(40, width - inset * 2),
    /* Two lines of value need somewhere to put the second one. Below 96 the
       card holds a label and one line and nothing else, so the value is
       clipped instead of wrapped into the panel beneath it. */
    valueLines: height >= 96 ? 2 : 1,
  };
}

/**
 * The value's type sizes are a fraction of the card, not a fixed ladder.
 *
 * `fit` only ever steps a size *down* to satisfy a line count, so a ladder
 * starting at 34 will happily set 34-point type in a 64-pixel card whose one
 * line happens to be short — and the baseline lands below the panel, with the
 * word hanging over the card beneath. Deriving the ceiling from the height
 * means the largest size on offer is one the card can actually hold. The
 * stacked arrangement gets a smaller fraction than the chip one because it has
 * already spent a line of the card on the icon.
 */
function valueLadder(height, m) {
  const ceiling = m.valueLines > 1
    ? clamp(Math.round(height * (m.stacked ? 0.17 : 0.20)), 14, 30)
    : clamp(Math.round(height * 0.26), 14, 34);
  return [1, 0.86, 0.74, 0.64, 0.56].map((k) => Math.max(13, Math.round(ceiling * k)));
}

/** One fact card: a rounded panel, an icon circle, a gold label, a white value. */
function card(entry, {
  x, y, width, height, labelSize,
}) {
  const m = metrics(width, height);
  const iconCx = x + m.inset + m.iconR;
  const iconCy = y + m.iconCy;

  const value = m.valueLines > 1
    ? fit(entry.value, { widthPx: m.valueAvail, sizes: valueLadder(height, m), maxLines: 2 })
    : oneLine(entry.value, m.valueAvail, valueLadder(height, m));

  const labelY = m.stacked
    ? iconCy + m.iconR + labelSize + Math.round(height * 0.02)
    : iconCy + Math.round(labelSize * 0.36);
  const valueTop = m.stacked
    ? labelY + Math.round(value.size * 1.15)
    : iconCy + m.iconR + Math.round(value.size * 1.35);

  const iconSize = m.iconR * 1.5;
  const iconX = iconCx - iconSize / 2;
  const iconY = iconCy - iconSize / 2;
  const glyph = entry.glyphId
    ? drawGlyph(entry.glyphId, iconX, iconY, iconSize, COLOURS.gold, 1)
    : '';

  const body = block(x + m.inset, valueTop, value.lines, {
    size: value.size,
    weight: 700,
    fill: COLOURS.white,
    spacing: '-0.01em',
    lineHeight: Math.round(value.size * 1.16),
  });

  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#161d33"/>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.22" stroke-width="2"/>`,
    `<circle cx="${iconCx}" cy="${iconCy}" r="${m.iconR}" fill="${COLOURS.gold}" fill-opacity="0.14"/>`,
    glyph || drawIcon(entry.icon, iconX, iconY, iconSize, COLOURS.gold),
    text(x + m.labelX, labelY, entry.label.toUpperCase(), {
      size: labelSize, fill: COLOURS.gold, weight: 700, spacing: `${LABEL_SPACING}em`,
    }),
    body.svg,
  ].join('\n');
}

/*
 * The gap between cards, and the shortest a card may be.
 *
 * Module constants rather than literals inside grid() because build() has to
 * do the same sum before the grid exists: it decides where the first row may
 * start from how much room the rows will actually need, and a floor of 64 here
 * against a floor of 84 there is how the first row ended up drawn on top of
 * the role strip. One number, used by both, cannot drift.
 */
const GRID_GAP = 20;
const MIN_CARD_HEIGHT = 64;

/**
 * The grid, laid out from however many cards there turned out to be.
 *
 * Both axes are computed rather than fixed. Horizontally each row divides the
 * content width between its own members, so three cards are three wide cards
 * and five are five narrow ones — the alternative, a fixed column width, is
 * what made three facts look like three slivers pinned to the left margin.
 * Vertically the rows share whatever is left between the role line and the
 * call-to-action bar, capped so a single row does not become one enormous
 * card with a word floating in the middle of it.
 */
function grid(entries, { margin, contentWidth, top, bottom }) {
  if (!entries.length) return { svg: '', bottom: top };

  const shape = rowsFor(entries.length);
  const gap = GRID_GAP;
  const band = bottom - top;
  const share = Math.floor((band - gap * (shape.length - 1)) / shape.length);
  const ceiling = shape.length === 1 ? 168 : (shape.length === 2 ? 172 : 124);
  const height = Math.max(MIN_CARD_HEIGHT, Math.min(ceiling, share));
  const widths = shape.map((perRow) => Math.floor((contentWidth - gap * (perRow - 1)) / perRow));

  /*
   * One label size for the whole grid, chosen so that the longest label still
   * fits the narrowest card that has to hold it.
   *
   * Sizing each label to its own card would be the obvious thing and it looks
   * wrong: a row where DOMAIN is set two points larger than ALUMNI OUTCOMES
   * reads as a mistake, because a label is a label and they are meant to be
   * one voice. Clipping the long ones instead ("REQUIRED SK…") loses
   * information the card existed to carry. So the whole grid steps down
   * together, which nobody notices and which never cuts a word.
   */
  let labelSize = 18;
  let index = 0;
  for (let r = 0; r < shape.length; r += 1) {
    const m = metrics(widths[r], height);
    for (let c = 0; c < shape[r] && index < entries.length; c += 1) {
      const chars = Math.max(1, entries[index].label.length);
      labelSize = Math.min(
        labelSize,
        m.labelCeiling,
        Math.floor(m.labelAvail / (chars * LABEL_EM)),
      );
      index += 1;
    }
  }
  labelSize = Math.max(11, labelSize);

  const parts = [];
  let cursor = top;
  index = 0;
  for (let r = 0; r < shape.length; r += 1) {
    const perRow = shape[r];
    const width = widths[r];
    for (let c = 0; c < perRow && index < entries.length; c += 1) {
      parts.push(card(entries[index], {
        x: margin + c * (width + gap), y: cursor, width, height, labelSize,
      }));
      index += 1;
    }
    cursor += height + gap;
  }
  return { svg: parts.join('\n'), bottom: cursor - gap };
}

/* ── build ──────────────────────────────────────────────────────────────── */

/**
 * Which facts become cards.
 *
 * This is the function the whole design rests on: it returns only the facts
 * that have a value, in FACT_ORDER, already carrying their label and their
 * mark. Nothing downstream ever sees an absent fact, so nothing downstream
 * can draw an empty card or print the string "undefined".
 */
function cardsFrom(f, headlineUsedDomain) {
  const out = [];
  for (let i = 0; i < FACT_ORDER.length; i += 1) {
    const key = FACT_ORDER[i];
    const value = f[key];
    if (!value) continue;
    /* The role line under the headline falls back to the domain when there is
       no role. Printing the domain again immediately below, in a card, is the
       template-not-filled-in look this poster is trying to avoid. */
    if (key === 'domain' && headlineUsedDomain) continue;
    const meta = FACT_ICONS[key] || {};
    out.push({
      key,
      label: FACT_LABELS[key] || key,
      value,
      icon: meta.icon || 'spark',
      glyphId: meta.glyphFrom ? glyphIdFor(f[meta.glyphFrom]) : '',
    });
  }
  return out;
}

/**
 * Build the hiring poster.
 *
 * @param {object}  args
 * @param {object}  [args.facts]                the internship facts; all optional
 * @param {string}  [args.uid]                  makes every id in the document unique
 * @param {string}  [args.size]                 'square' (default) or 'portrait'
 * @param {string}  [args.orgLogoDataUri]       the publisher's mark, top-left
 * @param {string}  [args.orgName]              printed beside that mark
 * @param {string}  [args.companyLogoDataUri]   the employer's mark, large and faint
 * @param {string}  [args.companyName]          printed as type, logo or no logo
 * @returns {{svg, width, height, alt, missing, cards, usedOrgLogo, usedCompanyLogo, ground}}
 */
function build(args) {
  const a = args || {};
  const raw = a.facts || {};
  /*
   * `hasOwnProperty` and not a plain lookup, because `GROUNDS[a.size]` reaches
   * Object.prototype: `size: 'toString'` finds a function, which is truthy, so
   * the `|| GROUNDS.square` fallback never fires and the whole poster is then
   * built out of `undefined` — width="undefined", eighty NaN coordinates, and
   * a document the browser renders as nothing at all. The agent gets a size
   * string from a form value, and 'constructor' or '__proto__' is only an
   * unlucky string away. Anything not actually offered falls back to the
   * square, which is what the caller is told it got.
   */
  const ground = Object.prototype.hasOwnProperty.call(GROUNDS, a.size)
    ? GROUNDS[a.size]
    : GROUNDS.square;
  const { width, height, margin } = ground;
  const contentWidth = width - margin * 2;
  /* Every size below was chosen against the 1200-square. The portrait is the
     same poster at nine tenths, so one scalar keeps the two in proportion
     instead of two sets of hand-tuned numbers drifting apart. */
  const s = width / 1200;
  const px = (n) => Math.round(n * s);

  const f = {};
  for (let i = 0; i < FACT_ORDER.length; i += 1) {
    f[FACT_ORDER[i]] = clean(raw[FACT_ORDER[i]]);
  }
  f.role = clean(raw.role);
  const org = clean(raw.org) || BRAND.name;

  /* Logos may be passed at the top level or inside `facts` — the agent
     assembles one bag of fields from a form and it is not worth making it
     split them. The top level wins when both are present. */
  const orgLogo = safeLogo(a.orgLogoDataUri != null ? a.orgLogoDataUri : raw.orgLogoDataUri);
  const companyLogo = safeLogo(
    a.companyLogoDataUri != null ? a.companyLogoDataUri : raw.companyLogoDataUri,
  );
  const orgName = clean(a.orgName != null ? a.orgName : raw.orgName) || org;
  const companyName = clean(a.companyName != null ? a.companyName : raw.companyName);
  const cta = clean(a.cta != null ? a.cta : raw.cta) || DEFAULT_CTA;

  const missing = REQUIRED_FACTS.filter((key) => !(key === 'role' ? f.role : f[key]));

  /* The seed is everything that can vary the document, not a readable summary
     of it. An earlier seed was org, role, domain, ground and missing — under
     which two posters that differ only in stipend, location and openings mint
     byte-identical ids, which is precisely the gallery collision the prefix
     exists to prevent. It is harmless while every id'd definition depends only
     on the ground, and it stops being harmless the first time somebody adds a
     per-card clipPath. */
  const u = idPrefix(a.uid, JSON.stringify([
    org, f.role, ground.id, FACT_ORDER.map((key) => f[key]),
    orgName, companyName, cta, !!orgLogo, !!companyLogo,
  ]));

  /* The line under the headline: the role, or the domain when there is no
     role, or nothing. An empty gold strip is worse than no strip. */
  const headlineUsedDomain = !f.role && !!f.domain;
  const roleLine = (f.role || f.domain || '').toUpperCase();
  const cards = cardsFrom(f, headlineUsedDomain);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${org} is hiring`)}">`);
  parts.push(`<defs>
<linearGradient id="${u}bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${COLOURS.navy}"/>
<stop offset="1" stop-color="${COLOURS.ink}"/>
</linearGradient>
<radialGradient id="${u}glow" cx="0.82" cy="0.12" r="0.6">
<stop offset="0" stop-color="${COLOURS.gold}" stop-opacity="0.18"/>
<stop offset="1" stop-color="${COLOURS.gold}" stop-opacity="0"/>
</radialGradient>
</defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="url(#${u}bg)"/>`);
  parts.push(`<rect width="${width}" height="${height}" fill="url(#${u}glow)"/>`);

  /*
   * The large faint mark behind the headline.
   *
   * The client was specific — "no need to add the building, just add the logo
   * behind it" — so this is a watermark, not a badge: about a third of the
   * width, and faint enough that the headline reads straight over it. A real
   * employer logo beats a generic domain glyph when we have one, which is why
   * the company mark takes this slot and the domain glyph only fills it when
   * no logo was uploaded.
   *
   * It is emitted before every other element so that all of them paint over
   * it. Nothing below has to know it is there.
   */
  const watermarkSize = px(380);
  const watermarkX = width - margin - watermarkSize + px(44);
  const watermarkY = px(146);
  if (companyLogo) {
    parts.push(`<image href="${companyLogo}" x="${watermarkX}" y="${watermarkY}" width="${watermarkSize}" height="${watermarkSize}" preserveAspectRatio="xMidYMid meet" opacity="0.16"/>`);
  } else {
    const domainGlyph = glyphIdFor(`${f.domain} ${f.role} ${f.skills}`);
    const drawn = drawGlyph(domainGlyph, watermarkX, watermarkY, watermarkSize, COLOURS.gold, 0.09);
    parts.push(drawn || `<circle cx="${watermarkX + watermarkSize / 2}" cy="${watermarkY + watermarkSize / 2}" r="${Math.round(watermarkSize * 0.42)}" fill="${COLOURS.gold}" fill-opacity="0.07"/>`);
  }

  /* Top band: the publisher's mark, and its name beside the mark only when
     that name is not about to be shouted by the headline three lines below.
     The same twenty-eight characters twice in one corner reads as a bug. */
  const markSize = px(104);
  const markY = px(68);
  parts.push(badge(orgLogo || logoDataUri(), margin, markY, markSize, `${u}mark`));
  if (orgName && orgName !== org) {
    /* Fitted, not set at a fixed size: the name of an institution is routinely
       sixty characters, and the room beside the mark is what is left of the
       line after the mark has taken its share of it. */
    const nameX = margin + markSize + px(22);
    const nameFit = oneLine(orgName, width - margin - nameX,
      [px(26), px(23), px(20)], ORG_NAME_EM);
    parts.push(text(nameX, markY + Math.round(markSize * 0.62), nameFit.lines[0], {
      size: nameFit.size, fill: COLOURS.muted, weight: 600, spacing: `${ORG_NAME_SPACING}em`,
    }));
  }

  /*
   * The employer's name, always in type.
   *
   * A logo at sixteen per cent opacity is a texture, not a caption — a reader
   * cannot name a company from it, and a poster that never spells out who is
   * hiring is a poster that fails at its one job. So the name is printed
   * whether or not the mark was readable, and the mark is decoration.
   */
  if (companyName) {
    const employerFit = oneLine(companyName.toUpperCase(), contentWidth,
      [px(26), px(23), px(20)], COMPANY_NAME_EM);
    parts.push(text(margin, px(232), employerFit.lines[0], {
      size: employerFit.size, fill: COLOURS.gold, weight: 700, spacing: `${COMPANY_NAME_SPACING}em`,
    }));
  }

  /* Headline: the organisation small, then the two words that carry the post. */
  const orgFit = fit(org, {
    widthPx: contentWidth, sizes: [px(52), px(44), px(38), px(32)], maxLines: 2,
  });
  const orgBlock = block(margin, px(336), orgFit.lines, {
    size: orgFit.size, weight: 600, fill: COLOURS.muted, spacing: '0.01em',
    lineHeight: Math.round(orgFit.size * 1.14),
  });
  parts.push(orgBlock.svg);

  const hiringFit = fit('IS HIRING', {
    widthPx: contentWidth, sizes: [px(168), px(148), px(128), px(108)], maxLines: 1, em: EM_BLACK,
  });
  const hiringY = orgBlock.bottom + Math.round(hiringFit.size * 0.92);
  parts.push(text(margin, hiringY, hiringFit.lines[0] || 'IS HIRING', {
    size: hiringFit.size, weight: 800, fill: COLOURS.white, spacing: '-0.035em',
  }));

  /*
   * The role on a gold strip.
   *
   * The strip is sized from the same em estimate the fitter uses, because
   * there is nothing on the server that can measure a string. That estimate is
   * generous by a few per cent, which is the direction to be wrong in: a strip
   * slightly wider than its word looks like a designed lozenge, a strip
   * slightly narrower looks like the text has broken out of its box.
   */
  let roleBottom = hiringY + px(18);
  if (roleLine) {
    const roleFit = fit(roleLine, {
      widthPx: contentWidth - px(56), sizes: [px(46), px(40), px(34), px(30)], maxLines: 2, em: EM_BLACK,
    });
    const stripH = Math.round(roleFit.size * 1.5);
    const padX = Math.round(roleFit.size * 0.5);
    let stripTop = hiringY + px(30);
    for (let i = 0; i < roleFit.lines.length; i += 1) {
      const line = roleFit.lines[i];
      const est = Math.ceil(line.length * roleFit.size * EM_BLACK) + padX * 2;
      const stripW = Math.min(contentWidth, est);
      parts.push(`<rect x="${margin}" y="${stripTop}" width="${stripW}" height="${stripH}" rx="${Math.round(stripH * 0.22)}" fill="${COLOURS.gold}"/>`);
      parts.push(text(margin + padX, stripTop + Math.round(stripH * 0.7), line, {
        size: roleFit.size, weight: 800, fill: COLOURS.ink, spacing: '0.01em',
      }));
      stripTop += stripH + px(10);
    }
    roleBottom = stripTop - px(10);
  }

  /* The call-to-action bar, and the floor the cards must stay above. */
  const barH = px(96);
  const barY = height - px(180);
  const cardsBottom = barY - px(26);

  /*
   * Where the cards start: below the role strip, above the gold bar, and never
   * on top of either.
   *
   * The grid is pushed down by a long role and pulled up by a third row, so
   * this needs both a floor and a ceiling. It had only a ceiling, and the
   * failure was not the crowding an earlier note here predicted: the card
   * panels are opaque and are painted after the role strips, so a first row
   * that climbed 26 pixels into the block above did not crowd the role, it
   * sliced the gold lozenge off through the middle of its second line.
   *
   * The band reserved for the grid is the one the grid will actually use —
   * every row at MIN_CARD_HEIGHT with GRID_GAP between them — rather than a
   * larger guess. Reserving more than the grid needs is what forced the top
   * upwards in the first place.
   */
  const bandFor = (rows) => (rows.length
    ? rows.length * MIN_CARD_HEIGHT + (rows.length - 1) * GRID_GAP
    : 0);

  /* And if even the floor cannot be honoured — an org and a role both long
     enough to push the strip down past the room the rows need — the grid sheds
     its last cards rather than painting over the role or the bar. FACT_ORDER
     is a priority order, so what goes is what the poster can most afford to
     lose. Eleven facts cannot reach this on either ground today; the loop is
     here so that a twelfth cannot quietly bring the overlap back. */
  let shown = cards;
  while (shown.length > 1 && roleBottom + px(20) + bandFor(rowsFor(shown.length)) > cardsBottom) {
    shown = shown.slice(0, shown.length - 1);
  }

  const minBand = bandFor(rowsFor(shown.length));
  const cardsTop = clamp(cardsBottom - minBand, roleBottom + px(20), roleBottom + px(56));
  const laid = grid(shown, {
    margin, contentWidth, top: cardsTop, bottom: cardsBottom,
  });
  parts.push(laid.svg);

  parts.push(`<rect x="0" y="${barY}" width="${width}" height="${barH}" fill="${COLOURS.gold}"/>`);
  const ctaFit = fit(cta.toUpperCase(), {
    widthPx: contentWidth, sizes: [px(38), px(33), px(29), px(25), px(22)], maxLines: 1, em: CTA_EM,
  });
  parts.push(text(width / 2, barY + Math.round(barH * 0.64), ctaFit.lines[0] || '', {
    size: ctaFit.size, weight: 800, fill: COLOURS.ink, spacing: `${CTA_SPACING}em`, anchor: 'middle',
  }));

  parts.push(text(margin, height - px(46), BRAND.site.replace(/^https?:\/\//, ''), {
    size: px(26), fill: COLOURS.muted, weight: 500, spacing: '0.04em', opacity: '0.8',
  }));

  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    width,
    height,
    ground: ground.id,
    /* What was drawn, not what was offered: if the grid had to shed a card the
       alt text and the caller's list must say so too. */
    alt: altFor({ org, companyName, role: f.role, facts: f, cards: shown }),
    missing,
    cards: shown.map((c) => c.key),
    usedOrgLogo: !!orgLogo,
    usedCompanyLogo: !!companyLogo,
  };
}

/**
 * The accessibility label, which is also what LinkedIn stores as the image's
 * alt text. It lists the same facts the picture does, in the same order, so a
 * reader on a screen reader gets the spec sheet rather than "image".
 */
function altFor({ org, companyName, role, cards }) {
  const bits = [`${org} is hiring`];
  if (role) bits.push(role);
  if (companyName) bits.push(`at ${companyName}`);
  const facts = cards.map((c) => `${c.label}: ${c.value}`).join(', ');
  const head = bits.join(' — ');
  return (facts ? `${head}. ${facts}.` : `${head}.`).slice(0, 300);
}

module.exports = {
  build,
  FACT_ORDER,
  REQUIRED_FACTS,
  FACT_LABELS,
  DEFAULT_CTA,
  MAX_LOGO_CHARS,
  GROUNDS,
};
