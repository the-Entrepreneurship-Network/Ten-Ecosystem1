# LinkedIn agent

Every Saturday and every Sunday, at 10:00 IST, the agent publishes one
internship opening to the company page,
https://www.linkedin.com/company/the-entrepreneurship-network/. It rotates
through the fourteen domains the site advertises, so each one comes round
about every seven weeks.

Nobody writes it. Nobody approves it. There is no text box anywhere in the
portal that reaches this — the dashboards carry a **read-only** section that
shows how many posts the agent has put out, which went out last, and which
domain is up next.

The section appears in the HR portal, the coordinator dashboard, the mentor
dashboard and Founder OS. Students, investors and contractors do not see it,
and the API refuses them if they find the URL.

## What goes out

One post per slot, built from `services/v2/linkedin/weekendPost.js`:

- The domain's own role name, domain, mode (Remote), duration (2–6 months),
  eligibility, and the stipend stated as **Unpaid** — in the fact list and
  again in prose, because burying it is how a fresher finds out after they
  have already started. There is no rupee figure anywhere in the file.
- **One application link**: the one for that domain's onboarding track, and no
  others. The hand-written posts used to carry all six, which left an
  applicant to work out which was theirs.
- The argument the programme actually makes: no course to sit through first,
  no training block before you touch anything real — an industry-level project
  from week one, reviewed every week.
- Five hashtags in total, two of them in the headline.

Attached to it is that domain's poster, pre-rendered in
`public/assets/linkedin-posters/<slug>.jpg`. See "Posters" below.

## How it runs

Two crons, and they are deliberately separate.

`services/v2/linkedin/autopilot.js` ticks every ten minutes. It does nothing at
all except on a Saturday or a Sunday between 10:00 and 22:00 IST, when it
builds the post for whichever domain the date says, runs it past the content
guard, reads the poster off disk and saves it as a `scheduled` post. Ten
minutes rather than one weekly cron at 10:00 sharp: a weekly job that fires
while the box is restarting misses the slot and nobody notices until Monday.

`services/v2/linkedin/scheduler.js` ticks every minute and is what actually
talks to LinkedIn. It claims a due post with a single atomic
`findOneAndUpdate`, re-checks the text, uploads the image and publishes.

The split is worth the extra hop: the scheduler already holds the parts that
are hard to get right and are covered by tests — the atomic claim that stops
two PM2 workers publishing the same thing, the dry-run path, the re-check at
publish time, the failure recording. A second publish path would have to stay
in step with all of that forever.

### One post per slot

The `slot` field on `LinkedInPost` carries `weekend:YYYY-MM-DD` and is uniquely
and sparsely indexed. Every worker ticks; the first insert wins and the rest
come back as a duplicate-key error, which the autopilot treats as success,
because "somebody already queued this" is the normal outcome rather than a
fault.

### The rotation

`weekendPost.pick(date)` is a pure function of the IST calendar date: the
number of weekend days since a fixed Saturday, modulo fourteen. Nothing is
stored, so a restart, a second worker and a database restore all agree on which
domain a given day gets. Every calendar calculation is done by hand against a
fixed +05:30, because the server runs in UTC and India has no daylight saving.

### With no token

A server with no LinkedIn connection still queues, records and reports every
weekend post — it builds the payload and simply never sends it. That is how a
fresh deployment behaves and how the tests run. The dashboard says so at the
top of the section, because otherwise the count reads as a count of posts the
public saw.

## Posters

Fourteen posters, one per domain, rendered once and committed:

```bash
python poster-kit/build_weekend_posters.py
```

That script drives `poster-kit/render_poster.py` (headless Chrome renders every
word from JSON — an image model garbling a stipend on a live job ad is the
failure this pipeline exists to prevent) and writes JPEGs to
`public/assets/linkedin-posters/`. It fails loudly if its domain list drifts
from `weekendPost.js`.

Rendering at post time would mean a headless browser on the production box at
ten past ten on a Saturday with nobody watching it fail, to draw a poster whose
every word is a constant. A missing file costs the post its image and nothing
else.

## The HTTP surface

`/api/v2/linkedin`, all of it read-only, all of it HR / coordinator / mentor /
founder / admin:

| Route | What it answers |
| --- | --- |
| `GET /autopilot` | The counts, the recent posts, what is queued, the next six slots |
| `GET /status` | Whether the page is connected and when the token expires |
| `GET /posts`, `GET /posts/:id` | The post history |
| `GET /posts/:id/poster.svg` | The poster for an older, agent-written post |
| `GET /stats` | LinkedIn's own share statistics, when the token allows |
| `GET /oauth/start`, `GET /oauth/callback` | Connecting the page — **HR and admin only** |

There is no route that publishes, schedules, edits or deletes a post. That is
asserted by a test, because a publish route left mounted "just in case" is a
second way for text to reach the company page, with no rotation behind it and
no slot key.

## Connecting the page

HR opens the LinkedIn Agent section and uses Connect. It needs
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_REDIRECT_URI`, the
`w_organization_social` scope, and the signed-in person to be an
ADMINISTRATOR or CONTENT_ADMIN of the page. The token is stored with
`select: false` and never appears in a response or a log.

`LINKEDIN_AUTOPILOT_DISABLED=1` stops the weekend job without stopping the
scheduler; `LINKEDIN_SCHEDULER_DISABLED=1` stops the publisher. Neither cron
starts under `NODE_ENV=test`.
