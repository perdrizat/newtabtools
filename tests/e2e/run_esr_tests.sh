#!/bin/bash
# tests/e2e/run_esr_tests.sh
#
# Lifecycle for E2E tests:
#   1. Kill any stray firefox-esr processes
#   2. Launch Firefox ESR via web-ext with the unpacked extension and
#      WebDriver BiDi enabled on port 9222
#   3. Wait for the BiDi port to be reachable
#   4. Run Vitest's `e2e` project — tests connect via puppeteer-core
#   5. Tear down Firefox

set -u

PORT=9222

# Path of this script's directory — keeps the orchestrator portable
# (no hardcoded absolute paths). All paths below are anchored on this.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROFILE_DIR="$SCRIPT_DIR/test-profile"
export NTT_E2E_PROFILE_DIR="$PROFILE_DIR"
ARTIFACTS_DIR="$SCRIPT_DIR/_artifacts"

# Fresh profile every run so tests are fully isolated. Read from prefs.js
# inside _helpers.js to discover the extension UUID.
rm -rf "$PROFILE_DIR" "$ARTIFACTS_DIR"
mkdir -p "$PROFILE_DIR"



# 1. Clean slate
pkill -f firefox-esr 2>/dev/null || true

# 2. Launch Firefox ESR with the extension loaded and BiDi enabled
echo "Launching Firefox ESR via web-ext..."
web-ext run \
  --source-dir webextension/ \
  --firefox=firefox-esr \
  --firefox-profile "$PROFILE_DIR" \
  --keep-profile-changes \
  --args="--remote-debugging-port" --args="$PORT" --args="-headless" &
WEB_EXT_PID=$!

cleanup() {
  pkill -f firefox-esr 2>/dev/null || true
  wait "$WEB_EXT_PID" 2>/dev/null || true
  rm -rf "$PROFILE_DIR"
}
trap cleanup EXIT

# 3. Wait for the port to be reachable (timeout 30s)
echo "Waiting for Firefox ESR to be ready on port $PORT..."
count=0
until nc -z 127.0.0.1 "$PORT" 2>/dev/null || [ "$count" -eq 30 ]; do
  sleep 1
  count=$((count + 1))
done

if [ "$count" -eq 30 ]; then
  echo "Error: Firefox ESR failed to start on port $PORT"
  exit 1
fi

echo "Firefox ESR ready. Running Vitest e2e project..."

# 4. Run the tests; pass through any extra args (e.g., a specific test file)
npx vitest run --project e2e "$@"
EXIT_CODE=$?

# 5. Cleanup happens via the EXIT trap
exit "$EXIT_CODE"
