---
name: ats-resume
description: Build, recreate, or convert any resume from essential skills, projects, and experience so it is hard for an ATS checker or HR recruiter to bounce. Use when writing from scratch, rebuilding a broken or designed resume, converting a rejectable file, extracting must-keep signals, targeting Workday/Greenhouse/Lever, or raising a low Jobscan-style score without fabricating experience.
metadata:
  type: workflow
  version: "3.0"
---

# ATS + HR Resume Engine

One agent, three modes. Input can be a polished resume, a rejectable file, a LinkedIn dump, or raw notes. Output is a parse-safe resume built around the essential skills, projects, and experience that actually get interviews.

You cannot force a hire. You can remove the reject reasons writing controls: parse failure, missing keywords, missing essentials, vague duties, wrong-role signal, clutter, and fake claims.

Never invent jobs, titles, dates, employers, degrees, tools, or metrics.

Read when the task is non-trivial:

1. `references/modes-and-essentials.md` — BUILD / RECREATE / CONVERT + essential-signal rules
2. `references/rejection-playbook.md`
3. `references/ats-rules.md`
4. `references/hr-scan.md`
5. `references/rewrite-patterns.md`
6. `references/scoring-rubric.md`
7. `references/role-playbooks.md`
8. `assets/plain-resume-template.md`

File export: `docx` skill default, `pdf` only if asked. Never multi-column.

## Modes (pick one, then run the shared pipeline)

| Mode | When | What you do |
|---|---|---|
| **BUILD** | No resume, or only profile/notes | Assemble from essential skills, projects, experience |
| **RECREATE** | Designed, scanned, or scrambled file | Recover text, rebuild on the safe skeleton, keep every true fact |
| **CONVERT** | Existing resume that would bounce | Diagnose rejects, keep essentials, rewrite until the ship gate passes |

If unclear, default: RECREATE if a file exists, else BUILD. CONVERT is RECREATE plus a before/after rejection plan.

## Mission

The finished resume must:

- Parse as a Workday-safe single-column document
- Surface **essential** skills, projects, and experience in the first screen
- Hit truthful JD overlap in the 60–85% band when a JD exists
- Pass a 6-second recruiter scan (role, stack, one proof spike)
- Contain zero unverified claims

## Hard rules

1. No fabrication. Scope is allowed only when the ledger already names it.
2. JD nouns only when true.
3. Parse-safe layout only.
4. No stuffing (max 3 uses of a hard skill).
5. Never say HR or an ATS cannot reject the person. Say hard to reject on parse, essentials, and signal.
6. Do not mark done if the ship gate fails.

## Intake from any source

Accept any mix:

- PDF / DOCX / markdown / paste
- LinkedIn About + Experience + Featured
- Project READMEs, GitHub repos, portfolio blurbs
- Job description or target title
- Voice-note style bullets

Need at least identity-or-name-placeholder plus one of: experience, projects, skills.

Prefer a JD. Without one, use a role playbook and mark keywords unanchored.

One question at a time, only if it changes the page:

1. Target JD or title
2. Strongest real metric for the top 3 bullets
3. Country + file type

Start immediately.

## Essential signal pass (mandatory)

Before writing, extract the essentials. Details in `references/modes-and-essentials.md`.

```
Essential skills:     tools/methods the target role searches and the ledger proves
Essential experience: roles that prove the function (latest + most relevant)
Essential projects:   builds that prove a missing job signal or a rare stack
Proof spikes:         3–5 facts that stop a bounce
Drop list:            old, off-target, or unevidenced items
```

The resume is built from essentials, not from dumping the whole life.

## Shared pipeline

### 1. Fact ledger

Tag `stated` or `inferred` (abbreviation expansion only).

Identity, target, experience rows, projects, evidenced vs listed skills, education, certs, gaps, mode.

### 2. Rejection diagnosis

ATS-reject vs HR-reject with a fix for each (`references/rejection-playbook.md`). For BUILD, diagnose the *empty-page* risks (no function signal, project-only names, skill cloud).

### 3. Dual score (before)

Checker /100, recruiter-scan /100, factual ceiling. BUILD starts from 0 plus whatever notes already satisfy fields.

### 4. Map essentials → page

Every JD or playbook term: evidenced verbatim, synonym rewrite, or Not claimed.

Place essentials:

- Skills line = essential skills only (plus a short secondary line if needed)
- Latest job = essential experience, 3–6 impact bullets
- Projects = essential projects, problem + stack + outcome
- Top third = role + essentials + one spike

### 5. Write

`references/rewrite-patterns.md` + role playbook + `assets/plain-resume-template.md`.

Experienced: Contact → Summary → Skills → Experience → Projects → Education → Certs

Project-led / new grad / switch: Contact → Summary → Skills → Projects → Experience → Education

Same constraints as before: safe headings, Month YYYY dates, one-line job headers, 1–2 pages.

### 6. Ship gate

Re-score. Do not call it done unless `references/scoring-rubric.md` ship gate passes, including the new essentials checks.

### 7. Deliver

1. Mode used
2. Essential skills / projects / experience (and drop list)
3. Rejection diagnosis
4. Resume markdown
5. Before → after scores
6. Not claimed
7. Remaining human risks

DOCX when they want a file. Optional 5-line interview defense.

## Product builds

If they want an app, this skill is the domain brain. Multi-file coding uses `claude-codex-team`.
