/**
 * What the assistant actually knows about TEN, and where each fact came from.
 *
 * Every value here was read off a primary source: the live portal, the public
 * Ten-Ecosystem backend repo, or TEN's own LinkedIn page. Nothing is inferred
 * from how internship programmes usually work. Provenance is recorded per
 * block because a student may act on these, and an assistant that cannot say
 * where a number came from should not be stating the number.
 *
 * Sources
 *   PORTAL  virtualinternships.entrepreneurshipnetwork.net (task setup page)
 *   REPO    github.com/the-Entrepreneurship-Network/Ten-Ecosystem1
 *   LI      linkedin.com/company/the-entrepreneurship-network
 */

export type Sourced<T> = { value: T; source: "PORTAL" | "REPO" | "LI" };

export const ORG = {
  name: "The Entrepreneurship Network",
  short: "TEN",
  description:
    "A community-based EduTech group running remote virtual internships and a startup ecosystem for students and freshers.",
  headquarters: "Delhi, India",
  founded: 2020, // LI. An Internshala profile lists 2025; LI is the older and more consistent record.
  reach: "550+ colleges, 10,000+ students", // LI
  portalCounters: "500+ interns enrolled, 10+ domains", // PORTAL
} as const;

/**
 * The six options the portal actually presents when a student sets up their
 * task journey, with the labels it uses.
 */
export const PORTAL_DURATIONS = [
  { key: "1week", label: "1 Week", blurb: "Mini sprint" },
  { key: "15days", label: "15 Days", blurb: "Compact track" },
  { key: "1month", label: "1 Month", blurb: "Standard track" },
  { key: "45days", label: "45 Days", blurb: "Intensive sprint" },
  { key: "3months", label: "3 Months", blurb: "Deep dive" },
  { key: "6months", label: "6 Months", blurb: "Full mastery" },
] as const;

/**
 * Only four of those six have a seeded week-by-week curriculum behind them.
 *
 * The DomainTask schema's durationType enum is exactly
 * ["45days", "1month", "3months", "6months"], and the seeder fills all four
 * for all fourteen domains. "1 Week" and "15 Days" are selectable in the UI
 * with no task library behind them. A student who picks one and then finds an
 * empty plan has hit this, not a bug in their own account, and the assistant
 * should say so plainly rather than invent a syllabus for them.
 */
export const CURRICULUM_DURATIONS = ["1month", "45days", "3months", "6months"] as const;
export const DURATION_WEEKS = { "1month": 4, "45days": 6, "3months": 12, "6months": 24 } as const;
export const DURATIONS_WITHOUT_CURRICULUM = ["1 Week", "15 Days"] as const;

/**
 * Coin economy, verbatim from the portal's "How to Earn Coins" panel.
 * Coins are the programme's performance currency and convert to rupees, so
 * "unpaid internship" is the wrong description of this programme.
 */
export const COINS: {
  rupeesPerCoin: number;
  conversion: string;
  // Annotated rather than `as const`: without it each entry becomes its own
  // literal type and `note` vanishes from the union for the ones that omit it.
  earn: Array<{ action: string; coins: string; note?: string }>;
} = {
  rupeesPerCoin: 0.5,
  conversion: "100 coins = ₹50",
  earn: [
    { action: "Complete a task", coins: "20–100", note: "scales with difficulty" },
    { action: "Pass a quiz first attempt", coins: "50" },
    { action: "Daily job posting", coins: "5–15" },
    { action: "Daily attendance", coins: "5" },
    { action: "7-day attendance streak", coins: "50" },
    { action: "Complete a full week", coins: "30" },
    { action: "Watch a video", coins: "5", note: "each" },
    { action: "Complete the entire course", coins: "500" },
  ],
};

/**
 * The one task every intern has regardless of domain. Worth surfacing early:
 * students routinely miss that it is daily and mandatory, and it is the
 * cheapest reliable coin income in the programme.
 */
export const DAILY_POST = {
  mandatory: true,
  rate: "3 coins per platform, up to 10 platforms",
  platforms: [
    "LinkedIn",
    "LinkedIn Groups",
    "Facebook",
    "Facebook Groups",
    "WhatsApp",
    "WhatsApp Groups",
    "Instagram",
    "Telegram",
    "Telegram Groups",
  ],
} as const;

/** Task lifecycle and the counters the student dashboard shows. */
export const TASK_LIFECYCLE = ["Available", "Submitted", "Approved"] as const;
export const DASHBOARD_COUNTERS = ["Total Coins", "Approved", "Available", "Submitted"] as const;

/**
 * Certificates carry a payment status in the schema
 * (StudentCertificate.paymentStatus: pending | paid | failed), so issuance is
 * not automatically free on completion. The assistant states the mechanism and
 * sends the student to their coordinator for the amount, because the repo
 * records that a payment exists without fixing its price.
 */
export const CERTIFICATES = {
  types: ["expert", "nano_degree", "fellowship"],
  hasPaymentStep: true,
  carries: ["certificateId", "documentNumber", "verificationUrl", "LinkedIn URL", "badge"],
} as const;

/** Recognition and support the programme advertises. */
export const RECOGNITION = [
  "Certificate of Completion",
  "LinkedIn recommendation",
  "Performance report",
  "Domain-specific expert coordinator",
  "Live attendance and performance tracking",
] as const;

/**
 * A compact briefing rendered into the system prompt, so the model and the
 * offline answer engine are working from one set of facts rather than two that
 * can drift apart.
 */
export function tenBriefing(): string {
  const earn = COINS.earn
    .map((e) => `  - ${e.action}: ${e.coins} coins${e.note ? ` (${e.note})` : ""}`)
    .join("\n");
  return `## TEN, verified facts

${ORG.name} (${ORG.short}) is a ${ORG.description} Headquarters ${ORG.headquarters}; founded ${ORG.founded}; reach ${ORG.reach}. The internship portal reports ${ORG.portalCounters}.

### Duration tracks
The portal offers six: ${PORTAL_DURATIONS.map((d) => d.label).join(", ")}.
Only four have a week-by-week task library behind them: 1 Month (4 weeks), 45 Days (6 weeks), 3 Months (12 weeks), 6 Months (24 weeks).
${DURATIONS_WITHOUT_CURRICULUM.join(" and ")} are selectable but have no seeded tasks. Say so if a student picks one.

### Coins
${COINS.conversion} (1 coin = ₹${COINS.rupeesPerCoin}).
${earn}
This is a performance-linked reward, so do not describe the programme as simply "unpaid".

### The daily posting task
Mandatory for every intern in every domain. ${DAILY_POST.rate}. Platforms: ${DAILY_POST.platforms.join(", ")}.

### Task lifecycle
${TASK_LIFECYCLE.join(" -> ")}. The dashboard tracks ${DASHBOARD_COUNTERS.join(", ")}.

### Certificates
Types: ${CERTIFICATES.types.join(", ")}. Records carry ${CERTIFICATES.carries.join(", ")}.
Issuance has a payment step. Give the student the mechanism and send them to their coordinator for the amount; never quote a price.`;
}
