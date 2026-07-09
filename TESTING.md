# Testing Approach (Agent Guide)

This is the testing guide for this repository. Any contributor working on this codebase MUST read this document before writing code.

## Scope and Ground Rules

- **Firefox-first, Firefox-only:** This extension targets Firefox via `browser_specific_settings.gecko` in `manifest.json`, runs on **Manifest V3** (`strict_min_version` **152.0** — the version Firefox first exposes `tabs.captureVisibleTab`/`captureTab` to MV3 extensions; see [`MV3_MIGRATION.md`](MV3_MIGRATION.md) spike findings), with a non-persistent **event page** background (classic `background.scripts` array, no service worker — full DOM/`window`/canvas access, suspends after idle and respawns on events). Do not introduce Chrome-only assumptions (`background.service_worker`, offscreen documents, `declarativeNetRequest`) — Chrome support is a project-shaped decision tracked in [`ROADMAP.md`](ROADMAP.md), not a side effect of bug fixes.
- **JavaScript on production, TypeScript on tests, no build step.** Production `.js` files under `webextension/` carry types via JSDoc; test files under `tests/` use full TypeScript. Both are checked by `tsc --noEmit` (`allowJs: true`, `checkJs: true`). `web-ext run` consumes `webextension/` directly — no compilation between source and runtime. See [`CONTRIBUTING.md`](CONTRIBUTING.md) "Rules for new code" for the full language rules.
- **Red/green TDD is mandatory:** Write a failing test first, watch it fail for the right reason, and write the minimum code to make it pass.
- **Never skip or weaken tests:** Fix them or delete them with justification in the commit message. Never use `--no-verify`.
- **TDD applies to Unit and Integration tests only:** End-to-end (E2E) testing sits outside the tight TDD loop — it runs at feature completion and pre-commit, not on every save.

## Test Design Principles

**Tests assert behavior, not source contents.** During the May 2026 codebase audit, many integration tests were written as "source-grep" — reading production `.js`/`.css` files with `fs.readFileSync` and asserting on string patterns (`expect(source).toContain(...)`). This was expedient for initial characterization but is fragile: a rename, refactor, or dead-code removal can silently break or false-pass these tests.

Prefer **behavioral tests** that load the module via `vm.runInThisContext` or `vm.createContext` and exercise it through its public API. The helpers in [`tests/integration/_helpers.ts`](tests/integration/_helpers.ts) reduce the boilerplate:

- **`loadModule(path, sandbox?)`** — loads a production JS file into an isolated `vm.createContext` sandbox with sensible default mocks. Returns the populated sandbox.
- **`mountSite(linkData)`** — one-liner to construct a `Site` instance with the full tile environment (template, icons.js, fx-newTab.js, global mocks). Returns `{ site, node, cleanup }`.

Source-grep is acceptable for purely structural checks (template element presence, CSS rule existence, deprecated symbol absence). These are flagged by the **`ntt/no-source-grep`** ESLint rule — add an `eslint-disable-next-line` comment with a brief justification when the check is intentional. Two boundaries on that exemption (audit 2026-06-10 §5.6):

- **A source-string match may never be the sole coverage for a functional behavior.** "The markup carries the danger class" does not prove the confirm gate fires on click — if a behavior is named in a test file's description, a behavioral test (this tier, E2E, or UAT) must exist somewhere for it.
- **The justification comment must say why a behavioral test isn't possible** (e.g. "jsdom can't resolve the stylesheet cascade"), not just what is being checked.

## Environment Setup

These tools must be present on your host machine to develop and test this extension.

| Tool | Version | Why | How to verify |
|---|---|---|---|
| **Node.js** | >= 24 (see `.node-version` / `engines.node`) | Runs Vitest, Puppeteer, web-ext | `node --version` |
| **pnpm** | 11.x (auto-installed by corepack from `packageManager` in `package.json`) | Package manager — required (npm/yarn are blocked by `scripts/check-pnpm.js`) | `pnpm --version` |
| **Firefox (release), >= 152** | latest | Canonical **E2E** target (`$FIREFOX_ESR_BIN` overrides the binary) | `firefox --version` |
| **`web-ext` CLI** | latest | Mozilla's dev tool | `web-ext --version` |
| **geckodriver** | latest | **UAT tier** Selenium driver (auto-fetched by Selenium Manager on first run) | `geckodriver --version` |
| **Claude Code CLI** | latest | **UAT tier** agent driver (`claude -p`) | `claude --version` |

> Release-channel Firefox now serves **both** the E2E and UAT tiers — MV3's `tabs.captureVisibleTab`/`captureTab` only exist from Firefox 152.0, and no ESR build that new exists yet in Mozilla's APT repo (see [`MV3_MIGRATION.md`](MV3_MIGRATION.md)). When a 152-based ESR reaches the APT repo, E2E can move back to it; `$FIREFOX_ESR_BIN` still works as a binary override in the meantime. The bottom two (geckodriver, Claude Code CLI) are **only** needed to run `pnpm test:uat` (pre-release tier). The Unit/Integration tiers don't require any Firefox binary, and CI doesn't install the UAT-only tools. The packages `selenium-webdriver` and `@modelcontextprotocol/sdk` arrive via `pnpm install`. Setup details under "Installing the E2E & UAT (Firefox) and verify tooling" below.

### Installing Node.js and dependencies

We recommend using a version manager like [`fnm`](https://github.com/Schniz/fnm) or [`nvm`](https://github.com/nvm-sh/nvm) to manage Node.js versions. Both honor the `.node-version` file in the repo root.

```bash
# 0. Install a Node version manager if you don't have one (fnm shown; nvm works
#    too — both honor .node-version). On a fresh Ubuntu/WSL box, install its
#    prerequisites first, then fnm itself:
sudo apt update && sudo apt install -y curl unzip
curl -fsSL https://fnm.vercel.app/install | bash
#    Restart your shell (or `source ~/.bashrc`) so `fnm` is on PATH and its
#    shell hook is active before the next step.

# 1. Install Node (the version comes from .node-version — currently 24)
fnm install   # or: nvm install
fnm use       # or: nvm use

# 2. Activate corepack and the pinned pnpm version (from package.json)
corepack enable
corepack prepare pnpm@11.6.0 --activate  # adjust to whatever `packageManager` says

# 3. Verify
node --version    # >= v24
pnpm --version    # >= v11

# 4. Install project dependencies (the .npmrc minimum-release-age=604800 guard
#    refuses any package version less than 7 days old)
pnpm install
```

### Installing the E2E & UAT (Firefox) and verify tooling

Both the **E2E** and **UAT** tiers now target **release-channel Firefox (>= 152)** — MV3's `tabs.captureVisibleTab`/`captureTab` don't exist on any Firefox build before 152.0, and Mozilla's APT repo has no ESR that new yet (see [`MV3_MIGRATION.md`](MV3_MIGRATION.md)). They're still deliberately different stacks under the hood — E2E drives it via `web-ext` + WebDriver BiDi, UAT drives it via Selenium + geckodriver (rationale in the "UAT tests" section below and [`tests/uat/README.md`](tests/uat/README.md)) — but only one Firefox install is needed now. `$FIREFOX_ESR_BIN` still works as an E2E binary override (e.g. once a 152-based ESR ships) — the env var name is unchanged for backwards compatibility. The UAT-only pieces (geckodriver, the Claude Code CLI) are needed **only** for `pnpm test:uat` — the Unit/Integration/E2E tiers and CI don't use them.

On Ubuntu/WSL, install from the official Mozilla APT repository (avoids Snap-related issues and pins everyone to the same builds):

```bash
# 1. Add the Mozilla APT repository (provides release firefox; also firefox-esr,
#    kept for when a 152-based ESR ships)
sudo install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | sudo tee /etc/apt/keyrings/packages.mozilla.org.asc > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" | sudo tee -a /etc/apt/sources.list.d/mozilla.list > /dev/null

# 2. Prefer Mozilla's builds over the Ubuntu Snap repackage
echo '
Package: *
Pin: origin packages.mozilla.org
Pin-Priority: 1000
' | sudo tee /etc/apt/preferences.d/mozilla

# 3. Install release Firefox (E2E + UAT target, >= 152)
sudo apt update && sudo apt install -y firefox

# 4. Verify E2E & UAT tooling**
firefox --version        # E2E + UAT target present (release-channel Firefox, >= 152)
claude /login            # UAT agent — Claude Code CLI signed in (one-time; re-run to confirm the session)
pnpm build               # build the extension .xpi
node tests/uat/_tools/browser-smoke.mjs
# expect: "new-tab grid rendered" + a screenshot under tests/uat/artifacts/
```

UAT preflight (`pnpm test:uat:preflight`) fails fast if the detected Firefox is below 152.

The .xpi lives under `dist/`, UAT-specific evidence (screenshots, scenario reports) lives under `tests/uat/artifacts/` (all git-ignored). See [`tests/uat/README.md`](tests/uat/README.md) for the full tool inventory.

### Continuous Integration (GitHub Actions)

The repository uses GitHub Actions to automatically run the full test suite on every push and pull request.

- **Workflow:** Defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
- **Environment:** Ubuntu runners with release-channel Firefox (>= 152) installed via the Mozilla APT repository.
- **Instrumentation:** The CI job runs with `E2E_VERBOSE: 1` enabled. If an E2E test fails, Puppeteer's logs and UUID discovery chatter will be visible in the job's terminal output.
- **Artifacts:** If the E2E suite fails in CI, any failure screenshots captured by `captureFailure()` are automatically uploaded as a ZIP archive. To find them, go to the **Actions** tab, click on the failed run, and scroll down to the **Artifacts** section.
- **UAT is *not* run in CI** — and shouldn't be on the normal push/PR path. Three blockers: (1) **auth** — `claude -p` uses the developer's Claude Code *subscription*; CI has no logged-in session, and the plan deliberately does not read `ANTHROPIC_API_KEY` (API-key mode is deferred). (2) **Non-determinism** — although the local runner gates its exit code on the report's assertions, those assertions include LLM *visual* judgments that aren't reproducible run-to-run, so UAT must never gate a merge. (3) **Cost** — every run spends model tokens. If UAT is ever automated, it should be a **separate, manually-triggered (`workflow_dispatch`) or scheduled pre-release** job that installs release Firefox + geckodriver, runs in **API-key mode against a budget**, uploads the `report.json`/`summary.md`/screenshots as artifacts, and **always exits 0** (advisory, non-blocking). Not the push/PR gate. Tracked in [`ROADMAP.md`](ROADMAP.md) under deferred CI automation.



## CLI Reference

These commands are the primary interface for development. Run them from the project root.

| Command | Action | Tier |
|---|---|---|
| `pnpm dev` | Launch extension in a temporary Firefox profile | Interactive Dev |
| `pnpm lint` | Run ESLint (checks both production JS and test TS) | Quality |
| `pnpm lint:webext` | Run `web-ext lint` (Mozilla policy check) | Quality |
| `pnpm typecheck` | Run `tsc --noEmit` (full type validation) | Quality |
| `pnpm test:fast` | Run Unit + Integration tests | TDD Loop |
| `pnpm test:e2e` | Run full E2E suite against release-channel Firefox (>= 152; `$FIREFOX_ESR_BIN` overrides binary) | Validation |
| `pnpm test` | Run all tests (Fast + E2E) | Pre-commit |
| `pnpm test:uat` | Run LLM-driven user acceptance scenarios against release-channel Firefox (append slugs to run a subset) | UAT (pre-release) |
| `pnpm test:uat:preflight` | Validate the UAT environment only (Node/pnpm versions, release Firefox reports a clean `--version`, built `.xpi`, fixture hash, `claude` CLI, daemon port) without running scenarios or spending tokens | UAT (env check) |

All four quality/test checks should pass on a clean clone. If `test:e2e` hangs or fails to bind port 9222, see the E2E section below.

### Running a subset (single file or name filter)

**Vitest is never invoked directly** — no `npx vitest`, no `pnpm exec vitest`. Always go through the pnpm scripts so the correct Vitest project, jsdom/node environment, and (for E2E) the Firefox lifecycle are set up for you. To narrow a run, **append a filename or path substring** to the script and Vitest treats it as a test-file filter:

| To run | Command |
|---|---|
| One fast-tier file by name | `pnpm test:fast typography` |
| One integration file | `pnpm test:integration recent-tabs` |
| One unit file | `pnpm test:unit url-validation` |
| One E2E file (path) | `pnpm test:e2e tests/e2e/titlebar.test.js` |

The filter is a substring match against the file path, so `pnpm test:fast titlebar` runs every fast file with "titlebar" in its name. This is the sanctioned way to run a single test during the TDD inner loop — reaching for raw `vitest`/`npx` skips the project/env setup the scripts provide.

## Project Context & Gotchas

- **Mixed Callbacks and Promises:** The existing codebase actively uses both `chrome.*` callbacks (e.g., `chrome.tabs.query({}, tabs => {...})`) and `browser.*` promises. The mocking library must support both.
- **No Chromium-only APIs:** If you reach for a `browser.*` API, verify it exists on the minimum supported Firefox (152) before writing the test.

## Project Shape

The WebExtension source lives under `webextension/`. Background scripts run as a non-persistent **event page** (MV3, `background: {"scripts": ["lib/background-main.js"], "type": "module"}` — no service worker). `lib/background-main.js` is a single ES-module entry that side-effect-imports the two PERMANENT dual-scope bridge files — `common.js`, `prefs.js` (MODERNIZATION.md Decision 2: they also load as a classic `<script>` on the page, so their top-level definitions stay `globalThis.X = …` rather than real `export`s) — and then registers every listener directly, reaching the rest of the background (`lib/messages.js`'s dispatch table, `lib/tiles-store.js`, `lib/db.js`, `lib/capture.js`, `lib/backup.js`, `lib/platform.js`) via real `import`s. MODERNIZATION.md Stage M (background ES-module rewrite) is the source of truth for how this settled; the historical per-slice story (including the retired `background.js`/`tiles.js`/`export.js`/`lib/zip-global.js` bridge files) lives in that document's status board. The new tab page is registered via `chrome_url_overrides.newtab` and lives in `newTab.html` (HTML5, parsed by jsdom's default HTML parser — no more XHTML/XML-namespace gotcha; see [`MODERNIZATION.md`](MODERNIZATION.md) Stage H, slice H2).

The codebase touches the following `browser.*` APIs (verify before adding new ones):

- **Always available:** `storage`, `tabs`, `topSites`, `sessions`, `idle`, `menus`, `webNavigation`, `theme`, `permissions`, `runtime`.
- **Optional, granted at runtime:** `bookmarks`, `history`, `downloads`.

The manifest holds `<all_urls>` in `host_permissions` (MV3 splits host-match patterns out of `permissions`). It's shown in the install prompt and is **user-revocable at runtime** — capture code guards with `permissions.contains` and degrades gracefully (no throw) if revoked. Avoid exercising it in tests; if a test does, comment why.

## Repository Layout (test infrastructure)

The files below make up the test scaffold. A new maintainer should not need to recreate any of them — `pnpm install` against `package.json` plus the configs below is the entire setup.

| File | Purpose |
|---|---|
| [`package.json`](package.json) | `"type": "module"` (tests are ESM); pinned dev deps; `packageManager: pnpm@11.x`; `engines.node >=24`; `preinstall` runs `scripts/check-pnpm.js`; package scripts for `dev`, `lint`, `lint:webext`, `test:unit`, `test:integration`, `test:fast`, `test:e2e`, `test`. |
| [`package-lock.json`](package-lock.json) | **Tracked**. Reproducible installs across machines and CI. |
| [`.npmrc`](.npmrc) | `minimum-release-age=604800` (7 days, pnpm-native) — refuses to install package versions less than 7 days old as supply-chain hygiene. Enforced because the project pins pnpm via `packageManager` and rejects npm/yarn in `scripts/check-pnpm.js`. Also `engine-strict=true`, `auto-install-peers=true`. |
| [`vitest.config.js`](vitest.config.js) | Vitest with two `projects`: `fast` (jsdom env, includes Unit + Integration) and `e2e` (node env, `fileParallelism: false`, 60-second test timeout, includes `tests/e2e/**/*.test.js`). |
| [`tests/setup.js`](tests/setup.js) | Sets `globalThis.jest = vi`, then `await import('jest-webextension-mock')`. The shim is required because the mock library was written for Jest and references a `jest` global at module load. |
| [`eslint.config.js`](eslint.config.js) | Flat config (ESLint v10+). Top-level `ignores` excludes the vendored zip tree (`webextension/lib/zip/**`, the unbundled ESM `@zip.js/zip.js` core build — see `scripts/update-zip.mjs`). Two file-glob blocks: `webextension/**/*.js` as **script-mode** (legacy `<script>`-loaded code, plus the six background files that side-effect-import into `lib/background-main.js` — MODERNIZATION.md M1) and `webextension/lib/**/*.js` as **module-mode** (extracted ES modules — where new pure-logic code goes). `no-unused-vars` set to `caughtErrors: 'none'` so legacy `} catch (ex) {}` blocks don't flag. |
| [`tests/e2e/_helpers.js`](tests/e2e/_helpers.js) | Exports `connectToFirefox()` which calls `puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:9222/session', protocol: 'webDriverBiDi' })`. |
| [`tests/e2e/run_esr_tests.sh`](tests/e2e/run_esr_tests.sh) | Lifecycle orchestrator (name unchanged from the ESR era): `pkill` stray processes on this run's profile → `web-ext run --firefox=firefox --pref=extensions.background.idle.timeout=10000 --args="--remote-debugging-port=9222 -headless"` (release channel by default; `$FIREFOX_ESR_BIN` overrides) → wait for port 9222 → `vitest run --project e2e` → cleanup via EXIT trap. Must be executable (`chmod +x`). |
| [`tests/e2e/README.md`](tests/e2e/README.md) | E2E architecture, lifecycle diagram, manual-debug workflow, and the full "why not Playwright" diagnosis. |
| [`.gitignore`](.gitignore) | Excludes `node_modules/`, `test-results/`, `.vitest-cache/`. Does **not** exclude `package-lock.json`. |

## The Testing Strategy

Testing has three deterministic tiers plus a fourth judgment-based tier (UAT), each with its own directory, runner setup, and cadence:

| Tier | Directory | Runs in | Script | When to run |
|---|---|---|---|---|
| **Unit** | `tests/unit/` | Vitest + jsdom | `pnpm test:unit` | On every save during TDD |
| **Integration** | `tests/integration/` | Vitest + jsdom + `jest-webextension-mock` | `pnpm test:integration` | On every save during TDD |
| **E2E** | `tests/e2e/` | Vitest + Puppeteer + release-channel Firefox (>= 152) via WebDriver BiDi | `pnpm test:e2e` | At feature completion and pre-commit |
| **UAT** | `tests/uat/` | Claude Code (headless) + thin MCP client → browser daemon (Selenium + release-channel Firefox) | `pnpm test:uat` | Pre-release only; never on PR/CI |

`pnpm test:fast` runs Unit + Integration together (both use the same Vitest jsdom project, so bundling them is just a script convenience).

### Unit tests (`tests/unit/`)

For logic that does NOT touch the browser: tile math, serialization, URL validation, color parsing.

- **Rule:** Modules tested here **cannot import `browser.*` or `chrome.*`**. If they do, extract the pure logic into a separate module first.
- **Layout:** Mirror the source path — e.g. `webextension/lib/example.js` is tested by `tests/unit/lib/example.test.js`.
- **Speed budget:** Tests run in milliseconds. >50 ms per test is a smell (real I/O, real timers, missed mock).
- **No real I/O:** No network, no filesystem, no real timers. Use `vi.useFakeTimers()` when time matters.

### Integration tests (`tests/integration/`)

For code that orchestrates WebExtension APIs. The browser surface is mocked, not real — this tier verifies wiring, not platform behaviour.

- **Mocking library:** `jest-webextension-mock` (the project standard — do not introduce a second one).
- **Layout:** Mirror the source path — e.g. `webextension/lib/messages.js` is tested by `tests/integration/background-messages.test.ts` / `tests/integration/message-contract.test.ts`.
- **Import, not vm-load, for `webextension/lib/**` modules.** Every file under `lib/` is a real ES module with real `export`s — test it with a native `import`, exactly like production code does (`lib/background-main.js` and the files it imports). `vm.runInThisContext`/`vm.createContext` (via `loadModule`/`mountSite` in `tests/integration/_helpers.ts`) are for the PAGE files only (`newTab.js`, `fx-newTab.js`, `icons.js`, `awesomebar.js`, `stats.js`, `action.js`, `tiles-shim.js`) — those stay classic scripts loaded via `<script>` in `newTab.html` and have no `export`s to `import`. Reach a dual-scope bridge global (`Prefs`/`Blocked`/`Filters`/`NeverCapture`/`compareVersions`) that a real module needs by setting it on `globalThis` before the module under test runs (or, if you're testing `lib/background-main.js` itself, by seeding `chrome.storage.local` and letting the real `prefs.js` compute it — see `tests/integration/db-wake-race.test.ts`'s header comment for the pattern).
- **What to assert:** the right API was called with the right arguments; handlers react correctly to stubbed returns including rejection / empty / undefined cases; listeners register exactly once and unregister cleanly when expected.
- **What NOT to assert:** that Firefox's implementation of a `browser.*` API actually does what the docs say. Trust the platform — that's E2E's job.
- **Mock-vs-real drift:** If `jest-webextension-mock`'s behavior diverges from actual Firefox, **trust the mock at this tier** and rely on the E2E tier to catch the divergence. If a specific drift bites, stub the correct behavior locally in the test rather than spiraling on upstream mock fixes.

### E2E tests (`tests/e2e/`)

E2E tests exercise the extension from the user's perspective in a real Firefox. Every main feature should have at least one E2E test. E2E also covers **visual and layout regression** — things a unit test or mock simply cannot verify.

- **Tool:** Vitest's `e2e` project drives `puppeteer-core` connected over **WebDriver BiDi** to a Firefox instance launched by `web-ext run`. The tier runs on **release-channel Firefox** (`firefox`, >= 152) rather than ESR, because MV3's `tabs.captureVisibleTab`/`captureTab` only exist from Firefox 152.0 and no ESR that new exists yet in Mozilla's APT repo (see [`MV3_MIGRATION.md`](MV3_MIGRATION.md) spike findings). `$FIREFOX_ESR_BIN` still overrides the binary — the runner will move back to ESR once a 152-based build reaches the APT repo. (Playwright was tried and rejected — its patched-Firefox design cannot drive a system Firefox. See [`tests/e2e/README.md`](tests/e2e/README.md) for the technical diagnosis.)
- **Location:** `tests/e2e/*.test.js` (matching the Unit/Integration naming).
- **Lifecycle:** [`tests/e2e/run_esr_tests.sh`](tests/e2e/run_esr_tests.sh) (name unchanged) launches Firefox with `--remote-debugging-port=9222` and `extensions.background.idle.timeout=10000` — a short idle timeout so the MV3 event page genuinely suspends and respawns during the suite (deliberate lifecycle stress; see `tests/e2e/event-page-lifecycle.test.ts`) — waits for the port, runs Vitest's e2e project, and cleans up via an EXIT trap. Tests connect using the `connectToFirefox()` helper in [`tests/e2e/_helpers.js`](tests/e2e/_helpers.js).
- **How to run:** Always use `pnpm test:e2e` (which calls `run_esr_tests.sh`). Do **not** run `npx vitest run --project e2e` directly — the shell script is responsible for launching Firefox with the BiDi debugging port, waiting for it to be ready, and cleaning up afterwards. Without it, tests will hang trying to connect to a non-existent browser. To run a single test file: `pnpm test:e2e tests/e2e/my-test.test.js`.
- **When to run:**
  1. Once at the end of every completed feature.
  2. Always as part of the "prepare for commit" workflow.
  3. **Never on every save during TDD.** Browser launches are too slow for the inner cycle.

#### What E2E must cover

The guiding principle: every feature a user could exercise from the new tab page should have at least one E2E test that proves the workflow works end-to-end in a real browser. E2E also covers **visual and layout correctness** — things no unit test or mock can verify.

Tests fall into four categories:

**1. Smoke — the extension loads and renders.**
The single most valuable E2E test is: install the extension, open `about:newtab`, and assert the page renders with **zero console errors**. Most regressions show up as console errors before they show up as broken UI. Also verify the HTML5 document parses cleanly (not a blank page) and the tile grid is visible with cells.

**2. Feature acceptance — happy-path workflows.**
Every user-facing feature should have at least one E2E test exercising the primary workflow: perform an action → observe the result → reload → confirm persistence. The *depth* of E2E coverage depends on the feature's importance:

- **Differentiating features** — the reasons NTT exists over native Firefox — get multiple E2E cases per feature, including edge cases and error states. These are the features where regressions hurt most.
- **Parity (match) features** — things native Firefox also does, which NTT must maintain — get a single happy-path smoke each. Don't try to match Firefox behaviour bug-for-bug; just prove the feature works.
- **Drop features** — legacy elements being removed — get no E2E. Delete tests when the feature leaves the codebase.

See [`ROADMAP.md`](ROADMAP.md) "Scope & North Star" for the differentiating-vs-parity framing that drives this E2E-depth split.

**3. Structural layout validation.**
The extension's visual identity is a core differentiator, but E2E focuses strictly on *structural and dimensional* correctness, leaving aesthetic judgments to UAT. E2E must verify layout math, not pixels:

- **Tiles fill the viewport.** Assert via JavaScript that grid calculations successfully allocate the available window area to the tiles (e.g., checking bounding client rects).
- **Layout settings have visible effect.** Changing margin, spacing, or columns must produce a measurable change in the DOM element dimensions and coordinates.
- **Responsive reflow.** Resizing the viewport should trigger reflow calculations that output proportionally correct DOM coordinate updates.

**Do not use screenshot pixel-diffing in E2E.** Pixel-matching is brittle and generates false failures on CI due to minor OS-level font or rendering differences. Defer semantic visual checks (contrast, occlusion, "looks right") to the UAT tier.

**4. Settings round-trip.**
Every preference the user can change via the settings panel must survive a full round-trip: set it → reload `about:newtab` → assert the value is restored. This catches storage bugs, serialization mismatches, and migration regressions that mocks cannot surface.

#### Hermetic E2E Fixtures

E2E test files **must not depend on state left behind by other test files**. Vitest orders tests by performance history locally but falls back to alphabetical order on CI (where history is absent). A test that passes only because a prior file pinned a tile or set a pref will fail when execution order changes.

**The rule:** every `describe` block must establish the state it needs in `beforeAll` and must not assume anything about existing tiles, prefs, or grid contents.

**Required pattern** — call `resetTestState` in `beforeAll`, after connecting:

```js
import {
  connectToFirefox,
  resetTestState,
  // ...other helpers
} from './_helpers.js';

beforeAll(async () => {
  browser = await connectToFirefox();
  await resetTestState(browser);   // wipe tiles + reset prefs in one page cycle
}, 60_000);
```

`resetTestState(browser)` opens a single temporary new tab page, clears all pinned tiles (`Tiles.getAllTiles()` → `Tiles.removeTile()` for each), resets every layout/feature pref to defaults (`rows: 3`, `columns: 3`, `locked: false`, `theme: 'light'`, etc.), and closes the page. Using one page for both operations avoids the rapid open/close/open cycle that can destabilise the BiDi connection.

The individual `clearPinnedTiles(browser)` and `resetPrefs(browser)` helpers still exist for cases where you only need one, but `resetTestState` is the recommended default.

All helpers live in [`tests/e2e/_helpers.js`](tests/e2e/_helpers.js).

**Selector hygiene:** never target tiles by grid position alone (e.g. "first `.newtab-cell`"). Use URL-specific lookups via `Grid.sites`:

```js
// Good — targets the exact tile this test created
const site = window.Grid.sites.find(s => s && s.url === myTestURL);
const pinBtn = site.node.querySelector('.newtab-control-pin');

// Bad — breaks when another test file's tile occupies position 0
document.querySelector('.newtab-site .newtab-control-pin');
```

**Cleanup is optional but encouraged.** If a test pins tiles with unique URLs (e.g. `https://my-feature-test.example.com/`), unpin them in the test's `finally` block. This is a courtesy to other test files, not a substitute for `clearPinnedTiles` — every file must still call `clearPinnedTiles` in its own `beforeAll`.

### UAT tests (`tests/uat/`) — see [`tests/uat/README.md`](tests/uat/README.md)

User Acceptance Testing tier driven by an LLM agent. Scenarios are written in plain English; an agent (Claude Code in headless mode) walks through each one, takes screenshots, and judges the rendered state against criteria stated in the scenario file. Produces a structured `report.json` + a `summary.md` + screenshot artifacts for human review. Catches the bug class that structural tests miss (occlusion, contrast, layering, "looks broken to a user").

- **Status:** built and runnable (`pnpm test:uat`, optionally with scenario slugs to run a subset). Scenarios are numbered by category — env/smoke `00-uat-init` / `01-default-ui`; tiles `10-tile-surface` / `11-action-buttons`; drawer `20-config` / `21-restore` / `22-advanced-tab` / `23-edit-mode-design`; design `30-typography` / `31-titlebar` / `32-high-contrast`. Tooling inventory + how to run in [`tests/uat/README.md`](tests/uat/README.md).
- **Architecture — long-lived browser daemon + thin MCP client.** `tests/uat/_tools/browser-daemon.mjs` holds one **Selenium + geckodriver + release-channel Firefox** session for the whole run (a different stack from E2E's `web-ext` + Puppeteer-BiDi, by design — both now target the same release-channel Firefox binary, but drive it differently): it pins the `moz-extension://` UUID, **seeds the environment** by real navigation (two passes over a merged US/global + Swiss URL set → `topSites`, accepting cookie banners; plus a top-article-per-news-site visit-then-close to seed the recently-closed row), installs the unsigned extension temporarily (`installAddon`, works on release) **after** the seed so the first render is a thumbnail-free new-user state, and serves an HTTP API on port 9876 (`$UAT_DAEMON_PORT`). `tests/uat/_tools/mcp-server.mjs` is a thin MCP server Claude spawns per scenario that forwards `browser_navigate/click/hover/evaluate/file_upload/take_screenshot/read_screenshot` to the daemon. The runner (`runner.mjs`) owns the daemon lifecycle and runs each scenario's `claude -p`.
- **Screenshots:** rendered at Full HD (100%), saved at full resolution by default (`$UAT_SHOT_SCALE`, default 1); `browser_take_screenshot` writes to disk and returns a path, `browser_read_screenshot` pulls one inline only when the agent must judge it. To reduce token cost, they can be downscaled (e.g. 0.5 → ~960px). Each run writes a flat, timestamped `artifacts/<YYYYMMDD-HHMMSS>/` dir; files lead with their capture/creation time so a filename sort is capture order.
- **Why not `@playwright/mcp` / `@playwright/cli`?** Playwright's Firefox-extension support is Chromium-only (loading a FF extension needs an unsupported `policies.json` hack into Playwright's *patched* build), so it can't load our extension into a real release Firefox; Selenium does it in one supported call.
- **Standard preamble + fixture:** every scenario starts by restoring `tests/uat/newtabtools_knowngood.zip` (a checked-in NTT backup) so findings reflect the code change, not profile drift. The restore flow is exercised on every run as a side effect — a broken restore fails UAT loudly.
- **When to run:** Pre-release only (e.g. before AMO submission). **Never on PR / commit / CI** — non-deterministic, costs subscription quota, judgment-based by design; it does not gate merges.
- **When to write a scenario:** Author a UAT scenario when a feature introduces new visual states (like dark mode, color pickers, or overlays) or complex visual interactions where structural DOM tests cannot prove the feature is aesthetically correct, accessible, or free of occlusion. If the feature is purely functional (e.g., a new keyboard shortcut), rely entirely on E2E.
- **Pass/fail vs. observations.** Each scenario's `report.json` has `assertions[]` (structural + visual, which decide pass/fail) and `observations[]` ("passed, but a human should know"). The runner gates its exit code on the report verdict — a failed assertion fails the run — and prints failed assertions + observations to the terminal so nothing stays buried. A human still reviews the summary + screenshots before releasing.

## TDD Workflow per Task

For every task (feature or bug fix):

1. Read the request. Restate it as a behaviour.
2. Pick the test tier where you can write a *meaningful failing test first*. This depends on whether the code already exists:
   - **For new code:** start with a Unit test for the smallest pure function that expresses the new behaviour. Watch it fail. Implement the function. When you wire it to the UI or a `browser.*` API, add an Integration test for that wiring.
   - **For legacy code** (e.g. anything in `newTab.js`, where logic, DOM, and APIs are mixed): **do not refactor as a prerequisite to testing.** Start with an Integration test that mocks `browser.*` at the API seam and pins down the function's *current* behaviour — a *characterization test* in Michael Feathers' sense. Watch it pass against today's code. Then write a failing test for the new behaviour or fix, implement it, and only refactor under green. Backfill Unit tests for any pure-logic helpers you extract during the refactor.
3. Run Unit + Integration (`pnpm test:fast`). Confirm green.
4. **Once the feature is complete:** run E2E (`pnpm test:e2e`). Confirm green.
5. Update [`CHANGELOG.md`](CHANGELOG.md) under `[Unreleased]` per global instructions.
6. Run `pre_commit_check.sh` and the prepare-for-commit workflow (which re-runs E2E).

**Naming for tracked issues:** When the change is tied to a numbered issue, the regression test file (or its `describe()` block) should reference the issue number — e.g. `tests/integration/issue-217-thumbnail-empty.test.js` or `describe('issue 217: thumbnail empty', ...)`. This keeps the suite traceable to bug history. Apply only when there is an issue number to reference.

## Static Checks (Run before every commit)
- **`web-ext lint`**: Run against `webextension/` to catch AMO-policy regressions.
- **ESLint**: Ensure `env: { webextensions: true }` is set in the config to support browser APIs.

## What NOT to do
- Do not write a test that passes against current code without first watching it fail (unless it is an explicit characterization test for legacy code).
- Do not refactor legacy files before characterization tests cover the methods you're touching.
- Do not import `browser.*` or `chrome.*` in `tests/unit/` — refactor to remove the dependency, or move the test to `tests/integration/`.
- Do not run E2E on every save during TDD. It only runs at feature completion and on prepare-for-commit.
- Do not assert on log output or DOM strings as a substitute for behaviour.
- Do not add E2E coverage for logic that a Unit or Integration test could cover.
- **Do not write pixel-perfect image comparison tests in E2E.** Delegate semantic visual judgments (contrast, occlusion, layering) to the UAT tier.
- Do not introduce a second test framework, second mocking library, or a Chromium target. Cross-browser support is tracked in [`ROADMAP.md`](ROADMAP.md); raise it as a question, do not silently add it.
- Do not skip tests, mark them pending, or weaken assertions to make a build pass. Never use `--no-verify`.
