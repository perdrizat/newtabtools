# Browser & driver compatibility notebook

A living lab notebook for the E2E and UAT tiers: which browser versions and
driver routes work, what breaks, the exact error strings, and what was tried.
Read this **before** debugging a tier that broke after a browser update, and
append to the log **after** every investigation, including dead ends, so the
next one starts from here instead of from scratch.

`audit/` holds dated, point-in-time reviews; this file is the opposite: one
current-state document plus an append-only log.

## Current state (last verified 2026-10-26; per-capability detail: `pnpm test:compat`)

| Tier | Browser | Driver route | Status |
|---|---|---|---|
| E2E Firefox | `firefox-esr` 153.5.1esr | web-ext + Puppeteer over WebDriver BiDi, `--remote-allow-system-access` | all pass |
| E2E Firefox (not the target) | `firefox` 158.0.1 | same | upload tests and their dependents fail (privileged-scope gate, §2) |
| UAT Firefox | `firefox` 158.0.1 | Selenium + geckodriver (Selenium Manager copy), `--allow-system-access` | all pass |
| E2E Chrome | branded stable / CfT | Puppeteer pipe + `installExtension` + `--enable-unsafe-extension-debugging`, CDP port 9223 | all pass; SW-lifecycle tests skip (GH #23) |
| UAT Chrome | Chrome for Testing | Selenium + chromedriver, `--load-extension` | all pass |

`favicon-real-sites.test.ts` (live third-party sites, network-flaky on every
lane) was removed from E2E on 2026-10-26; live-site favicons are covered by
UAT. Not a driver issue.

This notebook belongs to the compat tier ([`PLAN.md`](PLAN.md), [`README.md`](README.md)):
its capability probes re-check the gates below on every run.

## Firefox: the gates, and how to recognise them

### 1. Driven navigation to `moz-extension://` (Firefox >= 153)

- **Change:** bug 1579790 restricts driver navigation in content scope to
  http/https/file/about:blank. Regression report bug 2048451 is WONTFIX.
- **Symptom:** `Navigation ... is not allowed in this context`, then every test
  fails with "Extension runtime not available".
- **Fix (in place):** opt into system access. Firefox flag
  `--remote-allow-system-access` (E2E, `tests/_browsers/firefox/e2e.sh`); geckodriver flag
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
  | `page.evaluateOnNewDocument` (`script.addPreloadScript`) | registers, never runs (§3) | **gated** |
  | `page.pdf` (`browsingContext.print`) | OK | **gated** |
  | `dialog.accept` (`browsingContext.handleUserPrompt`) | OK | **gated** |

  "gated" = `The command does not support browsing contexts in privileged scope`.
  Expect the right-hand column to reach ESR at the next ESR major. The compat
  tier's committed matrices ([`expected/`](expected/)) are the machine-checked
  form of this table; `pnpm test:compat` fails when either column moves.
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
- **Workaround (in place):** `gotoExtensionPage` in `tests/e2e/_helpers.ts`
  fires the `goto` unawaited and polls for the new document
  (`performance.timeOrigin` changed, `readyState` past `loading`) every 50 ms.
  Until 2026-10-26 the helpers awaited the goto to its timeout (3s in
  `openNewTab`, 10s at 32 call sites in test files), which made Firefox E2E
  about 10x slower than Chrome.
- **Probed on both 153.5.1esr and 158.0.1, same result** (now the compat
  probes `console-event`, `pageerror-event`, `request-event`, `reload`,
  `pages-lists-extension-page`):
  - `page.on('console')`: **never fires** for the extension page.
  - `page.on('pageerror')`: never fires (uncaught exceptions invisible).
  - `page.on('request')` / network events: never fire for the page's own
    fetches, so request interception/mocking of the page is not possible.
  - `page.reload()`: hangs (waits for a load event that never comes). Use
    `gotoExtensionPage` to the same URL instead.
  - `browser.pages()`: does not list extension pages; keep the `Page` handle
    from `openNewTab`.
  - `page.evaluateOnNewDocument` (`script.addPreloadScript`): registers on
    ESR but **never runs** on the next extension document; gated on release.
    A preload hook is no route to early-boot instrumentation.
- **Workaround for console/errors (in place):** `devtools.console.stdout.content=true`
  makes Firefox print `console.*` calls and uncaught errors of extension pages
  (page and background) to stdout/stderr. The Firefox E2E hook sets it and
  writes web-ext's `--verbose` output to `tests/e2e/_artifacts/firefox/browser.log`;
  `loads-cleanly.test.ts` reads it via `firefoxConsoleErrorsSince`. Evidence:
  [`experiments/2026-10-26-console-stdout/`](experiments/2026-10-26-console-stdout/).
- Firefox's Remote Agent allows **one** BiDi session: a second
  `puppeteer.connect` fails with `session not created Maximum number of active
  sessions`. Disconnect before connecting again.

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

1. `pnpm test:compat`: probes both channels and diffs against `expected/`;
   the output names each changed capability with its error string, and the
   versions land in `_artifacts/<target>.json`.
2. Run `pnpm test:e2e:firefox`. If it fails, grep `tests/e2e/_artifacts/firefox/run.log`
   for the error strings above to classify each failure.
3. Run the same suite on release to see what is coming next:
   `pnpm test:compat firefox-release --e2e` (or `NTT_CHANNEL=release pnpm test:e2e:firefox`).
   (Each tier's default channel is set in `tests/_browsers/registry.mjs`;
   change it there, not in the scripts.)
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

### 2026-10-26: compat tier probes; console capture; goto wait removed

- Versions: firefox-esr 153.5.1esr, firefox 158.0.1.
- `pnpm test:compat` probes reproduced the hand-run matrix (section 2) on both
  channels; committed as `expected/firefox-{esr,release}.json`. New finding:
  the ESR preload script registers but never runs (section 3).
- A second BiDi session is refused (`Maximum number of active sessions`), so
  the session probe checks the harness's live session instead.
- Console experiment (`experiments/2026-10-26-console-stdout/`):
  `devtools.console.stdout.content` delivers console calls and uncaught
  errors on both versions; adopted in the Firefox E2E hook. Red check: an
  injected `console.error` now fails `loads-cleanly.test.ts` on Firefox.
- Poll interval for `gotoExtensionPage`, on the four slowest Firefox files
  (tile-redesign, tile-custom, drag-reorder, pin-persists): 241 s with the
  old goto waits; 18.0 s at 0 ms, 18.2 s at 100 ms, 57.0 s at 1000 ms.
  Full-suite sweep (solo runs, 125/125 each): 25 ms 125.5 s, 50 ms 130.0 s,
  100 ms 131.7 s, 150 ms 139.1 s, 250 ms 155.0 s. 50 ms chosen.

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
