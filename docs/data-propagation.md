# Data propagation between portals

## The rule

**A student record is read by four portals. Writing a field is not the same as
changing it.**

Several fields on `Student` are not just data — other parts of the product
derive state from them, and some of that derived state is *stored*, not
computed on read. Changing the source field without updating what follows from
it leaves two portals disagreeing about the same student.

Every write path that touches one of these fields must go through
`services/studentPropagation.js`. Do not `$set` them directly.

---

## The coupled fields

| Field | What derives from it | Stored or computed? |
|---|---|---|
| `tenure` | `v2DurationType` | **stored** — the Task Journey reads this, not `tenure` |
| | `internshipEndDate` | **stored** |
| | which weeks of `DomainTask` are assigned | **stored** as `StudentTaskProgress` rows |
| | attendance day target, `daysRemaining` | computed on read |
| | the duration printed on the offer letter | **frozen in a generated PDF** |
| `domain` | which `DomainTask` set is assigned | **stored** as `StudentTaskProgress` rows |
| | chat room (`domain_<Domain>`) | computed at socket connect |
| | which coordinator sees the student | computed on read |
| | domain leaderboard membership | computed on read |
| | the domain printed on the offer letter | **frozen in a generated PDF** |
| `joiningDate` / `internshipStartDate` | `internshipEndDate` | **stored** |
| | every attendance calculation | computed on read |

The **stored** rows are where bugs live. Computed-on-read state fixes itself the
next time someone loads the page; stored state does not.

---

## The bug this exists to prevent

HR extended a student from 1 Month to 3 Months. The student record updated. The
Task Journey kept showing four weeks.

Three separate reasons, all of them the same mistake:

1. `PUT /students/:id` wrote `tenure` and nothing else. The Task Journey reads
   `v2DurationType`, which stayed on `1month`.
2. `assignTasksForStudent` is upsert-only (`$setOnInsert`). Correct at
   enrolment, useless afterwards — it never adds the newly-in-scope weeks.
3. Nothing called it anyway. It was only ever invoked from the student-side
   onboarding and `my-tasks` routes, and `my-tasks` only assigns when the
   student has *no* rows at all.

Shortening a tenure was worse: the extra weeks stayed visible forever. Changing
a domain left the student on their old domain's tasks permanently.

---

## How to write a student change

```js
const { updateStudentAndPropagate } = require('./services/studentPropagation');

const { student, report, error, notFound } = await updateStudentAndPropagate({
  studentId: req.params.id,
  patch:     { tenure: '3 Months' },   // raw values are fine; they get normalised
  actor:     'HR — Priya'
});

if (error)    return res.status(400).json({ message: error });   // unknown tenure/domain
if (notFound) return res.status(404).json({ message: 'Student not found' });

res.json({ message: 'Student Updated', student, propagated: report });
```

If you have already written the document yourself, call the second half only:

```js
const { propagateStudentChange } = require('./services/studentPropagation');

const before  = { tenure: existing.tenure, domain: existing.domain };
const student = await Student.findByIdAndUpdate(id, { $set: update }, { new: true });
const report  = await propagateStudentChange({ student, before, actor: 'admin' });
```

### What you get back

```js
{
  changed: ['tenure'],                                  // which coupled fields moved
  tasks:   { added: 8, removed: 0, preserved: 2, inScope: 12 },
  offerLetterStale: true,                               // issued PDF now disagrees
  notified: true,                                       // student was told
  warnings: []                                          // non-fatal problems
}
```

Surface `report` to whoever made the change. The HR portal renders it into the
success toast, so a tenure change that rebuilt someone's Task Journey is
visible rather than silent.

---

## Rules the resync follows

`taskEngine.resyncTasksForStudent` adds what is newly in scope and removes what
is not — but **never destroys work**:

- Removable: still `locked` or `available`, no `submissionUrl`, no
  `coinsAwarded`, no quiz attempt.
- Kept and counted in `preserved`: anything else. Shortening a tenure never
  deletes an approved submission or the coins earned for it.
- If the domain has no task catalogue seeded yet, nothing is removed. Missing
  seed data must not empty a student's journey.

---

## Adding a new coupled field

1. Add it to `COUPLED_FIELDS` in `services/studentPropagation.js`.
2. Derive whatever follows from it inside `normalizeCorePatch`.
3. Do the stored-state work inside `propagateStudentChange`.
4. Add a row to the table above.
5. Extend `tests/services/studentPropagation.test.js`.

Because every caller already routes through this module, that is the whole
change — no hunting for write paths.

---

## Cross-portal events

Data propagation is half the picture; the other half is telling the other side
something happened. Current coverage:

| Event | Student told | Coordinator told | HR told |
|---|---|---|---|
| HR/admin edits tenure or domain | ✅ | — | — |
| Student submits a task | — | ✅ | — |
| Coordinator approves a task | ✅ | — | — |
| Coordinator rejects a task | ✅ | — | — |
| Coordinator approves certificate | ✅ | — | ✅ |
| Coordinator revokes approval | ✅ | — | ✅ (when it breaks an HR approval) |
| HR approves certificate | ✅ | — | — |
| HR returns review to coordinator | ✅ | ✅ | — |
| Coordinator marks attendance | ✅ | — | — |

Notifications go through `Notification` + `broadcastNotification(domain,
employeeId, notif)` from `utils/sseHub`. Passing `null` for `employeeId` sends
to the domain's coordinator channel only; passing both reaches the student and
the coordinator.

**Every notification call must be wrapped in its own try/catch.** A failed
notification must never fail the action it is reporting on.

---

## Known gaps

- A student with an open chat socket stays in their old `domain_<X>` room until
  they reconnect. Rooms are resolved at connect time, so it corrects itself on
  the next page load.
- An offer letter already generated as a PDF cannot be rewritten. Propagation
  reports `offerLetterStale` so a human can reissue it; it does not reissue
  automatically.
- Free-text domain/tenure entry has been replaced with pickers in the HR
  portal, but records created before that may still hold non-canonical values.
  `scripts/audit-domain-tenure.js` reports them and fixes them with `--apply`.
