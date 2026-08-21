# Mega pipeline

Synthesized from resumejson_claude, ats-resume-tailor, SankaiAI, resume-autopilot, resume-tailor-plugin, dabydat, claude-ats-cv-skill, Chasen-Liao, vignzpie.

## check

1. Extract PDF/DOCX/text
2. Fact ledger (stated vs inferred)
3. Rejection diagnosis (ATS + HR)
4. Dual score + optional Nishil view
5. Top 5 fixes ranked by parse-kill first
6. Band: Weak / Salvageable / Strong
7. If weak, announce rebuild and start interview Block 1

json-resume idea: after extract, you may keep a compact JSON of fields (name, jobs[], skills[]) in working notes so later steps validate against it. Do not require a Zod CLI.

## build

1. Interview (`agent-interview.md`) one question at a time
2. Essentials ranking
3. Write on skeleton
4. Humanize
5. Score + ship gate
6. PDF

Junior profiles are allowed. List fact gaps. Do not refuse.

## tailor

Requires ledger + JD (or company + title used as a mini-JD).

Stage locks:

- No strategy before JD terms exist
- No bullets before strategy
- No ATS check before bullets
- No render before ATS check passes
- No delivery before PDF extract score is not worse than draft score

Gap table required (`gap-and-diff.md`). Max 5 discovery questions for yellow/red gaps. Answers write back into the ledger.

## gap

Output only:

- DEAL-BREAKER / SIGNIFICANT / MINOR
- evidenced / synonym / missing
- What question would close it

No rewrite unless the user then says tailor.

## compare

2–5 JDs. Matrix: shared must-haves, unique must-haves, fit rank, investment (which skill to learn or which project to surface). One recommended target.

## cover

After a shipped resume. Three optional lengths: ~150 words, ~300 words, bullet talking points. Same no-fabrication rule. Company tone from the JD, not adjectives.

## Autopilot extras (use when relevant)

- If interview rate is the complaint: run check on the *current* file, not a new design
- Role-family keyword intel: `role-playbooks.md` (no live market scrape unless the user asks to search)
- Bullet-only edit: rewrite one bullet, ask for a metric rather than inventing one
