# API Map

## Legend
- 🔒 Auth Required (session or middleware)
- 🌐 Public
- 👤 Role-specific

---

## Legacy Routes (server.js)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/register` | Student registration | 🌐 |
| POST | `/login` | Student/HR/Coord login | 🌐 |
| POST | `/submit-task` | Task submission | 🔒 Student |
| POST | `/hr-login` | HR login | 🌐 |
| POST | `/coordinator-login` | Coordinator login | 🌐 |
| GET | `/hr/students` | List all students | 🔒 HR |
| GET | `/hr/submissions` | All task submissions | 🔒 HR |
| POST | `/attendance/self` | Student marks own attendance | 🔒 Student |
| POST | `/attendance/coordinator` | Coordinator marks attendance | 🔒 Coord |
| POST | `/hr/promote/to-coordinator` | Promote student to coordinator | 🔒 HR |
| GET | `/leaderboard/overall` | Global leaderboard | 🌐 |
| GET | `/verify-document` | Render doc verify page | 🌐 |
| GET | `/api/verify-document/:id` | Verify document by ID | 🌐 |

---

## V2 Student Portal (`/api/v2/student`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v2/student/me` | Get authenticated student | 🔒 Student |
| POST | `/api/v2/student/onboard` | V2 onboarding | 🔒 Student |
| GET | `/api/v2/student/status` | Onboarding status | 🔒 Student |

## V2 Tasks (`/api/v2/tasks`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v2/tasks/my-tasks` | Student's task list | 🔒 Student |
| POST | `/api/v2/tasks/:taskId/submit` | Submit task | 🔒 Student |
| PATCH | `/api/v2/tasks/video-progress` | Update video progress | 🔒 Student |

## V2 Quiz (`/api/v2/quiz`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v2/quiz/:taskId/questions` | Get quiz questions | 🔒 Student |
| POST | `/api/v2/quiz/:taskId/submit` | Submit quiz answers | 🔒 Student |

## V2 Certificates (`/api/v2/certificates`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v2/certificates/my-certs` | Student certificates | 🔒 Student |
| POST | `/api/v2/certificates/claim/:type` | Claim certificate | 🔒 Student |
| GET | `/api/v2/certificates/verify/:certId` | Verify certificate | 🌐 |

## V2 Documents (`/api/v2`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v2/upload-marksheet` | Upload marksheet | 🔒 Student |
| GET | `/api/v2/my-status` | Document status | 🔒 Student |

## V2 HR (`/api/v2/hr`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v2/hr/dashboard-stats` | HR dashboard stats | 🔒 HR |
| GET | `/api/v2/hr/internship-tracker` | Intern tracker | 🔒 HR |

## V2 Payment (`/api/v2/payment`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v2/payment/create-order` | Create Razorpay order | 🔒 Student |
| POST | `/api/v2/payment/webhook` | Razorpay webhook | 🌐 |
| GET | `/api/v2/payment/status/:orderId` | Payment status | 🔒 Student |

---

## Phase 1 — New Routes

### Registration Hub
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/register-hub` | Registration hub page | 🌐 |
| GET | `/api/register/hub/roles` | Role config for UI | 🌐 |
| POST | `/api/register/hub/register` | Multi-role registration | 🌐 |

### Role Dashboards
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/founder/dashboard` | Founder dashboard | 🔒 Founder |
| GET | `/api/mentor/dashboard` | Mentor dashboard | 🔒 Mentor |
| GET | `/api/investor/dashboard` | Investor dashboard | 🔒 Investor |
| GET | `/api/contractor/dashboard` | Contractor dashboard | 🔒 Contractor |

### Talent Profile
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/talent/profile` | Create/update profile | 🔒 All |
| GET | `/api/talent/profile/me` | Own profile | 🔒 All |
| GET | `/api/talent/profile/:userId` | Public profile | 🌐 |
| GET | `/api/talent/search` | Search talent | 🔒 All |
| PATCH | `/api/talent/profile/:userId/verify` | Verify profile | 🔒 Admin/HR/Coord |

### PaymentSetu
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/payment/setu/initiate` | Initiate payment | 🔒 All |
| POST | `/api/payment/setu/verify` | Verify payment | 🔒 All |
| POST | `/api/payment/setu/webhook` | Setu webhook | 🌐 (HMAC) |
| GET | `/api/payment/setu/status/:id` | Transaction status | 🔒 All |
| GET | `/api/payment/setu/my-transactions` | User transactions | 🔒 All |

### Navigation Pages
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/founder-os` | Founder OS page | 🌐 |
| GET | `/api/founder-os/stats` | Founder stats | 🔒 Founder/Admin |
| GET | `/talent-network` | Talent Network page | 🌐 |
| GET | `/api/talent-network/featured` | Featured profiles | 🔒 All |
| GET | `/api/talent-network/trending-skills` | Trending skills | 🔒 All |
| GET | `/programs` | Programs page | 🌐 |
| GET | `/community` | Community page | 🌐 |
