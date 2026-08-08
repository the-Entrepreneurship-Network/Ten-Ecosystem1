"use client";

/**
 * The frame.
 *
 * The workspace is mounted from the first frame, underneath the curtain. That
 * is what makes the handover seamless: nothing is loading when the ceremony
 * ends, the interface is simply already there when the black lifts.
 *
 * The workspace settles with a small counter-move as the curtain pushes past
 * the camera. Two objects moving in opposite directions read as depth; the same
 * move on both reads as a slideshow.
 *
 * `initial` is never branched on `useReducedMotion()`. That hook returns null
 * on the server and the real value on the client's first render, so branching
 * here would hand every reduced-motion user a hydration mismatch. The
 * MotionConfig below is what suppresses travel for them, at animation time,
 * where it costs nothing.
 */

import { useCallback, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import { ChatShell } from "@/components/chat/ChatShell";
import { IntroSequence } from "@/components/intro/IntroSequence";
import { EASE } from "@/lib/motion";

export function AppFrame() {
  const [revealed, setRevealed] = useState(false);

  const onFinish = useCallback(() => {
    setRevealed(true);
    // Hand the session straight to the composer so the first keystroke lands.
    requestAnimationFrame(() => {
      document.getElementById("ten-composer")?.focus({ preventScroll: true });
    });
  }, []);

  return (
    // `reducedMotion="user"` makes Motion drop transform and layout animation
    // for anyone who asked for it, while keeping opacity, so nothing ever
    // arrives invisible. Fewer and gentler, not zero.
    <MotionConfig reducedMotion="user">
      {/* inert while the curtain is up: opacity 0 hides the workspace visually
          but removes nothing from the tab order or the accessibility tree, so
          without this a keyboard user tabs into invisible controls and a screen
          reader is read the whole app over a black screen. */}
      <motion.div
        className="app-frame"
        inert={!revealed}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={revealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.985 }}
        transition={{ duration: 0.66, ease: EASE.luxe }}
      >
        <ChatShell />
      </motion.div>

      <IntroSequence onFinish={onFinish} />
    </MotionConfig>
  );
}
