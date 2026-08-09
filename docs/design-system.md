# TEN design system

Section 13 of the task document: define and document a consistent system —
spacing, typography, colour, components — and consolidate styling toward one
convention.

---

## 1. Where things stood

Three styling conventions were live at once, and none was authoritative.

| Convention | Files | Used by |
|---|---|---|
| Newer `public/css/` | `design-system.css`, `components.css`, `modernize-existing.css` | 10 ecosystem pages |
| Older root CSS | `ten-theme.css`, `style.css`, `ten-motion.css` | 10 legacy pages |
| Inline styles | — | The highest-traffic pages: student dashboard, HR portal, admin panel, task journey |

The sharpest problem was that **the documented system did not describe the
product**. `public/css/design-system.css` declares a light indigo-and-purple
theme:

```css
--color-primary: #6366F1;   /* indigo */
--bg-page:       #F9FAFB;   /* near-white */
```

No high-traffic page looks like that. The student dashboard, both login pages,
the task journey and the admin panel are dark navy with a gold accent, written
as inline styles. A developer reading `design-system.css` to find "the brand
colour" would get the wrong answer.

Consolidating onto a token file nobody used would have made that worse. So the
first step was to write down what the product **actually is**.

---

## 2. The system

Defined in `public/css/ten-brand.css`. The dark navy base is kept — the task
document calls it "a reasonable base to build on", and it is what 5,000 students
already recognise.

### Colour

| Token | Value | Use |
|---|---|---|
| `--ten-gold` | `#D4AF37` | Primary accent, CTAs, active nav |
| `--ten-gold-bright` | `#F5C542` | Hover, highlights |
| `--ten-gold-deep` | `#C9A227` | Gradient end, pressed |
| `--ten-bg` | `#080F1C` | Page background |
| `--ten-surface` | `#0C1220` | Cards, panels |
| `--ten-surface-raised` | `#101A2E` | Inputs, nested panels |
| `--ten-text` | `#F0EEE8` | Primary text |
| `--ten-text-secondary` | `#CDD9EC` | Body |
| `--ten-text-muted` | `#8AA4C8` | Labels, secondary |
| `--ten-text-faint` | `#5A7299` | Timestamps, helper text |
| `--ten-border` | `rgba(99,140,210,0.18)` | Default divider |

Status: `--ten-success` `#10B981`, `--ten-warning` `#F59E0B`,
`--ten-danger` `#F43F5E`, `--ten-info` `#3B82F6`, each with a matching
`-bg` tint for pills.

**Rules**

- Gold is for *one* primary action per view. When everything is gold, nothing is.
- Never use a `-bg` tint as text colour — it is a background, paired with the
  solid colour for the text.
- Never rely on colour alone. An "Absent" pill carries the word as well as red,
  because roughly 1 in 12 men has a colour-vision deficiency.

### Spacing

A 4px scale: `--ten-space-1` (4px) through `--ten-space-12` (48px).
**Pick from the scale; do not invent values.** The current inline styles use
3px, 7px, 9px, 11px and 13px paddings essentially at random, which is why
otherwise-identical panels do not line up.

### Type

`Plus Jakarta Sans`, falling back to `Outfit`, `Inter`, then the system stack.
`JetBrains Mono` for code and document numbers.

| Token | Size | Use |
|---|---|---|
| `--ten-text-xs` | 11px | Labels, timestamps |
| `--ten-text-sm` | 13px | Body in dense UI |
| `--ten-text-base` | 15px | Body |
| `--ten-text-lg` | 18px | Card heading |
| `--ten-text-xl` | 22px | Section heading |
| `--ten-text-2xl` | 28px | Page heading |

Weights 500 / 600 / 700 / 800. There is no 400 — at these sizes on this dark
background, 400 is too thin to read comfortably.

### Radius and elevation

`--ten-radius-sm` 6px, `--ten-radius` 10px (default), `--ten-radius-lg` 14px
(cards), `--ten-radius-pill`. Three shadow steps; a raised surface gets one
shadow, not a shadow *and* a border *and* a glow.

### Motion

`--ten-transition: 160ms ease`. Long enough to be perceived, short enough not to
be waited on. Anything over 300ms on a hover feels broken.

---

## 3. What the polish layer does

`ten-brand.css` is **additive**. It sets tokens and fixes interaction and
accessibility defects; it does not restyle existing markup, so including it
cannot break a page that already looks right. That mattered here — these are
live pages used by thousands of students, and a redesign that regressed one of
them would be worse than no redesign.

Included on: `login.html`, `student-login.html`, `student-dashboard.html`,
`v2-tasks.html`, `register-hub.html`, `register.html` — the highest-traffic
pages the task document names.

What it fixes:

1. **Visible keyboard focus.** Nearly every input on these pages sets
   `outline: none` for looks, which leaves a keyboard user with no idea where
   they are. `:focus-visible` restores a gold focus ring for keyboard navigation
   only — mouse users see no change.
2. **Touch targets.** Icon buttons smaller than 24×24px are hard to hit on a
   phone. Enforced under `@media (pointer: coarse)` so desktop is untouched.
3. **Reduced motion.** The portal animates a lot (`ten-motion.js`, `qr-pulse`,
   confetti). For someone who has asked their OS to reduce motion, that is
   distracting at best. Now respected.
4. **Cursor affordances.** Buttons look clickable; disabled controls look
   disabled.
5. **Scrollbars** styled for dark panels instead of a bright default.
6. **`.ten-skip-link`** so keyboard users can jump past the sidebar.
7. **`.ten-sr-only`** for labelling icon-only controls.
8. **Consistent invalid-field treatment**, matching the inline registration
   errors added for section 4.

---

## 4. Consolidation plan

Not done in one pass, deliberately. Rewriting six live pages' styling at once is
how a working product regresses.

**Step 1 — establish the reference.** *(done)*
`ten-brand.css` documents the real palette and is included on the six
highest-traffic pages.

**Step 2 — align `design-system.css`.**
Point its tokens at the `--ten-*` values so the 10 pages using it stop being a
different-looking product. Needs a visual pass over each — those pages are
currently light-themed, so this is a real change, not a no-op.

**Step 3 — extract repeated inline styles into `components.css`.**
The same card, pill, button and stat-tile markup is re-declared inline dozens of
times per page. Extract the top ten repeats first; that is where the
inconsistency lives.

**Step 4 — retire the root CSS files.**
`ten-theme.css` and `style.css` move into `public/css/`, and their consumers
migrate one page at a time.

**Step 5 — delete `modernize-existing.css`.**
A patch layer over the old convention; once step 4 lands it has nothing to
patch.

---

## 5. Conventions for new work

- **New pages use `public/css/`.** No new root-level CSS files.
- **Include `ten-brand.css` first**, then page CSS.
- **Use tokens, not literals.** `var(--ten-gold)`, never `#D4AF37`.
- **Do not add a third convention.** If something is missing, add it to
  `ten-brand.css` or `components.css`.
- **Every interactive element needs a visible focus state, an accessible name,
  and a target of at least 24×24px.**
- **Check contrast.** Body text on `--ten-surface` should be at least 4.5:1;
  `--ten-text-faint` (`#5A7299`) is deliberately reserved for non-essential
  text like timestamps because it does not meet that bar for body copy.

---

## 6. Reference points

Per the task document, comparable products worth looking at:

- **Linear** — the clearest dark UI in production. Note how restrained the
  accent colour is: one accent, used rarely.
- **Vercel dashboard** — dense information without feeling cramped; strong
  hierarchy from spacing and weight rather than colour.
- **Wellfound / Y Combinator's Work at a Startup** — the closest analogue for
  the founder and applicant screens in section 14.
- **Coursera / Internshala** — the closest analogue for the student task journey
  and progress display.

The common thread: **hierarchy comes from spacing and typographic weight, not
from colour and borders.** The current portal reaches for a border or a glow
where a spacing change would do more.
