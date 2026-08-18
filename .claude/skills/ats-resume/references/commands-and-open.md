# Commands, files to open, and run order

The user-facing commands are words, not a CLI. Map their sentence to one command. Open only the files listed for that command.

## What to open first (every session)

1. This skill's `SKILL.md` (already loaded if triggered)
2. `references/mega-pipeline.md` for the path
3. The user's resume file or paste
4. The job description if present

Do not open every reference. Open the next file only when that step starts.

## Command: check

User: upload PDF, "score this", "ATS check", "is this rejectable"

Open:

- User resume (PDF/DOCX/text)
- `references/ats-rules.md`
- `references/hr-scan.md`
- `references/rejection-playbook.md`
- `references/scoring-rubric.md`

Run order:

1. Extract text. If PDF, use the `pdf` skill (`pdfplumber` or `pdftotext -layout`). If no text, OCR, then mark parse-weak.
2. Build ledger.
3. ATS-reject list + HR-reject list.
4. Dual score. Optional Nishil line.
5. Band: Weak / Salvageable / Strong.
6. Top 5 fixes.
7. If Weak, say you will rebuild and open `references/agent-interview.md`. Ask Block 1 question 1 only.

Do not rewrite yet unless they said "just fix it" and the band is Strong.

## Command: build

User: "from scratch", "I have these skills and projects", no file

Open:

- Their paste
- `references/agent-interview.md`
- `references/modes-and-essentials.md`
- `references/role-playbooks.md`
- `assets/plain-resume-template.md`

Run order:

1. Inventory what they already sent. Skip those questions.
2. Ask one missing question at a time (title → company/JD → identity → skills → jobs → projects → education).
3. Stop when Summary + Skills + (Experience or Projects) can be filled.
4. Rank essentials. Write. Humanize (`banned-language.md`).
5. Score. Ship gate. Render PDF.

## Command: tailor

User: "tailor to this JD", "resume for Company X"

Must have: ledger (from this session or a prior resume) AND a JD or company+title.

Open:

- Ledger / resume
- JD
- `references/gap-and-diff.md`
- `references/rewrite-patterns.md`
- `references/banned-language.md`
- `references/scoring-rubric.md`

Run order (locked):

1. Intake
2. JD terms (must / preferred / seniority)
3. Strategy (lead, hide, page target)
4. Gap table
5. At most 5 discovery questions
6. Select bullets by fit
7. XYZ rewrite + humanize
8. ATS check
9. Dual score
10. Render PDF
11. Extract PDF text and re-score. If worse, fix layout.

If no ledger, run check or build first.

## Command: gap

User: "what's missing", "why would this fail"

Open: resume + JD + `gap-and-diff.md` + `scoring-rubric.md`

Output the gap table only. No full rewrite.

## Command: compare

User: 2–5 JDs

Open: ledger + all JDs + `role-playbooks.md` + `gap-and-diff.md`

Output a matrix and one recommended target. Offer to tailor the winner.

## Command: cover

Only after a resume has shipped in this session (or they attach the final resume).

Open: shipped resume + JD + `banned-language.md`

Write one of: ~150 words, ~300 words, or talking points. Same no-fabrication rule.

## Command: interview-prep

Open: shipped resume + JD + `gap-and-diff.md`

Five-line defense + DEAL-BREAKER scripts. Not a mock hour unless they ask to continue.

## File writes (when producing artifacts)

Prefer the session artifacts directory:

- `resume-facts.md` — master ledger if they want a file
- `resume.md` — markdown resume
- `resume-<company>-<role>.pdf` — shipped PDF
- `resume-<company>-<role>.docx` — if asked

Use `pdf` skill to write the PDF (reportlab/platypus, single column). Use `docx` skill for Word.

## Shell you may run

Only if a file exists on disk:

```bash
pdftotext -layout USER_RESUME.pdf /tmp/resume-extract.txt
pdftotext -layout OUTPUT.pdf /tmp/resume-out.txt
```

Compare extract order to the markdown. If names/dates scramble, the PDF is not shippable.

Do not crawl the user's machine. Do not install random npm resume CLIs unless they asked to use a specific repo.

## What not to open

- Other skills' animation/design files
- The nine upstream GitHub repos during a normal resume job
- Every reference at once
