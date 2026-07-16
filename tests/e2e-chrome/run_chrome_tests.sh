#!/bin/bash
# tests/e2e-chrome/run_chrome_tests.sh
#
# Chrome sibling of tests/e2e/run_esr_tests.sh (CHROME.md D5b). Lifecycle:
#   1. Concurrency lock (this tier's OWN lock dir — independent of the
#      Firefox E2E lock, so both tiers can run at once per CONTRIBUTING.md's
#      "Running test tiers in parallel" practice).
#   2. Resolve a Chrome for Testing binary + stage the unpacked dev build
#      (tests/e2e-chrome/_tools/chrome-env.mjs, the same staging path
#      chrome:smoke/chrome:stage use) via print-launch-env.mjs.
#   3. Launch the CfT binary DIRECTLY (no web-ext — Chrome has no equivalent
#      launcher) with --load-extension + a fresh throwaway profile
#      (--user-data-dir) and CDP listening on port 9223 (the port reserved
#      in tests/e2e-chrome/README.md's port table for exactly this).
#   4. Wait for the CDP port to be reachable.
#   5. Run Vitest's `e2e` project — the SAME 32 test files run.sh's Firefox
#      path runs — with NTT_E2E_BROWSER=chrome so tests/e2e/_helpers.ts's
#      connectToFirefox()/getNewTabURL() switch to the CDP/chrome-extension://
#      paths.
#   6. Tear down Chrome + the throwaway profile.
#
# Unlike Firefox, --load-extension works directly on Chrome for Testing (D1
# finding: only BRANDED Chrome >=137 removed it) — no CDP installExtension
# dance needed here, unlike chrome-smoke.mjs's Puppeteer-launch path, which
# targets branded-Chrome-compatible automation and so avoids the legacy
# flags entirely. This runner only ever targets CfT, so the direct flags are
# the simpler, equally-supported route (tests/e2e-chrome/README.md "Three
# hard-won harness facts", fact 1).

set -u

PORT=9223

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ARTIFACTS_DIR="$SCRIPT_DIR/../e2e/_artifacts"

# 0. Concurrency lock — this tier's own lock dir, independent of Firefox
# E2E's tests/e2e/.runner-lock (same mkdir-atomicity technique + stale-PID
# reclaim as run_esr_tests.sh; see that script's header comment for the
# incident that motivated it).
LOCK_DIR="$SCRIPT_DIR/.runner-lock"
LOCK_PID_FILE="$LOCK_DIR/pid"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  STALE_PID=""
  if [ -f "$LOCK_PID_FILE" ]; then
    STALE_PID="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$STALE_PID" ] && kill -0 "$STALE_PID" 2>/dev/null; then
    echo "Error: another Chrome E2E run is active (PID $STALE_PID) — refusing to double-run; remove $LOCK_DIR if stale." >&2
    exit 1
  fi
  echo "Stale Chrome E2E runner lock found (owner PID ${STALE_PID:-unknown} not running) — reclaiming." >&2
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "$LOCK_PID_FILE"
trap 'rm -rf "$LOCK_DIR"' EXIT

# 1. Resolve the Chrome binary + stage the dev build. print-launch-env.mjs
# does the JS-only work (chrome-env.mjs's resolveChromeBinary/stageDevBuild)
# and prints KEY=value lines this script evals; it exits nonzero (with a
# diagnostic on stderr, already surfaced by the bare invocation) if no usable
# binary is found.
LAUNCH_ENV="$(node "$SCRIPT_DIR/_tools/print-launch-env.mjs")"
LAUNCH_STATUS=$?
if [ "$LAUNCH_STATUS" -ne 0 ]; then
  exit "$LAUNCH_STATUS"
fi
eval "$LAUNCH_ENV"
# CHROME_BIN, STAGE_DIR, EXTENSION_ID now set by the eval above.

# 2. Fresh throwaway profile every run, so tests are fully isolated — same
# rationale as run_esr_tests.sh's PROFILE_DIR, via a real tmp dir since
# Chrome (unlike web-ext) has no equivalent of a project-local profile flag.
CHROME_PROFILE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ntt-chrome-profile.XXXXXX")"

# 3. Clean slate for any process left behind by a previous crashed run of
# THIS script — scoped to this run's own profile dir path (never a blanket
# `pkill chrome`, which would kill a developer's daily-driver browser).
pkill -f "$CHROME_PROFILE_DIR" 2>/dev/null || true

echo "Using Chrome for Testing: $CHROME_BIN (extension id $EXTENSION_ID)"
echo "Launching Chrome with the staged dev build..."
"$CHROME_BIN" \
  --headless=new \
  --remote-debugging-port="$PORT" \
  --load-extension="$STAGE_DIR" \
  --disable-extensions-except="$STAGE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --user-data-dir="$CHROME_PROFILE_DIR" &
CHROME_PID=$!

cleanup() {
  pkill -f "$CHROME_PROFILE_DIR" 2>/dev/null || true
  wait "$CHROME_PID" 2>/dev/null || true
  rm -rf "$CHROME_PROFILE_DIR"
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

# 4. Wait for the CDP port to be reachable (timeout 30s) — same fail-fast
# shape as run_esr_tests.sh's Firefox port wait.
echo "Waiting for Chrome to be ready on port $PORT..."
count=0
until nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  if ! kill -0 "$CHROME_PID" 2>/dev/null; then
    echo "Error: Chrome exited before the debugging port ($PORT) came up." >&2
    exit 1
  fi
  count=$((count + 1))
  if [ "$count" -eq 30 ]; then
    echo "Error: Chrome failed to open port $PORT within 30s" >&2
    exit 1
  fi
  sleep 1
done

mkdir -p "$ARTIFACTS_DIR"
echo "Chrome ready. Running Vitest e2e project (NTT_E2E_BROWSER=chrome)..."

# 5. Run the tests; pass through any extra args (e.g., a specific test file).
NTT_E2E_BROWSER=chrome npx vitest run --project e2e "$@"
EXIT_CODE=$?

# 6. Cleanup happens via the EXIT trap.
exit "$EXIT_CODE"
