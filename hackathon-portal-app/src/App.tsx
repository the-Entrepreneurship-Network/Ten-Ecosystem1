import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { FadeIn } from './components/FadeIn';
import MatrixRain from './components/MatrixRain';
import GlitterStream from './components/GlitterStream';
import EventBoard from './components/EventBoard';

const ASSETS = '/assets/hackathon';
const inter = { fontFamily: "'Inter', sans-serif" };

/*
 * JOB and RESUME used to link straight into those portals, which the Studio
 * paywall (middleware/studioGate.js) now turns away — two links to a bounce.
 * The nav points at the pages a visitor can actually open, and the sections
 * they need on this one.
 */
const NAV = [
  { label: 'STUDENT', href: '/student-portal/' },
  { label: 'HACK', href: '#top', active: true },
  { label: 'HOW IT WORKS', href: '#how' },
  { label: 'EVENTS', href: '#events' },
  { label: 'MY TEAM', href: '#team' },
];

/* ---------- 01 · the rain and the hooded coder ---------- */

function RainHero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const coderY = useTransform(scrollYProgress, [0, 1], ['0%', '18%']);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div id="top" ref={ref} className="relative min-h-screen overflow-hidden bg-[#04070a]">
      {/* the rain falls behind everything, edge to edge */}
      <MatrixRain className="absolute inset-0 h-full w-full" />

      {/* the coder, lit from the screen, breathing */}
      <motion.div className="absolute inset-0 flex items-end justify-center" style={{ y: coderY, opacity: fade }}>
        <img
          src={`${ASSETS}/hooded-coder.jpg`}
          alt=""
          className="h-[78vh] w-auto max-w-none object-contain"
          style={{
            mixBlendMode: 'screen',
            animation: 'coderFloat 7s ease-in-out infinite, screenFlicker 5.5s linear infinite',
            filter: 'contrast(1.12) saturate(1.15)',
          }}
        />
      </motion.div>

      {/* readability, without hiding the rain */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 55%, transparent 20%, rgba(4,7,10,0.72) 78%), linear-gradient(180deg, rgba(4,7,10,0.85) 0%, transparent 26%, transparent 62%, #04070a 100%)' }} />

      <nav className="relative z-20 flex items-center justify-between px-4 py-5 sm:px-8">
        <span className="display-font text-lg text-emerald-300 glow-green">TEN</span>
        <div className="flex items-center gap-2">
          {NAV.map((n) => (
            <a
              key={n.label}
              href={n.href}
              className={
                n.active
                  ? 'rounded-full bg-emerald-400 px-4 py-2 text-[11px] font-bold tracking-wider text-black sm:px-5'
                  : 'rounded-full border border-emerald-400/40 px-4 py-2 text-[11px] font-semibold tracking-wider text-emerald-200/80 transition-colors hover:border-emerald-300 hover:text-emerald-100 sm:px-5'
              }
              style={inter}
            >
              {n.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="relative z-20 flex min-h-[calc(100vh-92px)] flex-col justify-center px-5 sm:px-10">
        <p className="mono mb-4 text-[12px] tracking-[0.32em] text-emerald-300/90">
          &gt; TEN HACKATHONS &amp; IDEATHONS<span style={{ animation: 'caretBlink 1s step-end infinite' }}>_</span>
        </p>
        <h1 className="display-font max-w-[16ch] text-white" style={{ fontSize: 'clamp(44px, 9vw, 132px)', lineHeight: 0.9 }}>
          BUILD IT
          <br />
          <span className="text-emerald-300 glow-green">IN 48 HOURS</span>
        </h1>
        <p className="mt-6 max-w-[560px] text-[15px] leading-relaxed text-white/70" style={inter}>
          Wanna make a team and win? Learn code, hack the problem, ship the thing.
          One weekend, one repo, one demo that has to actually run.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="#register"
            className="rounded-full bg-emerald-400 px-8 py-4 text-[14px] font-bold text-black transition-transform hover:scale-[1.04]"
            style={inter}
          >
            FIND MY TEAM →
          </a>
          <a
            href="#tracks"
            className="rounded-full border border-emerald-300/50 px-8 py-4 text-[14px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/10"
            style={inter}
          >
            See the tracks
          </a>
        </div>

        <div className="mono mt-14 flex flex-wrap gap-x-8 gap-y-2 text-[11.5px] tracking-[0.16em] text-emerald-200/55">
          <span>48 HOURS</span>
          <span>4 PER TEAM</span>
          <span>LIVE MENTORS</span>
          <span>JUDGED ON WORKING CODE</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- 02 · she types, the sparks come out ---------- */

function GlitterSection() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06040a]">
      <GlitterStream className="absolute inset-0 h-full w-full" />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1300px] items-center gap-8 px-5 py-20 sm:px-10 lg:grid-cols-2">
        <div>
          <p className="mono mb-4 text-[12px] tracking-[0.3em] text-fuchsia-300/90">&gt; IDEATHON MODE</p>
          <h2 className="display-font text-white" style={{ fontSize: 'clamp(38px, 6.4vw, 92px)', lineHeight: 0.94 }}>
            YOUR IDEA,
            <br />
            <span className="text-fuchsia-300 glow-violet">OUT LOUD</span>
          </h2>
          <p className="mt-6 max-w-[520px] text-[15px] leading-relaxed text-white/70" style={inter}>
            No code yet? Bring the idea. Ideathons are 24 hours of shaping a problem into a
            pitch — a real user, a real number, a slide deck that survives questions.
            Then a team forms around it and the hackathon builds it.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#register" className="rounded-full bg-fuchsia-400 px-8 py-4 text-[14px] font-bold text-black transition-transform hover:scale-[1.04]" style={inter}>
              PITCH AN IDEA →
            </a>
          </div>

          <div className="mono mt-12 flex flex-wrap gap-x-8 gap-y-2 text-[11.5px] tracking-[0.16em] text-fuchsia-200/55">
            <span>24 HOURS</span>
            <span>NO CODE NEEDED</span>
            <span>MENTOR REVIEW</span>
            <span>DECK + DEMO</span>
          </div>
        </div>

        <div className="relative">
          <img
            src={`${ASSETS}/glitter-coder.jpg`}
            alt=""
            className="w-full rounded-3xl border border-fuchsia-400/20 object-cover"
            style={{ animation: 'coderFloat 8s ease-in-out infinite', boxShadow: '0 0 90px rgba(200,80,255,0.22)' }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- 03 · what you get ---------- */

const TRACKS: [string, string, string][] = [
  ['⚡', 'The 48-hour build', 'Friday brief, Sunday demo. A repo that runs, or it does not count. Nobody is graded on a slide about what you would have built.'],
  ['🧠', 'Ideathon first', 'No code? Start here. Shape a problem, size the market, defend the pitch — then find the builders who want in.'],
  ['🤝', 'Team matching', 'Solo entry is fine. We pair you by stack and timezone so nobody spends Saturday hunting for a backend.'],
  ['🎧', 'Mentors on call', 'Domain coordinators live through the night. Stuck at 2am on a deploy is a solved problem here.'],
  ['🏆', 'Judged on what runs', 'Working code, real users, honest metrics. Three judges, one rubric, published before you start.'],
  ['📜', 'Certificate + repo', 'Every finisher leaves with a verifiable TEN certificate and a public repo the Job Portal agent can point recruiters at.'],
];

function Tracks() {
  return (
    <div id="tracks" className="bg-[#04070a] px-5 py-24 sm:px-10">
      <FadeIn>
        <p className="mono mb-3 text-[12px] tracking-[0.3em] text-emerald-300/80">&gt; WHAT YOU GET</p>
        <h2 className="display-font mb-14 text-white" style={{ fontSize: 'clamp(32px, 5vw, 62px)' }}>
          Ship something real
        </h2>
      </FadeIn>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ maxWidth: '1200px' }}>
        {TRACKS.map(([icon, title, body], i) => (
          <FadeIn key={title} delay={i * 0.06}>
            <div className="h-full rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.03] p-6 transition-colors hover:border-emerald-400/40">
              <span className="text-[26px]">{icon}</span>
              <p className="mb-2 mt-3 text-[16px] font-bold text-white" style={inter}>{title}</p>
              <p className="text-[13.5px] leading-relaxed text-white/60" style={inter}>{body}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  );
}

/* ---------- 03b · how it actually works ----------
   The page had atmosphere and no answer to the only question a first-timer
   actually has: what do I do, what do I need, and what does it cost? Six
   numbered steps, in order, in plain words. */

const STEPS: [string, string, string][] = [
  ['01', 'Pick an event', 'Every open hackathon is listed below with its theme, dates, prize and entry fee. Read the brief before you commit — they are not all the same shape.'],
  ['02', 'Register', 'Fill in the form on the event. You pay the entry fee at registration; your place is held the moment it clears.'],
  ['03', 'Get a team — or bring one', 'Up to four per team. Come with your own, or enter solo and we pair you by stack and timezone before the brief drops.'],
  ['04', 'Build for 48 hours', 'The brief lands Friday evening. Mentors are on call through the night. Commit as you go — the repo history is part of what is judged.'],
  ['05', 'Demo on Sunday', 'Submit a repo that runs and a short demo. Working code beats a beautiful slide about code you did not write.'],
  ['06', 'Get judged, get the certificate', 'Three judges, one published rubric. Every finisher leaves with a verifiable TEN certificate and a public repo.'],
];

const NEED: [string, string][] = [
  ['A laptop and internet', 'That is genuinely the hardware list.'],
  ['A GitHub account', 'The repo is the submission. Make it public before the deadline.'],
  ['Any skill level', 'No code yet? Enter the ideathon track and pitch instead.'],
  ['The entry fee', 'Shown on each event, paid at registration. Nothing else to buy.'],
];

function HowItWorks() {
  return (
    <div id="how" className="bg-[#04070a] px-5 py-24 sm:px-10">
      <FadeIn>
        <p className="mono mb-3 text-[12px] tracking-[0.3em] text-emerald-300/80">&gt; HOW IT WORKS</p>
        <h2 className="display-font mb-4 text-white" style={{ fontSize: 'clamp(32px, 5vw, 62px)' }}>
          Six steps, start to certificate
        </h2>
        <p className="mb-14 max-w-2xl text-[14.5px] leading-relaxed text-white/55" style={inter}>
          First hackathon? This is the whole of it. No prior competition, no team and no finished
          idea required before you sign up.
        </p>
      </FadeIn>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ maxWidth: '1200px' }}>
        {STEPS.map(([n, title, body], i) => (
          <FadeIn key={n} delay={i * 0.05}>
            <div className="h-full rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.03] p-6">
              <span className="mono text-[13px] font-bold tracking-[0.2em] text-emerald-300/90">{n}</span>
              <p className="mb-2 mt-3 text-[16px] font-bold text-white" style={inter}>{title}</p>
              <p className="text-[13.5px] leading-relaxed text-white/60" style={inter}>{body}</p>
            </div>
          </FadeIn>
        ))}
      </div>

      <FadeIn delay={0.1}>
        <div className="mt-12 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-7" style={{ maxWidth: '1200px' }}>
          <p className="mono mb-5 text-[12px] tracking-[0.28em] text-emerald-300/80">&gt; WHAT YOU NEED</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {NEED.map(([title, body]) => (
              <div key={title}>
                <p className="mb-1 text-[14.5px] font-bold text-white" style={inter}>{title}</p>
                <p className="text-[13px] leading-relaxed text-white/55" style={inter}>{body}</p>
              </div>
            ))}
          </div>
          <a href="#events"
             className="mt-7 inline-block rounded-full bg-emerald-400 px-8 py-3.5 text-[13.5px] font-bold text-[#04070a] transition-colors hover:bg-emerald-300"
             style={inter}>
            See the open events →
          </a>
        </div>
      </FadeIn>
    </div>
  );
}

/* ---------- 04 · the arena ---------- */

function Arena() {
  return (
    <div id="arena" className="relative overflow-hidden bg-[#04070a] px-5 py-28 text-center sm:px-10">
      <MatrixRain className="absolute inset-0 h-full w-full opacity-30" />
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(4,7,10,0.55), #04070a 75%)' }} />

      <div className="relative z-10">
        <FadeIn>
          <h2 className="display-font text-white" style={{ fontSize: 'clamp(36px, 6.5vw, 86px)', lineHeight: 0.95 }}>
            THE NEXT ONE
            <br />
            <span className="text-emerald-300 glow-green">STARTS SOON</span>
          </h2>
        </FadeIn>
        <FadeIn delay={0.12}>
          <p className="mx-auto mt-6 max-w-[520px] text-[15px] leading-relaxed text-white/65" style={inter}>
            Register once and you are in the pool for every hackathon and ideathon TEN runs —
            with your domain, your stack and your timezone already on file.
          </p>
        </FadeIn>
        <FadeIn delay={0.24}>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {/* Registration happens on this page — no bounce to the student
                login, so nothing loops back into the internship portal.
                #register opens the form itself; #events only scrolls. */}
            <a href="#register" className="rounded-full bg-emerald-400 px-10 py-5 text-[15px] font-bold text-black transition-transform hover:scale-[1.04]" style={inter}>
              REGISTER MY TEAM →
            </a>
            <a href="#team" className="rounded-full border border-emerald-300/50 px-10 py-5 text-[15px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/10" style={inter}>
              Already registered? My team
            </a>
          </div>
        </FadeIn>
        <FadeIn delay={0.34}>
          <div className="mt-12 flex flex-wrap justify-center gap-6 text-[13px] text-white/50" style={inter}>
            <a href="/student-portal/" className="hover:text-white">Student Portal</a>
            <a href="/job-portal/" className="hover:text-white">Job Portal</a>
            <a href="/resume-portal/" className="hover:text-white">Resume Portal</a>
            <a href="/academics.html" className="hover:text-white">Academics</a>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <main>
      <RainHero />
      <GlitterSection />
      <Tracks />
      <HowItWorks />
      <EventBoard />
      <Arena />
    </main>
  );
}
