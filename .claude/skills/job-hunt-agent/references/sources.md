# Search pack

Build queries from the resume. Swap TITLE, SKILL, CITY.

## Always (destination-first)

```
TITLE SKILL (intern OR internship OR "new grad" OR junior) (greenhouse OR lever OR ashby OR workday OR careers)
"TITLE" "SKILL" site:boards.greenhouse.io
"TITLE" site:jobs.lever.co
"TITLE" site:jobs.ashbyhq.com
TITLE SKILL site:myworkdayjobs.com
```

## India

```
TITLE intern India (Bengaluru OR Bangalore OR Hyderabad OR Pune OR Mumbai OR Delhi OR remote)
TITLE internship site:unstop.com
TITLE intern site:internshala.com
TITLE "walk-in" OR internship site:naukri.com
TITLE intern site:cutshort.io
```

Then resolve Unstop/Internshala/Naukri hits to employer/ATS.

## Overseas / remote

```
TITLE SKILL (United States OR Europe OR remote) (greenhouse OR lever)
TITLE "new graduate" OR intern site:careers.google.com
TITLE intern site:amazon.jobs
TITLE intern site:careers.microsoft.com
TITLE site:wellfound.com/jobs
```

Use company names from the resume (projects, internships, tools vendors) as extra queries.

## Freelance (only if they asked or the resume is gig-shaped)

```
TITLE SKILL site:upwork.com/jobs
TITLE SKILL site:freelancer.com/projects
TITLE SKILL site:fiverr.com
```

Keep only URLs with a job/project id.

## How many searches

One hunt: 6–10 queries, mix India + overseas unless they locked a market.
Read 15–25 results. Keep ≤12 verified openings.
Prefer recency when the snippet shows days/weeks.

## Verification

Open the candidate URL. If title and company are missing, drop it.
If the page is a search list, do not use it.
