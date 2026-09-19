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

The replacement is better distribution anyway. One company page posting an opening reaches
the people already following it. Fourteen interns posting the same opening reach fourteen
networks of exactly the students the opening is for — and a person saying "this is where I
am interning" carries weight a company page cannot buy.

Two related things follow, and both are deliberate:

- **Every signed-in role sees it, students included.** It is a noticeboard of copy the
  company wants spread as widely as possible, and the students are the ones best placed to
  spread it. A staff-only gate here would be a gate on the distribution.
- **It is read-only.** No textarea, no publish button, no form. `tests/public/linkedinAgentUi.test.js`
  asserts their absence, and `tests/routes/linkedinAgent.test.js` asserts a 404 on every
  route that used to publish. Those tests exist because "just make it post again" is a
  reasonable-sounding request, and this is where the answer lives.

## The parts

| File | What it is |
|---|---|
| `services/v2/linkedin/openings.js` | The fourteen domains, the programme facts, the apply links, and the post text. Pure functions, no network, no database. |
| `routes/v2/linkedinAgent.js` | One endpoint, `GET /api/v2/linkedin/openings`, behind every signed-in role. |
| `public/linkedin-agent.js` | The section. Exposes `window.TENLinkedInAgent.mount(host, { role, headers })`. |
| `public/assets/linkedin-posters/*.jpg` | The plates. |

The eight portals — student, HR, coordinator, mentor, contractor, investor, founder-os,
ten-admin — each call `mount()` with a host element and their own role.

## The posters

Twenty-eight in all: two per domain, identical in layout, differing only in the artwork on
the right.

| Variant | File | Artwork |
|---|---|---|
| `domain` | `<slug>.jpg` | the domain's own mark — the Python logo, and so on |
| `ten` | `<slug>-ten.jpg` | the TEN building with the gold-hands mark |

**The TEN set is not committed yet.** `openings.posters()` asks the filesystem which plates
exist and lists only those, so the section renders one plate per domain today and two the
day the second set lands. Deploying them is copying fourteen files into
`public/assets/linkedin-posters/`; there is no code change and no restart, because the
directory is read per request rather than cached.

The facts on a plate and the facts in the post come from the same `PROGRAMME` constant, so
they cannot disagree. If you regenerate a poster, check it still says what `PROGRAMME`
says — a post claiming three months above an image claiming six is a failure you cannot
catch by looking at either one alone.

### Making them

`poster-kit/` renders the plates and is still here, because the second set has to come from
somewhere and because the facts on a poster change when the batch does:

```bash
python poster-kit/build_domain_posters.py
```

An image model draws the artwork; a headless browser draws every word from JSON. That split
is the point — a model garbling a stipend or a date on a live job advertisement is the
failure this pipeline exists to prevent, and it is not a risk worth taking for the sake of
one render step.

The hero artwork carries no watermark: `prepare_heroes.py` cover-crops each source image to
3:4 around its centre, which trims the bottom-right corner a watermark sits in. Keep that
crop if you replace the plates.

## The post text

Long on purpose, and the length is all projects and specifics. A reader who stops after the
first screen has still seen the role, the batch and three things they would build.

**The stipend is not mentioned.** The poster states it plainly in its own field, so the
fact is published and nobody is misled. But the post does not raise it, and it never argues
that the internship is worth doing despite it. Naming an absence and then defending it is
what makes a reader decide the absence is the story; a post that spends two lines on why
unpaid is fine reads as a company with nothing else to offer. There is plenty else to offer
— six hundred-odd interns came through the last batch — so the words go there instead.
`tests/services/v2/linkedin/openings.test.js` asserts the word never appears, because the
omission looks like an oversight and somebody will eventually try to "fix" it.

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
