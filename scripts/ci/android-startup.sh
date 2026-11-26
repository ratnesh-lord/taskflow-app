#!/usr/bin/env bash
# Start-up profile on the emulator (run after android-smoke.sh):
#   - cold start: the app is stopped, then started five times; Android's own
#     "TotalTime" (launch until the first frame) for each, and the median;
#   - memory in use 20 seconds after a start (PSS);
#   - what the app has registered with Android while idle: alarms, background
#     jobs and wake locks (the battery review in docs/PROGRESS.md uses these).
# Writes startup.txt to the output folder. Fails only when the median cold
# start is over BUDGET_MS, far beyond normal even for a CI emulator.
#   bash scripts/ci/android-startup.sh <package> <out-dir>
set -uo pipefail
pkg="$1"; out="$2"
BUDGET_MS="${BUDGET_MS:-20000}"
mkdir -p "$out"
activity="$(adb shell cmd package resolve-activity --brief "$pkg" | tr -d '\r' | tail -1)"

times=()
for i in 1 2 3 4 5; do
  adb shell am force-stop "$pkg"
  sleep 2
  t="$(adb shell am start -W -n "$activity" | tr -d '\r' | sed -n 's/^TotalTime: //p')"
  times+=("${t:-0}")
  sleep 8
done
median="$(printf '%s\n' "${times[@]}" | sort -n | sed -n 3p)"
sleep 12

{
  echo "Cold start (launch until the first frame), five runs: ${times[*]} ms; median ${median} ms"
  echo
  echo "Memory 20 seconds after a start:"
  adb shell dumpsys meminfo "$pkg" | tr -d '\r' | grep -E "TOTAL PSS|TOTAL RSS|Java Heap|Native Heap" | head -4
  echo
  alarms="$(adb shell dumpsys alarm | tr -d '\r' | grep -E "^\s+(RTC|ELAPSED)[A-Z_]* #" -A1 | grep -B1 "$pkg" | grep -E "RTC|ELAPSED" | sed 's/^ */  /')"
  jobs="$(adb shell dumpsys jobscheduler | tr -d '\r' | grep -E "JOB #.*$pkg" | sed 's/^ */  /' | head -10)"
  locks="$(adb shell dumpsys power | tr -d '\r' | grep -iE "wake_lock|WakeLock" | grep -i "$pkg" | sed 's/^ */  /')"
  echo "Alarms set by the app:"; echo "${alarms:-  none}"
  echo
  echo "Background jobs (WorkManager) for the app:"; echo "${jobs:-  none}"
  echo
  echo "Wake locks held by the app right now:"; echo "${locks:-  none}"
} | tee "$out/startup.txt"

if [ "${median:-0}" -gt "$BUDGET_MS" ]; then
  echo "The median cold start (${median} ms) is over ${BUDGET_MS} ms." >&2
  exit 1
fi
