import { useEffect, useRef } from 'react';

/*
 * The sparks that pour out of the screen while she types.
 *
 * Particles are emitted from a point on the left, ride a shallow sine so the
 * stream curves like the reference instead of firing in a straight line, and
 * die as they leave. Additive blending is what makes overlaps glow instead of
 * turning into flat pink.
 */
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number; phase: number };

export default function GlitterStream({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parts: P[] = [];
    let raf = 0;
    let t = 0;

    /* Same trap as the rain: an absolutely positioned canvas can measure zero
       on first paint, and nothing resizes the window afterwards to fix it. */
    const size = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (w: number, h: number) => {
      /* emitted from where the screen sits in the layout, not the corner */
      const ox = w * 0.42;
      const oy = h * 0.52;
      for (let i = 0; i < 3; i++) {
        parts.push({
          x: ox + (Math.random() - 0.5) * 40,
          y: oy + (Math.random() - 0.5) * 70,
          vx: -(0.9 + Math.random() * 2.6),
          vy: (Math.random() - 0.5) * 0.9,
          life: 0,
          max: 90 + Math.random() * 90,
          size: 0.8 + Math.random() * 2.4,
          hue: 285 + Math.random() * 45, /* violet → magenta */
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const frame = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) {
        raf = requestAnimationFrame(frame);
        return;
      }
      t += 0.016;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      if (parts.length < 420) spawn(w, h);

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy + Math.sin(t * 2 + p.phase) * 0.5;

        const k = p.life / p.max;
        if (k >= 1 || p.x < -30) {
          parts.splice(i, 1);
          continue;
        }

        const alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
        const r = p.size * (1 + Math.sin(t * 6 + p.phase) * 0.25);

        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        g.addColorStop(0, `hsla(${p.hue}, 100%, 78%, ${alpha})`);
        g.addColorStop(0.4, `hsla(${p.hue}, 100%, 62%, ${alpha * 0.45})`);
        g.addColorStop(1, `hsla(${p.hue}, 100%, 55%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `hsla(${p.hue}, 100%, 92%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    window.addEventListener('resize', size);
    if (!reduced) raf = requestAnimationFrame(frame);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', size);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
