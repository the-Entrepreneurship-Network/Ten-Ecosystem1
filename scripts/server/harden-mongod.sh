#!/usr/bin/env bash
#
# Make the database on this server survive on its own.
#
# WHY THIS EXISTS
#
# The portal has gone down twice because mongod — the MongoDB running on this
# same EC2 box — stopped, and nothing started it again. The first time the disk
# filled with logs and mongod aborted. Whatever the cause each time, the shape
# is identical: the application keeps retrying (services/dbHealth.js) and
# recovers the moment the database is back — but nothing was bringing the
# database back.
#
# The mongod.service that MongoDB's package installs has NO Restart= line and
# is not enabled at boot. So a crash, an out-of-memory kill, or a reboot each
# leaves it dead until a person types `systemctl start mongod`. That is the
# whole outage, both times, and this script is what closes it.
#
# WHAT IT INSTALLS — idempotent; run it again any time, each step says
# "already" or "done"
#
#   1. mongod starts on boot                 systemctl enable mongod
#   2. mongod restarts itself after a crash  a systemd drop-in: Restart=always,
#      and is the last thing OOM-killed      OOMScoreAdjust=-500
#   4. swap, if the box has under 4 GB RAM   the usual out-of-memory cause on a
#      and none yet                          small EC2 instance
#   5. logs cannot fill the disk again       logrotate for mongod, a 200 MB cap
#                                            on the journal, pm2-logrotate for
#                                            the app
#   6. a watchdog every minute               scripts/server/watchdog.sh on a
#                                            systemd timer: starts mongod if it
#                                            is down, frees log space at 90%
#                                            disk, restarts the app only if it
#                                            is wedged
#   7. the app survives a reboot too         pm2 startup + pm2 save
#
# USAGE (on the server)
#
#   sudo bash scripts/server/harden-mongod.sh           # install everything
#   sudo bash scripts/server/harden-mongod.sh --check   # report; change nothing
#
# --check is also the first thing to run in an outage: it says whether mongod
# is up and, if not, what it last logged. It exits 0 only when the database is
# running and every protection is in place.
#
# Reads only the PORT line of .env. Prints no secrets — the database host is
# shown, never the user or password.

set -uo pipefail

MODE=apply
case "${1:-}" in
  --check)   MODE=check ;;
  -h|--help) sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "")        ;;
  *)         echo "Unknown option: $1 (try --check)" >&2; exit 2 ;;
esac

say()   { printf '%s\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
die()   { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
ok()    { printf '  \033[32m[ok]\033[0m   %s\n' "$*"; }
done_() { printf '  \033[32m[done]\033[0m %s\n' "$*"; }
skip()  { printf '  \033[2m[skip]\033[0m %s\n' "$*"; }
MISSING=0
miss()  { printf '  \033[31m[--]\033[0m   %s\n' "$*"; MISSING=$((MISSING + 1)); }

command -v systemctl >/dev/null \
  || die "This script needs systemd. It is for the EC2 server, not this machine."
if [ "$MODE" = apply ] && [ "$(id -u)" -ne 0 ]; then
  die "Run with sudo:  sudo bash $0"
fi

# ---- Where the app is, and who runs it ---------------------------------------

find_app_root() {
  local here c
  here="$(cd "$(dirname "$0")" && pwd)"
  for c in "${APP_DIR:-}" "$here/../.." "$here/.." "$here" "$PWD" \
           /home/ec2-user/InternshipManagementSystem-Final; do
    if [ -n "$c" ] && [ -f "$c/server.js" ] && [ -f "$c/ecosystem.config.js" ]; then
      (cd "$c" && pwd); return 0
    fi
  done
  return 1
}

APP_DIR="$(find_app_root)" \
  || die "Could not find server.js. Run this from the app directory, or set APP_DIR=/path/to/app."
APP_USER="${APP_USER:-$(stat -c %U "$APP_DIR")}"
APP_NAME="${APP_NAME:-ten-portal-production}"
HOME_DIR="$(getent passwd "$APP_USER" | cut -d: -f6)"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]"'"'"'')"
PORT="${PORT:-5000}"

# The host part of MONGODB_URI, and nothing else. `(.*@)?` is greedy on
# purpose: it swallows everything up to the LAST @, so a password containing
# / or : can never leak into the printed host.
DB_HOST="$(grep -E '^MONGODB_URI=' "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- \
           | sed -E 's#^[a-zA-Z+]+://(.*@)?([^/?]+).*#\2#')"

# Run something as the user who owns the app — pm2 is per-user, so `pm2 list`
# as root shows nothing. A login shell so an nvm-installed pm2 is on the PATH.
as_app() {
  if [ "$(id -un)" = "$APP_USER" ]; then bash -lc "$*" 2>/dev/null
  else sudo -n -u "$APP_USER" -H bash -lc "$*" 2>/dev/null; fi
}

have_mongod() { systemctl cat mongod >/dev/null 2>&1; }
mongod_log()  { awk '/^ *path:/{print $2; exit}' /etc/mongod.conf 2>/dev/null; }

# ---- What is happening right now ----------------------------------------------

db_now() {
  bold "DATABASE NOW"
  if have_mongod; then
    if systemctl is-active --quiet mongod; then
      ok "mongod is running (since $(systemctl show -p ActiveEnterTimestamp --value mongod))"
    else
      miss "mongod is NOT running. The last things it logged:"
      journalctl -u mongod -n 8 --no-pager 2>/dev/null | sed 's/^/          /'
      local logf; logf="$(mongod_log)"
      [ -f "${logf:-/dev/null}" ] && tail -n 5 "$logf" | cut -c1-160 | sed 's/^/          /'
      if dmesg 2>/dev/null | grep -qi 'killed process.*mongod\|out of memory'; then
        warn "          The kernel's out-of-memory killer has run on this box (see dmesg)."
        warn "          Step 4 below (swap) is the fix for that."
      fi
      if [ "$MODE" = apply ]; then
        if systemctl start mongod; then done_ "mongod started"
        else miss "mongod would not start — the lines above say why"; fi
      fi
    fi
  else
    say "  mongod is not installed on this box; the database is at ${DB_HOST:-(no MONGODB_URI in .env)}"
  fi

  say "  last boot: $(uptime -s 2>/dev/null || echo '?')"
  say "  disk: $(df -P / | awk 'NR==2{print $5}') used on /" \
      "   ram: $(awk '/^MemTotal/{printf "%d MB", $2/1024}' /proc/meminfo)" \
      "   swap: $(awk 'NR>1{s+=$3} END{printf "%d MB", s/1024}' /proc/swaps)"

  local h; h="$(curl -s -m 5 "http://127.0.0.1:$PORT/api/health/db" 2>/dev/null || true)"
  if [ -z "$h" ]; then
    miss "the app is not answering on port $PORT"
  elif printf '%s' "$h" | grep -q '"connected":true'; then
    ok "the app reports the database connected"
  else
    miss "the app says the database is NOT connected: $(printf '%s' "$h" | sed -E 's/.*"cause":"([^"]*)".*/\1/')"
  fi
  say
}

# ---- The protections ------------------------------------------------------------

step1_boot() {
  have_mongod || { skip "1. mongod is not installed here — nothing to enable"; return; }
  if systemctl is-enabled --quiet mongod 2>/dev/null; then ok "1. mongod starts on boot"; return; fi
  [ "$MODE" = check ] && { miss "1. mongod does NOT start on boot — a reboot leaves the portal without a database"; return; }
  if systemctl enable mongod >/dev/null 2>&1; then done_ "1. mongod now starts on boot"
  else miss "1. could not enable mongod"; fi
}

DROPIN_DIR=/etc/systemd/system/mongod.service.d
DROPIN=$DROPIN_DIR/ten-portal.conf
step2_restart() {
  have_mongod || { skip "2. restart-on-crash: no mongod here"; return; }
  local current; current="$(systemctl show -p Restart --value mongod 2>/dev/null || echo '?')"
  if [ -f "$DROPIN" ] && [ "$current" = always ]; then
    ok "2. mongod restarts itself after a crash, and is protected from the OOM killer"; return
  fi
  [ "$MODE" = check ] && { miss "2. mongod does NOT restart after a crash (Restart=$current) — this is the outage"; return; }
  mkdir -p "$DROPIN_DIR" && cat > "$DROPIN" <<'EOF' && systemctl daemon-reload \
    && done_ "2. mongod will now restart itself 5s after any crash" \
    || miss "2. could not write $DROPIN"
[Unit]
# A crashed database must never stay down. StartLimitIntervalSec=0 means
# systemd keeps trying no matter how many times it has restarted recently.
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=5
# When the kernel runs out of memory it kills the process with the highest
# score. Push mongod to the back of that queue: the app restarts in seconds
# under pm2; a database does not.
OOMScoreAdjust=-500
EOF
}

step4_swap() {
  local mem_kb swap free_kb size_mb
  mem_kb="$(awk '/^MemTotal/{print $2}' /proc/meminfo)"
  swap="$(awk 'NR>1{print $1}' /proc/swaps | head -1)"
  if [ -n "$swap" ]; then ok "4. swap is present ($swap)"; return; fi
  if [ "${mem_kb:-0}" -ge 4000000 ]; then ok "4. $((mem_kb / 1024)) MB RAM — swap not needed"; return; fi
  free_kb="$(df -Pk / | awk 'NR==2{print $4}')"
  if   [ "$free_kb" -gt 6000000 ]; then size_mb=2048
  elif [ "$free_kb" -gt 3000000 ]; then size_mb=1024
  else miss "4. no swap, $((mem_kb / 1024)) MB RAM, and only $((free_kb / 1024)) MB free on / — free some disk, then re-run"; return
  fi
  [ "$MODE" = check ] && { miss "4. no swap on a $((mem_kb / 1024)) MB box — an out-of-memory kill takes mongod first"; return; }
  if ( fallocate -l "${size_mb}M" /swapfile 2>/dev/null \
       || dd if=/dev/zero of=/swapfile bs=1M count="$size_mb" status=none ) \
     && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile \
     && { grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab; } \
     && printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-ten-portal.conf \
     && sysctl -q -p /etc/sysctl.d/90-ten-portal.conf; then
    done_ "4. ${size_mb} MB swap added and kept across reboots"
  else
    miss "4. could not create swap"
  fi
}

step5_logs() {
  # 5a. mongod's own log — this is the file that filled the disk.
  if have_mongod; then
    local logdir conf=/etc/logrotate.d/ten-mongod
    logdir="$(dirname "$(mongod_log)")"
    { [ -n "$logdir" ] && [ "$logdir" != . ]; } || logdir=/var/log/mongodb
    if [ -f "$conf" ]; then ok "5a. mongod's log rotates ($conf)"
    elif [ "$MODE" = check ]; then miss "5a. mongod's log in $logdir grows until the disk is full"
    else
      cat > "$conf" <<EOF
$logdir/*.log {
    daily
    maxsize 50M
    rotate 7
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
}
EOF
      done_ "5a. mongod's log now rotates daily, or at 50 MB, keeping a week"
    fi
  fi

  # 5b. the system journal — uncapped by default on Amazon Linux.
  local jconf=/etc/systemd/journald.conf.d/ten-portal.conf
  if [ -f "$jconf" ]; then ok "5b. the system journal is capped at 200 MB"
  elif [ "$MODE" = check ]; then miss "5b. the system journal is uncapped"
  else
    mkdir -p "$(dirname "$jconf")" && printf '[Journal]\nSystemMaxUse=200M\n' > "$jconf" \
      && journalctl --vacuum-size=200M >/dev/null 2>&1
    systemctl try-restart systemd-journald 2>/dev/null || true
    done_ "5b. the system journal is capped at 200 MB"
  fi

  # 5c. the app's log under pm2 — grows forever without this module.
  if as_app 'pm2 list' | grep -q pm2-logrotate; then ok "5c. pm2-logrotate is installed for $APP_USER"
  elif [ "$MODE" = check ]; then miss "5c. pm2-logrotate is NOT installed — the app's own log can fill the disk"
  elif as_app 'pm2 install pm2-logrotate >/dev/null && pm2 set pm2-logrotate:max_size 10M >/dev/null && pm2 set pm2-logrotate:retain 7 >/dev/null && pm2 set pm2-logrotate:compress true >/dev/null'; then
    done_ "5c. pm2-logrotate installed: 10 MB per file, 7 kept, compressed"
  else
    miss "5c. pm2-logrotate install failed — is pm2 on $APP_USER's PATH?"
  fi
}

WD_BIN=/usr/local/bin/ten-watchdog
step6_watchdog() {
  local src="$APP_DIR/scripts/server/watchdog.sh"
  if [ -x "$WD_BIN" ] && cmp -s "$src" "$WD_BIN" \
     && systemctl is-enabled --quiet ten-watchdog.timer 2>/dev/null \
     && systemctl is-active  --quiet ten-watchdog.timer 2>/dev/null; then
    ok "6. the watchdog runs every minute (journalctl -u ten-watchdog)"; return
  fi
  [ "$MODE" = check ] && { miss "6. the watchdog is not installed, or not the current version"; return; }
  [ -f "$src" ] || { miss "6. $src not found — is this checkout up to date?"; return; }

  printf 'APP_DIR=%s\nAPP_USER=%s\nAPP_NAME=%s\nPORT=%s\n' "$APP_DIR" "$APP_USER" "$APP_NAME" "$PORT" > /etc/ten-portal.conf
  install -m 755 "$src" "$WD_BIN"
  cat > /etc/systemd/system/ten-watchdog.service <<'EOF'
[Unit]
Description=TEN portal watchdog: restart mongod, free log space, unstick the app

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ten-watchdog
EOF
  cat > /etc/systemd/system/ten-watchdog.timer <<'EOF'
[Unit]
Description=Run the TEN portal watchdog every minute

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=5

[Install]
WantedBy=timers.target
EOF
  if systemctl daemon-reload && systemctl enable --now ten-watchdog.timer >/dev/null 2>&1; then
    done_ "6. the watchdog is installed and runs every minute"
  else
    miss "6. could not enable ten-watchdog.timer"
  fi
}

step7_pm2boot() {
  if systemctl list-unit-files 2>/dev/null | grep -q "^pm2-${APP_USER}\.service"; then
    ok "7. the app comes back after a reboot (pm2-$APP_USER.service)"; return
  fi
  [ "$MODE" = check ] && { miss "7. the app does NOT come back after a reboot — no pm2-$APP_USER.service"; return; }
  local pm2_bin node_bin
  pm2_bin="$(as_app 'command -v pm2' | tail -1)"
  node_bin="$(as_app 'command -v node' | tail -1)"
  { [ -n "$pm2_bin" ] && [ -n "$node_bin" ]; } || { miss "7. pm2 or node not found on $APP_USER's PATH"; return; }
  if PATH="$(dirname "$node_bin"):$PATH" "$pm2_bin" startup systemd -u "$APP_USER" --hp "$HOME_DIR" >/dev/null 2>&1 \
     && as_app 'pm2 save' >/dev/null; then
    done_ "7. pm2 will bring the app back after a reboot"
  else
    miss "7. pm2 startup failed — as $APP_USER run: pm2 startup   and then the sudo line it prints"
  fi
}

# ---- Go --------------------------------------------------------------------------

bold "TEN portal — database hardening ($MODE)"
say "  app: $APP_DIR   user: $APP_USER   pm2 name: $APP_NAME   port: $PORT"
say
db_now
bold "PROTECTIONS"
step1_boot
step2_restart
step4_swap
step5_logs
step6_watchdog
step7_pm2boot
say
if [ "$MISSING" -eq 0 ]; then
  bold "Everything is in place. The database will restart itself, and the watchdog checks every minute."
elif [ "$MODE" = check ]; then
  warn "$MISSING item(s) missing. Install them with:  sudo bash $0"
else
  warn "$MISSING item(s) could not be completed — see the lines marked [--] above."
fi
exit $(( MISSING > 0 ))
