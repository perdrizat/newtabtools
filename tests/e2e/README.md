# E2E Testing — Architecture

E2E tests run against **real Firefox** with the unpacked extension installed. The extension is MV3 — its background is a non-persistent **event page** that suspends after idle and respawns on events — and this tier deliberately exercises that lifecycle. The stack:

- **`web-ext run`** (Mozilla's CLI) launches Firefox with the extension and remote debugging enabled.
- **`puppeteer-core`** connects to the running Firefox over **WebDriver BiDi** — a W3C standard that mainline Firefox supports out of the box.
- **Vitest** is the test runner, same as for Unit and Integration tests, with a separate `e2e` project (see [`vitest.config.js`](../../vitest.config.js)).

**Firefox channel:** this tier runs on **release-channel Firefox (>= 152)**, not ESR. MV3's `tabs.captureVisibleTab`/`captureTab` are `undefined` on every Firefox build through 151.0 and only become working functions from 152.0 (empirically bisected — see [`MV3_MIGRATION.md`](../../MV3_MIGRATION.md) spike findings). Mozilla's APT repo has no ESR that new yet, so the default binary moved to release `firefox`; `$FIREFOX_ESR_BIN` still overrides the binary (the env var name is unchanged for backwards compatibility) and the tier can move back to ESR once a 152-based ESR ships.

## Lifecycle

```
┌────────────────────────────────────────────────────────────────┐
│ run_esr_tests.sh (name unchanged from the ESR era)              │
│   1. pkill stray processes on this run's test profile           │
│   2. web-ext run --firefox=firefox \                            │
│        --pref=extensions.background.idle.timeout=10000          │
│        --args="--remote-debugging-port=9222"                    │
│        --args="-headless"                                       │
│      → Firefox (release channel, >= 152) launches with the      │
│        extension loaded and BiDi listening on 9222              │
│   3. wait until port 9222 is reachable                          │
│   4. vitest run --project e2e                                   │
│      → tests connect via puppeteer.connect(...)                 │
│   5. EXIT trap → cleanup                                        │
└────────────────────────────────────────────────────────────────┘
```

The `extensions.background.idle.timeout=10000` pref is deliberate lifecycle stress: it forces the event page to actually suspend and respawn between tests (menus, IndexedDB reconnect, in-flight capture state all have to survive it), not just be covered by one dedicated suite. [`event-page-lifecycle.test.ts`](event-page-lifecycle.test.ts) is the dedicated suspension-recovery test — post-suspension IDB reconnect via a message round-trip, plus a full capture pipeline run through a respawned event page — but every other E2E test in the suite also runs against a browser that is suspending and respawning in the background.

## Test pattern

Use the helper in [`_helpers.js`](_helpers.js) to keep boilerplate to one line:

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

Standard run via npm (handles the full lifecycle):

```bash
npm run test:e2e
```

To debug a single test interactively without restarting Firefox between iterations:

```bash
# Terminal 1 — launch Firefox (release channel, >= 152) with the extension and BiDi enabled
npx web-ext run \
  --source-dir webextension/ \
  --firefox=firefox \
  --args="--remote-debugging-port=9222"
# Or against an ESR/other override binary:
#   --firefox="$FIREFOX_ESR_BIN"

# Terminal 2 — run a specific test against the running browser
npx vitest run --project e2e tests/e2e/your_test.test.js

# Or watch mode against the running browser:
npx vitest --project e2e tests/e2e/your_test.test.js
```

## Footguns

1. **Firefox build channel.** `xpinstall.signatures.required: false` is only honored on Firefox **ESR / Developer Edition / Nightly**, not Release — this tier's own launches (via `web-ext run`) don't rely on that pref, but be aware of it if you're diagnosing a manual/unsigned install issue on release Firefox.
2. **Headless mode.** Extensions usually load fine in headless release Firefox via `web-ext run --args="-headless"`. If a test fails specifically in headless, drop the flag locally to see the browser.
3. **Port collision.** Port 9222 is hardcoded in [`run_esr_tests.sh`](run_esr_tests.sh) and [`_helpers.js`](_helpers.js). If something else binds it, the script fails. Sufficient for one-developer use; revisit if CI runs multiple jobs in parallel.
4. **Stale Firefox processes.** The script `pkill`s on entry and via an EXIT trap, scoped to this run's test profile (not a blanket process-name kill — the default binary is now release Firefox, likely a developer's daily-driver browser too). If a manual run crashes uncleanly and leaves a process behind, `pkill -f <profile-dir-path>` to clear it, or as a last resort `pkill -f firefox`.
5. **`captureVisibleTab`/`captureTab` require Firefox >= 152.** Both are `undefined` on any older build (MV2 or MV3) — a test that exercises capture will fail opaquely on an out-of-date binary, not with a clear "unsupported version" error. Check `firefox --version` first if capture tests fail unexpectedly.

## Manual debugging tools (not part of the test run)

These scripts live alongside the tests but Vitest's `include: ['tests/e2e/**/*.test.js']` does not pick them up:

- [`_debug/bidi_proof.mjs`](_debug/bidi_proof.mjs) — minimal Puppeteer + BiDi proof of concept; useful when something looks broken to verify the bridge itself.
- [`_debug/probe_bidi.sh`](_debug/probe_bidi.sh) — launches Firefox with the BiDi port and curls the endpoint to verify it responds.

## File naming

New test files **must** use `.test.ts` (TypeScript is the mandated standard for all new E2E tests). Existing `.test.js` files are being migrated incrementally. The shared connection helper lives in `_helpers.js` (the leading underscore signals "not a test").
