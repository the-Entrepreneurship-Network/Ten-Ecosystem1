import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { send } from '../api';
import { loadApplications, patchSession, saveApplications, setSession, useSession, type Application } from '../store';
import { Busy, Button, Card, Empty, Problem, Reply } from '../ui';

const STATUSES: Application['status'][] = ['found', 'tailored', 'emailed', 'applied', 'closed'];

/**
 * What was found, what was tailored, what was actually sent.
 *
 * The email is drafted and never sent. A send button here would put a letter
 * with somebody's name on it in front of an employer on the strength of one
 * click, and there is no undo for that — so the draft is produced, shown, and
 * left for them to send from their own mailbox.
 */
export default function Applications() {
  const session = useSession();
  const nav = useNavigate();
  const [apps, setApps] = useState<Application[]>(loadApplications());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<{ for: string; text: string } | null>(null);

  function update(url: string, patch: Partial<Application>) {
    const next = apps.map((a) => (a.url === url ? { ...a, ...patch } : a));
    setApps(next);
    saveApplications(next);
  }

  function remove(url: string) {
    const next = apps.filter((a) => a.url !== url);
    setApps(next);
    saveApplications(next);
  }

  async function draftEmail(a: Application) {
    setBusy(a.url);
    setErr('');
    const out = await send(`draft an email for the ${a.role} role at ${a.company}, listing ${a.url}`, { session });
    setBusy('');
    if (!out.ok) return setErr(out.error || 'That did not work.');
    setSession(out.session);
    setDraft({ for: a.url, text: out.reply || out.text || '' });
    update(a.url, { status: 'emailed' });
  }

  if (!apps.length) {
    return (
      <Card title="Nothing tracked yet">
        <Empty>Openings you track from Job hunt appear here, with what you did about each one.</Empty>
        <Button kind="ghost" onClick={() => nav('/hunt')}>
          Find openings →
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {err && <Problem>{err}</Problem>}
      <Card title={`${apps.length} tracked`}>
        <div className="space-y-2.5">
          {apps.map((a) => (
            <div key={a.url} className="rounded-[10px] border border-[var(--line)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {a.role} <span className="text-[var(--mute)]">· {a.company}</span>
                  </p>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[11.5px] text-[var(--accent)] hover:underline"
                  >
                    {a.url.slice(0, 64)} ↗
                  </a>
                </div>
                <select
                  value={a.status}
                  onChange={(e) => update(a.url, { status: e.target.value as Application['status'] })}
                  className="rounded-[8px] border border-[var(--line)] bg-[var(--canvas)] px-2 py-1 text-[11.5px] text-[var(--text)] outline-none"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  kind="ghost"
                  onClick={() => {
                    patchSession({ target: a.role });
                    nav('/keywords');
                  }}
                >
                  Tailor for this
                </Button>
                <Button kind="ghost" onClick={() => draftEmail(a)} disabled={busy === a.url}>
                  Draft email
                </Button>
                <Button kind="ghost" onClick={() => remove(a.url)}>
                  Remove
                </Button>
              </div>

              {busy === a.url && <Busy>Writing the draft…</Busy>}
              {draft?.for === a.url && (
                <div className="mt-2.5 rounded-[10px] border border-[var(--line)] bg-[var(--canvas)] p-3">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    Draft — copy it into your own mailbox
                  </p>
                  <Reply text={draft.text} />
                  <div className="mt-2">
                    <Button kind="ghost" onClick={() => navigator.clipboard?.writeText(draft.text)}>
                      Copy
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
