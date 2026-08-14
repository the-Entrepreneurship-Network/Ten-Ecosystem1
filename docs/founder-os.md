# Founder OS

The founder workspace behind "Hire our interns" on the home page.
Page: `public/founder-os.html`. API: `routes/founderOS.js`, mounted at
`/api/founder-os`. Data: `models/founderOS.js`.

This document is the reference for what it does, what it deliberately does not
do, and the two bugs that made the previous version look broken.

---

## Why the old one did nothing

Two independent faults, and either alone was enough.

**1. `attachEcosystemUser` was never mounted.**
`middleware/roleGuard.js` exports it, `tests/middleware/roleGuard.test.js`
tested it, and `server.js` never called it. It is the only thing that sets
`req.user`, and `requireRole()` answers `401 Authentication required` when
`req.user` is absent. So **every route in the application behind a
`requireRole` guard refused a correctly signed-in founder, mentor, investor and
contractor.** Fixed by mounting it immediately after the session middleware.

It reads the session and nothing else, so mounting it grants no access on its
own — a request with no session still arrives at `requireRole` with no
`req.user` and is still refused.

**2. There was almost no API.**
`routes/founderOS.js` had two endpoints: one that served a page, and one that
returned platform-wide totals. `public/founder-os.html` and
`public/talent-network.html` were 2,020-line near-duplicates with the same
`<title>`, rendering placeholder data.

---

## What a founder can do

| Section | What it does |
|---|---|
| **Overview** | Analytics computed from this founder's own rows — hiring funnel, committed capital against target, team size, mentor hours, data-room views |
| **Startup profile** | One form writing both `FounderProfile` and `StartupProfile` |
| **Job posts** | Create, edit, pause, close, delete. Type, work mode, stipend range, equity, openings, skills |
| **Pipeline** | A six-column board — applied → shortlisted → interview → offer → hired, plus rejected. Drag to move; every move is recorded |
| **Talent search** | Every TEN intern, filtered by domain, performance and completion. Source one straight into a job post's pipeline |
| **Fundraising** | Rounds with a target, a valuation and an investor tracker across six stages |
| **Data room** | Documents by category, private by default, optionally shared and tied to a round |
| **Team** | Roster with type, equity and status. Anyone moved to *Hired* lands here automatically |
| **Mentors** | Browse approved mentors and request a session; the mentor is notified |

---

## The rules the code enforces

### Identity comes from the session, always

`founderIdOf(req)` is the only place a founder id is produced, and every query
in the file is scoped by it. No route reads `founderId` from a body, a query or
a header.

The single exception is documented in the function: an **admin** may pass
`?founderId=` to inspect a founder's workspace. Admins only, and the write
routes still resolve through the same function so an admin acting as a founder
cannot do so silently.

Because every document lookup is `{ _id, founderId }` rather than `{ _id }`
followed by an ownership check, there is no "is this mine" test to forget — a
foreign id simply does not match, and the route answers **404 rather than 403**,
which also avoids confirming that the document exists.

### Talent search is an allowlist, not an exclusion

```js
const TALENT_FIELDS = 'name fullName employeeId domain tenure attendancePercentage ' +
  'performanceScore internshipCompleted joiningDate skills';
```

Not `.select('-password')`, which returns everything else — on this schema that
is the email, phone number, college and address. A founder is an outside party:
they get the work record, and reach a student by sourcing them into a job post,
which keeps the conversation on the platform.

`employeeId` is included because it is what a founder quotes when sourcing, and
it is already printed on every certificate.

### Committed capital is derived, never typed

`round.raisedAmount` is recomputed on every investor write as the sum of the
commitments. A total typed in one place and commitments recorded in another is
two numbers that will disagree.

### The data room is private by default

`visibility` is `'shared'` only when the request says exactly that; anything
else — including a missing field or a typo — stores `'private'`. A cap table
shared by accident is not recoverable.

### Hiring writes the team roster

Moving a candidate to `hired` creates a `StartupTeamMember` linked back to the
application, once. Doing it by hand is the step everybody forgets, which is how
a team page goes stale.

---

## Data model

`models/founderOS.js` — six collections in one file, because they only make
sense together.

- `JobPost` — scoped by `founderId`, indexed on `(founderId, status, createdAt)`
- `JobApplication` — scoped by `founderId`; unique on `(jobId, studentId)` so the
  same student cannot be in one pipeline twice; carries a `history[]` of stage
  changes
- `FundraisingRound` — investors embedded, because they are never read except
  through their round
- `DataRoomDocument` — points at an already-uploaded `url`; stores no file itself
- `StartupTeamMember` — may link back to the application it came from
- `MentorBooking` — indexed on `(founderId, requestedFor)`

Stage lists are exported (`APPLICATION_STAGES`, `INVESTOR_STAGES`) and validated
server-side. The board renders columns in that order and the analytics count
conversions between adjacent stages, so the order is meaningful, not cosmetic.

---

## The page

Plain CSS, not the Tailwind CDN the two files it replaces used —
`cdn.tailwindcss.com` compiles the whole framework in the browser on every load,
and this page is behind a login where that buys nothing.

- Nine sections, each loading on first open rather than all nine at boot
- Everything rendered through `esc()`; job titles, candidate names and investor
  names are all typed by someone
- A 401 sends the reader to `/founder-login` rather than leaving a screen of
  empty panels
- The domain list comes from `/api/public/domains`, so a job post and a student
  registration can never offer two different sets of domains
- Responsive to 390px; the sidebar becomes a drawer

---

## Not built, deliberately

- **Direct contact details.** Per `docs/portal-specs.md`, contact is routed
  through the platform. Sourcing a candidate is how a founder reaches them.
- **File upload into the data room.** Documents carry a `url`. The upload path
  already exists elsewhere and duplicating it here would mean two places to get
  file validation wrong.
- **Mentor-side confirmation UI.** `MentorBooking` supports
  `confirmed / declined / completed` and the mentor is notified on request, but
  the mentor portal's own screen for acting on it is not in this change. Until
  it exists a booking stays `requested`, and the founder can cancel.
- **Investor-side data room access.** Documents can be marked shared and tied to
  a round; the investor-facing view of them is the investor portal's work.

---

## Verification

`tests/routes/founderOS.test.js` — 31 tests over the real router with the models
faked, covering: the middleware being mounted; who is allowed in; that a
`founderId` in the query or body is ignored; that another founder's document
answers 404; stage validation; the hire→roster path and that it does not
duplicate; the talent projection; committed-capital arithmetic; the private
default; booking dates; and the analytics arithmetic on an empty workspace.

Browser pass (Playwright, Chromium): all nine sections render, the board holds
the right candidates in the right columns, a candidate modal reads the record,
the profile form is populated from the server, no page errors, and no sideways
scroll at 390px.
