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

# 1b. Fail fast if the Firefox ESR binary is missing or not a real Firefox.
# This is the E2E analogue of the UAT preflight's Firefox check: without it,
# web-ext launches, fails opaquely, and we'd burn the full port-wait timeout
# before reporting a generic "failed to start". Validate the binary up front
# with a clean `--version` (override with $FIREFOX_ESR_BIN).
FIREFOX_BIN="${FIREFOX_ESR_BIN:-firefox-esr}"
if ! command -v "$FIREFOX_BIN" >/dev/null 2>&1; then
  echo "Error: '$FIREFOX_BIN' not found on PATH." >&2
  echo "       Install Firefox ESR (e.g. apt install firefox-esr) or set \$FIREFOX_ESR_BIN." >&2
  exit 1
fi
FX_VERSION_OUT="$("$FIREFOX_BIN" --version 2>&1)"
if ! printf '%s' "$FX_VERSION_OUT" | grep -q "Mozilla Firefox"; then
  echo "Error: '$FIREFOX_BIN --version' did not report a Firefox version:" >&2
  echo "       $FX_VERSION_OUT" >&2
  echo "       The binary may be a broken wrapper — install the ESR build or set \$FIREFOX_ESR_BIN to a real Firefox." >&2
  exit 1
fi
echo "Using $FX_VERSION_OUT ($FIREFOX_BIN)"

# 2. Launch Firefox ESR with the extension loaded and BiDi enabled
echo "Launching Firefox ESR via web-ext..."
web-ext run \
  --source-dir webextension/ \
  --firefox="$FIREFOX_BIN" \
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

# 3. Wait for the port to be reachable (timeout 30s). Abort the moment web-ext
# (and thus Firefox ESR) dies, rather than polling a dead process for the full
# timeout — the E2E analogue of the UAT runner's fail-fast-on-daemon-exit. The
# backgrounded web-ext output above carries the cause.
echo "Waiting for Firefox ESR to be ready on port $PORT..."
count=0
until nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  if ! kill -0 "$WEB_EXT_PID" 2>/dev/null; then
    echo "Error: web-ext/Firefox ESR exited before the debugging port ($PORT) came up." >&2
    echo "       See the web-ext output above for the cause (e.g. Firefox failed to launch)." >&2
    exit 1
  fi
  count=$((count + 1))
  if [ "$count" -eq 30 ]; then
    echo "Error: Firefox ESR failed to open port $PORT within 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "Firefox ESR ready. Running Vitest e2e project..."

# 4. Run the tests; pass through any extra args (e.g., a specific test file)
npx vitest run --project e2e "$@"
EXIT_CODE=$?

# 5. Cleanup happens via the EXIT trap
exit "$EXIT_CODE"
