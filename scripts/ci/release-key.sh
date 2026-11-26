#!/usr/bin/env bash
# The APK's signing key, for GitHub Actions jobs (docs/DEPLOY.md).
#
#   release-key.sh use        Use TaskFlow's release key, if the repository has
#                             one: decodes the TASKFLOW_KEYSTORE_BASE64 secret
#                             and exports what plugins/with-release-signing.js
#                             reads. Without the secret the build keeps the
#                             shared debug key. Writes signing=release|debug.
#   release-key.sh throwaway  Make a new key that exists only in this job, to
#                             prove the release-signing path works (emulator
#                             test). Writes signing=release.
#   release-key.sh verify <apk> release|debug
#                             Check the APK is signed by the expected key and
#                             write its sha1 and sha256 fingerprints.
#
# Inputs for "use" (repository secrets): TASKFLOW_KEYSTORE_BASE64,
# TASKFLOW_KEYSTORE_PASSWORD, TASKFLOW_KEY_ALIAS, TASKFLOW_KEY_PASSWORD.
# Nothing secret is printed: GitHub hides secrets in logs, and the throwaway
# password is hidden with add-mask.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
envfile="${GITHUB_ENV:-/dev/null}"
tmp="${RUNNER_TEMP:-/tmp}"
store="${tmp}/taskflow-release.jks"
# React Native's shared debug key, which signs every build without a release key.
DEBUG_SHA1="5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25"

export_key() { # file store-password alias key-password
  {
    echo "TASKFLOW_UPLOAD_STORE_FILE=$1"
    echo "TASKFLOW_UPLOAD_STORE_PASSWORD=$2"
    echo "TASKFLOW_UPLOAD_KEY_ALIAS=$3"
    echo "TASKFLOW_UPLOAD_KEY_PASSWORD=$4"
  } >> "${envfile}"
}

# SHA1 or SHA256 fingerprint of a key in a keystore, as AA:BB:…
cert_fingerprint() { # store password alias SHA1|SHA256
  keytool -list -v -keystore "$1" -storepass "$2" -alias "$3" 2>/dev/null |
    awk -v want="$4:" '$1 == want { print $2; exit }'
}

case "${1:-}" in
  use)
    if [[ -z "${TASKFLOW_KEYSTORE_BASE64:-}" ]]; then
      echo "::notice::No release key in this repository's secrets: the APK is signed with the shared debug key. See docs/DEPLOY.md, 'Release signing key'."
      echo "signing=debug" >> "${out}"
      exit 0
    fi
    missing=()
    for v in TASKFLOW_KEYSTORE_PASSWORD TASKFLOW_KEY_ALIAS TASKFLOW_KEY_PASSWORD; do
      [[ -n "${!v:-}" ]] || missing+=("$v")
    done
    if ((${#missing[@]})); then
      echo "::error::TASKFLOW_KEYSTORE_BASE64 is set but these secrets are missing: ${missing[*]}. Add them (docs/DEPLOY.md) and run the build again."
      exit 1
    fi
    if ! printf '%s' "${TASKFLOW_KEYSTORE_BASE64}" | tr -d ' \r\n' | base64 -d > "${store}" 2>/dev/null || [[ ! -s "${store}" ]]; then
      echo "::error::TASKFLOW_KEYSTORE_BASE64 is not valid base64. Paste the whole value from taskflow-release-key.txt again."
      exit 1
    fi
    if [[ -z "$(cert_fingerprint "${store}" "${TASKFLOW_KEYSTORE_PASSWORD}" "${TASKFLOW_KEY_ALIAS}" SHA256)" ]]; then
      echo "::error::The release key could not be opened with TASKFLOW_KEYSTORE_PASSWORD and TASKFLOW_KEY_ALIAS. Check both secrets against taskflow-release-key.txt."
      exit 1
    fi
    export_key "${store}" "${TASKFLOW_KEYSTORE_PASSWORD}" "${TASKFLOW_KEY_ALIAS}" "${TASKFLOW_KEY_PASSWORD}"
    echo "signing=release" >> "${out}"
    echo "Using the release key."
    ;;

  throwaway)
    password="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    echo "::add-mask::${password}"
    rm -f "${store}"
    keytool -genkeypair -v -keystore "${store}" -storetype PKCS12 -storepass "${password}" -keypass "${password}" \
      -alias throwaway -keyalg RSA -keysize 2048 -validity 1 -dname "CN=TaskFlow throwaway test key" >/dev/null 2>&1
    export_key "${store}" "${password}" throwaway "${password}"
    echo "signing=release" >> "${out}"
    echo "Made a throwaway key for this job."
    ;;

  verify)
    apk="${2:?usage: release-key.sh verify <apk> release|debug}"
    expect="${3:?usage: release-key.sh verify <apk> release|debug}"
    tools="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools"
    apksigner="$(ls -d "${tools}"/*/ 2>/dev/null | sort -V | tail -1)apksigner"
    [[ -x "${apksigner}" ]] || { echo "::error::apksigner not found under ${tools}"; exit 1; }
    certs="$("${apksigner}" verify --print-certs "${apk}")"
    # "Signer #1 certificate …" or, for an APK with only a v2 signature, "V2 Signer: certificate …".
    digest() { sed -n "s/^.*[Ss]igner[^:]*:\{0,1\} certificate $1 digest: //p" <<<"${certs}" | head -1 | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//'; }
    sha256="$(digest SHA-256)"
    sha1="$(digest SHA-1)"
    [[ -n "${sha256}" && -n "${sha1}" ]] || { echo "::error::Could not read the APK's signature"; echo "${certs}"; exit 1; }
    if [[ "${expect}" == debug ]]; then
      want="${DEBUG_SHA1}"; got="${sha1}"
    else
      want="$(cert_fingerprint "${TASKFLOW_UPLOAD_STORE_FILE}" "${TASKFLOW_UPLOAD_STORE_PASSWORD}" "${TASKFLOW_UPLOAD_KEY_ALIAS}" SHA256)"; got="${sha256}"
    fi
    if [[ "${got}" != "${want}" ]]; then
      echo "::error::The APK is not signed with the ${expect} key (expected ${want}, found ${got})."
      exit 1
    fi
    { echo "sha1=${sha1}"; echo "sha256=${sha256}"; } >> "${out}"
    echo "The APK is signed with the ${expect} key. SHA-1 ${sha1}"
    ;;

  *)
    echo "usage: $0 use | throwaway | verify <apk> release|debug" >&2
    exit 2
    ;;
esac
