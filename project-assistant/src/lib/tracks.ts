/**
 * The tracks a TEN intern can actually be placed on.
 *
 * These are not a plausible list of internship subjects: they are the exact
 * fourteen domains seeded in the Ten-Ecosystem backend, in the platform's own
 * wording, so a student scanning this finds the label their portal shows them.
 * Venture Capital, Space Research and Vibe Coding are real TEN tracks and no
 * amount of guessing would have produced them.
 *
 * Grouped rather than listed flat: fourteen items in one column is a wall, and
 * an intern knows immediately which group they belong to, which halves the scan.
 */

export type Track = { name: string; prompt: string };
export type TrackGroup = { label: string; tracks: Track[] };

/** Every opening prompt names a track, because domain plus track is what
 *  unlocks the week-by-week plan rather than a general overview. */
const ask = (domain: string) =>
  `I'm on the ${domain} track at TEN, 3 months. Give me the week-by-week plan and how to sequence it so the final project is actually finished.`;

export const TRACK_GROUPS: TrackGroup[] = [
  {
    label: "Engineering",
    tracks: [
      { name: "Web Development", prompt: ask("Web Development") },
      { name: "MERN Stack", prompt: ask("MERN Stack Development") },
      { name: "Python", prompt: ask("Python Development") },
      { name: "Java", prompt: ask("Java Development") },
      { name: "Flutter", prompt: ask("Flutter Development") },
      { name: "Software Engineering", prompt: ask("Software Engineering") },
      { name: "Vibe Coding", prompt: ask("Vibe Coding") },
    ],
  },
  {
    label: "Data & Infrastructure",
    tracks: [
      { name: "Data Science", prompt: ask("Data Science") },
      { name: "DevOps with AWS", prompt: ask("DevOps with AWS") },
      { name: "Cyber Security", prompt: ask("Cyber Security") },
      { name: "Space Research", prompt: ask("Space Research") },
    ],
  },
  {
    label: "Business",
    tracks: [
      { name: "Business Analyst", prompt: ask("Business Analyst") },
      { name: "Venture Capital", prompt: ask("Venture Capital") },
      { name: "HR Management", prompt: ask("HR Management") },
    ],
  },
];

/**
 * The opening screen's list.
 *
 * Each subtitle states something concrete the answer will actually deliver, so
 * the row is a promise rather than a category. "How coins work" is a label;
 * "100 coins = ₹50" tells a student whether the answer is worth their tap.
 */
export type Opener = { title: string; sub: string; prompt: string };

export const OPENERS: Opener[] = [
  {
    title: "Give me my week-by-week plan",
    sub: "All 14 domains, four tracks, every task with its coin value",
    prompt:
      "I'm on the MERN Stack Development track at TEN, 3 months. Give me the week-by-week plan and how to sequence it so the final project is actually finished.",
  },
  {
    title: "What domains can I be placed on?",
    sub: "The 14 seeded tracks, and the two durations with no tasks behind them",
    prompt: "What are all the domains and tracks available at TEN?",
  },
  {
    title: "How do coins actually add up?",
    sub: "100 coins = ₹50, and the recurring ones most interns miss",
    prompt: "How does the coin system work at TEN and how do I earn the most?",
  },
  {
    title: "What about the certificate?",
    sub: "Three types, and the payment step worth knowing before you finish",
    prompt: "What certificates does TEN issue and how do I qualify for one?",
  },
];
