export type Role = "user" | "assistant";

export type Message = {
  id: string;
  role: Role;
  content: string;
  /** Set when a reply failed. Rendered as a recoverable error, not a bubble. */
  error?: string;
};

export type ChatRequest = {
  messages: { role: Role; content: string }[];
};

/** Stable ids without pulling in a uuid dependency. */
export function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
