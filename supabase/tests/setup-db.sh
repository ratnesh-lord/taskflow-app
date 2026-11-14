#!/usr/bin/env bash
# Creates a database, applies the Supabase shim, every migration and the test helpers.
# Usage: supabase/tests/setup-db.sh <database-name>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="$1"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database ${db}"
apply() { psql -v ON_ERROR_STOP=1 -q -d "${db}" -f "$1" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //'; return "${PIPESTATUS[0]}"; }

apply "${here}/support/supabase_shim.sql"
for f in "${here}"/../migrations/*.sql; do
  echo "migrate $(basename "$f")"
  apply "$f"
done
apply "${here}/support/helpers.sql"
