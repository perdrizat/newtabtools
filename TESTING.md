# Testing Approach (Agent Guide)

This is the testing guide for this repository. Any contributor working on this codebase MUST read this document before writing code.

## Scope and Ground Rules

- **Firefox-first, Firefox-only:** This extension targets Firefox via `applications.gecko` in `manifest.json`, runs on **Manifest V2**, and has a minimum version pinned to the **latest ESR**. Do not introduce Chromium-only assumptions or MV3 constructs (`background.service_worker`, `action` replacing `browser_action`, `host_permissions` split out from `permissions`, `declarativeNetRequest`). MV3 migration is a project-shaped decision tracked in `ROADMAP.md`, not a side effect of bug fixes.
- **Vanilla JavaScript, not TypeScript:** Tests stay in vanilla JS to match production code. Adopting TS is a separate decision, deferred for now.
- **Red/green TDD is mandatory:** Write a failing test first, watch it fail for the right reason, and write the minimum code to make it pass.
- **Never skip or weaken tests:** Fix them or delete them with justification in the commit message. Never use `--no-verify`.
- **TDD applies to the Fast Loop only:** End-to-End (E2E) testing sits outside the tight TDD loop.

## Environment Setup

These tools must be present on your host machine to develop and test this extension.

| Tool | Version | Why | How to verify |
|---|---|---|---|
| **Node.js** | 20 LTS or 22 LTS | Runs Vitest, Puppeteer, web-ext | `node --version` |
| **npm** | bundled with Node | Package manager | `npm --version` |
| **Git** | any recent | Source control | `git --version` |
| **Firefox ESR** | latest | Canonical testing target | `firefox --version` |
| **`web-ext` CLI** | latest | Mozilla's dev tool | `web-ext --version` |

### Installing Firefox ESR (Ubuntu/WSL)

To ensure consistency, all developers should use the same Firefox ESR version. On Ubuntu/WSL, install it via the official Mozilla APT repository to avoid Snap-related issues:

```bash
# 1. Add the Mozilla APT repository
sudo install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | sudo tee /etc/apt/keyrings/packages.mozilla.org.asc > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" | sudo tee -a /etc/apt/sources.list.d/mozilla.list > /dev/null

# 2. Configure package priority
echo '
Package: *
Pin: origin packages.mozilla.org
Pin-Priority: 1000
' | sudo tee /etc/apt/preferences.d/mozilla

# 3. Install Firefox ESR
sudo apt update && sudo apt install firefox-esr
```

### Continuous Integration (GitHub Actions)

The repository uses GitHub Actions to automatically run the full test suite on every push and pull request.

- **Workflow:** Defined in [`.github/workflows/ci.yml`](file:///home/maol/newtabtools/.github/workflows/ci.yml).
- **Environment:** Ubuntu runners with Firefox ESR installed via the Mozilla APT repository.
- **Instrumentation:** The CI job runs with `E2E_VERBOSE: 1` enabled. If an E2E test fails, Puppeteer's logs and UUID discovery chatter will be visible in the job's terminal output.
- **Artifacts:** If the E2E suite fails in CI, any failure screenshots captured by `captureFailure()` are automatically uploaded as a ZIP archive. To find them, go to the **Actions** tab, click on the failed run, and scroll down to the **Artifacts** section.

### Quick Start for Developers

Once your environment is set up:

1. **Clone and install:**
   ```bash
   git clone git@github.com:perdrizat/newtabtools.git
   cd newtabtools
   npm install
   ```

2. **Verify Firefox ESR is reachable:**
   ```bash
   firefox-esr --version       # should print "Mozilla Firefox 128.x" or your installed ESR version
   which firefox-esr           # confirms the binary path the orchestrator will use
   ```
   On WSL/Linux, the test orchestrator calls `firefox-esr` by name, so the binary must be on `PATH`. If your distro names the package differently (e.g. `firefox` on Arch), symlink or alias as `firefox-esr`.

3. **Manual development:**
   There are two ways to load the extension for interactive testing:

   **Option A: Automatic (web-ext)**
   ```bash
   npm run dev
   ```
   This is the fastest way to confirm the extension wires together cleanly. It launches a temporary Firefox instance with the extension pre-loaded. The profile is discarded on exit.

   **Option B: Manual (about:debugging)**
   If you want to test in your existing browser profile or use the full Firefox DevTools for the background page:
   1. Open Firefox ESR.
   2. Navigate to `about:debugging#/runtime/this-firefox`.
   3. Click **Load Temporary Add-on...**.
   4. Select any file inside the `webextension/` directory (e.g., `manifest.json`).
   5. The extension will appear in the list. Click **Inspect** to open the background page's console/debugger.
   6. To see changes, click **Reload** in the `about:debugging` entry.

4. **Smoke-test the toolchain:**
   ```bash
   npm run lint         # ESLint flat config — should report zero errors
   npm run lint:webext  # Mozilla AMO policy check
   npm run test:fast    # Unit + Integration (Vitest + jsdom + jest-webextension-mock)
   npm run test:e2e     # E2E Validation (launches Firefox ESR, runs Puppeteer over WebDriver BiDi, tears down)
   ```
   All four should pass on a clean clone. If `test:e2e` hangs or fails to bind port 9222, see the E2E section below.

## Project Context & Gotchas

- **XHTML, not HTML:** The new tab page is `newTab.xhtml`. *Gotcha:* jsdom parses files as HTML by default, which can hide namespace bugs. For DOM tests, initialize jsdom with `contentType: "application/xhtml+xml"`.
- **Mixed Callbacks and Promises:** The existing codebase actively uses both `chrome.*` callbacks (e.g., `chrome.tabs.query({}, tabs => {...})`) and `browser.*` promises. The mocking library must support both.
- **No Chromium-only APIs:** If you reach for a `browser.*` API, verify it exists on Firefox ESR before writing the test.

## Project Shape

The WebExtension source lives under `webextension/`. Background scripts are persistent (MV2) and split across `common.js`, `tiles.js`, `prefs.js`, `background.js`, `lib/zip.js`, `export.js`. The new tab page is registered via `chrome_url_overrides.newtab` and lives in `newTab.xhtml` (XHTML, not HTML — see Gotchas).

The codebase touches the following `browser.*` APIs (verify before adding new ones):

- **Always available:** `storage`, `tabs`, `topSites`, `sessions`, `idle`, `menus`, `webNavigation`, `theme`, `permissions`, `runtime`.
- **Optional, granted at runtime:** `bookmarks`, `history`, `downloads`.

The manifest holds `<all_urls>` in `permissions`. Avoid exercising it in tests; if a test does, comment why.

## Repository Layout (test infrastructure)

The files below make up the test scaffold. A new maintainer should not need to recreate any of them — `npm install` against `package.json` plus the configs below is the entire setup.

| File | Purpose |
|---|---|
| `package.json` | `"type": "module"` (tests are ESM); pinned dev deps; npm scripts for `dev`, `lint`, `lint:webext`, `test:unit`, `test:integration`, `test:fast`, `test:e2e`, `test`. |
| `package-lock.json` | **Tracked**. Reproducible installs across machines and CI. |
| `.npmrc` | `min-release-age=7` — refuses to install npm packages published in the last 7 days as supply-chain hygiene. |
| `vitest.config.js` | Vitest with two `projects`: `fast` (jsdom env, includes Unit + Integration) and `e2e` (node env, `fileParallelism: false`, 60-second test timeout, includes `tests/e2e/**/*.test.js`). |
| `tests/setup.js` | Sets `globalThis.jest = vi`, then `await import('jest-webextension-mock')`. The shim is required because the mock library was written for Jest and references a `jest` global at module load. |
| `eslint.config.js` | Flat config (ESLint v10+). Top-level `ignores` list the vendored zip.js files (`webextension/lib/{deflate,inflate,z-worker,zip}.js`). Two file-glob blocks: `webextension/**/*.js` as **script-mode** (legacy `<script>`-loaded code) and `webextension/lib/**/*.js` as **module-mode** (extracted ES modules — where new pure-logic code goes). `no-unused-vars` set to `caughtErrors: 'none'` so legacy `} catch (ex) {}` blocks don't flag. |
| `tests/e2e/_helpers.js` | Exports `connectToFirefox()` which calls `puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:9222/session', protocol: 'webDriverBiDi' })`. |
| `tests/e2e/run_esr_tests.sh` | Lifecycle orchestrator: `pkill` stray firefox-esr → `web-ext run --firefox=firefox-esr --args="--remote-debugging-port=9222 -headless"` → wait for port 9222 → `vitest run --project e2e` → cleanup via EXIT trap. Must be executable (`chmod +x`). |
| `tests/e2e/README.md` | E2E architecture, lifecycle diagram, manual-debug workflow, and the full "why not Playwright" diagnosis. |
| `.gitignore` | Excludes `node_modules/`, `test-results/`, `.vitest-cache/`. Does **not** exclude `package-lock.json`. |

## The Testing Strategy

Testing is divided into two primary tiers: **The Fast Feedback Loop** (Unit & Integration) and **The E2E Validation Suite** (UAT).

### The Fast Feedback Loop (Vitest + JSDOM)

This loop runs in milliseconds and is used constantly during active development. It consists of two test types, strictly separated by directory to enforce boundaries:

#### Unit Tests: Isolated Logic (`tests/unit/`)
For logic that does NOT touch the browser: tile math, serialization, URL validation, color parsing.
- **Rule:** Modules tested here **cannot import `browser.*` or `chrome.*`**. If they do, extract the pure logic into a separate module first.
- **Layout:** Mirror the source path — e.g. `webextension/lib/colour.js` is tested by `tests/unit/lib/colour.test.js`.
- **Speed budget:** Tests run in milliseconds. >50 ms per test is a smell (real I/O, real timers, missed mock).
- **No real I/O:** No network, no filesystem, no real timers. Use `vi.useFakeTimers()` when time matters.

#### Integration Tests: API Contracts (`tests/integration/`)
For code that orchestrates WebExtension APIs.
- **Mocking library:** `jest-webextension-mock` (the project standard — do not introduce a second one).
- **Layout:** Mirror the source path — e.g. `webextension/background.js` is tested by `tests/integration/background.test.js`.
- **What to assert:** the right API was called with the right arguments; handlers react correctly to stubbed returns including rejection / empty / undefined cases; listeners register exactly once and unregister cleanly when expected.
- **What NOT to assert:** that Firefox's implementation of a `browser.*` API actually does what the docs say. Trust the platform — that's E2E's job.
- **Mock-vs-real drift:** If `jest-webextension-mock`'s behavior diverges from actual Firefox ESR, **trust the mock during the Fast Loop** and rely on the E2E suite to catch the divergence. If a specific drift bites, stub the correct behavior locally in the test rather than spiraling on upstream mock fixes.

### The E2E Validation Suite (Puppeteer + WebDriver BiDi)

E2E tests are **user-acceptance tests**: every main feature of the extension should have at least one E2E test that exercises it from the user's perspective in a real browser. E2E also covers **visual and layout regression** — things a unit test or mock simply cannot verify.

- **Tool:** Vitest's `e2e` project drives `puppeteer-core` connected over **WebDriver BiDi** to a Firefox ESR launched by `web-ext run`. (Playwright was tried and rejected — its patched-Firefox design cannot drive system ESR. See `tests/e2e/README.md` for the technical diagnosis.)
- **Location:** `tests/e2e/*.test.js` (matching the fast-loop naming).
- **Lifecycle:** `tests/e2e/run_esr_tests.sh` launches Firefox ESR with `--remote-debugging-port=9222`, waits for the port, runs Vitest's e2e project, and cleans up via an EXIT trap. Tests connect using the `connectToFirefox()` helper in `tests/e2e/_helpers.js`.
- **When to run:**
  1. Once at the end of every completed feature.
  2. Always as part of the "prepare for commit" workflow.
  3. **Never inside the inner TDD loop.** Browser launches are too slow for agents.

#### What E2E must cover

E2E tests are **user-acceptance tests**. The guiding principle: every feature a user could exercise from the new tab page should have at least one E2E test that proves the workflow works end-to-end in a real browser. E2E also covers **visual and layout correctness** — things no unit test or mock can verify.

Tests fall into four categories:

**1. Smoke — the extension loads and renders.**
The single most valuable E2E test is: install the extension, open `about:newtab`, and assert the page renders with **zero console errors**. Most regressions show up as console errors before they show up as broken UI. Also verify the XHTML document parses (not a blank page or XML parse error) and the tile grid is visible with cells.

**2. Feature acceptance — happy-path workflows.**
Every user-facing feature should have at least one E2E test exercising the primary workflow: perform an action → observe the result → reload → confirm persistence. The *depth* of E2E coverage depends on the feature's importance:

- **Killer (gap) features** — the reasons NTT exists over native Firefox — get multiple E2E cases per feature, including edge cases and error states. These are the features where regressions hurt most.
- **Parity (match) features** — things native Firefox also does, which NTT must maintain — get a single happy-path smoke each. Don't try to match Firefox behaviour bug-for-bug; just prove the feature works.
- **Drop features** — legacy elements being removed — get no E2E. Delete tests when the feature leaves the codebase.

See [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md) for the concrete feature-by-feature scope matrix and its mapping to E2E test depth.

**3. Visual and layout regression.**
The extension's visual identity is a core differentiator — tiles that are *large* and that *fill the viewport* is a flagship benefit. E2E must verify appearance, not just function:

- **Tiles fill the viewport.** The grid should expand so tiles collectively cover the available window area. No large empty regions around or between tiles beyond the user-configured margin/spacing.
- **Layout settings have visible effect.** Changing margin, spacing, title size, rows, or columns should produce a measurable change in the rendered layout (element positions, sizes, or visibility).
- **Theme correctness.** Light theme uses a light background with dark text; dark theme uses a dark background with light text. No invisible-text situations.
- **Responsive reflow.** Resizing the viewport should reflow tiles proportionally.

Use **screenshot comparison** (`page.screenshot()` + pixel-diff or Vitest snapshot matching) for visual regression where practical. Store baseline images in `tests/e2e/screenshots/` and review diffs during PR review.

**4. Settings round-trip.**
Every preference the user can change via the settings panel must survive a full round-trip: set it → reload `about:newtab` → assert the value is restored. This catches storage bugs, serialization mismatches, and migration regressions that mocks cannot surface.

## Two Flow Modes (The Key Rule)

Which category you start with depends on whether the code already exists.

### Mode A: New Code / Features (Extraction First)
1. Identify the smallest pure function that expresses the new behavior.
2. Write a Pure-Logic test (`tests/unit/`) against it. Watch it fail.
3. Implement the function.
4. Wire it into the UI/Extension APIs, adding an API Contract test (`tests/integration/`) for the wiring.

### Mode B: Legacy Code (Characterize First)
The codebase has massive files (e.g., `newTab.js`) mixing logic, DOM, and APIs. **Do not refactor as a prerequisite to testing.**
1. **Characterize:** Write an API Contract test (`tests/integration/`) that mocks `browser.*` at the API seam and asserts the *current* behavior of the function you're changing. Watch it pass against today's code.
2. **Red/Green:** Write a failing test for the new behavior/fix, then implement it.
3. **Refactor under Green:** Once tests pass, extract pure-logic helpers out of the legacy file.
4. **Backfill:** Add Pure-Logic tests (`tests/unit/`) for the newly extracted pieces.

**Naming for tracked issues:** When the change is tied to a numbered issue, the regression test file (or its `describe()` block) should reference the issue number — e.g. `tests/integration/issue-217-thumbnail-empty.test.js` or `describe('issue 217: thumbnail empty', ...)`. This keeps the suite traceable to bug history. Not every Mode B characterization test needs this; the convention applies when there is an issue number to reference.

## TDD Workflow per Task

For every task (feature or bug fix):

1. Read the request. Restate it as a behavior.
2. Decide Mode A (new code) or Mode B (touching legacy code).
3. **Mode A:** write failing Pure-Logic test → implement → green. Add an API Contract test if there's `browser.*` wiring.
   **Mode B:** write characterization test → confirm it passes → write a failing test for the new behavior → implement → green. Refactor under green if appropriate. Add Pure-Logic tests for any extracted pieces.
4. Run the full Fast Feedback suite. Confirm green.
5. **Once the feature is complete:** run the full E2E Validation suite. Confirm green.
6. Update `CHANGELOG.md` under `[Unreleased]` per global instructions.
7. Run `pre_commit_check.sh` and the prepare-for-commit workflow (which re-runs E2E).

## Static Checks (Run before every commit)
- **`web-ext lint`**: Run against `webextension/` to catch AMO-policy regressions.
- **ESLint**: Ensure `env: { webextensions: true }` is set in the config to support browser APIs.

## What NOT to do
- Do not write a test that passes against current code without first watching it fail (unless it is an explicit Mode B characterization test).
- Do not refactor legacy files before characterization tests cover the methods you're touching.
- Do not import `browser.*` or `chrome.*` in `tests/unit/` — refactor to remove the dependency, or move the test to `tests/integration/`.
- Do not run E2E inside the inner TDD loop. E2E validation only runs at feature completion and on prepare-for-commit.
- Do not assert on log output or DOM strings as a substitute for behavior.
- Do not add E2E coverage for logic that a Pure-Logic or API Contract test could cover.
- Do not introduce a second test framework, second mocking library, or a Chromium target. Cross-browser support is tracked in `ROADMAP.md`; raise it as a question, do not silently add it.
- Do not skip tests, mark them pending, or weaken assertions to make a build pass. Never use `--no-verify`.
