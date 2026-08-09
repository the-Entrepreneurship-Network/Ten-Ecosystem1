// PM2 process definitions.
//
// NAMES MUST MATCH THE DEPLOY WORKFLOWS. They did not:
//
//   .github/workflows/deploy-production.yml → pm2 restart … --only ten-portal-production
//   .github/workflows/deploy-staging.yml    → pm2 restart … --only ten-portal-staging
//   this file defined only                  → "ten-portal"
//
// `--only <name>` silently matches nothing when the name is absent, so a
// deploy would fetch the new code, install dependencies, and then NOT restart
// the process — leaving the old build running with no error anywhere. Every
// entry below is named to match a workflow.
//
// Each deployment directory has its own checkout of this file, and `cwd` is
// __dirname, so the production entry resolves to the production directory and
// the staging entry to the staging one.

const base = {
  script: "server.js",
  cwd: __dirname,
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: "1G",
  // Restart backoff, so a process that cannot boot — for example when a
  // required secret is missing and config/secrets.js exits — does not spin in
  // a tight restart loop.
  min_uptime: "20s",
  max_restarts: 10,
  restart_delay: 4000,
  time: true
};

module.exports = {
  apps: [
    {
      ...base,
      name: "ten-portal-production",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    },
    {
      ...base,
      name: "ten-portal-staging",
      env: {
        NODE_ENV: "production",
        PORT: 3001
      }
    },
    {
      // Kept so an existing `pm2 restart ten-portal` on the server, or anything
      // else referring to the old name, does not break.
      ...base,
      name: "ten-portal",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};
