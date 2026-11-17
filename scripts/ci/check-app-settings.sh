#!/usr/bin/env bash
# Checks the Supabase address and key that get built into the app, before ten
# minutes are spent on a build that could not connect.
#
# Usage: scripts/ci/check-app-settings.sh strict|warn
#   strict  any problem fails the job (builds that will be published)
#   warn    problems are reported as warnings (all other builds)
# A secret key fails the job in both modes: it must never reach an APK.
#
# Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY. The format rules
# match checkConfig() in src/platform/env.ts. When the values are usable it asks
# the project's sign-in service whether it accepts the key, and writes host,
# google and confirm_email to $GITHUB_OUTPUT for the release notes.
set -uo pipefail

mode="${1:-strict}"
case "$mode" in
  strict | warn) ;;
  *) echo "usage: $0 strict|warn" >&2; exit 2 ;;
esac

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

url="$(trim "${EXPO_PUBLIC_SUPABASE_URL:-}")"
while [[ "$url" == */ ]]; do url="${url%/}"; done
key="$(trim "${EXPO_PUBLIC_SUPABASE_KEY:-}")"

where="GitHub: Settings > Secrets and variables > Actions > Variables"
fatal=()     # always fail
problems=()  # fail in strict mode, warn otherwise
notes=()     # always just a warning

# The role inside a legacy JWT key ("anon" or "service_role"), or nothing.
jwt_role() {
  local payload="${1#*.}"
  payload="${payload%%.*}"
  payload="$(printf '%s' "$payload" | tr '_-' '/+')"
  while (( ${#payload} % 4 )); do payload="${payload}="; done
  printf '%s' "$payload" | base64 -d 2>/dev/null |
    python3 -c 'import json, sys; print(json.load(sys.stdin).get("role", ""))' 2>/dev/null
}

# --- the address -------------------------------------------------------------
host_part="${url#*://}"
host_part="${host_part%%/*}"
if [ -z "$url" ]; then
  problems+=("EXPO_PUBLIC_SUPABASE_URL is empty. Add it under ${where}, set to your Project URL from Supabase (the Connect button), like https://abcdefgh.supabase.co")
elif [[ "$url" =~ ^postgres(ql)?:// ]]; then
  problems+=("EXPO_PUBLIC_SUPABASE_URL holds the database connection string. The app needs the Project URL instead, like https://abcdefgh.supabase.co")
elif [[ "$url" =~ ^https://[^[:space:]/]+$ || "$url" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
  :
elif [[ "$url" =~ ^https://[^[:space:]/]+/ ]]; then
  problems+=("EXPO_PUBLIC_SUPABASE_URL must be the address only, with nothing after the host. Use https://${host_part}")
elif [[ "$url" =~ ^http:// ]]; then
  problems+=("EXPO_PUBLIC_SUPABASE_URL must start with https:// (use https://${host_part})")
else
  problems+=("EXPO_PUBLIC_SUPABASE_URL is not a web address. Use the Project URL from Supabase, like https://abcdefgh.supabase.co")
fi

# --- the key -------------------------------------------------------------------
secret_msg="must never go into the app: anyone holding the APK could read and delete every user's data. Delete it from GitHub, revoke it in Supabase (Settings > API Keys), and use the Publishable key (sb_publishable_...) instead."
if [ -z "$key" ]; then
  problems+=("EXPO_PUBLIC_SUPABASE_KEY is empty. Add it under ${where}, set to the Publishable key from Supabase (Settings > API Keys), which starts with sb_publishable_")
elif [[ "$key" == sb_secret_* ]]; then
  fatal+=("EXPO_PUBLIC_SUPABASE_KEY holds a SECRET key (sb_secret_...). It ${secret_msg}")
elif [[ "$key" =~ [[:space:]] ]]; then
  problems+=("EXPO_PUBLIC_SUPABASE_KEY contains a space or a line break. Copy the Publishable key again.")
elif [[ "$key" == eyJ*.*.* && "$(jwt_role "$key")" == "service_role" ]]; then
  fatal+=("EXPO_PUBLIC_SUPABASE_KEY holds the service_role key. It ${secret_msg}")
elif (( ${#key} < 20 )); then
  problems+=("EXPO_PUBLIC_SUPABASE_KEY is too short to be a Supabase key. Copy the whole Publishable key.")
fi

# --- ask the project whether it accepts the key ------------------------------------
host=""
google="unknown"
confirm="unknown"
if (( ${#fatal[@]} == 0 && ${#problems[@]} == 0 )); then
  host="$host_part"
  body="$(mktemp)"
  code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 -H "apikey: ${key}" "${url}/auth/v1/settings" 2>/dev/null)"
  rc=$?
  if (( rc == 6 )); then
    problems+=("No server answers at ${url}. Check EXPO_PUBLIC_SUPABASE_URL for a typo: it must match the Project URL in Supabase.")
  elif (( rc != 0 )); then
    notes+=("Could not reach ${url} to check the key (curl error ${rc}). Building anyway.")
  elif [ "$code" = "200" ]; then
    read -r google confirm < <(python3 - "$body" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    external = data.get("external") or {}
    print("on" if external.get("google") else "off", "off" if data.get("mailer_autoconfirm") else "on")
except Exception:
    print("unknown unknown")
PY
)
  elif [ "$code" = "401" ] || [ "$code" = "403" ]; then
    problems+=("Supabase refused EXPO_PUBLIC_SUPABASE_KEY (HTTP ${code}): the key belongs to another project or was revoked. Copy the Publishable key of the project at ${url}.")
  elif [ "$code" = "404" ]; then
    problems+=("${url} does not answer like a Supabase project (HTTP 404). Check EXPO_PUBLIC_SUPABASE_URL.")
  else
    notes+=("Supabase answered HTTP ${code} when the key was checked; the project may be paused or busy. Building anyway.")
  fi
  rm -f "$body"
fi

# --- report ----------------------------------------------------------------------------
emit() {
  local msg="${2//%/%25}"
  msg="${msg//$'\n'/%0A}"
  echo "::$1 title=App settings::${msg}"
}
level="error"
[ "$mode" = "warn" ] && level="warning"
for m in "${fatal[@]}"; do emit error "$m"; done
for m in "${problems[@]}"; do emit "$level" "$m"; done
for m in "${notes[@]}"; do emit warning "$m"; done

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "host=${host}"
    echo "google=${google}"
    echo "confirm_email=${confirm}"
  } >> "$GITHUB_OUTPUT"
fi

if (( ${#fatal[@]} > 0 )); then
  summary="The build was stopped: a secret key was about to be put into the app."
  status=1
elif (( ${#problems[@]} > 0 )); then
  if [ "$mode" = "strict" ]; then
    summary="The build was stopped: this APK would open on \"Not connected yet\". Fix the settings named above, then run the workflow again."
    status=1
  else
    summary="This build will open on \"Not connected yet\" (only builds from main are published)."
    status=0
  fi
else
  summary="The app will connect to ${host}. Google sign-in: ${google}. Email confirmation: ${confirm}."
  status=0
fi

echo "$summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### App settings"
    echo
    echo "$summary"
    for m in "${fatal[@]}" "${problems[@]}" "${notes[@]}"; do echo "- $m"; done
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
