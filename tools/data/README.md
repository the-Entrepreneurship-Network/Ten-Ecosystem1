# Researched data behind the project matrix

Four files, and the two generators in the directory above turn them into
`services/v2/projectMatrix.js` and `services/v2/roleBriefs.js`. Both generated
modules are checked in, so nothing here is needed at runtime — it is here so
the tables can be regenerated rather than patched by hand.

| file | what it holds |
|---|---|
| `matrix-raw.json` | 374 employers × `{ noun, subject, bar }` — the data each business's systems hold, and what makes it hard there. 120 positions × `{ lens, terms, skills }` — what each job is judged on, its own ordered bench, and its keywords. |
| `matrix-fixes.json` | 14 employers that landed on the same substrate as another and were re-researched to tell them apart (Elastic against Google, Mastercard against Visa, HDFC Bank against Bank of America, and so on). Applied over `matrix-raw.json`. |
| `rolebriefs-raw.json` | 120 positions × 4 named projects, each as `{ term, artefact, did, rest, defend }` — stored in three pieces so an employer's substrate splices into the middle of the sentence. |
| `rolesteps-raw.json` | The same 480 projects with `{ hours, steps }` — six build steps each, ending in a line that names what to measure. |

To regenerate:

```bash
node tools/buildProjectMatrix.js tools/data/matrix-raw.json tools/data/matrix-fixes.json
node tools/buildRoleBriefs.js tools/data/rolebriefs-raw.json tools/data/rolesteps-raw.json
```

Both generators refuse to write if an employer or a position is missing, and
both enforce the properties the engine relies on: every substrate noun and
subject unique across the 374, every lens unique across the 120, every project
title unique across the 480. A duplicate anywhere in here is two students
handing in the same project.

## What this data is, and is not

It is what each business publicly sells, and therefore what its systems hold —
a payments company settles payments, a search company indexes documents, a
retail bank keeps ledgers. A portfolio project shaped like that work is the one
that survives being asked about in an interview room.

It is **not** derived from hiring outcomes. Nobody publishes which candidate's
projects got them hired, and nothing here claims to know. None of it is ever
written onto a resume as a claim about the employer; it decides what the
student is told to go and build.
