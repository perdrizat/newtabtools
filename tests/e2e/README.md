# E2E Testing — Architecture

E2E tests run against **real Firefox ESR** with the unpacked extension installed. The stack:

- **`web-ext run`** (Mozilla's CLI) launches Firefox ESR with the extension and remote debugging enabled.
- **`puppeteer-core`** connects to the running Firefox over **WebDriver BiDi** — a W3C standard that mainline Firefox supports out of the box.
- **Vitest** is the test runner, same as for Unit and Integration tests, with a separate `e2e` project (see [`vitest.config.js`](../../vitest.config.js)).

## Lifecycle

```
┌────────────────────────────────────────────────────────────────┐
│ run_esr_tests.sh                                                │
│   1. pkill stray firefox-esr                                    │
│   2. web-ext run --firefox=firefox-esr \                        │
│        --args="--remote-debugging-port=9222"                    │
│        --args="-headless"                                       │
│      → Firefox ESR launches with the extension loaded           │
│        and BiDi listening on 9222                               │
│   3. wait until port 9222 is reachable                          │
│   4. vitest run --project e2e                                   │
│      → tests connect via puppeteer.connect(...)                 │
│   5. EXIT trap → pkill firefox-esr                              │
└────────────────────────────────────────────────────────────────┘
```

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
# Terminal 1 — launch Firefox ESR with the extension and BiDi enabled
npx web-ext run \
  --source-dir webextension/ \
  --firefox=firefox-esr \
  --args="--remote-debugging-port=9222"

# Terminal 2 — run a specific test against the running browser
npx vitest run --project e2e tests/e2e/your_test.test.js

# Or watch mode against the running browser:
npx vitest --project e2e tests/e2e/your_test.test.js
```

## Footguns

1. **Firefox build channel.** `xpinstall.signatures.required: false` is only honored on Firefox **ESR / Developer Edition / Nightly**, not Release. Pin ESR in CI.
2. **Headless mode.** Extensions usually load fine in headless ESR via `web-ext run --args="-headless"`. If a test fails specifically in headless, drop the flag locally to see the browser.
3. **Port collision.** Port 9222 is hardcoded in [`run_esr_tests.sh`](run_esr_tests.sh) and [`_helpers.js`](_helpers.js). If something else binds it, the script fails. Sufficient for one-developer use; revisit if CI runs multiple jobs in parallel.
4. **Stale `firefox-esr` processes.** The script `pkill`s on entry and via an EXIT trap. If a manual run crashes uncleanly and leaves a process behind, the next test run will fail to bind 9222 — `pkill -f firefox-esr` to clear.

## Manual debugging tools (not part of the test run)

These scripts live alongside the tests but Vitest's `include: ['tests/e2e/**/*.test.js']` does not pick them up:

- [`_debug/bidi_proof.mjs`](_debug/bidi_proof.mjs) — minimal Puppeteer + BiDi proof of concept; useful when something looks broken to verify the bridge itself.
- [`_debug/probe_bidi.sh`](_debug/probe_bidi.sh) — launches Firefox ESR with the BiDi port and curls the endpoint to verify it responds.

## File naming

New test files **must** use `.test.ts` (TypeScript is the mandated standard for all new E2E tests). Existing `.test.js` files are being migrated incrementally. The shared connection helper lives in `_helpers.js` (the leading underscore signals "not a test").
