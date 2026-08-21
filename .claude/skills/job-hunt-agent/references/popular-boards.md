# Popular job-site features

Clone the *useful* board features. Do not log in or Easy-Apply for the user.

## What each board is for

| Board | Use | Destination rule |
|---|---|---|
| Company careers / Greenhouse / Lever / Ashby / Workday | First choice | listing URL is already direct |
| LinkedIn | discovery | prefer `/jobs/view/<id>` then resolve to ATS |
| Indeed / Glassdoor | discovery | resolve to employer |
| Naukri / Cutshort / Instahyre | India full-time | resolve to employer |
| Internshala / Unstop | India intern | resolve to employer if Google/company job |
| Wellfound | startups | company job slug |
| Handshake | campus US | listing URL |
| Upwork / Fiverr / Freelancer | gigs | `/jobs/` or project id only |

## Board features to emulate

- Filters: title, city, remote, intern vs job, experience
- Similar jobs: after a hunt, `hunt-more` excluding seen URLs
- Saved jobs: `job-tracker.md`
- Alerts: next hunt reuses the same query pack
- Easy Apply analogue: draft email + tailored resume — user submits
- Salary: only if the listing states it. Never invent.
- Company snippet: 1 line from the opening page, not a review scrape
- Recruiter: email only if the listing shows an address

## Extra commands

| User says | Run |
|---|---|
| internships India | hunt + Internshala/Unstop then resolve |
| remote overseas | hunt + greenhouse/lever/remote |
| freelance | hunt + Upwork/Fiverr job URLs |
| similar to row N | hunt-more from that title |
| save this | tracker |
| salary / reviews | only quoted from the opening page |
