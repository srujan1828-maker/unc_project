#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The packaged-app smoke test requires macOS.' >&2
  exit 1
fi
app="$PWD/build/OmniSync.app"
codesign --verify --deep --strict "$app"
# Launch this exact built binary and observe startup without changing user data.
# The test argument disables saved-session loading and networking.
"$app/Contents/MacOS/OmniSync" --omnisync-smoke-test > build/launch.log 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true' EXIT
for attempt in 1 2 3 4 5; do
  sleep 1
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat build/launch.log >&2
    echo 'The macOS app exited during startup.' >&2
    exit 1
  fi
done
echo 'Packaged macOS application stayed running through the startup check.'
