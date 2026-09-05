#!/usr/bin/env bash
#
# The TEN portal watchdog. Runs every minute from the ten-watchdog systemd
# timer that scripts/server/harden-mongod.sh installs. Three jobs, done quietly:
#
#   1. mongod is not running          -> start it.
#   2. the disk is 90% full           -> flush pm2's logs, shrink the journal,
#                                        drop old rotated mongod logs. A full
#                                        disk is how the first outage began.
#   3. the database has been up for   -> restart the app. It reconnects on its
#      two minutes but the app has       own (services/dbHealth.js); this only
#      said "disconnected" for three     catches it wedged, and never fires
#      checks in a row                   while the database itself is down.
#
# It prints only when it does something, so `journalctl -u ten-watchdog` is a
# record of interventions, not noise. Nothing here reads .env.
#
# Settings come from /etc/ten-portal.conf, written by harden-mongod.sh; every
# one has a default so the script also runs bare.

set -u

CONF="${TEN_PORTAL_CONF:-/etc/ten-portal.conf}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
APP_USER="${APP_USER:-ec2-user}"
APP_NAME="${APP_NAME:-ten-portal-production}"
PORT="${PORT:-5000}"
DISK_LIMIT="${DISK_LIMIT:-90}"
GRACE_SECONDS="${GRACE_SECONDS:-120}"     # how long mongod must be up before the app is judged
STUCK_CHECKS="${STUCK_CHECKS:-3}"         # consecutive "disconnected" answers before a restart
STATE="${TEN_WATCHDOG_STATE:-/var/lib/ten-watchdog}"
mkdir -p "$STATE" 2>/dev/null

log()    { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
as_app() { sudo -n -u "$APP_USER" -H bash -lc "$*"; }

have_mongod() { systemctl cat mongod >/dev/null 2>&1; }

# ---- 1. the database itself -----------------------------------------------------

if have_mongod && ! systemctl is-active --quiet mongod; then
  log "mongod is not running — starting it"
  if systemctl start mongod; then
    log "mongod started"
  else
    log "mongod FAILED to start: $(journalctl -u mongod -n 3 --no-pager 2>/dev/null | tail -n 3 | tr '\n' ' ')"
  fi
fi

# ---- 2. the disk ----------------------------------------------------------------

used="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
if [ "${used:-0}" -ge "$DISK_LIMIT" ]; then
  log "disk is ${used}% full — freeing log space"
  as_app 'pm2 flush' >/dev/null 2>&1 || true
  journalctl --vacuum-size=100M >/dev/null 2>&1 || true
  find /var/log/mongodb -name '*.gz' -mtime +2 -delete 2>/dev/null || true
  log "disk is now $(df -P / | awk 'NR==2{print $5}') full"
fi

# ---- 3. the app, only once the database is clearly up ----------------------------

counter="$STATE/app-disconnected"
if ! have_mongod; then
  up_for=$GRACE_SECONDS                     # database is elsewhere; nothing to wait for
elif systemctl is-active --quiet mongod; then
  since="$(systemctl show -p ActiveEnterTimestampMonotonic --value mongod 2>/dev/null)"
  now="$(awk '{print int($1 * 1000000)}' /proc/uptime)"
  up_for=$(( (now - ${since:-0}) / 1000000 ))
else
  up_for=0                                  # still down; the app is right to say so
fi

if [ "$up_for" -ge "$GRACE_SECONDS" ]; then
  body="$(curl -s -m 5 "http://127.0.0.1:${PORT}/api/health/db" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q '"connected":false'; then
    n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$counter"
    if [ "$n" -ge "$STUCK_CHECKS" ]; then
      log "the database has been up ${up_for}s but the app has said disconnected $n times in a row — restarting $APP_NAME"
      if as_app "pm2 restart $APP_NAME --update-env" >/dev/null 2>&1; then log "$APP_NAME restarted"
      else log "pm2 restart $APP_NAME FAILED"; fi
      echo 0 > "$counter"
    fi
  else
    rm -f "$counter"
  fi
fi
