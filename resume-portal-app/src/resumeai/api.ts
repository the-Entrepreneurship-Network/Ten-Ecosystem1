/**
 * One door to the agent.
 *
 * Every page in Resume AI runs a command through the same chat endpoint the
 * conversational agent uses, because the scoring, the keyword mapping, the
 * rewrite ladder and the parser view are already implemented, tested and
 * honest on the server. Reimplementing them in the browser would produce a
 * second set of numbers that disagreed with the first, and the disagreement
 * would be invisible until a student noticed it.
 *
 * A page is a shape for one command, not a second engine.
 */

export type Session = Record<string, unknown> & {
  resumeText?: string;
  target?: string;
  jd?: string;
  asked?: string;
  library?: { master?: string; versions?: unknown[] };
};

export type Reply = {
  ok: boolean;
  kind?: 'scan' | 'build' | 'ask' | 'help';
  reply?: string;
  text?: string;
  report?: Report;
  packet?: unknown;
  options?: Options;
  session: Session;
  error?: string;
};

export type Check = {
  id: string;
  label: string;
  weight: number;
  earned: number;
  detail: string;
  fix?: string;
};

export type Report = { score: number; of?: number; checks: Check[]; target?: string };

export type Options = {
  multi?: boolean;
  options?: { label: string; note?: string; value: string }[];
  groups?: { group: string; options: { label: string; note?: string; value: string }[] }[];
  other?: { label: string; value: string };
};

const KEY = 'resume-ai:session';

export function loadSession(): Session {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* A full quota is not a reason to lose the turn in progress. */
  }
}

/**
 * Send one message, optionally with a file, and return the agent's reply.
 *
 * The session travels with every request and comes back updated: the server
 * holds no per-user state, so the browser is where the conversation lives.
 */
export async function send(message: string, opts: { file?: File; session?: Session } = {}): Promise<Reply> {
  const body = new FormData();
  body.append('message', message);
  body.append('session', JSON.stringify(opts.session ?? loadSession()));
  if (opts.file) body.append('file', opts.file);

  let res: Response;
  try {
    res = await fetch('/api/v2/resume/chat', { method: 'POST', body });
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.', session: opts.session ?? loadSession() };
  }

  let data: Reply;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, session: opts.session ?? loadSession() };
  }

  if (!res.ok || !data.ok) {
    return {
      ...data,
      ok: false,
      error:
        data.error ||
        (res.status === 429
          ? 'Too many requests just now — wait a moment and try again.'
          : `The agent replied with an error (HTTP ${res.status}).`),
      session: data.session ?? opts.session ?? loadSession(),
    };
  }

  if (data.session) saveSession(data.session);
  return data;
}

/** The PDF export, built from the same details the page was built from. */
export async function downloadPdf(details: Record<string, unknown>) {
  const body = new FormData();
  Object.entries(details).forEach(([k, v]) => body.append(k, String(v ?? '')));
  const res = await fetch('/api/v2/resume/build.pdf', { method: 'POST', body });
  if (!res.ok) throw new Error('The PDF could not be built.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(details.name || 'resume').replace(/\s+/g, '_')}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
