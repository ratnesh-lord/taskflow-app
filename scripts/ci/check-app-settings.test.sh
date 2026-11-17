#!/usr/bin/env bash
# Tests check-app-settings.sh against a stand-in for Supabase's sign-in service.
# Needs bash, curl and python3. Run: bash scripts/ci/check-app-settings.test.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
check="${here}/check-app-settings.sh"
work="$(mktemp -d)"
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy

GOOD="sb_publishable_good_test_key_0123456789"
PAUSED="sb_publishable_paused_project_key_0123"
b64() { printf '%s' "$1" | base64 | tr -d '=\n' | tr '/+' '_-'; }
ANON_JWT="$(b64 '{"alg":"HS256","typ":"JWT"}').$(b64 '{"iss":"supabase","role":"anon","ref":"abcdefgh"}').signature"
SERVICE_JWT="$(b64 '{"alg":"HS256","typ":"JWT"}').$(b64 '{"iss":"supabase","role":"service_role","ref":"abcdefgh"}').signature"

cat > "${work}/stub.py" <<PY
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

GOOD = {"${GOOD}", "${ANON_JWT}"}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        key = self.headers.get("apikey", "")
        if self.path != "/auth/v1/settings":
            status, body = 404, {"message": "no route"}
        elif key == "${PAUSED}":
            status, body = 540, {"message": "project paused"}
        elif key in GOOD:
            status, body = 200, {"external": {"email": True, "google": True}, "mailer_autoconfirm": True}
        else:
            status, body = 401, {"message": "Invalid API key"}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

server = HTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
PY
python3 "${work}/stub.py" > "${work}/port" &
stub=$!
trap 'kill ${stub} 2>/dev/null; rm -rf "${work}"' EXIT
for _ in $(seq 50); do [ -s "${work}/port" ] && break; sleep 0.1; done
STUB="http://127.0.0.1:$(cat "${work}/port")"

passed=0
# expect <name> <mode> <url> <key> <exit code> <text that must appear>...
expect() {
  local name="$1" mode="$2" url="$3" key="$4" want="$5"
  shift 5
  local out got
  : > "${work}/output"
  set +e
  out="$(EXPO_PUBLIC_SUPABASE_URL="$url" EXPO_PUBLIC_SUPABASE_KEY="$key" GITHUB_OUTPUT="${work}/output" \
         GITHUB_STEP_SUMMARY="${work}/summary" bash "$check" "$mode" 2>&1)"
  got=$?
  set -e
  out="${out}"$'\n'"$(cat "${work}/output")"
  if [ "$got" != "$want" ]; then
    printf 'FAILED: %s (exit %s, expected %s)\n%s\n' "$name" "$got" "$want" "$out"
    exit 1
  fi
  for text in "$@"; do
    if [[ "$out" != *"$text"* ]]; then
      printf 'FAILED: %s (missing "%s")\n%s\n' "$name" "$text" "$out"
      exit 1
    fi
  done
  passed=$((passed + 1))
  echo "ok   ${name}"
}

expect "missing values stop a published build" strict "" "" 1 \
  "::error title=App settings::EXPO_PUBLIC_SUPABASE_URL is empty" "EXPO_PUBLIC_SUPABASE_KEY is empty" "Not connected yet"
expect "missing values only warn on other builds" warn "" "" 0 \
  "::warning title=App settings::EXPO_PUBLIC_SUPABASE_URL is empty" "only builds from main are published"
expect "an address with a path is refused and corrected" strict "https://abcdefgh.supabase.co/rest/v1/" "$GOOD" 1 \
  "Use https://abcdefgh.supabase.co"
expect "the database connection string is recognised" strict "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" "$GOOD" 1 \
  "holds the database connection string"
expect "plain http is refused" strict "http://abcdefgh.supabase.co" "$GOOD" 1 "must start with https://"
expect "a value that is not an address is refused" strict "abcdefgh.supabase.co" "$GOOD" 1 "is not a web address"
expect "a secret key stops even a warn-only build" warn "https://abcdefgh.supabase.co" "sb_secret_0123456789abcdefghij" 1 \
  "::error title=App settings::EXPO_PUBLIC_SUPABASE_KEY holds a SECRET key" "a secret key was about to be put into the app"
expect "the legacy service_role key stops the build" warn "https://abcdefgh.supabase.co" "$SERVICE_JWT" 1 \
  "holds the service_role key"
expect "a key with a line break inside is refused" strict "https://abcdefgh.supabase.co" "sb_publishable_abc"$'\n'"defghijklmnop" 1 \
  "contains a space or a line break"
expect "a short key is refused" strict "https://abcdefgh.supabase.co" "sb_publishable_x" 1 "too short"
expect "a good key is accepted and described" strict "$STUB" "$GOOD" 0 \
  "The app will connect to 127.0.0.1" "Google sign-in: on" "Email confirmation: off" "google=on" "confirm_email=off"
expect "spaces and a trailing slash around the address are ignored, as the app does" strict "  ${STUB}/  " "  ${GOOD}  " 0 \
  "The app will connect to"
expect "the legacy anon key is accepted" strict "$STUB" "$ANON_JWT" 0 "The app will connect to"
expect "a key from another project is refused" strict "$STUB" "sb_publishable_from_another_project_99" 1 \
  "Supabase refused EXPO_PUBLIC_SUPABASE_KEY (HTTP 401)"
expect "a paused project only warns" strict "$STUB" "$PAUSED" 0 \
  "::warning title=App settings::Supabase answered HTTP 540" "may be paused"
expect "an address nobody answers at is refused" strict "https://no-such-project.invalid" "$GOOD" 1 \
  "No server answers at https://no-such-project.invalid"
expect "an unknown mode is refused" sideways "" "" 2 "usage:"

echo
echo "${passed} settings checks passed."
