/**
 * Register + pay for a hackathon or ideathon — inside this portal, no student
 * login. The buttons used to bounce to /student-login.html, which looped people
 * back into the internship portal. This keeps everything here:
 *
 *   details  →  pay by scanning the Paytm QR + enter the UPI reference  →  done
 *
 * The team is stored payment-pending and an admin verifies the reference before
 * it is confirmed. No email is sent; the email is only how a person looks their
 * status up again later.
 */

import { useEffect, useState } from 'react';
import { rememberCode, inviteUrl } from './Team';

const inter = { fontFamily: 'Inter, system-ui, sans-serif' } as const;

export type RegEvent = {
  slug: string;
  title: string;
  mode: 'hackathon' | 'ideathon';
  tracks: string[];
  minTeamSize: number;
  maxTeamSize: number;
  payment: { upiId: string; payeeName: string; qrImage: string; amount: number };
};

type Member = { name: string; email: string };

const REMEMBER_KEY = 'ten_hack_email';

export default function Register({ event, onClose }: { event: RegEvent; onClose: () => void }) {
  const [step, setStep] = useState<'details' | 'pay' | 'done'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [teamName, setTeamName] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [track, setTrack] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [utr, setUtr] = useState('');
  const [reference, setReference] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [copied, setCopied] = useState(false);

  const canAddMore = members.length < event.maxTeamSize - 1;

  function detailsOk() {
    if (teamName.trim().length < 2) return 'Give your team a name.';
    if (leadName.trim().length < 2) return 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail.trim())) return 'Enter a valid email.';
    if (leadPhone.replace(/\D/g, '').length < 10) return 'Enter a valid phone number.';
    return '';
  }

  function goPay() {
    const msg = detailsOk();
    if (msg) { setError(msg); return; }
    setError('');
    setStep('pay');
  }

  async function submit() {
    if (!/^[a-zA-Z0-9]{6,}$/.test(utr.trim())) {
      setError('Enter the UPI reference (UTR) from your payment app.');
      return;
    }
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/v2/hackathons/${event.slug}/register-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: teamName.trim(),
          leadName: leadName.trim(),
          leadEmail: leadEmail.trim(),
          leadPhone: leadPhone.trim(),
          track,
          members: members.filter((m) => m.name.trim() && m.email.trim()),
          utr: utr.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || 'Could not register.'); setBusy(false); return; }
      try { localStorage.setItem(REMEMBER_KEY, leadEmail.trim().toLowerCase()); } catch { /* private mode */ }
      setReference(data.reference || '');
      // The code is how they get back in and how they invite the rest of the
      // team. Remember it so returning needs nothing typed.
      if (data.code) { setTeamCode(data.code); rememberCode(data.code); }
      setStep('done');
    } catch {
      setError('Network error. Please try again.');
    }
    setBusy(false);
  }

  const field =
    'w-full rounded-lg border border-emerald-300/20 bg-black/50 px-4 py-3 text-[14px] text-white placeholder-white/30 focus:border-emerald-300/60 focus:outline-none';

  return (
    <div
      className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 px-4 py-10 backdrop-blur-sm"
      style={inter}
      onClick={onClose}
    >
      <div
        className="mx-auto max-w-[560px] rounded-2xl border border-emerald-300/25 bg-[#070b0e] p-7 sm:p-9"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mono text-[11px] tracking-[0.24em] text-emerald-300/80">
              {event.mode === 'ideathon' ? 'IDEATHON ENTRY' : 'HACKATHON ENTRY'}
            </p>
            <h3 className="display-font mt-1 text-[24px] leading-tight text-white">{event.title}</h3>
          </div>
          <button onClick={onClose} className="text-[22px] leading-none text-white/50 hover:text-white" aria-label="Close">×</button>
        </div>

        {/* ── step 1: details ── */}
        {step === 'details' && (
          <div className="space-y-3">
            <input className={field} placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            <input className={field} placeholder="Your name" value={leadName} onChange={(e) => setLeadName(e.target.value)} />
            <input className={field} placeholder="Email" type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} />
            <input className={field} placeholder="Phone" type="tel" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
            {event.tracks.length > 0 && (
              <select className={field} value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="">Pick a track (optional)</option>
                {event.tracks.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}

            {members.map((m, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <input className={field} placeholder={`Teammate ${i + 1} name`} value={m.name}
                  onChange={(e) => setMembers(members.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className={field} placeholder="Teammate email" value={m.email}
                  onChange={(e) => setMembers(members.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />
              </div>
            ))}
            {canAddMore && (
              <button className="text-[13px] font-semibold text-emerald-300 hover:text-emerald-200"
                onClick={() => setMembers([...members, { name: '', email: '' }])}>
                + Add a teammate (up to {event.maxTeamSize} total)
              </button>
            )}

            {error && <p className="text-[13px] text-rose-300">{error}</p>}
            <button onClick={goPay} className="mt-2 w-full rounded-full bg-emerald-400 px-6 py-3.5 text-[14px] font-bold text-black transition-transform hover:scale-[1.02]">
              Continue to payment — ₹{event.payment.amount} →
            </button>
            <p className="text-center text-[12px] text-white/40">Solo is fine — leave teammates blank and we pair you.</p>
          </div>
        )}

        {/* ── step 2: pay ── */}
        {step === 'pay' && (
          <div className="space-y-4 text-center">
            <p className="text-[14px] text-white/70">
              Scan the QR in any UPI app and pay <b className="text-white">₹{event.payment.amount}</b>.
            </p>
            <img src={event.payment.qrImage} alt="Scan to pay" className="mx-auto w-56 rounded-xl bg-white p-2" />
            <p className="text-[13px] text-white/60">
              UPI ID <span className="mono text-emerald-200">{event.payment.upiId}</span><br />
              {event.payment.payeeName}
            </p>
            <div className="text-left">
              <label className="mono mb-1 block text-[11px] tracking-[0.18em] text-emerald-300/70">UPI REFERENCE (UTR)</label>
              <input className={field} placeholder="12-digit reference from your app" value={utr}
                onChange={(e) => setUtr(e.target.value)} />
            </div>
            {error && <p className="text-[13px] text-rose-300">{error}</p>}
            <button disabled={busy} onClick={submit}
              className="w-full rounded-full bg-emerald-400 px-6 py-3.5 text-[14px] font-bold text-black transition-transform hover:scale-[1.02] disabled:opacity-60">
              {busy ? 'Submitting…' : "I've paid"}
            </button>
            <button onClick={() => { setError(''); setStep('details'); }} className="text-[13px] text-white/50 hover:text-white">← Back</button>
          </div>
        )}

        {/* ── step 3: done ── */}
        {step === 'done' && (
          <div className="space-y-4 text-center">
            <div className="text-[42px]">⏳</div>
            <h4 className="display-font text-[22px] text-white">Payment received</h4>
            <p className="text-[14px] leading-relaxed text-white/70">
              An admin will check your reference and confirm your team. Come back and check your
              status any time — you're identified by your email, so nothing to remember.
            </p>
            {teamCode && (
              <div className="rounded-xl border border-emerald-300/25 bg-emerald-300/[0.05] p-4 text-left">
                <p className="mono mb-1 text-[11px] tracking-[0.2em] text-emerald-300/80">YOUR TEAM CODE</p>
                <p className="mono mb-3 text-[20px] tracking-[0.28em] text-white">{teamCode}</p>
                <p className="mb-2 text-[12.5px] leading-relaxed text-white/60">
                  Save this. It signs you back in — there is no password. Share the link below and
                  your teammates join with just a name, up to {event.maxTeamSize} of you in total.
                </p>
                <div className="flex gap-2">
                  <input readOnly value={inviteUrl(teamCode)} onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-lg border border-emerald-300/20 bg-black/50 px-3 py-2.5 text-[12px] text-white" />
                  <button
                    onClick={async () => {
                      try {
                        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(inviteUrl(teamCode));
                        setCopied(true); setTimeout(() => setCopied(false), 1800);
                      } catch { /* the field is selectable instead */ }
                    }}
                    className="whitespace-nowrap rounded-lg bg-emerald-400 px-3 text-[12.5px] font-bold text-black">
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            {reference && <p className="mono text-[12px] text-emerald-200/60">Reference: {reference}</p>}
            <button
              onClick={() => { onClose(); window.location.hash = '#team'; }}
              className="w-full rounded-full bg-emerald-400 px-6 py-3.5 text-[14px] font-bold text-black">
              Open my team dashboard →
            </button>
            <button onClick={onClose} className="text-[13px] text-white/50 hover:text-white">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Check my status" — usable both right after registering and on a return
 * visit. Looks a registration up by email (a lookup key, never mailed).
 */
export function StatusChecker({ email: initial = '' }: { email?: string }) {
  const [email, setEmail] = useState(initial);
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!initial) { try { setEmail(localStorage.getItem(REMEMBER_KEY) || ''); } catch { /* ignore */ } }
  }, [initial]);

  async function check() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMsg('Enter the email you registered with.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/v2/hackathons/registration-status?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json();
      setRows(data.registrations || []);
      if (!data.registrations || !data.registrations.length) setMsg('No registration found for that email.');
    } catch { setMsg('Could not check status.'); }
    setBusy(false);
  }

  const field =
    'w-full rounded-lg border border-emerald-300/20 bg-black/50 px-4 py-3 text-[14px] text-white placeholder-white/30 focus:border-emerald-300/60 focus:outline-none';

  return (
    <div className="rounded-xl border border-emerald-300/15 bg-black/40 p-4 text-left" style={inter}>
      <div className="flex gap-2">
        <input className={field} placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button disabled={busy} onClick={check}
          className="whitespace-nowrap rounded-lg bg-emerald-400 px-4 text-[13px] font-bold text-black disabled:opacity-60">
          {busy ? '…' : 'Check'}
        </button>
      </div>
      {msg && <p className="mt-2 text-[12.5px] text-white/60">{msg}</p>}
      {rows && rows.map((r) => (
        <div key={r.reference} className="mt-3 border-t border-white/10 pt-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-white/80">{r.team} <span className="text-white/40">· {r.event}</span></span>
            <StatusPill s={r.paymentStatus} />
          </div>
          {r.paymentStatus === 'confirmed' && <p className="mt-1 text-emerald-300">You're in — see you at the event.</p>}
          {r.paymentStatus === 'rejected' && r.rejectionReason &&
            <p className="mt-1 text-rose-300">Rejected: {r.rejectionReason}. You can register again.</p>}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    pending: ['text-amber-300 border-amber-300/50', 'Pending'],
    confirmed: ['text-emerald-300 border-emerald-300/50', 'Confirmed'],
    rejected: ['text-rose-300 border-rose-300/50', 'Rejected'],
  };
  const [cls, label] = map[s] || ['text-white/60 border-white/30', s];
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${cls}`}>{label}</span>;
}
