# Security Review — Phase 1 Completion Update

**Date:** 2026-05-07
**Scope:** Delta review of all changes since the pre-takeover assessment (2026-05-04). Covers the Phase 0 security hardening, Phase 1 characterization test sweep (307 unit/integration + 35 E2E tests), the E2E infrastructure, and one production code change.
**Baseline:** `audit/2026-05-04-security-review.md` (findings §2.1–§2.7, deeper-dig list §3, roadmap integration §4).

---

## 1. Original findings — status update

| Finding | Severity | Status | Notes |
|---|---|---|---|
| **§2.1** Stored XSS via zip restore | high | **Characterized, not yet fixed** | Integration tests (`backup-restore.test.ts`) explicitly pin the `javascript:` and `data:` URL injection paths, plus unsanitized HTML titles and unfiltered pref keys. E2E round-trip test (`backup-restore.test.js`) exercises the restore path end-to-end. The fix is safe to apply now — the safety net is in place. Still gates AMO republish. |
| **§2.2** Vendored `zip.js` from 2013 | high | **Open** | No change. Still gates AMO republish. |
| **§2.3** No CSP in manifest | medium | **Fixed** | `content_security_policy` added to `manifest.json`. Regression test at `tests/unit/manifest.test.js` asserts key directives and blocks `unsafe-eval`/`unsafe-inline` in script-src. Verified by `web-ext lint` and full E2E. |
| **§2.4** No sender validation | medium | **Fixed** | Inline guard in `background.js:113` (`sender.id !== browser.runtime.id`). Pure-logic helper in `lib/messaging.js` with unit tests. Wiring verified by 5 sender-validation cases in `background-messages.test.ts`. |
| **§2.5** Prefs restored verbatim | medium | **Characterized, not yet fixed** | Integration test pins the current (vulnerable) behaviour: arbitrary keys pass through to `storage.local`. Still open. |
| **§2.6** `<all_urls>` + `executeScript` | medium | **Characterized** | `auto-thumbnail.test.ts` (integration) covers the `webNavigation.onCompleted` trigger, protocol filter, cache-check, staleness check, incognito guard, and script injection. Behavioural documentation of known capture failures added. Fix bundled with Phase 4 auto-thumbnail rewrite per plan. |
| **§2.7** No SCA in CI | low | **Fixed** | `npm audit --audit-level=high` step in `ci.yml`. One new transitive `high` advisory (`basic-ftp` via `puppeteer-core` → `proxy-agent`) appeared since the audit and is resolved by `npm audit fix` (updated lockfile). |

**Summary:** 3 of 7 findings fixed, 3 characterized with safety-net tests ready for fix, 1 (§2.2 vendored zip.js) still open and untouched.

## 2. New security issues introduced

### 2.1 New message handler `Tiles.clear` — no characterization test (low)

A new `Tiles.clear` case was added to the `runtime.onMessage` switch in `background.js:144–146` to support the E2E test harness (`resetTestState` in `_helpers.js`). The handler is **inside** the sender-validation guard (good), but it is **not covered** by `background-messages.test.ts`, which was written against the pre-existing handler set. If an attacker could bypass the sender check, `Tiles.clear` would wipe all user tiles — a destructive operation that didn't exist before.

**Risk:** Low. The sender guard blocks external callers, and `Tiles.clear()` already existed as a function (used by `readZip`). But a test gap on a destructive handler is worth closing.

**Recommendation:** Add a `Tiles.clear` case to the existing `background-messages.test.ts` handler coverage (one test: valid sender dispatches, calls `Tiles.clear`, returns `sendResponse`).

### 2.2 E2E `resetTestState` uses `Tiles.clear` via runtime message (informational)

The E2E helper at `_helpers.js:253` sends `{ name: 'Tiles.clear' }` via `chrome.runtime.sendMessage` from within a `page.evaluate` block. This works because the E2E page is the extension's own new-tab page (passes the sender check). No external attacker path. But it means the handler in §2.1 above is **test infrastructure that leaked into production code**. If the team later removes the handler thinking it's unused, E2E tests will silently break.

**Recommendation:** Add a comment to the `Tiles.clear` handler noting it serves the E2E harness, and backlink from `_helpers.js` to the handler. When Phase 2 rewrites the message boundary, decide whether `Tiles.clear` should stay as a first-class API or be removed in favor of a test-only path.

### 2.3 `npm audit` — new high-severity advisory in `basic-ftp` (resolved)

`basic-ftp@5.3.0` (transitive via `puppeteer-core` → `@puppeteer/browsers` → `proxy-agent` → `pac-proxy-agent` → `get-uri`) has GHSA-rpmf-866q-6p89 (DoS via unbounded multiline FTP response). Dev-only dependency, no runtime exposure in the extension. Resolved by `npm audit fix` (bumps to `5.3.1`). CI gate (`--audit-level=high`) would have caught this on the next push — working as intended.

## 3. Test infrastructure review

### 3.1 E2E runner script (`run_esr_tests.sh`) — suitable

- Fresh profile per run (`rm -rf "$PROFILE_DIR"`), isolated from user state.
- `pkill -f firefox-esr` on entry and EXIT trap — aggressive but necessary for headless CI. No risk of killing non-test Firefox because CI runners don't have interactive sessions.
- Port 9222 hardcoded — fine for single-runner CI. Would collide with parallel runners, but that's a scaling concern, not a security one.
- `set -u` catches unset variables. Missing `set -e` means a failing intermediate command (e.g. `web-ext run` crash) wouldn't abort the script, but the port-wait timeout catches this.
- Profile cleanup in EXIT trap. Artifacts directory is gitignored. No secrets or credentials in the profile (headless, no user login).

### 3.2 E2E helpers (`_helpers.js`) — suitable, one note

- `waitForCondition` correctly avoids `page.waitForFunction` which would be blocked by the extension's CSP (uses `Function()` constructor internally). Good defensive choice, well-documented.
- `captureFailure` sanitises the filename label (`replace(/[^a-z0-9._-]+/gi, '_')`). No path-traversal vector.
- `getExtensionUUID` reads `prefs.js` from the test profile — brittle by design and documented as such. No security concern.
- `resetTestState` writes prefs via `chrome.storage.local.set` inside `page.evaluate` — runs in the extension's own context. The pref values are hardcoded defaults, not user-supplied.
- All E2E URLs are `moz-extension://` (own extension) or `example.com`/`localhost`. No outbound network calls to real external services.
- `BIDI_ENDPOINT` is hardcoded to `ws://127.0.0.1:9222` — loopback only, not exposed.

### 3.3 Integration tests (`vm.runInThisContext` approach) — suitable

The team chose to load legacy script-mode files (`background.js`, `export.js`, `fx-newTab.js`) via `vm.runInThisContext` with mocked globals rather than restructuring the production code for testability. This is sound for characterization tests:

- The code under test is the **exact production code**, not a test double. Characterization accuracy is high.
- The mock surface is explicit (every mock is visible in `beforeAll`). No hidden magic.
- `vm.runInThisContext` executes in the current V8 context, not a sandbox. This is fine — the code being loaded is the project's own source, not untrusted input.
- The approach will naturally retire when the strangler-fig migration replaces script-mode files with ES modules that can be directly imported.

### 3.4 Zero-dependency ZIP builder in E2E (`backup-restore.test.js`) — suitable

The `buildStoredZip` function is a minimal stored-format ZIP builder (~100 lines) with a table-driven CRC-32 implementation. It produces valid archives that the vendored `zip.js` successfully parses. No external dependency introduced. The implementation is straightforward, auditable, and test-only.

### 3.5 Test data hygiene

- All test URLs use `example.com`, `example.org`, `restored-*.example.com`, or `localhost`. No real domains.
- No credentials, API keys, or PII in test fixtures.
- E2E artifacts (screenshots, zip fixtures) are in gitignored directories and cleaned up in `afterAll`.

## 4. Recommendations (prioritized)

1. **Fix §2.1 now.** The characterization tests are in place for both the integration and E2E tiers. The store-and-render path is fully pinned. Apply the URL-scheme allow-list at restore time (`readZip`) and at render time (`addTitle`). The existing tests will flip from "characterizes the vulnerability" to "verifies the fix" — exactly as designed.

2. **Add `Tiles.clear` to `background-messages.test.ts`.** One test, closes the coverage gap on the new destructive handler (§2.1 above). Optionally add a comment to the handler noting the E2E-harness dependency.

3. **Bump lockfile for `basic-ftp`.** `npm audit fix` resolves it. Commit the updated `package-lock.json` (§2.3 above).

4. **§2.2 and §2.5 remain on the roadmap** as pre-republish gate items. No change to the plan. The safety net for both is now in place.
