#!/usr/bin/env bash
# Applies the SQL files in supabase/migrations to a database, in name order,
# each one exactly once. Which files have been applied is recorded in the
# table private.applied_migrations, so running this again is always safe.
#
# Usage:
#   scripts/db/migrate.sh "<connection string>"        a Supabase project
#   PGHOST=... PGUSER=... PGDATABASE=... scripts/db/migrate.sh   any Postgres
#
# For Supabase use the "Session pooler" connection string from the project's
# Connect dialog (it works from networks without IPv6, such as GitHub Actions).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
target=()
if [ "${1:-}" != "" ]; then target=("$1"); fi

run() { psql "${target[@]}" -v ON_ERROR_STOP=1 -qAt "$@"; }

run -c "create schema if not exists private" \
    -c "create table if not exists private.applied_migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        )" >/dev/null 2>&1 || {
  echo "Could not connect to the database, or not allowed to create the bookkeeping table." >&2
  run -c "select 1" >/dev/null   # prints the real error
  exit 1
}

applied=0
skipped=0
for file in "${root}"/supabase/migrations/*.sql; do
  name="$(basename "${file}")"
  if [ "$(run -c "select count(*) from private.applied_migrations where name = '${name}'")" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "applying ${name}"
  # One transaction per file: a failure leaves the database exactly as it was.
  psql "${target[@]}" -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "${file}" \
    -c "insert into private.applied_migrations (name) values ('${name}')" >/dev/null
  applied=$((applied + 1))
done

echo "migrations applied: ${applied}, already in place: ${skipped}"
