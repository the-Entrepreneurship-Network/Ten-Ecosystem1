import { FadeIn } from './FadeIn';
import { goToSignup } from '../signup';

/*
 * The page's whole job now: what you get, why it is worth paying for, and what
 * students say — then back to the email box, which is the sign-up. The product
 * tour with prices lives on /overview, where the sign-up mail sends people;
 * this page persuades, that page explains.
 */

const BENEFITS: [string, string, string][] = [
  ['📚', 'A course that actually finishes', '21 topics per domain, easy to hard, each with a video and a proctored AI-marked exam. You cannot skim it — which is exactly why the certificate means something.'],
  ['🧑‍💻', 'A real internship on top', 'Weekly reviewed tasks, a coordinator who knows your name, attendance that counts. "Fresher, no experience" stops being true.'],
  ['🧭', 'Mentors who have done it', 'One-to-one sessions with people already working in your domain — bring the thing you are stuck on, leave with a plan.'],
  ['📄', 'A resume that survives the filter', 'Rebuilt to pass the software that reads it before any human does, then checked against the exact job you want.'],
  ['💼', 'A job hunt that runs itself', 'An agent finds live openings matched to you and applies on your behalf — a pipeline you watch, not a second job.'],
  ['🏆', 'Proof at every step', 'Verifiable certificates, a public hackathon repo, reviewed project work. Everything you claim, a recruiter can click.'],
];

/* Sample voices — replace with real ones as they come in. First name and
 * domain only, so nothing here impersonates a specific real person. */
const VOICES: [string, string, string][] = [
  ['Priya', 'Web Development', 'The exams scared me at first — camera on, real questions. Then I realised that pressure is why my certificate gets taken seriously in interviews.'],
  ['Arjun', 'Python Development', 'I paid after completion. Started with nothing, finished the course, paid from my first stipend. No other platform trusted me like that.'],
  ['Sneha', 'Data Science', 'The technical explanation then the simple one — that order fixed how I learn. I stopped memorising and started actually getting it.'],
  ['Rahul', 'DevOps with AWS', 'The mentor session before my interview mattered more than a month of YouTube. He had done the exact job I was applying for.'],
  ['Ananya', 'MERN Stack', 'My hackathon repo is the first thing every recruiter asks about. One weekend, and my resume finally had something clickable.'],
  ['Karan', 'Cyber Security', 'The job agent applied to openings while I prepared for interviews. Two offers in six weeks — I only chased one of them myself.'],
];

export default function BenefitsSection() {
  return (
    <section id="benefits" className="relative bg-black px-6 py-24 md:py-32">
      <FadeIn className="text-center" y={30}>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200/70">Why students pay for this</p>
        <h2 className="mt-3 text-4xl font-black uppercase tracking-tight md:text-6xl">What you get</h2>
      </FadeIn>

      <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map(([icon, title, body], i) => (
          <FadeIn key={title} delay={i * 0.05} y={26}>
            <div className="liquid-glass h-full rounded-3xl p-6 transition-colors hover:bg-white/5">
              <span aria-hidden="true" className="text-2xl">{icon}</span>
              <h3 className="mt-3 text-lg font-bold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
            </div>
          </FadeIn>
        ))}
      </div>

      <FadeIn className="mt-24 text-center" y={30}>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200/70">In their words</p>
        <h2 className="mt-3 text-3xl font-black uppercase tracking-tight md:text-5xl">Students, after</h2>
      </FadeIn>

      <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VOICES.map(([name, domain, quote], i) => (
          <FadeIn key={name} delay={i * 0.05} y={26}>
            <figure className="liquid-glass flex h-full flex-col rounded-3xl p-6">
              <blockquote className="flex-1 text-sm leading-relaxed text-white/70">“{quote}”</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-bold text-amber-100">{name}</span>
                <span className="text-white/40"> · {domain}</span>
              </figcaption>
            </figure>
          </FadeIn>
        ))}
      </div>

      <FadeIn className="mt-16 text-center" y={24}>
        <button
          type="button"
          onClick={goToSignup}
          className="rounded-full bg-amber-300 px-10 py-4 text-sm font-bold text-black transition-colors hover:bg-amber-200"
        >
          Start your journey — sign up with your email ↑
        </button>
      </FadeIn>
    </section>
  );
}
