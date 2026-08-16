import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /**
     * Pin the workspace root to this directory.
     *
     * Without it Turbopack infers the root from the nearest lockfiles, and a
     * stray package-lock.json sitting loose in Downloads wins: it then treats
     * the whole of Downloads as the project, watches every file under it, and
     * reports module paths as ./ten-project-assistant/ten-project-assistant/…
     * which makes every error look like it is in the wrong tree.
     */
    root: __dirname,
  },
};

export default nextConfig;
