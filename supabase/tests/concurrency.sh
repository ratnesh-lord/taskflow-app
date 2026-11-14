#!/usr/bin/env bash
# Two writers at once: revisions must be committed in order, and a reader in
# the middle must get a cursor that skips nothing. Called by run.sh.
set -euo pipefail

db="$1"
q() { psql -v ON_ERROR_STOP=1 -qAt -d "${db}" "$@"; }
ok() { echo "ok   $1"; }
fail() { echo "FAILED: $1" >&2; exit 1; }

check_pair() {
  local label="$1" write_a="$2" write_b="$3" id_a="$4" id_b="$5" as_user="$6"

  # Writer A writes, then keeps its transaction open for 3 seconds.
  q -c "begin; ${as_user} ${write_a} select pg_sleep(3); commit;" >/dev/null &
  local pid_a=$!
  sleep 1

  # Writer B starts while A is still open, and must wait for A.
  local started ended
  started=$(date +%s%N)
  q -c "${as_user} ${write_b}" >/dev/null &
  local pid_b=$!
  sleep 0.7

  # A reader in the middle sees neither row.
  local mid mid_cursor mid_tasks
  mid=$(q -c "${as_user} select (p ->> 'next_since') || ' ' || coalesce(jsonb_array_length(p -> 'changes' -> 'tasks'), 0) from public.sync_pull(0) as p;")
  mid_cursor=${mid% *}
  mid_tasks=${mid#* }

  wait "${pid_a}"
  wait "${pid_b}"
  ended=$(date +%s%N)
  local waited_ms=$(( (ended - started) / 1000000 ))

  local rev_a rev_b
  rev_a=$(q -c "select rev from public.tasks where id = '${id_a}'")
  rev_b=$(q -c "select rev from public.tasks where id = '${id_b}'")

  [ "${mid_tasks}" = "0" ] || fail "${label}: the reader saw an uncommitted task"
  ok "${label}: a reader in the middle sees neither unfinished write"
  [ "${waited_ms}" -ge 1000 ] || fail "${label}: writer B did not wait for writer A (${waited_ms} ms)"
  ok "${label}: the second writer waits for the first"
  [ "${rev_a}" -lt "${rev_b}" ] || fail "${label}: revisions out of order (${rev_a}, ${rev_b})"
  ok "${label}: the first writer to start gets the lower revision"
  [ "${mid_cursor}" -lt "${rev_a}" ] || fail "${label}: the reader's cursor ${mid_cursor} is not below ${rev_a}"
  ok "${label}: the reader's cursor is below both writes"

  local later
  later=$(q -c "${as_user} select jsonb_array_length(public.sync_pull(${mid_cursor}) -> 'changes' -> 'tasks');")
  [ "${later}" = "2" ] || fail "${label}: pulling from the reader's cursor returned ${later} tasks, expected 2"
  ok "${label}: pulling again from that cursor returns both writes"
}

# --- direct table writes -----------------------------------------------------
uid=$(q -c "select test.new_user('concurrent-1@example.com')")
as_user="set role authenticated; set request.jwt.claim.sub = '${uid}';"
a=$(q -c "select gen_random_uuid()"); b=$(q -c "select gen_random_uuid()")
check_pair "direct writes" \
  "insert into public.tasks (id, title) values ('${a}', 'A');" \
  "insert into public.tasks (id, title) values ('${b}', 'B');" \
  "${a}" "${b}" "${as_user}"

# --- two devices pushing -------------------------------------------------------
uid=$(q -c "select test.new_user('concurrent-2@example.com')")
as_user="set role authenticated; set request.jwt.claim.sub = '${uid}';"
a=$(q -c "select gen_random_uuid()"); b=$(q -c "select gen_random_uuid()")
d1=$(q -c "select gen_random_uuid()"); d2=$(q -c "select gen_random_uuid()")
check_pair "two pushes" \
  "select public.sync_push('${d1}', jsonb_build_array(test.op('tasks', '${a}', '{\"title\": \"A\"}', test.ts(0, '${d1}'))));" \
  "select public.sync_push('${d2}', jsonb_build_array(test.op('tasks', '${b}', '{\"title\": \"B\"}', test.ts(0, '${d2}'))));" \
  "${a}" "${b}" "${as_user}"
