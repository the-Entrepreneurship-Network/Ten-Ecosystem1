import { useEffect, useRef } from 'react';

/*
 * The green rain behind the coder — drawn, not filmed.
 *
 * A looping video would be a fixed size and a fixed length; this fills any
 * viewport, never seams, and costs one canvas. Each column falls at its own
 * speed with a bright head and a fading tail, which is what makes the effect
 * read as rain rather than as scrolling text.
 */
export default function MatrixRain({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789<>[]{}/*+-=$#@'.split('');
    const FONT = 16;

    let cols = 0;
    let drops: number[] = [];
    let speeds: number[] = [];
    let raf = 0;

    /*
     * Sizing on mount alone gave a zero-width backing store: the canvas is
     * absolutely positioned, so on first paint it can measure 0 and the window
     * never resizes afterwards to correct it. A ResizeObserver sizes it the
     * moment layout settles and again whenever the section changes.
     */
    const size = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / FONT);
      drops = Array.from({ length: cols }, () => Math.random() * -40);
      speeds = Array.from({ length: cols }, () => 0.45 + Math.random() * 0.85);
      ctx.fillStyle = '#04070a';
      ctx.fillRect(0, 0, w, h);
    };

    const frame = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h || !cols) {
        raf = requestAnimationFrame(frame);
        return;
      }

      /* the trail: paint the whole field with a low-alpha black instead of
         clearing, so older glyphs fade out over several frames */
      ctx.fillStyle = 'rgba(4, 7, 10, 0.09)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FONT}px 'IBM Plex Mono', monospace`;

      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * FONT;
        const y = drops[i] * FONT;

        /* head is near-white, the character behind it is full green */
        ctx.fillStyle = 'rgba(190, 255, 214, 0.95)';
        ctx.fillText(ch, x, y);
        ctx.fillStyle = 'rgba(38, 220, 110, 0.55)';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y - FONT);

        drops[i] += speeds[i];
        if (y > h && Math.random() > 0.975) {
          drops[i] = Math.random() * -20;
          speeds[i] = 0.45 + Math.random() * 0.85;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    window.addEventListener('resize', size);
    if (reduced) {
      /* one still frame — the look survives, the motion does not */
      ctx.font = `${FONT}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = 'rgba(38, 220, 110, 0.4)';
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < 30; j++)
          ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * FONT, j * FONT * 1.6);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', size);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
