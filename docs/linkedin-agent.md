# LinkedIn agent

Every two hours, round the clock, the agent publishes one internship opening
to the company page,
https://www.linkedin.com/company/the-entrepreneurship-network/. It rotates
through the fourteen domains the site advertises; twelve posts a day against
fourteen domains makes a twenty-eight hour lap, so a domain never lands at the
same hour two days running.

Nobody writes it. Nobody approves it. There is no text box anywhere in the
portal that reaches this — every portal carries a **read-only** section that
shows the posts themselves: the poster and the full text of each one, newest
first.

The section is in **every portal**, in the slot the Attendance Report used to
hold: the student dashboard, the HR portal, the coordinator dashboard, the
mentor dashboard, Founder OS, the investor dashboard, the contractor dashboard
and the admin portal. Everybody who signs in sees the same thing, because
everything in it is already public on LinkedIn and there is nothing in it to
operate. A request with no session is still refused.

## What goes out

One post per slot, built from `services/v2/linkedin/domainPost.js`:

- **Three things an intern in that domain actually builds**, named concretely:
  your own Redis, your own search engine, a production API. That list is the
  post's argument. "You will get hands-on experience" is what every internship
  advertisement says; "you will write your own Redis" is not.
- The facts: role, domain, October 2026 batch, Online, 3 Months, eligibility,
  and the stipend stated as **Unpaid**.
- **One application link**: the one for that domain's onboarding track, and no
  others. The hand-written posts used to carry all six, which left an
  applicant to work out which was theirs.
- That no prior knowledge is needed, said plainly — the audience is freshers
  who think they are not ready.
- Five hashtags in total, two of them in the headline.

### The stipend is stated, not argued

One line, in the fact block: `Stipend: Unpaid`. There is no paragraph
explaining why the internship is worth taking anyway, and a test enforces that:
it fails if the word "unpaid" appears more than once in a post, or anywhere
near "though", "worth", "still" or "instead". A paragraph like that reads as an
apology and tells the reader the company has nothing else to offer. It has
plenty else to offer, and the post spends its words on that. There is no rupee
figure anywhere in the file or on the poster.

Attached to it is that domain's poster, pre-rendered in
`public/assets/linkedin-posters/<slug>.jpg`. See "Posters" below.

## How it runs

Two crons, and they are deliberately separate.

`services/v2/linkedin/autopilot.js` ticks every five minutes. Every instant
belongs to a two-hour slot — there is no day or hour the rotation skips — so
the tick works out which slot it is standing in, and if that slot has not been
filled it builds the post for whichever domain the clock says, runs it past the
content guard, reads the poster off disk and saves it as `scheduled`.

Five minutes rather than a cron firing on the even hours: a cron that fires
while the box is restarting misses its slot outright, and a missed slot is a
two-hour hole. A worker that wakes up late queues the slot it is in and does
**not** catch up on the ones it slept through — a post four hours late is
competing with the one about to go out on time.

### The post on deploy

The autopilot also runs one check **ten seconds after start-up**, and the
scheduler sweeps five seconds after that. So a fresh deploy puts a post on the
company page inside about fifteen seconds rather than waiting up to five
minutes for the next cron edge and another minute to publish.

That kick runs on **every** boot, not only the first. What stops a redeploy
inside an already-posted slot from posting twice is the unique index on `slot`,
not a first-run flag — which is the same mechanism that already stops several
PM2 workers booting together from posting the same thing, and is why there is
no special case for it.

`services/v2/linkedin/scheduler.js` ticks every minute and is what actually
talks to LinkedIn. It claims a due post with a single atomic
`findOneAndUpdate`, re-checks the text, uploads the image and publishes.

The split is worth the extra hop: the scheduler already holds the parts that
are hard to get right and are covered by tests — the atomic claim that stops
two PM2 workers publishing the same thing, the dry-run path, the re-check at
publish time, the failure recording. A second publish path would have to stay
in step with all of that forever.

### One post per slot

The `slot` field on `LinkedInPost` carries `slot:YYYY-MM-DDTHH` — the IST
two-hour bucket — and is uniquely and sparsely indexed. Every worker ticks;
the first insert wins and the rest come back as a duplicate-key error, which
the autopilot treats as success, because "somebody already queued this" is the
normal outcome rather than a fault. Nothing depends on the tick interval
dividing the slot length or on two workers agreeing about anything: they agree
because the slot key is a pure function of the clock.

### The rotation

`domainPost.pick(date)` is a pure function of the IST clock: the number of
two-hour slots since a fixed instant, modulo fourteen. Nothing is stored, so a
restart, a second worker and a database restore all agree on which domain a
given slot gets. Every calendar calculation is done by hand against a fixed
+05:30, because the server runs in UTC and India has no daylight saving.

### With no token

A server with no LinkedIn connection still queues, records and reports every
post — it builds the payload and simply never sends it. That is how a
fresh deployment behaves and how the tests run.

Those posts appear in the feed carrying a **"Not on LinkedIn yet"** badge
rather than "Posted". Dropping them would leave a fresh deployment showing an
empty section that reads as broken; counting them silently among the published
ones would tell an intern the page said something it never said. HR and admin
additionally get a line explaining that the page needs connecting, because
they are the only roles that can do anything about it.

## Posters

Fourteen posters, one per domain, rendered once and committed:

```bash
python poster-kit/build_domain_posters.py
```

That script drives `poster-kit/render_poster.py` (headless Chrome renders every
word from JSON — an image model garbling a stipend on a live job ad is the
failure this pipeline exists to prevent) and writes JPEGs to
`public/assets/linkedin-posters/`. It fails loudly if its domain list drifts
from `domainPost.js`, and a test fails if the facts printed on the poster stop
matching the facts stated in the post.

Rendering at post time would mean a headless browser on the production box
every two hours, at three in the morning, with nobody watching it fail, to draw
a poster whose every word is a constant. A missing file costs the post its
image and nothing else.

The hero artwork carries no Gemini watermark: `prepare_heroes.py` cover-crops
each source image to 3:4 around its centre, which trims the bottom-right corner
the watermark sits in. Keep that crop if you ever replace the plates.

## The HTTP surface

`/api/v2/linkedin`, all of it read-only.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /feed` | **anyone signed in** | The published posts — poster, full text, date, link |
| `GET /feed/:id/image` | **anyone signed in** | A stored poster, for posts not on one of the fourteen plates |
| `GET /status` | staff | Whether the page is connected and when the token expires |
| `GET /posts`, `GET /posts/:id` | staff | The history, failure states included |
| `GET /posts/:id/poster.svg` | staff | The poster for an older, agent-written post |
| `GET /stats` | staff | LinkedIn's own share statistics |
| `GET /oauth/start`, `GET /oauth/callback` | HR and admin | Connecting the page |

"Anyone signed in" is `requireRole(...ALL_ROLES)` — built from the constant in
`config/roles.js` rather than a hand-written list, so a role added later is
admitted instead of being silently locked out of a section every other role
can see. "Staff" is HR, coordinator, mentor, founder and admin.

`GET /feed` answers with the posts and nothing else. Failure counts, error
strings, the queue, the rotation and the token's expiry are all real and all
in the database; they are simply not that endpoint's business. Two connection
fields are added for HR and admin, who are the only roles that can act on
them. Posts that are queued or failed never appear — a queued post is
tomorrow's announcement, and the feed must not be a way to read it today.

There is no route that publishes, schedules, edits or deletes a post. That is
asserted by a test, because a publish route left mounted "just in case" is a
second way for text to reach the company page, with no rotation behind it and
no slot key.

## Connecting the page

HR visits `/api/v2/linkedin/oauth/start`. It needs
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_REDIRECT_URI`, the
`w_organization_social` scope, and the signed-in person to be an
ADMINISTRATOR or CONTENT_ADMIN of the page. The token is stored with
`select: false` and never appears in a response or a log.

`LINKEDIN_AUTOPILOT_DISABLED=1` stops the posting job without stopping the
scheduler; `LINKEDIN_SCHEDULER_DISABLED=1` stops the publisher. Neither cron
starts under `NODE_ENV=test`.
