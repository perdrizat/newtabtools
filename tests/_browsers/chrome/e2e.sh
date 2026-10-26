# tests/_browsers/chrome/e2e.sh — Chrome E2E launcher hook (CHROME.md D5b,
# D8/Decision 12).
#
# Sourced by tests/e2e/run.sh. Chrome is launched by launch-chrome.mjs, a
# long-lived background process: it resolves the registry's E2E channel
# (`stable`: branded-first, CfT fallback), stages the unpacked dev build, and
# launches Chrome with a DUAL transport — Puppeteer's `pipe: true` (branded's
# CDP `Extensions` domain is pipe-only; `browser.installExtension()` installs
# the staged build over it) AND the registry's E2E port, which the Vitest run
# connects to. It writes a ready-file only after the extension's
# service-worker target is visible over that port (not just the pipe), so
# readiness means "port up AND SW visible over it".

CHROME_HOOK_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
READY_FILE="$CHROME_HOOK_DIR/.launcher-ready"
LAUNCHER_PID=""

browser_launch() {
  rm -f "$READY_FILE"
  echo "Starting the Chrome E2E launcher (channel $NTT_CHANNEL)..."
  node "$CHROME_HOOK_DIR/launch-chrome.mjs" &
  LAUNCHER_PID=$!
}

# Wait for the ready-file (90s) — fail fast if the launcher died before ever
# signalling readiness instead of waiting out the full timeout.
browser_wait_ready() {
  echo "Waiting for the Chrome E2E launcher to become ready..."
  local count=0
  until [ -f "$READY_FILE" ]; do
    if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
      echo "Error: the Chrome E2E launcher exited before signalling readiness (no ready-file at $READY_FILE)." >&2
      return 1
    fi
    count=$((count + 1))
    if [ "$count" -eq 90 ]; then
      echo "Error: the Chrome E2E launcher did not signal readiness within 90s (no ready-file at $READY_FILE)." >&2
      return 1
    fi
    sleep 1
  done
  echo "Launcher ready:"
  sed 's/^/  /' "$READY_FILE" 2>/dev/null || true
}

# Signal the launcher, which closes Chrome + Puppeteer's temp profile and
# removes the ready-file itself; the rm here is defensive.
browser_stop() {
  if [ -n "$LAUNCHER_PID" ] && kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    kill -TERM "$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  rm -f "$READY_FILE"
}
