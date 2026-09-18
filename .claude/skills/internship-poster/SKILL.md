---
name: internship-poster
description: Build LinkedIn hiring and internship posters - the "COMPANY IS HIRING" card with a role badge, labelled fact columns (company, domain, location, experience, duration, job ID), eligibility, stipend, a benefits strip and a comment-to-apply CTA. Renders exact text from job data and uses Nano Banana (Gemini CLI) only for the hero artwork. Use this whenever the user wants a job post, internship opening, hiring poster, placement or off-campus drive graphic, "freshers welcome" card, or any recruitment creative for LinkedIn or an internship site - including when they paste a raw job description, a careers-page link, or a list of openings and want it turned into something postable. Also use it when an agent or automation needs post-ready assets plus caption and alt text.
allowed-tools: Bash, Read, Write
---

# Internship & hiring posters for LinkedIn

## What this builds, and why it is split in two

A 1080x1350 PNG shaped like a recruitment infographic: a hero band with the
company wordmark and an "X IS HIRING!" headline, a role badge, a row of
labelled fact columns, an eligibility panel, a stipend panel, a benefits strip,
a comment-to-apply card, and a footer credit.

Almost every pixel of that is **structured text** - a company name, a stipend
figure, a deadline, a job ID. Image models garble exactly those things. They
will confidently render "Stipned", or turn 25,000 into 25,0OO, and on a poster
already live on LinkedIn a wrong stipend is not a cosmetic bug - it is a
misleading job ad that applicants act on.

So the work divides:

- **Nano Banana generates the hero artwork only** - an abstract or
  architectural backdrop with no words in it.
- **A headless browser renders every word** from a JSON file.

Text comes out crisp, correctly spelled and re-renderable, so twenty openings
can share one backdrop and differ only in data. Do not shortcut this by asking
an image model for the whole poster with the text baked in.

## First run: write the kit to disk

This skill carries its two working files as code blocks in the appendices.
Before the first render, create them once:

```bash
mkdir -p poster-kit
```

Write Appendix A verbatim to `poster-kit/template.html`, Appendix B to
`poster-kit/render_poster.py`, and Appendix D to `poster-kit/fetch_hero.py`. Do not retype or "improve" them - the layout
geometry and the screenshot cropping are both load-bearing and were arrived at
by measurement. On later runs, reuse the existing folder rather than rewriting it.

Requirements: Python 3 with Pillow (`pip install pillow`) and any
Chromium-family browser (Chrome, Edge or Chromium), which the script locates
automatically on Windows, macOS and Linux.

## The pipeline

1. Collect the job facts.
2. Generate or reuse hero artwork.
3. Write a job JSON file.
4. Render, then look at the PNG.
5. Hand off with caption and alt text.

### 1. Collect the job facts

Required for a usable poster: company, role or domain, location, who may apply,
and how to apply. Strongly wanted: stipend or salary, duration, eligible
degrees, job ID, deadline.

**Never invent a missing fact.** A plausible "Rs 25,000/mo" that nobody stated
reads as a commitment to every fresher who sees it. If the source has no
stipend, either set `salary.value` to something honest like "Not disclosed" or
ask. The same goes for deadlines and job IDs. This is the one failure the skill
must not produce; everything else is fixable by re-rendering.

When the user pastes a raw job description or a careers link, extract only what
is actually there, then tell them plainly which fields came back empty rather
than quietly filling the gaps.

### 2. Hero artwork with Nano Banana

The hero slot is a tall right-hand panel roughly 560x650, cut by a diagonal, so
ask for a **vertical composition with the subject off-centre to the right**. A
wide landscape loses its subject to the crop.

**Route A - direct REST (no CLI needed).** `fetch_hero.py` (Appendix D) calls the
Gemini image API with stdlib only, so there is no Gemini CLI, extension or npm
install in the chain:

```bash
export NANOBANANA_API_KEY=...
python poster-kit/fetch_hero.py "modern glass office tower seen from below, deep blue and steel tones, cool daylight reflections, clean sky, crisp architectural editorial photography, vertical composition with the building filling the right two-thirds" \
    --model pro --size 4K -o nanobanana-output/hero.png
```

`--model pro` is Nano Banana Pro (`gemini-3-pro-image`), the best tier for
detail; `2` is Nano Banana 2, `v1` the older flash model. `--size` takes
`1K`, `2K` or `4K`, and `--aspect` defaults to `3:4` to suit the hero slot.

**Image generation is paid-only.** On an API key whose project has no billing,
every image model reports `limit: 0` and returns HTTP 429. That is a plan
problem, not a transient rate limit - retrying will never clear it. Enable
billing at https://aistudio.google.com/apikey, or set `hero.image` to `null`
and ship the poster with the dark fallback panel.

**Route B - the Gemini CLI**, if it is already set up:

Check setup once per session:

```bash
gemini extensions list | grep nanobanana
[ -n "$NANOBANANA_API_KEY" ] && echo "key set" || echo "set NANOBANANA_API_KEY"
```

Install if absent: `gemini extensions install https://github.com/gemini-cli-extensions/nanobanana`

The env var is `NANOBANANA_API_KEY`. Widely-copied guides say `GEMINI_API_KEY`
or `NANOBANANA_GEMINI_API_KEY`; the extension reads neither.

```bash
gemini --yolo "/generate 'modern glass office tower seen from below, deep blue and steel tones, vertical composition, clean sky, corporate editorial photography, no text, no logos' --count=3 --preview"
```

Three variants cost little and give the user a choice. Output lands in
`./nanobanana-output/`.

Two rules that matter for this template:

- **End every prompt with "no text, no logos".** Any lettering the model
  invents collides with the headline drawn on top of it.
- **Keep the palette near the brand colour** so the diagonal wedge reads as
  design rather than clash. Name the colour in the prompt.

For abstract backdrops `/pattern` often beats `/generate`:

```bash
gemini --yolo "/pattern 'soft geometric circuit lines' --type='texture' --colors='duotone' --density='sparse'"
```

If the hero step is unavailable, set `hero.image` to `null`. The panel falls
back to a dark block and the poster still reads correctly.

### 3. Write the job JSON

Start from Appendix C and edit it. Every string is rendered literally, so
spelling here is the spelling on the poster.

Set `brand.primary` and `brand.accent` to the company's real colours where you
can identify them - it is the single biggest factor in whether the poster looks
official. Say so if you are guessing. `brand.logo` takes a path to a logo
image and falls back to `brand.logo_text` as a wordmark.

**Field notes**

| Field | Notes |
|---|---|
| `size` | `1080x1350` is the LinkedIn portrait slot and the default. `1080x1080` works; wider-than-tall will look wrong. |
| `brand.tagline` | Array of short lines beside the logo. Four maximum; `[]` to omit. |
| `headline.lead` / `.verb` | Two headline lines, e.g. `"Zomato IS"` then `"HIRING!"`. Both auto-shrink to fit. |
| `headline.role` | The badge. Auto-fits: shrinks, then wraps. Never truncated, so the real job title can go in verbatim. |
| `headline.blurb` | One or two sentences. `<em>` highlights words in the primary colour. |
| `hero.caption` | Optional dark overlay on the artwork. `<em>` highlights in warm orange. Under ~10 words. |
| `hero.accent_note` | Handwritten-style note, white over the artwork. `\n` breaks lines. |
| `facts[]` | `{icon, label, value}`. **Six is the design target.** `label` is uppercased; `value` accepts `\n` to break a line inside its column. |
| `eligibility.items` | Joined with pipe separators; about nine short entries fit. Or pass `text` with a ready-made string. |
| `salary.label` | `"STIPEND"` for internships, `"EXPECTED SALARY"` for jobs. |
| `salary.value` | Renders large; keep under ~16 characters. |
| `salary.note` | **Use `"(Estimated)"` whenever the figure is not officially confirmed** - the difference between reporting and promising. |
| `why.items` | **Five items, ~four words each.** Derive them from the source, or omit the whole block - see below. |
| `cta.sub` | Where the real application route goes. |
| `footer.left` | Credit line, uppercased. `<b>` highlights in the accent colour. |

**Do not fill `why` with invented employer promises.** "Learn from senior
mentors" and "inclusive culture" are the sort of thing that sounds harmless and
is actually a claim about a company that neither you nor the poster's author is
in a position to make. Derive each item from the source text, or drop the block
entirely - the hero panel absorbs the height and the layout still reads well.

**Icon names** (anything unrecognised falls back to `briefcase`, so spelling
counts): `building` `briefcase` `pin` `users` `team` `doc` `idcard` `clock`
`calendar` `cap` `rupee` `chart` `bulb` `globe` `leaf` `rocket` `target`
`bubble` `send` `megaphone` `avatar`.

### 4. Render

```bash
python poster-kit/render_poster.py job.json -o poster.png
```

Then **open the PNG and look at it.** Long company names, unusual stipend
strings and five-word role titles are exactly what stresses a fixed layout, and
the script cannot tell you a fact column has gone to three ugly lines. Check:
fact values sitting inside their columns, blurb clear of the diagonal, footer
fully visible, headline not sprawling to three lines.

The role badge and headline auto-shrink, so a long job title is safe to pass in
verbatim rather than abbreviating it yourself. If a **fact column** overflows,
shorten that value or add a `\n`. Use `--keep-html` to inspect the markup when a
fix is not obvious.

### 5. Hand off for posting

Write a `manifest.json` beside the PNG so an automation has one predictable
file to read:

```json
{
  "image": "poster.png",
  "caption": "post copy with line breaks and hashtags",
  "alt_text": "one sentence describing the opening",
  "dimensions": "1080x1350"
}
```

Alt text is not filler. A poster is text baked into an image, so without it the
post is unreadable to anyone on a screen reader. Describe the opening, not the
artwork: "Hiring poster: Zomato Data Analyst Intern, Gurugram, 6 months,
Rs 25,000/month, open to 2026 and 2027 batches."

Keep the caption's facts identical to the poster's. Two different stipends -
one in the image, one in the text - is the most common way this pipeline
embarrasses whoever posted it.

## Verified Gemini CLI reference

Checked against the `gemini-cli-extensions/nanobanana` source (v1.0.12). The
slash commands are prompt templates that **validate their arguments and refuse
unknown flags**, so a flag borrowed from another command fails the whole call
rather than being ignored.

**There is no size or aspect-ratio flag.** No command accepts `--aspect`, and
the underlying tool schemas carry no width, height or aspect parameter. Framing
can only be influenced by wording it into the prompt. `--sizes` (icon) and
`--size` (pattern) are the only dimension flags and are specific to those two.

| Command | Accepted flags |
|---|---|
| `/generate` | `--count=N` (1-8), `--styles="a,b"`, `--variations="a,b"`, `--format=grid\|separate`, `--seed=N`, `--preview` |
| `/edit` | `--preview` **only**. Usage: `/edit file "instructions"` |
| `/restore` | `--preview` only. Usage: `/restore file "what to fix"` |
| `/icon` | `--sizes="16,32,64"`, `--type=app-icon\|favicon\|ui-element`, `--style=`, `--format=png\|jpeg`, `--background=`, `--corners=rounded\|sharp` |
| `/pattern` | `--size="256x256"`, `--type=seamless\|texture\|wallpaper`, `--style=`, `--density=`, `--colors=`, `--repeat=tile\|mirror` |
| `/diagram` | `--type=`, `--style=`, `--layout=`, `--complexity=`, `--colors=`, `--annotations=` |
| `/nanobanana` | Plain sentence; picks a tool itself. Useful if slash commands misbehave non-interactively. |

`/generate` styles: `photorealistic` `watercolor` `oil-painting` `sketch`
`pixel-art` `anime` `vintage` `modern` `abstract` `minimalist`.
Variations: `lighting` `angle` `color-palette` `composition` `mood` `season`
`time-of-day`.

Models: `gemini-3.1-flash-image-preview` (Nano Banana 2, current default),
`gemini-3-pro-image-preview` (Pro, best text rendering),
`gemini-2.5-flash-image` (v1, the old default). Override via
`NANOBANANA_MODEL`.

For `/edit` and `/restore` the extension searches the current directory,
`./images/`, `./input/`, `./nanobanana-output/`, `~/Downloads/` and
`~/Desktop/` - so a bare filename from Downloads works without a full path.

`--yolo` auto-approves tool calls, which is what lets a non-interactive run
finish without a confirmation prompt. It approves everything in that
invocation, so keep such calls to single image commands.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `Invalid option(s) found` from gemini | A flag that command does not accept. Flags are not shared between commands; see the table above. |
| `Pillow is required` | `pip install pillow` - needed to crop the screenshot to exact dimensions. |
| `no Chromium-family browser found` | Pass `--browser "C:/Program Files/Google/Chrome/Application/chrome.exe"` or set `POSTER_BROWSER`. |
| Hero missing, rest renders | `hero.image` is resolved relative to the JSON file. The script warns and continues with a dark panel. |
| A fact column overflows | Shorten that value or insert `\n`. Do not raise font sizes; the fixed layout is what makes a feed look like a set. |
| Garbled words inside the artwork | The prompt lacked "no text, no logos". Regenerate the hero. |
| Bottom strip of the PNG is blank | Headless Chrome renders a viewport shorter than the requested window. The bundled script already handles this by oversizing and cropping - do not replace it with a plain `--screenshot` call. |

## Appendix A - `poster-kit/template.html`

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  :root{
    --primary:#D04A02; --accent:#E0301E;
    --ink:#141414; --muted:#5C5C5C; --line:#E8E8EA;
    --soft:#F6F6F7; --dark:#22252A;
  }
  html,body{ width:1080px; height:1350px; overflow:hidden; background:#fff }
  body{
    font-family:"Segoe UI","Helvetica Neue",Helvetica,Arial,"Noto Sans",sans-serif;
    color:var(--ink); -webkit-font-smoothing:antialiased;
  }
  #poster{ width:1080px; height:1350px; padding:22px; display:flex; flex-direction:column; gap:12px }
  .card{ background:#fff; border:1.5px solid var(--line); border-radius:16px }

  /* ---------- HERO ---------- */
  .hero{ position:relative; flex:1 1 auto; min-height:0; background:#fff;
    border-radius:18px; overflow:hidden }
  .hero-left{ position:absolute; inset:0 0 0 0; width:636px; padding:8px 20px 8px 8px; z-index:3;
    display:flex; flex-direction:column; justify-content:center }
  .brandrow{ display:flex; align-items:center; gap:14px; margin-bottom:22px }
  .logo-img{ height:56px; width:auto; object-fit:contain }
  .logo-text{ font-size:46px; font-weight:800; letter-spacing:-2px; line-height:.9 }
  .tagline{ border-left:2.5px solid #C9C9CC; padding-left:14px; font-size:14.5px; line-height:1.32; color:#2E2E2E; font-weight:600 }
  h1{ font-size:82px; line-height:.88; font-weight:900; letter-spacing:-3px;
    text-transform:uppercase; max-width:556px }
  h1 .hl{ color:var(--accent); display:block; font-size:94px }
  .rolebadge{ display:inline-block; margin-top:14px; background:var(--accent); color:#fff;
    font-size:40px; font-weight:900; letter-spacing:.5px; text-transform:uppercase;
    padding:8px 24px 10px; border-radius:10px; max-width:548px }
  .blurb{ margin-top:20px; font-size:18.5px; line-height:1.42; color:#2A2A2A; max-width:468px; font-weight:500 }
  .blurb em{ font-style:normal; color:var(--primary); font-weight:700 }

  .hero-media{ position:absolute; top:0; right:0; width:560px; height:100%;
    clip-path:polygon(31% 0,100% 0,100% 100%,7% 100%); z-index:1; background:var(--dark) }
  .hero-media img{ width:100%; height:100%; object-fit:cover; display:block }
  .wedge{ position:absolute; top:0; right:0; width:560px; height:100%;
    background:var(--primary); clip-path:polygon(18% 0,31% 0,7% 100%,0 100%); z-index:2 }
  .hero-cap{ position:absolute; right:26px; bottom:112px; z-index:4; width:196px;
    background:rgba(28,30,34,.9); color:#fff; border-radius:8px; padding:14px 16px;
    font-size:15.5px; line-height:1.32; font-weight:600 }
  .hero-cap em{ font-style:normal; color:#FFB27A; font-weight:700 }
  .accent-note{ position:absolute; right:30px; top:18px; z-index:4; text-align:right;
    font-family:"Segoe Script","Comic Sans MS",cursive; font-size:21px; line-height:1.25;
    color:#fff; font-weight:700; text-shadow:0 2px 10px rgba(0,0,0,.55) }
  .accent-note .u{ display:block; height:3px; width:96px; background:#fff;
    margin:5px 0 0 auto; border-radius:2px }

  /* ---------- FACT STRIP ---------- */
  .facts{ display:flex; padding:14px 6px; flex:none }
  .fact{ flex:1; padding:0 8px; text-align:center; border-right:1.5px solid var(--line) }
  .fact:last-child{ border-right:none }
  .fact .ic{ height:38px; display:flex; align-items:center; justify-content:center; margin-bottom:7px }
  .fact .lb{ font-size:11.5px; font-weight:800; letter-spacing:.7px; color:var(--primary); margin-bottom:4px }
  .fact .vl{ font-size:16px; font-weight:700; line-height:1.22; color:var(--ink) }

  /* ---------- ELIGIBILITY + SALARY ---------- */
  .midrow{ display:flex; gap:12px; flex:none }
  .elig{ flex:1.62; display:flex; gap:14px; align-items:center; padding:16px 18px }
  .elig .badge{ width:62px; height:62px; border-radius:50%; background:var(--dark);
    display:flex; align-items:center; justify-content:center; flex:none }
  .elig h3{ font-size:19px; font-weight:900; letter-spacing:.4px; margin-bottom:5px }
  .elig p{ font-size:14.5px; line-height:1.4; color:#333; font-weight:600 }
  .sal{ flex:1; display:flex; gap:12px; align-items:center; padding:16px 18px }
  .sal .badge{ width:58px; height:58px; border-radius:50%; background:var(--soft);
    display:flex; align-items:center; justify-content:center; flex:none }
  .sal .lb{ font-size:13.5px; font-weight:800; color:var(--accent); letter-spacing:.5px; margin-bottom:2px }
  .sal .vl{ font-size:27px; font-weight:900; letter-spacing:-.5px; line-height:1.05 }
  .sal .nt{ font-size:13px; color:var(--muted); font-weight:600; margin-top:2px }

  /* ---------- WHY JOIN ---------- */
  .whywrap{ position:relative; margin-top:6px; flex:none }
  .pill{ position:absolute; top:-15px; left:50%; transform:translateX(-50%); z-index:5;
    background:var(--dark); color:#fff; border-radius:999px; padding:8px 30px;
    font-size:17px; font-weight:800; letter-spacing:.4px; white-space:nowrap }
  .why{ display:flex; padding:30px 6px 18px }
  .wi{ flex:1; padding:0 10px; text-align:center; border-right:1.5px solid var(--line) }
  .wi:last-child{ border-right:none }
  .wi .ic{ height:36px; display:flex; align-items:center; justify-content:center; margin-bottom:8px }
  .wi p{ font-size:14px; line-height:1.3; font-weight:650; color:#2B2B2B }

  /* ---------- CTA ---------- */
  .cta{ position:relative; border:2px solid var(--accent); border-radius:16px;
    padding:16px 20px; display:flex; align-items:center; gap:16px; flex:none; overflow:hidden }
  .cta .bub{ flex:none }
  .cta .txt{ flex:1 }
  .cta .k{ font-size:13px; font-weight:800; letter-spacing:.8px; color:var(--muted) }
  .cta .big{ font-size:36px; font-weight:900; letter-spacing:-.5px; line-height:1.05 }
  .cta .big span{ color:var(--accent) }
  .cta .sub{ font-size:13px; font-weight:700; color:#3A3A3A; letter-spacing:.2px; margin-top:4px }
  .cta .right{ flex:none; text-align:center; width:180px; position:relative }
  .cta .right .hw{ font-family:"Segoe Script","Comic Sans MS",cursive; font-size:19px;
    font-weight:700; line-height:1.15; margin-top:2px }

  /* ---------- FOOTER ---------- */
  .foot{ display:flex; flex:none; height:108px; border:2px solid var(--accent); border-radius:16px; overflow:hidden }
  .fl{ flex:1.35; display:flex; gap:14px; align-items:center; padding:14px 18px;
    border-right:2px solid var(--accent) }
  .fl p{ font-size:15px; line-height:1.34; font-weight:800; letter-spacing:.2px; text-transform:uppercase }
  .fl p b{ color:var(--accent) }
  .fr{ flex:1; display:flex; gap:13px; align-items:center; padding:14px 18px }
  .fr .lb{ font-size:12.5px; font-weight:800; letter-spacing:.7px; color:var(--muted) }
  .fr .nm{ font-size:22px; font-weight:900; letter-spacing:-.3px; line-height:1.1; color:var(--accent) }
  .fr .sb{ font-size:12.5px; font-weight:800; letter-spacing:.5px; color:#3A3A3A; margin-top:2px }
  svg{ display:block }
</style>
</head>
<body>
<div id="poster"></div>
<script>
var DATA = __POSTER_DATA__;

var ICONS = {
  building:'<rect x="3" y="3" width="11" height="18" rx="1.5"/><rect x="14" y="8" width="7" height="13" rx="1.5"/><path d="M6 7h2M6 11h2M6 15h2M10 7h1M10 11h1M10 15h1M17 12h1M17 16h1" stroke-width="1.6"/>',
  briefcase:'<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" stroke-width="1.8"/><path d="M2.5 12h19" stroke-width="1.6"/>',
  pin:'<path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6" fill="#fff" stroke="none"/>',
  users:'<circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M2.5 19c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2z"/><path d="M15 14c2.9.2 5 2.1 5 5" stroke-width="1.8"/>',
  doc:'<path d="M6 2.5h7.5L19 8v13.5H6z"/><path d="M13.5 2.5V8H19" stroke-width="1.6" fill="#fff"/><path d="M9 12.5h7M9 16h7" stroke-width="1.7"/>',
  idcard:'<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/><circle cx="8.5" cy="11" r="2.4" fill="#fff" stroke="none"/><path d="M5 16.4c.6-1.6 1.9-2.4 3.5-2.4s2.9.8 3.5 2.4" fill="#fff" stroke="none"/><path d="M14.5 10h4.2M14.5 13.4h4.2" stroke-width="1.8"/>',
  cap:'<path d="M12 4 2.5 8.6 12 13.2l9.5-4.6z"/><path d="M6.5 11v4.6c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3V11" stroke-width="1.8"/><path d="M20.4 10v5.4" stroke-width="1.8"/>',
  rupee:'<path d="M7 4h10M7 9h10M16.5 4c0 3-2.4 5-6 5h-.5l7 11H14L7 9" stroke-width="2.1"/>',
  chart:'<rect x="3" y="12" width="4.4" height="9" rx="1"/><rect x="9.8" y="7" width="4.4" height="14" rx="1"/><rect x="16.6" y="3" width="4.4" height="18" rx="1"/>',
  bulb:'<path d="M12 2.6a6.4 6.4 0 0 0-3.6 11.7V17h7.2v-2.7A6.4 6.4 0 0 0 12 2.6z"/><path d="M9.6 19.6h4.8M10.4 21.8h3.2" stroke-width="2"/>',
  team:'<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.4"/><circle cx="19" cy="10" r="2.4"/><path d="M6.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M1.5 18c0-2.2 1.5-3.6 3.5-3.6M22.5 18c0-2.2-1.5-3.6-3.5-3.6" stroke-width="1.7"/>',
  globe:'<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4" stroke-width="1.7"/><path d="M12 2.8c2.6 2.6 4 5.8 4 9.2s-1.4 6.6-4 9.2c-2.6-2.6-4-5.8-4-9.2s1.4-6.6 4-9.2z" stroke-width="1.7"/>',
  leaf:'<path d="M20.5 3.5C10 4 4 9.5 4 16.5c0 1.7.3 3.2.9 4.5 8.6.4 15.2-6 15.6-17.5z"/><path d="M4.9 21c2.2-5 6.2-8.8 11.1-11" stroke-width="1.7"/>',
  clock:'<circle cx="12" cy="12" r="9.2"/><path d="M12 6.6V12l4 2.6" stroke-width="1.9"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2.2"/><path d="M3 10h18M8 5V2.8M16 5V2.8" stroke-width="1.8"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/>',
  rocket:'<path d="M12 2.8c3.6 2.4 5.6 6.2 5.6 10.4L12 18l-5.6-4.8C6.4 9 8.4 5.2 12 2.8z"/><circle cx="12" cy="10" r="2.1"/><path d="M8.4 17.2c-1.6 1-2.3 2.6-2.2 4.4 1.8.1 3.4-.6 4.4-2.2M15.6 17.2c1.6 1 2.3 2.6 2.2 4.4-1.8.1-3.4-.6-4.4-2.2" stroke-width="1.7"/>',
  bubble:'<path d="M3 5.5h18v11H12.5L7 21v-4.5H3z"/><path d="M7.5 11h9" stroke-width="1.9"/>',
  send:'<path d="M2 12 22 3l-4.5 18-5.5-6.5z"/><path d="M12 14.5 22 3" stroke-width="1.7"/>',
  megaphone:'<path d="M3 10.5 16 5v14L3 13.5z"/><path d="M6.5 14v5.5h3.5V15.5" stroke-width="1.8"/><path d="M19 8.5a4.5 4.5 0 0 1 0 7" stroke-width="1.9"/>',
  avatar:'<circle cx="12" cy="12" r="9.3"/><circle cx="12" cy="9.6" r="3.2"/><path d="M5.8 19.4c.9-3 3.3-4.6 6.2-4.6s5.3 1.6 6.2 4.6" stroke-width="1.8"/>'
};

function svg(name, color, size){
  var p = ICONS[name] || ICONS.briefcase;
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="'+color+
         '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
}
function esc(s){ return (s==null?'':String(s)); }

var b = DATA.brand || {};
var r = document.documentElement.style;
if (b.primary) r.setProperty('--primary', b.primary);
if (b.accent)  r.setProperty('--accent',  b.accent);
var P = b.primary || '#D04A02', A = b.accent || '#E0301E';

var h = DATA.headline || {}, hero = DATA.hero || {};
var out = [];

/* HERO */
var logo = b.logo
  ? '<img class="logo-img" src="'+esc(b.logo)+'">'
  : '<div class="logo-text">'+esc(b.logo_text || h.company_display || '')+'</div>';
var tag = (b.tagline && b.tagline.length)
  ? '<div class="tagline">'+b.tagline.map(esc).join('<br>')+'</div>' : '';

out.push(
 '<div class="hero">',
   '<div class="hero-media">', hero.image ? '<img src="'+esc(hero.image)+'">' : '', '</div>',
   '<div class="wedge"></div>',
   hero.accent_note ? '<div class="accent-note">'+esc(hero.accent_note).replace(/\n/g,'<br>')+'<span class="u"></span></div>' : '',
   hero.caption ? '<div class="hero-cap">'+hero.caption+'</div>' : '',
   '<div class="hero-left">',
     '<div class="brandrow">', logo, tag, '</div>',
     '<h1>', esc(h.lead || ((h.company_display||'')+' IS')), '<span class="hl">', esc(h.verb || 'HIRING!'), '</span></h1>',
     h.role ? '<div class="rolebadge">'+esc(h.role)+'</div>' : '',
     h.blurb ? '<div class="blurb">'+h.blurb+'</div>' : '',
   '</div>',
 '</div>'
);

/* FACTS */
var facts = DATA.facts || [];
out.push('<div class="card facts">');
facts.forEach(function(f){
  out.push('<div class="fact"><div class="ic">'+svg(f.icon,P,30)+'</div>',
           '<div class="lb">'+esc(f.label).toUpperCase()+'</div>',
           '<div class="vl">'+esc(f.value).replace(/\n/g,'<br>')+'</div></div>');
});
out.push('</div>');

/* ELIGIBILITY + SALARY */
var el = DATA.eligibility || {}, sl = DATA.salary || {};
out.push('<div class="midrow">',
  '<div class="card elig"><div class="badge">'+svg('cap','#fff',32)+'</div><div>',
    '<h3>'+esc(el.heading || 'ELIGIBILITY')+'</h3>',
    '<p>'+(el.items ? el.items.map(esc).join(' &nbsp;|&nbsp; ') : esc(el.text))+'</p>',
  '</div></div>',
  '<div class="card sal"><div class="badge">'+svg('rupee',A,30)+'</div><div>',
    '<div class="lb">'+esc(sl.label || 'EXPECTED SALARY')+'</div>',
    '<div class="vl">'+esc(sl.value)+'</div>',
    sl.note ? '<div class="nt">'+esc(sl.note)+'</div>' : '',
  '</div></div>',
'</div>');

/* WHY JOIN */
var w = DATA.why || {};
if (w.items && w.items.length){
  out.push('<div class="whywrap">',
    '<div class="pill">'+esc(w.heading || 'WHY JOIN US?')+'</div>',
    '<div class="card why">');
  w.items.forEach(function(i){
    out.push('<div class="wi"><div class="ic">'+svg(i.icon,P,28)+'</div><p>'+esc(i.text)+'</p></div>');
  });
  out.push('</div></div>');
}

/* CTA */
var c = DATA.cta || {};
out.push('<div class="cta">',
  '<div class="bub">'+svg('bubble',A,44)+'</div>',
  '<div class="txt">',
    '<div class="k">'+esc(c.kicker || 'COMMENT')+'</div>',
    '<div class="big">&ldquo;<span>'+esc(c.quote || 'INTERESTED')+'</span>&rdquo; '+esc(c.tail || '')+'</div>',
    c.sub ? '<div class="sub">'+esc(c.sub)+'</div>' : '',
  '</div>',
  '<div class="right">'+svg('send',A,40)+(c.accent_note?'<div class="hw">'+esc(c.accent_note).replace(/\n/g,'<br>')+'</div>':'')+'</div>',
'</div>');

/* FOOTER */
var f = DATA.footer || {};
out.push('<div class="foot">',
  '<div class="fl">'+svg('megaphone',A,40)+'<p>'+(f.left||'')+'</p></div>',
  '<div class="fr">'+svg('avatar',A,44)+'<div>',
    '<div class="lb">'+esc(f.follow_label || 'FOLLOW')+'</div>',
    '<div class="nm">'+esc(f.follow_name || '')+'</div>',
    '<div class="sb">'+esc(f.follow_sub || '')+'</div>',
  '</div></div>',
'</div>');

document.getElementById('poster').innerHTML = out.join('');

/* Auto-fit the two headline elements.

   The role badge and the "COMPANY IS" line are the only places a long real-world
   string can break this layout, and a job title is not something to abbreviate
   silently. So shrink the type until it fits, allow a wrap as a last resort, and
   never drop characters. */
function fitText(sel, startPx, minPx, maxW, allowWrap){
  var el = document.querySelector(sel);
  if (!el) return;
  var size = startPx;
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > maxW && size > minPx){
    size -= 1;
    el.style.fontSize = size + 'px';
  }
  if (el.scrollWidth > maxW && allowWrap){
    el.style.whiteSpace = 'normal';
    el.style.lineHeight = '1.02';
  }
}
fitText('.rolebadge', 40, 23, 548, true);
fitText('h1 .hl',     94, 62, 556, false);
fitText('h1',         82, 54, 556, true);

window.__RENDERED__ = true;
</script>
</body>
</html>
```

## Appendix B - `poster-kit/render_poster.py`

```python
#!/usr/bin/env python3
"""
Render a hiring/internship poster from a JSON job file to PNG.

Why this exists: every factual field on the poster (company, stipend, deadline,
job ID) has to be exactly right, so the text is drawn by a browser from real
data rather than generated by an image model. Nano Banana supplies only the
hero artwork, referenced from the JSON as hero.image.

Usage:
    python render_poster.py job.json -o poster.png
    python render_poster.py job.json -o poster.png --keep-html   # debug layout
    python render_poster.py job.json --browser "C:/path/to/chrome.exe"

Needs Pillow (pip install pillow) and any Chromium-family browser (Chrome,
Edge, Chromium) - it finds one automatically on Windows, macOS and Linux.

Headless Chrome reserves some of the requested window for window furniture,
so a screenshot at exactly the poster size loses a strip off the bottom and
pads it white. The amount varies by Chrome version, so rather than hardcode
an offset we render into a deliberately oversized window and crop the top
WxH region - correct on any version.
"""
import argparse, json, os, platform, shutil, subprocess, sys, tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("error: Pillow is required for exact poster dimensions.\n"
             "  pip install pillow      (or: python -m pip install pillow)")

HERE = Path(__file__).resolve().parent
OVERSHOOT = 240  # headroom for headless window furniture; cropped off afterwards
TEMPLATE = HERE / "template.html"

CANDIDATES = {
    "Windows": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
    "Darwin": [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    "Linux": [
        "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ],
}


def find_browser(explicit=None):
    if explicit:
        if Path(explicit).exists():
            return explicit
        sys.exit(f"error: --browser path does not exist: {explicit}")
    if os.environ.get("POSTER_BROWSER"):
        return os.environ["POSTER_BROWSER"]
    for name in ("chrome", "google-chrome", "chromium", "msedge", "microsoft-edge"):
        found = shutil.which(name)
        if found:
            return found
    for path in CANDIDATES.get(platform.system(), []):
        if Path(path).exists():
            return path
    # Playwright installs land in versioned dirs; take the newest.
    root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"))
    if root.is_dir():
        hits = sorted(root.glob("chromium-*/chrome-linux/chrome"))
        if hits:
            return str(hits[-1])
    sys.exit(
        "error: no Chromium-family browser found.\n"
        "Install Google Chrome, or pass --browser with the full path to chrome.exe,\n"
        "or set the POSTER_BROWSER environment variable."
    )


def resolve_assets(data, base):
    """Rewrite hero/logo paths to absolute file URLs so the browser can load them.

    Paths in the JSON are read relative to the JSON file's own directory, which
    is what you want when a job file sits next to its nanobanana-output folder.
    """
    def fix(container, key):
        val = container.get(key)
        if not val or str(val).startswith(("http://", "https://", "data:", "file:")):
            return
        p = Path(val)
        if not p.is_absolute():
            p = (base / p).resolve()
        if not p.exists():
            print(f"warning: {key} not found, rendering without it: {p}", file=sys.stderr)
            container[key] = None
            return
        container[key] = p.as_uri()

    fix(data.setdefault("hero", {}), "image")
    fix(data.setdefault("brand", {}), "logo")
    return data


def main():
    ap = argparse.ArgumentParser(description="Render a hiring poster to PNG.")
    ap.add_argument("job", help="path to the job JSON file")
    ap.add_argument("-o", "--out", default="poster.png", help="output PNG path")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1350)
    ap.add_argument("--browser", help="explicit path to a Chromium-family binary")
    ap.add_argument("--keep-html", action="store_true",
                    help="keep the generated HTML next to the PNG for layout debugging")
    args = ap.parse_args()

    job_path = Path(args.job).resolve()
    if not job_path.exists():
        sys.exit(f"error: job file not found: {job_path}")
    try:
        data = json.loads(job_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"error: {job_path.name} is not valid JSON: {e}")

    data = resolve_assets(data, job_path.parent)
    size = data.get("size") or {}
    width, height = int(size.get("w", args.width)), int(size.get("h", args.height))

    html = TEMPLATE.read_text(encoding="utf-8")
    html = html.replace("__POSTER_DATA__", json.dumps(data, ensure_ascii=False))
    html = html.replace("width:1080px; height:1350px", f"width:{width}px; height:{height}px")

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    html_path = out.with_suffix(".html") if args.keep_html else Path(
        tempfile.mkstemp(suffix=".html")[1])
    html_path.write_text(html, encoding="utf-8")

    browser = find_browser(args.browser)
    profile = tempfile.mkdtemp(prefix="poster-profile-")
    cmd = [
        browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--no-sandbox",
        f"--user-data-dir={profile}",
        f"--window-size={width},{height + OVERSHOOT}",
        f"--screenshot={out}",
        html_path.as_uri(),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if not out.exists():
        sys.exit(f"error: browser produced no image.\n{proc.stderr.strip()[:1500]}")

    img = Image.open(out)
    if img.size != (width, height):
        img.convert("RGB").crop((0, 0, width, height)).save(out, optimize=True)

    shutil.rmtree(profile, ignore_errors=True)
    if not args.keep_html:
        html_path.unlink(missing_ok=True)
    print(f"{out}  ({width}x{height}, {out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
```

## Appendix C - starting `job.json`

```json
{
  "size": { "w": 1080, "h": 1350 },
  "brand": {
    "primary": "#0A66C2",
    "accent": "#E0301E",
    "logo": null,
    "logo_text": "Zomato",
    "tagline": ["Build", "Ship", "Learn Fast", "Grow With Us"]
  },
  "headline": {
    "company_display": "Zomato",
    "lead": "Zomato IS",
    "verb": "HIRING!",
    "role": "Data Analyst Intern",
    "blurb": "Work alongside a product analytics team on live consumer data and ship dashboards that <em>real teams use</em> every single day."
  },
  "hero": {
    "image": "hero_placeholder.png",
    "caption": "Solving today's problems for a <em>brighter tomorrow.</em>",
    "accent_note": "Freshers\nAre Welcome"
  },
  "facts": [
    { "icon": "building",  "label": "Company",    "value": "Zomato" },
    { "icon": "briefcase", "label": "Domain",     "value": "Data\nAnalytics" },
    { "icon": "pin",       "label": "Location",   "value": "Gurugram,\nIndia" },
    { "icon": "users",     "label": "Experience", "value": "Freshers" },
    { "icon": "clock",     "label": "Duration",   "value": "6 Months" },
    { "icon": "idcard",    "label": "Job ID",     "value": "ZOM24INT" }
  ],
  "eligibility": {
    "heading": "ELIGIBILITY",
    "items": ["B.E.", "B.Tech", "M.Tech", "BCA", "MCA", "B.Sc", "M.Sc", "MBA", "2026 / 2027 Batch"]
  },
  "salary": {
    "label": "STIPEND",
    "value": "₹25,000 / mo",
    "note": "(Plus PPO offer)"
  },
  "why": {
    "heading": "WHY JOIN ZOMATO?",
    "items": [
      { "icon": "chart",  "text": "Work on meaningful projects" },
      { "icon": "bulb",   "text": "Learn from senior mentors" },
      { "icon": "team",   "text": "Be part of an inclusive culture" },
      { "icon": "globe",  "text": "Grow your career fast" },
      { "icon": "rocket", "text": "Create real user impact" }
    ]
  },
  "cta": {
    "kicker": "COMMENT",
    "quote": "INTERESTED",
    "tail": "AND DM ME.",
    "sub": "I'LL SHARE THE OFFICIAL APPLICATION LINK WITH YOU.",
    "accent_note": "Let's Grow\nTogether"
  },
  "footer": {
    "left": "I post verified <b>fresher jobs, internships</b> and <b>early-career opportunities</b> every day.",
    "follow_label": "FOLLOW",
    "follow_name": "SHOUNAK SINHA",
    "follow_sub": "FOR DAILY JOB UPDATES"
  }
}
```

## Appendix D - `poster-kit/fetch_hero.py`

```python
#!/usr/bin/env python3
"""
Generate the poster's hero artwork with Nano Banana, straight off the Gemini REST
API. No Gemini CLI, no extension, no npm - just a key and stdlib.

    export NANOBANANA_API_KEY=...            # or GEMINI_API_KEY
    python fetch_hero.py "modern glass office tower from below, deep blue tones" \
        -o nanobanana-output/hero.png --size 4K --model pro

The hero slot is a tall panel cut by a diagonal, so the default aspect is 3:4 and
prompts should describe a vertical composition with the subject off-centre right.
"no text, no logos" is appended automatically: any lettering the model invents
collides with the headline the poster draws on top of the artwork.

Image generation is a PAID feature. On a key with no billing attached every image
model reports "limit: 0" and returns HTTP 429 - that is a plan problem, not a
transient rate limit, and retrying will not clear it.
"""
import argparse, base64, json, os, sys, urllib.error, urllib.request

MODELS = {
    "pro":   "gemini-3-pro-image",          # Nano Banana Pro - best detail and text
    "2":     "gemini-3.1-flash-image",      # Nano Banana 2 - current default tier
    "lite":  "gemini-3.1-flash-lite-image",
    "v1":    "gemini-2.5-flash-image",
}
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
NEGATIVE = ("Absolutely no text, no signage, no lettering, no logos, no brand marks "
            "and no watermarks anywhere in the image.")


def main():
    ap = argparse.ArgumentParser(description="Generate poster hero art via Nano Banana.")
    ap.add_argument("prompt")
    ap.add_argument("-o", "--out", default="nanobanana-output/hero.png")
    ap.add_argument("--model", default="pro", choices=sorted(MODELS))
    ap.add_argument("--size", default="2K", choices=["1K", "2K", "4K"])
    ap.add_argument("--aspect", default="3:4",
                    help="hero slot is portrait; 3:4 or 4:5 suit it best")
    args = ap.parse_args()

    key = os.environ.get("NANOBANANA_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("error: set NANOBANANA_API_KEY (or GEMINI_API_KEY) first.\n"
                 "Get one from https://aistudio.google.com/apikey")

    body = json.dumps({
        "contents": [{"parts": [{"text": f"{args.prompt.rstrip('.')}. {NEGATIVE}"}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": args.aspect, "imageSize": args.size},
        },
    }).encode()

    req = urllib.request.Request(
        ENDPOINT.format(MODELS[args.model]), data=body, method="POST",
        headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")
        msg = ""
        try:
            msg = json.loads(detail).get("error", {}).get("message", "")
        except Exception:
            msg = detail[:400]
        if e.code == 429 and "limit: 0" in msg:
            sys.exit("error: this API key's project has no image-generation quota.\n"
                     "Image models are paid-only - enable billing at "
                     "https://aistudio.google.com/apikey, or use a key from a billed project.\n"
                     "Retrying will not help.")
        sys.exit(f"error: HTTP {e.code} from Gemini: {msg[:500]}")

    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                out = args.out
                os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
                with open(out, "wb") as f:
                    f.write(base64.b64decode(blob["data"]))
                print(f"{out}  ({args.model}, {args.size}, {args.aspect})")
                return
            if part.get("text"):
                print(f"model returned text instead of an image: {part['text'][:300]}",
                      file=sys.stderr)
    sys.exit("error: no image in the response. The prompt may have been refused; "
             "simplify it and retry.")


if __name__ == "__main__":
    main()
```
