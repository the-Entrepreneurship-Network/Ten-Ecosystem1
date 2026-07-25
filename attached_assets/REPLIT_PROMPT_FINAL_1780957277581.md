# TEN Internship Portal — Final Feature Update Prompt

> Paste this entire prompt to Replit AI. Do NOT skip any section. Implement ALL changes exactly as described. Do NOT break any existing functionality. After all changes are done, push the full project to: https://github.com/vishal20034/InternshipManagementSystem-Final.git

---

## CRITICAL RULES BEFORE YOU START

- Do NOT remove or break any existing feature
- Every change must work across ALL domains and ALL tenure types (1 month, 3 months, 6 months)
- All student-facing changes apply to `student-dashboard.html`, `v2-tasks.html`, and related backend routes
- Use MongoDB to persist all flags — do NOT rely only on localStorage for critical state
- After completing all features, commit and push everything to: `https://github.com/vishal20034/InternshipManagementSystem-Final.git`

---

## FEATURE 1 — Onboarding Popup: Show Only Once, Simplify Attendance Section

**File:** `public/student-dashboard.html` (and wherever the onboarding modal HTML lives)

### Changes:

1. Find the onboarding/guidelines popup that appears when a student logs in.

2. In that popup, find the **Attendance** section (Section 01). It currently has many bullet points and details. **Delete everything inside that section EXCEPT the heading.** The only thing that should remain is:
   ```
   📋 Attendance   [MANDATORY badge]
   ```
   No bullet points. No links. No warnings. No form links. Just the title and the MANDATORY badge.

3. **Show this popup only once** per student's entire internship tenure — on their very first login after registration. Never show it again.

   Implementation:
   - Add field `onboardingPopupSeen: { type: Boolean, default: false }` to Student mongoose model
   - Include `onboardingPopupSeen` in the login API response
   - Frontend: if `onboardingPopupSeen === false` → show popup. On close/confirm → call `POST /api/v2/student/mark-onboarding-seen` → sets flag `true` in DB
   - Never show again after that

4. **Same rule for the "New Joiner vs WhatsApp Re-Joiner" popup** — show only once on first login. Add DB flags:
   - `joinerTypeSelected: { type: Boolean, default: false }`
   - `joinerType: { type: String, enum: ['new', 'whatsapp'], default: null }`
   - On student selection → save via `POST /api/v2/student/set-joiner-type`
   - Never show again after selection

5. Both popups must work for ALL domains.

---

## FEATURE 2 — Auto Login / Stay Logged In

**Files:** `public/login.html`, `server.js`

On successful login, store token in `localStorage`:
```javascript
localStorage.setItem('ten_token', token);
localStorage.setItem('ten_employee_id', employeeId);
```

On every load of `student-dashboard.html` and `v2-tasks.html`:
- If `ten_token` exists → silently validate via `GET /api/v2/student/me` → if valid, proceed; if 401, clear localStorage and redirect to login
- If no token → redirect to login page

Add a **Logout** button that clears localStorage and redirects to login.

Use `localStorage` (not `sessionStorage`) so session persists after browser close. Works on both web and mobile web.

---

## FEATURE 3 — Daily Job Posting Task: Quick Share Buttons + Pre-Written Post

**File:** `public/v2-tasks.html`

**Above the existing platform checkboxes**, add a new `🚀 Quick Share — Click to open & post` section with these platform buttons:

| Button | Action |
|---|---|
| 🔗 Post on LinkedIn | `https://www.linkedin.com/sharing/share-offsite/?url=https://entrepreneurshipnetwork.net&summary=ENCODED_POST` |
| 🏢 TEN on LinkedIn | `https://www.linkedin.com/company/the-entrepreneurship-network/` |
| 💬 Share on WhatsApp | `https://wa.me/?text=ENCODED_POST` |
| ✈️ Share on Telegram | `https://t.me/share/url?url=https://entrepreneurshipnetwork.net&text=ENCODED_POST` |
| 👥 Share on Facebook | `https://www.facebook.com/sharer/sharer.php?u=https://entrepreneurshipnetwork.net&quote=ENCODED_POST` |
| 📸 Open Instagram | `https://www.instagram.com/` |

**Pre-written post (URL-encode this for deep links):**
```
🚀 Exciting Opportunity Alert!

I'm currently interning at The Entrepreneurship Network (TEN) — and it's been an incredible learning journey so far! 💡

TEN is actively hiring interns across multiple domains:
🔹 Web Development | MERN Stack | Python | Java
🔹 Data Science | AI | Cyber Security | DevOps
🔹 Flutter | Software Engineering & more!

✅ Work from home
✅ Certificate on completion
✅ Real projects & mentorship
✅ Weekly tasks + gamified learning

If you're a student looking to kickstart your tech career, this is your chance! 🎯

👉 Apply now: https://entrepreneurshipnetwork.net
📩 Or DM me for a referral link!

#Internship #TEN #TheEntrepreneurshipNetwork #Hiring #StudentOpportunity #WorkFromHome #TechInternship
```

**Button styling:** pill-shaped, platform brand colors:
- LinkedIn: `#0077B5`, WhatsApp: `#25D366`, Telegram: `#2CA5E0`, Facebook: `#1877F2`, Instagram: `#E1306C`
- Horizontal scrollable row, open in `target="_blank"`
- Do NOT touch existing checkboxes or submit logic

---

## FEATURE 4 — Coding Problems: Empty State Message

**File:** `public/student-dashboard.html` (coding modal)

When coordinator hasn't uploaded any problems and the list is empty, replace the blank black screen with:

```
🧩 No Coding Problems Yet

Your coordinator hasn't added any problems for this week yet.
Check back soon — new challenges are uploaded regularly.

In the meantime, sharpen your skills on these free platforms:

[💻 LeetCode]  [🏆 HackerRank]  [🍴 CodeChef]  [🌐 GeeksforGeeks]
```

Each badge links to the respective site in a new tab. Style using the existing dark theme: dark navy background, gold accent `#D4AF37`, centered, subtle card. Pure frontend change.

---

## FEATURE 5 — Video Progress Gate: 80% Watch = Quiz Unlock

**Files:** `public/v2-tasks.html`, `public/v2-quiz.js`, `routes/v2/studentPortal.js`, `services/v2/quizEngine.js`

1. Student must watch **≥80% of the task video** before quiz button becomes clickable
2. If `videoWatchedPercent < 80`: quiz button is disabled, shows tooltip: `"Watch at least 80% of the video to unlock the quiz 🔒"`
3. If `videoWatchedPercent ≥ 80`: quiz button activates with green glow animation
4. Use YouTube iframe API `getCurrentTime()` / `getDuration()` to track progress — save to DB field `videoWatchedPercent` in `StudentTaskProgress` on every 10-second interval
5. Quiz passed → next week unlocks. Quiz failed → student can retry quiz (no need to re-watch), but recording still required
6. **One quiz per week per task** — each week has exactly one quiz tied to that week's video and task. Student cannot skip a week's quiz to access the next week's content. The week progression is strictly sequential: Watch video (80%) → Take quiz → Pass → Week N+1 unlocks
7. Applies to ALL domains and ALL tenures

---

## FEATURE 6 — Quiz: Full-Screen Portal with FRONT CAMERA Recording

**Files:** `public/v2-quiz.js`, `public/v2-tasks.html`, create new `public/quiz-portal.html`

When student clicks "Take Quiz" (after 80% watch), open full-screen `quiz-portal.html`.

### Step 1 — Camera Permission Screen:

Show this before quiz starts:
```
📹 Camera Required for Quiz Integrity

To maintain academic integrity, your front camera must be ON during the entire quiz.

Your face must be visible at all times. The recording is for verification purposes only.

1. Click "Start Camera & Begin Quiz"
2. Allow camera access when browser asks
3. A small live preview will appear in the corner — do NOT cover it
4. Quiz begins automatically once camera is confirmed

[📷 Start Camera & Begin Quiz]     [← Cancel]
```

**Implementation — use front camera (selfie camera), NOT screen recording:**
```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: 'user' },  // front camera
  audio: false
});

// Show small live preview (picture-in-picture corner)
const videoPreview = document.getElementById('camera-preview');
videoPreview.srcObject = stream;
videoPreview.play();

// Start recording
const recorder = new MediaRecorder(stream);
recorder.start();
```

Show a small live camera preview (`100x75px`) in the **bottom-right corner** of the quiz screen at all times. Add a red pulsing dot `🔴 Recording` label above it.

If camera permission denied → show:
```
❌ Camera access is required to take this quiz.
Please allow camera permission in your browser settings and try again.
```
Do not proceed without camera.

On quiz submit → `recorder.stop()` → stop all stream tracks → do NOT upload the recording (too large). Just require it to be active during the quiz. The recording is proof-of-presence, not stored server-side.

### Step 2 — Quiz Questions:

- 5 MCQ questions per week, auto-generated based on `domain` + `weekNumber` + `durationType`
- Call `POST /api/v2/student/generate-quiz` → `quizEngine.js` returns questions
- **10-minute countdown timer** shown prominently at top
- One question at a time with Next button, or all 5 visible with scroll — your choice, pick whichever looks cleaner
- Pass = 3 or more correct out of 5 → show score, mark week complete, unlock next week
- Fail = less than 3 correct → show score, allow retry (retry also requires camera)
- Quiz result saved to DB

### Step 3 — Question Generation (Backend):

In `services/v2/quizEngine.js`, if no questions exist in DB for a `domain+weekNumber` combo, **auto-generate 5 MCQ questions** from the task's `taskTitle` and `taskDescription`. Build questions like:

```javascript
// Example for "Python Basics" week 1
[
  {
    question: "Which of the following is the correct way to declare a variable in Python?",
    options: ["var x = 5", "x = 5", "int x = 5", "declare x = 5"],
    answer: 1
  },
  // ... 4 more relevant questions
]
```

Create a hardcoded fallback question bank per domain in `quizEngine.js` — at least 3 weeks worth per domain — so the quiz never returns empty. Questions must be relevant to the domain and the specific week topic.

---

## FEATURE 7 — Broken YouTube Videos: Auto-Detect and Auto-Replace with Working Video

**Files:** `public/v2-tasks.html`, `server.js` or `routes/v2/studentPortal.js`, `models/new/DomainTask.js`

### How it works:

1. Every task video loads via YouTube iframe API. Listen for player errors:
```javascript
function onPlayerError(event) {
  // Error codes: 2=bad param, 5=HTML5 error, 100=not found, 101/150=not embeddable
  if ([2, 5, 100, 101, 150].includes(event.data)) {
    handleBrokenVideo(taskId, domain, weekNumber, taskTitle);
  }
}
```

2. When error detected → call backend: `POST /api/v2/student/report-broken-video` with `{ taskId, domain, weekNumber, taskTitle }`

3. **Backend auto-replaces the video:**
   - Maintain a hardcoded curated map in the backend: `FALLBACK_VIDEOS` — one reliable backup YouTube video URL per domain per week (hand-picked free tutorial videos that are publicly embeddable)
   - If `FALLBACK_VIDEOS[domain][weekNumber]` exists → update the `DomainTask` document's `videoUrl` in MongoDB to the fallback URL → return the new URL to frontend
   - Frontend immediately replaces the broken iframe with the new video — **no page reload needed**
   - If no fallback in map → return a YouTube search URL: `https://www.youtube.com/results?search_query=DOMAIN+WEEK_TOPIC+tutorial` — show as a clickable card

4. Add `fallbackVideoUrl: { type: String, default: null }` field to `DomainTask` model so fallbacks can be stored per task permanently

5. **Populate `FALLBACK_VIDEOS` map** in the backend with at least one reliable public tutorial video per domain (use well-known free channels: freeCodeCamp, Traversy Media, Fireship, CS50, etc.). Example entries:
```javascript
const FALLBACK_VIDEOS = {
  "Python Development": {
    1: "https://www.youtube.com/watch?v=rfscVS0vtbw",  // freeCodeCamp Python
    2: "https://www.youtube.com/watch?v=t8pPdKYpowI",
    // ... week 3 onwards
  },
  "Web Development": {
    1: "https://www.youtube.com/watch?v=mU6anWqZJcc",  // freeCodeCamp HTML/CSS
    // ...
  },
  "MERN Stack Development": {
    1: "https://www.youtube.com/watch?v=7CqJlxBYj-M",
    // ...
  },
  // ... fill for ALL 16 domains
};
```

6. Works for ALL domains, ALL tenures, automatically — student never sees a broken/blank video.

---

## FEATURE 8 — Coin System: Real Value Display + Full Earning Structure

**Files:** `public/student-dashboard.html`, `public/v2-tasks.html`, `services/v2/coinService.js`, `models/new/StudentCoin.js`

### 8A — Coin Conversion Rate (UPDATE FROM PREVIOUS):

**The correct rate is: 100 Coins = ₹50 (i.e., 1 Coin = ₹0.50)**

Everywhere coins are displayed, show:
```
💰 320 Coins  ≈ ₹160.00
```
Formula: `rupeeValue = coinCount * 0.50`

Format as `≈ ₹XX.XX` in smaller muted text (`font-size: 0.75em`, `color: #9aa4bf`) below the coin count.

Add info tooltip (ℹ️): `"TEN Coins are redeemable for rewards. 100 Coins = ₹50"`

Apply this everywhere coins appear: top nav, stats cards, leaderboard, profile modal.

### 8B — Full Coin Earning Structure (IMPLEMENT AND DISPLAY):

Update `coinService.js` to enforce this earning structure. Also show students a **"How to Earn Coins"** info panel (collapsible/accordion) in the task journey page:

```
💰 TEN Coin Earning Guide

📚 WEEKLY TASKS
  Easy task submitted & approved       →  +20 coins
  Medium task submitted & approved     →  +30 coins
  Hard task submitted & approved       →  +40 coins
  Expert/Final task approved           →  +100 coins

🧠 WEEKLY QUIZ
  Quiz passed on first attempt         →  +50 coins
  Quiz passed on retry                 →  +25 coins

📣 DAILY JOB POSTING (per day)
  1–2 platforms posted                 →  +5 coins
  3–5 platforms posted                 →  +10 coins
  6–9 platforms posted                 →  +15 coins
  Tracking form filled (+bonus)        →  +3 coins

📅 ATTENDANCE
  Daily attendance marked (per day)    →  +5 coins
  Perfect attendance (7 days streak)   →  +50 coins
  Perfect attendance (30 days streak)  →  +200 coins

🏆 MILESTONES
  Onboarding completed                 →  +20 coins
  First task submitted                 →  +10 coins
  All tasks in a week completed        →  +30 coins
  Course completed (all weeks done)    →  +500 coins

🔥 STREAK BONUSES
  7-day login streak                   →  +25 coins
  30-day login streak                  →  +100 coins

💎 TOTAL POTENTIAL (3-month internship, 12 weeks)
  Tasks (avg medium): 12 × 30          →  360 coins  ≈ ₹180
  Quizzes (first attempt): 12 × 50    →  600 coins  ≈ ₹300
  Daily posting (avg): 90 × 10        →  900 coins  ≈ ₹450
  Attendance: 90 × 5                  →  450 coins  ≈ ₹225
  Milestones + streaks                →  ~700 coins  ≈ ₹350
  ─────────────────────────────────────────────────
  MAX TOTAL                           → ~3010 coins ≈ ₹1,505
```

Make the coin earning guide visually attractive — use the existing dark theme, gold/amber colors, and icons.

---

## FEATURE 9 — Final Step: Push to GitHub

After all features are implemented:

```bash
git add -A
git commit -m "feat: once-only popups, persistent login, job post deep links, camera quiz portal, video gate 80%, auto broken video replace, coin value ₹0.50 + earning structure, coding empty state, weekly quiz system"
git remote set-url origin https://github.com/vishal20034/InternshipManagementSystem-Final.git
git push origin main --force
```

If `main` branch doesn't exist, create it or use `master`.

---

## FINAL CHECKLIST — Verify Every Item Before Submitting

- [ ] Onboarding popup shows only once (DB flag `onboardingPopupSeen`)
- [ ] New Joiner / WhatsApp popup shows only once (DB flag `joinerTypeSelected`)
- [ ] Attendance section in onboarding popup = title + MANDATORY badge only, nothing else
- [ ] Student stays logged in after browser close (localStorage token + `/api/v2/student/me` validation)
- [ ] Daily Job Posting has quick-share deep-link buttons above checkboxes
- [ ] Pre-written post includes TEN LinkedIn, apply link, hashtags
- [ ] Coding Problems section shows helpful empty state (not blank black screen)
- [ ] Quiz unlocks ONLY after 80% video watched (tracked in DB)
- [ ] ONE quiz per week — student cannot skip to next week without passing quiz
- [ ] Quiz opens in full-screen `quiz-portal.html`
- [ ] **FRONT CAMERA** (not screen recording) required during quiz — small live preview visible
- [ ] Quiz = 5 MCQ questions, 10-minute timer, pass = 3/5 correct
- [ ] Broken/private YouTube videos auto-replaced with working video from `FALLBACK_VIDEOS` map (no blank screen, no user action needed)
- [ ] Coin value shown as `≈ ₹XX.XX` everywhere (rate: 100 coins = ₹50)
- [ ] Coin earning guide panel visible on task journey page
- [ ] Full coin structure implemented in `coinService.js`
- [ ] All changes work across ALL 16 domains and ALL tenures (1m, 3m, 6m)
- [ ] No existing features broken
- [ ] Code pushed to https://github.com/vishal20034/InternshipManagementSystem-Final.git
