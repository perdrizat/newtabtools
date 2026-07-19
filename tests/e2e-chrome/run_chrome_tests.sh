#!/bin/bash
# tests/e2e-chrome/run_chrome_tests.sh
#
# Chrome sibling of tests/e2e/run_esr_tests.sh (CHROME.md D5b; rewritten for
# D8/Decision 12). Lifecycle:
#   1. Concurrency lock (this tier's OWN lock dir — independent of the
#      Firefox E2E lock, so both tiers can run at once per CONTRIBUTING.md's
#      "Running test tiers in parallel" practice).
#   2. Launch tests/e2e-chrome/_tools/launch-chrome.mjs as a background
#      process. It resolves a Chrome binary BRANDED-FIRST (CfT is the
#      fallback lane only when no branded binary exists — CHROME.md Decision
#      12: the E2E tier runs the production binary users actually have),
#      stages the unpacked dev build, and launches Chrome with a DUAL
#      transport: Puppeteer's `pipe: true` (branded's CDP `Extensions` domain
#      is pipe-only — `browser.installExtension()` installs the staged build
#      over it) AND `--remote-debugging-port=9223` (so this script's Vitest
#      run, exactly like before, connects over the port — zero test-file
#      changes). The old rationale ("--load-extension works on CfT") is
#      superseded: branded ignores --load-extension outright, but the CDP
#      pipe-install route WORKS on branded stable (D1 amendment, 2026-07-18).
#   3. Wait for the launcher's ready-file (tests/e2e-chrome/.launcher-ready) —
#      written by the launcher only AFTER it confirms the extension's
#      service-worker target is visible over the PORT (not just the pipe),
#      closing the probe's one open caveat (SW visibility over the port
#      lagged when sampled immediately after install). The ready-file
#      therefore implies "port is up AND SW is visible over it", replacing
#      the old bare `nc -z` port check.
#   4. Run Vitest's `e2e` project — the SAME 32 test files run.sh's Firefox
#      path runs — with NTT_E2E_BROWSER=chrome so tests/e2e/_helpers.ts's
#      connectToFirefox()/getNewTabURL() switch to the CDP/chrome-extension://
#      paths (unchanged by this rewrite).
#   5. Tear down: signal the launcher (SIGTERM), which closes Chrome +
#      Puppeteer's own temp profile and removes the ready-file itself; this
#      script's cleanup() only removes the ready-file defensively and the
#      lock dir.

set -u

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ARTIFACTS_DIR="$SCRIPT_DIR/../e2e/_artifacts-cft"
READY_FILE="$SCRIPT_DIR/.launcher-ready"

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

# 1. Launch the branded-first dual-transport launcher in the background. It
# owns the Chrome process + Puppeteer's temp profile end to end (resolve
# binary, stage build, launch, install extension over the pipe, wait for the
# SW to be visible over the port, write the ready-file) — this script never
# touches Chrome flags or a profile dir directly anymore.
rm -f "$READY_FILE"
echo "Starting the Chrome E2E launcher (branded-first, CfT fallback)..."
node "$SCRIPT_DIR/_tools/launch-chrome.mjs" &
LAUNCHER_PID=$!

cleanup() {
  if kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    kill -TERM "$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  rm -f "$READY_FILE"
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

# 2. Wait for the ready-file (up to 90s, 1s steps) — fail fast if the
# launcher process died before ever signaling readiness instead of waiting
# out the full timeout.
echo "Waiting for the Chrome E2E launcher to become ready..."
count=0
until [ -f "$READY_FILE" ]; do
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    echo "Error: the Chrome E2E launcher exited before signaling readiness (no ready-file at $READY_FILE)." >&2
    exit 1
  fi
  count=$((count + 1))
  if [ "$count" -eq 90 ]; then
    echo "Error: the Chrome E2E launcher did not signal readiness within 90s (no ready-file at $READY_FILE)." >&2
    exit 1
  fi
  sleep 1
done
echo "Launcher ready:"
sed 's/^/  /' "$READY_FILE" 2>/dev/null || true

# Fresh artifacts every run, scoped to this tier's own dir (`_artifacts-cft`)
# so it never races the Firefox suite's `_artifacts-ff` when both run
# concurrently.
rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"
echo "Chrome ready. Running Vitest e2e project (NTT_E2E_BROWSER=chrome)..."

# 3. Run the tests; pass through any extra args (e.g., a specific test file).
# Persist a durable pass/fail record (see run_esr_tests.sh for the rationale):
# results.json (machine-readable) + run.log (full human output via tee).
# $ARTIFACTS_DIR was just recreated above. ${PIPESTATUS[0]} keeps vitest's exit.
NTT_E2E_BROWSER=chrome npx vitest run --project e2e \
  --reporter=default --reporter=json --outputFile="$ARTIFACTS_DIR/results.json" \
  "$@" 2>&1 | tee "$ARTIFACTS_DIR/run.log"
EXIT_CODE=${PIPESTATUS[0]}

# 4. Teardown happens via the EXIT trap (signals the launcher, which closes
# Chrome + its temp profile and removes the ready-file itself).
exit "$EXIT_CODE"
