# Academics & Career Portal — specification

Status: **specification only. Nothing here is built yet.**

This document is the written form of a spoken brief. It exists so the scope can
be agreed before any code is written, because the brief as given is several
months of work and contains three decisions that change what gets built.

---

## 1. Navigation

```
Student Portal
└── Academics
    ├── Student     → Domains (14 LLM learning domains)   [premium]
    ├── Job         → Job Findings                        [premium]
    ├── Resume      → Resume Builder
    │                 Resume Checker
    └── Hackathons  → Idea-thons & Hackathons
```

Academics is a new top-level section of the student portal. Every card inside it
shows a preview before it shows a paywall.

---

## 2. Student → Domains

### 2.1 Entry

1. Student clicks the **LLM Portal** card in Academics.
2. A **preview** opens first — a carousel of what the tier unlocks: modules,
   AI-marked written tests, projects, certificate, resume boost, job access.
   The preview is shown before any mention of price.
3. A **payment popup** follows, for the Premium tier.

### 2.2 Pay-now vs pay-later

Two payment moments per domain:

| Moment | Popup | Skip control |
| --- | --- | --- |
| On entry | Premium tier offer | **"Continue to modules"** at the bottom — pay later |
| On domain completion | Same offer | **None.** Payment is required to release the certificate |

Pay-later is allowed **once per domain**. A student may study the whole domain
unpaid; the certificate is what is gated, not the learning.

### 2.3 Module structure

Coursera-shaped, per domain:

```
Domain → Modules → Lessons → Project → Written assessment
```

### 2.4 Assessment rules

- Written answers, **not** multiple choice.
- Pass mark **70%**.
- Marked by an AI evaluator scoring semantic closeness to a model answer.
- Pass → next module unlocks.
- Fail → up to **3 attempts**.
- **Attempt window:** when 3 attempts are spent, the next attempt becomes
  available 24 hours after the timestamp of the *first* attempt in that group of
  three. Not midnight, not 24h after the last attempt — 24h after the first.

Worked example. Attempts at 09:00, 11:00 and 15:00 on the 1st, all failed. The
4th attempt unlocks at 09:00 on the 2nd.

### 2.5 Projects

Projects must not be trivially skippable.

- Attempting to skip raises a popup arguing the case: projects are the part a
  recruiter can actually verify, and they are what the resume section draws on.
- No prominent "skip to certificate" control.
- Soft pressure only. A student who insists can still proceed — a hard block
  would strand anyone who genuinely cannot complete a project.

### 2.6 Completion

On finishing a domain: generate a downloadable, shareable **Certificate of
Completion**, then route the student to Resume Builder, then to Job Findings.

---

## 3. Job → Job Findings

1. Benefits popup.
2. Payment. **No skip, no free continue** — this section is paid outright.

Two tabs:

**A. ATS-friendly resume builder.** Upload an existing resume or start clean;
pick a target domain/role; AI optimises for ATS parsing; certificates earned in
section 2 are offered for inclusion automatically; export PDF and DOCX.

**B. Job search.** Student uploads a resume and picks a domain. Search runs
across LinkedIn, Internshala, Unstop, Naukri, Indeed and others. Filters: India
or worldwide, experience, location, job type, salary band, posted date. Each
result shows title, company, location, apply link, careers page and contact
where available. Apply opens the original posting.

> **This is the highest-risk item in the brief. See §7.1.**

---

## 4. Resume

- **Builder** — as above.
- **Checker** — upload, AI score, itemised feedback, "fix with AI" action.

---

## 5. Hackathons

- Upcoming idea-thons and hackathons: college, national, international.
- Past events with highlights and winners.
- **Time Building** — start building before the event opens: milestone
  tracking, team formation and invites, daily/weekly progress log.
- Registration, idea submission, team tools.
- Participation and winner certificates.
- Optional premium tier for mentoring or exclusive events.

---

## 6. Decisions needed before any code

### 6.1 Stack

The brief asks for Next.js 14 (App Router) + Tailwind + shadcn/ui + Framer
Motion + Supabase + Razorpay/Stripe.

This repository is Express 5 + Mongoose + server-rendered HTML, running under
PM2 on EC2 behind nginx. Students authenticate through `req.session.student`.

The two are not compatible in the same process. Three options:

| Option | What it means | Cost |
| --- | --- | --- |
| **A. Extend this portal** | Build Academics in Express + Mongo + the existing HTML/CSS, reusing sessions, the UPI payment flow and the certificate pipeline already here | Lowest. Ships incrementally. No new infrastructure, no second login |
| **B. Separate Next.js app** | New app, Supabase auth, Razorpay, deployed separately, linked from the portal | Highest. Two auth systems, two databases, students log in twice, student records split across Mongo and Postgres |
| **C. Next.js frontend on this API** | Next.js UI, existing Express API and Mongo behind it | Middle. Keeps one source of truth, but a build step and a second deploy target |

Recommendation: **A**. The portal already has sessions, a payment flow with HR
verification, a certificate pipeline with approval stages, and 14 domains in
`DomainTask`. Supabase and Razorpay would duplicate all four.

### 6.2 Who writes the course content

14 domains × N modules × lessons × projects × written questions × model answers.
This is the largest single cost in the brief and none of it is engineering. The
platform is worthless without it. Needed: who writes it, and by when.

### 6.3 Which AI marks the tests

§2.4 needs semantic marking. Every model API was removed from this project by
earlier instruction, and the assistant currently runs with no model at all.
Options: bring back an API for marking only, run a local embedding model for
similarity, or have coordinators mark by hand with AI assistance.

Marking that decides whether a student progresses cannot be a mock.

---

## 7. Risks

### 7.1 Job search across LinkedIn, Internshala, Unstop, Naukri

Scraping these is against their terms of service. LinkedIn blocks it actively
and litigates. Internshala and Unstop prohibit automated collection. A scraper
would break often, and could expose TEN legally.

Legitimate routes:

- **Aggregator APIs** — Adzuna, JSearch, Careerjet, SerpApi. Paid, licensed,
  covering most Indian and global listings.
- **Official programmes** — Indeed Publisher, LinkedIn Talent Solutions
  (partner-gated).
- **Direct feeds** — many employers publish a jobs RSS or JSON feed.

The product as described works fine on aggregator APIs. Recommendation: budget
for one, do not scrape.

### 7.2 Payment

The portal takes UPI with manual HR verification. The brief asks for
Razorpay/Stripe. Razorpay would give instant automatic activation and remove the
2–24 hour manual step — a genuine improvement, but it is a commercial decision
(merchant account, KYC, fees) and not only a technical one.

### 7.3 Pay-later

§2.2 lets a student consume an entire domain before paying. This is deliberate
and defensible — the certificate is the product. Worth confirming that is the
intent and not a misreading.

---

## 8. Suggested build order

Each phase is independently shippable and useful on its own.

1. **Academics shell** — the section, the four cards, preview modals, paywall
   reusing the existing UPI flow. No course content yet.
2. **Domain and module model** — schema, seeding, progress tracking, lesson
   viewer. One domain end to end as the pilot.
3. **Assessment engine** — written tests, the 70% mark, the 3-attempt and
   24-hour window, module unlocking. Server-side; testable without any UI.
4. **Certificates** — reuse `CertificateRequest` and the existing approval flow.
5. **Resume builder and checker.**
6. **Job search** — once §7.1 is settled and an API is chosen.
7. **Hackathons.**

Phase 3 is the part worth building first in engineering terms: it is pure logic,
it is where the rules are subtle, and it can be fully tested before a single
screen exists.
