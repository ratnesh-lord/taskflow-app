#!/usr/bin/env bash
# Web end-to-end check: builds the web app, starts a throwaway database with the
# migrations, a stand-in sign-in service and a static server, then drives the app
# in headless Chrome. Needs: psql + a Postgres server (PG* variables), Node, Chrome,
# and Python with Playwright (pip install playwright).
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres scripts/e2e/run.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
db="taskflow_e2e_$$"
api_port="${E2E_API_PORT:-54400}"
web_port="${E2E_WEB_PORT:-8099}"
# The sub-path the site is served below, as on GitHub Pages; empty for the root.
base="${E2E_BASE-/taskflow-app}"
out="${root}/dist-e2e"
pids=()

cleanup() {
  for pid in "${pids[@]:-}"; do kill "${pid}" >/dev/null 2>&1 || true; done
  psql -q -d postgres -c "drop database if exists ${db} with (force)" >/dev/null 2>&1 || true
  rm -rf "${out}"
}
trap cleanup EXIT

cd "${root}"
bash supabase/tests/setup-db.sh "${db}" >/dev/null

echo "building the web app"
EXPO_OFFLINE=1 CI=1 TASKFLOW_WEB_BASE_URL="${base}" EXPO_PUBLIC_SQL_TIMING="${E2E_SQL_TIMING:-}" \
EXPO_PUBLIC_SUPABASE_URL="http://127.0.0.1:${api_port}" \
EXPO_PUBLIC_SUPABASE_KEY="sb_publishable_e2e_0123456789abcdef" \
  npx expo export --platform web --output-dir "${out}" ${E2E_NO_MINIFY:+--no-minify} >/dev/null 2>&1

E2E_DB="${db}" E2E_API_PORT="${api_port}" node scripts/e2e/mock-supabase.mjs > "${E2E_API_LOG:-/tmp/taskflow-e2e-api.log}" 2>&1 &
pids+=($!)
bash scripts/web/finish-export.sh "${out}"
node scripts/e2e/serve-dist.mjs "${out}" "${web_port}" "${base}" >/dev/null 2>&1 &
pids+=($!)
sleep 2

E2E_DB="${db}" E2E_WEB="http://127.0.0.1:${web_port}${base}" E2E_API="http://127.0.0.1:${api_port}" python3 "scripts/e2e/${E2E_SCRIPT:-check.py}"
