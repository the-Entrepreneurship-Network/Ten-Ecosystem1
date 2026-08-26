import { useEffect, useRef } from 'react';

/*
 * The real-3D layer of the hero: a golden particle galaxy in WebGL, drawn
 * with Three.js, orbiting slowly and leaning toward the pointer.
 *
 * Written so it can only ever ADD to the page:
 *
 *   - `three` is loaded with a dynamic import AFTER this component mounts, so
 *     the page is readable before a byte of WebGL arrives. The bundle for the
 *     page itself does not grow.
 *   - No WebGL, reduced-motion, or a data-saver connection → nothing is
 *     mounted at all and the hero video underneath simply shows through.
 *   - Pixel ratio is clamped and the particle count halves on a phone: this
 *     is a marketing page, and a marketing page that warms a phone in the
 *     hand is selling the wrong thing.
 *   - The loop stops when the tab is hidden or the hero is scrolled away.
 */
export default function GalaxyCanvas() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // saveData is non-standard but honest where it exists.
    const conn = (navigator as any).connection;
    if (conn && conn.saveData) return;
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return;
    } catch {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | null = null;

    import('three').then((THREE) => {
      if (disposed || !host.current) return;

      const phone = window.innerWidth < 640;
      const COUNT = phone ? 3200 : 7000;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
      camera.position.set(0, 1.35, 5.2);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      el.appendChild(renderer.domElement);

      /* A flat spiral ring, thick at the band and thin at the edges — the same
         shape as the galaxy in the film behind it, so the two read as one. */
      const positions = new Float32Array(COUNT * 3);
      const colors = new Float32Array(COUNT * 3);
      const gold = new THREE.Color('#f5c542');
      const white = new THREE.Color('#fff7d6');
      const blue = new THREE.Color('#8fb4ff');
      for (let i = 0; i < COUNT; i++) {
        const arm = Math.random() * Math.PI * 2;
        const radius = 1.15 + Math.pow(Math.random(), 1.6) * 2.1;
        const swirl = arm + radius * 1.25;
        const spread = (Math.random() - 0.5) * 0.34 * (1.2 - radius / 3.4);
        positions[i * 3] = Math.cos(swirl) * radius + (Math.random() - 0.5) * 0.16;
        positions[i * 3 + 1] = spread;
        positions[i * 3 + 2] = Math.sin(swirl) * radius + (Math.random() - 0.5) * 0.16;
        const c = Math.random() < 0.72 ? gold : Math.random() < 0.6 ? white : blue;
        const dim = 0.55 + Math.random() * 0.45;
        colors[i * 3] = c.r * dim; colors[i * 3 + 1] = c.g * dim; colors[i * 3 + 2] = c.b * dim;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: phone ? 0.028 : 0.02,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const galaxy = new THREE.Points(geo, mat);
      galaxy.rotation.x = 0.42;
      scene.add(galaxy);

      let targetX = 0, targetY = 0;
      const onPointer = (e: PointerEvent) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 0.35;
        targetY = (e.clientY / window.innerHeight - 0.5) * 0.2;
      };
      window.addEventListener('pointermove', onPointer, { passive: true });

      const size = () => {
        const w = el.clientWidth || 1, h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      size();
      window.addEventListener('resize', size);

      let raf = 0;
      let running = true;
      const frame = () => {
        if (!running) return;
        galaxy.rotation.y += 0.0011;
        // Lean, never snap: the pointer sets a target and the ring eases there.
        galaxy.rotation.z += (targetX - galaxy.rotation.z) * 0.03;
        galaxy.rotation.x += (0.42 + targetY - galaxy.rotation.x) * 0.03;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };

      const start = () => { if (!running) { running = true; frame(); } };
      const stop = () => { running = false; cancelAnimationFrame(raf); };
      frame();

      const onVis = () => (document.hidden ? stop() : start());
      document.addEventListener('visibilitychange', onVis);
      const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
      io.observe(el);

      cleanup = () => {
        stop();
        io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('resize', size);
        window.removeEventListener('pointermove', onPointer);
        geo.dispose(); mat.dispose(); renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => { /* the hero video carries the scene alone */ });

    return () => { disposed = true; if (cleanup) cleanup(); };
  }, []);

  return <div ref={host} aria-hidden="true" className="pointer-events-none absolute inset-0" />;
}
