#!/usr/bin/env node
'use strict';

/**
 * Draw the icons for the Notifications app.
 *
 * The portal is installable twice already — as "TEN Portal" and as "TEN
 * Internship Portal" — and Notifications makes three. On a phone home screen
 * they sit side by side, so they cannot all wear the same picture: an icon that
 * does not say which app it is makes the third install pointless.
 *
 * These keep the family look of public/icons/icon-192.png — gold on the same
 * dark navy, same rounded square — and put a bell in the middle with an unread
 * dot, so it reads as "the alerts one" at 48px on a home screen.
 *
 * Written by hand rather than exported from a design tool because this machine
 * has no image library, and because a committed generator is reviewable and
 * reproducible in a way a checked-in binary is not. PNG is a short format: a
 * header, one zlib-compressed block of scanlines, and an end marker.
 *
 * Run:  node scripts/generate-notification-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── PNG encoding ──────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixel buffer -> PNG file bytes. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // Each scanline is prefixed with its filter type; 0 (none) keeps this simple
  // and compresses perfectly well for flat colour.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 4);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── drawing ───────────────────────────────────────────────────────────────

const NAVY  = [0x10, 0x16, 0x24, 255];
const GOLD  = [0xf5, 0xc5, 0x42, 255];
const RED   = [0xf4, 0x3f, 0x5e, 255];

/** Squared distance, so the circle tests avoid a square root each sample. */
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRoundedRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nx = Math.min(Math.max(x, left + r), right - r);
  const ny = Math.min(Math.max(y, top + r), bottom - r);
  return inCircle(x, y, nx, ny, r);
}

/**
 * Is this point inside the bell?
 *
 * The body is a profile whose half-width grows from the crown to the rim —
 * narrow at the top, flaring out at the bottom — closed off by the rim bar,
 * with the handle above and the clapper below.
 *
 * `S` is the icon size, so one description draws every resolution.
 */
function inBell(x, y, S) {
  const cx = S * 0.5;
  const crown = S * 0.30;
  const rim   = S * 0.655;
  const maxHalf = S * 0.215;

  // handle
  if (inCircle(x, y, cx, crown - S * 0.035, S * 0.045)) return true;

  // body
  if (y >= crown && y <= rim) {
    const t = (y - crown) / (rim - crown);
    const half = maxHalf * (0.30 + 0.70 * Math.pow(t, 0.62));
    if (Math.abs(x - cx) <= half) return true;
  }

  // rim bar, a touch wider than the body so the bell reads as a bell
  if (y > rim && y <= rim + S * 0.055 && Math.abs(x - cx) <= maxHalf * 1.13) return true;

  // clapper
  if (inCircle(x, y, cx, rim + S * 0.125, S * 0.055)) return true;

  return false;
}

/**
 * @param {number} size        pixels square
 * @param {boolean} maskable   maskable icons are cropped to a circle by the OS,
 *                             so the artwork must sit inside the safe zone and
 *                             the background must reach every corner.
 */
function draw(size, maskable) {
  const S = size;
  const out = Buffer.alloc(S * S * 4);
  const SS = 3;                       // supersampling, for smooth edges
  const inset = maskable ? 0 : S * 0.055;
  const corner = maskable ? 0 : S * 0.20;
  // Maskable art must fit the 80% safe zone or the OS crops the bell's rim off.
  const scale = maskable ? 0.78 : 1;
  const shift = maskable ? S * 0.11 : 0;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let bgHits = 0, goldHits = 0, redHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          const onPlate = maskable
            ? true
            : inRoundedRect(px, py, inset, inset, S - inset, S - inset, corner);
          if (!onPlate) continue;
          bgHits++;

          // Art coordinates, so the same bell description serves both shapes.
          const ax = (px - shift) / scale;
          const ay = (py - shift) / scale;

          // The unread dot, sitting over the bell's shoulder.
          if (inCircle(ax, ay, S * 0.715, S * 0.285, S * 0.115)) { redHits++; continue; }
          // A navy gap so the dot never merges into the bell.
          if (inCircle(ax, ay, S * 0.715, S * 0.285, S * 0.155)) continue;

          if (inBell(ax, ay, S)) goldHits++;
        }
      }

      const total = SS * SS;
      const i = (y * S + x) * 4;
      if (!bgHits) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }

      // Composite in one pass: navy plate, then gold, then the red dot.
      const gf = goldHits / total;
      const rf = redHits / total;
      const bf = bgHits / total;
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round(NAVY[c] * (1 - gf - rf) + GOLD[c] * gf + RED[c] * rf);
      }
      out[i + 3] = Math.round(255 * bf);
    }
  }
  return encodePng(S, S, out);
}

const targets = [
  ['notif-192.png', 192, false],
  ['notif-512.png', 512, false],
  ['notif-maskable-512.png', 512, true]
];

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const [name, size, maskable] of targets) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, draw(size, maskable));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
