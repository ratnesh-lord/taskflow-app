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

# Open the More tab's Reminders page by deep link if the app is still alive (signed out, it shows sign-in).
pid="$(adb shell pidof "$pkg" | tr -d '\r')"
adb logcat -d -v time > "$out/logcat-full.txt"
grep -E "AndroidRuntime|ReactNativeJS|$pkg|ExpoModulesCore|TaskManager|BackgroundTask|taskflow|FATAL|DEBUG +:" "$out/logcat-full.txt" > "$out/logcat-app.txt" || true

echo "---- crash lines ----"
grep -E "FATAL EXCEPTION|AndroidRuntime: |Fatal signal|ReactNativeJS: .*(Error|Exception)|E ReactNativeJS" "$out/logcat-full.txt" | head -80 || true
echo "---------------------"

if [ -z "$pid" ]; then
  echo "The app is not running 40 seconds after it was started: it crashed or closed." >&2
  exit 1
fi
if grep -qE "FATAL EXCEPTION|Fatal signal" "$out/logcat-full.txt"; then
  echo "Android logged a crash." >&2
  exit 1
fi
echo "The app started and is still running (pid $pid)."
