#!/usr/bin/env bash
#
# Build a complete production .env on the server.
#
# Everything secret is generated HERE, on this machine, and never printed to a
# chat window, a ticket, or a commit. Run it in the deployment directory:
#
#   bash scripts/setup-production-env.sh
#
# It will:
#   1. Back up any existing .env
#   2. Generate SESSION_SECRET and ADMIN_API_SECRET
#   3. Ask for an admin password and bcrypt it
#   4. Generate a strong random password for all 9 HR and 16 coordinator
#      accounts, and build the two credential maps in the exact shape
#      loadCredentialMap() expects
#   5. Carry over the values that are not secrets to regenerate (Mongo URI,
#      SMTP, payment keys) from the old .env, asking when they are absent
#   6. Write the cleartext HR/coordinator passwords to ONE file, chmod 600, for
#      you to distribute and then delete
#
# Nothing here reads from or writes to the network.

set -euo pipefail

# Find the application root — the directory holding server.js.
#
# This must not assume the script sits in scripts/. It is meant to be curl'd
# straight onto a server during an outage, and `cd "$(dirname "$0")/.."` from a
# copy dropped in the app root resolves one level too high, writing .env to the
# parent directory where nothing reads it.
find_app_root() {
  local script_dir candidate
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  for candidate in "$script_dir/.." "$script_dir" "$PWD"; do
    if [ -f "$candidate/server.js" ] && [ -f "$candidate/package.json" ]; then
      (cd "$candidate" && pwd)
      return 0
    fi
  done
  return 1
}

ROOT="$(find_app_root)" || {
  printf '\033[31mERROR: could not find server.js.\033[0m\n' >&2
  printf 'Run this from the application directory, e.g.\n' >&2
  printf '  cd /home/ec2-user/ten-portal-production && bash %s\n' "$0" >&2
  exit 1
}
cd "$ROOT"
ENV_FILE="$ROOT/.env"
CREDS_FILE="$ROOT/credentials-to-distribute.txt"

say()  { printf '%s\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null || die "openssl not found."
command -v node    >/dev/null || die "node not found."
node -e "require('bcryptjs')" 2>/dev/null \
  || die "bcryptjs not installed. Run: npm ci --legacy-peer-deps"

bold "TEN portal — production environment setup"
say  "Directory: $ROOT"
say

# ── 1. Back up ───────────────────────────────────────────────────────────────
OLD_ENV=""
if [ -f "$ENV_FILE" ]; then
  BACKUP="$ENV_FILE.backup.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$BACKUP"
  chmod 600 "$BACKUP"
  OLD_ENV="$BACKUP"
  say "Backed up existing .env → $(basename "$BACKUP")"
  say
fi

# Read a value out of the old .env. Takes the LAST occurrence, which is what
# dotenv itself uses when a key is repeated.
old_value() {
  [ -n "$OLD_ENV" ] || return 0
  grep -E "^$1=" "$OLD_ENV" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

# Reuse the old value if present, otherwise prompt for one.
#
# Only the value goes to stdout — the progress line goes to stderr, and the
# prompt is read from the terminal. Writing either to stdout would splice it
# into the captured value, which is exactly how MONGODB_URI first came out as
# "  MONGODB_URI — carried over from the old .env\nmongodb://...".
carry_over() {
  local key="$1" prompt="$2" value
  value="$(old_value "$key")"
  if [ -n "$value" ]; then
    say "  $key — carried over from the old .env" >&2
  else
    read -r -p "  $prompt: " value >&2
  fi
  printf '%s' "$value"
}

# ── 2. Generated secrets ─────────────────────────────────────────────────────
bold "Generating secrets"
SESSION_SECRET="$(openssl rand -hex 32)"
ADMIN_API_SECRET="$(openssl rand -hex 24)"
say "  SESSION_SECRET    — 64 hex chars"
say "  ADMIN_API_SECRET  — 48 hex chars"
say

# ── 3. Admin password ────────────────────────────────────────────────────────
bold "Admin portal login"
read -r -p "  Admin username [tenadmin]: " ADMIN_USERNAME
ADMIN_USERNAME="${ADMIN_USERNAME:-tenadmin}"

while :; do
  read -r -s -p "  Admin password (min 12 chars, not shown): " ADMIN_PASSWORD; echo
  read -r -s -p "  Confirm: " ADMIN_PASSWORD_CONFIRM; echo
  [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD_CONFIRM" ] || { warn "  They do not match."; continue; }
  [ "${#ADMIN_PASSWORD}" -ge 12 ] || { warn "  Too short."; continue; }
  case "$ADMIN_PASSWORD" in
    your-new-admin-password|TEN@Admin2024|changeme|password)
      warn "  That is a placeholder or a known-public password."; continue ;;
  esac
  break
done

ADMIN_PASSWORD_HASH="$(ADMIN_PW="$ADMIN_PASSWORD" node -e \
  'console.log(require("bcryptjs").hashSync(process.env.ADMIN_PW, 12))')"
unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
say "  Hashed."
say

# ── 4. HR and coordinator accounts ───────────────────────────────────────────
# The rosters must match HR_ROSTER / COORDINATOR_ROSTER in server.js.
HR_USERS=(
  "jrhr@ten.com" "srhr@ten.com" "jrmanager@ten.com" "srmanager@ten.com"
  "hrad@ten.com" "jrdir@ten.com" "hrdirector@ten.com" "chro@ten.com"
  "vp@ten.com"
)
COORD_USERS=(
  "devops_aws_admin" "python_admin" "java_admin" "web_admin" "mern_admin"
  "ai_admin" "datascience_admin" "cyber_admin" "software_admin"
  "flutter_admin" "hrmgmt_admin" "venturecapital_admin" "vibecoding_admin"
  "spaceresearch_admin" "businessanalyst_admin" "hr_domain_admin"
)

bold "HR and coordinator passwords"
say "  Generating a fresh 20-character password for each of"
say "  ${#HR_USERS[@]} HR and ${#COORD_USERS[@]} coordinator accounts."
say "  The old ones (TEN@JrHR2026 etc.) are public — they are not reused."
say

# Emit "user<TAB>password" lines, then let node hash them. Passing the pairs on
# stdin keeps every password out of the process table and the shell history.
# Ask for more bytes than needed: stripping the URL-unfriendly base64 characters
# shortens the string, so 15 bytes would sometimes yield 16 characters, not 20.
gen_pairs() {
  for u in "$@"; do
    printf '%s\t%s\n' "$u" "$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-20)"
  done
}

# stdin: user<TAB>password lines. stdout: the JSON map, hashed.
hash_pairs() {
  node -e '
    const bcrypt = require("bcryptjs");
    let raw = "";
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => {
      const out = {};
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const [user, password] = line.split("\t");
        out[user] = { passwordHash: bcrypt.hashSync(password, 12) };
      }
      process.stdout.write(JSON.stringify(out));
    });
  '
}

HR_PAIRS="$(gen_pairs "${HR_USERS[@]}")"
COORD_PAIRS="$(gen_pairs "${COORD_USERS[@]}")"

say "  Hashing (bcrypt cost 12 — this takes a few seconds)..."
HR_CREDENTIALS="$(printf '%s\n' "$HR_PAIRS" | hash_pairs)"
COORDINATOR_CREDENTIALS="$(printf '%s\n' "$COORD_PAIRS" | hash_pairs)"
say "  Done."
say

# ── 5. Non-generated values ──────────────────────────────────────────────────
bold "Carrying over the rest"
MONGODB_URI="$(carry_over MONGODB_URI 'MongoDB connection URI')"
BASE_URL="$(old_value BASE_URL)"
BASE_URL="${BASE_URL:-https://virtualinternships.entrepreneurshipnetwork.net}"

# One origin, no trailing slash — the CORS check is an exact string match
# against the browser's Origin header, which never has one.
CORS_ALLOWED_ORIGINS="${BASE_URL%/}"

SES_SMTP_HOST="$(old_value SES_SMTP_HOST)"
SES_SMTP_PORT="$(old_value SES_SMTP_PORT)"
SES_SMTP_USER="$(old_value SES_SMTP_USER)"
SES_SMTP_PASS="$(old_value SES_SMTP_PASS)"
EMAIL_FROM="$(old_value EMAIL_FROM)"
PAYMENTSETU_API_KEY="$(old_value PAYMENTSETU_API_KEY)"
PAYMENT_WEBHOOK_SECRET="$(old_value PAYMENT_WEBHOOK_SECRET)"
GEMINI_API_KEY="$(old_value GEMINI_API_KEY)"
ASSISTANT_ADMIN_TOKEN="$(old_value ASSISTANT_ADMIN_TOKEN)"
[ -n "$ASSISTANT_ADMIN_TOKEN" ] || ASSISTANT_ADMIN_TOKEN="$(openssl rand -hex 24)"

# PM2 sets PORT in ecosystem.config.js, and dotenv does not override a variable
# that is already set — so this line only applies when the app is started
# without PM2. Keep it consistent with ecosystem.config.js to avoid confusion.
PORT="$(old_value PORT)"
PORT="${PORT:-3000}"
say

# ── 6. Write .env ────────────────────────────────────────────────────────────
umask 077
cat > "$ENV_FILE" <<EOF
# Generated by scripts/setup-production-env.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# NEVER commit this file. NEVER paste it into chat, email or a ticket.

NODE_ENV=production

# NOTE: when the app is started by PM2 this line has NO effect. ecosystem.config.js
# sets PORT in the process environment before node runs, and dotenv never
# overrides a variable that is already set — so under PM2 the app listens on
# 3000 (production) or 3001 (staging), whatever this says. It applies only to a
# bare \`node server.js\`. Check what nginx proxies to:  grep -rn proxy_pass /etc/nginx/
PORT=$PORT
BASE_URL=$BASE_URL

MONGODB_URI=$MONGODB_URI

# ── Required security secrets (config/secrets.js enforces these at boot) ─────
SESSION_SECRET=$SESSION_SECRET
ADMIN_API_SECRET=$ADMIN_API_SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD_HASH=$ADMIN_PASSWORD_HASH

# Exact origins, comma separated, NO trailing slash — matched against the
# browser's Origin header, which never sends one.
CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS

# ── HR / coordinator accounts ────────────────────────────────────────────────
# Bcrypt hashes only. Shape: {"user":{"passwordHash":"\$2b\$12\$..."}}
HR_CREDENTIALS=$HR_CREDENTIALS
COORDINATOR_CREDENTIALS=$COORDINATOR_CREDENTIALS

# ── Email ────────────────────────────────────────────────────────────────────
SES_SMTP_HOST=$SES_SMTP_HOST
SES_SMTP_PORT=$SES_SMTP_PORT
SES_SMTP_USER=$SES_SMTP_USER
SES_SMTP_PASS=$SES_SMTP_PASS
EMAIL_FROM=$EMAIL_FROM

# ── Payments ─────────────────────────────────────────────────────────────────
PAYMENTSETU_API_KEY=$PAYMENTSETU_API_KEY
PAYMENT_WEBHOOK_SECRET=$PAYMENT_WEBHOOK_SECRET

# ── Optional integrations ────────────────────────────────────────────────────
GEMINI_API_KEY=$GEMINI_API_KEY
ASSISTANT_ADMIN_TOKEN=$ASSISTANT_ADMIN_TOKEN

# ── Feature flags ────────────────────────────────────────────────────────────
# /code/run executes student-submitted source on this host. Leave false until
# it runs inside a network-isolated, resource-capped container.
ENABLE_CODE_RUNNER=false

# ── Local JSON fallback database ─────────────────────────────────────────────
# Must stay outside the public uploads/ tree — it is a full copy of the user
# table, password hashes included.
LOCAL_DB_DIR=.data/local_db

# ── Star Performer contribution repository ───────────────────────────────────
GITHUB_OFFICIAL_REPO=growth-eng/Ten-Ecosystem1

# ── Rate limits ──────────────────────────────────────────────────────────────
# These are the names server.js actually reads. RATE_LOGIN_* / RATE_REGISTER_*
# / RATE_API_* are not read by anything and were silently ignored.
RATE_AUTH_WINDOW_MS=900000
RATE_AUTH_MAX=10
RATE_PUBLIC_MAX=100
RATE_AUTH_USER_MAX=300
RATE_PAYMENT_MAX=20
EOF

chmod 600 "$ENV_FILE"

# ── 7. The distribution list ─────────────────────────────────────────────────
{
  echo "TEN portal — HR and coordinator passwords"
  echo "Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "Give each person their own line, over a channel you trust."
  echo "DELETE THIS FILE once that is done:  shred -u $(basename "$CREDS_FILE")"
  echo
  echo "== HR (login at /login) =="
  printf '%s\n' "$HR_PAIRS" | awk -F'\t' '{printf "  %-22s %s\n", $1, $2}'
  echo
  echo "== Coordinators (login at /coordinator-login) =="
  printf '%s\n' "$COORD_PAIRS" | awk -F'\t' '{printf "  %-22s %s\n", $1, $2}'
} > "$CREDS_FILE"
chmod 600 "$CREDS_FILE"

unset HR_PAIRS COORD_PAIRS

# ── 8. Verify ────────────────────────────────────────────────────────────────
say
bold "Checking the result"
if node -e '
  require("dotenv").config();
  const { collectSecretProblems } = require("./config/secrets");
  const problems = collectSecretProblems();
  if (problems.length) {
    for (const p of problems) console.error("  MISSING: " + p.name + " " + p.reason);
    process.exit(1);
  }
  for (const v of ["HR_CREDENTIALS", "COORDINATOR_CREDENTIALS"]) {
    const parsed = JSON.parse(process.env[v]);
    const bad = Object.entries(parsed).filter(
      ([, e]) => !e || typeof e !== "object" || !/^\$2[aby]\$/.test(e.passwordHash || "")
    );
    if (bad.length) {
      console.error("  BAD SHAPE in " + v + ": " + bad.map(([u]) => u).join(", "));
      process.exit(1);
    }
    console.log("  " + v + ": " + Object.keys(parsed).length + " accounts, all bcrypt");
  }
' 2>&1; then
  say
  bold "Done."
else
  say
  die "The generated .env did not pass validation. The old one is at $OLD_ENV"
fi

say
say "  .env                          — written, chmod 600"
say "  credentials-to-distribute.txt — the passwords, chmod 600"
[ -n "$OLD_ENV" ] && say "  $(basename "$OLD_ENV")  — your previous .env"
say
warn "Next:"
say "  1. cat credentials-to-distribute.txt   → send each person their line"
say "  2. shred -u credentials-to-distribute.txt"
say "  3. Rotate what this script could not: the Gmail app password"
say "     (myaccount.google.com → Security → App passwords) and the"
say "     MongoDB password. Put the new values in .env by hand."
say "  4. Delete the old backups once the app is confirmed working:"
say "     shred -u .env.backup.*"
say "  5. Only then merge the pull request."
