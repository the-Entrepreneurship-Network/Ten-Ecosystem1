# Direct opening URLs

A valid link is one click from this chat to the job text (title, company, apply).

## Accept

- `https://boards.greenhouse.io/<org>/jobs/<id>`
- `https://jobs.lever.co/<org>/<id>`
- `https://jobs.ashbyhq.com/<org>/<id>`
- `https://<company>.wd1.myworkdayjobs.com/...`
- `https://jobs.smartrecruiters.com/...`
- `https://careers.<company>.com/...` or `https://<company>.com/careers/...` with a specific job slug
- `https://www.linkedin.com/jobs/view/<id>` only if no company/ATS page exists
- `https://www.upwork.com/jobs/~<id>` / Fiverr or Freelancer **gig/job** URLs
- Wellfound / AngelList **job** URLs (`/jobs/` or company job slug)

## Reject

- `linkedin.com` or `linkedin.com/jobs` with no view id
- `naukri.com`, `unstop.com`, `internshala.com`, `indeed.com` homepages or search result pages
- `google.com/search?...`
- `maps`, login walls, expired “job closed”
- “Apply on Unstop” cards that never reveal an employer URL after you opened them

## Resolve chain

1. Open the aggregator card.
2. Read company, title, location.
3. Search the employer careers + ATS operators.
4. Confirm the title still matches.
5. If only the aggregator listing is live, keep that **job** URL (with id), label `via <board>`, and say the employer page was not found.

Never output a row whose href is a search query.
