---
name: ats-resume
description: Resume-builder agent that ATS-checks and HR-checks an uploaded PDF, then rebuilds a weak resume by interviewing for skills, projects, target job, and company, or builds from scratch when the user only pastes those details. Always deliver a parse-safe PDF aimed at a high checker plus recruiter-scan score without fabricating experience. Use when a user uploads a resume PDF, wants a resume from scratch, asks for 98/100 ATS, or says make it unrejectable.
metadata:
  type: workflow
  version: "4.0"
---

# ATS + HR Resume Builder Agent

This skill *is* the agent loop. Two entry paths. One output: a parse-safe resume PDF plus a score card.

Never invent jobs, titles, dates, employers, degrees, tools, or metrics.

Read as needed:

1. `references/agent-interview.md` — question order after a weak check or for scratch build
2. `references/modes-and-essentials.md`
3. `references/rejection-playbook.md`
4. `references/ats-rules.md`
5. `references/hr-scan.md`
6. `references/rewrite-patterns.md`
7. `references/scoring-rubric.md`
8. `references/role-playbooks.md`
9. `assets/plain-resume-template.md`

For PDF extract/create, load the `pdf` skill. Also offer DOCX via the `docx` skill if asked.

## Path A — user uploads a resume PDF

1. Extract text with the `pdf` skill (`pdfplumber` / `pdftotext`). If it is a scan, OCR, then say parse was weak.
2. Build the fact ledger from recovered text.
3. Run ATS check + HR check (`references/scoring-rubric.md` + `references/rejection-playbook.md` + `references/hr-scan.md`).
4. Show the score card and reject reasons **before** rewriting.
5. Branch on strength:

| Band | Checker + scan (use the lower of the two if both exist) | Action |
|---|---|---|
| Weak | under 50, or parse under 16/30 | Full rebuild. Interview with `references/agent-interview.md`. Do not polish the old wording. |
| Salvageable | 50–79 | CONVERT. Interview only the gaps (missing target job, metrics, projects). |
| Strong | 80+ and ship-gate close | Tight CONVERT. Ask at most one question (usually target JD). |

6. After answers are enough, write the new resume, re-score, pass the ship gate, export PDF.

## Path B — no PDF, user gives details

Trigger when they paste skills, projects, experience, education, target role, or company — anything except a finished resume file.

1. Confirm Path B BUILD.
2. Inventory what they already sent.
3. Interview remaining gaps with `references/agent-interview.md` (skip questions already answered).
4. Analyze essentials. Pick role playbook if no JD.
5. Build from scratch on the skeleton.
6. Score, ship gate, export PDF.

Treat a target company + job title like a mini-JD: pull typical hard skills for that role at that kind of company, then keep only terms the ledger proves.

## Strength rule (weak resume)

A resume is weak if any of these are true:

- Two columns, tables, icons, or scanned/image PDF
- No target-role signal in the first 5 lines
- Duty soup ("responsible for", "worked on") and no outcomes
- Skills listed with no projects or jobs behind them
- Checker under 50 or recruiter-scan under 50

Weak → rebuild by interview. Do not return a lightly edited version of a 14/100 file.

## Interview rules

- One question at a time
- Stop when the ledger can fill Summary, Skills, and either Experience or Projects
- Never wait for a perfect life story
- If they refuse metrics, use named scope only
- Preferred job + company are asked early — they steer keywords

## Write rules (both paths)

Same as v3: essentials first, parse-safe layout, JD nouns only when true, max 3 uses of a hard skill, projects first-class.

Order:

- Experienced: Contact → Summary → Skills → Experience → Projects → Education → Certs
- New grad / switch / project-led: Contact → Summary → Skills → Projects → Experience → Education

## Scores and "98/100"

Always label scores as **estimated checker** and **recruiter-scan**.

Aim for:

- Parse 28–30/30
- Recruiter-scan 85+
- Checker 90+ only when a JD (or company+role) exists and the ledger covers most hard terms

If they ask for 98/100:

- Get there when facts support it
- If facts do not, state the factual ceiling and what real detail would raise it
- Never mint tools or percentages to hit 98

Do not say ATS or HR cannot reject the person.

## Ship gate

Use `references/scoring-rubric.md`. Add:

- Output file is a text-selectable single-column PDF
- Path and band (Weak rebuild / Salvageable convert / Scratch build) are stated

## Deliver (always)

1. Path + band
2. Before scores and reject reasons (Path A) or intake summary (Path B)
3. Essentials + drop list
4. Resume markdown
5. After scores
6. Not claimed
7. Remaining risks
8. **PDF file** via the `pdf` skill (DOCX extra if asked)

Optional 5-line interview defense.

## Product note

This skill is the in-chat agent. If they want a hosted upload app, plan software separately and keep this file as the domain brain.
