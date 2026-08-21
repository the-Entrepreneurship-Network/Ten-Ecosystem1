import { useState } from 'react';
import { forgetEverything, loadApplications, patchSession, useSession } from '../store';
import { Button, Card, Field, inputClass } from '../ui';

const LOCALES = [
  { id: 'IN', label: 'India', note: 'no photo, ₹ LPA, DD/MM' },
  { id: 'US', label: 'United States', note: 'no photo, $ annual' },
  { id: 'UK', label: 'United Kingdom', note: 'no photo, £ annual' },
] as const;

/**
 * What is stored, where it is stored, and how to remove it.
 *
 * All of it is in this browser — there is no account and nothing was
 * uploaded anywhere. That is worth saying plainly rather than implying by
 * omission, and the button that empties it should be easy to find rather
 * than buried.
 */
export default function Settings() {
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  const apps = loadApplications();

  function exportJson() {
    const blob = new Blob([JSON.stringify({ session, applications: apps }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume-ai-data.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-[560px] space-y-4">
      <Card title="You">
        <div className="space-y-3">
          <Field label="Name">
            <input
              className={inputClass}
              value={String((session.details as Record<string, string>)?.name || '')}
              onChange={(e) =>
                patchSession({
                  details: { ...(session.details as object), name: e.target.value },
                } as never)
              }
              placeholder="As it should appear at the top of the page"
            />
          </Field>
          <Field label="Target role">
            <input
              className={inputClass}
              value={String(session.target || '')}
              onChange={(e) => patchSession({ target: e.target.value })}
              placeholder="Backend Engineer"
            />
          </Field>
        </div>
      </Card>

      <Card title="Market" note="Sets currency, date format, and whether a photo is normal.">
        <div className="flex flex-wrap gap-1.5">
          {LOCALES.map((l) => {
            const on = String((session.details as Record<string, string>)?.country || 'India').startsWith(
              l.label.slice(0, 4),
            );
            return (
              <button
                key={l.id}
                onClick={() =>
                  patchSession({ details: { ...(session.details as object), country: l.label } } as never)
                }
                className={[
                  'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                  on
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]'
                    : 'border-[var(--line)] text-[var(--mute)] hover:border-[var(--accent)] hover:text-[var(--text)]',
                ].join(' ')}
              >
                {l.label}
                <span className="ml-1.5 text-[10.5px] text-[var(--mute)]">· {l.note}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card
        title="Your data"
        note="All of it is in this browser. There is no account, and nothing was uploaded to a server that keeps it."
      >
        <p className="mb-3 text-[12px] text-[var(--mute)]">
          {String(session.resumeText || '').trim() ? 'One resume' : 'No resume'} ·{' '}
          {(session.library as { versions?: unknown[] })?.versions?.length || 0} version(s) · {apps.length} application(s)
        </p>
        <div className="flex flex-wrap gap-2">
          <Button kind="ghost" onClick={exportJson}>
            Export JSON
          </Button>
          {confirming ? (
            <>
              <Button
                onClick={() => {
                  forgetEverything();
                  setConfirming(false);
                }}
              >
                Yes, delete everything
              </Button>
              <Button kind="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button kind="ghost" onClick={() => setConfirming(true)}>
              Forget everything
            </Button>
          )}
        </div>
        {confirming && (
          <p className="mt-2 text-[11.5px] text-[var(--danger)]">
            This removes your resume, every saved version and every tracked application from this browser. It cannot be
            undone — export first if you want a copy.
          </p>
        )}
      </Card>

      <Card title="About the score">
        <p className="text-[12px] leading-relaxed text-[var(--mute)]">
          The number is this app's rubric, not a live decision from Workday or Greenhouse — those systems do not publish
          a score, and nobody outside them can promise you one. It is useful because the things it measures are the
          things that get a file filtered out: whether it parses, whether the dates read, whether the claims carry
          evidence.
        </p>
      </Card>
    </div>
  );
}
