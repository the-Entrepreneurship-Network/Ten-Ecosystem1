"use client";

/**
 * The first screen of a session.
 *
 * A student arriving here is usually stuck, not browsing, so this is a set of
 * openings rather than a marketing panel. They are rows with a rule between
 * them instead of a grid of equal cards: the eye scans a column of verbs far
 * faster than it scans a mosaic, and nothing here needs elevation.
 */

import { motion } from "motion/react";
import { InfinityMark } from "@/components/brand/InfinityMark";
import { ChevronRight } from "@/components/ui/icons";
import { EASE } from "@/lib/motion";
import { OPENERS } from "@/lib/tracks";

export function OpeningScreen({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <motion.div
      initial="hidden"
      animate="shown"
      variants={{
        hidden: {},
        shown: { transition: { delayChildren: 0.06, staggerChildren: 0.055 } },
      }}
      className="mx-auto flex w-full max-w-[46rem] flex-col items-center px-1 pt-4 pb-2 sm:pt-10"
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, scale: 0.96 },
          shown: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0.7, ease: EASE.luxe },
          },
        }}
        className="pointer-events-none mb-7"
        aria-hidden
      >
        {/* The mark at rest. The hands belong to the ceremony; repeating them
            here would spend the one moment they are worth. */}
        <InfinityMark className="h-14 w-28" />
      </motion.div>

      <motion.h2
        variants={{
          hidden: { opacity: 0, y: 10 },
          shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE.luxe } },
        }}
        className="text-center text-[1.7rem] font-semibold leading-tight tracking-[-0.02em] text-bone sm:text-[2.1rem]"
      >
        Let&rsquo;s finish your project properly.
      </motion.h2>

      <motion.p
        variants={{
          hidden: { opacity: 0, y: 8 },
          shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE.luxe } },
        }}
        className="mt-3 max-w-[34rem] text-center text-[0.9375rem] leading-relaxed text-muted"
      >
        Tell me your track and the task you were given. You get the plan, the
        research direction, and the work that actually gets submitted.
      </motion.p>

      <motion.ul
        variants={{
          hidden: {},
          shown: { transition: { delayChildren: 0.16, staggerChildren: 0.045 } },
        }}
        className="mt-9 w-full divide-y divide-edge border-y border-edge"
      >
        {OPENERS.map((o) => (
          <motion.li
            key={o.title}
            variants={{
              hidden: { opacity: 0, y: 8 },
              shown: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.42, ease: EASE.luxe },
              },
            }}
          >
            <button
              type="button"
              onClick={() => onPick(o.prompt)}
              className="pressable group flex w-full items-center gap-4 px-1 py-3.5 text-left hover:bg-white/[0.025] sm:px-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-medium text-bone transition-colors duration-200 group-hover:text-gold-lift">
                  {o.title}
                </span>
                <span className="mt-0.5 block text-[0.8125rem] text-muted">
                  {o.sub}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-gold" />
            </button>
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  );
}
