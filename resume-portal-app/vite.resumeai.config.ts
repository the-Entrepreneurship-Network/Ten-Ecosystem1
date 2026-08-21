import { renameSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/*
 * Vite names the emitted document after its entry, so `resumeai.html` would
 * land as `resumeai.html` and `/resume-ai/` would 404 on a directory with no
 * index. Renaming it here keeps the fix next to the config that caused it,
 * instead of in a shell one-liner that has to survive three quoting layers.
 */
function emitAsIndex(): Plugin {
  return {
    name: 'resume-ai:index',
    closeBundle() {
      const dir = new URL('../public/resume-ai/', import.meta.url);
      try {
        renameSync(new URL('resumeai.html', dir), new URL('index.html', dir));
      } catch {
        /* Already renamed, or the build failed before emitting. */
      }
    },
  };
}

/*
 * Resume AI builds separately from the portal so it gets its own URL, but out
 * of the same folder so it shares one node_modules, one Tailwind config and
 * one set of components. A second repo would have bought a second dependency
 * tree and a second place for the API client to drift.
 */
export default defineConfig({
  plugins: [react(), emitAsIndex()],
  base: './',
  build: {
    outDir: '../public/resume-ai',
    emptyOutDir: true,
    rollupOptions: { input: 'resumeai.html' },
  },
  server: {
    /* `npm run dev:ai` talks to the real Express server rather than a mock,
       so what runs locally is what runs deployed. */
    proxy: { '/api': 'http://localhost:3000' },
  },
});
