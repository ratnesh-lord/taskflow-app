#!/usr/bin/env bash
# Applies every migration to a throwaway database and runs the tests in this folder.
# Connection comes from the usual PG* variables, for example:
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="taskflow_test_$$"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database ${db}"
trap 'psql -q -d postgres -c "drop database if exists ${db}" >/dev/null 2>&1 || true' EXIT

run() { psql -v ON_ERROR_STOP=1 -q -d "${db}" -f "$1" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //'; return "${PIPESTATUS[0]}"; }

run "${here}/support/supabase_shim.sql"
for f in "${here}"/../migrations/*.sql; do
  echo "migrate $(basename "$f")"
  run "$f"
done
run "${here}/support/helpers.sql"

for f in "${here}"/*.test.sql; do
  echo
  echo "== $(basename "$f")"
  run "$f"
done

echo
echo "== concurrency.sh"
bash "${here}/concurrency.sh" "${db}"

echo
echo "All database tests passed."
