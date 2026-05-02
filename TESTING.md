# Testing Approach (Agent Guide)

This is the canonical testing guide for this repository. Any coding agent (Claude Code, Antigravity, Codex, Gemini, etc.) working on this codebase MUST read this document before writing code. It describes the **steady state** — how testing works once the project is set up.

> [!NOTE]
> The repository is currently in a bootstrapping phase. For instructions on the initial test environment setup, refer to `BOOTSTRAP.md` (which should be deleted once bootstrapping is complete). Once bootstrap is done, this document is the only testing guide.

## Scope and Ground Rules

- **Firefox-first, Firefox-only:** This extension targets Firefox via `applications.gecko` in `manifest.json`, runs on **Manifest V2**, and has a minimum version pinned to the **latest ESR**. Do not introduce Chromium-only assumptions or MV3 constructs (`background.service_worker`, `action` replacing `browser_action`, `host_permissions` split out from `permissions`, `declarativeNetRequest`). MV3 migration is a project-shaped decision tracked in `ROADMAP.md`, not a side effect of bug fixes.
- **Vanilla JavaScript, not TypeScript:** Tests stay in vanilla JS to match production code. Adopting TS is a separate decision, deferred for now.
- **Red/green TDD is mandatory:** Write a failing test first, watch it fail for the right reason, and write the minimum code to make it pass.
- **TDD applies to the Fast Loop only:** End-to-End (E2E) testing sits outside the tight TDD loop.
- **Never skip or weaken tests:** Fix them or delete them with justification in the commit message. Never use `--no-verify`.

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

## The Testing Strategy

Testing is divided into two primary phases: the **Fast TDD Loop** and the **E2E Validation Suite**.

### Phase 1: The Fast TDD Loop (Vitest + JSDOM)

This phase runs in milliseconds and is used constantly during active development. It consists of two categories, strictly separated by directory to enforce boundaries:

#### Category 1: Pure-Logic Tests (`tests/unit/`)
For logic that does NOT touch the browser: tile math, serialization, URL validation, color parsing.
- **Rule:** Modules tested here **cannot import `browser.*` or `chrome.*`**. If they do, extract the pure logic into a separate module first.
- **Layout:** Mirror the source path — e.g. `webextension/lib/colour.js` is tested by `tests/unit/lib/colour.test.js`.
- **Speed budget:** Tests run in milliseconds. >50 ms per test is a smell (real I/O, real timers, missed mock).
- **No real I/O:** No network, no filesystem, no real timers. Use `vi.useFakeTimers()` when time matters.

#### Category 2: API Contract Tests (`tests/integration/`)
For code that orchestrates WebExtension APIs.
- **Mocking library:** `jest-webextension-mock` (the project standard — do not introduce a second one).
- **Layout:** Mirror the source path — e.g. `webextension/background.js` is tested by `tests/integration/background.test.js`.
- **What to assert:** the right API was called with the right arguments; handlers react correctly to stubbed returns including rejection / empty / undefined cases; listeners register exactly once and unregister cleanly when expected.
- **What NOT to assert:** that Firefox's implementation of a `browser.*` API actually does what the docs say. Trust the platform — that's E2E's job.
- **Mock-vs-real drift:** If `jest-webextension-mock`'s behavior diverges from actual Firefox ESR, **trust the mock during Phase 1 to keep the loop fast** and rely on Phase 2 (E2E) to catch the divergence. If a specific drift bites, stub the correct behavior locally in the test rather than spiraling on upstream mock fixes.

### Phase 2: End-to-End Validation (Playwright)

For seams a unit/mock test cannot cover: extension actually loads, prefs persist across reloads, XHTML namespace renders correctly.

- **Tool:** Playwright testing against Firefox ESR (loading the unpacked extension).
- **Location:** `tests/e2e/*.spec.js`.
- **When to Run:** 
  1. Once at the end of every completed feature.
  2. Always as part of the "prepare for commit" workflow.
  3. **Never inside the inner TDD loop.** Browser launches are too slow for agents.

**Durable E2E Categories:**
The E2E suite should broadly cover: smoke loading with zero console errors, pin/unpin/block flows, ensuring all prefs round-trip correctly, page-level customizations (backgrounds/themes), import/export flows, and context menu actions. Specific test details and descriptions live within the spec files themselves, not in this document.

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
4. Run the full Phase 1 suite. Confirm green.
5. **Once the feature is complete:** run the full Phase 2 (E2E) suite. Confirm green.
6. Update `CHANGELOG.md` under `[Unreleased]` per global instructions.
7. Run `pre_commit_check.sh` and the prepare-for-commit workflow (which re-runs E2E).

## Static Checks (Run before every commit)
- **`web-ext lint`**: Run against `webextension/` to catch AMO-policy regressions.
- **ESLint**: Augmented with `eslint-plugin-webextensions` to flag wrong-namespace usage.

## What NOT to do
- Do not write a test that passes against current code without first watching it fail (unless it is an explicit Mode B characterization test).
- Do not refactor legacy files before characterization tests cover the methods you're touching.
- Do not import `browser.*` or `chrome.*` in `tests/unit/` — refactor to remove the dependency, or move the test to `tests/integration/`.
- Do not run E2E inside the inner TDD loop. Phase 2 only runs at feature completion and on prepare-for-commit.
- Do not assert on log output or DOM strings as a substitute for behavior.
- Do not add E2E coverage for logic that a Pure-Logic or API Contract test could cover.
- Do not introduce a second test framework, second mocking library, or a Chromium target. Cross-browser support is tracked in `ROADMAP.md`; raise it as a question, do not silently add it.
- Do not skip tests, mark them pending, or weaken assertions to make a build pass. Never use `--no-verify`.
