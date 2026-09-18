'use strict';

/**
 * The roll of honour — the placement poster, with faces on it.
 *
 * Every other design in the gallery sets one sentence on a ground. This one
 * is different in kind: it is the post the company exists to make. "These
 * students did our internship, and this is where they are now." Names,
 * companies, and photographs. An opening can be announced in text; a
 * placement without the student's face is a claim, and a placement with it is
 * a proof.
 *
 * Three things follow from that, and they are most of this file:
 *
 *   1. The photographs arrive from a browser as `data:` URIs, which is the
 *      only form an SVG can carry (the poster is rasterised through
 *      <img> -> <canvas>, and any external href taints the canvas so
 *      toDataURL throws and the post goes out with no image at all). A data
 *      URI from a file picker is untrusted input: somebody will eventually
 *      drop in a PDF, a 40 MB RAW file, or a `javascript:` string pasted from
 *      somewhere. None of those may reach the document. Anything that is not
 *      a plainly-encoded raster image of sane size is treated as "no photo"
 *      and the student gets their initials instead — the poster is not the
 *      place to discover the upload was wrong, and a broken-image glyph on
 *      the company's proudest post is unforgivable.
 *
 *   2. Nothing may overlap. Nine names of unknown length in nine cells is the
 *      classic way a generated poster ends up with "Lakshminarayanan" written
 *      through "Venkataraman". Every string is measured against its own cell
 *      before it is drawn and elided if it does not fit, using the same
 *      characters-that-fit estimate the rest of the gallery uses — SVG has no
 *      text-measuring API on the server, so the width is estimated from the
 *      font size and then the layout is chosen to suit the estimate.
 *
 *   3. There is a limit. Nine faces on a 1200-pixel square is already a
 *      passport page; at twelve the faces are too small to be anybody. So the
 *      poster caps at nine and reports the remainder, and the agent says "and
 *      four more" in the post text where there is room to say it properly.
 *
 * The ground is the Spotlight palette — deep navy, a pool of light, a gold
 * ring — so it reads as a celebration and still belongs to the same family as
 * the six designs in posterDesigns.js.
 */

const {
  COLOURS, BRAND, escapeXml, wrap, logoDataUri,
} = require('./posterStudio');

const FONT = 'Outfit, Inter, Arial, sans-serif';

/* Advance width per character as a fraction of the font size — the same
   constants posterDesigns.js fits its headlines with. Copied rather than
   imported so this module depends only on posterStudio: the gallery and the
   roll of honour are rendered on the same turn, and a require cycle between
   them would be a silent partial-module bug rather than a loud one. */
const EM_BOLD = 0.56;
const EM_REGULAR = 0.52;

const MAX_STUDENTS = 9;

/*
 * The ceiling on a single accepted photograph, measured on the data URI string.
 *
 * Base64 is about a third larger than the bytes it carries, so two million
 * characters is roughly a 1.5 MB image — far more than a face needs at 220
 * pixels across. Above that the usual cause is somebody attaching a camera
 * original or a document, and the poster silently falls back to initials
 * rather than building a huge string that hangs the tab.
 */
const MAX_PHOTO_CHARS = 2 * 1024 * 1024;

/*
 * The ceiling on all the photographs in one document, which is a separate
 * limit and has to be.
 *
 * Capping each upload is not the same as capping the poster: nine uploads each
 * just under MAX_PHOTO_CHARS are all individually legal and together make an
 * eighteen-megabyte SVG. The dashboard cannot show that. It runs the document
 * through encodeURIComponent and then base64 before it can put it in an
 * <img src>, so an eighteen-megabyte string becomes a twenty-four-megabyte
 * data URI built by two full passes over it, the rasteriser gives up on its
 * own timeout, and the result is exactly the picture-less post this module
 * exists to prevent — plus the same string travelling back in the agent's JSON
 * turn response.
 *
 * So the document has a budget as well. Photographs are accepted in order
 * until it is spent and every student after that is drawn with their initials,
 * which is a composed poster rather than a missing one. `withPhotos` in the
 * result is how the dashboard can see it happened and warn before publishing.
 */
const MAX_TOTAL_PHOTO_CHARS = 4 * 1024 * 1024;

/*
 * The accepted photograph grammar, in two halves so neither half has to scan
 * a two-megabyte string more than once.
 *
 * Only raster types are allowed. `image/svg+xml` is deliberately absent: an
 * SVG nested in an SVG can carry its own <image href>, its own <style>, and
 * its own script, which is exactly the external reference this document must
 * not contain. Only standard base64 is allowed too — no percent-encoded
 * payloads — and that restriction is also what makes the value safe to drop
 * straight into an attribute, because the base64 alphabet contains none of
 * the characters XML cares about.
 */
const PHOTO_HEAD = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i;
const PHOTO_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/*
 * The two shapes this poster is offered in.
 *
 * The link-preview landscape (1200x627) is not among them on purpose: three
 * rows of faces in 270 pixels of height gives 34-pixel portraits, which is a
 * thumbnail of a thumbnail. A caller asking for anything else gets the
 * square, and the shape it actually got is reported back in the result.
 */
const GROUNDS = {
  square: { id: 'square', width: 1200, height: 1200, margin: 96 },
  portrait: { id: 'portrait', width: 1080, height: 1350, margin: 88 },
};

/**
 * The grid for each number of faces.
 *
 * `perRow` is spelled out rather than computed because the distribution is a
 * design decision, not arithmetic: five faces are three over two (a pediment)
 * and never two over three (a funnel), and seven is three-two-two so the top
 * row still reads as the top row. Rows with fewer members than the column
 * count are centred, which is what makes the shape hold.
 */
const LAYOUTS = {
  1: { id: 'solo', rows: 1, columns: 1, perRow: [1] },
  2: { id: 'row', rows: 1, columns: 2, perRow: [2] },
  3: { id: 'row', rows: 1, columns: 3, perRow: [3] },
  4: { id: 'grid', rows: 2, columns: 2, perRow: [2, 2] },
  5: { id: 'grid', rows: 2, columns: 3, perRow: [3, 2] },
  6: { id: 'grid', rows: 2, columns: 3, perRow: [3, 3] },
  7: { id: 'grid', rows: 3, columns: 3, perRow: [3, 2, 2] },
  8: { id: 'grid', rows: 3, columns: 3, perRow: [3, 3, 2] },
  9: { id: 'grid', rows: 3, columns: 3, perRow: [3, 3, 3] },
};

/* No students is not an error: the agent can ask for the poster before the
   names are in, and an empty ground with the headline on it is a better
   answer than a thrown exception in the middle of a conversation. */
const EMPTY_LAYOUT = { id: 'empty', rows: 0, columns: 0, perRow: [] };

/* This poster's own kicker vocabulary. It duplicates posterDesigns.KICKERS by
   a few words on purpose — see the note on the em constants above. */
const KICKERS = {
  placement: 'Placement story',
  opening: 'Internship opening',
  leadgen: 'For students and freshers',
  general: BRAND.short,
};

const DEFAULT_HEADLINE = `Placed after their internship at ${BRAND.short}`;

/* How long the screen-reader description may be. Nine names and nine companies
   run well past anything a reader wants read aloud before the picture. */
const ALT_MAX = 300;

/* ── small helpers, in the house style of posterDesigns.js ──────────────── */

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * A lookup that cannot be answered by Object.prototype.
 *
 * `size` and `kind` arrive as free-form strings from the agent and the
 * dashboard, so they are eventually going to be something nobody planned for.
 * A plain `TABLE[key] || fallback` walks the prototype chain for them, and the
 * two ways that goes wrong are both silent until they are loud: `size:
 * 'toString'` returns an inherited function whose `.width` is undefined, and
 * the poster is emitted as `<svg width="undefined">` with NaN all through it;
 * `kind: 'constructor'` returns Object itself and the render throws
 * `kicker.toUpperCase is not a function` in the middle of a conversation.
 * Both are documented to fall back, so the lookup has to ask whether the table
 * really owns the key.
 */
function own(table, key, fallback) {
  return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key))
    ? table[key]
    : fallback;
}

/**
 * The same string with any half-character removed.
 *
 * Every cut this file makes is on a code-point boundary, but `wrap` in
 * posterStudio splits a long unbroken word by UTF-16 unit, so a one-token
 * headline carrying an emoji can still arrive here sliced through a surrogate
 * pair. A lone surrogate is not a legal XML character and it is not merely
 * ugly: the dashboard renders the poster by calling encodeURIComponent on the
 * document before base64-encoding it into an <img src>, and that throws
 * `URI malformed` on an orphan, so the preview never gets a src at all. Losing
 * half an emoji is the cheapest possible price for keeping the poster.
 */
function paired(value) {
  const s = String(value);
  if (!/[\uD800-\uDFFF]/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i += 1; }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) continue;
    out += s[i];
  }
  return out;
}

function charsThatFit(widthPx, fontSize, em) {
  return Math.max(4, Math.floor(widthPx / (fontSize * em)));
}

/** The largest size from `sizes` at which `value` fits inside `maxLines`. */
function fit(value, { widthPx, sizes, maxLines, em = EM_BOLD }) {
  let chosen = null;
  for (let i = 0; i < sizes.length; i += 1) {
    const lines = wrap(value, charsThatFit(widthPx, sizes[i], em));
    chosen = { size: sizes[i], lines };
    if (lines.length <= maxLines) return chosen;
  }
  const lines = chosen.lines.slice(0, maxLines);
  if (chosen.lines.length > maxLines) {
    /* Drop the trailing word only when a word survives it. When the last
       permitted line holds a single long token — one very long name, or a
       headline that wrapped badly — removing that token leaves nothing, and
       what gets drawn is a line reading " …" on its own, which looks like the
       renderer failed rather than like an elision. In that case the token is
       cut mid-way instead, which is exactly what clip() does one function
       below and for the same reason. */
    const head = lines[maxLines - 1].replace(/\s*\S*$/, '').trim();
    lines[maxLines - 1] = head
      ? `${head} …`
      : `${Array.from(lines[maxLines - 1]).slice(0, -1).join('').trim()}…`;
  }
  return { size: chosen.size, lines };
}

/**
 * One line of text cut to the width it has been given.
 *
 * A name under a face gets one line and no more, so this elides rather than
 * wraps. The whole trailing word is dropped when doing so still leaves half a
 * line — "Venkataraman Sub…" reads better than "Venkataraman S…" — but a
 * single unbroken token (an address pasted into the company field, say) is
 * cut mid-word, because dropping the only word would leave an empty cell.
 */
function clip(value, widthPx, fontSize, em) {
  const source = clean(value);
  /* Measured and cut in characters, not UTF-16 units. `charsThatFit` counts
     characters, so a company written with emoji in it is over-counted two to
     one by String#length — but the real damage is the cut: slicing by unit can
     land between the two halves of a surrogate pair and leave an orphan in a
     text node. That is not legal XML, and the dashboard's encodeURIComponent
     pass over the document throws on it, so a single emoji in one company
     field takes the whole poster down. initialsFor a few functions below walks
     the name with Array.from for precisely this reason; so does this. */
  const chars = Array.from(source);
  const max = charsThatFit(widthPx, fontSize, em);
  if (!source || chars.length <= max) return source;
  const cut = chars.slice(0, Math.max(1, max - 1)).join('');
  const whole = cut.replace(/\s+\S*$/, '').trim();
  return `${Array.from(whole).length >= Math.ceil(max / 2) ? whole : cut.trim()}…`;
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
  return `<text ${attrs.join(' ')}>${escapeXml(paired(content))}</text>`;
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
 * The TEN mark as a rounded badge, as in every other design.
 *
 * The PNG has an opaque white ground, so it is clipped to a rounded rectangle
 * with a gold hairline: a white card reads as a deliberate badge, a raw white
 * square reads as a sticker. A missing file means no badge rather than a
 * broken image.
 */
function mark(x, y, size) {
  const logo = logoDataUri();
  if (!logo) return '';
  const r = Math.round(size * 0.18);
  const id = `rohm${x}${y}${size}`;
  return [
    `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>`,
    `<image href="${logo}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`,
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.7" stroke-width="2"/>`,
  ].join('\n');
}

/* ── the untrusted part ─────────────────────────────────────────────────── */

/**
 * The student's photograph, or an empty string if it is not one.
 *
 * Everything this rejects has been seen in some form: a `javascript:` URI
 * pasted into a text field, an `http://` link to the student's LinkedIn photo
 * (which would taint the canvas and lose the whole image), a PDF from a file
 * picker with no accept filter, and an SVG that could carry a script. The
 * function is deliberately a whitelist: anything not recognised is not a
 * photograph, and a face this cannot verify becomes initials.
 */
function safePhoto(value) {
  if (typeof value !== 'string') return '';
  const uri = value.trim();
  if (!uri || uri.length > MAX_PHOTO_CHARS) return '';
  const head = PHOTO_HEAD.exec(uri);
  if (!head) return '';
  const body = uri.slice(head[0].length);
  /* An empty payload passes the head test and renders as a broken image, so
     the body is checked for content as well as for alphabet. */
  if (!body || !PHOTO_BODY.test(body)) return '';
  return uri;
}

/**
 * The initials that stand in for a missing photograph.
 *
 * First and last word, so "Priya Anand Sharma" is PS rather than PA. The name
 * is walked with Array.from because indexing a string by [0] returns half of
 * any character outside the basic plane, and half a character renders as a
 * replacement box on the poster.
 */
function initialsFor(name) {
  const words = clean(name).split(' ').filter(Boolean);
  if (!words.length) return '';
  const first = Array.from(words[0])[0] || '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] || '') : '';
  return (first + last).toUpperCase();
}

/**
 * Turn whatever the agent passed into the students this poster can draw.
 *
 * Entries that carry nothing at all are dropped rather than drawn: a form
 * with a spare empty row at the bottom would otherwise contribute a nameless
 * grey disc to the company's proudest post, and would count towards the nine.
 */
function normalise(students) {
  const list = Array.isArray(students) ? students : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    const entry = typeof raw === 'string' ? { name: raw } : (raw || {});
    const name = clean(entry.name);
    const company = clean(entry.company);
    const role = clean(entry.role);
    const photo = safePhoto(entry.photoDataUri);
    if (!name && !company && !role && !photo) continue;
    out.push({ name, company, role, photo, initials: initialsFor(name) });
  }
  return out;
}

/**
 * Spend the document's photograph budget over the students who are drawn.
 *
 * Applied to the nine that are shown rather than to everything that arrived,
 * so a run of oversized uploads at the end of a twelve-student list — people
 * who are not on the poster at all — cannot take the photographs off the
 * people who are. The students are already this function's own objects, made
 * one at a time in normalise, so demoting one to initials is a local edit.
 */
function withinBudget(students) {
  let spent = 0;
  for (let i = 0; i < students.length; i += 1) {
    const student = students[i];
    if (!student.photo) continue;
    if (spent + student.photo.length > MAX_TOTAL_PHOTO_CHARS) {
      student.photo = '';
      continue;
    }
    spent += student.photo.length;
  }
  return students;
}

/* ── faces ──────────────────────────────────────────────────────────────── */

/**
 * The circular portrait itself, without any type.
 *
 * Both layouts draw the same face at different scales, so this is the piece
 * they share. The disc underneath is not decoration — a PNG with transparency
 * would otherwise show the navy ground through the student's head. The clip is
 * a circle and the image is `xMidYMid slice`, so a portrait, a landscape snap
 * and a square crop all fill the same circle without stretching anybody's
 * face. The clip id carries the index because nine <clipPath> elements with
 * the same id in one document leave eight students wearing the first one's
 * crop.
 */
function portrait(student, { cx, cy, r, id, strokeWidth }) {
  const parts = [`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a2138"/>`];
  if (student.photo) {
    parts.push(`<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`);
    parts.push(`<image href="${student.photo}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`);
  } else {
    /* No photograph: a gold-tinted disc with the initials in it. It is a
       deliberate mark rather than a placeholder, so a roll of honour where
       half the students never sent a picture still looks composed. */
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${COLOURS.gold}" fill-opacity="0.14"/>`);
    if (student.initials) {
      parts.push(text(cx, cy + Math.round(r * 0.36), student.initials, {
        size: Math.round(r * 0.9), weight: 700, fill: COLOURS.gold, anchor: 'middle', spacing: '0.02em',
      }));
    }
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLOURS.gold}" stroke-opacity="0.85" stroke-width="${strokeWidth || Math.max(3, Math.round(r * 0.045))}"/>`);
  return parts.join('\n');
}

/** One student in a grid cell: the portrait, the name, the company. */
function face(student, { cx, cy, r, nameSize, companySize, cellWidth, index }) {
  const parts = [portrait(student, { cx, cy, r, id: `rohf${index}` })];

  /* The text is measured against the cell, not the circle: neighbouring cells
     touch, so a name wider than its cell is what collides with the next
     student, and that is the width the estimate has to respect. */
  const textWidth = cellWidth - 24;
  const nameY = cy + r + nameSize + Math.round(nameSize * 0.45);
  parts.push(text(cx, nameY, clip(student.name, textWidth, nameSize, EM_BOLD), {
    size: nameSize, weight: 700, anchor: 'middle', spacing: '-0.01em',
  }));

  /* Company in gold. When a student's company is missing but their role is
     not, the role takes the line — an empty second line under a face looks
     like the data failed to load. */
  const second = student.company || student.role;
  if (second) {
    parts.push(text(cx, nameY + companySize + Math.round(companySize * 0.55), clip(second, textWidth, companySize, EM_REGULAR), {
      size: companySize, weight: 600, fill: COLOURS.gold, anchor: 'middle', spacing: '0.02em',
    }));
  }
  return parts.join('\n');
}

/**
 * Where the faces go.
 *
 * The radius is taken from the row before the type is sized, and the type
 * from the radius, so a row of nine and a row of two are the same design at
 * two scales rather than two designs. The last step is the one that matters:
 * if the portrait plus its two lines is taller than the row it sits in, the
 * portrait shrinks. That single clamp is what stops the bottom row of a
 * nine-student poster from printing its companies over the footer rule.
 */
function gridMetrics(ground, layout, top, bottom) {
  const rowHeight = (bottom - top) / layout.rows;
  const cellWidth = (ground.width - 2 * ground.margin) / layout.columns;

  let r = Math.floor(Math.min(cellWidth * 0.32, rowHeight * 0.29));
  let nameSize = clamp(Math.round(r * 0.46), 16, 42);
  let companySize = clamp(Math.round(nameSize * 0.72), 13, 30);
  let textHeight = Math.round(nameSize * 1.45 + companySize * 1.55);

  if (r * 2 + textHeight + 16 > rowHeight) {
    r = Math.max(24, Math.floor((rowHeight - textHeight - 16) / 2));
    nameSize = clamp(Math.round(r * 0.46), 16, 42);
    companySize = clamp(Math.round(nameSize * 0.72), 13, 30);
    textHeight = Math.round(nameSize * 1.45 + companySize * 1.55);
  }

  return {
    rowHeight, cellWidth, radius: r, nameSize, companySize, blockHeight: r * 2 + textHeight,
  };
}

function drawGrid(students, ground, layout, top, bottom) {
  const m = gridMetrics(ground, layout, top, bottom);
  const parts = [];
  let index = 0;
  for (let row = 0; row < layout.perRow.length; row += 1) {
    const inRow = layout.perRow[row];
    const rowTop = top + row * m.rowHeight;
    const cy = rowTop + (m.rowHeight - m.blockHeight) / 2 + m.radius;
    /* Short rows are centred on the poster's spine rather than left-aligned
       under the row above, which is what makes five read as a pediment. */
    const startX = ground.width / 2 - (inRow * m.cellWidth) / 2;
    for (let col = 0; col < inRow; col += 1) {
      const student = students[index];
      if (!student) break;
      parts.push(face(student, {
        cx: Math.round(startX + (col + 0.5) * m.cellWidth),
        cy: Math.round(cy),
        r: m.radius,
        nameSize: m.nameSize,
        companySize: m.companySize,
        cellWidth: m.cellWidth,
        index,
      }));
      index += 1;
    }
  }
  return { svg: parts.join('\n'), metrics: m };
}

/**
 * The single student, who gets the whole poster.
 *
 * One face in a grid cell is a poster with a lot of navy on it, so one
 * student is a portrait instead: a large circle on the left and the name set
 * as big as it will go beside it. This is the only layout that shows the role
 * as well as the company, because it is the only one with room for a third
 * line that does not crowd anybody.
 */
function drawSolo(student, ground, top, bottom) {
  const height = bottom - top;
  const r = Math.floor(Math.min((ground.width - 2 * ground.margin) * 0.30, height * 0.34));
  const cx = ground.margin + r;
  const cy = Math.round(top + height / 2);
  const textX = cx + r + Math.round(r * 0.28);
  const textWidth = ground.width - ground.margin - textX;

  const parts = [portrait(student, { cx, cy, r, id: 'rohsolo', strokeWidth: 6 })];

  const name = fit(student.name || BRAND.short, {
    widthPx: textWidth, sizes: [76, 64, 54, 46, 38], maxLines: 2,
  });
  const lineHeight = Math.round(name.size * 1.1);
  const companySize = Math.max(24, Math.round(name.size * 0.46));
  const roleSize = Math.max(19, Math.round(companySize * 0.78));
  const blockHeight = name.lines.length * lineHeight
    + (student.company ? Math.round(companySize * 1.7) : 0)
    + (student.role ? Math.round(roleSize * 1.5) : 0);

  let cursor = Math.round(cy - blockHeight / 2 + name.size * 0.78);
  const names = block(textX, cursor, name.lines, {
    size: name.size, weight: 700, spacing: '-0.02em', lineHeight,
  });
  parts.push(names.svg);
  cursor = names.bottom;

  if (student.company) {
    cursor += Math.round(companySize * 1.7);
    parts.push(text(textX, cursor, clip(student.company, textWidth, companySize, EM_BOLD), {
      size: companySize, weight: 600, fill: COLOURS.gold, spacing: '0.02em',
    }));
  }
  if (student.role) {
    cursor += Math.round(roleSize * 1.5);
    parts.push(text(textX, cursor, clip(student.role, textWidth, roleSize, EM_REGULAR), {
      size: roleSize, weight: 400, fill: COLOURS.muted,
    }));
  }
  return { svg: parts.join('\n'), metrics: { radius: r, nameSize: name.size, companySize } };
}

/* ── build ──────────────────────────────────────────────────────────────── */

function altFor(headline, students, overflow) {
  const people = students.map((s) => {
    const where = s.company || s.role;
    return where ? `${s.name || 'A TEN intern'} at ${where}` : (s.name || '');
  }).filter(Boolean);
  const tail = overflow > 0 ? `and ${overflow} more` : '';
  const full = [headline, people.concat(tail ? [tail] : []).join(', '), BRAND.name]
    .filter(Boolean).join('. ');
  /* The 300 is a budget in UTF-16 units, because that is what LinkedIn and
     every length check downstream count in, so the cut stays a .slice — but a
     .slice can land inside a surrogate pair, and this string is not only
     returned to the agent as the image's alt text, it is written into the
     document's aria-label. A half-character in an attribute is worse than one
     in a text node: it makes the whole document reject on a strict XML parse,
     and it throws the dashboard's encodeURIComponent step before the poster is
     ever shown. So the orphan is trimmed back off after the cut. */
  return paired(full.slice(0, ALT_MAX));
}

/**
 * Build the roll of honour.
 *
 * @param {object} args
 * @param {Array}  args.students  [{ name, company, role, photoDataUri }]
 * @param {string} [args.headline] defaults to "Placed after their internship at TEN"
 * @param {string} [args.kind]     which kicker to print; defaults to the placement one
 * @param {string} [args.size]     'square' (default) or 'portrait'
 * @returns {{svg, width, height, alt, count, overflow, total, withPhotos, layout, size, headline}}
 */
function build({ students, headline, kind, size } = {}) {
  const ground = own(GROUNDS, size, GROUNDS.square);
  const all = normalise(students);
  const shown = withinBudget(all.slice(0, MAX_STUDENTS));
  const overflow = all.length - shown.length;
  /* LAYOUTS is indexed by a count, not by a caller's string, so there is no
     inherited key it can reach — unlike the two lookups around it. */
  const layout = LAYOUTS[shown.length] || EMPTY_LAYOUT;
  const title = clean(headline) || DEFAULT_HEADLINE;
  const kicker = own(KICKERS, kind, KICKERS.placement);
  const alt = altFor(title, shown, overflow);

  const W = ground.width;
  const H = ground.height;
  const contentWidth = W - 2 * ground.margin;

  /* The bands. The mark, kicker and headline own the top; the site owns the
     bottom; whatever is left in between is the grid's, and the grid sizes
     itself to it. Deriving the middle from the two ends rather than fixing it
     is what lets a two-line headline push the faces down instead of writing
     over them. */
  const markSize = Math.round(W * 0.087);
  const markY = Math.round(H * 0.052);
  const kickerY = markY + markSize + Math.round(H * 0.045);
  const headTop = kickerY + Math.round(H * 0.068);
  const head = fit(title, {
    widthPx: contentWidth,
    sizes: [72, 62, 54, 46, 40].map((s) => Math.round(s * (W / 1200))),
    maxLines: 2,
  });
  const headLineHeight = Math.round(head.size * 1.12);
  const heading = block(W / 2, headTop, head.lines, {
    size: head.size, weight: 700, anchor: 'middle', spacing: '-0.02em', lineHeight: headLineHeight,
  });

  const footRuleY = H - Math.round(H * 0.117);
  const siteY = H - Math.round(H * 0.058);
  const gridTop = heading.bottom + Math.round(H * 0.05);
  /* When there are more students than fit, the poster says so itself as well
     as reporting it — a roll of honour that quietly drops four people is a
     worse failure than one that is a line shorter. The room for that line is
     taken out of the grid before the faces are placed, never after. */
  const noteHeight = overflow > 0 ? Math.round(H * 0.045) : 0;
  const gridBottom = footRuleY - Math.round(H * 0.028) - noteHeight;

  const body = shown.length === 1
    ? drawSolo(shown[0], ground, gridTop, gridBottom)
    : (shown.length ? drawGrid(shown, ground, layout, gridTop, gridBottom) : { svg: '', metrics: null });

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(paired(alt))}">`,
    `<defs><radialGradient id="rohbg" cx="0.5" cy="0.4" r="0.66">
<stop offset="0" stop-color="#1c2340"/><stop offset="0.55" stop-color="#0d1020"/><stop offset="1" stop-color="${COLOURS.ink}"/></radialGradient>
<radialGradient id="rohglow" cx="0.5" cy="0.33" r="0.45">
<stop offset="0" stop-color="${COLOURS.gold}" stop-opacity="0.2"/><stop offset="1" stop-color="${COLOURS.gold}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#rohbg)"/>`,
    `<rect width="${W}" height="${H}" fill="url(#rohglow)"/>`,
    `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="${COLOURS.goldDeep}" stroke-opacity="0.3" stroke-width="2"/>`,
    mark(Math.round((W - markSize) / 2), markY, markSize),
    text(W / 2, kickerY, kicker.toUpperCase(), {
      size: 22, fill: COLOURS.gold, weight: 600, spacing: '0.24em', anchor: 'middle',
    }),
    heading.svg,
    body.svg,
  ];

  if (overflow > 0) {
    parts.push(text(W / 2, footRuleY - Math.round(H * 0.022), `and ${overflow} more`, {
      size: 30, fill: COLOURS.gold, weight: 600, anchor: 'middle', spacing: '0.04em', opacity: '0.85',
    }));
  }

  parts.push(`<rect x="${ground.margin}" y="${footRuleY}" width="${contentWidth}" height="1" fill="${COLOURS.gold}" fill-opacity="0.3"/>`);
  parts.push(text(W / 2, siteY, BRAND.site.replace(/^https?:\/\//, ''), {
    size: 26, fill: COLOURS.muted, weight: 500, spacing: '0.04em', anchor: 'middle',
  }));
  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    width: W,
    height: H,
    alt,
    headline: title,
    count: shown.length,
    total: all.length,
    overflow,
    withPhotos: shown.filter((s) => !!s.photo).length,
    layout,
    size: ground.id,
  };
}

module.exports = {
  build,
  LAYOUTS,
  MAX_STUDENTS,
  MAX_PHOTO_CHARS,
  MAX_TOTAL_PHOTO_CHARS,
  GROUNDS,
  KICKERS,
  DEFAULT_HEADLINE,
};
