#!/usr/bin/env bash
# Prepares an exported web app (npx expo export --platform web) for a static
# host such as GitHub Pages:
#   404.html   a copy of index.html. Pages serves it for any path that is not a
#              file, so opening /taskflow-app/settings or a sign-in link
#              starts the app, which then shows the right screen.
#   .nojekyll  for hosts that run Jekyll on uploaded files, which would hide
#              folders starting with "_" (the app's code is in _expo). The
#              GitHub Actions deploy does not run Jekyll and skips this file.
set -euo pipefail
out="${1:?usage: finish-export.sh <export folder>}"
test -f "${out}/index.html" || { echo "no index.html in ${out}" >&2; exit 1; }
cp "${out}/index.html" "${out}/404.html"
touch "${out}/.nojekyll"
