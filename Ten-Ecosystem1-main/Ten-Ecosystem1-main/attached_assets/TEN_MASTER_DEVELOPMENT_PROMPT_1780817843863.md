# MASTER DEVELOPMENT PROMPT
## Platform: The Entrepreneurship Network (TEN) — Internship & EdTech Management System
## Document Type: Complete Product Requirements & Development Brief
## Version: 1.0 | Author: AI-Generated via Claude

---

> **HOW TO USE THIS PROMPT:**
> Give this entire document to any AI (ChatGPT, Gemini, Claude, Cursor, etc.)
> and say: *"Build this platform exactly as described. Read every section
> before writing any code."*

---

## ⚠️ SECTION 0: CRITICAL DEFENCE RULES — READ BEFORE WRITING ANY CODE

These rules are NON-NEGOTIABLE and override every other instruction in this document.

1. **NEVER delete, modify, or overwrite any existing file** unless that file is explicitly named in this document
2. **NEVER alter existing database tables** — only CREATE new tables
3. **NEVER modify existing API routes** — only ADD new routes
4. **NEVER replace existing UI components** — only ADD new ones in new files
5. **NEVER change existing authentication logic** — build on top of it
6. If ANY new feature conflicts with existing code → STOP and ask the developer. Do not assume or overwrite
7. All new features must live in clearly named, separate folders or modules
8. All new database columns must go into NEW tables only — never ALTER existing tables
9. Every new code block must be commented: `// NEW FEATURE: [feature name]`
10. Existing student registration, login, and dashboard flows must remain 100% intact and untouched
11. The payment system must be built COMPLETELY but remain INACTIVE behind a single environment flag: `PAYMENT_ENABLED=false`
12. When `PAYMENT_ENABLED` is set to `true` in the `.env` file — ALL payment features must activate automatically with ZERO code changes required

---

## 📌 SECTION 1: PLATFORM OVERVIEW

**Platform Name:** The Entrepreneurship Network (TEN)
**Platform Type:** Internship Management + EdTech Platform with Gamification
**Products to Build:** Web Application (Next.js) + Mobile Application (React Native) — launched simultaneously
**Target Audience:** All ages, all backgrounds, all education levels
**Language:** English only
**Monetization Model:** Freemium — core platform free, certifications are paid
**Login Methods:** Google OAuth + Email & Password (both options must be available)

**Primary Goals:**
- Manage student internships across 14 professional domains
- Deliver structured weekly learning via video + tasks
- Auto-generate official documents (offer letters, certificates)
- Use tenure-based psychology to make certifications feel earned, not sold
- Hold coordinators accountable with a coin-penalty system
- Give HR full document and offer letter management

---

## 🛠️ SECTION 2: TECH STACK

| Layer | Technology |
|---|---|
| Frontend Web | Next.js 14 + Tailwind CSS + Framer Motion |
| Mobile App | React Native with Expo |
| Backend | Node.js + Express.js |
| Primary Database | PostgreSQL |
| Cache / Real-time | Redis (coins, leaderboard, sessions) |
| Authentication | Firebase Auth (Google + Email/Password) |
| File Storage | AWS S3 |
| Certificate Generation | HTML/CSS templates + Puppeteer (headless Chrome → PDF at 300 DPI) |
| Email | Resend or SendGrid |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| Web Hosting | Vercel |
| Backend Hosting | Railway or Render |
| Payment SDK | Razorpay (installed, INACTIVE until flag enabled) |

---

## 🗄️ SECTION 3: NEW DATABASE TABLES

**⚠️ Do NOT touch any existing tables. Create ONLY the following new tables.**

```sql
-- Student uploaded documents
CREATE TABLE student_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  address_proof_url TEXT,
  marksheet_url TEXT,
  upload_status VARCHAR(20) DEFAULT 'pending',
  -- Status values: pending | under_review | approved | rejected
  uploaded_at TIMESTAMP DEFAULT NOW(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  offer_letter_url TEXT,
  offer_letter_sent_at TIMESTAMP
);

-- Student coin balances and history
CREATE TABLE student_coins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id) UNIQUE,
  total_coins INTEGER DEFAULT 0,
  coins_history JSONB DEFAULT '[]',
  -- Each entry in history: { action, coins, timestamp }
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Task library per domain per duration
CREATE TABLE domain_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(60) NOT NULL,
  duration_type VARCHAR(10) NOT NULL,
  -- Values: 45days | 1month | 3months | 6months
  week_number INTEGER NOT NULL,
  task_title VARCHAR(200) NOT NULL,
  task_description TEXT NOT NULL,
  video_url TEXT,
  coin_reward INTEGER DEFAULT 10,
  difficulty_level VARCHAR(20),
  -- Values: easy | medium | hard | expert
  created_at TIMESTAMP DEFAULT NOW()
);

-- Student task progress tracking
CREATE TABLE student_task_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  task_id UUID REFERENCES domain_tasks(id),
  status VARCHAR(20) DEFAULT 'locked',
  -- Values: locked | available | in_progress | submitted | approved | rejected
  started_at TIMESTAMP,
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by UUID REFERENCES users(id),
  submission_url TEXT,
  submission_notes TEXT,
  coordinator_feedback TEXT,
  coins_awarded INTEGER DEFAULT 0,
  video_watched_percent INTEGER DEFAULT 0
);

-- Certificate records
CREATE TABLE student_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  certificate_type VARCHAR(20) NOT NULL,
  -- Values: expert | nano_degree | fellowship
  certificate_id VARCHAR(60) UNIQUE,
  -- Format: TEN-2026-[TYPE]-[RANDOM6]
  domain VARCHAR(60),
  issued_at TIMESTAMP,
  pdf_url TEXT,
  payment_status VARCHAR(20) DEFAULT 'pending',
  -- Values: pending | paid | failed (only relevant when PAYMENT_ENABLED=true)
  verification_url TEXT,
  linkedin_url TEXT,
  badge_svg_url TEXT
);

-- Referral tracking
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES users(id),
  referred_email VARCHAR(200),
  referred_user_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  -- Values: pending | registered | first_task_done
  coins_awarded INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Coordinator performance and coins
CREATE TABLE coordinator_coins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinator_id UUID REFERENCES users(id) UNIQUE,
  total_coins INTEGER DEFAULT 0,
  coins_history JSONB DEFAULT '[]',
  performance_score DECIMAL(5,2) DEFAULT 0.00,
  avg_review_time_hours DECIMAL(5,2) DEFAULT 0.00,
  total_tasks_reviewed INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Psychology trigger log (tracks which triggers have been shown to each student)
CREATE TABLE psychology_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  trigger_name VARCHAR(100),
  -- e.g. DAY1_BLUR_SHOWN | EXPERT_CERT_UNLOCKED | FELLOWSHIP_WHISPER
  shown_at TIMESTAMP DEFAULT NOW(),
  clicked BOOLEAN DEFAULT false,
  converted BOOLEAN DEFAULT false
  -- converted = true when student proceeds to payment after trigger
);

-- Leaderboard (cached, updated every 30 minutes from Redis)
CREATE TABLE leaderboard_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  domain VARCHAR(60),
  cohort_id VARCHAR(60),
  total_coins INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  global_rank INTEGER,
  domain_rank INTEGER,
  cohort_rank INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Student cohort assignments
CREATE TABLE cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_name VARCHAR(100),
  -- e.g. "Python Developer — Cohort 7"
  domain VARCHAR(60),
  start_date DATE,
  end_date DATE,
  coordinator_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE cohort_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID REFERENCES cohorts(id),
  student_id UUID REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW()
);
```

---

## 👨‍🎓 SECTION 4: STUDENT PORTAL

### 4.1 Registration and Onboarding Flow

**Step 1 — Sign Up:**
Google OAuth or Email/Password. Both must work.

**Step 2 — Profile Setup Screen (shown immediately after first login):**
Student must select:
- Their internship domain (dropdown, 14 options — see Section 8)
- Their internship duration (4 options: 45 Days / 1 Month / 3 Months / 6 Months)
- These two selections determine their entire task track and psychology timeline

**Step 3 — Dashboard Access:**
Dashboard loads but shows a non-blocking banner at top:

> *"Complete your profile — upload 2 documents to get your Offer Letter"*

Student can browse the platform freely but this banner persists until documents are uploaded AND approved.

---

### 4.2 Document Upload Module

Place this as a dedicated section called **"My Documents"** in the student portal sidebar.

**Two upload zones required:**

**Upload Zone 1 — Address Proof**
- Label: "Address Proof"
- Subtitle: "Aadhaar Card, Passport, Voter ID, or any government ID"
- Accepted: JPG, PNG, PDF
- Max size: 5MB
- Stored as: `[student_id]_address_proof.[ext]`
- S3 path: `ten-documents/pending/[student_id]/`

**Upload Zone 2 — College Marksheet**
- Label: "Latest College Marksheet"
- Subtitle: "Most recent semester or year marksheet"
- Accepted: JPG, PNG, PDF
- Max size: 5MB
- Stored as: `[student_id]_marksheet.[ext]`
- S3 path: `ten-documents/pending/[student_id]/`

**Upload UI Behaviour:**
- Both zones support drag-and-drop AND click-to-upload
- After upload: show file thumbnail/preview
- Re-upload is allowed until HR starts review
- Both files must be uploaded before "Submit" button activates
- On submit: status in DB updates to `pending`

**Status Display (visible to student after submission):**

| Status | Badge Colour | Text Shown |
|---|---|---|
| Not Uploaded | Grey | "Please upload your documents" |
| Pending Review | Yellow | "📋 Documents Submitted — Under Review" |
| Under Review | Blue | "🔍 Documents being reviewed by HR" |
| Approved | Green | "✅ Approved" |
| Offer Letter Sent | Green + checkmark | "✉️ Offer Letter sent to your email" |
| Rejected | Red | "❌ Document rejected — please re-upload" |

---

### 4.3 Student Dashboard

The dashboard is the emotional core of the platform. Design it like a cockpit — everything the student needs is visible in one view.

**Top Bar (always visible):**
- Student name + Domain badge (e.g., *"Python Developer — Cohort 7"*)
- Coin balance with animated counter (number ticks up on coin earn)
- Streak fire emoji + day count (🔥 14 days)
- Leaderboard rank badge (#12 of 234)

**Main Center — Learning Path:**
- A visual vertical or horizontal timeline showing all weeks
- Completed week = solid filled circle, green ✅
- Current active task = pulsing gold animated circle 🟡
- Locked upcoming tasks = grey empty circle ⚪
- An arc progress ring around the student's profile picture showing overall % complete
- Clicking any week node opens that week's task card

**Right Side Panel:**
- Certificate progress widget: "1 of 3 certifications collected" with 3 nodes (Expert | Nano | Fellowship)
  - Earned = colored and labeled
  - Unearned = grey silhouette, NO label (this is intentional — see Section 5)
- Referral widget: "🎁 Invite friends — earn 100 coins each" + unique referral link with copy button
- Coordinator card: coordinator name, photo, response rate percentage

**Activity Feed (bottom):**
- "You earned +20 coins for completing Week 3 Task — Python OOP" (3 hours ago)
- "Priya from your cohort just earned their Expert Certificate" (passive, once/day max)
- "🔥 Your 14-day streak is safe. Keep going!"

**Leaderboard Preview:**
- Shows top 5 in student's cohort
- Student's own rank always visible even if outside top 5
- "See full leaderboard →" link

---

### 4.4 Task Engine

**Task Assignment Logic:**
When a student completes profile setup (domain + duration), the system queries `domain_tasks` where `domain = [selected]` AND `duration_type = [selected]` and creates entries in `student_task_progress` for all matching tasks with status = `locked`.

Week 1 tasks are immediately set to `available`. All others remain `locked`.

**Task Card Layout:**
```
┌─────────────────────────────────────────────┐
│  Week 3 — Python Data Structures             │
│  🎬 [Embedded YouTube Player]                │
│  Watch at least 80% to unlock the task       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━             │
│  [Task unlocks after video]                  │
│  📝 Task: Build a contact book using...      │
│  💡 Submit: Upload your .py file or          │
│             paste your GitHub link           │
│  🪙 Reward: +25 coins on approval           │
│  [Submit Task] button                        │
└─────────────────────────────────────────────┘
```

**Task Unlock Flow:**
```
Task Card Appears
       ↓
Student watches video (track % via YouTube API)
       ↓
At 80% watched → Task description unlocks
       ↓
Student completes work and submits (file / URL / text)
       ↓
Coordinator notified
       ↓
Coordinator approves → Coins credited → Next week unlocks
Coordinator rejects → Feedback shown → Student can resubmit
```

**Video Watch Tracking:**
Use the YouTube IFrame Player API. Track `onStateChange` events. Record percentage watched. At 80% watched, update `video_watched_percent` in `student_task_progress` and unlock task submission. If tracking fails due to API error → allow task submission with a soft nudge: *"Watch the video first to get the full picture"* + a Skip button (skip is tracked but not forced).

**Coin Rewards Table:**

| Action | Coins Awarded |
|---|---|
| Watch video (80%+ completion) | +5 |
| Submit a task | +5 |
| Task approved by coordinator | +20 |
| Pass a quiz (if applicable) | +25 |
| Daily login | +3 |
| 7-day streak bonus | +50 |
| 30-day streak bonus | +200 |
| Refer a friend who registers | +100 |
| Referred friend completes first task | +50 additional |
| Complete entire internship | +500 |

---

### 4.5 Gamification System

**Coin System:**
- All balances in `student_coins` table, cached in Redis for speed
- Real-time coin animations: every time coins are added, the counter ticks up with a particle burst effect (use Framer Motion or Lottie)
- Full coin history accessible to student in "My Coins" section

**Streak System:**
- Daily login tracked per student
- Streak counter shown on dashboard with fire emoji
- Breaking a streak resets counter to 0
- Streak Freeze: purchasable with 500 coins = 1 freeze day (allows 1 missed day without breaking streak)
- At-risk notification: if student has not logged in by 10:30 PM, push notification fires: *"🔥 Your [X]-day streak ends at midnight. Don't break it!"*

**Badges:**
- Domain badge — given on registration (e.g., "Python Developer")
- Weekly completion badges — one per week completed
- Streak milestone badges — 7 days, 30 days, 60 days, 90 days
- Referral badges — 1 referral, 5 referrals, 10 referrals
- ALL badges (earned AND unearned) shown in the Achievements section
- **Earned badges:** Full color, labeled, animated glow on hover
- **Unearned badges:** Grey silhouette, NO label, NO hint — pure visual mystery

  > **WHY:** This is the Zeigarnik Effect. An incomplete collection creates psychological tension that compels students to keep going. Never label unearned badges. Never explain what they are. The mystery IS the mechanism.

**Leaderboard (3 views):**
- Global: all students on platform
- Domain: students in same domain
- Cohort: students in same cohort batch
- Updated every 30 minutes (Redis cache, PostgreSQL sync)
- Tie-breaking: sort by tasks completed, then by earliest join date

**Referral System:**
- Each student gets a unique referral URL: `yourdomain.com/join?ref=[student_id]`
- Referral dashboard section: total invited | registered | first-task-done | coins earned
- Coins credited at: registration AND at referred friend's first task approval
- Duplicate referrals (same email referred twice) → silently ignore, no coins, no error shown

---

## 🧠 SECTION 5: PSYCHOLOGY SYSTEM — BUILDER FRAMEWORK

> **CORE PHILOSOPHY:** Never sell a certificate. Sell the feeling of becoming someone.
> The student should never feel sold to. Every purchase must feel like their own idea.
> We build IDENTITY first. The certificate is just proof of who they already became.

### 5.1 Universal Triggers (All Tenures, All Domains)

**Trigger 1 — DAY1_BLUR_SHOWN:**
Fires: On first dashboard load after profile setup.
What happens: Behind the Achievements section, a blurred certificate preview is visible (their name is already on it — pulled from their profile).
Text overlay: *"This is waiting for you. Keep going."*
No price. No button. Just the visual.
Log in `psychology_triggers`.

**Trigger 2 — FIRST_TASK_COIN_POPUP:**
Fires: The moment first task is approved.
What happens: Coin animation plays. Small bottom-right corner card appears (not a modal, not a popup — a card):
> *"🪙 +20 coins earned. You're building something real."*
Below it — for the very first time — a progress bar appears:
`Expert Certificate: 12% complete`
No price mentioned. No call to action. Just a bar.
Log in `psychology_triggers`.

**Trigger 3 — SOCIAL_PROOF_NOTIFICATION:**
Fires: Once per day maximum, when any student in the same cohort earns a certificate.
Shown as a subtle feed item (NOT a notification bell, NOT a popup):
> *"Arjun S. from your cohort just received their Expert Certificate"*
Clicking opens their leaderboard profile (not a sales push).
Log in `psychology_triggers`.

---

### 5.2 Expert Certificate Unlock Trigger

**IMPORTANT: The timing of this trigger changes based on tenure. See table below.**

**What happens when trigger fires:**
1. Screen transitions to a full-page celebration view (not a modal)
2. Screen goes dark (0.5s fade)
3. Student name fades in center screen (0.8s)
4. Certificate slides in from center, scaling from 0.1 to 1.0 (1.2s, ease-out)
5. Confetti particles fall
6. Subtle triumphant sound plays (with mute option)
7. Text: *"You've officially qualified for the Expert Certificate. This is yours now."*
8. Certificate shown with their name already on it (real preview, not blurred)
9. Single button: `Claim It →`
10. Clicking shows ₹100 price + Razorpay payment UI (inactive if PAYMENT_ENABLED=false — show "Payment coming soon")
11. Log trigger: `EXPERT_CERT_UNLOCKED`

**Framing used:** This is RECOGNITION, not a sale. The language says they EARNED it. The price is just the claiming step.

---

### 5.3 Nano Degree Unlock Trigger

**After Expert Certificate is claimed (or dismissed), the Nano Degree slow burn begins:**

A quiet progress bar appears permanently on the dashboard:
`Nano Degree: ████░░░░ 42%`
No price. No call to action. Just a bar that updates every time a task is completed.

**At 70% completion:**
Same celebration sequence as Expert Certificate but for the Nano Degree.
Text: *"You've done the real work. The Nano Degree is now available to you — this is making it official."*
Button: `Claim It →`
Price shown: ₹1000
Log trigger: `NANO_CERT_UNLOCKED`

---

### 5.4 Fellowship Whisper Trigger

**Eligibility:** Only students in the top 10% of their cohort leaderboard.

**How it appears:**
NOT a banner. NOT a notification bell. NOT a popup.
A personal card that slides in from the right edge of the screen, like a private letter:

> *"You are one of [X] students in your cohort who have maintained a [Y]-day streak,
> completed [Z]% of tasks, and stayed in the top 10. The Fellowship is reserved for
> students like you. No one else in your batch has been notified yet."*

Only "Learn More →" button. No price on first view.
Second view (after clicking Learn More) shows the Fellowship design and ₹2500 price.
Log trigger: `FELLOWSHIP_WHISPER_SHOWN`

**If student is NOT in top 10%:**
They never see the Fellowship trigger. No explanation. No error. No mention of it. It simply doesn't appear. The exclusivity is real, not fake.

---

### 5.5 Tenure-Specific Psychology Timeline

| Tenure | Expert Cert Trigger | Nano Degree Trigger | Fellowship Whisper |
|---|---|---|---|
| 45 Days | Day 10 | Day 30 | Day 40 |
| 1 Month | Day 7 | Day 22 | Day 27 |
| 3 Months | End of Week 6 | End of Month 2 | End of Week 10 |
| 6 Months | End of Month 2 | End of Month 4 | End of Month 5 |

**IMPORTANT:** These triggers fire based on TIME, not just task completion percentage.
Both conditions must be met for trigger to fire:
- Student has reached the time checkpoint above
- AND student has met the completion percentage (30% for Expert, 70% for Nano)

If time checkpoint is reached but completion is below threshold → show a gentle nudge:
> *"You're [X]% away from unlocking something big. Keep going."*

---

### 5.6 Cohort Identity System

On registration, students are assigned to a named cohort:
`[Domain Name] — Cohort [Number]` → e.g., *"Data Science — Cohort 4"*

This cohort name must appear:
- On their dashboard header
- On their certificate
- In their leaderboard section
- In all notifications about cohort activity

**Why this matters:** Once a student adopts a cohort identity, leaving feels like abandoning a team. This is Social Commitment — the most powerful retention mechanism available. Never let them forget they are part of something.

---

## 👩‍💼 SECTION 6: HR ADMIN PORTAL

### 6.1 New Section — "Generate Documents"

Add a new section to the existing HR/Admin portal called **"Generate Documents"**.
Inside it, create a sub-tab called **"Pending"**.

**DO NOT modify the existing admin portal structure — only ADD this new section.**

### 6.2 Pending Tab

The Pending tab shows all students who have uploaded BOTH documents and are awaiting offer letter generation.

**Table Columns:**
Student Name | Domain | Duration | Upload Date | Address Proof | Marksheet | Status | Action

- Address Proof column: `View` button → opens file in new browser tab
- Marksheet column: `View` button → opens file in new browser tab
- Each row has a checkbox (left)
- "Select All" checkbox in table header
- Bulk action button above table: `Generate Offer Letters for Selected`

**Bulk Offer Letter Generation Flow:**
1. HR selects one or multiple students via checkboxes
2. Clicks "Generate Offer Letters"
3. System loops through selected students
4. For each student: inject their data into the offer letter HTML template
5. Convert to PDF using Puppeteer
6. Save to S3: `ten-documents/offer-letters/[student_id]_offer_letter.pdf`
7. Send email to student with PDF attached
8. Update `student_documents.upload_status` to `approved`
9. Update `student_documents.offer_letter_url` and `offer_letter_sent_at`
10. Student portal status badge updates automatically
11. HR dashboard shows success count: *"12 offer letters generated and sent successfully"*

**Offer Letter Template Variables (inject dynamically):**
```
[STUDENT_FULL_NAME]
[DOMAIN_NAME]
[DURATION_TYPE]  → e.g., "3 Months"
[START_DATE]
[END_DATE]
[INTERNSHIP_MODE] → "Remote"
[ORGANIZATION_NAME] → "The Entrepreneurship Network (TEN)"
[DATE_ISSUED]
[DIRECTOR_NAME]
[DIRECTOR_SIGNATURE_URL]
```

**Document Status Flow:**
```
Student uploads → "Pending Review" (yellow)
HR opens record → "Under Review" (blue)
HR generates offer letter → "Approved" (green)
Email successfully sent → "Offer Letter Sent" (green + ✓)
```

---

## 👨‍🏫 SECTION 7: COORDINATOR PORTAL

### 7.1 Coordinator Dashboard

Coordinators manage assigned students and are held accountable by the coin system.

**Dashboard Shows:**
- Total assigned students | Students active this week | Pending reviews count
- Their own coin balance (same coin UI as students)
- Performance score (0-100%) with label
- Average review time (in hours)
- "Pending Reviews" list — most urgent (oldest) at top

### 7.2 Task Review Flow

When a student submits a task:
1. Coordinator receives push notification + email
2. Task appears in coordinator's "Pending Reviews" tab
3. Coordinator sees: student name, domain, week number, task, submission, video watch %
4. Two actions available:
   - **Approve** → write feedback (optional) → submit
   - **Request Revision** → write specific feedback (required — minimum 30 words) → submit
5. On approval: student coins credited, next task unlocks, student notified
6. On revision request: student sees feedback, can resubmit

**Review Time Rules:**
- Within 24 hours → +30 coins for coordinator
- Within 48 hours → +15 coins for coordinator
- After 48 hours → -30 coins per day delayed
- After 72 hours → admin alert fires + -60 coins

### 7.3 Coordinator Coin System — Full Accountability

**Coins Earned:**

| Action | Coins |
|---|---|
| Review task within 24 hours | +30 |
| Review task within 48 hours | +15 |
| Write feedback over 50 words | +10 |
| Student completes full course | +100 |
| Zero pending reviews at end of day | +20 |
| Student gives 5-star rating | +25 |
| Student's weekly streak maintained (coordinator's engagement) | +10 |

**Coins Deducted:**

| Action | Coins |
|---|---|
| Task unreviewed after 48 hours | -30 |
| Task unreviewed after 72 hours | -60 |
| Student drops out (coordinator had no engagement for 7+ days) | -100 |
| Student formally complains | -50 |
| Feedback shorter than minimum word count | -10 |

**Performance Score Formula:**
```
Performance Score =
  (Tasks reviewed within 48h / Total tasks due) × 40
+ (Average student rating / 5) × 30
+ (Student course completion rate) × 30
```
Score displayed as a percentage with label:
- 90–100%: "Outstanding"
- 75–89%: "High Performer"
- 60–74%: "On Track"
- Below 60%: "Needs Improvement" → flagged to admin

**Coordinator Leaderboard:**
- Top 5 coordinators visible on internal dashboard
- Rankings updated weekly
- Bottom performers (below 50%) sent automated improvement alerts to admin

---

## 🏅 SECTION 8: CERTIFICATE DESIGN SPECIFICATIONS

Build all three certificates as HTML/CSS templates. Use Puppeteer to render them to PDF at 300 DPI.
Each certificate must also be exportable as a high-resolution PNG (2480×3508px).

**Certificate ID Format:** `TEN-2026-[TYPE]-[6-CHAR-RANDOM]`
Example: `TEN-2026-EXP-K4M7R2`

**Verification URL:** `yourdomain.com/verify/[certificate_id]`
This page must be public and show: student name, domain, date, certificate type, validity status.

---

### 8.1 Expert Certificate — ₹100 | "Clean Confidence"

**The feeling:** Opening a crisp, official document. Professional. Real. Worth framing.

```
Background:       #FDFAF4  (warm ivory)
Border:           2px solid #C9A84C — single thin gold line
                  SVG ornamental corners (subtle, not heavy)
Heading Font:     Playfair Display (Google Font) — for student name, 48px
Body Font:        Inter or DM Sans — 14px
Primary Accent:   #C9A84C (gold — used ONLY on border, org name, seal)
Layout:           A4 Landscape

Elements top to bottom:
1.  Organization logo — top center, 80px height
2.  "CERTIFICATE OF COMPLETION" — small caps, letter-spacing: 0.3em, gold, 11px
3.  Thin horizontal gold rule
4.  "This certifies that" — #999, 14px, italic
5.  [STUDENT_FULL_NAME] — Playfair Display, 48px, #1A1A1A, center
6.  "has successfully completed the" — #666, 16px
7.  [DOMAIN_NAME] Internship Program — bold, 20px, #1A1A1A
8.  "Duration: [X] | Completed: [DATE]" — #999, 12px
9.  Horizontal gold divider rule
10. Bottom row (three columns):
    Left:   Director signature (digital, designed — not scanned)
            "Director, TEN" label beneath
    Center: Circular embossed seal (SVG)
            "THE ENTREPRENEURSHIP NETWORK" ring text
            TEN logo or domain icon center
    Right:  QR code (128×128px) linking to verification URL
11. Certificate ID — bottom left, monospace font, 9px, #999
12. Light diagonal watermark text across background at 3% opacity: "THE ENTREPRENEURSHIP NETWORK"
```

---

### 8.2 Nano Degree Certificate — ₹1000 | "Power and Permanence"

**The feeling:** Holding something that belongs in a frame. Something recruiters stop and look at.

```
Background:       #0A1628  (deep navy)
Overlay:          Subtle hexagon/geometric SVG pattern at 4% opacity white
Noise texture:    8% opacity grain overlay (makes it feel like premium paper on screen)
Border:           Double border — outer: 1px white, inner: 1px gold (#D4AF37)
                  8px gap between borders. Decorative architectural corner flourishes.
Heading Font:     Playfair Display — student name, 52px, gold gradient text
Body Font:        DM Sans — white, 14px
Gold Treatment:   CSS gradient: #B8860B → #FFD700 → #DAA520
Layout:           A4 Landscape

Special visual elements:
- Left edge: 12px shimmer strip (CSS linear-gradient animation silver→gold→silver)
  This appears animated in the digital reveal screen. Static in PDF export.

Elements top to bottom:
1.  Dark ribbon band (top 22% of certificate, slightly darker navy)
    Inside ribbon: Organization name in gold small caps, centered
                   "THE ENTREPRENEURSHIP NETWORK" 
2.  "NANO DEGREE CERTIFICATE" — tracked caps, gold gradient, 14px, letter-spacing: 0.4em
3.  "Awarded to" — white, 13px, italic, center
4.  [STUDENT_FULL_NAME] — Playfair Display, 52px, gold gradient, center
5.  [DOMAIN_NAME] Specialization — DM Sans, 16px, white, center
6.  Duration | Cohort | Completion Date block — white, 12px
7.  "With Distinction" or "Completed" label (based on performance score)
8.  Two seals side by side:
    Left:  TEN organizational seal (circular SVG)
    Right: Domain-specific seal (Python snake icon / Java coffee / etc.)
9.  "Add to LinkedIn →" row — small LinkedIn logo + pre-filled URL to LinkedIn certification form
10. QR code — center bottom, white border, links to verification page
11. Certificate ID — bottom right, monospace, white, 9px
```

**Create a domain seal icon for each of the 14 domains** as SVG files.

---

### 8.3 Fellowship Certificate — ₹2500 | "This Is Not a Certificate. This Is an Artifact."

**The feeling:** The moment someone receives an Oscar or a doctoral degree. Weight. Legacy. Identity.

```
Background:       #0D2818 (deep forest green) — configurable per cohort
                  Alternative: #1A0A2E (royal purple) — set in admin panel
Full background:  Custom SVG illustration — constellation or architectural arch pattern
                  in gold lines at 5% opacity. This illustration should be unique and
                  beautiful. Commission or generate it. It is the most important
                  design element on this certificate.
Gold Treatment:   Multi-stop gradient: #B8860B → #FFD700 → #DAA520 → #B8860B
                  Applied to: name, title, seal ring, ornaments
Main Title Font:  Impact or tracked display sans — "FELLOW" in massive caps
Name Font:        Cormorant Garamond (Google Font) — calligraphic serif, 60px
Layout:           A4 Landscape (primary) + A3 Poster version (for physical print)

Elements:
1.  "FELLOW" — massive tracked display text, gold gradient, top center
    Full width of certificate, letter-spacing: 0.5em
2.  "of The Entrepreneurship Network" — below, small elegant caps, white, 12px
3.  [DOMAIN_NAME] — gold, 14px, centered
4.  Thin gold ornamental rule
5.  Auto-generated citation paragraph (center, italic, white, 14px):
    "This certifies that [STUDENT_FULL_NAME] has demonstrated exceptional dedication,
     mastery of craft, and commitment to growth throughout their [DURATION] journey
     at The Entrepreneurship Network. This Fellowship is awarded in recognition of
     their achievement in the top 3% of their cohort in [DOMAIN_NAME]."
6.  [STUDENT_FULL_NAME] — largest element on page, Cormorant Garamond,
    60px, gold gradient, center — this is the HERO of the design
7.  Cohort name + Graduation date — white, 12px
8.  Large wax seal (center bottom):
    CSS-rendered: circular, deep red #8B0000 background
    Gold gradient ring border
    Embossed TEN logo inside
    Drop shadow for 3D depth effect
9.  Decorative ribbon flowing from wax seal (SVG)
10. THREE signature lines (equal spacing):
    [Director Name] | [Program Head Name] | [Domain Expert Name]
    Each with a designed signature above and title below
11. QR verification — bottom right
12. Certificate ID — bottom left
13. "Fellow of TEN — [YEAR]" watermark at very low opacity

Exports to produce:
- PDF A4 (digital delivery)
- PDF A3 (print-ready, CMYK colour profile, includes 3mm bleed marks)
- PNG at 2480×3508px
- SVG badge file (for email signatures + LinkedIn)
```

**Physical Copy Option (when payment is active):**
Add a checkbox after purchase: "I want a physical printed copy — ₹500 extra, delivered in 7 days"
Triggers a separate order record. Admin fulfils manually or via print partner.

---

### 8.4 Certificate Reveal Animation (All Three Tiers)

Shown in the browser when a student claims any certificate.
**This is NOT just a download link. This is a ceremony.**

```
Sequence:
1. Screen fades to dark background (0.5s)
2. Particle field appears (subtle, dark — think stars, not glitter)
3. Student's name fades in center, white, large (0.8s)
4. Certificate scales in from 0.05 to 1.0, center (1.2s, cubic-bezier ease-out)
5. Confetti bursts from top edge (2s duration, 200 particles)
6. Short triumphant sound plays (1.5s, subtle — mute button visible)
7. Certificate rests, fully visible
8. Three action buttons fade in below:
   [Download PDF]  [Share on LinkedIn]  [Share on WhatsApp]
9. Background: dark with slow-moving particle field
```

Implement using Framer Motion (web) or React Native Animated (mobile).

---

## 📚 SECTION 9: DOMAIN TASK DATABASE

**For each domain, populate the `domain_tasks` table with tasks for all 4 duration types.**
Video links use YouTube. Embed via YouTube IFrame API. Track watch percentage.

**Duration condensing rules:**
- `45days` (6 weeks): Combine every 2 weeks of the 3-month track into 1 week. Slightly broader, less depth per topic.
- `1month` (4 weeks): Cover only foundational topics. Fast sprint pace.
- `3months` (12 weeks): Standard depth — use task descriptions below exactly.
- `6months` (24 weeks): Weeks 1–12 same as 3-month track. Weeks 13–24 are advanced topics.

---

### DOMAIN 1: Python Developer

**3-Month Track (12 Weeks):**

| Week | Topic | Task Description | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Python Basics | Write 10 Python programs covering variables, data types, input/output | https://youtu.be/_uQrJ0TkZlc | 20 | Easy |
| 2 | Control Flow | Build a number guessing game using loops, conditionals, and functions | https://youtu.be/t8pPdKYpowI | 20 | Easy |
| 3 | Data Structures | Build a contact book application using lists and dictionaries | https://youtu.be/W8KRzm-HUcc | 25 | Easy |
| 4 | File Handling | Build a student grade tracker that reads and writes to files | https://youtu.be/Uh2ebFW8OYM | 25 | Medium |
| 5 | OOP | Design a full library management system using classes and inheritance | https://youtu.be/JeznW_7DlB0 | 30 | Medium |
| 6 | APIs & Modules | Build a weather dashboard using OpenWeatherMap API | https://youtu.be/SqvVm3QiQVk | 30 | Medium |
| 7 | Databases | Build a to-do app with full SQLite CRUD backend | https://youtu.be/byHcYRpMgI4 | 35 | Medium |
| 8 | Web Scraping | Scrape a job listings site and store results in a CSV file | https://youtu.be/XVv6mJpFOb0 | 35 | Hard |
| 9 | Flask Basics | Build a simple REST API with two endpoints using Flask | https://youtu.be/Z1RJmh_OqeA | 40 | Hard |
| 10 | REST API | Build a full CRUD REST API with Flask and SQLite | https://youtu.be/qbLc5a9LAfE | 40 | Hard |
| 11 | Mini Project | Build a student management system with a Flask backend | https://youtu.be/dam0GPOAvVI | 50 | Hard |
| 12 | Final Project | Deploy a complete Flask application to Render with a live database | https://youtu.be/6plVs_ytIH8 | 100 | Expert |

**6-Month Track — Additional Weeks 13–24:**

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Advanced Python | Implement decorators, generators, and context managers | 40 | Hard |
| 14 | Data Analysis | Pandas + NumPy project: analyse a real-world dataset | 45 | Hard |
| 15 | Visualisation | Build a Matplotlib + Seaborn dashboard with 6 chart types | 45 | Hard |
| 16 | ML Intro | Train and evaluate a classification model using Scikit-learn | 50 | Expert |
| 17 | Async Python | Build an asynchronous web scraper using asyncio | 50 | Expert |
| 18 | Testing | Write complete unit tests for a previous project | 45 | Hard |
| 19 | Docker | Containerise your Flask application using Docker | 55 | Expert |
| 20 | CI/CD | Set up a GitHub Actions pipeline with auto-deploy | 55 | Expert |
| 21 | Advanced API | Build a production-grade REST API with auth and rate limiting | 60 | Expert |
| 22 | System Design | Design a scalable Python backend architecture (document + diagram) | 60 | Expert |
| 23 | Capstone Planning | Plan, scaffold, and document the final capstone project | 50 | Expert |
| 24 | Final Capstone | Complete and deploy a production-ready Python application | 200 | Expert |

---

### DOMAIN 2: Java Developer

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Java Basics | Write 10 programs: variables, operators, input/output | https://youtu.be/eIrMbAQSU34 | 20 | Easy |
| 2 | Control Flow | Build a calculator using switch statements and loops | https://youtu.be/GoXwIVyNvX0 | 20 | Easy |
| 3 | OOP | Design a bank account system using classes, constructors, inheritance | https://youtu.be/IttZfFoMnAI | 25 | Easy |
| 4 | Collections | Build an inventory management system using ArrayList and HashMap | https://youtu.be/GdAon80-0KA | 25 | Medium |
| 5 | File Handling | Student record system with file I/O and exception handling | https://youtu.be/ScUJx4aWRi0 | 30 | Medium |
| 6 | JDBC | Connect Java to MySQL. Build a full CRUD console app | https://youtu.be/7v2onIHi9gQ | 35 | Medium |
| 7 | Mini Project 1 | Console-based library management system | https://youtu.be/SdrAlFRQlhM | 40 | Hard |
| 8 | Spring Boot | Build your first Spring Boot REST API with two endpoints | https://youtu.be/9SGDpanrc8U | 40 | Hard |
| 9 | Spring CRUD | Full CRUD operations with Spring Boot + MySQL | https://youtu.be/5rNk7m_zlAg | 45 | Hard |
| 10 | Auth + Testing | Add JWT authentication, test all endpoints in Postman | https://youtu.be/X80nJ5T7YpE | 45 | Hard |
| 11 | Mini Project 2 | Employee management REST API | https://youtu.be/8SGI_XS5OPw | 50 | Hard |
| 12 | Final Project | Complete backend system with documentation and deployment | https://youtu.be/abb8EsfHpxE | 100 | Expert |

---

### DOMAIN 3: DevOps

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Linux Basics | Complete 20 command-line exercises covering navigation, permissions, processes | https://youtu.be/ROjZy1WbCIA | 20 | Easy |
| 2 | Shell Scripting | Write 5 automation scripts for real tasks (backup, user creation, etc.) | https://youtu.be/tK9Oc6AEnR4 | 25 | Easy |
| 3 | Git & GitHub | Create a project repository, branch strategy, PR workflow documentation | https://youtu.be/RGOj5yH7evk | 25 | Easy |
| 4 | Mini Project 1 | Auto-deploy script using Shell and Git hooks | https://youtu.be/hwP7WQkmECE | 35 | Medium |
| 5 | CI/CD Concepts | Install Jenkins, configure a basic job for a sample app | https://youtu.be/6YZvp2GwT0A | 30 | Medium |
| 6 | CI/CD Pipeline | Create a full CI pipeline that builds, tests, and packages an app | https://youtu.be/nCKkHvU-Z_g | 35 | Medium |
| 7 | Docker | Build and run containers, write a Dockerfile for a web app | https://youtu.be/fqMOX6JJhGo | 40 | Hard |
| 8 | Mini Project 2 | Containerise an application and deploy with Docker Compose | https://youtu.be/Qw9zlE3t8Ko | 45 | Hard |
| 9 | AWS Basics | Launch EC2, host static site on S3, configure IAM | https://youtu.be/ulprqHHWlng | 45 | Hard |
| 10 | Kubernetes | Deploy pods, services, and deployments on Minikube | https://youtu.be/s_o8dwzRlu4 | 50 | Expert |
| 11 | Terraform | Write IaC to provision an EC2 instance and S3 bucket | https://youtu.be/SLB_c_ayRMo | 50 | Expert |
| 12 | Final Project | Complete end-to-end CI/CD pipeline: Docker + Kubernetes + AWS + monitoring | https://youtu.be/7XDeI5fyj3c | 100 | Expert |

---

### DOMAIN 4: Web Development

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | HTML Foundations | Build the full structure of a personal portfolio site in HTML | https://youtu.be/UB1O30fR-EE | 20 | Easy |
| 2 | CSS Styling | Style the portfolio using Flexbox, Grid, and custom properties | https://youtu.be/1Rs2ND1ryYc | 20 | Easy |
| 3 | JavaScript Basics | Add 5 interactive features to the portfolio | https://youtu.be/PkZNo7MFNFg | 25 | Easy |
| 4 | DOM + Events | Build a dynamic to-do list with localStorage persistence | https://youtu.be/y17RuWkWdn8 | 25 | Medium |
| 5 | Responsive Design | Make the portfolio pixel-perfect on all screen sizes | https://youtu.be/srvUrASNj0s | 30 | Medium |
| 6 | Deployment | Deploy portfolio to GitHub Pages with a custom domain | https://youtu.be/RGOj5yH7evk | 30 | Medium |
| 7 | React Basics | Build a React component library with 8 reusable components | https://youtu.be/SqcY0GlETPk | 35 | Medium |
| 8 | React Hooks | Build a weather app using useState, useEffect, and custom hooks | https://youtu.be/O6P86uwfdR0 | 35 | Hard |
| 9 | React Router | Build a multi-page React app with protected routes | https://youtu.be/Law7wfdg_ls | 40 | Hard |
| 10 | API Integration | Connect your React app to a public REST API | https://youtu.be/T3Px88x_PsA | 40 | Hard |
| 11 | Mini Project | Full-featured React web app with routing, state, and API | https://youtu.be/a_7Z7C_JCyo | 50 | Hard |
| 12 | Final Project | Deploy a complete web application to Vercel | https://youtu.be/sauV-3_Nn60 | 100 | Expert |

---

### DOMAIN 5: MERN Stack

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | MongoDB | Set up Atlas, create collections, perform CRUD operations | https://youtu.be/ofme2o29ngU | 20 | Easy |
| 2 | Express.js | Build a basic REST API with 4 routes using Express | https://youtu.be/L72fhGm1tfE | 25 | Easy |
| 3 | React Foundations | Build 8 reusable components with props and state | https://youtu.be/SqcY0GlETPk | 25 | Easy |
| 4 | Backend API | Full CRUD Node/Express API connected to MongoDB Atlas | https://youtu.be/7CqJlxBYj-M | 30 | Medium |
| 5 | Full Stack Connect | Connect React frontend to Express backend via Axios | https://youtu.be/mrHNSanmqQ4 | 30 | Medium |
| 6 | Authentication | JWT auth with register, login, and protected routes | https://youtu.be/mbsmsi7l3r4 | 35 | Medium |
| 7 | State Management | Implement Redux Toolkit or Context API for global state | https://youtu.be/CVpUuw9XSjY | 35 | Hard |
| 8 | File Uploads | Image upload with Multer on backend, S3 storage | https://youtu.be/NZElg91l_ms | 40 | Hard |
| 9 | Real-time Features | Add Socket.io for live notifications or chat | https://youtu.be/ZKEqqIO7n-k | 45 | Hard |
| 10 | Testing | Jest + React Testing Library: write tests for components and APIs | https://youtu.be/8Xwq35cPwYg | 45 | Hard |
| 11 | Mini Project | Full-stack blog platform with auth, posts, comments | https://youtu.be/7CqJlxBYj-M | 55 | Hard |
| 12 | Final Project | Deploy complete MERN app to Vercel (frontend) + Railway (backend) | https://youtu.be/abb8EsfHpxE | 100 | Expert |

---

### DOMAIN 6: Data Science

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Python for DS | NumPy array operations + Pandas DataFrame exercises (30 tasks) | https://youtu.be/LHBE6Q9XlzI | 20 | Easy |
| 2 | Data Cleaning | Download a messy Kaggle dataset and clean it completely | https://youtu.be/vmEHCJofslg | 25 | Easy |
| 3 | EDA | Exploratory analysis: produce 10 visualisations with insights | https://youtu.be/xi0vhXFPegw | 25 | Medium |
| 4 | Visualisation | Build a data dashboard with 6 different chart types | https://youtu.be/UO98lJQ3QGI | 30 | Medium |
| 5 | Statistics | Apply descriptive + inferential statistics to a real dataset | https://youtu.be/xxpc-HPKN28 | 30 | Medium |
| 6 | ML Fundamentals | Train and evaluate a linear regression model | https://youtu.be/NUXdtN1W1FE | 35 | Medium |
| 7 | Classification | Build a decision tree and SVM classifier, compare accuracy | https://youtu.be/0Lt9w-BxKFQ | 35 | Hard |
| 8 | Model Evaluation | Apply cross-validation, confusion matrix, ROC curve analysis | https://youtu.be/85dtiMz9tSo | 40 | Hard |
| 9 | Feature Engineering | Feature selection and dimensionality reduction techniques | https://youtu.be/kA4mD3y4aqA | 40 | Hard |
| 10 | NLP Basics | Sentiment analysis on a real Twitter/Reddit dataset | https://youtu.be/X2vAabgKiuM | 45 | Hard |
| 11 | Mini Project | End-to-end ML pipeline on a Kaggle competition dataset | https://youtu.be/i_LwzRVP7bg | 55 | Expert |
| 12 | Final Project | Data science report + model deployed as a Streamlit app | https://youtu.be/VqgUkExPvLY | 100 | Expert |

---

### DOMAIN 7: Cyber Security

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Security Fundamentals | Write a detailed report on CIA Triad, common attack types, threat vectors | https://youtu.be/inWWhr5tnEA | 20 | Easy |
| 2 | Networking | TCP/IP, DNS, HTTP/HTTPS analysis using Wireshark | https://youtu.be/qiQR5rTSshw | 25 | Easy |
| 3 | Linux for Security | Kali Linux setup, basic commands, network scanning exercises | https://youtu.be/lZAoFs75_cs | 25 | Medium |
| 4 | OWASP Top 10 | Research, document, and demonstrate each of the 10 vulnerabilities | https://youtu.be/2Fu0TzE_-GY | 30 | Medium |
| 5 | Web App Security | Find and document vulnerabilities in DVWA (legal practice lab) | https://youtu.be/WjMvSMFMHmg | 35 | Medium |
| 6 | Cryptography | Implement AES encryption and RSA key exchange in Python | https://youtu.be/AQDCe585Lnc | 35 | Hard |
| 7 | Ethical Hacking | Nmap reconnaissance + vulnerability assessment on a practice lab | https://youtu.be/3Kq1MIfTWCE | 40 | Hard |
| 8 | Social Engineering | Phishing email analysis + defensive countermeasures documentation | https://youtu.be/PWVN3Rq4gzw | 40 | Hard |
| 9 | Malware Analysis | Static malware analysis on sandboxed samples | https://youtu.be/LH93xBGmwMY | 45 | Hard |
| 10 | Incident Response | Create a complete incident response plan for a fictional company | https://youtu.be/KgCVC9MhoC4 | 45 | Expert |
| 11 | CTF Challenge | Complete a beginner CTF on TryHackMe — submit flag + write-up | https://youtu.be/ul_3NxBZu6I | 55 | Expert |
| 12 | Final Project | Full penetration testing report on an authorised practice target | https://youtu.be/fNzpcB7ODxQ | 100 | Expert |

---

### DOMAIN 8: Flutter Development

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Flutter Setup | Install Flutter, run first app, document the widget tree | https://youtu.be/1ukSR1GRtMU | 20 | Easy |
| 2 | Widgets | Build 10 UI screens using fundamental Flutter widgets | https://youtu.be/TSIhiZ5jRB0 | 25 | Easy |
| 3 | Layouts | Build 5 responsive layouts using Row, Column, Stack, Expanded | https://youtu.be/o8rnd4kB0b8 | 25 | Easy |
| 4 | Navigation | Multi-screen app with named routes and data passing | https://youtu.be/nyvwx7o277U | 30 | Medium |
| 5 | State Management | Build a shopping cart app using Provider | https://youtu.be/L_QMsE2v6dw | 30 | Medium |
| 6 | API Integration | Connect a Flutter app to a public REST API | https://youtu.be/BGTx6maW9dg | 35 | Medium |
| 7 | Firebase | Firebase Auth + Firestore in Flutter: build a note-taking app | https://youtu.be/sfA3NWDBPZ4 | 40 | Hard |
| 8 | Animations | Add page transitions, micro-animations, and Hero animations | https://youtu.be/OtrWXLfGtqE | 40 | Hard |
| 9 | Local Storage | SharedPreferences + SQLite: persistent offline app | https://youtu.be/UpKrhZ0Hppks | 40 | Hard |
| 10 | Push Notifications | Firebase push notifications with background + foreground handling | https://youtu.be/Lq9-DPKWtIc | 45 | Hard |
| 11 | Mini Project | Full Flutter app with auth, API integration, and local database | https://youtu.be/VPvVD8t02U8 | 55 | Expert |
| 12 | Final Project | Publish to Play Store (or TestFlight for iOS) | https://youtu.be/g-0B_Vfc9qM | 100 | Expert |

---

### DOMAIN 9: Software Engineering

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | SE Fundamentals | Write a report on SDLC, Agile, Scrum, and Kanban with a comparison | https://youtu.be/O753uuutqH8 | 20 | Easy |
| 2 | Requirements | Write a full SRS document for a sample application | https://youtu.be/yi5duDg4gpI | 25 | Easy |
| 3 | System Design | Design a URL shortener: architecture diagram + component explanation | https://youtu.be/M4lR_Va97cQ | 25 | Medium |
| 4 | Design Patterns | Implement Singleton, Factory, Observer, Strategy, and Decorator patterns | https://youtu.be/tv-_1er1mWI | 30 | Medium |
| 5 | Clean Code | Refactor a messy codebase following Uncle Bob's clean code principles | https://youtu.be/7EmboKQH8lM | 30 | Medium |
| 6 | Version Control | Advanced Git: branching strategy, code review guide, PR template | https://youtu.be/RGOj5yH7evk | 30 | Medium |
| 7 | Testing | TDD practice: write tests before implementing each feature | https://youtu.be/r9HdJ8P6GQI | 35 | Hard |
| 8 | Database Design | Create ER diagrams and fully normalised schema for a social app | https://youtu.be/ztHopE5Wnpc | 35 | Hard |
| 9 | API Design | RESTful principles + OpenAPI/Swagger specification for an app | https://youtu.be/GZvSYJDk-us | 40 | Hard |
| 10 | DevOps Integration | Set up CI/CD for a software project + monitoring basics | https://youtu.be/nCKkHvU-Z_g | 40 | Hard |
| 11 | Mini Project | Full SE lifecycle: SRS → design → code → tests → documentation | https://youtu.be/a_7Z7C_JCyo | 55 | Expert |
| 12 | Final Project | Working product with complete professional documentation | https://youtu.be/abb8EsfHpxE | 100 | Expert |

---

### DOMAIN 10: Business Analyst

**(Source: TEN Business Analyst PDF — use that document as the primary source of truth for task descriptions)**

Add video links per module:

| Weeks | Module | Video URL | Coins |
|---|---|---|---|
| 1–2 | TEN Business Model + Stakeholder Analysis | https://youtu.be/QoAOzMTLP5s | 20–25 |
| 3–4 | Market Research + Competitor Analysis | https://youtu.be/Ib_8WG9T0Kk | 25–30 |
| 5–6 | Data Collection + Excel Analysis | https://youtu.be/vmEHCJofslg | 30–35 |
| 7–8 | Dashboard Creation + Problem Identification | https://youtu.be/yZvFH7B6gKk | 35–40 |
| 9–10 | Revenue Analysis + Financial Modelling | https://youtu.be/YHk2q4D_rlA | 40–45 |
| 11–12 | Business Improvement Strategy + Final Presentation | https://youtu.be/IP0cUBWTgpY | 50–100 |

---

### DOMAIN 11: Venture Capital

**(Source: TEN Venture Capital PDF — use that document as the primary source of truth)**

Add video links per module:

| Weeks | Module | Video URL | Coins |
|---|---|---|---|
| 1–2 | VC Fundamentals + Startup Lifecycle | https://youtu.be/gRaXB5hNuX4 | 20–25 |
| 3–4 | Business Models + Market Sizing | https://youtu.be/QoAOzMTLP5s | 25–30 |
| 5–6 | Deal Sourcing + Competitive Analysis | https://youtu.be/bCGkSFwbFXc | 30–35 |
| 7–8 | Valuation Methods + Due Diligence | https://youtu.be/ZCFkWDdmXG8 | 35–40 |
| 9–10 | Term Sheets + Portfolio Strategy | https://youtu.be/Jc0s3G99HcM | 40–45 |
| 11–12 | Exit Strategies + Investment Committee Simulation | https://youtu.be/0R6GVTJEsKo | 50–100 |

---

### DOMAIN 12: Space Research

**(Source: Both TEN Space Research PDFs — use those as primary source of truth)**

Add video links per module:

| Weeks | Module | Video URL | Coins |
|---|---|---|---|
| 1–2 | Space History + Solar System | https://youtu.be/libKVRa01L8 | 20–25 |
| 3–4 | Orbital Mechanics + Spacecraft Systems | https://youtu.be/0rHUDWjR5gg | 25–30 |
| 5–6 | Remote Sensing + Satellite Data | https://youtu.be/xNGrSup6YsU | 30–35 |
| 7–8 | Astrophysics + Mission Planning | https://youtu.be/CMt6jTPdj1s | 35–40 |
| 9–10 | Space Robotics + Planetary Science | https://youtu.be/_w2YBWM0lEM | 40–45 |
| 11–12 | Research Proposal Writing + Capstone | https://youtu.be/RVMZxH1TIIQ | 50–100 |

---

### DOMAIN 13: Vibe Coding

**(Source: TEN Vibe Coding PDF — use that document as the primary source of truth)**

Add video links per module:

| Weeks | Module | Video URL | Coins |
|---|---|---|---|
| 1–2 | Vibe Coding Intro + AI Coding Assistants | https://youtu.be/gd_ydCWKMpE | 20–25 |
| 3–4 | UI/UX Basics + No-Code Tools | https://youtu.be/gVv3cxfQO4c | 25–30 |
| 5–6 | APIs + Automation Scripts | https://youtu.be/DZXGMTnHWwc | 30–35 |
| 7–8 | AI-Powered Web Apps | https://youtu.be/5CIlXnhWMBw | 35–40 |
| 9–12 | MVP Building + Deployment + Capstone | https://youtu.be/sauV-3_Nn60 | 40–100 |

---

### DOMAIN 14: HR Development

**(Created from knowledge — no source PDF exists. Use tasks below exactly.)**

**3-Month Track (12 Weeks):**

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | HR Fundamentals | Write a report on the 6 core HR functions and how they interact | https://youtu.be/gEv5pSCJMCQ | 20 | Easy |
| 2 | Recruitment Process | Design a complete end-to-end recruitment workflow diagram | https://youtu.be/PKVm0znLOoQ | 25 | Easy |
| 3 | Job Descriptions | Write 3 detailed JDs for roles: Developer, Designer, and Marketing | https://youtu.be/JpBCUCxiGZ4 | 25 | Easy |
| 4 | Interviewing | Create a structured interview scorecard + 20 HR questions for a tech role | https://youtu.be/KJ15_bX6SBc | 30 | Medium |
| 5 | Onboarding | Design a 30-day onboarding plan for a new software engineer hire | https://youtu.be/b_3AvnUHFBI | 30 | Medium |
| 6 | Employee Engagement | Create a 15-question engagement survey + analyse fictional results | https://youtu.be/c4NtKH9KbdA | 30 | Medium |
| 7 | Performance Management | Design a quarterly performance review framework with rating rubric | https://youtu.be/7W8Yl7JCQWE | 35 | Hard |
| 8 | HR Analytics | Analyse a dataset: calculate attrition rate, average tenure, headcount trend | https://youtu.be/yZvFH7B6gKk | 35 | Hard |
| 9 | Labour Law | Summarise 5 key Indian labour laws with practical implications | https://youtu.be/N7oJpZjFCkY | 40 | Hard |
| 10 | Training & Development | Design a 4-week training program for a specific role in a startup | https://youtu.be/9G5mS_OKT0A | 40 | Hard |
| 11 | Policy Writing | Write a complete HR policy document: leave policy + code of conduct | https://youtu.be/8_Zrt4ozmGM | 45 | Hard |
| 12 | Final Project | Compile a complete HR Operations Manual for a fictional 20-person startup | https://youtu.be/gEv5pSCJMCQ | 100 | Expert |

---

## ⚙️ SECTION 10: DURATION LOGIC ENGINE

```javascript
// config/duration.js — NEW FEATURE: Duration Logic Engine

const DURATION_CONFIG = {
  '45days': {
    total_weeks: 6,
    display_name: '45 Days',
    condensing_rule: 'Combine every 2 standard weeks into 1. Broader coverage, less depth.',
    difficulty_modifier: 1.2, // tasks slightly harder due to faster pace
    coin_modifier: 1.1,       // slightly more coins to reward the challenge
    psychology_timeline: {
      expert_cert_day: 10,
      nano_cert_day: 30,
      fellowship_day: 40
    }
  },
  '1month': {
    total_weeks: 4,
    display_name: '1 Month',
    condensing_rule: 'Cover foundational topics only. Sprint pace. Skip advanced weeks.',
    difficulty_modifier: 1.0,
    coin_modifier: 1.0,
    psychology_timeline: {
      expert_cert_day: 7,
      nano_cert_day: 22,
      fellowship_day: 27
    }
  },
  '3months': {
    total_weeks: 12,
    display_name: '3 Months',
    condensing_rule: 'Standard track. Use task descriptions exactly as specified.',
    difficulty_modifier: 1.0,
    coin_modifier: 1.0,
    psychology_timeline: {
      expert_cert_week: 6,
      nano_cert_month: 2,
      fellowship_week: 10
    }
  },
  '6months': {
    total_weeks: 24,
    display_name: '6 Months',
    condensing_rule: 'Weeks 1-12 same as 3-month. Weeks 13-24 are advanced extension.',
    difficulty_modifier: 1.5,
    coin_modifier: 1.3,
    psychology_timeline: {
      expert_cert_month: 2,
      nano_cert_month: 4,
      fellowship_month: 5
    }
  }
}

module.exports = DURATION_CONFIG
```

**Task Assignment Rule:**
When student selects domain + duration → query `domain_tasks` where domain = X AND duration_type = Y → create `student_task_progress` entries for all results → set Week 1 tasks to `available`, all others to `locked`.

**Difficulty Label Escalation:**
As weeks progress within any tenure, difficulty labels must escalate. Never show "Easy" tasks in the final quarter of any tenure.

---

## 💳 SECTION 11: PAYMENT SYSTEM SKELETON

> **STATUS: INACTIVE. Build completely. Activate with one environment variable.**

**Environment Configuration:**
```bash
# .env
PAYMENT_ENABLED=false
RAZORPAY_KEY_ID=your_key_here
RAZORPAY_KEY_SECRET=your_secret_here
UPI_ID=8595986120@ptyes
CERT_PRICE_EXPERT=100
CERT_PRICE_NANO=1000
CERT_PRICE_FELLOWSHIP=2500
```

**Payment Wrapper — Use This Pattern Everywhere:**
```javascript
// utils/payment.js — NEW FEATURE: Payment System Skeleton

const config = require('./config')
const Razorpay = require('razorpay')

async function initiateCertificatePayment(studentId, certType) {
  if (!config.PAYMENT_ENABLED) {
    return {
      status: 'payment_disabled',
      message: 'Payment integration coming soon. You will be notified.'
    }
  }

  const razorpay = new Razorpay({
    key_id: config.RAZORPAY_KEY_ID,
    key_secret: config.RAZORPAY_KEY_SECRET
  })

  const amount = config.CERT_PRICES[certType] * 100 // Razorpay uses paise

  const order = await razorpay.orders.create({
    amount,
    currency: 'INR',
    receipt: `cert_${studentId}_${certType}_${Date.now()}`,
    notes: { studentId, certType }
  })

  return { status: 'order_created', order }
}

// Webhook handler — build complete, runs only when PAYMENT_ENABLED=true
async function handlePaymentWebhook(req, res) {
  if (!config.PAYMENT_ENABLED) return res.status(200).send('OK')
  // Full webhook verification and certificate trigger logic here
}
```

**Install required:** `npm install razorpay`

---

## 🔔 SECTION 12: NOTIFICATION SYSTEM

| Event | In-App | Email | Push |
|---|---|---|---|
| Task approved by coordinator | ✅ | ✅ | — |
| Coins earned | ✅ | — | — |
| Certificate unlocked (trigger fires) | ✅ | ✅ | ✅ |
| Offer letter sent | ✅ | ✅ | — |
| Document approved by HR | ✅ | ✅ | — |
| Document rejected | ✅ | ✅ | ✅ |
| New week task unlocked | ✅ | — | ✅ |
| Streak at risk (if no login by 10:30 PM) | — | — | ✅ |
| Leaderboard rank changed (entered top 10) | ✅ | — | — |
| Coordinator review overdue (to coordinator) | — | ✅ | ✅ |
| Psychology social proof (cohort cert earned) | ✅ | — | — |
| Referral friend registered | ✅ | — | — |

---

## 📐 SECTION 13: PERFORMANCE CALCULATION

**Student Performance Score:**
```
Score =
  (Tasks completed on time ÷ Total tasks due) × 35
+ (Cohort coin rank percentile) × 25
+ (Days active ÷ Total days enrolled) × 20
+ (Average video watch completion %) × 10
+ (Coordinator rating given to student average) × 10

Result: 0–100 score
```

**Performance Labels:**
| Score | Label | Action |
|---|---|---|
| 90–100% | Exceptional | Eligible for Fellowship consideration |
| 75–89% | High Performer | — |
| 60–74% | On Track | — |
| 40–59% | Needs Attention | Coordinator receives soft alert |
| Below 40% | At Risk | Coordinator receives urgent alert + admin notified |

---

## 🛡️ SECTION 14: EDGE CASES & ERROR HANDLING

Every edge case below must be handled gracefully. No unhandled errors. No white screens.

| Scenario | Expected Behaviour |
|---|---|
| Student uploads wrong file type | Clear error: "Please upload JPG, PNG or PDF only" |
| Student uploads file over 5MB | Error: "File too large. Maximum 5MB allowed" |
| Student uploads only one document and submits | Block: "Both documents are required" |
| Coordinator doesn't review in 48 hours | Auto-deduct coins, auto-notify admin |
| Payment fails (when enabled) | Never issue cert. Show retry screen. Log failure. |
| Certificate PDF generation fails | Queue retry. Notify student: "Your cert is being generated — you'll receive it within 1 hour" |
| Student tries to access Fellowship without qualifying | Redirect silently to dashboard. No error. No explanation. Exclusivity preserved. |
| Duplicate referral (same email referred twice) | Silently ignore. No coins. No error shown. |
| Student tries to change domain after task 1 approved | Block with message: "Domain can only be changed before your first task is approved" |
| Video API tracking fails | Soft block with message: "Watch the video first" + Skip option (skip tracked) |
| Leaderboard tie | Sort by: tasks completed → join date (earliest first) |
| Coordinator assigned more than 30 students | Alert admin. Suggest reassignment. Show warning on coordinator dashboard. |
| Student's cohort has fewer than 10 members | Fellowship eligibility threshold adjusts to top 1 student only |
| Email delivery fails | Log failure. Retry 3 times. Alert admin after 3rd failure. |
| S3 upload fails | Retry once. If fails again: show error. Store file locally as fallback. Alert admin. |
| Redis cache down | Fallback to direct PostgreSQL queries. Log the outage. |

---

## 📚 SECTION 15: 6-MONTH EXTENSION TASKS — DOMAINS 2 TO 14

> **Rule:** Weeks 1–12 for 6-month students are IDENTICAL to the 3-month track.
> Only weeks 13–24 are unique to 6-month students. Build them below.

---

### DOMAIN 2: Java Developer — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Advanced OOP | Implement advanced patterns: Abstract Factory, Builder, Composite | 40 | Hard |
| 14 | Multithreading | Build a thread-safe bank account simulator | 45 | Hard |
| 15 | Microservices Intro | Split a monolith into 2 Spring Boot microservices | 50 | Expert |
| 16 | Kafka Basics | Implement async messaging between two services using Kafka | 50 | Expert |
| 17 | Unit Testing | JUnit 5 + Mockito: full test coverage for a Spring Boot service | 45 | Hard |
| 18 | Security | Spring Security: OAuth2 + JWT in a full application | 55 | Expert |
| 19 | Docker | Containerise the Spring Boot app + MySQL with Docker Compose | 55 | Expert |
| 20 | Kubernetes | Deploy the containerised app to a local Kubernetes cluster | 60 | Expert |
| 21 | CI/CD | GitHub Actions pipeline: build, test, deploy Java app | 60 | Expert |
| 22 | Performance | Identify and fix N+1 query problems, add caching with Redis | 60 | Expert |
| 23 | System Design | Design a high-level architecture for a Twitter-like backend | 55 | Expert |
| 24 | Final Capstone | Complete production-grade Java backend with full documentation | 200 | Expert |

---

### DOMAIN 3: DevOps — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Advanced Networking | Set up VPC, subnets, NAT gateway on AWS | 45 | Hard |
| 14 | Monitoring | Set up Prometheus + Grafana for a running application | 50 | Expert |
| 15 | Logging | Centralised logging with ELK Stack (Elasticsearch, Logstash, Kibana) | 50 | Expert |
| 16 | Security in DevOps | Implement SAST scanning in the CI/CD pipeline | 50 | Expert |
| 17 | Advanced Kubernetes | Helm charts, ConfigMaps, Secrets, HPA autoscaling | 55 | Expert |
| 18 | Service Mesh | Implement Istio on a Kubernetes cluster | 60 | Expert |
| 19 | Ansible | Write Ansible playbooks to provision and configure servers | 55 | Expert |
| 20 | Cost Optimisation | Analyse AWS costs and implement rightsizing recommendations | 50 | Expert |
| 21 | GitOps | Implement ArgoCD for GitOps-based deployments | 60 | Expert |
| 22 | Disaster Recovery | Design and test a disaster recovery plan for a cloud app | 60 | Expert |
| 23 | Capstone Planning | Plan a full end-to-end DevOps pipeline for a real app | 55 | Expert |
| 24 | Final Capstone | Complete DevOps pipeline: code → build → test → deploy → monitor | 200 | Expert |

---

### DOMAIN 4: Web Development — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | TypeScript | Rewrite a previous React project in TypeScript | 40 | Hard |
| 14 | Next.js | Build a full SSR blog with Next.js App Router | 45 | Hard |
| 15 | State Management | Zustand or Redux Toolkit for complex app state | 50 | Expert |
| 16 | Performance | Lighthouse audit + fix: lazy loading, code splitting, caching | 50 | Expert |
| 17 | Testing | Playwright E2E tests for the full web application | 50 | Expert |
| 18 | Accessibility | WCAG 2.1 audit + fix all accessibility issues | 45 | Hard |
| 19 | Web Security | Implement CSP, CORS, XSS prevention on an app | 55 | Expert |
| 20 | PWA | Convert an app to a Progressive Web App with offline support | 55 | Expert |
| 21 | Web3 Basics | Build a wallet connect page using Ethers.js (introductory) | 60 | Expert |
| 22 | Animation | Advanced Framer Motion: page transitions + scroll animations | 50 | Hard |
| 23 | Capstone Planning | Plan and scaffold a production-quality web app | 50 | Expert |
| 24 | Final Capstone | Complete and deploy a full production web application | 200 | Expert |

---

### DOMAIN 5: MERN Stack — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | TypeScript MERN | Add TypeScript to both frontend and backend | 40 | Hard |
| 14 | GraphQL | Replace REST API with GraphQL using Apollo | 50 | Expert |
| 15 | Microservices | Split the MERN app into two separate backend services | 50 | Expert |
| 16 | Redis Caching | Add Redis caching layer to the Express API | 50 | Expert |
| 17 | WebSockets | Full real-time chat application using Socket.io | 55 | Expert |
| 18 | Testing | Supertest for API + Jest for React components | 50 | Expert |
| 19 | Docker | Dockerise full MERN stack with docker-compose | 55 | Expert |
| 20 | CI/CD | GitHub Actions: test + build + deploy MERN app | 55 | Expert |
| 21 | Rate Limiting | Add rate limiting, helmet, and security headers | 50 | Hard |
| 22 | Search | Implement full-text search using MongoDB Atlas Search | 55 | Expert |
| 23 | Capstone Planning | Plan and document a full-stack SaaS product | 55 | Expert |
| 24 | Final Capstone | Complete production MERN SaaS application deployed | 200 | Expert |

---

### DOMAIN 6: Data Science — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Deep Learning Intro | Build a neural network with TensorFlow/Keras | 50 | Expert |
| 14 | Computer Vision | Image classification using CNN on CIFAR-10 | 55 | Expert |
| 15 | Time Series | Forecast stock prices using LSTM | 55 | Expert |
| 16 | Recommendation Systems | Build a movie recommendation engine | 55 | Expert |
| 17 | MLOps Basics | MLflow: track experiments, version models | 55 | Expert |
| 18 | Model Deployment | Deploy ML model as a REST API using FastAPI | 60 | Expert |
| 19 | Big Data Intro | PySpark: process a dataset too large for Pandas | 60 | Expert |
| 20 | AutoML | Compare AutoML tools: H2O, AutoSklearn on a dataset | 55 | Expert |
| 21 | Explainable AI | SHAP values: explain model predictions | 55 | Expert |
| 22 | Data Pipeline | Build an end-to-end ETL pipeline with Airflow | 60 | Expert |
| 23 | Capstone Planning | Plan a full data science product from data to deployment | 55 | Expert |
| 24 | Final Capstone | Complete DS project: data → model → API → dashboard | 200 | Expert |

---

### DOMAIN 7: Cyber Security — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Advanced Pentesting | Metasploit framework on a practice lab | 50 | Expert |
| 14 | Buffer Overflow | Exploit a buffer overflow on a sandboxed binary | 55 | Expert |
| 15 | Reverse Engineering | Basic binary reverse engineering with Ghidra | 55 | Expert |
| 16 | Web App Pentesting | Full OWASP test on DVWA — document all findings | 55 | Expert |
| 17 | Cloud Security | Identify and fix misconfigurations in an AWS test account | 60 | Expert |
| 18 | Forensics Basics | Digital forensics: analyse a disk image for evidence | 60 | Expert |
| 19 | Red Team | Plan and execute a full red team exercise on a lab network | 65 | Expert |
| 20 | Blue Team | Build a detection rule in a SIEM for a specific attack | 60 | Expert |
| 21 | Zero Trust | Design a zero-trust architecture for a fictional company | 60 | Expert |
| 22 | Threat Intelligence | Write a threat intelligence report on a recent CVE | 55 | Expert |
| 23 | Capstone Planning | Plan a full penetration test engagement | 55 | Expert |
| 24 | Final Capstone | Complete penetration test report with remediation plan | 200 | Expert |

---

### DOMAIN 8: Flutter — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Advanced State | Riverpod: replace Provider with Riverpod in an existing app | 45 | Hard |
| 14 | Bloc Pattern | Implement BLoC for a complex feature | 50 | Expert |
| 15 | Platform Channels | Write a native channel to access device sensors | 55 | Expert |
| 16 | Custom Paint | Build custom charts using CustomPainter | 50 | Expert |
| 17 | Offline First | Offline-first app using Hive + sync on reconnect | 55 | Expert |
| 18 | Flutter Web | Adapt the mobile app to also run on web | 55 | Expert |
| 19 | Desktop | Build a Flutter desktop app for macOS or Windows | 60 | Expert |
| 20 | Performance | Profile and fix jank in a Flutter app using DevTools | 55 | Expert |
| 21 | Testing | Full widget and integration test suite for the app | 55 | Expert |
| 22 | CI/CD | Fastlane + GitHub Actions: auto-deploy to Play Store | 60 | Expert |
| 23 | Capstone Planning | Plan a full Flutter app for a real-world use case | 55 | Expert |
| 24 | Final Capstone | Complete Flutter app published to Play Store + web | 200 | Expert |

---

### DOMAIN 9: Software Engineering — Weeks 13–24

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 13 | Distributed Systems | Design a distributed cache system (document + diagram) | 50 | Expert |
| 14 | Message Queues | Implement a task queue using RabbitMQ or BullMQ | 55 | Expert |
| 15 | Event-Driven Design | Redesign a monolith feature as event-driven | 55 | Expert |
| 16 | API Gateway | Set up Kong or AWS API Gateway with rate limiting | 55 | Expert |
| 17 | Code Review Practice | Conduct 3 formal code reviews with written reports | 50 | Hard |
| 18 | Technical Debt | Identify and document technical debt in a codebase | 50 | Hard |
| 19 | Observability | Add structured logging + distributed tracing to an app | 60 | Expert |
| 20 | Chaos Engineering | Run chaos experiments using Chaos Monkey on a test system | 60 | Expert |
| 21 | SRE Basics | Define SLIs, SLOs, and error budgets for a service | 55 | Expert |
| 22 | Architecture Review | Full architecture review document for an existing system | 60 | Expert |
| 23 | Capstone Planning | Design architecture for a scalable SaaS product | 55 | Expert |
| 24 | Final Capstone | Complete system with architecture doc + working code + tests | 200 | Expert |

---

### DOMAINS 10–14 (Business Analyst, Venture Capital, Space Research, Vibe Coding, HR Development) — 6-Month Extensions

For these domains, weeks 13–24 follow this pattern:

**Weeks 13–16:** Deep dive into the most advanced topics introduced in weeks 9–12.
Build on the final project from Month 3. Add more complexity, more research, or more features.

**Weeks 17–20:** Cross-domain application.
Example: Business Analyst applies data science techniques to a real dataset.
Venture Capital models a real startup pitch end-to-end.
HR Development designs a full people operations system for a 100-person company.

**Weeks 21–23:** Capstone preparation.
Research, plan, scaffold, and document a final capstone project.

**Week 24:** Final Capstone.
A complete, professional-grade deliverable for their domain.
Coin reward: 200.
Difficulty: Expert.

> **AI Instruction for these 5 domains:** Generate specific week-by-week tasks following the pattern above. Use the PDF content as the foundation. Escalate complexity each week. Assign 50–60 coins per week for weeks 13–23. Assign 200 coins for week 24.

---

## 📋 SECTION 16: CONDENSED TASK TRACKS — 45-DAY AND 1-MONTH

> **Rule for 45-day track:** Combine every 2 standard weeks into 1 week. The student does the same work in half the time. Tasks are broader — cover both topics but at slightly less depth. Coins × 1.1.

> **Rule for 1-month track:** Cover only the first 4 weeks' worth of topics from the 3-month track. Sprint pace. Focus on fundamentals. Coins as standard.

> **AI Instruction:** For every domain, generate 45-day (6 weeks) and 1-month (4 weeks) task descriptions following these rules. Use the 3-month track as the source. Below are explicit examples for 4 domains. Apply the same pattern to the remaining 10 domains automatically.

---

### PYTHON — 45-Day Condensed Track (6 Weeks)

| Week | Topics Combined | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Basics + Control Flow | Write 15 programs covering syntax, loops, conditionals, functions | https://youtu.be/_uQrJ0TkZlc | 22 | Easy |
| 2 | Data Structures + File Handling | Build a contact manager with file persistence | https://youtu.be/W8KRzm-HUcc | 27 | Medium |
| 3 | OOP + Modules | Design a library system using classes and external modules | https://youtu.be/JeznW_7DlB0 | 33 | Medium |
| 4 | APIs + Database | Weather app using API + SQLite to-do backend | https://youtu.be/SqvVm3QiQVk | 38 | Hard |
| 5 | Flask + REST API | Build a full CRUD REST API with Flask and SQLite | https://youtu.be/Z1RJmh_OqeA | 44 | Hard |
| 6 | Mini + Final Project | Complete and deploy a Flask application to a live server | https://youtu.be/6plVs_ytIH8 | 110 | Expert |

### PYTHON — 1-Month Sprint Track (4 Weeks)

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Python Fundamentals | Master: variables, loops, functions — write 12 programs | https://youtu.be/_uQrJ0TkZlc | 25 | Easy |
| 2 | Data Structures + OOP | Contact book using dictionaries + a class-based system | https://youtu.be/W8KRzm-HUcc | 30 | Medium |
| 3 | APIs | Connect to a public API and display live data in the terminal | https://youtu.be/SqvVm3QiQVk | 35 | Medium |
| 4 | Final Mini Project | Documented Python project with README + GitHub repo | https://youtu.be/dam0GPOAvVI | 75 | Hard |

---

### JAVA — 45-Day Condensed Track (6 Weeks)

| Week | Topics Combined | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Basics + Control Flow | 12 programs: variables, calculator, switch | https://youtu.be/eIrMbAQSU34 | 22 | Easy |
| 2 | OOP + Collections | Bank account system + inventory with ArrayList | https://youtu.be/IttZfFoMnAI | 27 | Medium |
| 3 | File Handling + JDBC | Student records with file I/O + MySQL connection | https://youtu.be/7v2onIHi9gQ | 38 | Medium |
| 4 | Mini Project 1 + Spring Intro | Library system + first Spring Boot endpoint | https://youtu.be/9SGDpanrc8U | 44 | Hard |
| 5 | Spring CRUD + Auth | Full CRUD API with JWT authentication | https://youtu.be/5rNk7m_zlAg | 49 | Hard |
| 6 | Mini Project 2 + Final | Employee API + deployed backend | https://youtu.be/abb8EsfHpxE | 110 | Expert |

### JAVA — 1-Month Sprint Track (4 Weeks)

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | Java Basics + OOP | 10 programs + simple class-based bank system | https://youtu.be/eIrMbAQSU34 | 25 | Easy |
| 2 | Collections + File I/O | Inventory system + file-based record storage | https://youtu.be/GdAon80-0KA | 30 | Medium |
| 3 | Spring Boot Intro | REST API with 3 endpoints using Spring Boot | https://youtu.be/9SGDpanrc8U | 35 | Hard |
| 4 | Final Mini Project | Documented Java backend with GitHub repo | https://youtu.be/abb8EsfHpxE | 75 | Hard |

---

### WEB DEVELOPMENT — 45-Day Condensed Track (6 Weeks)

| Week | Topics Combined | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | HTML + CSS | Build and style a full personal portfolio | https://youtu.be/UB1O30fR-EE | 22 | Easy |
| 2 | JavaScript + DOM | Add 5 interactive features + to-do list | https://youtu.be/PkZNo7MFNFg | 27 | Medium |
| 3 | Responsive + Deploy | Make portfolio mobile-responsive + deploy to GitHub Pages | https://youtu.be/srvUrASNj0s | 33 | Medium |
| 4 | React Basics + Hooks | Component library + weather app with hooks | https://youtu.be/SqcY0GlETPk | 38 | Hard |
| 5 | React Router + API | Multi-page app connected to a live REST API | https://youtu.be/Law7wfdg_ls | 44 | Hard |
| 6 | Final Project | Deploy complete React web application to Vercel | https://youtu.be/sauV-3_Nn60 | 110 | Expert |

### WEB DEVELOPMENT — 1-Month Sprint Track (4 Weeks)

| Week | Topic | Task | Video URL | Coins | Difficulty |
|---|---|---|---|---|---|
| 1 | HTML + CSS | Build and style a personal portfolio site | https://youtu.be/UB1O30fR-EE | 25 | Easy |
| 2 | JavaScript + DOM | Dynamic to-do list with local state | https://youtu.be/PkZNo7MFNFg | 30 | Medium |
| 3 | React Basics | Build 6 components using useState and props | https://youtu.be/SqcY0GlETPk | 35 | Medium |
| 4 | Final Mini Project | React app deployed to Vercel with GitHub repo | https://youtu.be/sauV-3_Nn60 | 75 | Hard |

---

### DATA SCIENCE — 45-Day Condensed Track (6 Weeks)

| Week | Topics Combined | Task | Coins | Difficulty |
|---|---|---|---|---|
| 1 | Python for DS + Data Cleaning | NumPy/Pandas exercises + clean a Kaggle dataset | 27 | Easy |
| 2 | EDA + Visualisation | 10 visualisations + dashboard with 6 chart types | 33 | Medium |
| 3 | Statistics + ML Basics | Stats analysis + train a linear regression model | 38 | Medium |
| 4 | Classification + Evaluation | Decision tree model + confusion matrix + ROC curve | 44 | Hard |
| 5 | Feature Engineering + NLP | Feature selection + sentiment analysis on Twitter data | 49 | Hard |
| 6 | Final Project | ML pipeline + model deployed on Streamlit | 110 | Expert |

### DATA SCIENCE — 1-Month Sprint Track (4 Weeks)

| Week | Topic | Task | Coins | Difficulty |
|---|---|---|---|---|
| 1 | Python for DS | Pandas + NumPy: clean and explore a Kaggle dataset | 25 | Easy |
| 2 | Visualisation | 8 visualisations with insights on the same dataset | 30 | Medium |
| 3 | ML Basics | Train a linear regression model, evaluate with metrics | 35 | Medium |
| 4 | Final Project | End-to-end notebook: data → model → insights report | 75 | Hard |

---

> **AI Instruction for remaining 10 domains:** Apply the identical condensing and sprint logic shown above. For 45-day: combine pairs of standard weeks. For 1-month: use weeks 1–4 topics only. Add all results to the `domain_tasks` table with the correct `duration_type` value.

---

## 📱 SECTION 17: MOBILE APP SPECIFICATIONS (React Native + Expo)

The mobile app is NOT a trimmed version of the web app. It is a full product with the same features adapted for touch and small screens.

### Screens Required

**Auth Screens:**
- Splash screen (TEN logo + tagline, 2s then auto-navigate)
- Login screen (Google button + Email/Password form + "Forgot password" link)
- Register screen (same as login + name field)
- Domain + Duration selection screen (post-registration onboarding)

**Student Screens:**
- Home/Dashboard (coin balance, streak, leaderboard rank, progress arc, current task card)
- My Tasks (vertical list of weeks, tap to expand — same lock/unlock logic as web)
- Task Detail (video player, task description, submission button)
- Document Upload (two upload zones, status display)
- Certificates (3 tier cards — blurred/unlocked states, reveal animation)
- Leaderboard (tabs: Global / Domain / Cohort)
- Referral (unique link, share button, stats)
- Profile (name, domain, cohort, badges earned, coins history)
- Notifications (all in-app notifications listed)

**Coordinator Screens:**
- Dashboard (pending reviews count, coin balance, performance score)
- My Students (list of assigned students with progress %)
- Pending Reviews (task submission viewer, approve/reject with feedback)
- Performance (own score, history, leaderboard rank among coordinators)

### Mobile-Specific Behaviour

- **Video player:** Use `react-native-youtube-iframe` — same 80% watch tracking logic applies
- **File upload:** Use `expo-document-picker` for document upload — same S3 flow
- **Push notifications:** Firebase Cloud Messaging via `expo-notifications`
- **Coins animation:** Lottie animation file for coin drop effect
- **Offline mode:** Cache last-known task list and coin balance. Show "You're offline" banner. Block submission until reconnected.
- **Biometric login:** `expo-local-authentication` — offer fingerprint/Face ID after first login
- **Deep links:** `yourdomain.com/join?ref=[id]` must open the app if installed
- **Certificate reveal:** Same animation as web — Lottie or Animated API
- **Bottom tab navigator:** Home | Tasks | Certificates | Leaderboard | Profile

### Mobile Navigation Structure

```
Stack Navigator (root)
├── Auth Stack
│   ├── SplashScreen
│   ├── LoginScreen
│   ├── RegisterScreen
│   └── OnboardingScreen (domain + duration)
└── Main Tab Navigator
    ├── Tab: Home → HomeScreen
    ├── Tab: Tasks → TaskListScreen → TaskDetailScreen
    ├── Tab: Certificates → CertificatesScreen → CertRevealScreen
    ├── Tab: Leaderboard → LeaderboardScreen
    └── Tab: Profile → ProfileScreen → CoinsHistoryScreen
                                    → BadgesScreen
                                    → DocumentsScreen
                                    → ReferralScreen
                                    → NotificationsScreen
```

---

## 🗂️ SECTION 18: PROJECT FOLDER STRUCTURE

The AI must create this exact folder structure. No deviation.

```
ten-platform/
│
├── web/                          ← Next.js 14 web app
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── (student)/
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── tasks/page.tsx
│   │   │   ├── tasks/[taskId]/page.tsx
│   │   │   ├── documents/page.tsx
│   │   │   ├── certificates/page.tsx
│   │   │   ├── leaderboard/page.tsx
│   │   │   ├── referral/page.tsx
│   │   │   └── profile/page.tsx
│   │   ├── (coordinator)/
│   │   │   ├── coordinator/dashboard/page.tsx
│   │   │   ├── coordinator/students/page.tsx
│   │   │   ├── coordinator/reviews/page.tsx
│   │   │   └── coordinator/performance/page.tsx
│   │   ├── (admin)/
│   │   │   ├── admin/dashboard/page.tsx
│   │   │   └── admin/documents/page.tsx  ← NEW Generate Documents section
│   │   ├── verify/[certId]/page.tsx      ← Public cert verification page
│   │   └── layout.tsx
│   ├── components/
│   │   ├── student/
│   │   │   ├── TaskCard.tsx
│   │   │   ├── CoinCounter.tsx
│   │   │   ├── LeaderboardTable.tsx
│   │   │   ├── CertificateReveal.tsx
│   │   │   ├── PsychologyTrigger.tsx
│   │   │   ├── BadgeGrid.tsx
│   │   │   └── DocumentUpload.tsx
│   │   ├── coordinator/
│   │   │   ├── ReviewCard.tsx
│   │   │   └── CoordinatorStats.tsx
│   │   ├── admin/
│   │   │   ├── PendingDocumentsTable.tsx
│   │   │   └── BulkActionBar.tsx
│   │   └── shared/
│   │       ├── VideoPlayer.tsx
│   │       ├── ProgressArc.tsx
│   │       └── StreakBadge.tsx
│   └── lib/
│       ├── api.ts
│       ├── firebase.ts
│       └── psychology.ts
│
├── mobile/                       ← React Native Expo app
│   ├── src/
│   │   ├── screens/
│   │   │   ├── auth/
│   │   │   ├── student/
│   │   │   └── coordinator/
│   │   ├── components/
│   │   ├── navigation/
│   │   ├── hooks/
│   │   └── utils/
│   ├── assets/
│   │   └── animations/           ← Lottie JSON files
│   └── app.json
│
├── backend/                      ← Node.js + Express API
│   ├── src/
│   │   ├── routes/
│   │   │   ├── student.routes.js
│   │   │   ├── tasks.routes.js
│   │   │   ├── documents.routes.js
│   │   │   ├── certificates.routes.js
│   │   │   ├── coins.routes.js
│   │   │   ├── leaderboard.routes.js
│   │   │   ├── coordinator.routes.js
│   │   │   ├── admin.routes.js
│   │   │   └── referral.routes.js
│   │   ├── controllers/          ← One controller per route file
│   │   ├── services/
│   │   │   ├── certificate.service.js    ← Puppeteer PDF generation
│   │   │   ├── psychology.service.js     ← Trigger logic
│   │   │   ├── coins.service.js          ← Coin award/deduct logic
│   │   │   ├── email.service.js          ← Resend/SendGrid
│   │   │   ├── storage.service.js        ← AWS S3
│   │   │   ├── offerLetter.service.js    ← Offer letter generation
│   │   │   └── leaderboard.service.js    ← Redis cache + DB sync
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js
│   │   │   ├── role.middleware.js
│   │   │   └── rateLimit.middleware.js
│   │   ├── models/               ← Sequelize or raw pg query files
│   │   ├── jobs/
│   │   │   ├── coordinatorPenalty.job.js ← Runs every hour, checks 48h overdue
│   │   │   └── leaderboardSync.job.js    ← Runs every 30 min
│   │   ├── templates/
│   │   │   ├── certificates/
│   │   │   │   ├── expert.html
│   │   │   │   ├── nanodegree.html
│   │   │   │   └── fellowship.html
│   │   │   └── offerLetter/
│   │   │       └── offerLetter.html
│   │   └── config/
│   │       ├── database.js
│   │       ├── redis.js
│   │       └── payment.js
│   ├── seeds/
│   │   └── domainTasks.seed.js   ← Seeds all 14 domains × 4 durations
│   └── server.js
│
└── shared/
    └── constants/
        ├── domains.js            ← List of 14 domain names
        └── durations.js          ← Duration config object
```

---

## 🔌 SECTION 19: API ENDPOINT REFERENCE

All routes below are NEW. Do not modify existing routes. Prefix all new routes with `/api/v2/` to avoid conflicts with existing `/api/` routes.

### Student Routes
```
POST   /api/v2/student/onboard          ← Save domain + duration selection
GET    /api/v2/student/dashboard        ← Full dashboard data
GET    /api/v2/student/profile          ← Student profile + stats
```

### Task Routes
```
GET    /api/v2/tasks/my-tasks           ← All tasks for student's domain + duration
GET    /api/v2/tasks/:taskId            ← Single task detail
POST   /api/v2/tasks/:taskId/submit     ← Submit task (file or URL)
PATCH  /api/v2/tasks/:taskId/video-progress  ← Update video watch %
```

### Document Routes
```
POST   /api/v2/documents/upload-address-proof    ← Upload to S3
POST   /api/v2/documents/upload-marksheet        ← Upload to S3
GET    /api/v2/documents/my-status               ← Student sees their doc status
GET    /api/v2/admin/documents/pending           ← HR sees all pending students
POST   /api/v2/admin/documents/generate-offer-letters  ← Bulk generation
```

### Certificate Routes
```
GET    /api/v2/certificates/my-certs             ← Student's cert status + preview
POST   /api/v2/certificates/claim/:type          ← Trigger claim flow (payment check)
GET    /api/v2/certificates/verify/:certId       ← Public verification (no auth)
```

### Coin Routes
```
GET    /api/v2/coins/balance                     ← Current balance
GET    /api/v2/coins/history                     ← Full coin history
POST   /api/v2/coins/award                       ← Internal: award coins (server-side only)
```

### Leaderboard Routes
```
GET    /api/v2/leaderboard/global                ← Top 50 global
GET    /api/v2/leaderboard/domain/:domain        ← Domain-specific
GET    /api/v2/leaderboard/cohort/:cohortId      ← Cohort-specific
GET    /api/v2/leaderboard/my-rank               ← Student's own ranks (all 3)
```

### Coordinator Routes
```
GET    /api/v2/coordinator/dashboard             ← Stats + pending count
GET    /api/v2/coordinator/students              ← Assigned students list
GET    /api/v2/coordinator/pending-reviews       ← Tasks awaiting review
POST   /api/v2/coordinator/review/:taskId        ← Submit approve/reject
GET    /api/v2/coordinator/coins                 ← Coordinator coin balance
```

### Referral Routes
```
GET    /api/v2/referral/my-link                  ← Get unique referral URL
GET    /api/v2/referral/stats                    ← Referral count + coins earned
POST   /api/v2/referral/register                 ← Called when someone joins via ref link
```

### Psychology Routes (Internal — not exposed to frontend directly)
```
POST   /api/v2/psychology/log-trigger            ← Log that a trigger was shown
POST   /api/v2/psychology/log-click              ← Log that student clicked a trigger
GET    /api/v2/psychology/pending-triggers       ← What triggers should fire for a student today
```

---

## 🌱 SECTION 20: DATABASE SEED SCRIPT

The AI must create and run this seed file to populate all domain tasks.

```javascript
// backend/seeds/domainTasks.seed.js
// NEW FEATURE: Domain Task Seeder

const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// This seed file must populate ALL 14 domains × ALL 4 duration types
// Total minimum rows: 14 domains × (6 + 4 + 12 + 24) weeks = 14 × 46 = 644 rows

const domains = [
  'python_developer',
  'java_developer',
  'devops',
  'web_development',
  'mern_stack',
  'data_science',
  'cyber_security',
  'flutter',
  'software_engineering',
  'business_analyst',
  'venture_capital',
  'space_research',
  'vibe_coding',
  'hr_development'
]

const durationTypes = ['45days', '1month', '3months', '6months']

// The full task data is defined in Section 9 and Section 15-16 of this document
// Import or inline all task objects here following this structure:

const taskRecord = {
  domain: 'python_developer',        // from domains array above
  duration_type: '3months',          // from durationTypes array above
  week_number: 1,
  task_title: 'Python Basics',
  task_description: 'Write 10 Python programs covering variables, data types, and input/output',
  video_url: 'https://youtu.be/_uQrJ0TkZlc',
  coin_reward: 20,
  difficulty_level: 'easy'           // easy | medium | hard | expert
}

async function seed() {
  console.log('Seeding domain tasks...')
  // Insert all task records here
  // Use ON CONFLICT DO NOTHING to allow re-running safely
  await pool.query(`
    INSERT INTO domain_tasks
      (domain, duration_type, week_number, task_title, task_description, video_url, coin_reward, difficulty_level)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT DO NOTHING
  `, [
    taskRecord.domain,
    taskRecord.duration_type,
    taskRecord.week_number,
    taskRecord.task_title,
    taskRecord.task_description,
    taskRecord.video_url,
    taskRecord.coin_reward,
    taskRecord.difficulty_level
  ])
  console.log('Seeding complete.')
  process.exit(0)
}

seed().catch(console.error)

// Run with: node seeds/domainTasks.seed.js
```

**Add seed script to package.json:**
```json
"scripts": {
  "seed": "node seeds/domainTasks.seed.js",
  "seed:fresh": "node seeds/dropAndReseed.js"
}
```

---

## 📄 SECTION 21: OFFER LETTER HTML TEMPLATE

Save as `backend/src/templates/offerLetter/offerLetter.html`.
Use Puppeteer to convert to PDF. Inject variables server-side before rendering.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', serif;
      color: #1a1a1a;
      padding: 60px;
      background: #fff;
      font-size: 14px;
      line-height: 1.8;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #C9A84C;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .logo-section h1 {
      font-size: 22px;
      color: #C9A84C;
      font-weight: bold;
      letter-spacing: 0.05em;
    }
    .logo-section p {
      font-size: 11px;
      color: #666;
      margin-top: 2px;
    }
    .date-ref {
      text-align: right;
      font-size: 12px;
      color: #666;
    }
    .title {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      letter-spacing: 0.1em;
      margin: 30px 0;
      color: #1a1a1a;
      text-decoration: underline;
    }
    .salutation { margin-bottom: 16px; }
    .body-text { margin-bottom: 16px; text-align: justify; }
    .highlight-box {
      border: 1px solid #C9A84C;
      border-left: 4px solid #C9A84C;
      padding: 16px 20px;
      margin: 24px 0;
      background: #FDFAF4;
    }
    .highlight-box table { width: 100%; border-collapse: collapse; }
    .highlight-box td { padding: 6px 0; font-size: 13px; }
    .highlight-box td:first-child { font-weight: bold; width: 180px; color: #555; }
    .footer-section {
      margin-top: 50px;
      display: flex;
      justify-content: space-between;
    }
    .signature-block { font-size: 13px; }
    .signature-block .sig-name { font-weight: bold; font-size: 14px; margin-top: 40px; }
    .signature-block .sig-title { color: #666; font-size: 12px; }
    .seal { text-align: center; }
    .bottom-bar {
      margin-top: 50px;
      border-top: 1px solid #eee;
      padding-top: 12px;
      text-align: center;
      font-size: 10px;
      color: #999;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="logo-section">
      <h1>THE ENTREPRENEURSHIP NETWORK</h1>
      <p>Empowering the next generation of professionals</p>
    </div>
    <div class="date-ref">
      <p>Date: {{DATE_ISSUED}}</p>
      <p>Ref: TEN/OL/{{YEAR}}/{{STUDENT_ID_SHORT}}</p>
    </div>
  </div>

  <div class="title">INTERNSHIP OFFER LETTER</div>

  <p class="salutation">Dear <strong>{{STUDENT_FULL_NAME}}</strong>,</p>

  <p class="body-text">
    We are pleased to offer you a position as an intern at
    <strong>The Entrepreneurship Network (TEN)</strong>. After reviewing your
    application and profile, we are confident that you will make a meaningful
    contribution to our network. This letter formally confirms the details of
    your internship engagement.
  </p>

  <div class="highlight-box">
    <table>
      <tr>
        <td>Intern Name</td>
        <td>{{STUDENT_FULL_NAME}}</td>
      </tr>
      <tr>
        <td>Domain</td>
        <td>{{DOMAIN_NAME}}</td>
      </tr>
      <tr>
        <td>Duration</td>
        <td>{{DURATION_DISPLAY}}</td>
      </tr>
      <tr>
        <td>Start Date</td>
        <td>{{START_DATE}}</td>
      </tr>
      <tr>
        <td>End Date</td>
        <td>{{END_DATE}}</td>
      </tr>
      <tr>
        <td>Mode</td>
        <td>Remote</td>
      </tr>
      <tr>
        <td>Cohort</td>
        <td>{{COHORT_NAME}}</td>
      </tr>
    </table>
  </div>

  <p class="body-text">
    During your internship, you will be expected to complete weekly tasks,
    engage with your assigned coordinator, and maintain a professional standard
    of work. Upon successful completion of all requirements and a minimum
    attendance of 80%, you will be eligible for a Certificate of Completion.
  </p>

  <p class="body-text">
    We look forward to working with you and wish you a productive and enriching
    experience at TEN.
  </p>

  <div class="footer-section">
    <div class="signature-block">
      <p>Yours sincerely,</p>
      <p class="sig-name">{{DIRECTOR_NAME}}</p>
      <p class="sig-title">Director, The Entrepreneurship Network</p>
    </div>
    <div class="seal">
      <!-- TEN circular seal SVG inline here -->
    </div>
  </div>

  <div class="bottom-bar">
    The Entrepreneurship Network | Remote Operations |
    This is a computer-generated document. Verification: yourdomain.com/verify
  </div>

</body>
</html>
```

**Puppeteer render code for offer letter:**
```javascript
// services/offerLetter.service.js
const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')

async function generateOfferLetter(studentData) {
  let html = fs.readFileSync(
    path.join(__dirname, '../templates/offerLetter/offerLetter.html'),
    'utf8'
  )

  // Replace all template variables
  const replacements = {
    '{{STUDENT_FULL_NAME}}': studentData.name,
    '{{DOMAIN_NAME}}': studentData.domain,
    '{{DURATION_DISPLAY}}': studentData.duration,
    '{{START_DATE}}': studentData.startDate,
    '{{END_DATE}}': studentData.endDate,
    '{{COHORT_NAME}}': studentData.cohort,
    '{{DATE_ISSUED}}': new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }),
    '{{YEAR}}': new Date().getFullYear(),
    '{{STUDENT_ID_SHORT}}': studentData.id.slice(0, 8).toUpperCase(),
    '{{DIRECTOR_NAME}}': process.env.DIRECTOR_NAME || 'Director'
  }

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(key, value)
  }

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  await browser.close()

  return pdf  // Return as Buffer — caller uploads to S3
}

module.exports = { generateOfferLetter }
```

---

## ⏰ SECTION 22: BACKGROUND JOBS

Two cron jobs must run automatically on the backend server.

### Job 1 — Coordinator Penalty Auto-Deduction

```javascript
// backend/src/jobs/coordinatorPenalty.job.js
// NEW FEATURE: Coordinator Accountability Job
// Runs every hour using node-cron

const cron = require('node-cron')
const { deductCoordinatorCoins, alertAdmin } = require('../services/coins.service')

cron.schedule('0 * * * *', async () => {
  console.log('[JOB] Running coordinator penalty check...')

  // Find all submitted tasks where:
  // status = 'submitted' AND submitted_at is more than 48 hours ago
  // AND coordinator has not reviewed yet

  const overdueTasks = await getOverdueTasksFromDB()  // implement this query

  for (const task of overdueTasks) {
    const hoursOverdue = getHoursOverdue(task.submitted_at)

    if (hoursOverdue >= 72) {
      await deductCoordinatorCoins(task.coordinator_id, 60, '72h review overdue')
      await alertAdmin(task.coordinator_id, task.id, '72h')
    } else if (hoursOverdue >= 48) {
      await deductCoordinatorCoins(task.coordinator_id, 30, '48h review overdue')
      await alertAdmin(task.coordinator_id, task.id, '48h')
    }
  }
})
```

### Job 2 — Leaderboard Sync

```javascript
// backend/src/jobs/leaderboardSync.job.js
// NEW FEATURE: Leaderboard Redis Sync Job
// Runs every 30 minutes

const cron = require('node-cron')

cron.schedule('*/30 * * * *', async () => {
  console.log('[JOB] Syncing leaderboard to PostgreSQL...')
  // Read from Redis sorted sets
  // Write to leaderboard_cache table
  // Calculate global_rank, domain_rank, cohort_rank for each student
})
```

**Install:** `npm install node-cron`

---

## ✅ FINAL CHECKLIST FOR THE AI BUILDING THIS

Before submitting any code, verify every item below is done. No exceptions.

### Defence
- [ ] Zero existing files have been modified
- [ ] Zero existing database tables have been altered
- [ ] Zero existing API routes have been changed
- [ ] All new routes prefixed with `/api/v2/`
- [ ] All new code in new files/folders with `// NEW FEATURE:` comments

### Database
- [ ] All 12 new tables created from Section 3
- [ ] Seed script runs without errors
- [ ] All 14 domains × 4 duration types seeded into `domain_tasks`
- [ ] Minimum 644 rows in `domain_tasks` after seeding

### Student Portal
- [ ] Domain + duration selection works on registration
- [ ] Two-document upload works (address proof + marksheet) → S3
- [ ] Document status updates correctly through all stages
- [ ] Dashboard shows coin balance, streak, rank, progress arc
- [ ] Task unlock is sequential — Week N locked until Week N-1 approved
- [ ] Video 80% watch tracking works before task submission unlocks
- [ ] Coin animations play on every coin award event
- [ ] Badge grid shows earned (colored) + unearned (grey silhouette, no label)
- [ ] Referral link is unique per student and tracked correctly
- [ ] Leaderboard shows global, domain, and cohort tabs

### Psychology System
- [ ] DAY1_BLUR_SHOWN trigger fires on first dashboard load
- [ ] FIRST_TASK_COIN_POPUP fires after first task approved
- [ ] Expert cert celebration screen fires at correct tenure-based timing
- [ ] Nano degree progress bar appears after Expert cert interaction
- [ ] Fellowship whisper ONLY fires for top 10% of cohort
- [ ] All triggers logged in `psychology_triggers` table
- [ ] Social proof feed fires maximum once per day

### HR Admin Portal
- [ ] "Generate Documents" section added without touching existing admin pages
- [ ] "Pending" tab shows all students who uploaded both documents
- [ ] Bulk selection + bulk offer letter generation works
- [ ] Offer letter PDF generated via Puppeteer using HTML template from Section 21
- [ ] Offer letter emailed to student and status updated in DB

### Coordinator Portal
- [ ] Task review flow works (approve + reject with feedback)
- [ ] Coin rewards fire within 5 minutes of review action
- [ ] Coordinator penalty job runs hourly and deducts coins after 48h/72h
- [ ] Performance score calculated and displayed correctly
- [ ] Coordinator leaderboard visible in portal

### Certificates
- [ ] All 3 HTML/CSS certificate templates built (Section 8)
- [ ] Puppeteer renders each to PDF at 300 DPI
- [ ] Certificate reveal animation plays (Section 8.4)
- [ ] Verification page at `/verify/:certId` is public and works
- [ ] LinkedIn share URL pre-filled for Nano Degree and Fellowship
- [ ] Fellowship badge SVG exported alongside PDF
- [ ] Certificate IDs follow format: `TEN-YYYY-[TYPE]-[6CHAR]`

### Payment (Skeleton)
- [ ] PAYMENT_ENABLED=false by default
- [ ] All payment code exists but wrapped in the PAYMENT_ENABLED flag
- [ ] Setting PAYMENT_ENABLED=true requires ZERO code changes to activate

### Mobile App
- [ ] All screens from Section 17 exist in React Native
- [ ] Navigation structure matches Section 17 exactly
- [ ] Video tracking works on mobile (react-native-youtube-iframe)
- [ ] Document upload works via expo-document-picker
- [ ] Push notifications configured via Firebase + expo-notifications
- [ ] Offline mode shows banner and blocks submission
- [ ] Deep links open app when installed

### Jobs
- [ ] Coordinator penalty job (node-cron, hourly)
- [ ] Leaderboard sync job (node-cron, every 30 minutes)

### Folder Structure
- [ ] Project structure matches Section 18 exactly
- [ ] `/web`, `/mobile`, `/backend`, `/shared` all exist at root level

---

*End of Master Development Prompt — Version 2.0 (Complete)*
*Built for The Entrepreneurship Network (TEN)*
*Sections: 0 through 22 + Final Checklist*
*
*Any AI reading this document:*
*→ Read ALL sections before writing ANY code*
*→ When in doubt: ASK the developer*
*→ When conflicting with existing code: STOP and flag immediately*
*→ Never assume. Never overwrite. Always add.*
*→ The Defence Rules in Section 0 override everything else.*
