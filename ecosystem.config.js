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

// PORT is deliberately NOT set here.
//
// It was, and it broke the site. PM2 puts anything in `env` into the process
// environment before node starts, and dotenv never overrides a variable that is
// already set — so a PORT here silently wins over the deployment's own .env.
// Production had been listening on 5000 (nginx: proxy_pass 127.0.0.1:5000) and
// a hardcoded 3000 moved it out from under nginx, which then had nothing to
// proxy to. The app answered fine on 3000; the site was still down.
//
// Each deployment directory has its own .env, which is the right place for the
// port: production sets PORT=5000, staging PORT=5001. server.js falls back to
// 3000 only when neither is set.

module.exports = {
  apps: [
    {
      ...base,
      name: "ten-portal-production",
      env: { NODE_ENV: "production" }
    },
    {
      ...base,
      name: "ten-portal-staging",
      env: { NODE_ENV: "production" }
    },
    {
      // Kept so an existing `pm2 restart ten-portal` on the server, or anything
      // else referring to the old name, does not break.
      ...base,
      name: "ten-portal",
      env: { NODE_ENV: "production" }
    }
  ]
};
