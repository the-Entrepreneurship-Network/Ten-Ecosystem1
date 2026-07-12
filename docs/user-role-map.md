# User Role Map

## Existing Roles (PROTECTED — do not modify)

### Student
- **Collection:** `students`
- **Access:** Own task submissions, attendance, certificates, documents, payments, quiz, leaderboard
- **Middleware:** Inline session checks in `server.js` — `requireStudent` in v2 routes
- **Login:** `POST /login`, `POST /hr-login` (redirects)

### HR
- **Collection:** `hrs`
- **Access:** All student management, submissions review, promote to coordinator, attendance overview, HR dashboard
- **Middleware:** Inline `req.session.hr` checks; `requireHR` in v2 routes
- **Login:** `POST /hr-login`

### Coordinator
- **Collection:** `coordinators`
- **Access:** Domain-level attendance marking, student oversight, quiz management, document verification
- **Middleware:** Inline `req.session.coordinator` checks; `requireCoordinator` in v2 routes
- **Login:** `POST /coordinator-login`

### Admin
- **Collection:** none (hardcoded in env or HR with role='admin')
- **Access:** Full platform access
- **Middleware:** Ad-hoc checks

---

## Phase 1 — New Roles

### Founder
- **Collection:** `ecosystemusers` (role: 'founder')
- **Planned Access:** Founder OS dashboard, post internships, find talent, view payments, schedule mentors
- **Middleware:** `requireRole(ROLES.FOUNDER)` — new `middleware/roleGuard.js`
- **Login:** Phase 2 (shared login page)

### Mentor
- **Collection:** `ecosystemusers` (role: 'mentor')
- **Planned Access:** Mentor dashboard, view mentee list, session scheduling
- **Middleware:** `requireRole(ROLES.MENTOR)`
- **Login:** Phase 2

### Investor
- **Collection:** `ecosystemusers` (role: 'investor')
- **Planned Access:** Investor dashboard, deal flow, startup profiles
- **Middleware:** `requireRole(ROLES.INVESTOR)`
- **Login:** Phase 2

### Contractor
- **Collection:** `ecosystemusers` (role: 'contractor')
- **Planned Access:** Contractor dashboard, project bids, time tracking
- **Middleware:** `requireRole(ROLES.CONTRACTOR)`
- **Login:** Phase 2

---

## Role Permissions Matrix (Phase 1)

| Resource | Student | HR | Coordinator | Admin | Founder | Mentor | Investor | Contractor |
|----------|---------|----|----|-------|---------|--------|----------|------------|
| Own dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Talent search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Talent verify | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Founder OS | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Post internship | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| PaymentSetu | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Promote roles | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
