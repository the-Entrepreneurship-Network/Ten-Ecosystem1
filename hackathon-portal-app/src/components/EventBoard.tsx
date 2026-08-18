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
    if (!events.length) return;
    const open = () => {
      if (window.location.hash === '#register') setRegistering(toRegEvent(events[0]));
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [events]);

  /** Closing clears #register, so the same button opens the form again. */
  function closeRegister() {
    setRegistering(null);
    if (window.location.hash === '#register') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

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
              <button onClick={() => setShowStatus(true)} className="text-[13px] font-semibold text-emerald-300 hover:text-emerald-200" style={inter}>
                Already registered? Check your status →
              </button>
            ) : (
              <StatusChecker />
            )}
          </div>
        )}

        {state === 'ready' && events.length > 0 && (
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {events.map((e) => (
              <article
                key={e.id}
                className="rounded-2xl border border-emerald-300/15 bg-black/40 p-7 transition-colors hover:border-emerald-300/35"
              >
                <div className="mono mb-3 flex items-center justify-between text-[11px] tracking-[0.18em] text-emerald-200/60">
                  <span>{e.mode === 'ideathon' ? 'IDEATHON' : 'HACKATHON'}</span>
                  <span>{e.teamCount} {e.teamCount === 1 ? 'TEAM' : 'TEAMS'}</span>
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

                {e.tracks.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {e.tracks.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-emerald-300/20 px-3 py-1 text-[11px] text-emerald-100/80"
                        style={inter}
                      >
                        {t}
                      </span>
                    ))}
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
    </div>
  );
}
