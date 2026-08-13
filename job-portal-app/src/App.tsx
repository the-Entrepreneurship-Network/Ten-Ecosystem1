import { useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { FadeIn } from './components/FadeIn';
import { navigateToRoute } from './shared';

const ASSETS = '/assets/job-portal';

const inter = { fontFamily: "'Inter', sans-serif" };

/* ---------- metricx-style hero: orange, fullscreen video, pill nav ---------- */

const NAV_ITEMS = [
  { id: 'student', label: 'STUDENT' },
  { id: 'job', label: 'JOB' },
  { id: 'resume', label: 'RESUME' },
];

const STAT_CARDS: [string, string][] = [
  ['1.4k+', 'Live jobs tracked'],
  ['92%', 'Resume match rate'],
];

function Hero() {
  const [videoOk, setVideoOk] = useState(true);

  return (
    <div id="home" className="relative min-h-screen overflow-hidden" style={{ backgroundColor: '#e02b10' }}>
      {videoOk && (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          src={`${ASSETS}/hero-suit.mp4`}
          onError={() => setVideoOk(false)}
        />
      )}

      <nav className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between gap-2 px-4 py-4 sm:px-6 md:px-10 md:py-5">
        <div className="flex items-center gap-3 sm:gap-6">
          <span className="display-font text-lg text-white">TEN</span>
          <div className="flex items-center gap-2">
            {NAV_ITEMS.map(({ id, label }) => {
              const isActive = id === 'job';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigateToRoute(id)}
                  className={
                    isActive
                      ? 'rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition-all hover:bg-white/90 sm:px-5'
                      : 'rounded-full border border-white/60 px-4 py-2 text-xs text-white transition-all hover:border-white hover:bg-white/10 sm:px-5'
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
          className="whitespace-nowrap rounded-full border border-white px-3 py-2 text-xs text-white transition-all hover:bg-white hover:text-red-600 sm:px-5"
          style={inter}
        >
          Dashboard
        </button>
      </nav>

      <div className="relative z-20 flex min-h-screen flex-col px-4 sm:px-6 md:px-10">
        <div className="h-[72px] shrink-0" />

        <div
          className="mx-auto flex flex-1 flex-col gap-10 py-8 md:flex-row md:items-center md:justify-between md:gap-32 md:py-0"
          style={{ maxWidth: '1100px', width: '100%' }}
        >
          <div className="max-w-[260px]">
            <p className="mb-2 text-[13px] font-bold uppercase leading-snug tracking-[0.22em] text-white" style={inter}>
              TEN
              <br />
              JOB NETWORK
            </p>
            <p className="text-[13px] leading-relaxed text-white opacity-80" style={inter}>
              Real jobs, in real time,
              <br />
              matched to your resume by AI
            </p>
          </div>

          <div className="max-w-[280px] text-left">
            <p className="mb-3 text-[14px] leading-relaxed text-white" style={inter}>
              Upload your resume once. Our agent reads what you are — full-stack dev, designer,
              analyst — and hunts live openings for exactly that, around the clock.
            </p>
            <p className="text-[13px] leading-loose text-white opacity-70" style={inter}>
              LinkedIn&ensp;Google&ensp;Upwork
              <br />
              Fiverr&ensp;Instagram&ensp;Naukri
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-8 pb-8 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1">
            <h1
              className="display-font mb-6 select-none text-white md:mb-10"
              style={{ fontSize: 'clamp(52px, 12vw, 145px)', lineHeight: 0.82, width: 'fit-content' }}
            >
              job
              <br />
              portal
            </h1>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <p className="text-[14px] leading-relaxed text-white" style={{ ...inter, minWidth: '160px' }}>
                Real jobs only. Your
                <br />
                resume does the talking.
              </p>
              <button
                type="button"
                onClick={() => navigateToRoute('journey')}
                className="w-full rounded-full bg-white font-semibold text-black shadow-lg transition-all hover:bg-gray-100 active:scale-95 sm:w-auto"
                style={{ ...inter, fontSize: '15px', whiteSpace: 'nowrap', padding: '24px 60px' }}
              >
                start your job journey
              </button>
            </div>
          </div>

          <div className="flex gap-4 sm:gap-6">
            {STAT_CARDS.map(([value, label]) => (
              <div
                key={label}
                className="flex flex-1 flex-col items-start justify-between rounded-2xl px-5 py-5 text-left sm:px-6 lg:flex-initial"
                style={{ minWidth: '150px', minHeight: '150px', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)' }}
              >
                <p className="display-font leading-none" style={{ fontSize: 'clamp(2rem, 6vw, 2.6rem)', color: '#111' }}>
                  {value}
                </p>
                <p className="mt-auto text-[12px]" style={{ ...inter, color: '#888' }}>
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- credit-card-site style: suitcase falls through the sections ---------- */

const FALL_PANELS = [
  {
    title: ['Symbol of', 'earning power.'],
    body: 'The suitcase is yours. Every module you finished, every project you shipped in the Student Portal — it all packs into the resume this portal runs on.',
  },
  {
    title: ['Your resume.', 'Real jobs.'],
    body: 'Upload it once. The AI agent reads who you are — full-stack developer, data scientist, designer — and scrapes live openings for exactly that from LinkedIn, Google, Upwork, Fiverr, Instagram and Naukri.',
  },
  {
    title: ['No noise.', 'No dead listings.'],
    body: 'Only real, current openings that match your stack. Fresh matches land the moment they are posted — you apply while everyone else is still searching.',
  },
];

function SuitcaseFall() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  const y = useTransform(scrollYProgress, [0, 1], ['-60vh', '160vh']);
  const rotate = useTransform(scrollYProgress, [0, 1], [-25, 380]);
  const x = useTransform(scrollYProgress, [0, 0.5, 1], ['18vw', '30vw', '10vw']);

  return (
    <div ref={ref} className="relative bg-[#050505]" style={{ height: `${FALL_PANELS.length * 100}vh` }}>
      {/* the falling suitcase — one sticky layer above the panels */}
      <div className="pointer-events-none sticky top-0 z-20 h-0">
        <motion.img
          src={`${ASSETS}/suitcase.png`}
          alt=""
          className="absolute w-[38vw] max-w-[440px]"
          style={{ y, rotate, x, mixBlendMode: 'screen' }}
        />
      </div>

      {FALL_PANELS.map(({ title, body }) => (
        <section key={title[0]} className="flex h-screen items-center px-6 md:px-16">
          <div className="max-w-[560px]">
            <h2 className="display-font ghost-heading mb-6 text-white" style={{ fontSize: 'clamp(38px, 6.5vw, 78px)', lineHeight: 0.95 }}>
              {title[0]}
              <br />
              {title[1]}
            </h2>
            <FadeIn>
              <p className="text-[15px] leading-relaxed text-white/70" style={inter}>
                {body}
              </p>
            </FadeIn>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- features ---------- */

const FEATURES: [string, string][] = [
  ['Resume upload', 'One PDF. The agent parses your skills, stack and experience — no forms.'],
  ['AI job scraping', 'LinkedIn, Google Jobs, Upwork, Fiverr, Instagram, Naukri — scanned continuously for your profile.'],
  ['Real-time matches', 'Openings reach you the moment they go live, ranked by fit to your resume.'],
  ['One profile, all portals', 'Your Student Portal certificate and coins carry straight into your job profile.'],
  ['Skill-gap notes', 'When a dream job needs one more skill, the agent points you to the exact TEN module.'],
  ['Freelance included', 'Not just full-time — gigs and contracts from Upwork and Fiverr count too.'],
];

function Features() {
  return (
    <div className="bg-[#050505] px-6 py-24 md:px-16">
      <FadeIn>
        <h2 className="display-font mb-14 text-white" style={{ fontSize: 'clamp(32px, 5vw, 60px)' }}>
          What the portal does
        </h2>
      </FadeIn>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ maxWidth: '1100px' }}>
        {FEATURES.map(([title, body], i) => (
          <FadeIn key={title} delay={i * 0.06}>
            <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <p className="mb-2 font-bold text-white" style={inter}>
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

/* ---------- finale: he catches the suitcase, straightens his tie ---------- */

function Finale() {
  const [videoOk, setVideoOk] = useState(true);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-end overflow-hidden bg-[#050505] pb-20">
      {videoOk && (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-80"
          autoPlay
          muted
          loop
          playsInline
          src={`${ASSETS}/catch-tie.mp4`}
          onError={() => setVideoOk(false)}
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(180deg, #050505 0%, transparent 30%, transparent 60%, rgba(5,5,5,0.9) 100%)' }}
      />
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <FadeIn>
          <h2 className="display-font ghost-heading mb-8 text-white" style={{ fontSize: 'clamp(36px, 6vw, 72px)', lineHeight: 1 }}>
            Catch yours.
          </h2>
        </FadeIn>
        <FadeIn delay={0.15}>
          <button
            type="button"
            onClick={() => navigateToRoute('journey')}
            className="rounded-full bg-white font-semibold text-black shadow-2xl transition-all hover:scale-[1.03] active:scale-95"
            style={{ ...inter, fontSize: '17px', padding: '26px 70px' }}
          >
            START YOUR JOB JOURNEY →
          </button>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="mt-10 flex gap-6 text-[13px] text-white/60" style={inter}>
            <a href="/student-portal/" className="hover:text-white">Student Portal</a>
            <a href="/academics.html" className="hover:text-white">Academics</a>
            <a href="/coming-soon.html" className="hover:text-white">Resume Portal</a>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <main>
      <Hero />
      <SuitcaseFall />
      <Features />
      <Finale />
    </main>
  );
}
