#!/usr/bin/env bash
# What can be done on the production server without a login, run by the
# "Server ops" GitHub workflow (.github/workflows/server-ops.yml) from the app
# directory. A fixed menu, so nothing in a student's email can ever become a
# command here.
#
#   status   the app, database, nginx, disk and memory
#   logs     the app's last 200 log lines, emailed to the team inbox. They hold
#            students' data, and the workflow's log is public, so they are
#            never printed.
#   restart  restart the app and check it comes back
#   nginx    install the settings in deploy/nginx/ (apply-nginx.sh)
#   selftest the live check (scripts/server/selftest.js): pages, database,
#            Gemini, an exam paper, uploads, half-made student accounts.
#            Emailed, like the logs; only the pass/fail count is printed.
set -euo pipefail
APP=ten-portal-production
PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
health() { curl -s -m 5 "http://127.0.0.1:${PORT:-5000}/api/health/db" || echo '(no answer)'; }
# Only these fields: `pm2 describe` and the raw list also carry the app's environment.
app() { pm2 jlist | node -e 'for (const p of JSON.parse(require("fs").readFileSync(0, "utf8")))
  console.log(p.name, p.pm2_env.status, "| restarts:", p.pm2_env.restart_time,
    "| up since:", new Date(p.pm2_env.pm_uptime).toISOString(), "| memory:", Math.round(p.monit.memory / 1048576) + "MB")'; }

case "${1:-}" in
  status)
    app
    echo "database: $(health)"
    echo "nginx: $(systemctl is-active nginx || true)   mongod: $(systemctl is-active mongod || true)"
    df -h / | tail -1 | awk '{print "disk: " $5 " used of " $2}'
    free -m | awk '/^Mem:/ {print "memory: " $3 "MB used of " $2 "MB"}'
    ;;
  logs)
    pm2 logs "$APP" --lines 200 --nostream --raw 2>&1 | node scripts/server/mail-team.js "[server] last 200 log lines"
    ;;
  restart)
    pm2 restart ecosystem.config.js --only "$APP" --update-env >/dev/null
    sleep 10
    app
    echo "database: $(health)"
    ;;
  nginx)
    bash scripts/server/apply-nginx.sh
    ;;
  selftest)
    node scripts/server/selftest.js | node scripts/server/mail-team.js "[server] live self-test"
    ;;
  *)
    echo "Usage: ops.sh status|logs|restart|nginx|selftest" >&2
    exit 2
    ;;
esac
