# E2E Testing — Architecture

E2E tests run against **real Firefox** with the unpacked extension installed. The extension is MV3 — its background is a non-persistent **event page** that suspends after idle and respawns on events — and this tier deliberately exercises that lifecycle. The stack:

- **`web-ext run`** (Mozilla's CLI) launches Firefox with the extension and remote debugging enabled.
- **`puppeteer-core`** connects to the running Firefox over **WebDriver BiDi** — a W3C standard that mainline Firefox supports out of the box.
- **Vitest** is the test runner, same as for Unit and Integration tests, with a separate `e2e` project (see [`vitest.config.js`](../../vitest.config.js)).

**Firefox channel:** this tier runs on **Firefox ESR (>= 153)** by default — the `e2e` channel in [`../_browsers/registry.mjs`](../_browsers/registry.mjs) (`firefox-esr`; `$FIREFOX_BIN` overrides the binary). MV3's `tabs.captureVisibleTab`/`captureTab` only exist from 152.0, so the tier ran on release until the 153 ESR shipped. Since Firefox 153 the launch needs `--remote-allow-system-access` to navigate to `moz-extension://` pages. Per-version BiDi quirks, error strings and the ESR-bump checklist live in [`../compat/NOTEBOOK.md`](../compat/NOTEBOOK.md).

**Chrome parity (CHROME.md D5b):** this SAME `tests/e2e/**/*.test.ts` suite also runs against branded stable Chrome via `pnpm test:e2e:chrome` (`tests/e2e/run.sh chrome`) — no separate test files. `$NTT_BROWSER` (set by the runner) makes [`_helpers.ts`](_helpers.ts) resolve the browser from the registry: BiDi@9222 vs CDP@9223, the `moz-extension://` vs `chrome-extension://` origin, and `ENGINE` (`gecko`/`chromium`) for the few tests that branch. See [`../_browsers/chrome/README.md`](../_browsers/chrome/README.md) for the Chrome launcher and the per-file triage table. Everything below describes the Firefox path specifically.

## Lifecycle

```
┌────────────────────────────────────────────────────────────────┐
│ run.sh <browser>  (pnpm test:e2e:<browser>)                     │
│   0. registry lookup (tests/_browsers/registry.mjs):            │
│      channel, port, artifacts dir; per-browser runner lock      │
│   1. hook: tests/_browsers/<browser>/e2e.sh — for firefox:      │
│      pkill stray processes on this run's test profile, then     │
│      web-ext run --firefox=<esr binary> \                       │
│        --pref=extensions.background.idle.timeout=10000          │
│        --args="--remote-debugging-port=9222"                    │
│        --args="-headless"                                       │
│        --args="--remote-allow-system-access"                    │
│      → Firefox ESR (>= 153) launches with the                   │
│        extension loaded and BiDi listening on 9222              │
│   2. hook: wait until port 9222 is reachable                    │
│   3. vitest run --project e2e                                   │
│      → tests connect via puppeteer.connect(...)                 │
│   4. EXIT trap → hook teardown, lock release                    │
└────────────────────────────────────────────────────────────────┘
```

The `extensions.background.idle.timeout=10000` pref is deliberate lifecycle stress: it forces the event page to actually suspend and respawn between tests (menus, IndexedDB reconnect, in-flight capture state all have to survive it), not just be covered by one dedicated suite. [`event-page-lifecycle.test.ts`](event-page-lifecycle.test.ts) is the dedicated suspension-recovery test — post-suspension IDB reconnect via a message round-trip, plus a full capture pipeline run through a respawned event page — but every other E2E test in the suite also runs against a browser that is suspending and respawning in the background.

## Test pattern

Use the helper in [`_helpers.ts`](_helpers.ts) to keep boilerplate to one line:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectToFirefox } from './_helpers.ts';

describe('my smoke', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await connectToFirefox();
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.disconnect();
  });

  it('does a thing', async () => {
    await page.goto('about:newtab', { waitUntil: 'domcontentloaded' });
    // ... assertions ...
  });
});
```

## Running

Standard run (handles the full lifecycle; `pnpm test:e2e` runs every registered browser):

```bash
pnpm test:e2e:firefox
```

To debug a single test interactively without restarting Firefox between iterations:

```bash
# Terminal 1 — launch Firefox ESR with the extension and BiDi enabled
npx web-ext run \
  --source-dir webextension/ \
  --firefox=firefox-esr \
  --args="--remote-debugging-port=9222" \
  --args="--remote-allow-system-access"
# Or against another binary (e.g. release, to reproduce a release-only gate):
#   --firefox=firefox

# Terminal 2 — run a specific test against the running browser
npx vitest run --project e2e tests/e2e/your_test.test.js

# Or watch mode against the running browser:
npx vitest --project e2e tests/e2e/your_test.test.js
```

## Footguns

1. **Firefox build channel.** `xpinstall.signatures.required: false` is only honored on Firefox **ESR / Developer Edition / Nightly**, not Release — this tier's own launches (via `web-ext run`) don't rely on that pref, but be aware of it if you're diagnosing a manual/unsigned install issue on release Firefox.
2. **Headless mode.** Extensions usually load fine in headless release Firefox via `web-ext run --args="-headless"`. If a test fails specifically in headless, drop the flag locally to see the browser.
3. **Port collision.** Each browser's E2E port is fixed in [`../_browsers/registry.mjs`](../_browsers/registry.mjs) (Firefox 9222). If something else binds it, the run fails. Sufficient for one-developer use; revisit if CI runs multiple jobs in parallel.
4. **Stale Firefox processes.** The Firefox hook `pkill`s on entry and on teardown, scoped to this run's test profile (not a blanket process-name kill — that would hit a developer's daily-driver Firefox, and the former `pkill -f firefox-esr` even killed the invoking shell when `firefox-esr` was on its command line). If a manual run crashes uncleanly and leaves a process behind, `pkill -f <profile-dir-path>` to clear it, or as a last resort `pkill -f firefox`.
5. **`captureVisibleTab`/`captureTab` require Firefox >= 152.** Both are `undefined` on any older build (MV2 or MV3) — a test that exercises capture will fail opaquely on an out-of-date binary, not with a clear "unsupported version" error. Check `firefox --version` first if capture tests fail unexpectedly.

## When the driver itself looks broken

Run `pnpm test:compat` ([`../compat/README.md`](../compat/README.md)). Its probes check the driver one capability at a time (session connects, extension-page navigation, each command and event) on ESR and release, and diff the result against the committed matrix. That tells a browser/driver change apart from a test or extension bug.

## Navigating to the extension page

Use `openNewTab` or `gotoExtensionPage` from `_helpers.ts`, never a raw `page.goto`: on Firefox the goto never resolves for `moz-extension://` pages, so awaiting it costs its full timeout. The helper fires the goto and polls for the new document instead (`tests/integration/browser-registry.test.ts` guards this).

## File naming

New test files **must** use `.test.ts` (TypeScript is the mandated standard for all new E2E tests). Existing `.test.js` files are being migrated incrementally. The shared connection helper lives in `_helpers.ts` (the leading underscore signals "not a test"). Per-run output goes to `_artifacts/<browser>/` (gitignored).
