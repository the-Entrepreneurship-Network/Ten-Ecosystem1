# Dashboards Map

## Existing Dashboards (PROTECTED)

### public/dashboard.html
- **Role:** General / Student (post-login landing)
- **Sections:** Navigation hub, links to all portals
- **APIs Called:** None (static routing page)

### public/student-dashboard.html
- **Role:** Student
- **Sections:** Task list, attendance record, coin balance, streak tracker, certificate status
- **APIs Called:** `/api/v2/student/me`, `/api/v2/tasks/my-tasks`, `/api/v2/student/status`

### public/hr-portal.html
- **Role:** HR
- **Sections:** Student table, submission review, attendance overview, promotion panel, domain management
- **APIs Called:** `/api/v2/hr/dashboard-stats`, `/api/v2/hr/internship-tracker`, `/hr/students`

### public/coordinator-dashboard.html
- **Role:** Coordinator
- **Sections:** Domain attendance, student performance, document verification, coding quiz management
- **APIs Called:** `/attendance/coordinator`, coordinator-specific endpoints in server.js

### public/payment.html
- **Role:** Student
- **Sections:** Payment form, Razorpay checkout integration
- **APIs Called:** `/api/v2/payment/create-order`, `/api/v2/payment/status/:orderId`

### public/my-certificates.html
- **Role:** Student
- **Sections:** Certificate list, claim buttons, QR verification links
- **APIs Called:** `/api/v2/certificates/my-certs`, `/api/v2/certificates/claim/:type`

### public/my-documents.html
- **Role:** Student
- **Sections:** Document upload, verification status
- **APIs Called:** `/api/v2/upload-marksheet`, `/api/v2/my-status`

### public/quiz-portal.html
- **Role:** Student
- **Sections:** Quiz questions per task, timer, submission
- **APIs Called:** `/api/v2/quiz/:taskId/questions`, `/api/v2/quiz/:taskId/submit`

### public/v2-tasks.html
- **Role:** Student
- **Sections:** Task cards with video, submission form, progress tracker
- **APIs Called:** `/api/v2/tasks/my-tasks`, `/api/v2/tasks/:taskId/submit`

---

## Phase 1 — New Dashboards

### public/register-hub.html *(PR4)*
- **Role:** Unauthenticated (onboarding)
- **Sections:** Role selection grid (8 cards), common fields, dynamic role-specific fields, terms
- **APIs Called:** `GET /api/register/hub/roles`, `POST /api/register/hub/register`

### public/founder-os.html *(PR6)*
- **Role:** Founder, Admin
- **Sections:** Hero, stats row (4 cards), quick actions grid, recent activity feed
- **APIs Called:** `GET /api/founder-os/stats`

### public/talent-network.html *(PR6)*
- **Role:** All authenticated
- **Sections:** Search bar with filters, featured talent grid, trending skills strip
- **APIs Called:** `GET /api/talent-network/featured`, `GET /api/talent-network/trending-skills`, `GET /api/talent/search`

### public/programs.html *(PR6)*
- **Role:** All authenticated
- **Sections:** Filter tabs (All/Internship/Bootcamp/Fellowship), 3 sample program cards, CTA banner
- **APIs Called:** None (static Phase 1 content)

### public/community.html *(PR6)*
- **Role:** All authenticated
- **Sections:** Channel cards (3), upcoming events list (3), coming-soon banner
- **APIs Called:** None (static Phase 1 content)
