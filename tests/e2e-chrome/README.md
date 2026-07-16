# Chrome runtime tier (CHROME.md D1+)

Tooling for running the extension on real Chrome. Established in D1; grew
into an 11-check smoke suite in D5; D5b adds a full SUITE-PARITY runner that
runs the same 32 Firefox E2E test files against Chrome.

```bash
pnpm chrome:provision        # one-time: fetch Chrome for Testing (~200 MB, ~/.cache/puppeteer)
pnpm chrome:smoke            # Puppeteer/CDP first-boot smoke (11 checks)
pnpm chrome:smoke:selenium   # Selenium path (chromedriver via Selenium Manager) — de-risks UAT-on-Chrome (D6)
pnpm test:e2e:chrome         # D5b: the full 32-file Firefox E2E suite, run against Chrome
```

## The parity suite (D5b)

`pnpm test:e2e:chrome` (`run_chrome_tests.sh`) is the Chrome sibling of
`tests/e2e/run_esr_tests.sh`: it stages the unpacked dev build
(`print-launch-env.mjs` → `chrome-env.mjs`'s `stageDevBuild()`), launches
Chrome for Testing directly with `--load-extension` + a fresh throwaway
`--user-data-dir` and CDP listening on port **9223**, waits for the port,
runs `NTT_E2E_BROWSER=chrome npx vitest run --project e2e` (the exact same
`tests/e2e/**/*.test.ts` files the Firefox tier runs), then tears Chrome and
the profile down. Its own `mkdir`-based concurrency lock
(`tests/e2e-chrome/.runner-lock`) mirrors the Firefox runner's, so the two
tiers never collide even though they now both hold a fixed port.

Unlike the Puppeteer smoke path (`chrome:smoke`), this runner passes
`--load-extension` directly rather than doing a CDP `installExtension` —
that legacy flag is only broken on BRANDED Chrome (D1 finding); Chrome for
Testing, the only binary this tier ever targets, honors it fine, so the
direct route is simpler here.

A single positional arg (or several) selects a subset, same as the Firefox
runner:

```bash
pnpm test:e2e:chrome tests/e2e/loads-cleanly.test.ts
```

### Helpers seam

`tests/e2e/_helpers.ts` gained an `NTT_E2E_BROWSER` switch (`IS_CHROME`,
`CDP_ENDPOINT`) rather than a parallel helpers file: `connectToFirefox` (name
kept — every one of the 32 test files already imports it, so keeping it
avoids call-site churn on a suite this arc's own gate requires stay
byte-identical for Firefox) branches BiDi@9222 vs CDP@9223;
`getNewTabURL`/`newTabURL` branch `moz-extension://<uuid>/` (a per-profile
UUID scraped from `prefs.js`) vs `chrome-extension://<id>/` (the committed
dev-key id, `CHROME_DEV_EXTENSION_ID` imported straight from
`chrome-env.mjs` — no hardcoded duplicate). Everything else in the file
(DOM polling, `chrome.storage`/`chrome.runtime` wire calls, drawer/prefs
helpers) was already browser-agnostic by construction (chrome-prep C3d's
wire/DOM-driven harness), which is what made suite parity cheap: zero test
file needed a call-site change to run on Chrome.

One Chrome-only addition: `restartChromeServiceWorker(browser)` forces a
real CDP kill + real-navigation wake of the extension's service worker —
the Chrome analogue of Firefox's `extensions.background.idle.timeout` pref,
used by `event-page-lifecycle.test.ts` (see that file's header).

### Triage results (2026-07-16, CfT 151)

First full run: **125/126 green with zero test-file changes.** After triage:

| File | Outcome |
|---|---|
| `event-page-lifecycle.test.ts` | Adapted — Firefox's idle-timeout-pref sleep is a Chrome no-op (nothing ages the SW out on that schedule), so it would have passed vacuously; swapped in `restartChromeServiceWorker` for a real kill/respawn on the Chrome branch only. |
| `favicon-real-sites.test.ts` | Failed once under full-suite load, passed clean on a solo re-run — the same public-internet timing flakiness this file already documents for Firefox, not a Chrome-specific misbehavior. No `IS_CHROME` skip added (per this project's "re-run solo before treating it as a regression" practice). |
| `drag-layout.test.ts` / `drag-reorder.test.ts` | Ran unmodified, green. Header comments extended to note the existing known-flaky-DnD quarantine policy applies identically on Chrome. |
| `theme.test.ts` | Ran unmodified, green — never touches the Firefox-only `browser.theme` bonus API (Decision 2's `prefers-color-scheme` base is what's under test). |
| `boot-timing.test.ts` | Ran unmodified, green under the existing generous shared bound (Chrome medians were faster, not slower, than Firefox's on CfT 151) — header notes a per-browser re-baseline is still future work if the instrument ever tightens. |
| All 27 other files | Ran unmodified, green — no divergence found. |

**Parity: 126/126 (100%)** of Firefox E2E test cases pass on Chrome —
comfortably above the ≥90% acceptance target.

## Three hard-won harness facts (2026-07-15, D1)

Violating any of these reproduces the same misleading signature — the
extension "installs" (an ID is returned) but no service worker ever starts
and every `chrome-extension://` URL answers `net::ERR_BLOCKED_BY_CLIENT`:

1. **Branded Google Chrome >= 137 cannot run extension automation.**
   `--load-extension` is removed and even the CDP install path leaves the
   extension inert. Use **Chrome for Testing** (`pnpm chrome:provision`;
   same binary-fetch model as Selenium Manager's geckodriver). The
   `resolveChromeBinary()` helper prefers `$CHROME_BIN`, then the Puppeteer
   cache, and warns on branded binaries.
2. **Puppeteer path: install over CDP, not flags.** `browser.
   installExtension(dir)` with `pipe: true` +
   `--enable-unsafe-extension-debugging`. Do NOT pass
   `--disable-extensions-except` — on branded Chrome its except-list does
   not recognize the CDP-installed copy and blocks it.
3. **Puppeteer injects `--disable-extensions` by default** (only auto-dropped
   when the legacy except-flag is present) — pass
   `ignoreDefaultArgs: ['--disable-extensions']`.

The Selenium path (chromedriver) still honors `--load-extension` on Chrome
for Testing — that's what makes a D6 UAT-on-Chrome daemon feasible.

## Port allocation (parallel-run safety)

The Chrome tier is designed to run CONCURRENTLY with the Firefox tiers:

| Consumer | Port |
|---|---|
| Firefox E2E (`run_esr_tests.sh`, BiDi) | 9222 |
| Firefox UAT daemon (`browser-daemon.mjs`, `$UAT_BROWSER=firefox` — default) | 9876 (`$UAT_DAEMON_PORT`) |
| Chrome UAT daemon (`browser-daemon.mjs`, `$UAT_BROWSER=chrome` — D6) | 9877 (`$UAT_DAEMON_PORT`) |
| Chrome Puppeteer smoke path (`chrome:smoke`) | **none** — pipe transport, no debugging port |
| Chrome Selenium path (smokes, D6 UAT daemon) | chromedriver: ephemeral per session |
| **Chrome E2E parity runner (`run_chrome_tests.sh`, `test:e2e:chrome` — D5b)** | **9223 — ACTIVE** (was reserved; now the CDP debugging port `puppeteer.connect({ browserURL: ... })` targets) |

The parity runner's own `tests/e2e-chrome/.runner-lock` (mirroring the
Firefox tier's lock) is what lets it share the machine with the Firefox E2E
tier even though both now hold a fixed port — they're different ports, so
no collision, just don't run two `test:e2e:chrome` invocations at once.

## Deterministic extension ID

`_tools/dev-key.json` is a committed PUBLIC key: Chrome derives the
extension ID (`lncefjbclhbbikhanecleanbbohpiclk`) from the manifest `key`
field, so every profile/machine gets the same ID. No private key exists —
none is needed to load unpacked. The key is injected only by the dev staging
path (`stageDevBuild()` → `dist/chrome-dev/`); `pnpm build chrome` store
artifacts never carry it.

## First-boot result (2026-07-15)

5/5 checks green on Chrome for Testing 151: SW registers and runs,
newTab.html renders a 9-cell grid. One page error —
`TypeError: … reading 'onUpdated'` (the un-gated `api.theme` call,
`newTab.js`) — is D2's theme-gate work item, tracked in `CHROME.md`.
