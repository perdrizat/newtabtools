# Browser & driver compatibility notebook

A living lab notebook for the E2E and UAT tiers: which browser versions and
driver routes work, what breaks, the exact error strings, and what was tried.
Read this **before** debugging a tier that broke after a browser update, and
append to the log **after** every investigation, including dead ends, so the
next one starts from here instead of from scratch.

`audit/` holds dated, point-in-time reviews; this file is the opposite: one
current-state document plus an append-only log.

## Current state (last verified 2026-10-26)

| Tier | Browser | Driver route | Status |
|---|---|---|---|
| E2E Firefox | `firefox-esr` 153.5.1esr | web-ext + Puppeteer over WebDriver BiDi, `--remote-allow-system-access` | 125/125 |
| E2E Firefox (not the target) | `firefox` 158.0.1 | same | 118/126, 7 privileged-scope failures + favicon |
| UAT Firefox | `firefox` 158.0.1 | Selenium + geckodriver (Selenium Manager copy), `--allow-system-access` | 12/12 |
| E2E Chrome | branded stable / CfT | Puppeteer pipe + `installExtension` + `--enable-unsafe-extension-debugging`, CDP port 9223 | 123/125 + 2 skip (GH #23) |
| UAT Chrome | Chrome for Testing | Selenium + chromedriver, `--load-extension` | 12/12 |

`favicon-real-sites.test.ts` (live third-party sites, network-flaky on every
lane) was removed from E2E on 2026-10-26; live-site favicons are covered by
UAT. Not a driver issue.

Planned successor tier for this notebook's probing work: [`compat/PLAN.md`](compat/PLAN.md).

## Firefox: the gates, and how to recognise them

### 1. Driven navigation to `moz-extension://` (Firefox >= 153)

- **Change:** bug 1579790 restricts driver navigation in content scope to
  http/https/file/about:blank. Regression report bug 2048451 is WONTFIX.
- **Symptom:** `Navigation ... is not allowed in this context`, then every test
  fails with "Extension runtime not available".
- **Fix (in place):** opt into system access. Firefox flag
  `--remote-allow-system-access` (E2E, `run_esr_tests.sh`); geckodriver flag
  `--allow-system-access` via `ServiceBuilder` (UAT; rejected as a capability
  by design). Mozilla (whimboo, geckodriver#2250) states this mode is the
  intended route for extension testing; it is not a workaround that will be
  taken away.

### 2. Privileged-scope command gate (release >= ~155; absent on 153 ESR)

- **Change:** with system access on, extension pages are "privileged scope"
  browsing contexts (`BrowsingContextUtils.isPrivilegedContext`: anything that
  is not a web or file remote type). Each BiDi command must opt in via
  `_getNavigable(id, { supportsPrivilegedScope: true })`. Not in any MDN
  release note.
- **Symptom:** `The command does not support browsing contexts in privileged scope`.
- **Probed matrix** (Puppeteer call on a `moz-extension://` new-tab page, 2026-10-26;
  the probe source is described in the log entry):

  | Puppeteer call (BiDi command) | ESR 153.5.1 | Release 158.0.1 |
  |---|---|---|
  | `page.evaluate` (`script.callFunction`) | OK | OK |
  | `keyboard` / `mouse` (`input.performActions`) | OK | OK |
  | `page.exposeFunction` | OK | OK |
  | `ElementHandle.uploadFile` (`input.setFiles`) | OK | **gated** |
  | `page.setViewport` (`browsingContext.setViewport`) | OK | **gated** |
  | `page.bringToFront` (`browsingContext.activate`) | OK | **gated** |
  | `page.screenshot` (`browsingContext.captureScreenshot`) | OK | **gated** (the `main` source opts in, so likely fixed in a later release) |
  | `page.evaluateOnNewDocument` (`script.addPreloadScript`) | OK (registers) | **gated** |
  | `page.pdf` (`browsingContext.print`) | OK | **gated** |
  | `dialog.accept` (`browsingContext.handleUserPrompt`) | OK | **gated** |

  "gated" = `The command does not support browsing contexts in privileged scope`.
  Expect the right-hand column to reach ESR at the next ESR major.
- **Status:** E2E avoids it by running ESR 153. Will arrive with the next ESR
  major (uploads, viewport, focus, screenshots, preload scripts, dialogs). Options then: an in-page `DataTransfer` upload helper (works through
  `script.callFunction`), or an upstream fix (request `supportsPrivilegedScope`
  for `input.setFiles`). Classic WebDriver `sendKeys` on a file input (UAT) is
  unaffected on 158.

### 3. Extension contexts are second-class in BiDi (all versions)

- `isBrowsingContextCompatible` skips extension contexts (bug 1755014, P3,
  unassigned; meta bug 1722679), so no `browsingContext.load`/`domContentLoaded`
  events fire for `moz-extension://` pages.
- **Symptom:** `page.goto(moz-extension://...)` never resolves; tests hang to
  the timeout.
- **Workaround (in place):** `openNewTab` in `tests/e2e/_helpers.ts` races
  `goto` against a 3s timeout and then polls the DOM. Cost: about 3s per page
  open; most Firefox E2E tests show a 3.1s floor because of it.
- **Probed on both 153.5.1esr and 158.0.1, same result:**
  - `page.on('console')`: **never fires** for the extension page.
    Consequence: `loads-cleanly.test.ts`'s "zero console errors" assertion
    passes vacuously on Firefox (it is only real on Chrome).
  - `page.on('pageerror')`: never fires (uncaught exceptions invisible).
  - `page.on('request')` / network events: never fire for the page's own
    fetches, so request interception/mocking of the page is not possible.
  - `page.reload()`: hangs (waits for a load event that never comes). Use
    `page.evaluate(() => location.reload())` + DOM polling instead.
  - `browser.pages()`: does not list extension pages; keep the `Page` handle
    from `openNewTab`.
- **Workaround for console/errors:** capture in-page instead: install a
  `console.error`/`window.onerror`/`unhandledrejection` recorder from the page
  and read it back with `page.evaluate`. Early-boot errors need the recorder to
  exist before boot (preload script, ESR only) or a test-only hook in the page.

## Chrome: the gates

- `--load-extension` is ignored on branded Chrome >= 137; still honoured by
  Chrome for Testing and Chromium (Google PSA). Branded route: Puppeteer pipe
  transport + `browser.installExtension` + `--enable-unsafe-extension-debugging`,
  with `--remote-debugging-port` served at the same time for the suite.
- CfT passes canary-gated manifest keys that branded stable rejects
  (2026-07-17 incident, CHROME.md D8). Channel-sensitive behaviour must be
  proven on branded.
- No ESR equivalent; Chrome Beta is the only early warning.

## Alternatives evaluated and rejected (2026-10-26)

Do not re-research these unless the stated reason changes.

| Option | Why rejected |
|---|---|
| Playwright | Patched Juggler Firefox; cannot load an extension into a real Firefox. `playwright-webextext` still fails on extension pages. |
| Selenium / WebdriverIO / BrowserStack / TestingBot for E2E | Same Remote Agent underneath, same gates. Selenium#17905 was redirected to geckodriver. |
| Marionette chrome context | Works under system access but is more privileged, non-standard, and a second automation style. |
| Mozilla's own approach | Firefox Home (newtab@mozilla.org) is tested in-tree with mochitest browser-chrome, xpcshell and mocha; none of it is usable by third-party extensions. |
| In-extension test runner | Loses real input/rendering fidelity; duplicates the integration tier. |
| Opening the page another way (Ctrl+T, `about:newtab`) | The resulting page is still a privileged extension context; same gates. |

## Re-validation checklist (run on every ESR major bump or a red tier after an update)

1. `firefox-esr --version`, `firefox --version`; record both below.
2. Run `pnpm test:e2e:ff`. If it fails, grep `tests/e2e/_artifacts-ff/run.log`
   for the error strings above to classify each failure.
3. Run the same suite on release to see what is coming next:
   `FIREFOX_ESR_BIN=firefox pnpm test:e2e:ff`.
4. Check the upstream sources for new gates: MDN "Firefox NNN for developers"
   (WebDriver section), the fxdx.dev WebDriver newsletter, and the source of
   `remote/shared/webdriver/...` / `RootBiDiModule.sys.mjs` for
   `supportsPrivilegedScope` changes.
5. Append a dated log entry with versions, results and anything tried.

## Sources

- Bugs: [1579790](https://bugzilla.mozilla.org/show_bug.cgi?id=1579790),
  [2048451](https://bugzilla.mozilla.org/show_bug.cgi?id=2048451),
  [1755014](https://bugzilla.mozilla.org/show_bug.cgi?id=1755014),
  [1722679](https://bugzilla.mozilla.org/show_bug.cgi?id=1722679)
- [geckodriver#2250](https://github.com/mozilla/geckodriver/issues/2250) (system access is the intended extension-testing route)
- [fxdx.dev WebDriver newsletters](https://fxdx.dev/)
- [Firefox Home docs](https://firefox-source-docs.mozilla.org/browser/extensions/newtab/docs/index.html)
- [Chrome: test extensions with Puppeteer](https://developer.chrome.com/docs/extensions/how-to/test/puppeteer)
- Community precedent: AdInfinitum PR #38, Selenium#17905, Mozilla Discourse thread 139096

## Log

Newest first. One entry per investigation: date, versions, what was tried, result.

### 2026-10-26: Firefox 158 E2E red; switch E2E to ESR

- Versions: firefox 158.0.1, firefox-esr 153.5.1esr, geckodriver via Selenium Manager.
- Release 158 E2E: 118/126. 5 tests fail at `uploadFile` with the
  privileged-scope error, 2 depend on them, 1 favicon (network).
- ESR 153.5.1 probe (`lock-grid` + `tile-custom`, uploads included): 9/9.
  Full ESR suite: 125/126; the one failure is `favicon-real-sites` (heise.de
  stored, techcrunch.com never arrived: network, ACK-52). All four upload
  files (backup-restore, wallpaper-picker, page-background, tile-custom) pass.
  So on ESR there is no driver-caused failure at all.
- UAT on 158 (Selenium classic, `sendKeys` upload): 12/12.
- Found: `run_esr_tests.sh`'s `pkill -f firefox-esr` killed the invoking
  shell when `FIREFOX_ESR_BIN=firefox-esr` was in its command line (exit 144).
  Worked around by launching through a symlink without "firefox-esr" in its
  path; fixed by dropping the name-based pkill (profile-dir match only).
  Verified: `FIREFOX_ESR_BIN=firefox-esr pnpm test:e2e:ff tests/e2e/lock-grid.test.ts`
  now exits 0 (5/5).
- Superseded: `audit/2026-09-06-firefox-remediation-plan.md` claimed the
  system-access flag does not lift the restriction. It does, on 153.5.1esr and
  154+.
- Decision: E2E default binary is `firefox-esr` (local and CI); UAT stays on release.
- Capability probe (a throwaway `tests/e2e/zz-probe-capabilities.test.ts`,
  run via `pnpm test:e2e:ff <file>` and `FIREFOX_ESR_BIN=firefox ...`; each
  Puppeteer call wrapped in a 5s timeout and try/catch, results printed as
  JSON). Results are the matrix in section 2 and the event list in section 3.
  Surprise vs. the source reading: `captureScreenshot` is gated on 158 (so
  `captureFailure()` screenshots silently fail on release); console, pageerror
  and network events are missing on **both** versions.
- Final gate after removing `favicon-real-sites`: `pnpm test` all green:
  fast 1572/1572, Firefox ESR E2E 125/125 (31 files), Chrome E2E 123/125 +
  2 skipped (GH #23).
