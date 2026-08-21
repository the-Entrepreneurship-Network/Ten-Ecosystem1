# Fact ledger

Path (Claude Code / local): `resume-facts.md` in the project.
Path (portal): the selected sidebar project (Full-Stack CV, Data Science CV, Internship CV).

## Read at session start

If the ledger exists, do not re-ask name, phone, education, or jobs already listed.

## Write after each command

```
# resume-facts
target: <title>
last_command: check|build|tailor
checker: xx
recruiter: xx
skills_evidenced: ...
jobs: ...
projects: ...
not_claimed: ...
jd_last: <company or none>
```

## Cross-session (optional)

If claude-mem or a markdown memory skill is installed, store only:
- last target title
- last scores
- path to resume-facts.md

Do not dump the full resume into generic memory.
