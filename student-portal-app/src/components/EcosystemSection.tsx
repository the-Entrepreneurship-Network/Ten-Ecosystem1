import { useEffect, useRef, useState } from 'react';
import { FadeIn } from './FadeIn';

/*
 * The reason this page exists: course, resume, job and hackathon are ONE
 * ecosystem, and this is where a visitor sees them joined up before any of
 * them will open. The portals themselves sit behind the server-side paywall
 * (middleware/studioGate.js) — this section is the shop window in front of it.
 *
 * The four doors stand on a real 3D ring — CSS preserve-3d, not WebGL, on
 * purpose: these are links that must stay clickable, focusable and readable
 * by a screen reader, which DOM gives for free and textured quads never will.
 * The WebGL lives in the hero, where pixels are the point.
 */

type Door = { key: string; title: string; line: string; price: string; href: string; icon: string };

/* Rendered before the fetch answers, and forever if it never does. The real
   figures come from /api/v2/studio/pricing, which reads the same config the
   payment screen charges from — these must only ever be its echo. */
const FALLBACK: Door[] = [
  { key: 'course', title: 'Courses & Modules', line: 'Six weeks in your domain — videos, quizzes, a reviewed project.', price: '₹300', href: '/studio.html?want=course', icon: '📚' },
  { key: 'resume', title: 'Resume Portal', line: 'An ATS-proof resume, checked against the job you actually want.', price: '₹150', href: '/studio.html?want=resume', icon: '📄' },
  { key: 'job', title: 'Job Portal', line: 'An agent hunts live openings and applies on your behalf.', price: '₹200', href: '/studio.html?want=job', icon: '💼' },
  { key: 'hackathon', title: 'Hackathons', line: '48 hours, one repo, a demo that has to run.', price: 'Entry at registration', href: '/hackathon-portal/', icon: '⚡' },
];

const COMBO_FALLBACK = { price: 500, insteadOf: 650, saving: 150 };

export default function EcosystemSection() {
  const [doors, setDoors] = useState<Door[]>(FALLBACK);
  const [combo, setCombo] = useState(COMBO_FALLBACK);
  const [angle, setAngle] = useState(0);
  const [still, setStill] = useState(false);
  const flat = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ).current;

  useEffect(() => {
    fetch('/api/v2/studio/pricing')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.success || !d.pricing) return;
        const p = d.pricing;
        setDoors((prev) => prev.map((door) => {
          const single = p.singles.find((s: any) => s.key === door.key);
          return single ? { ...door, title: single.name, line: single.blurb, price: `₹${single.price}` } : door;
        }));
        setCombo({ price: p.combo.price, insteadOf: p.combo.insteadOf, saving: p.combo.saving });
      })
      .catch(() => { /* the fallback figures stay */ });
  }, []);

  /* The ring turns on its own until it is touched, then it is theirs. */
  useEffect(() => {
    if (flat || still) return;
    const id = setInterval(() => setAngle((a) => a + 90), 4200);
    return () => clearInterval(id);
  }, [flat, still]);

  const step = (dir: number) => { setStill(true); setAngle((a) => a + dir * 90); };

  /* From the current angle, the smallest turn that puts door i in front —
     jumping three doors clockwise when one anticlockwise would do reads as a
     spin cycle, not a choice. */
  const shortestTurn = (from: number, i: number) => {
    const want = i * 90;
    let diff = (want - (((from % 360) + 360) % 360)) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  };

  return (
    <section id="ecosystem" className="relative overflow-hidden bg-black px-6 py-24 md:py-32">
      {/* the faint orbit behind the ring, so "interconnected" is drawn, not claimed */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200/10 md:h-[760px] md:w-[760px]" />

      <FadeIn className="relative z-10 text-center" y={30}>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200/70">One login · one payment</p>
        <h2 className="mt-3 text-4xl font-black uppercase tracking-tight md:text-6xl">Four doors, one key</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/60">
          The course feeds the resume, the resume feeds the job hunt, the hackathon proves all three.
          None of them opens from a URL — the overview is free, the doors are not.
        </p>
      </FadeIn>

      {flat ? (
        /* Less motion asked for → the same four doors, standing still. */
        <div className="relative z-10 mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          {doors.map((d) => <DoorCard key={d.key} door={d} />)}
        </div>
      ) : (
        <div className="relative z-10 mt-10" style={{ perspective: '1400px' }}>
          <div
            className="relative mx-auto h-[300px] w-[250px] transition-transform duration-[1100ms] ease-[cubic-bezier(.22,1,.32,1)] sm:h-[320px] sm:w-[280px]"
            style={{ transformStyle: 'preserve-3d', transform: `translateZ(-330px) rotateY(${-angle}deg)` }}
          >
            {doors.map((d, i) => (
              <div
                key={d.key}
                className="absolute inset-0"
                style={{ transform: `rotateY(${i * 90}deg) translateZ(330px)`, backfaceVisibility: 'hidden' }}
              >
                <DoorCard door={d} />
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-4">
            <button type="button" onClick={() => step(-1)} aria-label="Show the previous door"
              className="liquid-glass h-11 w-11 rounded-full text-xl text-white transition-colors hover:bg-white/10">‹</button>
            <button type="button" onClick={() => step(1)} aria-label="Show the next door"
              className="liquid-glass h-11 w-11 rounded-full text-xl text-white transition-colors hover:bg-white/10">›</button>
          </div>
          {/* Which door is facing you, and a way to jump straight to one — the
              ring alone leaves the other three invisible edge-on. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {doors.map((d, i) => {
              const active = ((angle % 360) + 360) % 360 === i * 90;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => { setStill(true); setAngle((a) => a + shortestTurn(a, i)); }}
                  aria-pressed={active}
                  className={
                    'rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ' +
                    (active ? 'bg-amber-200/15 text-amber-100' : 'text-white/40 hover:text-white/80')
                  }
                >
                  {d.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <FadeIn className="relative z-10 mx-auto mt-14 max-w-xl text-center" y={24}>
        <a
          href="/studio.html"
          className="liquid-glass inline-block rounded-full px-9 py-4 text-sm font-semibold uppercase tracking-wider text-amber-100 transition-colors hover:bg-amber-200/10"
        >
          Take all three — ₹{combo.price} <span className="text-white/40 line-through">₹{combo.insteadOf}</span>
          <span className="ml-2 text-emerald-300">save ₹{combo.saving}</span>
        </a>
        <p className="mt-4 text-xs leading-relaxed text-white/45">
          Pay now, or after you complete — your certificate waits, your learning does not.
          On a paid internship track? All of it is already yours.
        </p>
      </FadeIn>
    </section>
  );
}

function DoorCard({ door }: { door: Door }) {
  return (
    <a
      href={door.href}
      className="liquid-glass group flex h-full flex-col justify-between rounded-3xl p-7 text-left transition-colors hover:bg-white/5"
    >
      <div>
        <span aria-hidden="true" className="text-3xl">{door.icon}</span>
        <h3 className="mt-4 text-xl font-bold text-white">{door.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{door.line}</p>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm font-bold text-amber-200">{door.price}</span>
        <span className="text-sm text-white/50 transition-transform group-hover:translate-x-1">Unlock →</span>
      </div>
    </a>
  );
}
