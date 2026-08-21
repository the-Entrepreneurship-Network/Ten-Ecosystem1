# Founder / Mentor / Investor / Contractor portals — specification

Section 14 of the task document. Its Definition of Done is a written
specification for each of the four portals, building on the data models that
already exist, each benchmarked against a real product.

All four are marked **COMING SOON** on the Register-As page today.

---

## Cross-cutting requirements

These apply to all four and are **preconditions, not polish**.

### 1. Authentication must be hardened first — blocking

`middleware/roleGuard.js` `attachEcosystemUser()` read
`x-ecosystem-user-id` and `x-ecosystem-user-role` straight off the request, so
any caller could declare itself an admin with two headers and walk through every
`requireRole()` guard in the app. That has been fixed to read the session only,
and the tests in `tests/middleware/roleGuard.test.js` pin it.

Still outstanding before any of these portals handles real user data:

- **Login for these roles does not exist.** `docs/user-role-map.md` lists it as
  "Phase 2". Each role has a login *page* in `public/`, but no route establishes
  an ecosystem session. Until one does, `requireRole` protects endpoints nobody
  can legitimately reach.
- **`Student` and `EcosystemUser` are not reliably linked.** A student who is
  also a contractor is two records with no join.

### 2. Design system from day one

Follow `docs/design-system.md`. These pages are new, so there is no reason for
them to arrive needing a second pass.

### 3. Notifications for every meaningful event

Use `EcosystemNotification` (see `docs/notifications-plan.md`) — profile
approved/rejected, new application, new message, session booked, interest
expressed.

### 4. Verification status must be visible

All four profile models carry `verificationStatus` (`pending` / `approved` /
`rejected`), reviewed by HR. Each dashboard must show the current status and
what happens next. A user left guessing whether they are approved will email
support instead.

### 5. Rate-limit and validate every public directory

The directories are public surfaces. Paginate, cap page size, and never return
contact details for an unapproved profile.

---

## Founder portal

> **Status: built.** See `docs/founder-os.md` for what shipped —
> `public/founder-os.html`, `routes/founderOS.js`, `models/founderOS.js`.
> The scope grew past this spec on the owner's instruction ("full startup OS"):
> the hiring pipeline below is there, and so are fundraising rounds with an
> investor tracker, a data room, a team roster and mentor booking.
>
> One precondition in this document turned out to be worse than described.
> `attachEcosystemUser` had been fixed to read the session only — but it was
> **never mounted in `server.js`**, so `req.user` was undefined for everyone and
> `requireRole()` refused every founder, mentor, investor and contractor route
> in the application. That is now mounted, which unblocks the three portals
> below as well.

**Benchmark: Wellfound (AngelList Talent) / Y Combinator's Work at a Startup.**
Both are built around company profile → job posting → applicant pipeline, which
is exactly this shape at a smaller scale.

**Exists:** `models/FounderProfile.js`, `models/StartupProfile.js`, profile
create/edit routes, a public directory, HR verification,
`public/founder-os.html` (static), `profileViews` already tracked.

### Build

**1. Startup profile editor** — the model has the fields; there is no UI.
Name, tagline, description, industry, stage, funding status, team size,
looking-for tags, co-founders, social links. Autosave drafts; publishing
requires HR verification.

**2. Post an opportunity** — internship, job, or paid milestone. Reuse
`ProgramRegistration`, which already models applications. Fields: title, type,
description, skills, commitment, duration, stipend, openings, deadline.
A posting is visible only once the founder is `approved`.

**3. Applicant pipeline** — the core screen. Per posting, applicants with their
`TalentProfile` (which exists for exactly this), moving through
`applied → shortlisted → interviewing → offered → rejected`. Bulk reject with a
reason. Never expose an applicant's contact details before shortlisting.

**4. Analytics** — profile views (already tracked), applicants per posting,
active postings, time-to-first-applicant.

### Open question

Can a founder contact an applicant directly, or only through TEN? Direct contact
is better UX; routed contact protects students. **Recommend routed via chat**,
matching the existing chat rooms, until there is a reason not to.

---

## Mentor portal

**Benchmark: ADPList / Topmate.** Both are expertise + rate + availability +
booking, which is precisely what `MentorProfile` already describes.

**Exists:** `models/MentorProfile.js` with expertise areas, years of experience,
session rate, availability and testimonials (with ratings); profile routes;
directory; HR verification.

### Build

**1. Public mentor profile** — photo, headline, expertise tags, experience,
rate, availability, testimonials. This is the page a mentee decides from.

**2. Availability picker** — a weekly-slots grid ("Tue 18:00–20:00"), not a
calendar integration. Store as recurring slots plus explicit exceptions. A full
calendar sync is a later feature and should not block this.

**3. Session booking** — request → mentor accepts/declines → confirmed →
completed. A new `MentorSession` model: `mentorId`, `menteeId`, `menteeType`,
`slot`, `status`, `topic`, `meetingLink`, `paymentRef`.

**4. Ratings and testimonials** — prompt the mentee after a completed session.
The model already supports them.

### Blocked

**Payment for sessions depends on section 12 of the task document, which is
missing from the file supplied.** Section 14 says booking "connects directly to
Devraj's coin-redemption spec (section 12)" and to the manual UPI/QR flow in
Screenshots 15–17 — none of which was included.

Two things therefore cannot be specified here: whether a session is paid in
coins, rupees, or both; and the split between mentor and TEN. **Everything above
is buildable now; the payment step is not.**

Interim option: ship booking for **free** sessions only, with paid sessions
behind a flag until section 12 arrives.

---

## Investor portal

**Benchmark: AngelList's investor-side deal room.** Filterable startup list,
save/track, a lightweight "interested" signal. At TEN's scale, small.

**Exists:** `models/InvestorProfile.js` with fund name, investor type, thesis,
investment range, stage/sector/geography focus, portfolio; profile routes;
directory; HR verification.

### Build

**1. Investor profile** — fund, type, thesis, cheque size, focus, portfolio.
Investors are evaluated by founders too; this is a two-sided marketplace.

**2. Deal flow** — a filtered founder directory: stage, sector, team size,
funding status, geography. Default the filters to the investor's stated thesis,
so the first view is already relevant.

**3. Express interest** — one action on a startup profile, generating an
`EcosystemNotification` to that founder. Deliberately lightweight: a signal, not
a term sheet.

**4. Watchlist** — save startups and track changes.

### Two decisions needed

**Do founders opt in to being visible to investors?** Recommend **yes, explicit
opt-in.** A founder who is not raising should not be in a deal-flow list, and
appearing in one without consent is a bad surprise.

**Can investors see student talent?** Recommend **no.** Students are interns,
not deal flow, and mixing the two makes the product hard to reason about.

---

## Contractor portal

**Benchmark: Upwork / Contra.** Skills + portfolio + rate + short paid
engagements.

**Exists:** `models/ContractorProfile.js` with skills, experience, portfolio,
hourly rate, availability. **Least built out of the four** — no directory route
and only a placeholder dashboard.

### Build

**1. Contractor profile + public portfolio** — skills with proficiency,
portfolio items (title, link, description, tags), hourly rate, availability.
The portfolio page should be public so founders can browse before posting.

**2. Contractor directory** — filter by skill, rate band, availability. Mirrors
the founder directory.

**3. Task marketplace** — founders post short paid tasks; contractors apply.
Conceptually the founder job-posting feature scoped to shorter, paid,
skill-specific work. Reuse the same posting model with `type: 'contract'` rather
than building a second one.

**4. Engagement tracking** — accepted → in progress → delivered → paid, with a
deliverable link and a founder sign-off.

### Blocked

**Same as the mentor portal**: paying a contractor depends on the missing
section 12. Everything up to "delivered" is specifiable; settlement is not.

---

## Suggested order

1. **Harden ecosystem authentication** — blocking for all four.
2. **Founder** — highest value; it creates the opportunities the other roles
   respond to, and its applicant pipeline reuses `TalentProfile`.
3. **Contractor** — reuses the founder posting model; least new surface.
4. **Mentor** — buildable except payment.
5. **Investor** — depends on a population of founder profiles existing first.

Investor last is deliberate: a deal-flow view with three startups in it is worse
than no deal-flow view.

---

## What is not specified here, and why

- **Payment and coin redemption.** Section 12 was not in the supplied document.
  Mentor sessions and contractor engagements both need it.
- **Contract and invoice templates** for contractor work — a legal question
  before an engineering one.
- **Search ranking** across the directories. Filters first; ranking once there
  is enough data for it to mean anything.
