"use client";

/**
 * IntroSequence - the ceremony.
 *
 * The official TEN logo settles out of the dark over a gold bloom, holds, then
 * the curtain pushes past the camera and hands the session to the workspace
 * already mounted underneath.
 *
 * The mark is TEN's own artwork (public/ten-logo.jpg, lifted from
 * public/ten-3d-logo.jpg in the Ten-Ecosystem repo) rather than a redrawing of
 * it. A hand-built SVG of a 3D render is always a worse likeness than the
 * render, and this one already carries its own wordmark, so the page adds no
 * type of its own. HandsInfinity.tsx is still in the tree, unused, if the
 * animated construction is ever wanted back.
 *
 * Session behaviour
 *   The curtain is server-rendered so there is never a frame of the workspace
 *   before it. An inline script in the document head reads sessionStorage
 *   before first paint and sets `data-ten-intro="off"` on <html> when the
 *   ceremony has already played, which hides the curtain with CSS rather than
 *   with a React effect. That is what keeps a returning navigation flash-free.
 *
 * Reduced motion
 *   Not a slowed-down version of the choreography. The finished frame is held
 *   briefly and cross-faded away, so the brand still lands and nothing travels.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Image from "next/image";
import { BEAT, EASE, INTRO_SESSION_KEY, INTRO_TOTAL_MS, SKIP_AFTER_MS } from "@/lib/motion";
// Static import, not a "/ten-logo.jpg" string: this way a missing or misnamed
// file fails the build by name instead of serving three seconds of black.
import tenLogo from "../../../public/ten-logo.jpg";

const curtain: Variants = {
  closed: { opacity: 1 },
  open: { opacity: 1 },
  out: {
    opacity: 0,
    scale: 1.055,
    filter: "blur(9px)",
    transition: { duration: BEAT.exitDur, ease: EASE.exit },
  },
};

const mark: Variants = {
  closed: { opacity: 0, scale: 1.06 },
  open: {
    opacity: 1,
    scale: 1,
    transition: { duration: BEAT.markDur, delay: BEAT.mark, ease: EASE.luxe },
  },
  out: { opacity: 0, scale: 1.03, transition: { duration: 0.38, ease: EASE.exit } },
};

const bloom: Variants = {
  closed: { opacity: 0, scale: 0.86 },
  open: {
    opacity: [0, 0.55, 0.34],
    scale: [0.86, 1.08, 1],
    transition: {
      duration: BEAT.glow + BEAT.glowDur,
      ease: EASE.bloom,
      times: [0, 0.62, 1],
    },
  },
  out: { opacity: 0, transition: { duration: 0.3 } },
};

const skipControl: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE.luxe } },
  out: { opacity: 0, transition: { duration: 0.18 } },
};

export function IntroSequence({ onFinish }: { onFinish: () => void }) {
  const [showCurtain, setShowCurtain] = useState(true);
  const [canSkip, setCanSkip] = useState(false);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    try {
      // Only the flag. Flipping `data-ten-intro` here would trip the CSS that
      // hides the curtain and cut the exit animation off at frame one; the
      // inline gate in the document head reads this on the next load.
      sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    } catch {
      /* Private mode denies storage. The ceremony simply plays again. */
    }
    setShowCurtain(false);
  }, []);

  // Already played this session: hand over immediately, no frame of curtain.
  useEffect(() => {
    if (document.documentElement.dataset.tenIntro === "off") {
      finished.current = true;
      setShowCurtain(false);
      onFinish();
    }
  }, [onFinish]);

  useEffect(() => {
    if (finished.current) return;
    const skipTimer = window.setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
    const endTimer = window.setTimeout(finish, BEAT.hold * 1000);
    return () => {
      window.clearTimeout(skipTimer);
      window.clearTimeout(endTimer);
    };
  }, [finish]);

  // Any deliberate key dismisses the ceremony once skipping is offered.
  useEffect(() => {
    if (!canSkip || !showCurtain) return;
    const onKey = (e: KeyboardEvent) => {
      if (["Escape", "Enter", " ", "Spacebar"].includes(e.key)) {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSkip, showCurtain, finish]);

  return (
    <AnimatePresence onExitComplete={onFinish}>
      {showCurtain && (
        <motion.div
          key="ten-curtain"
          className="intro-curtain fixed inset-0 z-[70] grid place-items-center bg-void px-6"
          style={{ transformOrigin: "50% 48%" }}
          variants={curtain}
          // Never branched on useReducedMotion: it returns null on the server
          // and the real value on the client's first render, so a branch here
          // is a hydration mismatch for exactly the users who least want a
          // re-render. MotionConfig strips the travel instead, leaving the
          // fades and the beats intact.
          initial="closed"
          animate="open"
          exit="out"
          role="dialog"
          aria-modal="true"
          aria-label="TEN Project Assistant is opening"
        >
          {/* Vignette. Keeps the mark the brightest thing on screen. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(70% 55% at 50% 46%, rgba(212,175,55,0.07), transparent 70%), radial-gradient(120% 90% at 50% 50%, transparent 40%, rgba(0,0,0,0.85) 100%)",
            }}
          />

          <motion.div className="relative grid place-items-center">
            <motion.div
              aria-hidden
              variants={bloom}
              className="pointer-events-none absolute h-[78%] w-[78%] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,243,196,0.5) 0%, rgba(212,175,55,0.22) 42%, transparent 70%)",
              }}
            />

            {/* The artwork is matted on its own black, which never quite agrees
                with the curtain's, so it would otherwise sit in a faintly
                visible box. Screen blending drops any black to the backdrop
                exactly and lets the bloom through it.

                The blend belongs on this wrapper, not on the <Image>. An
                element blends with the backdrop of its own stacking context,
                and this wrapper animates `scale`, which makes it one - so a
                blend set on the image inside has nothing behind it to mix with
                and silently does nothing. Here the backdrop is the bloom and
                the curtain, which is the intent. */}
            <motion.div
              variants={mark}
              className="relative"
              style={{ mixBlendMode: "screen" }}
            >
              <Image
                src={tenLogo}
                alt="The Entrepreneurship Network (TEN)"
                priority
                sizes="(max-width: 640px) 82vw, 30rem"
                className="h-auto w-[min(82vw,30rem)]"
              />
            </motion.div>
          </motion.div>

          <AnimatePresence>
            {canSkip && (
              <motion.button
                key="skip"
                type="button"
                variants={skipControl}
                initial="hidden"
                animate="shown"
                exit="out"
                onClick={finish}
                className="pressable absolute bottom-8 right-6 rounded-pill border border-gold/25 bg-white/[0.03] px-4 py-2 text-xs font-medium tracking-wide text-muted hover:border-gold/50 hover:text-bone sm:bottom-10 sm:right-10"
              >
                Skip intro
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { INTRO_TOTAL_MS };
