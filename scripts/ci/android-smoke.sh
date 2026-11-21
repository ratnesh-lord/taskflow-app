#!/usr/bin/env bash
# Install the APK on the running emulator, start it, wait, and report.
# Fails when the app's process has died or Android logged a crash for it.
#   bash scripts/ci/android-smoke.sh <apk> <package> <out-dir>
set -uo pipefail
apk="$1"; pkg="$2"; out="$3"
mkdir -p "$out"

adb install -r -g "$apk" || exit 1
adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 40
adb exec-out screencap -p > "$out/screen-after-start.png"

# The alarm runtime's receivers: a restart, a time-zone change and a due alarm,
# sent as the system would (the emulator image allows root).
adb root >/dev/null 2>&1 && sleep 3
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p "$pkg" >/dev/null
adb shell am broadcast -a android.intent.action.TIMEZONE_CHANGED -p "$pkg" >/dev/null
adb shell am broadcast -n "$pkg/com.ratnesh.taskflow.alarms.AlarmReceiver" >/dev/null
sleep 5

# Open the More tab's Reminders page by deep link if the app is still alive (signed out, it shows sign-in).
pid="$(adb shell pidof "$pkg" | tr -d '\r')"
adb logcat -d -v time > "$out/logcat-full.txt"
grep -E "AndroidRuntime|ReactNativeJS|$pkg|ExpoModulesCore|TaskManager|BackgroundTask|taskflow|FATAL|DEBUG +:" "$out/logcat-full.txt" > "$out/logcat-app.txt" || true

echo "---- crashes, with their stack traces ----"
grep -E -A45 "FATAL EXCEPTION|Fatal signal" "$out/logcat-full.txt" | cut -c1-300 | head -150 || true
echo "---- JavaScript errors ----"
grep -E "ReactNativeJS|ExpoModulesCore" "$out/logcat-full.txt" | grep -iE "error|exception|warn" | cut -c1-400 | head -40 || true
echo "-------------------------------------------"

if [ -z "$pid" ]; then
  echo "The app is not running 40 seconds after it was started: it crashed or closed." >&2
  exit 1
fi
if grep -qE "FATAL EXCEPTION|Fatal signal" "$out/logcat-full.txt"; then
  echo "Android logged a crash." >&2
  exit 1
fi
echo "The app started and is still running (pid $pid)."
