#!/usr/bin/env bash
# Runs the plain-Kotlin rules of the alarm runtime (AlarmMath.kt) and the
# widgets (WidgetMath.kt) on an ordinary JVM.
# Needs kotlinc on PATH or KOTLINC pointing to it; the Android parts are built by CI.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/android/src/main/java/com/ratnesh/taskflow/alarms"
kotlinc="${KOTLINC:-kotlinc}"
out="$(mktemp -d)"
"$kotlinc" -nowarn "$src/AlarmMath.kt" "$here/kotlin-tests/AlarmMathTest.kt" -include-runtime -d "$out/alarms.jar" 2>&1 | grep -v "^warning" || true
java -cp "$out/alarms.jar" AlarmMathTestKt
"$kotlinc" -nowarn "$src/AlarmMath.kt" "$src/WidgetMath.kt" "$here/kotlin-tests/WidgetMathTest.kt" -include-runtime -d "$out/widgets.jar" 2>&1 | grep -v "^warning" || true
java -cp "$out/widgets.jar" WidgetMathTestKt
