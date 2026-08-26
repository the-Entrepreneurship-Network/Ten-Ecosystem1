import { type FormEvent, useState } from 'react';
import { ArrowRight, Globe, Instagram, Twitter } from 'lucide-react';
import { HERO_VIDEO, INSTRUMENT_SERIF } from '../constants';
import FadingVideo from './FadingVideo';
import Navbar from './Navbar';

export default function HeroSection() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  /*
   * This used to set a flag and nothing else — no request, no record, no mail.
   * Everyone who typed their address in was told "You're on the list" and put
   * on no list at all.
   */
  const handleEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (new FormData(form).get('email') || '').toString().trim();
    if (!email) return;

    setStatus('sending');
    try {
      const res = await fetch('/api/v2/studio/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        setStatus('error');
        setMessage((data && data.message) || 'That did not go through. Please try again.');
        return;
      }
      setStatus('done');
      setMessage(data.message);
    } catch {
      // Saying "you're on the list" when the request never left the device is
      // the bug this replaces. Tell them, so they can try again.
      setStatus('error');
      setMessage('Could not reach us just now. Check your connection and try again.');
    }
  };

  return (
    <section id="hero" className="relative flex min-h-screen flex-col overflow-hidden bg-black">
      <div className="absolute inset-0">
        <FadingVideo
          src={HERO_VIDEO}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <Navbar />

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center -translate-y-[20%]">
          <h1
            className="mb-8 whitespace-nowrap text-5xl tracking-tight text-white md:text-6xl lg:text-7xl"
            style={{ fontFamily: INSTRUMENT_SERIF }}
          >
            Built for the curious
          </h1>

          <div className="w-full max-w-xl space-y-4">
            {status === 'done' ? (
              <p
                className="liquid-glass rounded-full px-6 py-4 text-sm font-medium text-white"
                role="status"
              >
                {message}
              </p>
            ) : (
              <>
                <form
                  className="liquid-glass flex items-center gap-3 rounded-full py-2 pl-6 pr-2"
                  onSubmit={handleEmailSubmit}
                >
                  <input
                    type="email"
                    name="email"
                    required
                    disabled={status === 'sending'}
                    placeholder="Enter your email"
                    className="min-w-0 flex-1 border-none bg-transparent text-base text-white placeholder:text-white/40 outline-none disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={status === 'sending'}
                    className="rounded-full bg-white p-3 text-black transition-transform hover:translate-x-0.5 disabled:opacity-60"
                    aria-label="Send me what the Studio opens up"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </form>
                {status === 'error' && (
                  <p className="px-4 text-sm text-red-300" role="alert">
                    {message}
                  </p>
                )}
              </>
            )}

            <p className="px-4 text-sm leading-relaxed text-white">
              Courses, modules, assignments, quizzes and real projects across fourteen
              domains — one journey from your first module to job-ready.
            </p>

            <a
              href="/domains"
              className="liquid-glass inline-block rounded-full px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-white/5"
            >
              Choose your domain
            </a>
          </div>
        </div>

        <div className="relative z-10 flex justify-center gap-4 pb-12">
          {[
            { Icon: Instagram, label: 'Instagram' },
            { Icon: Twitter, label: 'Twitter' },
            { Icon: Globe, label: 'Website' },
          ].map(({ Icon, label }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              className="liquid-glass rounded-full p-4 text-white/80 transition-all hover:bg-white/5 hover:text-white"
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
