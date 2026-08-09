#!/usr/bin/env bash
#
# End-to-end check of the security fixes AND of the flows they touch.
#
# Every case is written as "what an attacker tries" or "what a real user does",
# so a regression shows up as a behaviour change, not just a status code.
#
#   Usage:  BASE=http://localhost:5000 bash scripts/verify-security.sh
#
# Requires a seeded student — see scripts/seed-dev-student.js.

set -uo pipefail

BASE="${BASE:-http://localhost:5000}"
EMP="${EMP:-TEN/WEB/1001}"
PASS="${PASS:-TestPass!2026}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass=0; fail=0

# check <description> <expected> <actual>
check() {
  if [ "$2" = "$3" ]; then
    printf '  \033[32mPASS\033[0m  %-58s %s\n' "$1" "$3"
    pass=$((pass + 1))
  else
    printf '  \033[31mFAIL\033[0m  %-58s expected %s, got %s\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
section 'Attack surface — these must all be closed'

check 'admin login, wrong password' 401 \
  "$(code -X POST "$BASE/api/admin-internal/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrongpass"}')"
check 'admin login, username containing "admin"' 401 \
  "$(code -X POST "$BASE/api/admin-internal/login" -H 'Content-Type: application/json' -d '{"username":"xadminx","password":"anything"}')"
check 'admin login, old hardcoded TEN@Admin2024' 401 \
  "$(code -X POST "$BASE/api/admin-internal/login" -H 'Content-Type: application/json' -d '{"username":"tenadmin","password":"TEN@Admin2024"}')"

check 'GET /api/secrets-status (leaked HR passwords)' 404 "$(code "$BASE/api/secrets-status")"
check 'POST /api/save-secrets (rewrote .env)' 404 \
  "$(code -X POST "$BASE/api/save-secrets" -H 'Content-Type: application/json' -d '{"MONGODB_URI":"mongodb://evil"}')"

check 'POST /get-my-password (revealed any password)' 410 \
  "$(code -X POST "$BASE/get-my-password" -H 'Content-Type: application/json' -d "{\"employeeId\":\"$EMP\"}")"

# Rejected either way: 503 when ENABLE_CODE_RUNNER is off, 401 when it is on
# but the caller has no session. What must never happen is a 200.
rejected() { case "$1" in 401|503) echo rejected ;; *) echo "$1" ;; esac; }
check 'POST /code/run anonymous (was RCE)' rejected \
  "$(rejected "$(code -X POST "$BASE/code/run" -H 'Content-Type: application/json' -d '{"code":"1","language":"javascript"}')")"
check 'POST /code/submit anonymous' rejected \
  "$(rejected "$(code -X POST "$BASE/code/submit" -H 'Content-Type: application/json' -d '{"code":"1"}')")"

check 'GET /students with Bearer mysecret123' 401 \
  "$(code "$BASE/students" -H 'Authorization: Bearer mysecret123')"
check 'GET /hr/students with Bearer hr_ prefix' 401 \
  "$(code "$BASE/hr/students" -H 'Authorization: Bearer hr_anything')"
check 'PUT /students/:id unauthenticated' 401 \
  "$(code -X PUT "$BASE/students/000000000000000000000001" -H 'Content-Type: application/json' -d '{"domain":"Hacked"}')"
check 'DELETE /students/:id unauthenticated' 401 \
  "$(code -X DELETE "$BASE/students/000000000000000000000001")"

check 'fallback DB over HTTP' 404 "$(code "$BASE/uploads/local_db/db_Student.json")"

check 'role forgery via x-ecosystem-user-role header' 401 \
  "$(code "$BASE/api/ecosystem-notifications" -H 'x-ecosystem-user-id: 000000000000000000000001' -H 'x-ecosystem-user-role: admin')"
check 'my-certs via spoofed x-employee-id' 401 \
  "$(code "$BASE/api/v2/certificates/my-certs" -H "x-employee-id: $EMP")"
check 'v2 status via spoofed x-employee-id' 401 \
  "$(code "$BASE/api/v2/student/status" -H "x-employee-id: $EMP")"
check 'task approve with any Bearer token' 401 \
  "$(code -X POST "$BASE/api/v2/tasks/000000000000000000000001/approve" -H 'Authorization: Bearer x' -H 'Content-Type: application/json' -d '{}')"

# HR backdoor that was not in the credential map and worked in production
BACKDOOR=$(curl -s -X POST "$BASE/hr-login" -H 'Content-Type: application/json' \
  -d '{"email":"hrdirector@ten.com","password":"TEN@HRBP2026"}' | grep -c '"success":true' || true)
check 'hrdirector TEN@HRBP2026 backdoor' 0 "$BACKDOOR"

# ─────────────────────────────────────────────────────────────────────────────
section 'Existing features — these must all still work'

LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/login" -H 'Content-Type: application/json' \
  -d "{\"employeeId\":\"$EMP\",\"password\":\"$PASS\",\"role\":\"student\"}")
check 'student login succeeds' 1 "$(echo "$LOGIN" | grep -c '"success":true' || true)"
check 'session cookie issued' 1 "$(grep -c 'ten.sid' "$JAR" || true)"
check 'login response hides password hash' 0 "$(echo "$LOGIN" | grep -c '"password"' || true)"
check 'login response hides reset token' 0 "$(echo "$LOGIN" | grep -c 'passwordResetToken' || true)"

check 'my-certs with a real session' 200 "$(code -b "$JAR" "$BASE/api/v2/certificates/my-certs")"
check 'student status with a real session' 200 "$(code -b "$JAR" "$BASE/api/v2/student/status")"
check 'attendance with a real session' 200 "$(code -b "$JAR" "$BASE/attendance/student/$(printf '%s' "$EMP" | sed 's|/|%2F|g')")"
check 'leaderboard with a real session' 200 "$(code -b "$JAR" "$BASE/api/v2/leaderboard")"
check 'public health check' 200 "$(code "$BASE/health")"
check 'overall leaderboard returns data' 200 "$(code "$BASE/leaderboard/overall")"
check 'xterm is self-hosted (no CDN)' 200 "$(code "$BASE/vendor/xterm.js")"
check 'xterm fit addon is self-hosted' 200 "$(code "$BASE/vendor/xterm-addon-fit.js")"
# An unknown document number must give a clean "not found", never a 500.
check 'unknown document verifies as not-found' 404 "$(code "$BASE/api/verify-document/TEN-OL-2026-ABCDEF")"
check 'malformed document number does not 500' 404 "$(code "$BASE/api/verify-document/%3Cscript%3E")"

HRJAR="$(mktemp)"
HRLOGIN=$(curl -s -c "$HRJAR" -X POST "$BASE/hr-login" -H 'Content-Type: application/json' \
  -d '{"email":"hrdirector@ten.com","password":"TEN@HRDir2026"}')
check 'HR login with env credentials' 1 "$(echo "$HRLOGIN" | grep -c '"success":true' || true)"
check 'HR level preserved (7)' 1 "$(echo "$HRLOGIN" | grep -c '"level":7' || true)"
check 'HR can list students with a session' 200 "$(code -b "$HRJAR" "$BASE/hr/students")"
rm -f "$HRJAR"

# ─────────────────────────────────────────────────────────────────────────────
section 'Pull-request validation (Star Performer tech track)'

star() {
  curl -s -b "$JAR" -X POST "$BASE/api/v2/certificates/star-submit" \
    -H 'Content-Type: application/json' \
    -d "{\"contribution\":\"{\\\"githubPR\\\":\\\"$1\\\"}\"}" | grep -c '"success":true' || true
}
check 'rejects javascript: URL'        0 "$(star 'javascript:alert(1)')"
check 'rejects github.com look-alike'  0 "$(star 'https://github.com.evil.tld/growth-eng/Ten-Ecosystem1/pull/1')"
check 'rejects a different repo'       0 "$(star 'https://github.com/someone/else/pull/1')"
check 'rejects a non-PR repo URL'      0 "$(star 'https://github.com/growth-eng/Ten-Ecosystem1')"
check 'accepts a valid official PR'    1 "$(star 'https://github.com/growth-eng/Ten-Ecosystem1/pull/42')"

# ─────────────────────────────────────────────────────────────────────────────
printf '\n\033[1mTotal: %d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
