# TEN Project Assistant

An AI mentor for students on virtual internships with **The Entrepreneurship Network**. It scopes their project, plans their weeks, points them at real research, and keeps them shipping something worth submitting.

Black velvet and polished gold. A ceremonial opening, then a workspace they can sit in for hours.

---

## Run it

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY (optional)
npm run dev                    # http://localhost:3000
```

Production:

```bash
npm run build && npm run start
```

**No API key?** The app still runs. `/api/chat` serves prepared answers written in the assistant's voice and labels them as offline, so the whole interface is demonstrable before anyone provisions a key. The rail states which mode you are in.

---

## What is in here

```
src/
  app/
    layout.tsx              Fonts, metadata, and the pre-paint intro gate
    globals.css             Design tokens, materials, browser surfaces, prose
    page.tsx
    api/chat/route.ts       Streaming endpoint, offline fallback
  components/
    AppFrame.tsx            Curtain over an already-mounted workspace
    brand/
      HandsInfinity.tsx     The ceremonial mark: hands, lemniscate, dust
      InfinityMark.tsx      The persistent mark, breathing
    intro/IntroSequence.tsx The 3.2s ceremony, skip, session gate
    chat/
      ChatShell.tsx         Transcript, stream, scroll
      Composer.tsx          Auto-growing input
      MessageBubble.tsx     One turn
      Markdown.tsx          Reading surface
      OpeningScreen.tsx     First screen of a session
      TrackRail.tsx         Track picker, rail on desktop, drawer on mobile
    ui/icons.tsx            Authored icon set, one stroke weight
  lib/
    motion.ts               Curves and the intro beat sheet
    system-prompt.ts        The assistant's identity
    tracks.ts               TEN tracks and their opening questions
    demo-replies.ts         Offline answers
    types.ts
```

---

## The design system

Three locks, applied without exception.

**Theme.** Dark only. The brand insists on it, so there is no light surface anywhere in the app.

**Colour.** One accent family. Surfaces are off-black (`#0A0A0A`, `#101010`, `#161514`), never pure black, because pure values kill depth. Gold runs `#D4AF37` primary (9.4:1 on the page background, AAA as text), `#C9A227` deep, `#F5D76E` as a highlight and gradient stop only. Text is off-white `#ECE8DF` at 15.9:1 and `#9C9689` at 7.4:1.

**Shape.** Pill is pressable, 16px is a container, 12px is an input, 8px is inline. Nothing invents a fourth value.

Depth comes from an inner hairline and a top-edge highlight, not from an outer halo. The one place a halo is earned is the ceremony, where the brief asks for the mark to glow.

Type is Geist, self-hosted through `next/font`. Body sits at 15px with a 1.72 line height and a 65 to 75 character measure.

Selection, caret, scrollbar, focus ring, underline offset and numerals are all themed. Those are the parts nobody draws, and leaving them at browser defaults is the cheapest way to make considered work look assembled.

---

## Motion

Every curve lives in `src/lib/motion.ts`. The built-in CSS easings are too weak to read as authored, so nothing uses them.

| Curve | Value | Used for |
| --- | --- | --- |
| `luxe` | `cubic-bezier(0.16, 1, 0.3, 1)` | The signature settle |
| `silk` | `cubic-bezier(0.22, 1, 0.36, 1)` | The hands opening |
| `draw` | `cubic-bezier(0.65, 0, 0.35, 1)` | The lemniscate drawing itself |
| `breath` | `cubic-bezier(0.45, 0, 0.55, 1)` | The only curve that reads right mirrored on a loop |
| `exit` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exits accelerate away, they never linger |

### The ceremony, beat by beat

| Time | Beat |
| --- | --- |
| 0.00s | Curtain settles, clasped hands materialise out of blur |
| 0.42s | Hands clench inward, then release and open |
| 0.90s | The lemniscate draws itself between the palms |
| 1.05s | Gold dust lifts, staggered 55ms apart |
| 1.34s | "TEN" scales down into place, tracking tightening as it lands |
| 1.88s | "THE ENTREPRENEURSHIP NETWORK" settles beneath it |
| 2.02s | The mark blooms |
| 2.60s | Hold, then the curtain pushes past the camera |
| 3.20s | Done |

Skip appears at 1.2s. Escape, Enter and Space all dismiss it. The workspace is mounted from the first frame underneath the curtain, so the handover is a reveal rather than a load, and it settles with a small counter-move as the curtain leaves: two objects moving in opposite directions read as depth.

### Session behaviour

The ceremony plays once per browser session. An inline script in the document head reads `sessionStorage` **before first paint** and hides the curtain with CSS when it has already played. Doing that in an effect would be one painted frame too late, and a flash of a curtain you are about to remove is worse than no ceremony at all.

### Reduced motion

Not a slowed-down version of the choreography. `prefers-reduced-motion` gets the finished frame, held briefly and cross-faded away, so the brand still lands and nothing travels. `MotionConfig reducedMotion="user"` drops transform and layout animation app-wide while keeping opacity, so nothing ever arrives invisible.

### Performance

Everything animated is `transform` or `opacity`, which the compositor handles without layout or paint. The one exception is the lemniscate's `pathLength`, which compiles to `stroke-dashoffset`: one drawn path is the entire budget for that. `will-change` is never set in CSS; Motion adds and removes it per value, and a permanent one would pin a compositor layer for the life of the page.

---

## The mark

Authored as inline SVG rather than a raster or a WebGL scene: crisp at any size, no extra bytes, and off the critical rendering path.

Two things decide whether it works.

**The lemniscate is one continuous stroke that crosses itself.** Both strands leave the crossing along the same tangent. Two tangent circles are the usual failure and they read as "OO"; the crossing is the glyph.

**The hands are built silhouette first.** Digits are drawn *behind* the palm so the palm's own edge becomes the knuckle line, the knuckle line is a convex arch rather than a straight cut, and the palm narrows through the heel into a slim wrist. Separate capsules sitting on a rounded blob is what turns a hand into a mitten. Proportions are the real ones: total length 222, palm 130, middle finger 110, palm width 80.

Placement is a static SVG `transform` on an outer group; every animated transform is a CSS transform on an inner group, so the two systems never overwrite each other. `transformBox: fill-box` pivots each digit at its own knuckle. The fingertips stop just under the lemniscate rather than through it, because a stroke crossing the fingers amputates them.

---

## The assistant

`src/lib/system-prompt.ts` is the product. It carries what TEN is, what the internship actually involves, every track it supports, how to work with a student, and how to write. Tune it there; no component needs to change.

Two boundaries are built into the prompt on purpose:

- It states programme facts confidently but sends students to their reporting mentor for anything binding, and it never invents a policy, a date, a citation or a URL.
- It gives architecture, structure, worked examples and reviews, and it tells a student plainly which parts they need to build themselves. The mentor will ask, and the learning is the point of the programme.

### The endpoint

`POST /api/chat` streams plain UTF-8 text. Not SSE, not a framed protocol: the client only ever needs "append these characters". Anthropic's SSE frames are unwrapped server-side and the text deltas forwarded straight through. History is capped at 24 turns and 12k characters per message.

Client side, tokens arrive faster than markdown can usefully re-parse, so they accumulate in a ref and flush on a 60ms cadence. A long answer costs a bounded number of renders instead of one per token.

---

## Accessibility

- WCAG AA contrast throughout, verified against the page background rather than assumed
- Full keyboard path: the drawer traps focus and restores it on close, the ceremony is dismissible from the keyboard, and focus lands in the composer when the ceremony ends
- Zoom is not locked. `maximum-scale=5`
- Empty, loading, streaming and error states all designed; a failed turn becomes an inline error with a retry and never loses the question
- `min-h-[100dvh]`, never `h-screen`, so the iOS Safari address bar does not clip the composer
- Tested at 320, 390, 768, 1024 and 1440

---

## Deliberate limits

- **The transcript is not persisted.** Reload starts fresh. Add storage when students ask for history, not before.
- **One conversation at a time.** A session list is a feature, not a foundation.
- **The mark is stylised, not anatomical.** It is a logo built from real hand proportions, not a rendered hand, and it is honest about that at any size.
- **Offline replies are static.** They cover the five questions students actually open with. They are labelled offline and the assistant never presents one as live.
