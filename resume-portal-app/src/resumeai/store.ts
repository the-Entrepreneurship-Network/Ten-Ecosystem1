/**
 * The shared session, in twenty lines instead of a state library.
 *
 * Every page reads the same ledger — the resume text, the target, the job
 * description — and writes back what the agent returned. `useSyncExternalStore`
 * is React's own answer to exactly this, so a dependency here would buy
 * nothing but a bundle entry.
 */

import { useSyncExternalStore } from 'react';
import { loadSession, saveSession, type Session } from './api';

let current: Session = loadSession();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setSession(next: Session) {
  /* Replaced wholesale, never merged: the server returns the complete
     session, and merging would resurrect keys it deliberately cleared. */
  current = next || {};
  saveSession(current);
  emit();
}

export function patchSession(patch: Partial<Session>) {
  current = { ...current, ...patch };
  saveSession(current);
  emit();
}

export function getSession(): Session {
  return current;
}

export function useSession(): Session {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

/** Everything on file, wiped. Offered in Settings because it should be. */
export function forgetEverything() {
  setSession({});
  try {
    localStorage.removeItem('resume-ai:applications');
  } catch {
    /* nothing to do */
  }
}

/* ── the application tracker ─────────────────────────────────────────────
   Small enough to live beside the session rather than in a store of its
   own, and kept in the same shape the job agent returns so a row can be
   saved straight from a search result. */

export type Application = {
  id: string;
  company: string;
  role: string;
  url: string;
  fit?: number;
  where?: string;
  status: 'found' | 'tailored' | 'emailed' | 'applied' | 'closed';
  at: number;
};

const APPS = 'resume-ai:applications';

export function loadApplications(): Application[] {
  try {
    const raw = JSON.parse(localStorage.getItem(APPS) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveApplications(list: Application[]) {
  try {
    localStorage.setItem(APPS, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* nothing to do */
  }
  emit();
}

export function upsertApplication(app: Application) {
  const list = loadApplications();
  const rest = list.filter((a) => a.url !== app.url);
  saveApplications([app, ...rest]);
}
