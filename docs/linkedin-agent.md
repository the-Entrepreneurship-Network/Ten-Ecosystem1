# LinkedIn openings

A section in every portal listing the fourteen internship openings. Each one shows its
poster and the post that goes with it, with a button to copy the words and a link to
download the picture. A person takes both and posts them to LinkedIn from their own
account.

**Nothing in this app posts to LinkedIn.** There is no token, no OAuth, no cron, and no
code path that reaches `api.linkedin.com`.

## Why it is not an agent

It was one. An earlier version queued a hiring post on a schedule and published it to the
company page through the Community Management API. That was removed, and not because it
did not work — because of what it risked. Automated posting is what gets a company page
restricted, and the page is where the applications come from. The downside was not a bug
that could be fixed; it was the design.

Two things follow, and both are deliberate:

- **Three roles see it: HR, coordinator, admin.** An earlier version opened it to every
  signed-in role, on the argument that fourteen interns sharing an opening outreach one
  company page. That argument about reach still holds and was overruled anyway: this is
  hiring copy in draft, and who posts it and when is a decision the people running the
  hiring make. The five other portals had the section stripped out, but that is a courtesy
  — the control is `staffOnly` on the route, so a student who knows the URL gets a 403
  whatever their dashboard draws.
- **It is read-only.** No textarea, no publish button, no form. `tests/public/linkedinAgentUi.test.js`
  asserts their absence, and `tests/routes/linkedinAgent.test.js` asserts a 404 on every
  route that used to publish. Those tests exist because "just make it post again" is a
  reasonable-sounding request, and this is where the answer lives.

## The parts

| File | What it is |
|---|---|
| `services/v2/linkedin/openings.js` | The fourteen domains, the programme facts, the apply links, and the post text. Pure functions, no network, no database. |
| `routes/v2/linkedinAgent.js` | One endpoint, `GET /api/v2/linkedin/openings`, behind HR, coordinator and admin. |
| `public/linkedin-agent.js` | The section. Exposes `window.TENLinkedInAgent.mount(host, { role, headers })`. |
| `public/assets/linkedin-posters/*.jpg` | The plates. |

Three portals — `hr-portal.html`, `coordinator-dashboard.html` and `ten-admin.html` — call
`mount()` with a host element and their own role. `tests/public/linkedinAgentVisibility.test.js`
checks both halves: that those three carry it, and that the other five do not.

## The posters

Twenty-eight in all: two per domain, identical in layout, differing only in the artwork on
the right.

| Variant | File | Artwork |
|---|---|---|
| `domain` | `<slug>.jpg` | the domain's own mark — the Python logo, and so on |
| `ten` | `<slug>-ten.jpg` | the TEN building with the gold-hands mark |

Both sets are committed, so every domain shows two plates. `openings.posters()` asks the
filesystem which exist rather than trusting a hard-coded list, which is what let the second
set arrive by being copied in — no code change and no restart, because the directory is
read per request rather than cached. A plate that goes missing drops out of the list rather
than reaching the browser as a broken image.

The facts on a plate and the facts in the post come from the same `PROGRAMME` constant, so
they cannot disagree. If you regenerate a poster, check it still says what `PROGRAMME`
says — a post claiming three months above an image claiming six is a failure you cannot
catch by looking at either one alone.

### Making them

`poster-kit/` renders the plates, and the facts on a poster change when the batch does:

```bash
python poster-kit/build_domain_posters.py                 # the fourteen domain plates
python poster-kit/build_domain_posters.py --variant ten   # the fourteen TEN plates
python poster-kit/build_domain_posters.py --all           # all twenty-eight
```

An image model draws the artwork; a headless browser draws every word from JSON. **That
split is the whole architecture, and it is not a stylistic preference.** The TEN hero came
from a 3D render that also tried to letter the poster itself, and it produced "MGDE" for
MODE, "Frechers" for Freshers, "Across 19 Domains" against a company that has fourteen, and
a stipend of ₹5,000 a month for an internship that pays nothing. Those would have gone out
on a live job advertisement. The plates above carry the same artwork with every word set by
the browser, which is why they are right.

The build fails loudly if its domain list drifts from `openings.js`, so a domain cannot
quietly end up without a poster.

The hero artwork carries no watermark: `prepare_heroes.py` cover-crops each source image to
3:4 around its centre, which trims the bottom-right corner a watermark sits in. Keep that
crop if you replace the plates.

## The post text

Long on purpose, and the length is all projects and specifics. A reader who stops after the
first screen has still seen the role, the batch and three things they would build.

**The stipend is stated once and never argued.** It reads `Stipend: Competitive salary
along with terms and conditions`, and appears a second time only as a perk. There is no
figure and no paragraph spelling the terms out, and both of those absences are tested:
`tests/services/v2/linkedin/openings.test.js` fails on a rupee amount, on any number that
looks like a monthly figure, and on a third mention of the word.

That matters more than it looks. This copy went out unpaid until the team confirmed
otherwise, so a stale figure here is not a typo — it is a compensation claim on a live job
advertisement, made to freshers deciding whether to give up three months. If the terms
change, change `PROGRAMME.stipend` and re-render; do not add a sentence explaining them,
because a poster is not where terms belong and a reader who sees them start stops reading.

Each domain's three `builds` lines are specific to that domain and true of it. The Redis
clone belongs to Software Engineering because that is who builds it; putting it under
Python would be a nicer sentence and a false one, and there is a test for that too.

## Changing the copy

Edit `services/v2/linkedin/openings.js`. The post template is `text()`, the per-domain
project lines are `DOMAINS[].builds`, and the batch, mode, duration and eligibility are in
`PROGRAMME`. Apply links live in `APPLY` and are keyed by track, not by domain, because
onboarding is organised by track — every engineering intern goes through the same door.

Then run:

```bash
npx jest tests/services/v2/linkedin tests/routes/linkedinAgent.test.js tests/public
```
