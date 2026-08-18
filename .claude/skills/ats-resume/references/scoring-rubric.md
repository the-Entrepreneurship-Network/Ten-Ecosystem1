# Dual rubric and ship gate

Two scores. Always label them as estimates.

- **Checker score** — parse + keywords + fields (what Jobscan-like tools approximate)
- **Recruiter-scan score** — whether a human keeps reading

Neither is a live Workday/Greenhouse decision. Greenhouse does not auto-score resumes.

## Checker score /100

### A. Parse safety — 30

Start at 30. Subtract:

| Defect | Subtract |
|---|---|
| Multi-column or sidebar | −12 |
| Layout tables | −10 |
| Text boxes / floating elements | −8 |
| Contact only in header/footer | −6 |
| Icons, photo, logos, bars, charts | −6 |
| Unrecognized headings | −6 |
| Missing or inconsistent dates | −4 |
| Symbol-font bullets | −3 |
| Scanned/image PDF | −15 |

Floor 0.

### B. Keyword alignment — 40

Requires a JD. Else mark N/A and report checker as parse+structure+evidence only.

Extract 20–40 hard terms. Ignore fluff.

| Overlap of evidenced hard terms | Points |
|---|---|
| 80%+ | 36–40 |
| 60–79% | 28–35 |
| 40–59% | 18–27 |
| 20–39% | 8–17 |
| <20% | 0–7 |

Adjust: −2 per required term missing from Skills and Experience (max −10). −4 if top 5 JD terms are not in the top third. −6 for stuffing (same term 5+). −3 per claimed skill with zero supporting bullet (max −9).

Competitive band is 60–85% overlap, not 100%.

### C. Structure — 15

Name+email+phone in body 3, location 1, URL as text 1, every role has title/employer/dates 4, education 2, plain-text skills 2, reverse-chronological 2.

### D. Evidence — 15

Strong verbs 3, half of recent bullets have number or scope 5, outcomes not duties 4, title/summary match role family 3.

## Recruiter-scan score /100

| Gate | Points | Pass condition |
|---|---|---|
| 6-second function match | 25 | Target role is obvious from summary + latest title + skills |
| Proof in top third | 20 | At least one concrete spike before older history |
| Bullet quality (latest 2 roles) | 25 | Each bullet is verb + object + (stack or result) |
| Project usefulness | 10 | Projects have stack and outcome, or section correctly omitted |
| Noise / length | 10 | 1–2 pages, no objective, no soft-skill cloud |
| Trust | 10 | No unverifiable metrics, no skill without evidence |

## Honest ceiling

If the JD requires tools/years the ledger lacks, state the ceiling:

`Factual ceiling ~68. Missing from history: Terraform, 5 years Java. Format cannot close that gap.`

Do not manufacture a 98.

## How 14 becomes high-90s on a checker

Typical rejectable file: columns + icons + cute headings + duty bullets + no JD nouns.

Typical converted file (only if skills are real):

- Parse 28–30
- Keywords 34–38
- Structure 14–15
- Evidence 12–15

HR-scan should land 80+ after conversion. If it does not, the top third is still wrong.

## Ship gate — do not call the draft finished unless all are true

1. Checker parse ≥ 26/30
2. Recruiter-scan ≥ 80, or 70+ with an explicit reason (e.g. no JD)
3. Zero unverified claims
4. Every Skills item appears in Experience or Projects
5. Plain-text paste order is correct
6. Keyword overlap is in band **or** every missing term is in Not claimed
7. Summary line 1 names the target function
8. Essential skills are in the first screen
9. Essential experience or essential projects (whichever is the hire signal) sit above filler
10. Mode is stated (BUILD / RECREATE / CONVERT)

If the user asked for "unrejectable" and the gate fails, keep rewriting. If the fail is missing real experience, say so and stop padding.

## Score card format

```
Estimated checker score: 86/100  (before 18)
Recruiter-scan score:    88/100  (before 31)
Caveat: Proxy only. Not a live ATS decision.

Parse 30/30 | Keywords 32/40 (24/30 terms) | Structure 15/15 | Evidence 9/15
6-second match 25 | Proof 16 | Bullets 22 | Projects 10 | Noise 10 | Trust 10

Not claimed: Terraform, SOC 2
Ship gate: PASS
```
