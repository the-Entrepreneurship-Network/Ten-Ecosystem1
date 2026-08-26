import { useEffect, useRef, useState } from 'react';

/*
 * The first question the Studio asks: do you already have an account?
 *
 * The two answers lead to genuinely different products, and getting it wrong
 * costs the visitor real time — a returning student sent through registration
 * makes a second account, and a newcomer sent to the pay screen is asked for
 * money before they have picked a domain.
 *
 *   Yes → /studio.html, the pay screen. They already have a login, so all that
 *         is left is paying for the parts they want. The screen bounces them
 *         through /login.html itself and returns them here, so this does not
 *         need to know whether their session is live.
 *   No  → /domains, where a track is chosen and registration follows.
 *
 * Deliberately not a wall:
 *   - asked ONCE per browser, not on every visit
 *   - never asked of somebody already signed in — they have answered it by
 *     being signed in, and asking anyway is how a product feels stupid
 *   - Escape, the backdrop and "I'm just looking" all close it
 *
 * ponytail: no focus trap — two buttons, both reachable, Escape always works.
 * Add one if this ever grows a form.
 */

const ASKED_KEY = 'ten-studio-asked';

export default function AccountGate() {
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(ASKED_KEY)) return;
    } catch {
      /* private mode — ask, but it will not be remembered */
    }

    let cancelled = false;
    // 401 here means signed out, which is the only state worth asking in.
    fetch('/api/v2/studio/status', { credentials: 'same-origin' })
      .then((r) => {
        if (cancelled || r.ok) return;               // signed in → never ask
        setTimeout(() => { if (!cancelled) setOpen(true); }, 1100);
      })
      .catch(() => {
        // Offline or the API is down. Ask anyway: both answers are plain links
        // and neither needs the server to work.
        setTimeout(() => { if (!cancelled) setOpen(true); }, 1100);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const remember = () => { try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* private mode */ } };
  const dismiss = () => { remember(); setOpen(false); };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-5 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-gate-title"
        className="liquid-glass w-full max-w-md rounded-3xl p-8 text-center"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/70">
          Before you start
        </p>
        <h2 id="account-gate-title" className="mt-3 text-2xl font-bold text-white">
          Do you already have a TEN account?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          It decides where you go next — straight to payment, or to pick your domain first.
        </p>

        <div className="mt-7 flex flex-col gap-3">
          <a
            ref={first}
            href="/studio.html"
            onClick={remember}
            className="rounded-full bg-amber-300 px-7 py-3.5 text-sm font-bold text-black transition-colors hover:bg-amber-200"
          >
            Yes — take me to payment
          </a>
          <a
            href="/domains"
            onClick={remember}
            className="liquid-glass rounded-full px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/5"
          >
            No — I'm new here
          </a>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="mt-5 text-xs text-white/40 transition-colors hover:text-white/70"
        >
          I&apos;m just looking
        </button>
      </div>
    </div>
  );
}
