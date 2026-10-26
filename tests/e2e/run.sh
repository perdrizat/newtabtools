#!/bin/bash
# tests/e2e/run.sh <browser> [vitest args...]
#
# One E2E lifecycle for every registered browser (`pnpm test:e2e:<browser>`).
# The same tests/e2e/*.test.ts files run on each; what differs per browser
# (launch, readiness, teardown) lives in a hook, tests/_browsers/<browser>/e2e.sh,
# sourced below. Lifecycle:
#   0. Resolve the browser's E2E config from tests/_browsers/registry.mjs:
#      engine, default channel (CHROME.md Decision 12: the production binary
#      — Firefox ESR, branded Chrome stable), port, artifacts dir.
#   1. Per-browser concurrency lock.
#   2. browser_launch (hook): start the browser with the extension loaded.
#   3. browser_wait_ready (hook): fail fast if the browser dies first.
#   4. Run Vitest's `e2e` project — tests connect via puppeteer-core
#      (tests/e2e/_helpers.ts reads the same registry via $NTT_BROWSER).
#   5. browser_stop (hook), from the EXIT trap.
#
# Per-version driver quirks: tests/compat/NOTEBOOK.md.

set -u

E2E_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BROWSERS_DIR="$( cd -- "$E2E_DIR/../_browsers" &> /dev/null && pwd )"

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: tests/e2e/run.sh <browser> [vitest args...]  (see tests/_browsers/registry.mjs)" >&2
  exit 2
fi
REQUESTED_BROWSER="$1"
shift

# 0. Registry lookup. Exports NTT_BROWSER, NTT_ENGINE, NTT_CHANNEL,
# NTT_E2E_PORT and NTT_E2E_ARTIFACTS_DIR (all registry constants, shell-quoted
# by the CLI); an unknown browser or a renamed legacy variable fails here.
ENV_LINES="$(NTT_BROWSER="$REQUESTED_BROWSER" node "$BROWSERS_DIR/registry.mjs" shell-env e2e)" || exit 1
eval "$ENV_LINES"

# The compat tier (tests/compat/run.mjs) reuses this lifecycle for its probe
# harness by selecting its own Vitest project.
VITEST_PROJECT="${NTT_VITEST_PROJECT:-e2e}"
case "$VITEST_PROJECT" in
  e2e|compat) ;;
  *) echo "Error: unknown NTT_VITEST_PROJECT '$VITEST_PROJECT' (expected e2e or compat)." >&2; exit 2 ;;
esac

HOOK="$BROWSERS_DIR/$NTT_BROWSER/e2e.sh"
if [ ! -f "$HOOK" ]; then
  echo "Error: no E2E launcher hook for '$NTT_BROWSER' ($HOOK)." >&2
  exit 1
fi

# 1. Concurrency lock, one per browser so different browsers' runs can go in
# parallel. Incident (2026-07-09/10): a second, unauthorized invocation ran
# while a first was still mid-suite; both shared the port and the profile dir,
# so the second's "fresh profile" wipe deleted the first run's live profile
# and its EXIT trap later killed the first run's browser. Three full-suite
# runs were lost. `mkdir` is atomic (exactly one caller wins a race), so it
# doubles as a lock: the directory's existence, gated on whether the PID
# recorded inside it is still alive, means "a run is in progress."
LOCK_DIR="$E2E_DIR/.runner-lock-$NTT_BROWSER"
LOCK_PID_FILE="$LOCK_DIR/pid"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  STALE_PID=""
  if [ -f "$LOCK_PID_FILE" ]; then
    STALE_PID="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$STALE_PID" ] && kill -0 "$STALE_PID" 2>/dev/null; then
    echo "Error: another $NTT_BROWSER E2E run is active (PID $STALE_PID) — refusing to double-run; remove $LOCK_DIR if stale." >&2
    exit 1
  fi
  # The lock dir exists but its owning PID is gone (or was never recorded) —
  # a stale lock left behind by a run that didn't exit cleanly. Reclaim it.
  echo "Stale $NTT_BROWSER E2E runner lock found (owner PID ${STALE_PID:-unknown} not running) — reclaiming." >&2
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "$LOCK_PID_FILE"

# The hook defines browser_launch, browser_wait_ready and browser_stop.
# shellcheck source=/dev/null
source "$HOOK"

cleanup() {
  browser_stop
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

# Fresh artifacts every run, scoped to this browser's own dir so concurrent
# runs of other browsers never race on fixtures/screenshots.
rm -rf "$NTT_E2E_ARTIFACTS_DIR"
mkdir -p "$NTT_E2E_ARTIFACTS_DIR"

echo "E2E: browser=$NTT_BROWSER engine=$NTT_ENGINE channel=$NTT_CHANNEL port=$NTT_E2E_PORT"

# 2-3. Launch and wait (hook).
browser_launch || exit 1
browser_wait_ready || exit 1

echo "$NTT_BROWSER ready. Running Vitest $VITEST_PROJECT project..."

# 4. Run the tests; pass through any extra args (e.g., a specific test file).
# Persist a durable pass/fail record: the json reporter writes a machine-
# readable results.json, and `tee` mirrors the full human-readable run to
# run.log — so "did last night's E2E pass?" is answerable from disk the next
# morning without re-running. ${PIPESTATUS[0]} keeps vitest's exit code.
npx vitest run --project "$VITEST_PROJECT" \
  --reporter=default --reporter=json --outputFile="$NTT_E2E_ARTIFACTS_DIR/results.json" \
  "$@" 2>&1 | tee "$NTT_E2E_ARTIFACTS_DIR/run.log"
EXIT_CODE=${PIPESTATUS[0]}

# 5. Teardown happens via the EXIT trap.
exit "$EXIT_CODE"
