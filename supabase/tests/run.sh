#!/usr/bin/env bash
# Applies every migration to a throwaway database and runs the tests in this folder.
# Connection comes from the usual PG* variables, for example:
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="taskflow_test_$$"

trap 'psql -q -d postgres -c "drop database if exists ${db}" >/dev/null 2>&1 || true' EXIT
bash "${here}/setup-db.sh" "${db}"

run() { psql -v ON_ERROR_STOP=1 -q -d "${db}" -f "$1" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //'; return "${PIPESTATUS[0]}"; }

for f in "${here}"/*.test.sql; do
  echo
  echo "== $(basename "$f")"
  run "$f"
done

echo
echo "== concurrency.sh"
bash "${here}/concurrency.sh" "${db}"

echo
echo "== sync engine: two devices through sync_push and sync_pull (src/data/sync.db.test.ts)"
root="$(cd "${here}/../.." && pwd)"
if [ -x "${root}/node_modules/.bin/jest" ]; then
  (cd "${root}" && TASKFLOW_SYNC_TEST_DB="${db}" node_modules/.bin/jest --ci src/data/sync.db.test.ts)
elif [ -n "${REQUIRE_SYNC_TESTS:-}" ]; then
  echo "node_modules is missing: run npm ci first" >&2
  exit 1
else
  echo "skipped: run npm ci first to include these"
fi

echo
echo "All database tests passed."
