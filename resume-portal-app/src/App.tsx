import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { FadeIn } from './components/FadeIn';
import { AgentHero, AgentChat } from './components/ResumeAgent';
import { navigateToRoute } from './shared';

const ASSETS = '/assets/resume-portal';

const inter = { fontFamily: "'Inter', sans-serif" };
const cinzel = { fontFamily: "'Cinzel', serif" };

const NAV_ITEMS = [
  { id: 'student', label: 'STUDENT' },
  { id: 'job', label: 'JOB' },
  { id: 'resume', label: 'RESUME' },
];

/* ---------- samurai legacy hero ---------- */

function Hero() {
  const [videoOk, setVideoOk] = useState(true);

  return (
    <div id="home" className="relative min-h-screen overflow-hidden bg-[#0a0603]">
      {videoOk && (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          autoPlay
          muted
          loop
          playsInline
          src={`${ASSETS}/samurai.mp4`}
          onError={() => setVideoOk(false)}
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(10,6,3,0.55) 0%, transparent 35%, transparent 65%, #0a0603 100%)' }}
      />

      <nav className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between gap-2 px-4 py-4 sm:px-6 md:px-10 md:py-5">
        <div className="flex items-center gap-3 sm:gap-6">
          <span className="text-lg font-bold tracking-widest text-amber-200" style={cinzel}>TEN</span>
          <div className="flex items-center gap-2">
            {NAV_ITEMS.map(({ id, label }) => {
              const isActive = id === 'resume';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigateToRoute(id)}
                  className={
                    isActive
                      ? 'rounded-full bg-amber-200 px-4 py-2 text-xs font-bold text-black transition-all hover:bg-amber-100 sm:px-5'
                      : 'rounded-full border border-amber-200/50 px-4 py-2 text-xs text-amber-100 transition-all hover:border-amber-200 hover:bg-amber-200/10 sm:px-5'
                  }
                  style={inter}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigateToRoute('dashboard')}
          className="whitespace-nowrap rounded-full border border-amber-200/70 px-3 py-2 text-xs text-amber-100 transition-all hover:bg-amber-200 hover:text-black sm:px-5"
          style={inter}
        >
          Dashboard
        </button>
      </nav>

      <div className="relative z-20 flex min-h-screen flex-col justify-between px-6 pb-10 pt-28 md:px-12">
        <div className="max-w-[420px]">
          <h1 className="mb-4 text-3xl leading-tight text-amber-100 md:text-5xl" style={cinzel}>
            THE LEGACY OF
            <br />
            THE RESUME
          </h1>
          <p className="text-[13px] leading-relaxed text-amber-100/70" style={inter}>
            For centuries, the blade decided who passed. Today it is your resume. Forge one that no
            ATS, no recruiter, no filter can reject.
          </p>
        </div>

        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div
            className="rounded-2xl border border-amber-200/25 px-6 py-5"
            style={{ background: 'rgba(20,10,4,0.65)', backdropFilter: 'blur(8px)' }}
          >
            <p className="text-3xl font-bold text-amber-200" style={cinzel}>98%</p>
            <p className="mt-1 max-w-[200px] text-[12px] leading-relaxed text-amber-100/70" style={inter}>
              of resumes forged here clear ATS screening filters
            </p>
          </div>
          <p className="animate-pulse text-[12px] uppercase tracking-[0.3em] text-amber-100/60" style={inter}>
            Ready to forge? Scroll — the blade falls ↓
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- the samurai cuts the page: slash draws, screen splits apart ---------- */

/* ---------- one frame: the blade meets the ROCK, it shatters, the 3D resume
   appears — all in place, nobody has to keep scrolling to see it ---------- */

function CutTheStone() {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fired, setFired] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  /* scroll only draws the blade toward the stone; crossing the cut point
     fires the whole sequence in place — the explosion film plays itself and
     the resume erupts right after, in the same frame */
  useEffect(() => {
    return scrollYProgress.on('change', (v) => {
      if (v >= 0.3 && !fired) {
        setFired(true);
        const vid = videoRef.current;
        if (vid) {
          vid.playbackRate = 1.6;
          vid.play().catch(() => {});
        }
        setTimeout(() => setShowResume(true), 1400);
      }
    });
  }, [scrollYProgress, fired]);

  const slashScale = useTransform(scrollYProgress, [0.02, 0.3], [0, 1]);
  const slashOpacity = useTransform(scrollYProgress, [0, 0.05], [0, 1]);

  return (
    <div ref={ref} className="relative" style={{ height: '220vh' }}>
      <div className={`sticky top-0 h-screen overflow-hidden bg-[#050505] ${fired ? 'cut-shake' : ''}`}>
        {/* the stone waits on its first frame; the cut detonates it */}
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          src={`${ASSETS}/rockbreak.mp4`}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* the blade, drawn by scroll straight onto the stone */}
        {!showResume && (
          <motion.div
            className="absolute left-[-10%] top-1/2 h-[5px] w-[120%] origin-left"
            style={{
              scaleX: slashScale,
              opacity: fired ? 0 : slashOpacity,
              rotate: -8,
              transition: 'opacity .4s',
              background: 'linear-gradient(90deg, transparent, #ffe9b8 10%, #fff 50%, #ffe9b8 90%, transparent)',
              boxShadow: '0 0 18px 6px rgba(255,220,150,0.95), 0 0 70px 24px rgba(255,180,80,0.45)',
            }}
          />
        )}
        {fired && <div className="cut-flash pointer-events-none absolute inset-0 bg-white" />}

        {!fired && (
          <p className="absolute bottom-10 w-full text-center text-[12px] uppercase tracking-[0.3em] text-amber-100/60" style={inter}>
            Scroll — the blade meets the stone
          </p>
        )}

        {/* the 3D resume erupts from the broken stone — same frame, no scroll */}
        <motion.div
          initial={false}
          animate={showResume ? { y: 0, scale: 1, rotate: 0, opacity: 1 } : { y: '68vh', scale: 0.45, rotate: -9, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 60, damping: 14 }}
          className="relative z-10 flex h-full flex-col items-center justify-center"
        >
          <img
            src={`${ASSETS}/resume3d.png`}
            alt="The unrejectable resume"
            className="w-[240px] md:w-[300px]"
            style={{ filter: 'drop-shadow(0 0 60px rgba(255,196,94,0.55)) drop-shadow(0 30px 50px rgba(0,0,0,0.8))' }}
          />
          <div className="mt-4 rounded-full bg-emerald-950/80 px-4 py-2 text-[12px] font-semibold text-emerald-300" style={inter}>
            ✓ ATS 98/100 — unrejectable
          </div>
        </motion.div>

        {showResume && (
          <h2 className="fade-in absolute bottom-10 w-full px-6 text-center text-xl text-amber-200 md:text-3xl" style={cinzel}>
            One to make an irreplaceable, unrejected resume.
          </h2>
        )}
      </div>
    </div>
  );
}

/* ---------- features ---------- */

const FEATURES: [string, string][] = [
  ['ATS-proof formatting', 'Clean structure every applicant-tracking system parses perfectly — no silent rejections.'],
  ['AI resume checkup', 'Upload your PDF and the AI scores it: ATS-ready or not, with exact feedback on what fails.'],
  ['Tailored, not templated', 'The AI rewrites your existing resume — keywords, order, phrasing — for the jobs you want.'],
  ['Built from your details', 'No resume yet? Give your details and the AI forges a complete one from scratch.'],
  ['Priority shortlisting', 'Optimized resumes rank higher in recruiter searches — you get seen first, not last.'],
  ['Feeds the Job Portal', 'Your forged resume plugs straight into the Job Portal agent that hunts live openings for you.'],
];

function Features() {
  return (
    <div className="bg-[#050505] px-6 py-24 md:px-16">
      <FadeIn>
        <h2 className="mb-3 text-3xl text-amber-200 md:text-5xl" style={cinzel}>
          The forge
        </h2>
        <p className="mb-14 max-w-[540px] text-[14px] leading-relaxed text-white/60" style={inter}>
          Everything the Resume Portal does so you never hear a silent no again.
        </p>
      </FadeIn>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ maxWidth: '1100px' }}>
        {FEATURES.map(([title, body], i) => (
          <FadeIn key={title} delay={i * 0.06}>
            <div className="h-full rounded-2xl border border-amber-200/15 bg-white/[0.03] p-6">
              <p className="mb-2 font-bold text-amber-100" style={inter}>
                {title}
              </p>
              <p className="text-[14px] leading-relaxed text-white/60" style={inter}>
                {body}
              </p>
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  );
}

/* ---------- finale ---------- */

function Finale() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#050505] px-6 pb-20 text-center">
      <FadeIn>
        <h2 className="mb-8 text-3xl leading-snug text-amber-100 md:text-5xl" style={cinzel}>
          Forge yours.
        </h2>
      </FadeIn>
      <FadeIn delay={0.15}>
        <button
          type="button"
          onClick={() => navigateToRoute('build')}
          className="rounded-full bg-amber-200 font-semibold text-black shadow-2xl transition-all hover:scale-[1.03] hover:bg-amber-100 active:scale-95"
          style={{ ...inter, fontSize: '17px', padding: '26px 70px' }}
        >
          START BUILDING YOUR RESUME →
        </button>
      </FadeIn>
      <FadeIn delay={0.3}>
        <div className="mt-10 flex gap-6 text-[13px] text-white/60" style={inter}>
          <a href="/student-portal/" className="hover:text-white">Student Portal</a>
          <a href="/job-portal/" className="hover:text-white">Job Portal</a>
          <a href="/academics.html" className="hover:text-white">Academics</a>
        </div>
      </FadeIn>
    </div>
  );
}

export default function App() {
  return (
    <main>
      <Hero />
      <CutTheStone />
      <AgentHero />
      <AgentChat />
      <Features />
      <Finale />
    </main>
  );
}
