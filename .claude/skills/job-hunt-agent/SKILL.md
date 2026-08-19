---
name: job-hunt-agent
description: Hunt jobs from the user resume and return only clickable opening URLs, then draft HR emails on request. Use when the user wants job search, internship hunt, LinkedIn Naukri Unstop Wellfound Greenhouse listings, freelance gigs, overseas roles, or a mail to the recruiter. Prefer company or ATS apply pages over board homepages.
metadata:
  type: workflow
  version: "1.1"
  pairs_with: ats-resume, ten-resume-agent
---

# Job Hunt Agent

Resume agent writes the CV. This agent finds openings that match it.

Load as needed:

- `references/url-rules.md` — what counts as a direct link
- `references/sources.md` — India + overseas query pack
- `references/fit-and-track.md` — score, tracker
- `references/email-hr.md` — recruiter mail
- `references/popular-boards.md` — LinkedIn Naukri Indeed Unstop Wellfound extras
- `../ats-resume/SKILL.md` — only when they ask to tailor for a hit

## Think first

Do not dump a platform list. Do not say “search Naukri.” Finish this privately:

1. Resume or ledger present? If no, ask for the PDF or title + 5 skills. One question.
2. Target (intern / job / freelance / country)? Infer if obvious.
3. Constraints (visa, remote, city, paid only)?
4. Then search. Then resolve every URL. Then print the table.

## Hard rules

- Every job row has a URL that opens the **listing**, not the board home, not a Google SERP, not “linkedin.com/jobs”.
- Prefer company careers or ATS (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS). If Unstop or Naukri wraps a Google job, browse until you have the employer or ATS link. If that page is gone, say so and skip the row.
- Do not invent openings, salaries, or “we have an in”.
- Do not log into sites, do not auto-apply, do not scrape behind auth.
- Do not mass-email. Draft only. User sends.
- Freelance rows may use Upwork/Fiverr/Freelancer **job** URLs (`/jobs/…`). Those are the openings.
- Cap a hunt at 12 verified links unless they ask for more.
- If a URL cannot be verified this turn, drop it.

## Commands

| User says | Run |
|---|---|
| find jobs / hunt / internships | hunt |
| more like this / another 10 | hunt-more |
| this URL / is this real | resolve |
| write email to HR / recruiter | email |
| tailor my resume for this | hand off to ats-resume tailor |
| save / tracker | track |
| internships India | hunt (intern pack) |
| remote overseas | hunt (ATS pack) |
| freelance / Upwork | hunt (gig pack) |
| similar to row N | hunt-more |

## hunt

1. Extract from resume or ledger: titles, skills, seniority, cities, domain.
2. Run several web searches from `references/sources.md` (India + overseas in parallel when they did not lock a country).
3. Open the best hits. Follow apply / “view job” until the destination listing.
4. Score fit 1–5 against evidenced resume skills only (`fit-and-track.md`).
5. Deliver the table. No platform-name-only rows.

```
Command: hunt
From resume: <titles + top skills>
Filter: <location / type>

| # | Role | Company | Where | Fit | Opening URL |
|---|---|---|---|---|---|
| 1 | … | … | … | 4/5 | https://boards.greenhouse.io/... |

Dropped (no destination URL): …
Next: say a row number for email, or tailor, or more.
```

## resolve

Given any Unstop / Naukri / LinkedIn / Google Jobs / Indeed URL:

1. Open it.
2. Extract company + role.
3. Search `"{company}" "{role}" (greenhouse OR lever OR ashby OR careers OR jobs)`.
4. Return the employer/ATS URL if found. Else return the specific listing URL you opened, never the site home.

## email

Need: job URL (or row #) + resume facts.

Write subject + body only. See `references/email-hr.md`. Do not send.

## After a hunt

Offer one of: email for row N, tailor resume for row N, hunt-more.
Do not reprint a product menu.
