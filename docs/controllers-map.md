# Controllers Map

> Most business logic in this project lives inline in `server.js` route handlers.
> The controllers listed below are modular files in `controllers/`.

---

## controllers/registerHubController.js
**Purpose:** Multi-role user registration hub

| Function | Description | Models Touched |
|----------|-------------|----------------|
| `getHub(req, res)` | Serves `register-hub.html` | None |
| `getRoleConfig(req, res)` | Returns role config JSON for the UI | None |
| `registerUser(req, res)` | Creates user in appropriate collection based on role | EcosystemUser, Student, HR, Coordinator, TalentProfile |

---

## controllers/founderController.js *(Phase 1)*
| Function | Description | Models Touched |
|----------|-------------|----------------|
| `getDashboard(req, res)` | Returns founder dashboard stub | None |

## controllers/mentorController.js *(Phase 1)*
| Function | Description | Models Touched |
|----------|-------------|----------------|
| `getDashboard(req, res)` | Returns mentor portal stub | None |

## controllers/investorController.js *(Phase 1)*
| Function | Description | Models Touched |
|----------|-------------|----------------|
| `getDashboard(req, res)` | Returns investor portal stub | None |

## controllers/contractorController.js *(Phase 1)*
| Function | Description | Models Touched |
|----------|-------------|----------------|
| `getDashboard(req, res)` | Returns contractor portal stub | None |

---

## controllers/talentProfileController.js *(Phase 1)*
| Function | Description | Models Touched |
|----------|-------------|----------------|
| `createOrUpdate(req, res)` | Upsert talent profile for auth user | TalentProfile |
| `getMyProfile(req, res)` | Get own profile with populated user | TalentProfile |
| `getPublicProfile(req, res)` | Get public profile by userId | TalentProfile |
| `searchTalents(req, res)` | Paginated search of public profiles | TalentProfile |
| `verifyProfile(req, res)` | Admin/HR/Coord verification | TalentProfile |

---

## controllers/paymentSetuController.js *(Phase 1)*
| Function | Description | Models Touched |
|----------|-------------|----------------|
| `initiatePayment(req, res)` | Create Setu order + save transaction | PaymentTransaction |
| `verifyPayment(req, res)` | Verify payment with provider | PaymentTransaction |
| `handleWebhook(req, res)` | Process inbound webhook (HMAC verified) | PaymentTransaction |
| `getTransactionStatus(req, res)` | Fetch transaction by ID | PaymentTransaction |
| `getUserTransactions(req, res)` | Paginated list of user's transactions | PaymentTransaction |

---

## Inline Handlers (server.js)
The majority of route handlers are defined inline in `server.js`. Key sections:
- **Lines ~200–600:** Student registration, login, task submission
- **Lines ~600–1200:** HR management, promotion, attendance
- **Lines ~1200–2000:** V2 payment, certificates, documents, quiz
- **Lines ~2000–3000:** Coordinator operations, coding challenges
- **Lines ~3000–3800:** Chat, block list, Socket.io setup
- **Lines ~3800–4500:** V2 route mounting, static files, server start
