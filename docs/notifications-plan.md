# Notifications — current state, decision, and plan

Section 11 of the task document. It asks for a written plan covering which
notification types are needed and whether the existing systems get unified.

---

## 1. What exists today

Three systems, not two.

### A. Legacy `Notification` + SSE — what students actually see

- **Model:** `models/Notification.js`. Targeted by string
  (`targetEmployeeId` / `targetDomain` / `targetUsername`), read tracking via a
  `readBy: [String]` array.
- **Transport:** Server-Sent Events, `utils/sseHub.js` (extracted from
  `server.js` during this pass).
- **UI:** the bell on `student-dashboard.html` and `coordinator-dashboard.html`.
- **Written by:** task review, badge awards, HR broadcast, admin broadcast.

**Weakness:** `readBy` is an unbounded array on every notification. At 5,000
students a domain-wide announcement grows a 5,000-element array, and "is this
unread" means scanning it. This does not scale and is the main reason to move.

### B. `EcosystemNotification` + REST — structured, but unreachable

- **Model:** `models/EcosystemNotification.js`. Per-user rows, a 12-value `type`
  enum, `isRead` boolean, `link`, a `data` map, and a compound index on
  `{userId, isRead, createdAt}`.
- **API:** `routes/notificationRoutes.js` at `/api/ecosystem-notifications` —
  list, mark-read, mark-all-read, delete, with pagination.
- **UI:** none. Nothing in `public/` called it until the feedback feature.

This is the better model: one row per user, a real index, no array scan.

### C. `Notice` — domain announcements, and the model is bypassed

`models/Notice.js` exists, but `POST /update-notice` reads and writes a
`notice.json` file on disk instead. The model is effectively dead.

---

## 2. Bugs fixed during this pass

Recorded because each was a silent failure — nothing errored, notifications just
did not arrive.

| Bug | Effect |
|---|---|
| `/notifications/mark-all-read` did not exist | 404 inside an empty catch; badge cleared visually, count returned on reload |
| `notifBadge2` never updated | The topbar bell showed 0 permanently |
| SSE fan-out filtered on `c.studentDomain`, never set | Domain-targeted notifications never pushed live |
| Admin broadcast wrote rows, never pushed | Announcements invisible until the next poll |
| All three SSE endpoints unauthenticated | Anyone could subscribe to any student's stream |
| `DELETE /hr/notifications/:id` had no auth | Anyone could delete any notification |
| No SSE heartbeat | Proxies dropped idle streams; the bell went quiet with no error |

---

## 3. Decision

**Standardise on `EcosystemNotification`. Keep the legacy system running in
parallel until every producer has moved, then delete it.**

Reasoning:

1. **`readBy` does not scale.** One row per user with an index is the right
   shape at 5,000+ students; an array scan is not.
2. **It is already structured** — typed, linkable, paginated, with the API
   written and tested.
3. **It already spans roles.** Founder / mentor / investor / contractor portals
   (section 14) need notifications, and `EcosystemNotification` keys on
   `EcosystemUser`, which all of them have. The legacy model keys on employee ID
   strings that only students have.

**Not a big-bang migration.** The legacy system is what students see today.
Turning it off before every producer has moved would silently drop
notifications — the exact failure this section is about.

### Keeping SSE

Transport and storage are separate decisions. SSE stays: it is simple, works
through the existing session, and needs no new infrastructure. What changes is
what it carries.

---

## 4. Notification types needed

Existing enum (`models/EcosystemNotification.js`): `profile_approved`,
`profile_rejected`, `application_received`, `application_status`,
`payment_confirmed`, `payment_failed`, `mentor_request`, `mentor_approved`,
`founder_approved`, `investor_approved`, `new_message`, `system_announcement`.

Missing, and needed by work in this sprint:

| Type | Fires when | Goes to |
|---|---|---|
| `task_approved` | A coordinator approves a submission | Student |
| `task_rejected` | A coordinator rejects one | Student |
| `week_unlocked` | The next week's tasks open | Student |
| `attendance_reminder` | Not marked by early evening | Student |
| `attendance_auto_marked` | The cron marked them present | Student |
| `attendance_at_risk` | Attendance drops below 75% | Student + coordinator |
| `certificate_ready` | A certificate is issued | Student |
| `document_rejected` | Uploaded documents rejected | Student |
| `feedback_received` | A student submits feedback (section 9 — wired) | All HR |
| `quiz_result` | A quiz is graded | Student |
| `coding_result` | A coding challenge is evaluated | Student |
| `tenure_extended` | An admin changes a tenure | Student + coordinator |
| `payment_reminder` | A programme fee is outstanding | Student |

---

## 5. Migration plan

**Phase 1 — stop the bleeding.** *(done in this pass)*
The seven bugs above. The legacy system now works as intended.

**Phase 2 — one write path.**
A `notify(recipient, type, payload)` helper writing an `EcosystemNotification`
**and**, during the transition, a legacy `Notification`, then pushing over SSE.
One call site per event; producers stop choosing a system.

**Phase 3 — one bell.**
A shared `public/js/notification-bell.js` reading
`/api/ecosystem-notifications`, included on student, coordinator, HR and
ecosystem dashboards. Today the student and coordinator bells are separate
copies and HR has none.

**Phase 4 — migrate history.**
A script converting `Notification` rows into per-user `EcosystemNotification`
rows, expanding `readBy` into `isRead`. Run once; keep the old collection
read-only for a release.

**Phase 5 — remove.**
Delete the legacy model, its routes, and the `notice.json` file handling in
favour of the `Notice` model or `system_announcement`.

**Prerequisite for phases 2–5:** `EcosystemNotification.userId` references
`EcosystemUser`, but students are `Student` documents and the two are not
reliably linked. Either add `Student.ecosystemUserId`, or widen the model to
`{ recipientType, recipientId }`. Decide before Phase 2 — everything else
depends on it.

---

## 6. Deliberately not doing

- **Email for every notification.** Email is already used for documents and
  reminders. Adding it per-notification risks the portal becoming a source of
  spam. Revisit per type, opt-in.
- **WebSockets for notifications.** Socket.IO is already loaded for chat, but
  SSE is one-way, simpler, and reconnects on its own. No reason to switch.
- **Push notifications.** Needs service-worker and permission work well beyond
  this section.
