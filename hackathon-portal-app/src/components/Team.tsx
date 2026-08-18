/**
 * The half of the portal that exists after you pay: sign in, see your team,
 * invite the rest of it, and hand in the build.
 *
 * There is no email and no password anywhere in this portal, so the team code
 * is the whole auth story — it is what an invite link carries and what signs a
 * returning teammate back in. The browser remembers it so nobody has to.
 */

import { useCallback, useEffect, useState } from 'react';

const inter = { fontFamily: 'Inter, system-ui, sans-serif' } as const;
const CODE_KEY = 'ten_hack_code';

export type Member = { name: string; role: string; skills: string[]; isLead: boolean };
export type Team = {
  code: string;
  name: string;
  track: string;
  pitch: string;
  status: string;
  paymentStatus: 'unpaid' | 'pending' | 'confirmed' | 'rejected';
  paymentAmount: number;
  paymentRef: string;
  rejectionReason: string;
  confirmed: boolean;
  members: Member[];
  maxTeamSize: number;
  seatsLeft: number;
  lookingForMembers: boolean;
  wantedSkills: string[];
  submissionUrl: string;
  submittedAt: string | null;
  registeredAt: string | null;
  event: { title: string; slug: string; mode: string; startsAt: string | null; endsAt: string | null; venue: string; prize: string; tracks: string[] } | null;
};

export function rememberCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code); } catch { /* private mode */ }
}
export function storedCode(): string {
  try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
}
/** The link a lead sends their teammates. Opens straight into the join form. */
export function inviteUrl(code: string) {
  return `${window.location.origin}/hackathon-portal/#join=${code}`;
}

const field =
  'w-full rounded-lg border border-emerald-300/20 bg-black/50 px-4 py-3 text-[14px] text-white placeholder-white/30 focus:border-emerald-300/60 focus:outline-none';

function Pill({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    pending: ['text-amber-300 border-amber-300/50', 'Payment pending'],
    confirmed: ['text-emerald-300 border-emerald-300/50', 'Confirmed'],
    rejected: ['text-rose-300 border-rose-300/50', 'Rejected'],
    unpaid: ['text-white/60 border-white/30', 'Unpaid'],
  };
  const [cls, label] = map[s] || ['text-white/60 border-white/30', s];
  return <span className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] ${cls}`}>{label}</span>;
}

/** Copy that works without the clipboard API (http origins, older phones). */
function CopyBox({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const t = document.createElement('textarea');
        t.value = value; t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
      }
      setDone(true); setTimeout(() => setDone(false), 1800);
    } catch { /* the input is selectable as a fallback */ }
  }
  return (
    <div className="flex gap-2">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={`${field} text-[12.5px]`} />
      <button onClick={copy} className="whitespace-nowrap rounded-lg bg-emerald-400 px-4 text-[13px] font-bold text-black">
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function TeamPanel({ initialCode, joinCode, onClose }:
  { initialCode?: string; joinCode?: string; onClose: () => void }) {
  const [code, setCode] = useState(initialCode || joinCode || storedCode());
  const [team, setTeam] = useState<Team | null>(null);
  const [entry, setEntry] = useState(initialCode || joinCode || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [joinName, setJoinName] = useState('');
  const [submission, setSubmission] = useState('');
  const [joinRole, setJoinRole] = useState('');

  // A join link is only a join link until you are actually on the team.
  const joining = !!joinCode && !!team && !storedCode();

  const load = useCallback(async (c: string) => {
    if (!c) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/v2/hackathons/team/${encodeURIComponent(c)}`);
      const data = await res.json();
      if (!data.success) { setMsg(data.message || 'No team found for that code.'); setTeam(null); }
      else { setTeam(data.team); setSubmission(data.team.submissionUrl || ''); if (!joinCode) rememberCode(c); }
    } catch { setMsg('Could not reach the server.'); }
    setBusy(false);
  }, [joinCode]);

  useEffect(() => { if (code) load(code); }, [code, load]);

  async function post(path: string, body: unknown, method = 'POST') {
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/v2/hackathons/team/${encodeURIComponent(code)}${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) setMsg(data.message || 'That did not work.');
      else { setTeam(data.team); setMsg(data.message || ''); }
      setBusy(false);
      return data.success as boolean;
    } catch { setMsg('Could not reach the server.'); setBusy(false); return false; }
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/85 px-4 py-10 backdrop-blur-sm" style={inter} onClick={onClose}>
      <div className="mx-auto max-w-[620px] rounded-2xl border border-emerald-300/25 bg-[#070b0e] p-7 sm:p-9" onClick={(e) => e.stopPropagation()}>

        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mono text-[11px] tracking-[0.24em] text-emerald-300/80">
              {joinCode && !team ? 'JOIN A TEAM' : team ? 'MY TEAM' : 'SIGN IN'}
            </p>
            <h3 className="display-font mt-1 text-[24px] leading-tight text-white">
              {team ? team.name : 'Your team code'}
            </h3>
            {team?.event && <p className="mt-1 text-[13px] text-white/50">{team.event.title}</p>}
          </div>
          <button onClick={onClose} className="text-[22px] leading-none text-white/50 hover:text-white" aria-label="Close">×</button>
        </div>

        {/* ── sign in with a code ── */}
        {!team && (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-white/60">
              Enter the team code you were given when you registered — or the one a teammate
              shared with you. No password, no email.
            </p>
            <input
              className={`${field} mono tracking-[0.2em]`}
              placeholder="XXXXXXXX"
              value={entry}
              onChange={(e) => setEntry(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') setCode(entry.trim()); }}
            />
            {msg && <p className="text-[13px] text-rose-300">{msg}</p>}
            <button disabled={busy} onClick={() => setCode(entry.trim())}
              className="w-full rounded-full bg-emerald-400 px-6 py-3.5 text-[14px] font-bold text-black disabled:opacity-60">
              {busy ? 'Checking…' : 'Open my team'}
            </button>
          </div>
        )}

        {/* ── the invite landing: join this team ── */}
        {team && joining && (
          <div className="space-y-3">
            <p className="text-[14px] leading-relaxed text-white/70">
              You have been invited to join <b className="text-white">{team.name}</b>
              {team.event ? <> for {team.event.title}</> : null}.
              {team.seatsLeft > 0
                ? <> There {team.seatsLeft === 1 ? 'is 1 seat' : `are ${team.seatsLeft} seats`} left.</>
                : <> This team is full.</>}
            </p>
            {team.seatsLeft > 0 && (
              <>
                <input className={field} placeholder="Your name" value={joinName} onChange={(e) => setJoinName(e.target.value)} />
                <input className={field} placeholder="What you do (optional) — e.g. backend, design"
                  value={joinRole} onChange={(e) => setJoinRole(e.target.value)} />
                {msg && <p className="text-[13px] text-rose-300">{msg}</p>}
                <button disabled={busy} onClick={async () => {
                  const ok = await post('/join', { name: joinName.trim(), role: joinRole.trim() });
                  if (ok) rememberCode(code);
                }}
                  className="w-full rounded-full bg-emerald-400 px-6 py-3.5 text-[14px] font-bold text-black disabled:opacity-60">
                  {busy ? 'Joining…' : 'Join this team'}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── the dashboard ── */}
        {team && !joining && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Pill s={team.paymentStatus} />
              {team.event?.startsAt && (
                <span className="mono text-[11.5px] text-emerald-200/60">
                  STARTS {new Date(team.event.startsAt).toLocaleDateString()}
                </span>
              )}
              <span className="mono text-[11.5px] text-emerald-200/60">{team.event?.venue}</span>
            </div>

            {team.paymentStatus === 'pending' && (
              <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-4 text-[13.5px] leading-relaxed text-amber-100/80">
                An admin is checking your payment (₹{team.paymentAmount}, ref {team.paymentRef}). Your
                team is saved — invite your teammates now, and submissions open once it is confirmed.
              </p>
            )}
            {team.paymentStatus === 'rejected' && (
              <p className="rounded-xl border border-rose-300/25 bg-rose-300/[0.06] p-4 text-[13.5px] leading-relaxed text-rose-100/80">
                Your payment could not be matched{team.rejectionReason ? `: ${team.rejectionReason}` : ''}. You can register again.
              </p>
            )}
            {team.confirmed && (
              <p className="rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] p-4 text-[13.5px] leading-relaxed text-emerald-100/80">
                You are in. See you at {team.event?.title || 'the event'}.
              </p>
            )}

            {/* members */}
            <div>
              <p className="mono mb-2 text-[11px] tracking-[0.2em] text-emerald-300/70">
                TEAM · {team.members.length}/{team.maxTeamSize}
              </p>
              <div className="space-y-1.5">
                {team.members.map((m, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3.5 py-2.5">
                    <span className="text-[14px] text-white/85">
                      {m.name}
                      {m.role && <span className="text-white/40"> · {m.role}</span>}
                    </span>
                    {m.isLead && <span className="mono text-[10.5px] tracking-wider text-emerald-300/80">LEAD</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* the invite link */}
            <div>
              <p className="mono mb-2 text-[11px] tracking-[0.2em] text-emerald-300/70">
                INVITE LINK {team.seatsLeft > 0 ? `· ${team.seatsLeft} SEAT${team.seatsLeft === 1 ? '' : 'S'} LEFT` : '· TEAM FULL'}
              </p>
              {team.seatsLeft > 0 ? (
                <>
                  <CopyBox value={inviteUrl(team.code)} />
                  <p className="mt-2 text-[12px] text-white/40">
                    Send this to your teammates. They enter a name and they are on the team — no
                    email, no account. Up to {team.maxTeamSize} people including you.
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-white/50">Your team is full — {team.maxTeamSize} of {team.maxTeamSize}.</p>
              )}
              <p className="mono mt-3 text-[12px] text-white/45">Team code: <span className="text-emerald-200">{team.code}</span></p>
            </div>

            {/* submission */}
            <div>
              <p className="mono mb-2 text-[11px] tracking-[0.2em] text-emerald-300/70">SUBMISSION</p>
              {team.confirmed ? (
                <>
                  <div className="flex gap-2">
                    <input className={field} placeholder="https://github.com/you/your-project"
                      value={submission} onChange={(e) => setSubmission(e.target.value)} />
                    <button disabled={busy} onClick={() => post('/submit', { submissionUrl: submission.trim() })}
                      className="whitespace-nowrap rounded-lg bg-emerald-400 px-4 text-[13px] font-bold text-black disabled:opacity-60">
                      {team.submissionUrl ? 'Update' : 'Submit'}
                    </button>
                  </div>
                  {team.submittedAt && (
                    <p className="mt-2 text-[12px] text-emerald-300/80">
                      Handed in {new Date(team.submittedAt).toLocaleString()}.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-white/45">Opens once an admin confirms your payment.</p>
              )}
            </div>

            {/* find-a-team listing */}
            <div>
              <label className="flex items-start gap-3 text-[13.5px] text-white/70">
                <input type="checkbox" className="mt-1" checked={team.lookingForMembers}
                  disabled={busy || team.seatsLeft === 0}
                  onChange={(e) => post('', { lookingForMembers: e.target.checked }, 'PATCH')} />
                <span>List us on the find-a-team board so solo entrants can ask to join.</span>
              </label>
            </div>

            {msg && <p className="text-[13px] text-emerald-300">{msg}</p>}

            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <button onClick={() => { try { localStorage.removeItem(CODE_KEY); } catch { /* ignore */ }
                setTeam(null); setCode(''); setEntry(''); }}
                className="text-[13px] text-white/45 hover:text-white">Sign out</button>
              <button onClick={onClose} className="text-[13px] text-white/45 hover:text-white">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
