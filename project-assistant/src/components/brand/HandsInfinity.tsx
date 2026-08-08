"use client";

/**
 * HandsInfinity - the ceremonial mark.
 *
 * The finished frame is the TEN logo: two hands rising from a single point
 * below, splayed outward, cupping a lemniscate that sits *between* them - the
 * fingers pass in front of the lobes, the palms meet at the heel. The ceremony
 * is that pose being arrived at: the hands start folded palm-to-palm at the
 * centre line and open into it.
 *
 * Construction, silhouette first
 *   - Each hand is drawn upright in local space, fingertips near y = 0 and the
 *     wrist at (64, 221). Digits are drawn BEHIND the palm so the palm's own
 *     edge hides every joint: separate capsules sitting on top of a blob is
 *     what makes a hand read as a mitten.
 *   - Placement is a static SVG `transform` on an outer group; the right hand
 *     is the left one mirrored. Every animated transform is a CSS transform on
 *     an inner group, so the two systems never overwrite each other.
 *
 * Mirror discipline
 *   Because the right hand's placement carries scale(-1, 1), a local rotation
 *   of t renders as -t on that side. So a mirror-symmetric pair needs the SAME
 *   local number on both hands, not opposite ones. Multiplying by a direction
 *   flag - the intuitive move - is what tips both hands the same way and makes
 *   the pair read as a copy rather than a reflection.
 *
 * Pivots
 *   `transform-box: view-box` with an explicit origin, never `fill-box`. A
 *   group's fill-box is the union of its children *after* their own transforms,
 *   so a fill-box pivot slides around while the digits are rotating and the
 *   whole hand wobbles. view-box pins each digit to its real knuckle.
 *
 *   That is also why the viewBox starts at "0 0" and the scene is composed to
 *   fit rather than cropped with a min-x/min-y. Where a viewport origin sits
 *   inside a transformed group is exactly the corner of transform-box that
 *   browsers are entitled to read either way, and Chrome adds the min - so a
 *   viewBox of "70 112 ..." threw every pivot 70 right and 112 down, which
 *   rotated both hands into each other's laps. At "0 0" both readings agree
 *   and there is nothing left to get wrong.
 *
 * The lemniscate is one continuous stroke that crosses itself at the centre.
 * Two tangent circles are the usual failure here and they read as "OO", not as
 * infinity: the crossing is the whole glyph. It is drawn *before* the hands so
 * the hands occlude it - that occlusion is what reads as holding.
 *
 * Everything animated is `transform` or `opacity`, which the compositor handles
 * without layout or paint. The single exception is the lemniscate's
 * `pathLength`, which compiles to `stroke-dashoffset`.
 */

import { motion, type Variants } from "motion/react";
import { HANDS_BEAT as BEAT, EASE } from "@/lib/motion";

/* ---------------------------------------------------------------- geometry */

/**
 * Tapered digit with a rounded tip. Base sits on `yb`, tip points up.
 *
 * `bend` drifts the tip sideways and bows the sides to follow it. Straight-
 * sided capsules are the tell that gives away a drawn hand: four parallel rods
 * read as a comb no matter how well they are shaded, and no finger on a
 * cupping hand is straight.
 */
function digit(
  bx: number,
  yb: number,
  length: number,
  baseHalf: number,
  tipHalf: number,
  bend = 0,
) {
  const ty = yb - length + tipHalf;
  const cy = yb - length * 0.55;
  const tx = bx + bend;
  return [
    `M${bx - baseHalf},${yb}`,
    `Q${bx - baseHalf + bend * 0.3},${cy} ${tx - tipHalf},${ty}`,
    `A${tipHalf},${tipHalf} 0 0 1 ${tx + tipHalf},${ty}`,
    `Q${bx + baseHalf + bend * 0.3},${cy} ${bx + baseHalf},${yb}`,
    "Z",
  ].join("");
}

/**
 * Palm and wrist as one silhouette.
 *
 * Three things stop this reading as a mitten: the knuckle line is a convex
 * arch rather than a straight cut, the palm narrows through the heel, and it
 * continues into a slim wrist. A rounded blob that simply ends is a paw.
 *
 * It is deliberately narrow - 73 wide against a 104 middle finger. A palm as
 * wide as the finger span is the single thing that makes a gold hand read as
 * a glove, and at logo scale it also swallows whatever the hand is holding.
 */
const PALM =
  "M31,98 C41,79 87,79 97,98 " +
  "C101,117 99,145 93,165 " +
  "C89,179 84,192 83,208 " +
  "C82,226 82,240 82,252 L46,252 " +
  "C46,240 46,226 45,208 " +
  "C43,192 37,178 33,165 " +
  "C27,145 27,117 31,98 Z";

/** Cast shadow the digits drop into the cup, hugging the knuckle arch. Without
 *  it the palm's top edge is a bright line laid across four bright fingers and
 *  the hand looks like a mitten pulled over a fork. */
const PALM_SHADE =
  "M31,98 C41,79 87,79 97,98 C98,104 99,110 99,117 " +
  "C86,99 44,99 29,117 C29,110 30,104 31,98 Z";

/**
 * Digits are based inside the palm so no seam is ever visible, and they are
 * spaced 15 against an 8 base half-width, so neighbours touch at the knuckle
 * and only separate as they fan.
 *
 * `fold` is the palm-to-palm pose - fingers straight and leaning very slightly
 * toward the centre line, which is what a folded hand actually looks like;
 * `cup` is the splayed logo pose. The fan is deliberately shallow: eleven
 * degrees end to end. Thrown wider they read as a high-five, and the logo is a
 * cradle.
 */
const FINGERS = [
  { key: "index", bx: 41, by: 106, d: digit(41, 106, 96, 8, 5.6, 4), cup: -5, fold: 4 },
  { key: "middle", bx: 56, by: 104, d: digit(56, 104, 104, 8, 5.6, 2), cup: -1.5, fold: 3 },
  { key: "ring", bx: 71, by: 106, d: digit(71, 106, 97, 7.8, 5.4, -2), cup: 2.5, fold: 2 },
  { key: "pinky", bx: 86, by: 111, d: digit(86, 111, 80, 7, 4.8, -4), cup: 7, fold: 1 },
] as const;

/** Based well inside the heel of the palm, not on its edge. A thumb rooted at
 *  the silhouette swings out from under the palm as it opens and ends up a
 *  loose rod lying beside the hand. */
const THUMB = { bx: 44, by: 168, d: digit(44, 168, 82, 12, 6.4, 6), cup: -34, fold: -5 };

/**
 * Lemniscate, centred at (150, 80), half-width 126, lobe height 58.
 * Both strands leave the centre along the same tangent, which is what makes
 * the crossing read as a single continuous ribbon rather than two arcs meeting.
 *
 * It is placed low on purpose. The fingertips of the cupping pose land about
 * 35 units above its centre, so each hand reaches up *through* the hollow of
 * its lobe while the palms close over the lobe's underside. Sitting it any
 * higher gives the arrangement the logo was explicitly not: an infinity
 * hovering above two hands.
 */
const INFINITY_D =
  "M150,80 C97,22 24,22 24,80 C24,138 97,138 150,80 " +
  "C203,22 276,22 276,80 C276,138 203,138 150,80 Z";

/** Gold dust, lifting off the opening palms. Deterministic offsets so server
 *  and client render identically. */
const DUST = Array.from({ length: 18 }, (_, i) => {
  const side = i % 2 === 0 ? -1 : 1;
  const rank = Math.floor(i / 2);
  return {
    id: i,
    cx: 150 + side * (24 + rank * 10 + (i % 3) * 6),
    cy: 188 - (i % 4) * 14,
    r: 1.3 + (i % 3) * 0.85,
    rise: 118 + (i % 5) * 32,
    drift: side * (9 + (i % 4) * 7),
    delay: BEAT.dust + rank * BEAT.dustStep + (i % 2) * 0.03,
  };
});

/* ---------------------------------------------------------------- variants */

/**
 * One set of numbers for both hands - see "Mirror discipline" above.
 *
 * Folded: vertical, slid inward until the palm edges meet on the centre line.
 * Cupped: slid back out and tilted 14 degrees outward, which swings the
 * fingertips wide while bringing the heels of the palms together - the exact
 * geometry of the logo, and the reason the tilt cannot simply be dropped.
 */
const handVariants: Variants = {
  closed: {
    opacity: 0,
    scale: 0.94,
    x: -5,
    y: 18,
    rotate: 0,
  },
  open: {
    opacity: 1,
    scale: 1,
    y: 0,
    // A breath inward before the release, then the long outward glide.
    x: [-5, -8, 0],
    rotate: [0, 1.5, -14],
    transition: {
      opacity: { duration: BEAT.handsInDur, delay: BEAT.handsIn, ease: EASE.luxe },
      scale: { duration: BEAT.handsInDur, delay: BEAT.handsIn, ease: EASE.luxe },
      y: { duration: BEAT.handsInDur, delay: BEAT.handsIn, ease: EASE.luxe },
      x: { duration: BEAT.openDur, delay: BEAT.open, ease: EASE.silk, times: [0, 0.14, 1] },
      rotate: { duration: BEAT.openDur, delay: BEAT.open, ease: EASE.silk, times: [0, 0.14, 1] },
    },
  },
  out: {
    opacity: 0,
    x: 26,
    rotate: -18,
    transition: { duration: 0.42, ease: EASE.exit },
  },
};

/** Each digit unfurls on its own beat. 50ms apart reads as one gesture. */
const digitVariants = (fold: number, cup: number, order: number): Variants => ({
  closed: { rotate: fold },
  open: {
    rotate: cup,
    transition: {
      duration: BEAT.openDur + 0.2,
      delay: BEAT.open + 0.1 + order * 0.05,
      ease: EASE.silk,
    },
  },
  out: { rotate: cup },
});

const drawVariants: Variants = {
  // Not zero: with a round linecap, pathLength 0 paints a visible dot.
  closed: { pathLength: 0.0015, opacity: 0 },
  open: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: BEAT.drawDur, delay: BEAT.draw, ease: EASE.draw },
      opacity: { duration: 0.22, delay: BEAT.draw },
    },
  },
  out: { opacity: 0, transition: { duration: 0.3, ease: EASE.exit } },
};

const coreVariants: Variants = {
  closed: { opacity: 0, scale: 0.82 },
  open: {
    opacity: [0, 0.28, 0.55, 0.42],
    scale: [0.82, 0.9, 1.08, 1],
    transition: {
      duration: BEAT.glow + BEAT.glowDur,
      ease: EASE.bloom,
      times: [0, 0.4, 0.78, 1],
    },
  },
  out: { opacity: 0, transition: { duration: 0.3 } },
};

const dustVariants: Variants = {
  closed: { opacity: 0, y: 0, scale: 0.3 },
  open: (p: (typeof DUST)[number]) => ({
    opacity: [0, 0.9, 0],
    y: -p.rise,
    x: p.drift,
    scale: [0.3, 1, 0.2],
    transition: {
      duration: 1.9,
      delay: p.delay,
      ease: EASE.luxe,
      times: [0, 0.3, 1],
    },
  }),
  out: { opacity: 0, transition: { duration: 0.25 } },
};

/** Held pose for surfaces that show the finished mark rather than the ceremony. */
export const AT_REST = "open" as const;

/**
 * Knuckle pivots, in viewBox units. See "Pivots" in the file header.
 *
 * `originX`/`originY`, not `transformOrigin`. On an SVG child Motion rebuilds
 * transform-origin from those two values every frame and writes the result
 * over whatever the style prop said, defaulting to "50% 50%" - so a plain
 * `transformOrigin` here is silently discarded and every joint pivots around
 * the middle of its own bounding box instead. `transformBox` is the one piece
 * Motion does read from the style prop.
 */
const pivot = (x: number, y: number) =>
  ({ transformBox: "view-box", originX: `${x}px`, originY: `${y}px` }) as const;

/* --------------------------------------------------------------- component */

function Hand({ side }: { side: "left" | "right" }) {
  // Local wrist (64, 221) is pinned to the placement point. The two anchors sit
  // 40 apart so the forearms rise from almost the same spot, and the outward
  // tilt does the rest.
  // 60 apart, not touching. Wrists any closer and the pair crowds the centre,
  // which is the one part of the lemniscate - the crossing - that has to stay
  // clear for the glyph to read.
  const place =
    side === "left"
      ? "translate(120,256) scale(1.02) translate(-64,-221)"
      : "translate(180,256) scale(-1.02,1.02) translate(-64,-221)";

  return (
    <motion.g transform={place}>
      <motion.g variants={handVariants} style={pivot(64, 221)}>
        {/* Digits first, palm second. The palm edge becomes the knuckle line.
            The only stroke anywhere is a hairline of the ramp's own shadow,
            which separates one finger from the next. A bright outline - the
            obvious way to define these edges - is what turns cast gold into
            cut paper, and on the palm it draws a hard rectangle straight
            across the knuckles. The silhouette is the gradient's job. */}
        <motion.g
          variants={digitVariants(THUMB.fold, THUMB.cup, 0)}
          style={pivot(THUMB.bx, THUMB.by)}
        >
          <path d={THUMB.d} fill="url(#ten-digit)" />
          <path d={THUMB.d} fill="none" stroke="#3E2B06" strokeOpacity={0.3} strokeWidth={0.9} />
        </motion.g>

        {FINGERS.map((f, i) => (
          <motion.g
            key={f.key}
            variants={digitVariants(f.fold, f.cup, i + 1)}
            style={pivot(f.bx, f.by)}
          >
            <path d={f.d} fill="url(#ten-digit)" />
            <path d={f.d} fill="none" stroke="#3E2B06" strokeOpacity={0.3} strokeWidth={0.9} />
          </motion.g>
        ))}

        <path d={PALM} fill="url(#ten-palm)" />
        <path d={PALM_SHADE} fill="url(#ten-shade)" />
      </motion.g>
    </motion.g>
  );
}

export function HandsInfinity({ className }: { className?: string }) {
  return (
    // motion.svg rather than svg: variant state only travels through motion
    // components, so a plain element anywhere in the chain would strand every
    // descendant on its initial pose.
    <motion.svg
      viewBox="0 0 300 272"
      className={className}
      fill="none"
      role="img"
      aria-label="Two golden hands opening to cup an infinity symbol"
    >
      <defs>
        {/* Metal ramp: shade, mid, specular, mid, shade. A flat fill reads as
            plastic; the double shoulder is what reads as gold. Run across the
            palm and only slightly raked, so the highlight is one broad band
            down the cup. A steep diagonal here draws a bright chevron that
            looks like a crease in the hand. */}
        <linearGradient id="ten-palm" x1="0" y1="0.1" x2="1" y2="0.5">
          <stop offset="0%" stopColor="#6E4E0C" />
          <stop offset="18%" stopColor="#B08A1E" />
          <stop offset="40%" stopColor="#EFD98F" />
          <stop offset="55%" stopColor="#FFF6DC" />
          <stop offset="72%" stopColor="#D2AC3C" />
          <stop offset="90%" stopColor="#8F6A0E" />
          <stop offset="100%" stopColor="#5E4208" />
        </linearGradient>

        {/* Digits get the same ramp on their own axis, run across the finger
            rather than along it. Shading a finger head-to-tip lights it like a
            strip of foil; shading it edge-to-edge is what makes it a
            cylinder. */}
        <linearGradient id="ten-digit" x1="0" y1="0" x2="1" y2="0.14">
          <stop offset="0%" stopColor="#6B4C0C" />
          <stop offset="14%" stopColor="#A87F1C" />
          <stop offset="34%" stopColor="#E8CE7A" />
          <stop offset="47%" stopColor="#FFF8E6" />
          <stop offset="62%" stopColor="#D9B443" />
          <stop offset="82%" stopColor="#96700F" />
          <stop offset="100%" stopColor="#5A3F08" />
        </linearGradient>

        {/* Vertical, not horizontal: a stroke shaded light-at-top to dark-at-
            bottom reads as a round tube. Shaded along its length it reads as
            flat tape. */}
        <linearGradient
          id="ten-inf"
          x1="0"
          y1="18"
          x2="0"
          y2="142"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFF6DA" />
          <stop offset="22%" stopColor="#F0CE6A" />
          <stop offset="56%" stopColor="#C79A28" />
          <stop offset="100%" stopColor="#6E4E0E" />
        </linearGradient>

        {/* Warm, not neutral. A grey-black at any opacity over this ramp
            desaturates the gold under it and reads as haze on the surface
            rather than as a shadow in it. */}
        <linearGradient id="ten-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A2E00" stopOpacity="0.38" />
          <stop offset="70%" stopColor="#4A2E00" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#4A2E00" stopOpacity="0" />
        </linearGradient>

        <radialGradient id="ten-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFF3C4" stopOpacity="0.85" />
          <stop offset="40%" stopColor="#D4AF37" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#D4AF37" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Bloom behind the mark. A plain shape's opacity and scale, never an
          animated SVG filter, which re-rasterises the whole layer per frame. */}
      <motion.ellipse
        variants={coreVariants}
        cx="150"
        cy="83"
        rx="148"
        ry="84"
        fill="url(#ten-core)"
        style={pivot(150, 83)}
      />

      {/* Lemniscate under the hands, so the fingers occlude the lobes. That
          overlap is the entire difference between cupping it and standing
          beside it. */}
      <motion.path
        variants={drawVariants}
        d={INFINITY_D}
        stroke="url(#ten-inf)"
        strokeWidth={18}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Specular, the same path lifted 3 units so it rides the top edge of the
          ribbon. Cheaper than a real bevel and reads the same at this size. */}
      <motion.path
        variants={drawVariants}
        d={INFINITY_D}
        transform="translate(0,-3.2)"
        stroke="#FFF8E4"
        strokeOpacity={0.5}
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      <Hand side="left" />
      <Hand side="right" />

      <motion.g>
        {DUST.map((p) => (
          <motion.circle
            key={p.id}
            variants={dustVariants}
            custom={p}
            cx={p.cx}
            cy={p.cy}
            r={p.r}
            fill="#F5D76E"
            style={pivot(p.cx, p.cy)}
          />
        ))}
      </motion.g>
    </motion.svg>
  );
}
