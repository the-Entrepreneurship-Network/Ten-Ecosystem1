"use client";

/**
 * InfinityMark - the persistent brand presence.
 *
 * A reduced form of the ceremonial mark: the lemniscate alone, breathing
 * slowly. It is the one continuous animation in the product, so it is kept
 * deliberately quiet and slow enough to sit under a working session for hours
 * without becoming noise.
 *
 * `repeatType: "mirror"` replays the curve backwards on the return leg, which
 * is what prevents the snap that a plain loop produces. The glow and the mark
 * run on different periods (5.4s against 4.2s) so they drift out of phase and
 * never pulse in lockstep.
 */

import { useId } from "react";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

/**
 * One continuous stroke that crosses itself at the centre. Both strands leave
 * the crossing along the same tangent, which is what separates a lemniscate
 * from two tangent circles. Two circles read as "OO"; the crossing is the glyph.
 */
const INFINITY_D =
  "M120,60 C95,30 62,30 62,60 C62,90 95,90 120,60 " +
  "C145,30 178,30 178,60 C178,90 145,90 120,60 Z";

export function InfinityMark({
  className = "h-7 w-14",
  breathe = true,
}: {
  className?: string;
  breathe?: boolean;
}) {
  // `breathe` is a prop, not a read of useReducedMotion. That hook returns null
  // on the server and the real value on the client's first render, and since
  // this component has no `initial`, Motion renders `animate` as the SSR style:
  // branching on it would put a hydration mismatch in the header. The
  // MotionConfig at the root drops the scale for reduced-motion users and
  // leaves the slow opacity breath, which is the gentler-not-zero behaviour.
  const alive = breathe;
  // The mark appears in the rail, the header and the opening screen at once. A
  // shared gradient id would make every instance resolve to the first one in
  // the document, and that one lives inside the rail, which is display:none
  // below `lg`. The mark then paints with no stroke on mobile.
  const gradient = `ten-mark-${useId().replace(/:/g, "")}`;

  return (
    <span className={`relative inline-grid place-items-center ${className}`}>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(212,175,55,0.28), transparent 72%)",
        }}
        animate={alive ? { opacity: [0.35, 0.75], scale: [0.92, 1.08] } : undefined}
        transition={{
          duration: 5.4,
          repeat: Infinity,
          repeatType: "mirror",
          ease: EASE.breath,
        }}
      />
      <motion.svg
        viewBox="52 20 136 80"
        className="relative h-full w-full"
        fill="none"
        role="img"
        aria-label="TEN"
        animate={alive ? { scale: [1, 1.035], opacity: [0.86, 1] } : undefined}
        transition={{
          duration: 4.2,
          repeat: Infinity,
          repeatType: "mirror",
          ease: EASE.breath,
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0.7">
            <stop offset="0%" stopColor="#B8912A" />
            <stop offset="28%" stopColor="#F5D76E" />
            <stop offset="52%" stopColor="#FFF6D8" />
            <stop offset="76%" stopColor="#F5D76E" />
            <stop offset="100%" stopColor="#B8912A" />
          </linearGradient>
        </defs>
        <path
          d={INFINITY_D}
          stroke={`url(#${gradient})`}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>
    </span>
  );
}
