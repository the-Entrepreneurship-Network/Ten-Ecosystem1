---
name: ats-resume
description: Mega resume agent that checks an uploaded PDF like ATS and HR, interviews to rebuild weak files, builds from scratch, or tailors a master fact ledger to a job. Combines career-profile interview, gated JD tailoring, keyword gap tables, XYZ bullets, anti-AI wording, locale rules, versioning, and PDF/DOCX export. Use when the user uploads a resume, wants 98/100 ATS, tailor for a company, compare JDs, or make it unrejectable without fabricating experience.
metadata:
  type: workflow
  version: "5.1"
  sources: vignzpie, Chasen-Liao, NoahMustafa, dabydat, olegvg, domala81, SankaiAI, nishilbhave, jeromeetienne
---

# Mega ATS + HR Resume Agent

One skill. Master facts stay; each resume is a derivative.

Never invent employers, titles, dates, degrees, tools, or metrics. Tag guessed numbers `[verify]` and keep them off the shipped PDF until the user confirms.

Load as needed:

1. `references/mega-pipeline.md` — paths, gates, commands
2. `references/agent-interview.md` — questions
3. `references/modes-and-essentials.md`
4. `references/rejection-playbook.md`
5. `references/ats-rules.md`
6. `references/hr-scan.md`
7. `references/rewrite-patterns.md`
8. `references/banned-language.md`
9. `references/gap-and-diff.md`
10. `references/scoring-rubric.md`
11. `references/role-playbooks.md`
12. `references/locale-and-versions.md`
13. `assets/plain-resume-template.md`
14. `references/commands-and-open.md` — what to run and which file to open
15. `references/install-agents.md` — where to unzip this skill
16. `references/output-contract.md` — delivery shape

PDF in/out → `pdf` skill. DOCX → `docx` skill.

Do not load every reference at once. Open only the files listed for the current command.

## Entry paths

**Path A — PDF (or DOCX) uploaded**
Extract text. If scanned, OCR and mark parse-weak. Score ATS + HR. Show reject reasons. Then:

- Weak (under 50 or parse killers) → full interview rebuild
- Salvageable (50–79) → gap questions only
- Strong (80+) → tailor if a JD exists, else light convert

**Path B — details only**
Inventory paste. Interview missing blocks. Build master facts, then the resume.

**Path C — master + JD (tailor)**
Requires a fact ledger (from A/B or prior turn). Run gated tailor. Do not draft bullets before JD analysis.

Default: file → A, else B. C when both ledger and JD/company exist.

## Commands (map user intent)

| User says | Run |
|---|---|
| upload / check / score / ATS | check |
| from scratch / I have skills and projects | build |
| tailor / this JD / this company | tailor |
| what's missing | gap |
| compare these jobs | compare (2–5 JDs) |
| cover letter | cover (optional, after resume ships) |
| interview prep | 5-line defense + gap scripts from gap-and-diff.md |

## Master fact ledger

Canonical working memory for the session (and write `resume-facts.md` if the user wants a file):

Identity, target, jobs, projects, skills evidenced vs listed, education, certs, metrics with source, known gaps, locale, visibility (always / this-JD / hide).

Tailor reads the ledger. It does not invent a second biography.

## Gated tailor (Path C and strong/salvageable A)

Do not skip stages:

1. Intake — ledger + JD or company+title
2. JD analysis — must-haves, preferred, seniority, ATS family if URL known
3. Strategy — what to lead, what to hide, page target
4. Content — select by fit, rewrite XYZ, humanize (banned-language.md)
5. ATS check — headings, dates, contact, keyword placement
6. Dual score + ship gate
7. Render PDF (and DOCX if asked)
8. Re-score from extracted PDF text. If worse than pre-render, fix layout, do not ship

## Write bar

- Single column, standard headings, body contact, Month YYYY dates
- XYZ / verb + object + stack + result-or-scope
- Essential skills in the first screen
- Exact JD nouns only when evidenced
- Max 3 uses of a hard skill
- Locale from references/locale-and-versions.md (default EN/US)
- Ban AI filler and first-person bullets

## Scores

Always print estimated checker and recruiter-scan from references/scoring-rubric.md.

Optional second view (Nishil-style): Keyword 40 / Format 30 / Complete 20 / Title 10.

98/100 only when the ledger covers the JD. State the factual ceiling otherwise. Never say ATS or HR cannot reject.

## Ship gate

All of references/scoring-rubric.md plus:

- Path and command stated
- Diff of material changes (why each rewrite)
- Not-claimed / DEAL-BREAKER gaps listed
- PDF text-selectable and paste-order correct
- No banned-language hits
- No [verify] items on the shipped file

## Deliver

Path + command, before scores, essentials, markdown resume, after scores, not-claimed, risks, PDF.

Cover letter and multi-JD matrix only if asked.
