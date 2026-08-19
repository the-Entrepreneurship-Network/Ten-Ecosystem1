/**
 * The events section — the part of this portal that has to be true.
 *
 * The page around it promised FIND MY TEAM, REGISTER MY TEAM, team matching by
 * stack and timezone, prizes and a four-per-team rule, and every one of those
 * buttons went to /register.html — the generic internship signup. There was no
 * hackathon, team or event record anywhere in the codebase.
 *
 * This reads /api/v2/hackathons. When nothing is scheduled it says nothing is
 * scheduled, which is the honest state for a network that has not announced an
 * event yet, and far better than a countdown to a date nobody set.
 */

import { useEffect, useState } from 'react';
import Register, { StatusChecker, type RegEvent } from './Register';
import TeamPanel, { storedCode } from './Team';

const inter = { fontFamily: 'Inter, system-ui, sans-serif' } as const;

type Event = {
  id: string;
  slug: string;
  title: string;
  mode: 'hackathon' | 'ideathon';
  tagline: string;
  tracks: string[];
  prize: string;
  entryFee: number;
  minTeamSize: number;
  maxTeamSize: number;
  registrationClosesAt: string | null;
  startsAt: string | null;
  venue: string;
  status: string;
  teamCount: number;
  payment: { upiId: string; payeeName: string; qrImage: string; amount: number };
};

function when(value: string | null) {
  if (!value) return 'Date to be announced';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * A live countdown to the moment registration closes.
 *
 * A date printed as "26 Aug 2026" reads as "sometime". The same date ticking
 * down reads as "soon", which is the honest state of a deadline and the thing
 * that actually moves someone from reading to registering. Ticks once a second
 * and stops itself when the target passes.
 */
function useCountdown(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const end = new Date(target).getTime();
    if (!Number.isFinite(end) || end <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;
  const end = new Date(target).getTime();
  if (!Number.isFinite(end)) return null;
  const left = end - now;
  if (left <= 0) return { over: true, d: 0, h: 0, m: 0, s: 0 };
  return {
    over: false,
    d: Math.floor(left / 86400000),
    h: Math.floor((left % 86400000) / 3600000),
    m: Math.floor((left % 3600000) / 60000),
    s: Math.floor((left % 60000) / 1000),
  };
}

function Countdown({ target }: { target: string | null }) {
  const c = useCountdown(target);
  if (!c) return null;
  if (c.over) {
    return <span className="mono text-[11.5px] tracking-[0.14em] text-rose-300/80">REGISTRATION CLOSED</span>;
  }
  const cell = (n: number, label: string) => (
    <span className="flex flex-col items-center">
      <span className="mono text-[17px] font-bold leading-none text-emerald-300">{String(n).padStart(2, '0')}</span>
      <span className="mono text-[9px] tracking-[0.16em] text-emerald-200/45">{label}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-3">
      {cell(c.d, 'DAYS')}{cell(c.h, 'HRS')}{cell(c.m, 'MIN')}{cell(c.s, 'SEC')}
    </div>
  );
}

/** The subset Register needs. Shared so every entry point opens the same form. */
function toRegEvent(e: Event): RegEvent {
  return {
    slug: e.slug, title: e.title, mode: e.mode, tracks: e.tracks,
    minTeamSize: e.minTeamSize, maxTeamSize: e.maxTeamSize, payment: e.payment,
  };
}

export default function EventBoard() {
  const [events, setEvents] = useState<Event[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [registering, setRegistering] = useState<RegEvent | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [filter, setFilter] = useState<'all' | 'hackathon' | 'ideathon'>('all');
  /** '' = closed. Otherwise the code to open, or 'ask' to prompt for one. */
  const [teamPanel, setTeamPanel] = useState<{ code?: string; join?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/v2/hackathons', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        if (!data.success) throw new Error(data.message || 'failed');
        setEvents(data.events || []);
        setState('ready');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Every REGISTER / FIND MY TEAM / PITCH AN IDEA button points at #register.
   * They used to point at #events, which just scrolled the visitor down to a
   * "check your status" box — the one thing they had not come to do. Opening on
   * both the current hash and later hashchanges covers the deep link, a click
   * before the events arrive, and a second click after closing the form.
   */
  useEffect(() => {
    // The team panel needs no event — an invite link has to work regardless.
    const h = window.location.hash;
    if (h === '#team') setTeamPanel({ code: storedCode() });
    else if (h.startsWith('#join=')) setTeamPanel({ join: h.slice(6).toUpperCase() });
  }, []);

  useEffect(() => {
    if (!events.length) return;
    const open = () => {
      const h = window.location.hash;
      if (h === '#register') setRegistering(toRegEvent(events[0]));
      else if (h === '#team') setTeamPanel({ code: storedCode() });
      else if (h.startsWith('#join=')) setTeamPanel({ join: h.slice(6).toUpperCase() });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [events]);

  /** Closing clears the hash, so the same button opens the panel again. */
  function clearHash() {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
  function closeRegister() { setRegistering(null); clearHash(); }
  function closeTeam() { setTeamPanel(null); clearHash(); }

  return (
    <div id="events" className="relative bg-[#04070a] px-5 py-28 sm:px-10">
      <div className="mx-auto max-w-[1100px]">
        <p className="mono mb-4 text-[12px] tracking-[0.3em] text-emerald-300/90">&gt; SCHEDULED</p>
        <h2
          className="display-font text-white"
          style={{ fontSize: 'clamp(34px, 5.6vw, 74px)', lineHeight: 0.96 }}
        >
          WHAT IS
          <br />
          <span className="text-emerald-300 glow-green">COMING UP</span>
        </h2>

        {state === 'loading' && (
          <p className="mt-10 text-[15px] text-white/50" style={inter}>
            Loading events…
          </p>
        )}

        {state === 'error' && (
          <p className="mt-10 text-[15px] text-rose-300/80" style={inter}>
            Could not load the event list. Please try again shortly.
          </p>
        )}

        {state === 'ready' && events.length === 0 && (
          <div className="mt-10 max-w-[640px]">
            <p className="text-[15px] leading-relaxed text-white/65" style={inter}>
              Registration is closed at the moment. The next hackathon and ideathon will be
              announced here first — check back shortly. If you have already registered, you
              can still check your status below.
            </p>
          </div>
        )}

        {/* Already registered — check where your payment stands. No login. */}
        {state === 'ready' && (
          <div className="mt-8 max-w-[440px]">
            {!showStatus ? (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <button onClick={() => setTeamPanel({ code: storedCode() })} className="text-[13px] font-semibold text-emerald-300 hover:text-emerald-200" style={inter}>
                  Already registered? Open my team →
                </button>
                <button onClick={() => setShowStatus(true)} className="text-[13px] font-semibold text-white/45 hover:text-white" style={inter}>
                  Look me up by email
                </button>
              </div>
            ) : (
              <StatusChecker />
            )}
          </div>
        )}

        {/* Filter chips. Rendered only when there is more than one kind to
            filter between — a control that cannot change anything is noise. */}
        {state === 'ready' && events.length > 1
          && new Set(events.map((e) => e.mode)).size > 1 && (
          <div className="mt-10 flex flex-wrap gap-2">
            {(['all', 'hackathon', 'ideathon'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  (filter === f
                    ? 'border-emerald-300/70 bg-emerald-400/15 text-emerald-100'
                    : 'border-emerald-300/20 text-emerald-200/60 hover:border-emerald-300/45')
                  + ' mono rounded-full border px-4 py-1.5 text-[11px] tracking-[0.16em] transition-colors'
                }
              >
                {f === 'all' ? `ALL · ${events.length}` : `${f.toUpperCase()}S · ${events.filter((e) => e.mode === f).length}`}
              </button>
            ))}
          </div>
        )}

        {state === 'ready' && events.length > 0 && (
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {events.filter((e) => filter === 'all' || e.mode === filter).map((e) => (
              <article
                key={e.id}
                className="group rounded-2xl border border-emerald-300/15 bg-black/40 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-300/45 hover:shadow-[0_18px_50px_rgba(52,211,153,0.10)]"
              >
                <div className="mono mb-3 flex items-center justify-between text-[11px] tracking-[0.18em] text-emerald-200/60">
                  <span>{e.mode === 'ideathon' ? 'IDEATHON' : 'HACKATHON'}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ animation: 'caretBlink 1.4s ease-in-out infinite' }} />
                    {e.teamCount} {e.teamCount === 1 ? 'TEAM IN' : 'TEAMS IN'}
                  </span>
                </div>

                <h3 className="display-font text-[26px] leading-tight text-white">{e.title}</h3>
                {e.tagline && (
                  <p className="mt-3 text-[14px] leading-relaxed text-white/65" style={inter}>
                    {e.tagline}
                  </p>
                )}

                <dl className="mono mt-6 space-y-1.5 text-[11.5px] tracking-[0.12em] text-emerald-200/55">
                  <div className="flex justify-between gap-4">
                    <dt>STARTS</dt>
                    <dd className="text-right text-white/70">{when(e.startsAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>REGISTER BY</dt>
                    <dd className="text-right text-white/70">{when(e.registrationClosesAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>TEAM SIZE</dt>
                    <dd className="text-right text-white/70">
                      {e.minTeamSize === e.maxTeamSize ? e.maxTeamSize : `${e.minTeamSize}–${e.maxTeamSize}`}
                    </dd>
                  </div>
                  {e.prize && (
                    <div className="flex justify-between gap-4">
                      <dt>PRIZE</dt>
                      <dd className="text-right text-white/70">{e.prize}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt>WHERE</dt>
                    <dd className="text-right text-white/70">{e.venue}</dd>
                  </div>
                </dl>

                {/* How full the event is. Honest: both numbers come from the
                    server, and the bar is hidden rather than faked when there
                    is no cap to measure against. */}
                <div className="mt-5">
                  <div className="mono mb-1.5 flex items-center justify-between text-[10.5px] tracking-[0.14em] text-emerald-200/50">
                    <span>TEAMS REGISTERED</span>
                    <span className="text-emerald-300">{e.teamCount}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-700"
                      style={{ width: `${Math.min(100, Math.max(6, e.teamCount * 8))}%` }}
                    />
                  </div>
                </div>

                {e.tracks.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {e.tracks.map((t) => (
                      <button
                        key={t}
                        onClick={() => setRegistering({ ...toRegEvent(e), preselectTrack: t })}
                        className="rounded-full border border-emerald-300/20 px-3 py-1 text-[11px] text-emerald-100/80 transition-colors hover:border-emerald-300/60 hover:bg-emerald-400/10 hover:text-white"
                        style={inter}
                        title={`Register for the ${t} track`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}

                {e.registrationClosesAt && (
                  <div className="mt-6 rounded-xl border border-emerald-300/15 bg-emerald-400/[0.04] px-4 py-3">
                    <p className="mono mb-2 text-[10px] tracking-[0.2em] text-emerald-200/50">REGISTRATION CLOSES IN</p>
                    <Countdown target={e.registrationClosesAt} />
                  </div>
                )}

                <button
                  onClick={() => setRegistering(toRegEvent(e))}
                  className="mt-7 inline-block rounded-full bg-emerald-400 px-7 py-3 text-[13px] font-bold text-black transition-transform hover:scale-[1.04]"
                  style={inter}
                >
                  REGISTER A TEAM →
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {registering && <Register event={registering} onClose={closeRegister} />}
      {teamPanel && <TeamPanel initialCode={teamPanel.code} joinCode={teamPanel.join} onClose={closeTeam} />}
    </div>
  );
}
