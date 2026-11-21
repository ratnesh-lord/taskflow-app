#!/usr/bin/env bash
# Checks the home-screen widgets on the emulator, after android-smoke.sh:
#   1. Android lists TaskFlow's four widgets.
#   2. The app draws each widget, light and dark, the way a launcher would
#      (WidgetCheck in Widgets.kt), with and without data. The pictures are
#      printed into the job log as base64 between WIDGET-PNG lines.
#   3. Ticking a box with the app closed queues the tap and starts the sync
#      worker, without a crash.
# The data below is test data for this check only; the app never shows it.
#   bash scripts/ci/android-widgets.sh <package> <out-dir>
set -uo pipefail
pkg="$1"; out="$2"
mkdir -p "$out/widgets"
receiver="$pkg/com.ratnesh.taskflow.alarms.WidgetReceiver"
fail=0

echo "---- 1. widgets Android knows about ----"
providers="$(adb shell dumpsys appwidget | grep -oE "$pkg/com\.ratnesh\.taskflow\.alarms\.[A-Za-z]+Widget" | sort -u)"
echo "$providers"
if [ "$(echo "$providers" | grep -c Widget)" -ne 4 ]; then
  echo "Expected 4 TaskFlow widgets in the widget list." >&2
  fail=1
fi

echo "---- 2. drawing each widget ----"
today="$(adb shell date +%F | tr -d '\r')"
yesterday="$(date -d "$today - 1 day" +%F)"
tomorrow="$(date -d "$today + 1 day" +%F)"
dayname() { date -d "$1" "+%a %-d %b"; }
dow=$(( $(date -d "$today" +%u) - 1 ))
week="$(python3 -c "w=[3,1,0,4,2,5,2]; d=$dow; print([n if i<=d else 0 for i,n in enumerate(w)])")"
data="$(cat <<JSON
{"version":1,"generatedAt":1,"signedIn":true,"hour12":false,"days":[
 {"date":"$today","heading":"$(dayname "$today")","pending":4,"overdue":1,"done":2,"important":2,"week":$week,"rows":[
  {"taskId":"t-late","occurrenceDate":null,"title":"Renew passport","label":"$(dayname "$yesterday")","due":"$yesterday","priority":"high","earlier":true},
  {"taskId":"t-bill","occurrenceDate":null,"title":"Pay electricity bill","label":"13:00","due":"${today}T13:00","priority":"high","earlier":false},
  {"taskId":"t-report","occurrenceDate":null,"title":"Project report draft","label":"16:30","due":"${today}T16:30","priority":"critical","earlier":false},
  {"taskId":"t-aws","occurrenceDate":"$today","title":"Complete AWS certification revision, chapters 7 to 9","label":"23:30","due":"${today}T23:30","priority":"medium","earlier":false},
  {"taskId":"t-bank","occurrenceDate":null,"title":"Call the bank","label":"Any","due":"$today","priority":"low","earlier":false}]},
 {"date":"$tomorrow","heading":"$(dayname "$tomorrow")","pending":0,"overdue":0,"done":0,"important":0,"week":[0,0,0,0,0,0,0],"rows":[]}]}
JSON
)"
b64="$(printf '%s' "$data" | base64 -w0)"

adb logcat -c
# Without data first (the app here is signed out and has sent none): the "open TaskFlow" message.
adb shell am broadcast -n "$receiver" -a com.ratnesh.taskflow.widgets.CHECK >/dev/null
sleep 4
for kind in today pending productivity next; do
  adb exec-out cat "/data/data/$pkg/files/widget-check/$kind-light.png" > "$out/widgets/$kind-empty.png" 2>/dev/null
done
adb shell am broadcast -n "$receiver" -a com.ratnesh.taskflow.widgets.CHECK --es data64 "$b64" >/dev/null
sleep 4
adb logcat -d -v time > "$out/widgets/logcat.txt"
grep "Widget check" "$out/widgets/logcat.txt" | cut -c1-200
drawn="$(grep -c "Widget check: .* drawn" "$out/widgets/logcat.txt")"
if grep -q "Widget check: .* FAILED" "$out/widgets/logcat.txt" || [ "$drawn" -ne 16 ]; then
  echo "Expected 16 widget drawings (4 widgets, light and dark, twice); got $drawn." >&2
  grep -A30 "Widget check: .* FAILED" "$out/widgets/logcat.txt" | cut -c1-300 | head -60
  fail=1
fi
for kind in today pending productivity next; do
  for theme in light dark; do
    f="$out/widgets/$kind-$theme.png"
    adb exec-out cat "/data/data/$pkg/files/widget-check/$kind-$theme.png" > "$f" 2>/dev/null
    echo "WIDGET-PNG $kind-$theme $(base64 -w0 "$f")"
  done
  echo "WIDGET-PNG $kind-empty $(base64 -w0 "$out/widgets/$kind-empty.png")"
done

echo "---- 3. ticking a task on a widget with the app closed ----"
adb shell am force-stop "$pkg"
adb logcat -c
adb shell am broadcast --include-stopped-packages -n "$receiver" -a com.ratnesh.taskflow.widgets.COMPLETE --es taskId ci-widget-tap >/dev/null
worker=0
for _ in $(seq 1 30); do
  sleep 2
  if adb logcat -d | grep -q "Saving widget taps"; then worker=1; break; fi
done
adb logcat -d -v time > "$out/widgets/logcat-tap.txt"
grep -E "TaskflowWidgets|WM-" "$out/widgets/logcat-tap.txt" | cut -c1-200 | head -20
if ! adb shell cat "/data/data/$pkg/shared_prefs/taskflow_alarms.xml" | grep -q "ci-widget-tap"; then
  echo "The tap was not queued for the app." >&2
  fail=1
fi
if [ "$worker" -ne 1 ]; then
  echo "The sync worker did not run within a minute of the tap." >&2
  fail=1
fi
if grep -qE "FATAL EXCEPTION|Fatal signal" "$out/widgets/logcat-tap.txt"; then
  grep -E -A40 "FATAL EXCEPTION|Fatal signal" "$out/widgets/logcat-tap.txt" | cut -c1-300 | head -80
  echo "Android logged a crash after the tap." >&2
  fail=1
fi

[ "$fail" -eq 0 ] && echo "The widgets are listed, draw in both themes, and a tap is queued and synced without a crash."
exit "$fail"
