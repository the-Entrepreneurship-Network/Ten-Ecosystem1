# Rejection playbook — why resumes bounce, and the fix

Use this to convert a rejectable resume. Diagnose first. Do not skip to prettier wording.

## Two reject systems

1. **ATS / checker** — parse failure or keyword under-match. The recruiter may never see it.
2. **HR / recruiter / hiring manager** — they see it and bounce in 6–30 seconds.

A resume is "hard to reject" only if it survives both.

## ATS-reject reasons

| Symptom | Why it dies | Fix |
|---|---|---|
| Two columns, sidebar, Canva | Parser reads left-to-right and merges fields | Single column |
| Tables, text boxes | Content dropped or reordered | Linear paragraphs + bullets |
| Icons / photo / skill bars | Tokens become garbage | Delete; text only |
| Contact in header/footer | Workday often skips it | Body contact line |
| Cute headings ("My journey") | Section not classified | Summary / Experience / Skills / Education / Projects |
| Image or scanned PDF | No text layer | Rebuild as DOCX |
| Dates as "2023-24" or missing | Tenure filters fail | Month YYYY – Month YYYY |
| Title not near employer | Work history extraction breaks | One header line per job |
| Skills only as a graphic | Search finds nothing | Comma-separated skills |
| JD hard skills absent | Match score tanks | Place evidenced terms in Skills + bullets |
| Keyword wall / white text | Stuffing flags | 1–3 natural uses |
| Skill listed, never evidenced | Semantic ATS distrust | Add a real bullet or drop the skill |

## HR-reject reasons

| Symptom | Why a human bounces | Fix |
|---|---|---|
| First 5 lines do not state the target job | "Wrong pile" | Summary line 1 = role + seniority + domain |
| Duties, not results | No proof of impact | Verb + object + stack + outcome or scope |
| Generic summary | Sounds like 400 other applicants | One concrete recent win |
| Projects listed as names only | Looks like classwork | Problem, stack, your role, result |
| Skills dump unrelated to the JD | No fit signal | JD-aligned skills first; drop noise |
| Title far from the posting | Seniority/function mismatch | Align wording without lying about level |
| 3+ pages / dense walls | Recruiter will not read | 1–2 pages, short bullets |
| Typos, inconsistent dates | Carelessness heuristic | Normalize everything |
| Objective ("seeking a challenging role") | Dated, self-centered | Delete; use Summary |
| Every bullet starts with "Worked on" | No ownership | Strong verbs from the allowed list |
| Career switch with no bridge | "Not this function" | Projects + summary that name the new function |
| Metrics that look fake | Distrust | Only user-backed numbers; else use scope |

## Severity order (fix in this sequence)

1. Parse killers (columns, tables, headers, images)
2. Identity and dates complete
3. Target-role signal in the top third
4. JD keyword coverage that is evidenced
5. Duty → impact rewrites
6. Project promotion
7. Length, consistency, scan density

Do not polish verbs while the file still has two columns.

## Special cases

### New grad / intern

Reject risk: no experience section worth reading.

Fix: Skills + 2–4 projects with stack and outcome, then internships, then education with relevant coursework only if it matches the JD.

### Career switch

Reject risk: old title is the first thing they see.

Fix: Summary names the *target* function and the bridge. Lead with projects or recent adjacent work. Do not relabel an old job as a job they did not have.

### Job hopper / gaps

Reject risk: dates dominate the skim.

Fix: Use Month YYYY, group tiny gigs under one contract line if they were the same function, add one clause in summary only if needed (`after a 2024 relocation`). Do not hide gaps with years-only dates.

### Overqualified / senior

Reject risk: unfocused 3-page archive.

Fix: Last 10–15 years only, 4–6 bullets on the latest role, older roles compressed to 1–2 lines.

### Thin profile

Reject risk: nothing to score.

Fix: Mine projects, freelance, research, volunteer, and coursework that actually used the tools. Ask one metrics question. If still thin, ship a clean honest draft and list the fact gaps. Do not pad.

## Output of this stage

Write a short diagnosis the user can see:

```
ATS-reject risks:
- …

HR-reject risks:
- …

Conversion plan:
1. …
2. …
```
