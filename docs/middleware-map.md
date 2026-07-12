# Middleware Map

## Existing Middleware (server.js — PROTECTED)

### Rate Limiters
| Name | File | Config | Routes Applied |
|------|------|--------|---------------|
| `loginLimiter` | server.js | 5 req / 15 min | POST /login, /hr-login, /coordinator-login |
| `registerLimiter` | server.js | 3 req / 1 hour | POST /register |
| `apiLimiter` | server.js | 100 req / 15 min | /api/* |

### Sanitization
| Name | File | Purpose |
|------|------|---------|
| `_sanitizeKeys` | server.js (inline) | Strips `$` and `.` from req.body keys to prevent NoSQL injection |

### Security
| Package | Config |
|---------|--------|
| `helmet` | CSP/COEP/CORP disabled for iframe/multipart compatibility |
| `cors` | All origins allowed (development mode) |

### V2 Auth Guards (defined in routes/v2/*.js)
| Name | File | Purpose |
|------|------|---------|
| `requireStudent` | routes/v2/student.js | Validates student session, attaches `req.student` |
| `requireHR` | routes/v2/hr.js | Validates HR session, attaches `req.hr` |
| `requireCoordinator` | routes/v2/*.js | Validates coordinator session |

---

## Phase 1 — New Middleware

### middleware/roleGuard.js *(Phase 1)*
| Export | Purpose |
|--------|---------|
| `requireRole(...roles)` | Factory — returns Express middleware that checks `req.user.role` against allowed roles array. Returns 403 if role not permitted. |
| `attachEcosystemUser(req, res, next)` | Reads userId/role from headers or session, attaches to `req.user`. Used for ecosystem user routes until full JWT auth is implemented in Phase 2. |

### middleware/validateTalentProfile.js *(Phase 1)*
| Export | Purpose |
|--------|---------|
| `validateTalentProfile` | Validates talent profile request body. Checks: headline ≤120 chars, bio ≤1000 chars, valid skill levels, valid availability/openTo/visibility enums, valid social link URLs. Returns 422 with field-level errors on failure. |

---

## Middleware Execution Order (per request)
1. `helmet` (security headers)
2. `cors`
3. `express.json()` / `express.urlencoded()`
4. `_sanitizeKeys` (body sanitization)
5. Rate limiters (per-route)
6. Route-specific auth guards (`requireStudent` / `requireHR` / `requireRole`)
7. Route handler
