import { motion, useInView } from 'framer-motion';
import { ArrowUpRight, Check } from 'lucide-react';
import { useRef } from 'react';
import { FEATURES, SERVICE_IMAGES } from '../constants';

const CARDS = [
  {
    tag: 'Learn',
    title: 'Courses & Modules',
    description:
      'Week-by-week curriculum in every domain — videos that unlock quizzes, modules that build on each other, momentum you can feel.',
    image: SERVICE_IMAGES.learn,
    alt: 'Student working on a laptop',
  },
  {
    tag: 'Prove',
    title: 'Assignments, Quizzes & Projects',
    description:
      'AI-evaluated assignments marked on your reasoning, domain quizzes after every video, and real projects a recruiter can actually check.',
    image: SERVICE_IMAGES.prove,
    alt: 'Laptop screen glowing with code',
  },
] as const;

export default function FeaturesSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section
      id="features"
      ref={ref}
      className="relative overflow-hidden bg-black px-6 py-28 md:py-40"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.02)_0%,_transparent_60%)]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-12 flex items-end justify-between md:mb-16"
        >
          <h2 className="text-3xl tracking-tight text-white md:text-5xl">What you get</h2>
          <span className="hidden text-sm text-white/40 md:block">The portal</span>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {CARDS.map((card, i) => (
            <motion.article
              key={card.title}
              initial={{ opacity: 0, y: 50 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: i * 0.15 }}
              className="liquid-glass group overflow-hidden rounded-3xl"
            >
              <div className="relative aspect-video overflow-hidden">
                <img
                  src={card.image}
                  alt={card.alt}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              </div>
              <div className="p-6 md:p-8">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <span className="text-xs uppercase tracking-widest text-white/40">{card.tag}</span>
                  <span className="liquid-glass rounded-full p-2 text-white/80">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
                <h3 className="mb-3 text-xl tracking-tight text-white md:text-2xl">{card.title}</h3>
                <p className="text-sm leading-relaxed text-white/50">{card.description}</p>
              </div>
            </motion.article>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {FEATURES.map((f) => (
            <div key={f} className="liquid-glass flex items-center gap-3 rounded-2xl px-5 py-4">
              <Check className="h-4 w-4 shrink-0 text-white/70" />
              <span className="text-sm font-medium text-white/80">{f}</span>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="mt-16 flex flex-col items-center gap-4 text-center"
        >
          <a
            href="/student-journeys.html"
            className="rounded-full bg-white px-10 py-4 text-sm font-semibold text-black transition-transform hover:scale-105"
          >
            Start your journey →
          </a>
          <p className="text-xs text-white/40">
            Fourteen domains · one certificate · resume and jobs on the other side
          </p>
        </motion.div>
      </div>
    </section>
  );
}
