import { useState } from 'react';
import { useSession, upsertApplication } from '../store';
import { Busy, Button, Card, Empty, Field, Problem, inputClass } from '../ui';

type Row = {
  title?: string;
  role?: string;
  company?: string;
  location?: string;
  where?: string;
  url?: string;
  applyUrl?: string;
  fit?: number;
  source?: string;
};

/**
 * Openings with a destination, or no row at all.
 *
 * Every row has to carry a URL that opens the listing — a company careers
 * page or an ATS board, not a search page and not a board's front door. A
 * row without one is dropped rather than shown, because "go and search
 * Naukri" is not a result, it is the absence of one wearing a result's
 * clothes.
 */
export default function Hunt() {
  const session = useSession();
  const [role, setRole] = useState(String(session.target || ''));
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState('');

  const resumeText = String(session.resumeText || '');

  async function search() {
    if (!resumeText.trim()) return setErr('Upload a resume first — the search is built from what it can prove.');
    setBusy(true);
    setErr('');
    setNote('');
    try {
      const res = await fetch('/api/v2/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: resumeText, role: role.trim(), location: location.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.error || `The search failed (HTTP ${res.status}).`);
        setRows(null);
      } else {
        const found: Row[] = data.jobs || data.rows || data.results || [];
        /* Verified destination or nothing — the rule the job seat runs on. */
        const withUrl = found.filter((r) => /^https?:\/\//.test(String(r.url || r.applyUrl || '')));
        setRows(withUrl.slice(0, 12));
        if (found.length > withUrl.length) {
          setNote(`${found.length - withUrl.length} row(s) dropped — no destination listing URL.`);
        }
      }
    } catch {
      setErr('Could not reach the job search. Check your connection and try again.');
      setRows(null);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <Card title="Search" note="Titles come from your resume. Openings come from company boards and ATS hosts.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role">
            <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Backend Engineer" />
          </Field>
          <Field label="Where" hint="A city, or leave empty for remote and overseas too.">
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bengaluru" />
          </Field>
        </div>
        <div className="mt-3">
          <Button onClick={search} disabled={busy}>
            Find openings
          </Button>
        </div>
      </Card>

      {busy && <Busy>Searching company boards…</Busy>}
      {err && <Problem>{err}</Problem>}

      {rows && (
        <Card title={`${rows.length} opening${rows.length === 1 ? '' : 's'}`} note={note || undefined}>
          {!rows.length ? (
            <Empty>Nothing came back with a real listing URL this time. Try a broader role or clear the city.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="text-left text-[var(--mute)]">
                    <th className="border-b border-[var(--line)] px-2 py-1.5 font-medium">Role</th>
                    <th className="border-b border-[var(--line)] px-2 py-1.5 font-medium">Company</th>
                    <th className="border-b border-[var(--line)] px-2 py-1.5 font-medium">Where</th>
                    <th className="border-b border-[var(--line)] px-2 py-1.5 font-medium">Opening</th>
                    <th className="border-b border-[var(--line)] px-2 py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const url = String(r.url || r.applyUrl);
                    return (
                      <tr key={url + i}>
                        <td className="border-b border-[var(--line)] px-2 py-1.5">{r.title || r.role || '—'}</td>
                        <td className="border-b border-[var(--line)] px-2 py-1.5">{r.company || '—'}</td>
                        <td className="border-b border-[var(--line)] px-2 py-1.5 text-[var(--mute)]">
                          {r.location || r.where || '—'}
                        </td>
                        <td className="border-b border-[var(--line)] px-2 py-1.5">
                          <a href={url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                            Open ↗
                          </a>
                        </td>
                        <td className="border-b border-[var(--line)] px-2 py-1.5">
                          <button
                            onClick={() =>
                              upsertApplication({
                                id: url,
                                company: r.company || '—',
                                role: r.title || r.role || '—',
                                url,
                                where: r.location || r.where,
                                fit: r.fit,
                                status: 'found',
                                at: Date.now(),
                              })
                            }
                            className="text-[11.5px] text-[var(--mute)] hover:text-[var(--text)]"
                          >
                            Track
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
