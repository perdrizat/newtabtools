#!/bin/bash
# tests/e2e/run_esr_tests.sh
#
# Lifecycle for E2E tests:
#   1. Kill any stray firefox processes
#   2. Launch Firefox via web-ext with the unpacked extension and
#      WebDriver BiDi enabled on port 9222
#   3. Wait for the BiDi port to be reachable
#   4. Run Vitest's `e2e` project — tests connect via puppeteer-core
#   5. Tear down Firefox
#
# Default binary is `firefox-esr` (CHROME.md Decision 12: the frequent tier runs
# the production binary). MV3's `tabs.captureVisibleTab` needs Firefox >= 152,
# so this ran on release until the 153 ESR shipped. `$FIREFOX_ESR_BIN`
# overrides the binary (e.g. `FIREFOX_ESR_BIN=firefox` to preview release-only
# driver gates). Per-version quirks: tests/BROWSER-COMPAT.md.

set -u

PORT=9222

# Path of this script's directory — keeps the orchestrator portable
# (no hardcoded absolute paths). All paths below are anchored on this.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROFILE_DIR="$SCRIPT_DIR/test-profile"
export NTT_E2E_PROFILE_DIR="$PROFILE_DIR"
ARTIFACTS_DIR="$SCRIPT_DIR/_artifacts-ff"

# 0. Concurrency lock. Incident (2026-07-09/10): a second, unauthorized
# invocation of this script ran while a first was still mid-suite. Both
# invocations share $PORT and $PROFILE_DIR — the second's "fresh profile"
# `rm -rf "$PROFILE_DIR"` below deleted the first run's live profile out from
# under it, and when the second run's own EXIT trap later fired
# `pkill -f "$PROFILE_DIR"`, it killed the FIRST run's Firefox (same path,
# now reused). Three full-suite runs were lost. `mkdir` is atomic (POSIX
# guarantees exactly one caller wins when two processes race it), so it
# doubles as a simple lock: this directory's existence, gated on whether the
# PID recorded inside it is still alive, means "a run is in progress."
LOCK_DIR="$SCRIPT_DIR/.runner-lock"
LOCK_PID_FILE="$LOCK_DIR/pid"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  STALE_PID=""
  if [ -f "$LOCK_PID_FILE" ]; then
    STALE_PID="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$STALE_PID" ] && kill -0 "$STALE_PID" 2>/dev/null; then
    echo "Error: another E2E run is active (PID $STALE_PID) — refusing to double-run; remove $LOCK_DIR if stale." >&2
    exit 1
  fi
  # The lock dir exists but its owning PID is gone (or was never recorded) —
  # a stale lock left behind by a run that didn't exit cleanly. Reclaim it.
  echo "Stale E2E runner lock found (owner PID ${STALE_PID:-unknown} not running) — reclaiming." >&2
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "$LOCK_PID_FILE"
# Covers exits before the fuller `cleanup` trap below is installed (e.g. the
# Firefox-binary preflight checks); `cleanup` itself releases the lock too,
# and replaces this trap once it's installed.
trap 'rm -rf "$LOCK_DIR"' EXIT

# Fresh profile every run so tests are fully isolated. Read from prefs.js
# inside _helpers.js to discover the extension UUID.
rm -rf "$PROFILE_DIR" "$ARTIFACTS_DIR"
mkdir -p "$PROFILE_DIR"



# 1. Clean slate. Scoped to THIS script's test profile only: $PROFILE_DIR is
# unique to this script and appears in the launched process's command line via
# web-ext's `--firefox-profile` -> `-profile <dir>` translation. Never match on
# a binary name: `pkill -f firefox` would kill a developer's daily-driver
# browser, and the former `pkill -f firefox-esr` killed the invoking shell
# itself whenever `FIREFOX_ESR_BIN=firefox-esr` was on its command line.
pkill -f "$PROFILE_DIR" 2>/dev/null || true

# 1b. Fail fast if the Firefox binary is missing or not a real Firefox. This
# is the E2E analogue of the UAT preflight's Firefox check: without it,
# web-ext launches, fails opaquely, and we'd burn the full port-wait timeout
# before reporting a generic "failed to start". Validate the binary up front
# with a clean `--version`.
FIREFOX_BIN="${FIREFOX_ESR_BIN:-firefox-esr}"
if ! command -v "$FIREFOX_BIN" >/dev/null 2>&1; then
  echo "Error: '$FIREFOX_BIN' not found on PATH." >&2
  echo "       Install Firefox ESR (>= 153, e.g. \`apt install firefox-esr\` from the Mozilla APT repo) or set \$FIREFOX_ESR_BIN to a valid binary path." >&2
  exit 1
fi
FX_VERSION_OUT="$("$FIREFOX_BIN" --version 2>&1)"
if ! printf '%s' "$FX_VERSION_OUT" | grep -q "Mozilla Firefox"; then
  echo "Error: '$FIREFOX_BIN --version' did not report a Firefox version:" >&2
  echo "       $FX_VERSION_OUT" >&2
  echo "       The binary may be a broken wrapper — install Firefox ESR or set \$FIREFOX_ESR_BIN to a real Firefox." >&2
  exit 1
fi
echo "Using $FX_VERSION_OUT ($FIREFOX_BIN)"

# 2. Launch Firefox with the extension loaded and BiDi enabled. The idle
# timeout pref forces the event page to suspend/respawn during the suite
# (MV3_MIGRATION.md Slice D) — deliberately aggressive so respawn recovery
# (menus, IDB, capture) is exercised on essentially every test, not just the
# dedicated event-page-lifecycle suite.
echo "Launching Firefox via web-ext..."
# --remote-allow-system-access: Firefox 153 restricted WebDriver BiDi
# navigation in content scope to a whitelist (http/https/file/about:blank —
# bug 1579790), which hard-rejects the moz-extension:// gotos every E2E test
# depends on ("Navigation ... is not allowed in this context" →
# "Extension runtime not available" across the whole suite). This flag is
# Mozilla's documented opt-in for privileged navigation in a driven browser;
# it only affects this test-launched instance. Harmless on pre-153 Firefox.
web-ext run \
  --source-dir webextension/ \
  --firefox="$FIREFOX_BIN" \
  --firefox-profile "$PROFILE_DIR" \
  --keep-profile-changes \
  --pref=extensions.background.idle.timeout=10000 \
  --args="--remote-debugging-port" --args="$PORT" --args="-headless" \
  --args="--remote-allow-system-access" &
WEB_EXT_PID=$!

cleanup() {
  pkill -f "$PROFILE_DIR" 2>/dev/null || true
  wait "$WEB_EXT_PID" 2>/dev/null || true
  rm -rf "$PROFILE_DIR"
  # Release the concurrency lock acquired near the top of this script.
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

# 3. Wait for the port to be reachable (timeout 30s). Abort the moment web-ext
# (and thus Firefox) dies, rather than polling a dead process for the full
# timeout — the E2E analogue of the UAT runner's fail-fast-on-daemon-exit. The
# backgrounded web-ext output above carries the cause.
echo "Waiting for Firefox to be ready on port $PORT..."
count=0
until nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  if ! kill -0 "$WEB_EXT_PID" 2>/dev/null; then
    echo "Error: web-ext/Firefox exited before the debugging port ($PORT) came up." >&2
    echo "       See the web-ext output above for the cause (e.g. Firefox failed to launch)." >&2
    exit 1
  fi
  count=$((count + 1))
  if [ "$count" -eq 30 ]; then
    echo "Error: Firefox failed to open port $PORT within 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "Firefox ready. Running Vitest e2e project..."

# 4. Run the tests; pass through any extra args (e.g., a specific test file).
# Persist a durable pass/fail record: the json reporter writes a machine-
# readable results.json, and `tee` mirrors the full human-readable run to
# run.log — so "did last night's E2E pass?" is answerable from disk the next
# morning without re-running (the $ARTIFACTS_DIR was wiped at the top, so
# recreate it before the reporters write into it). ${PIPESTATUS[0]} keeps
# vitest's exit code, not tee's.
mkdir -p "$ARTIFACTS_DIR"
npx vitest run --project e2e \
  --reporter=default --reporter=json --outputFile="$ARTIFACTS_DIR/results.json" \
  "$@" 2>&1 | tee "$ARTIFACTS_DIR/run.log"
EXIT_CODE=${PIPESTATUS[0]}

# 5. Cleanup happens via the EXIT trap
exit "$EXIT_CODE"
