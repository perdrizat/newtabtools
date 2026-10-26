# tests/_browsers/firefox/e2e.sh — Firefox E2E launcher hook.
#
# Sourced by tests/e2e/run.sh, which has already exported the registry's
# NTT_CHANNEL (default `esr`) and NTT_E2E_PORT. Launches Firefox via web-ext
# with the unpacked extension and WebDriver BiDi on the E2E port. The binary
# is the channel's (firefox-env.mjs: esr -> firefox-esr); `$FIREFOX_BIN`
# overrides it (e.g. `FIREFOX_BIN=firefox` to preview release-only driver
# gates). MV3's `tabs.captureVisibleTab` needs Firefox >= 152, so this ran
# on release until the 153 ESR shipped. Per-version quirks:
# tests/BROWSER-COMPAT.md.

FIREFOX_HOOK_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Fresh profile every run so tests are fully isolated. _helpers.ts reads
# prefs.js inside it to discover the extension UUID.
PROFILE_DIR="$E2E_DIR/test-profile"
export NTT_E2E_PROFILE_DIR="$PROFILE_DIR"
WEB_EXT_PID=""

browser_launch() {
  # Clean slate, scoped to THIS run's test profile only: $PROFILE_DIR appears
  # in the launched process's command line via web-ext's `--firefox-profile`
  # -> `-profile <dir>` translation. Never match on a binary name: `pkill -f
  # firefox` would kill a developer's daily-driver browser, and the former
  # `pkill -f firefox-esr` killed the invoking shell itself whenever
  # `firefox-esr` was on its command line.
  pkill -f "$PROFILE_DIR" 2>/dev/null || true
  rm -rf "$PROFILE_DIR"
  mkdir -p "$PROFILE_DIR"

  # Fail fast if the binary is missing or not a real Firefox — without this,
  # web-ext launches, fails opaquely, and we'd burn the full port-wait timeout.
  FIREFOX_BIN="$(node "$FIREFOX_HOOK_DIR/firefox-env.mjs" "$NTT_CHANNEL")" || return 1
  FX_VERSION_OUT="$("$FIREFOX_BIN" --version 2>&1)"
  if ! printf '%s' "$FX_VERSION_OUT" | grep -q "Mozilla Firefox"; then
    echo "Error: '$FIREFOX_BIN --version' did not report a Firefox version:" >&2
    echo "       $FX_VERSION_OUT" >&2
    echo "       The binary may be a broken wrapper — install Firefox $NTT_CHANNEL or set \$FIREFOX_BIN to a real Firefox." >&2
    return 1
  fi
  echo "Using $FX_VERSION_OUT ($FIREFOX_BIN)"

  # The idle timeout pref forces the event page to suspend/respawn during the
  # suite (MV3_MIGRATION.md Slice D) — deliberately aggressive so respawn
  # recovery (menus, IDB, capture) is exercised on essentially every test.
  #
  # --remote-allow-system-access: Firefox 153 restricted WebDriver BiDi
  # navigation in content scope to http/https/file/about:blank (bug 1579790),
  # which hard-rejects the moz-extension:// gotos every E2E test depends on.
  # This flag is Mozilla's documented opt-in for privileged navigation in a
  # driven browser; it only affects this test-launched instance.
  echo "Launching Firefox via web-ext..."
  web-ext run \
    --source-dir webextension/ \
    --firefox="$FIREFOX_BIN" \
    --firefox-profile "$PROFILE_DIR" \
    --keep-profile-changes \
    --pref=extensions.background.idle.timeout=10000 \
    --args="--remote-debugging-port" --args="$NTT_E2E_PORT" --args="-headless" \
    --args="--remote-allow-system-access" &
  WEB_EXT_PID=$!
}

# Wait for the BiDi port (30s). Abort the moment web-ext (and thus Firefox)
# dies, rather than polling a dead process for the full timeout; the
# backgrounded web-ext output above carries the cause.
browser_wait_ready() {
  echo "Waiting for Firefox to be ready on port $NTT_E2E_PORT..."
  local count=0
  until nc -z 127.0.0.1 "$NTT_E2E_PORT" 2>/dev/null; do
    if ! kill -0 "$WEB_EXT_PID" 2>/dev/null; then
      echo "Error: web-ext/Firefox exited before the debugging port ($NTT_E2E_PORT) came up." >&2
      echo "       See the web-ext output above for the cause (e.g. Firefox failed to launch)." >&2
      return 1
    fi
    count=$((count + 1))
    if [ "$count" -eq 30 ]; then
      echo "Error: Firefox failed to open port $NTT_E2E_PORT within 30s" >&2
      return 1
    fi
    sleep 1
  done
}

browser_stop() {
  pkill -f "$PROFILE_DIR" 2>/dev/null || true
  if [ -n "$WEB_EXT_PID" ]; then
    wait "$WEB_EXT_PID" 2>/dev/null || true
  fi
  rm -rf "$PROFILE_DIR"
}
