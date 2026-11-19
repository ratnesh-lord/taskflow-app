#!/usr/bin/env bash
# Runs the alarm runtime's plain-Kotlin rules (AlarmMath.kt) on an ordinary JVM.
# Needs kotlinc on PATH or KOTLINC pointing to it; the Android parts are built by CI.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
kotlinc="${KOTLINC:-kotlinc}"
out="$(mktemp -d)"
"$kotlinc" -nowarn "$here/android/src/main/java/com/ratnesh/taskflow/alarms/AlarmMath.kt" "$here/kotlin-tests/AlarmMathTest.kt" -include-runtime -d "$out/test.jar" 2>&1 | grep -v "^warning" || true
java -cp "$out/test.jar" AlarmMathTestKt
