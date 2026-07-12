# Phase 1 Migration Impact Assessment

## Assessment Method
Each change is rated **SAFE**, **NEEDS CARE**, or **HIGH RISK** based on its blast radius against existing code.

---

## PR 1 — Full System Documentation

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| Add `docs/` directory with 9 markdown files | Zero code change | **SAFE** | Pure documentation, no code executed |

---

## PR 2 — Unified Role System Extension

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| `config/roles.js` (new file) | New file, additive | **SAFE** | No existing file touched |
| `middleware/roleGuard.js` (new file) | New file, additive | **SAFE** | Does not replace existing `requireStudent`/`requireHR`/`requireCoordinator` |
| `controllers/founderController.js` etc. (4 new files) | New files | **SAFE** | No existing controller touched |
| `routes/founderRoutes.js` etc. (4 new files) | New files | **SAFE** | Mounted after existing routes |
| Mounting new routes in `server.js` | Additive only | **NEEDS CARE** | Verify no route path collision with existing `/api/founder*` paths before merging |

---

## PR 3 — Talent Profile Foundation

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| `models/TalentProfile.js` (new model, new collection) | New collection `talentprofiles` | **SAFE** | New collection, zero overlap with `students`/`payments`/etc. |
| `controllers/talentProfileController.js` | New file | **SAFE** | No existing controller modified |
| `routes/talentProfile.js` | New routes at `/api/talent/*` | **SAFE** | No existing route uses this prefix |
| `middleware/validateTalentProfile.js` | New middleware | **SAFE** | Only applied to new talent routes |
| Mounting in `server.js` | Additive only | **NEEDS CARE** | Check `/api/talent` not used elsewhere |

---

## PR 4 — Registration Hub

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| `controllers/registerHubController.js` (rewrite) | New exported functions, removes old `register` export | **NEEDS CARE** | Old route was `router.post('/', ctrl.register)` — new routes use `getHub`, `getRoleConfig`, `registerUser`. The mount path changes from `/api/register-hub` to `/api/register/hub`. Must update server.js mount accordingly. |
| `routes/registerHub.js` (rewrite) | Changed export shape | **NEEDS CARE** | server.js must use updated mount path |
| `public/register-hub.html` (new page) | New page | **SAFE** | Does not replace `public/register.html` |
| Original `POST /register` | **Untouched** | **SAFE** | Original student registration flow unchanged |

---

## PR 5 — PaymentSetu Service Layer

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| `services/payment/PaymentService.js` | New directory, new file | **SAFE** | New abstraction layer |
| `services/payment/PaymentSetuProvider.js` | New file | **SAFE** | Uses only `process.env` for credentials |
| `services/payment/PaymentWebhookService.js` | New file | **SAFE** | New collection, new event emitter |
| `models/PaymentTransaction.js` | New collection `paymenttransactions` | **SAFE** | Does not touch `payments` collection |
| `controllers/paymentSetuController.js` | New file | **SAFE** | |
| `routes/paymentSetuRoutes.js` mounted at `/api/payment/setu/*` | New prefix | **SAFE** | Existing `/api/v2/payment/*` is a different prefix |
| Webhook at `/api/payment/setu/webhook` uses `express.raw()` | Scoped to single route | **SAFE** | Does not affect global JSON parsing |

---

## PR 6 — Navigation Expansion

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| 4 new route files (`founderOS`, `talentNetwork`, `programs`, `community`) | New paths | **SAFE** | None conflict with existing paths |
| 4 new HTML pages | New files in `public/` | **SAFE** | No existing page replaced |
| `public/js/coming-soon-modal.js` | New file | **SAFE** | Only affects pages that load it |
| Sidebar nav additions in new HTML pages | Additive links only | **SAFE** | Existing HTML pages not modified |

---

## PR 7 — Design System & UI Foundation

| Change | Impact | Rating | Justification |
|--------|--------|--------|---------------|
| `public/css/design-system.css` | New CSS file, scoped by CSS variables | **SAFE** | Only loaded by new Phase 1 pages |
| `public/css/components.css` | New component CSS | **SAFE** | Uses BEM-style class names unlikely to collide |
| `public/css/modernize-existing.css` | Low-specificity progressive enhancement | **NEEDS CARE** | Uses `body` and element selectors without classes — could subtly affect existing page rendering. Must test on `hr-portal.html`, `student-dashboard.html`, `coordinator-dashboard.html` before loading on existing pages. |
| `public/js/theme-toggle.js`, `components.js`, `api-client.js` | New JS files | **SAFE** | Self-contained IIFEs, attach to `window.TEN` namespace |
| `public/partials/head-links.html` | New partial (reference only) | **SAFE** | Not auto-included anywhere |

---

## Summary

| Rating | Count | PRs |
|--------|-------|-----|
| ✅ SAFE | ~25 changes | All PRs |
| ⚠️ NEEDS CARE | 4 changes | PR2, PR3, PR4, PR7 |
| 🔴 HIGH RISK | 0 changes | — |

**No HIGH RISK changes.** All Phase 1 work is strictly additive.
