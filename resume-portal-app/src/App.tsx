import { useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { FadeIn } from './components/FadeIn';
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

function SlashSplit() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  // 0 → .35: slash line draws across; .35 → 1: the two halves slide apart
  const slashScale = useTransform(scrollYProgress, [0, 0.3], [0, 1]);
  const slashOpacity = useTransform(scrollYProgress, [0, 0.05, 0.35, 0.5], [0, 1, 1, 0]);
  const upperY = useTransform(scrollYProgress, [0.35, 1], ['0%', '-102%']);
  const upperX = useTransform(scrollYProgress, [0.35, 1], ['0%', '-6%']);
  const lowerY = useTransform(scrollYProgress, [0.35, 1], ['0%', '102%']);
  const lowerX = useTransform(scrollYProgress, [0.35, 1], ['0%', '6%']);

  const halfBase = 'absolute inset-0 flex items-center justify-center bg-[#120a04]';
  const SLASH_ANGLE = -8; // degrees — matches the cut line's tilt

  return (
    <div ref={ref} className="relative" style={{ height: '250vh' }}>
      <div className="sticky top-0 h-screen overflow-hidden bg-[#050505]">
        {/* what's revealed behind the cut */}
        <div className="absolute inset-0 flex items-center justify-center bg-[#050505]">
          <p className="px-6 text-center text-2xl text-amber-200/90 md:text-4xl" style={cinzel}>
            The stone breaks next.
          </p>
        </div>

        {/* upper half of the "page" being cut */}
        <motion.div
          className={halfBase}
          style={{
            y: upperY,
            x: upperX,
            clipPath: `polygon(0 0, 100% 0, 100% ${50 - 7}%, 0 ${50 + 7}%)`,
          }}
        >
          <SlashFace />
        </motion.div>

        {/* lower half */}
        <motion.div
          className={halfBase}
          style={{
            y: lowerY,
            x: lowerX,
            clipPath: `polygon(0 ${50 + 7}%, 100% ${50 - 7}%, 100% 100%, 0 100%)`,
          }}
        >
          <SlashFace />
        </motion.div>

        {/* the blade line */}
        <motion.div
          className="absolute left-[-10%] top-1/2 h-[3px] w-[120%] origin-left"
          style={{
            scaleX: slashScale,
            opacity: slashOpacity,
            rotate: SLASH_ANGLE,
            background: 'linear-gradient(90deg, transparent, #ffe9b8 15%, #fff 50%, #ffe9b8 85%, transparent)',
            boxShadow: '0 0 24px 4px rgba(255,220,150,0.8)',
          }}
        />
      </div>
    </div>
  );
}

function SlashFace() {
  return (
    <div className="px-6 text-center">
      <p className="mb-3 text-[12px] uppercase tracking-[0.35em] text-amber-100/50" style={inter}>
        One cut. One chance.
      </p>
      <p className="text-3xl leading-snug text-amber-100 md:text-6xl" style={cinzel}>
        YOUR OLD RESUME
        <br />
        ENDS HERE
      </p>
    </div>
  );
}

/* ---------- the rocks break open and the resume rises ---------- */

const SHARDS: { clip: string; x: number; y: number; r: number }[] = [
  { clip: 'polygon(0 0, 22% 0, 12% 30%, 0 18%)', x: -260, y: -180, r: -38 },
  { clip: 'polygon(22% 0, 48% 0, 40% 22%, 18% 26%)', x: -90, y: -260, r: 22 },
  { clip: 'polygon(48% 0, 78% 0, 70% 18%, 45% 24%)', x: 120, y: -240, r: -18 },
  { clip: 'polygon(78% 0, 100% 0, 100% 26%, 74% 20%)', x: 280, y: -160, r: 42 },
  { clip: 'polygon(0 70%, 16% 62%, 10% 100%, 0 100%)', x: -300, y: 170, r: 30 },
  { clip: 'polygon(84% 66%, 100% 72%, 100% 100%, 88% 100%)', x: 300, y: 190, r: -30 },
];

function RockBreak() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const leftX = useTransform(scrollYProgress, [0.1, 0.6], ['0%', '-58%']);
  const rightX = useTransform(scrollYProgress, [0.1, 0.6], ['0%', '58%']);
  const halvesRot = useTransform(scrollYProgress, [0.1, 0.6], [0, 9]);
  const glow = useTransform(scrollYProgress, [0.05, 0.4], [0, 1]);
  const resumeY = useTransform(scrollYProgress, [0.35, 0.75], ['60vh', '0vh']);
  const resumeScale = useTransform(scrollYProgress, [0.35, 0.75], [0.6, 1]);
  const titleOpacity = useTransform(scrollYProgress, [0.65, 0.85], [0, 1]);

  return (
    <div ref={ref} className="relative" style={{ height: '300vh' }}>
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden bg-[#050505]">
        {/* boulder halves */}
        <motion.img
          src={`${ASSETS}/boulder.jpg`}
          alt=""
          className="absolute w-[80vw] max-w-[900px]"
          style={{ x: leftX, rotate: useTransform(halvesRot, (v) => -v), clipPath: 'inset(0 50% 0 0)', mixBlendMode: 'screen' }}
        />
        <motion.img
          src={`${ASSETS}/boulder.jpg`}
          alt=""
          className="absolute w-[80vw] max-w-[900px]"
          style={{ x: rightX, rotate: halvesRot, clipPath: 'inset(0 0 0 50%)', mixBlendMode: 'screen' }}
        />

        {/* flying shards */}
        {SHARDS.map(({ clip, x, y, r }, i) => (
          <motion.img
            key={i}
            src={`${ASSETS}/boulder.jpg`}
            alt=""
            className="absolute w-[80vw] max-w-[900px]"
            style={{
              clipPath: clip,
              mixBlendMode: 'screen',
              x: useTransform(scrollYProgress, [0.1, 0.7], [0, x]),
              y: useTransform(scrollYProgress, [0.1, 0.7], [0, y]),
              rotate: useTransform(scrollYProgress, [0.1, 0.7], [0, r]),
              opacity: useTransform(scrollYProgress, [0.6, 0.85], [1, 0]),
            }}
          />
        ))}

        {/* golden glow from the crack */}
        <motion.div
          className="pointer-events-none absolute h-[70vh] w-[40vw] rounded-full"
          style={{
            opacity: glow,
            background: 'radial-gradient(ellipse, rgba(255,196,94,0.35) 0%, transparent 65%)',
          }}
        />

        {/* the resume rises out of the rock */}
        <motion.div style={{ y: resumeY, scale: resumeScale }} className="relative z-10">
          <ResumeCard />
        </motion.div>

        <motion.h2
          className="absolute bottom-10 px-6 text-center text-xl text-amber-200 md:text-3xl"
          style={{ ...cinzel, opacity: titleOpacity }}
        >
          One to make an irreplaceable, unrejected resume.
        </motion.h2>
      </div>
    </div>
  );
}

function ResumeCard() {
  return (
    <div
      className="w-[300px] rounded-lg bg-white p-6 text-black shadow-2xl md:w-[340px]"
      style={{ boxShadow: '0 0 80px rgba(255,196,94,0.45), 0 30px 60px rgba(0,0,0,0.8)' }}
    >
      <div className="mb-4 border-b border-black/10 pb-3">
        <p className="text-lg font-bold" style={inter}>Your Name</p>
        <p className="text-[12px] text-black/60" style={inter}>Full-Stack Developer · ATS score 98/100</p>
      </div>
      {['Experience', 'Projects', 'Skills'].map((section) => (
        <div key={section} className="mb-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-black/70" style={inter}>
            {section}
          </p>
          <div className="space-y-1.5">
            <div className="h-2 w-full rounded bg-black/10" />
            <div className="h-2 w-4/5 rounded bg-black/10" />
          </div>
        </div>
      ))}
      <div className="mt-4 rounded bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700" style={inter}>
        ✓ Passes every ATS filter — unrejectable
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
      <SlashSplit />
      <RockBreak />
      <Features />
      <Finale />
    </main>
  );
}
