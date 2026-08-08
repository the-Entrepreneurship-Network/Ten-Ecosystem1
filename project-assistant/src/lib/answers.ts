/**
 * The answer engine.
 *
 * There is no model behind this build, so nothing here is generated at request
 * time. What it does instead is compose an answer out of the platform's own
 * data: the 644-row task library from the Ten-Ecosystem repo, plus the facts in
 * ten-knowledge. That means the week numbers, task titles, coin values and
 * difficulty ratings a student reads here are the ones their portal will
 * actually show them, not a plausible-sounding reconstruction.
 *
 * The tradeoff is honest and worth stating: this answers the questions the
 * curriculum can answer, and says so when a question falls outside it. A
 * confident paragraph about something it cannot know would be worse than a
 * short referral to a coordinator.
 */

import {
  CURRICULUM,
  DOMAINS,
  type DurationKey,
  type WeekTask,
} from "@/lib/ten-curriculum";
import {
  CERTIFICATES,
  COINS,
  DAILY_POST,
  DURATION_WEEKS,
  DURATIONS_WITHOUT_CURRICULUM,
  ORG,
  PORTAL_DURATIONS,
  TASK_LIFECYCLE,
} from "@/lib/ten-knowledge";

/* ------------------------------------------------------------------ matching */

/**
 * Aliases are ordered most specific first. "react" must resolve to MERN rather
 * than Web Development, and "pandas" to Data Science rather than Python, so the
 * more specific track claims the shared vocabulary.
 */
const DOMAIN_ALIASES: Array<[string, string[]]> = [
  ["MERN Stack Development", ["mern", "mongodb", "mongo", "express", "react", "next.js", "nextjs", "mean"]],
  ["Data Science", ["data science", "machine learning", "ml ", "ai/ml", "numpy", "scikit", "dataset", "regression", "data analyst"]],
  ["DevOps with AWS", ["devops", "aws", "docker", "kubernetes", "ci/cd", "cicd", "jenkins", "terraform", "cloud"]],
  ["Cyber Security", ["cyber", "security", "pentest", "penetration", "vulnerability", "owasp", "ethical hack"]],
  ["Flutter Development", ["flutter", "dart", "mobile app", "android", "ios"]],
  ["Vibe Coding", ["vibe coding", "vibe-coding", "cursor", "copilot", "prompt engineering", "ai coding"]],
  ["Space Research", ["space", "satellite", "astronomy", "aerospace", "orbital"]],
  ["Venture Capital", ["venture capital", "vc ", "term sheet", "cap table", "due diligence", "pitch deck", "funding"]],
  ["Business Analyst", ["business analyst", "business analysis", "requirement", "power bi", "tableau", "stakeholder"]],
  ["HR Management", ["hr", "human resource", "recruit", "hiring", "payroll", "onboarding", "talent acquisition"]],
  ["Software Engineering", ["software engineering", "sdlc", "dsa", "data structures", "algorithm", "system design"]],
  ["Java Development", ["java", "spring", "jdbc", "hibernate", "maven"]],
  ["Python Development", ["python", "django", "flask", "fastapi"]],
  ["Web Development", ["web development", "web dev", "frontend", "front-end", "html", "css", "tailwind", "javascript"]],
];

const DURATION_ALIASES: Array<[DurationKey, RegExp]> = [
  ["6months", /\b(6|six)[\s-]*month/i],
  ["3months", /\b(3|three)[\s-]*month/i],
  ["45days", /\b(45|forty[\s-]?five)[\s-]*day/i],
  ["1month", /\b(1|one)[\s-]*month\b|\b4[\s-]*week/i],
];

function findDomain(q: string): string | null {
  const s = ` ${q.toLowerCase()} `;
  for (const [domain, aliases] of DOMAIN_ALIASES) {
    if (aliases.some((a) => s.includes(a))) return domain;
  }
  return DOMAINS.find((d) => s.includes(d.toLowerCase())) ?? null;
}

function findDuration(q: string): DurationKey | null {
  for (const [key, re] of DURATION_ALIASES) if (re.test(q)) return key;
  return null;
}

/**
 * The two portal options with no task library behind them. Checked separately
 * from findDuration, which only knows the four tracks that actually exist: a
 * student who picked one of these needs to be told why their plan is empty,
 * not quietly shown a different track's plan.
 */
const NO_CURRICULUM_RE = /\b(1|one)[\s-]*week\b|\b15[\s-]*days?\b|\bfifteen[\s-]*days?\b/i;

/* ----------------------------------------------------------------- rendering */

const money = (coins: number) => `₹${(coins * COINS.rupeesPerCoin).toFixed(0)}`;

function weekTable(tasks: WeekTask[]): string {
  const rows = tasks
    .map(([w, title, desc, coins, diff]) => `| ${w} | **${title}** | ${desc} | ${coins} | ${diff} |`)
    .join("\n");
  return `| Week | Task | What you build | Coins | Level |\n| --- | --- | --- | --- | --- |\n${rows}`;
}

/** The full plan for one domain on one track: the answer most students want. */
function planFor(domain: string, duration: DurationKey): string {
  const tasks = CURRICULUM[domain]?.[duration];
  if (!tasks) return unknownTrack(domain);

  const weeks = DURATION_WEEKS[duration];
  const label = PORTAL_DURATIONS.find((d) => d.key === duration)!.label;
  const total = tasks.reduce((n, t) => n + t[3], 0);
  const capstone = tasks[tasks.length - 1];

  return `## ${domain} — ${label} track

Your portal will hand you **${tasks.length} weekly tasks across ${weeks} weeks**. This is the real task library, so you can plan against it before week 1 opens.

${weekTable(tasks)}

**Task coins on this track: ${total}** (${money(total)} at ${COINS.conversion}). That is tasks only, before attendance, streaks, quizzes and the daily posting task.

### How to actually finish

1. **Treat the week as the deadline.** Tasks unlock weekly and move ${TASK_LIFECYCLE.join(" → ")}. Approval is not instant, so submitting on the last day of a week means the approval lands in the next one. Aim to submit by day 5.
2. **Build week ${tasks.length} from week 1.** Your capstone is *${capstone[1]}: ${capstone[2].toLowerCase()}*, worth ${capstone[3]} coins on its own. Every earlier week is a component of it. Pick one problem domain in week 1 and keep it for all ${weeks} weeks instead of building ${weeks} disconnected exercises, and the capstone is assembly rather than a scramble.
3. **Bank the free coins.** Daily attendance is 5, a 7-day streak is 50, finishing a full week is 30. Those compound to more than several hard tasks and need no extra work beyond showing up.
4. **Do the daily posting task.** It is mandatory in every domain: ${DAILY_POST.rate}, so ${DAILY_POST.platforms.length} platforms available and 30 coins a day if you use ten of them.
5. **Report the same three lines every day.** What moved, what is blocked, what is next. Coordinators track consistency, and a visible weekly rhythm is what a recommendation is written from.

### If you fall behind

Do not skip forward to the capstone. The reviewer opens your repo and reads the commit history. Two solid weeks beat five thin ones, and the tasks are cumulative, so a gap in week ${Math.ceil(weeks / 3)} shows up as a broken week ${weeks}.`;
}

function unknownTrack(domain: string): string {
  const have = Object.keys(CURRICULUM[domain] ?? {});
  return `## ${domain}

I have the task library for this domain on these tracks: ${have.join(", ")}.

${DURATIONS_WITHOUT_CURRICULUM.join(" and ")} are selectable in the portal but have **no seeded task library behind them** — the backend only defines tasks for 1 Month, 45 Days, 3 Months and 6 Months. If you picked one of those and your plan came up empty, that is why, and it is not a fault in your account. Ask your coordinator to move you onto a track that has tasks.

Tell me which track you are on and I will give you the week-by-week plan.`;
}

/** Domain named but no duration: show the shape of the domain across tracks. */
function domainOverview(domain: string): string {
  const durs = CURRICULUM[domain] ?? {};
  const lines = (Object.keys(durs) as DurationKey[])
    .sort((a, b) => DURATION_WEEKS[a] - DURATION_WEEKS[b])
    .map((d) => {
      const tasks = durs[d]!;
      const label = PORTAL_DURATIONS.find((p) => p.key === d)!.label;
      const total = tasks.reduce((n, t) => n + t[3], 0);
      return `| ${label} | ${tasks.length} | ${tasks[tasks.length - 1][1]} | ${total} |`;
    })
    .join("\n");

  const three = durs["3months"] ?? Object.values(durs)[0]!;
  const arc = three.slice(0, 6).map((t) => t[1]).join(" → ");

  return `## ${domain} at TEN

**Tracks available**

| Track | Weeks | Ends with | Task coins |
| --- | --- | --- | --- |
${lines}

**The arc.** The first half is skills, the second half is one shippable thing. On the 3-month track it runs ${arc}, and the last weeks turn that into a deployed project with documentation.

**What the reviewer opens.** A repo with real commit history, a running deployment where the track has one, and a README that explains the decisions. Difficulty ratings climb from easy to expert across the track, and the final task is worth several times a normal week, so it is graded as the thing you are actually judged on.

Tell me your track (1 Month, 45 Days, 3 Months or 6 Months) and I will lay out every week with what to build and when to submit.`;
}

function allDomains(): string {
  const rows = DOMAINS.map((d) => {
    const durs = CURRICULUM[d];
    const three = durs["3months"];
    return `| **${d}** | ${three ? three.length : "—"} | ${three ? three[three.length - 1][1] : "—"} |`;
  }).join("\n");

  return `## The 14 domains at TEN

Every one of these has a full task library on four tracks: 1 Month (4 weeks), 45 Days (6 weeks), 3 Months (12 weeks), 6 Months (24 weeks).

| Domain | Weeks (3-month track) | Final task |
| --- | --- | --- |
${rows}

**A note on picking.** ${DURATIONS_WITHOUT_CURRICULUM.join(" and ")} appear as options in the portal but have no task library behind them. Choose 1 Month or longer unless your coordinator tells you otherwise.

Tell me your domain and track and I will give you the week-by-week plan, what each task actually wants, and how to sequence it so the final project is finished rather than started.`;
}

function coinsAnswer(): string {
  const rows = COINS.earn
    .map((e) => `| ${e.action} | ${e.coins}${e.note ? ` (${e.note})` : ""} |`)
    .join("\n");
  return `## How coins work

**${COINS.conversion}** — 1 coin = ₹${COINS.rupeesPerCoin}.

| How you earn | Coins |
| --- | --- |
${rows}

**Where students leave money on the table.** The per-task coins are the visible number, but the recurring ones add up faster. Daily attendance at 5 a day is 150 a month. A 7-day streak is 50 on top. Finishing a full week is 30. The daily posting task is ${DAILY_POST.rate} — ten platforms is 30 coins a day, which over a month beats every individual task on your track.

Finishing the entire course is a single 500-coin award, so the last week is worth more than the first several combined. Dropping out at week 9 of 12 costs far more than 3/12 of the value.

Ask your coordinator before counting on a payout: I can tell you the rates the platform publishes, not the settlement process behind them.`;
}

function certificateAnswer(): string {
  return `## Certificates

TEN issues three types: **${CERTIFICATES.types.join(", ")}**. A certificate record carries ${CERTIFICATES.carries.join(", ")}, so it is verifiable and postable to LinkedIn rather than a plain PDF.

**One thing to plan for.** Certificate records carry a payment status (pending, paid, failed), so issuance has a payment step rather than being automatic on completion. I am telling you the mechanism because it is in the platform's own data model. **I am deliberately not quoting an amount** — that is not something I can read reliably, and a wrong number here costs you real money. Ask your coordinator what the fee is before you finish, not after.

**What earns the strongest version.** Consistent weekly submissions with approvals, a finished final project, and a visible attendance record. Recommendations are performance-based, and a coordinator writing one is looking at your submission history, not your last week.`;
}

function dailyPostAnswer(): string {
  return `## The daily posting task

Mandatory for every intern in every domain, separate from your track tasks.

**Rate:** ${DAILY_POST.rate}.
**Platforms (${DAILY_POST.platforms.length}):** ${DAILY_POST.platforms.join(", ")}.

Ten platforms is 30 coins a day. Done every day for a month that is ~900 coins, which is more than the entire task list of most 3-month tracks. It is the single highest-return habit in the programme and the one students most often treat as optional.

Submission is a checkbox per platform plus the share, and it validates that at least one platform is selected.`;
}

function orientation(): string {
  return `## TEN Project Assistant

I am built on TEN's own task library, so I can be specific rather than generic. ${ORG.short} is ${ORG.description.toLowerCase()} Based in ${ORG.headquarters}, founded ${ORG.founded}, reaching ${ORG.reach}.

**What I can tell you exactly**

- Every week of your track: the task, what it asks you to build, its coin value and difficulty. All ${DOMAINS.length} domains, all four tracks.
- How to sequence ${DURATION_WEEKS["3months"]} weeks so the final project is finished rather than started.
- How coins actually accumulate, including the recurring ones most students miss.
- How the task lifecycle works: ${TASK_LIFECYCLE.join(" → ")}.

**What I will not do**

Guess. Fees, deadlines specific to your cohort, and anything about your individual account come from your coordinator. I would rather send you to the right person than sound confident and cost you a week.

**Start here.** Tell me your domain and your track — for example "I'm on MERN, 3 months" — and I will give you the whole plan.`;
}

/* -------------------------------------------------------------------- router */

type Rule = { test: RegExp; render: () => string };

const RULES: Rule[] = [
  { test: /\b(coin|reward|payout|stipend|money|paid|₹|rupee)\b/i, render: coinsAnswer },
  { test: /\b(certificate|certification|letter of recommendation|lor|nano.?degree|fellowship)\b/i, render: certificateAnswer },
  { test: /\b(daily post|job posting|posting task|share.*linkedin|social)\b/i, render: dailyPostAnswer },
  { test: /\b(what|which|list|all)\b.*\b(domain|track|field|stream)s?\b/i, render: allDomains },
];

export function answerFor(question: string): string {
  const domain = findDomain(question);
  const duration = findDuration(question);

  // Before anything else: if they named a track that has no tasks behind it,
  // that is the answer, whatever else the question was about.
  if (NO_CURRICULUM_RE.test(question)) {
    return unknownTrack(domain ?? "Your domain");
  }

  // A domain plus a track is the most specific thing the student can give, so
  // it wins over the topic rules: "how many coins on MERN 3 months" should
  // produce the plan with its coin total, not the generic coin table.
  if (domain && duration) return planFor(domain, duration);

  for (const rule of RULES) if (rule.test.test(question)) return rule.render();

  if (domain) return domainOverview(domain);
  return orientation();
}
