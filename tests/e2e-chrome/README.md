# Chrome runtime tier (CHROME.md D1+)

Tooling for running the extension on real Chrome. Established in D1; grows
into the `test:e2e:chrome` smoke suite in D5.

```bash
pnpm chrome:provision        # one-time: fetch Chrome for Testing (~200 MB, ~/.cache/puppeteer)
pnpm chrome:smoke            # Puppeteer/CDP first-boot smoke (5 checks)
pnpm chrome:smoke:selenium   # Selenium path (chromedriver via Selenium Manager) — de-risks UAT-on-Chrome (D6)
```

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
