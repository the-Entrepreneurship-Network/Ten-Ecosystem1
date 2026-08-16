/**
 * Shared motion vocabulary.
 *
 * One place for every curve and beat so the intro, the header mark and the
 * chat all move with the same accent. Built-in CSS easings are deliberately
 * avoided: they are too weak to read as authored.
 */

export const EASE = {
  /** Expo-out. The signature settle: instant departure, long graceful arrival. */
  luxe: [0.16, 1, 0.3, 1] as const,
  /** Quint-out. Slightly softer. Used for the hands opening. */
  silk: [0.22, 1, 0.36, 1] as const,
  /** Cubic-in-out. Pen-stroke feel for the infinity draw-on. */
  draw: [0.65, 0, 0.35, 1] as const,
  /** Gentle swell for the glow bloom. */
  bloom: [0.34, 0.01, 0.24, 1] as const,
  /** Sine-in-out. The only curve that reads correctly when mirrored on a loop. */
  breath: [0.45, 0, 0.55, 1] as const,
  /** Circ-in. Exits accelerate away; they never linger. */
  exit: [0.7, 0, 0.84, 0] as const,
} as const;

/**
 * Intro beat sheet, in seconds from overlay mount.
 * Total runtime 3.20s.
 *
 * The mark is TEN's finished logo artwork, so there is no construction to
 * choreograph: the whole job is to present it and get out of the way. One
 * settle, one bloom, hold, leave.
 *
 *   0.00  black.
 *   0.20  the logo fades up and settles out of a slight over-scale.
 *   0.75  a gold bloom swells behind it, then eases back.
 *   2.60  hold ends; the curtain pushes past the camera.
 *   3.20  done.
 */
export const BEAT = {
  mark: 0.2,
  markDur: 1.1,
  glow: 0.75,
  glowDur: 1.2,
  hold: 2.6,
  exitDur: 0.6,
} as const;

/**
 * The alternate cut: hands drawn from primitives, folded palm to palm, opening
 * to cup a lemniscate that draws itself between them. Superseded by the real
 * artwork, kept because it is the only version that can animate the *forming*
 * of the mark, which a flat render cannot.
 *
 * To restore it: render <HandsInfinity /> in IntroSequence instead of the
 * <Image>, and raise BEAT.hold to 3.55 so the 4.15s choreography is not cut
 * off at 2.6.
 */
export const HANDS_BEAT = {
  handsIn: 0.0,
  handsInDur: 0.85,
  open: 0.6,
  openDur: 1.5,
  draw: 1.2,
  drawDur: 1.25,
  dust: 1.55,
  dustStep: 0.06,
  glow: 2.15,
  glowDur: 1.0,
  ten: 2.55,
  tenDur: 0.8,
  sub: 2.95,
  subDur: 0.6,
  hold: 3.55,
  exitDur: 0.6,
} as const;

export const INTRO_TOTAL_MS = (BEAT.hold + BEAT.exitDur) * 1000;

/** Time after which the skip control becomes available, per the brief. */
export const SKIP_AFTER_MS = 1200;

/** Session key that keeps the ceremony to once per browser session. */
export const INTRO_SESSION_KEY = "ten.intro.played.v1";

export const GOLD = "#D4AF37";
export const GOLD_LIFT = "#F5D76E";
