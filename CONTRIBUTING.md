# Contributing to New Tab Tools

**Note on Project Status & Fork Intention:** This repository is a fork of the original New Tab Tools project, which is currently unmaintained. Our intention is to take over the development and maintenance of this extension. Under the terms of the original Mozilla Public License 2.0 (MPL-2.0), we have established a robust test automation infrastructure and are now moving into active development and refactoring.

---

## Filing Bug Reports

Help us help you! You can report bugs at [https://github.com/perdrizat/newtabtools/issues](https://github.com/perdrizat/newtabtools/issues). This guide shows you how to create a clear, actionable bug report (or "issue") so we can identify the problem and release a fix as quickly as possible. Please remember that the developers of New Tab Tools are human, with limited time and bills to pay.

### What to put in your bug report
* Did the problem start happening recently (e.g. after updating to a new version of New Tab Tools/Firefox) or was this always a problem?
* Which version of New Tab Tools are you using? You can get the exact version from the Firefox Add-On Manager.
* What's the name and version of the operating system you're using? What version of Firefox are you using? You can find this information by visiting `about:support` or clicking on Troubleshooting Information on the Help menu.
* Can you reliably reproduce the issue? If not, provide details about how often the problem happens and under which conditions it normally happens.
* Do you have another extension or theme installed that might cause the issue? (Because of the way New Tab Tools works, this can happen. *Classic Theme Restorer* and some themes are known to have caused problems.) Try disabling these other add-ons and see if the issue goes away.

---

## Translating

If you're comfortable working with Git, you can help translate NewTab PowerTools into your language!

1. **Test Locally:** Clone the repo to your machine. You can install it in Firefox temporarily by visiting `about:debugging` -> "This Firefox" -> "Load Temporary Add-on", and selecting any file inside the `webextension/` directory. This is the easiest way to test your translations live, and you can reload the extension as you go.
2. **Finding the Files:** Locales live in the `webextension/_locales/` directory. To start, copy the `en/messages.json` file into your language's directory (e.g., `de/messages.json` for German).
3. **Locating Strings:** The strings are organized logically. For example, `options_...` strings appear in the Settings drawer, while `tile_...` strings appear on individual grid tiles or in their edit menus.
4. **Simplifying Placeholders (Pro-tip):** When translating strings that contain variables, you don't need to copy the entire verbose `placeholders` object from the English file. You can reduce complicated blocks to just the message string using positional variables (`$1`). 
   For example, this:
   ```json
   "autosaved_relative_minutes": {
       "message": "$MINUTES$m ago",
       "placeholders": { "minutes": { "content": "$1" } }
   }
   ```
   Can be cleanly reduced in your translation file to just:
   ```json
   "autosaved_relative_minutes": {
       "message": "$1m ago"
   }
   ```
5. **Fallback Behavior:** If you want to keep the English version of a string, simply **remove that key from your file entirely**. Firefox will automatically fall back to the English string.

### Translation Utilities

We provide several CLI tools to make maintaining translations easy. You will need [Node.js and pnpm](TESTING.md#environment-setup) installed to run them:

- **Find Missing Keys:** Run `pnpm i18n:check <locale>` (e.g., `pnpm i18n:check de`). This compares your language file against the master English file and prints a list of any keys you haven't translated yet.
- **Find Dead Strings:** Run `pnpm i18n:stale <locale>`. This checks against the master English file to find old, unused translation keys that are no longer referenced.
- **Clean Up:** Run `pnpm i18n:purge <locale>` (e.g., `pnpm i18n:purge de`). This automatically deletes any known dead strings from your language's `messages.json` file, keeping it clean and lightweight.

If you have any questions, feel free to open an issue!

---

## Developer Guide

All development on this project is test-driven. Before writing any code, please ensure your environment is set up according to the **[Environment Setup](TESTING.md#environment-setup)** in the testing guide.

### Development Workflow

1.  **Setup:** Follow the guide in [`TESTING.md`](TESTING.md) to install Node.js and Firefox (release-channel, >= 152).
2.  **TDD:** We follow a strict red/green TDD workflow. Unit and Integration tests run on every save; E2E tests run at feature completion.
3.  **CLI:** See the **[CLI Reference](TESTING.md#cli-reference)** for the list of available commands (`pnpm dev`, `pnpm test:fast`, etc.). This project uses **pnpm** as the package manager (enforced by a `preinstall` guard so the `minimumReleaseAge` supply-chain rule in `pnpm-workspace.yaml` actually applies).

### Build

Currently, there is no build step (no compiler between source and runtime) for either MV3 target — `webextension/` runs as-is. You can run the Firefox build locally using Mozilla's `web-ext` tool.

```bash
# Run the extension locally
pnpm dev
```

`webextension/manifest.json` is a **generated** file (chrome-prep C6): it's
merged from `manifest/base.json` + `manifest/firefox.json` by
`scripts/build-manifest.mjs` and regenerated by `scripts/sync-version.mjs` —
never hand-edit it directly. See [`manifest/README.md`](manifest/README.md)
for the merge semantics and the Chrome overlay (validated, see
[`CHROME.md`](CHROME.md)).

### Deploy

The extension will eventually be deployed to Mozilla Add-ons (AMO).

```bash
# Build the .xpi artifact for upload (regenerates the manifest first)
pnpm build
```

`pnpm build` takes an optional target (`pnpm build firefox`, the default —
byte-identical to a plain `web-ext build --source-dir webextension/`; or
`pnpm build chrome` — the Chrome manifest overlay build, now fully validated:
Chrome E2E parity 126/126, Chrome UAT 11/11, and the 11-check smoke all pass
against it — see [`CHROME.md`](CHROME.md)). For manual "Load unpacked"
testing in any Chrome, `pnpm chrome:stage` produces an unpacked
`dist/chrome-dev/` directly (no CWS account needed).

### Releasing to AMO

The first Mozilla Add-ons (AMO) submission shipped as **2.5.0** (2026-07-15),
gated on the chrome-prep program's completion. The next AMO release is
**3.0.0**, shipped simultaneously to the Chrome Web Store at the
[`CHROME.md`](CHROME.md) program's D gate (Decision 7) — not a separate
AMO-only release. Notes for whoever runs the 3.0.0 resubmission:

- **Screenshots:** the marketing screenshots checklist and captions live in
  [`docs/amo-listing.md`](docs/amo-listing.md) ("Screenshots checklist").
  They're captured from a clean profile loaded with
  `tests/uat/newtabtools_knowngood.zip` — the UAT browser daemon already
  renders that fixture at Full HD and can reproduce them
  (`node scripts/amo-screenshots.mjs`).
- **New listing, not an ID transfer:** the add-on ships under a fresh
  `newtabtools@symlink.ch` ID rather than taking over the original listing's
  ID. Why: an ID transfer inherits every existing user's IndexedDB + prefs
  as-is — possibly stale or tampered after years of an unmaintained listing.
  A clean listing avoids inheriting that state.
- **Listing state:** the AMO listing copy ([`docs/amo-listing.md`](docs/amo-listing.md)),
  [`PRIVACY.md`](PRIVACY.md), `LICENSE`, and the reviewer notes
  ([`docs/amo-submission-notes.md`](docs/amo-submission-notes.md)) are all
  already in place — paste the reviewer notes into the AMO Developer Hub's
  reviewer-notes field at submission time.

### Architecture

- **Target:** Firefox-first (Manifest V3, `strict_min_version` 152.0). The Chrome port (stage 3) is functionally complete — Chrome E2E suite parity (126/126), Chrome UAT (11/11), and the 11-check smoke are all green (`minimum_chrome_version` 148) — with only store release prep (D7) left; [`CHROME.md`](CHROME.md) is the program plan and live status board; ships as 3.0.0 to both stores.
- **Core:** The New Tab page is an HTML5 document (`webextension/newTab.html`) registered via `chrome_url_overrides.newtab` (converted from XHTML in the 2026-07 modernization arc; records in git history and `audit/`), loaded through a single `<script type="module" src="page-main.js">` entry. Post-chrome-prep, the page is ~20 feature modules with no `globalThis` bridges anywhere — every cross-reference is a real `import`/`export`, including the E2E/UAT test harness (chrome-prep C3d):
  - **Boot/controller:** `newTab.js` (the residual controller: startup, event-listener wiring, `updateUI` dispatch, tile-tab editing, drawer/context-menu chrome) + `page-main.js` (the single orchestrator: side-effect imports in load order, then boot calls plus the `Prefs.onChange` page listener).
  - **Grid/site/cell/page:** `grid.js`/`site.js`/`cell.js`/`page.js` — the former `fx-newTab.js` monolith, split in chrome-prep C4c. `newTab.js` and `grid.js`/`page.js` form a legal call-time-only ESM cycle (no top-level cross-module calls — enforced by `tests/integration/page-module-scope.test.ts`).
  - **Drag-drop/transformation/updater/undo-dialog:** `drag-drop.js`, `transformation.js`, `updater.js`, `undo-dialog.js` — separable singletons carved out of `fx-newTab.js` in chrome-prep C4a/C4b.
  - **Theme/wallpaper/titlebar/autosave-indicator/filters-ui:** `theme.js`, `wallpaper.js`, `titlebar.js`, `autosave-indicator.js`, `filters-ui.js` — leaf modules carved out of `newTab.js` in chrome-prep C4d, wired through the shared `ui-refs.js` refs object (one-way: leaves never call back into `newTab.js`/`updateUI`).
  - **Leaves:** `common.js`, `prefs.js`, `icons.js`, `stats.js`, `tiles-shim.js`, `dom.js` (the `el()` DOM-builder, chrome-prep C2), `api.js` (the page-side capability seam, see below), `ui-refs.js`, `object-urls.js`. Plus `awesomebar.js` (the awesome bar widget, page-modules P4) and `action.js` (the toolbar-button popup, its own small entry).
- **The `api` capability seam (chrome-prep C5):** both scopes export an `api` namespace — `webextension/api.js` on the page side, `webextension/lib/platform.js` on the background side — a live-resolving `Proxy` over `globalThis.browser ?? chrome` (not a frozen `const`, so per-test global reassignment still works; in-house, no `webextension-polyfill` dependency per the zero-runtime-deps decision). Every raw `browser.*`/`chrome.*` call site routes through `api.*`. Six targeted wrappers cover the capabilities that genuinely diverge between Firefox and Chrome (audit: `audit/2026-07-11-chrome-api-divergence.md`): `storage.session` access (`sessionGet`/`sessionSet`), capture-availability (`isCaptureAvailableViaPermission`, wired via `isCaptureAvailableForScope` at `lib/capture.js`'s `captureTab` — CHROME.md D3), the action/theme-icon sync (`syncActionIconWithTheme` — wired for real as of CHROME.md D4, no-op on Firefox where manifest `theme_icons` already handles it declaratively, live on a Chrome service worker via the page's `Theme.colorScheme` relay), the search-shape wrapper (`searchWeb`), a `menus`-presence gate (Chrome ships no context-menu capability at all — Decision of record below), and a shared `getBrowserInfo` short-circuit (`topSitesOptions`). Firefox behavior is unchanged by any of this; every wrapper's Chrome path is exercised by the Chrome E2E parity and UAT tiers against the real `manifest/chrome.json`, not left dormant.
- **Manifest authoring:** `webextension/manifest.json` is **generated**, not hand-edited — see the Build section above and [`manifest/README.md`](manifest/README.md) for the merge semantics and the (validated) Chrome overlay.
- **Background Scripts:** A non-persistent **event page** (`background: {"scripts": ["lib/background-main.js"], "type": "module"}`, no service worker — full DOM/`window`/canvas/IndexedDB access), using promise-based `browser.*` throughout, routed through the `api` seam above. `lib/background-main.js` is the single ES-module entry: it named-imports `common.js`/`prefs.js` (real `export`s, no bridge) and registers every listener directly (message dispatch via `lib/messages.js`, webRequest/webNavigation/tabs/menus/idle). The rest of the background is real ES modules under `webextension/lib/`: `lib/messages.js` (the `runtime.onMessage` dispatch table), `lib/platform.js` (the background half of the `api` seam, and the file that branches per-platform capability logic for Chrome — see above), `lib/db.js` (IndexedDB), `lib/tiles-store.js` (the Tiles/Background models), `lib/capture.js` + `lib/thumbnail-image.js` (the auto-thumbnail pipeline — `thumbnail-image.js` is the one file in `lib/` allowed to touch DOM/canvas, guarded by an ESLint rule elsewhere in `lib/**`), and `lib/backup.js` (export/import). The event page suspends after ~30s idle and respawns on events; the respawn-hygiene rules (duplicate-tolerant menus, IDB reconnect via `withStore`, `pendingCaptures` in `storage.session`, once-per-session action sweep) are enforced by `tests/integration/event-page-resilience.test.ts` / `db-wake-race.test.ts` and the `tests/e2e/event-page-lifecycle.test.ts` suspension tests; the arcs that established them are recorded in git history and `audit/`.

### Patterns & Conventions

- **Red/Green TDD is mandatory:** Write failing tests first. See [`TESTING.md`](TESTING.md) for the tier-by-tier strategy.
- **Language:** Production code is JavaScript with JSDoc-based type annotations; tests are TypeScript. Both are checked by `tsc --noEmit` (`allowJs: true`, `checkJs: true`). The extension has **no build step** — `web-ext run` and the E2E lifecycle consume `webextension/` directly. Full TypeScript would put a compiler between source and runtime that a single maintainer absorbs forever; JSDoc + `checkJs` gets most of the safety benefit at zero build cost, and TS reads JSDoc so a `.ts` test importing a `lib/*.js` module sees its declared signatures.

#### Rules for new code

- **Production files in `webextension/`:** stay `.js`. Add JSDoc types to function signatures, exported objects, and `browser.*` callback parameters. `checkJs: true` checks every `.js` by default — no per-file `// @ts-check` needed.
- **Test files in `tests/`:** all `.ts`. New tests must be TypeScript too.
- **WebExtension API types** come from `@types/firefox-webext-browser`. (`@types/chrome` joins it if/when Chrome support arrives.)
- **Modules:** `webextension/lib/` is the module home for background-only logic (`lib/background-main.js` + the files it imports). The page is fully modular too — a single `page-main.js` entry, no classic `<script>`-loaded exception remains — so all ~20 page feature modules (see the Architecture section above for the grouping) use `import`/`export` directly, same as `lib/`. Every `globalThis` bridge assignment — including the TEST-ONLY E2E/UAT survivors — was retired in chrome-prep C3d: every cross-reference, production and test, goes through a real `import` now (zero matches for `globalThis\.\w+\s*=` under `webextension/`).
- **Don't introduce a build step.** If a feature seems to need TS-only ergonomics JSDoc can't express, simplify the design rather than adding a compiler.
- **Don't suppress type errors** with `// @ts-ignore`. Fix the underlying JSDoc, or use `// @ts-expect-error` + a one-line reason (it preserves the signal once the issue is fixed).
- **Don't add `.ts` files under `webextension/`.** The escape hatch (renaming `.js`→`.ts` later) is preserved by not using it now.

MV3 has landed on both targets; **Chrome** (stage 3) is functionally complete pending store release (D7) — see [`CHROME.md`](CHROME.md) for the status board. New code should still avoid assumptions that would break under a Chrome service worker (no persistent background-scope DOM state, no dynamic `import()`) and avoid widening `host_permissions` beyond the current `<all_urls>` grant; route any platform divergence through the `api` seam rather than an ad-hoc `chrome.*` branch.

### After Finishing Feature Work

- **Always run E2E tests** with `pnpm test:e2e`. This is mandatory after any feature work, bug fix, or refactor that touches the extension's runtime code or UI. The script (`run_esr_tests.sh`, name unchanged) handles the full Firefox lifecycle (launch, port wait, test run, cleanup) automatically — release-channel Firefox by default (no Firefox ESR ≥152 exists yet; `$FIREFOX_ESR_BIN` still overrides the binary).
- **Never run `npx vitest run --project e2e` directly** — `run_esr_tests.sh` is responsible for launching Firefox with the BiDi debugging port. Without it, all E2E tests will time out. See [`TESTING.md`](TESTING.md) and [`tests/e2e/README.md`](tests/e2e/README.md) for the full lifecycle and architecture.
- **Chrome-affecting changes** (the `api` seam, `manifest/chrome.json`, anything reachable from a service worker) also run `pnpm chrome:smoke` (fast, 11 checks) or `pnpm test:e2e:chrome` (full parity suite) — see [`TESTING.md`](TESTING.md#e2e-tests-testse2e).

### Running test tiers in parallel

The tiers are port- and artifact-disjoint by design, so they can run concurrently without racing on ports or files. **How many you actually overlap is gated by CPU, not correctness** — the E2E pair parallelizes cheaply (browser automation only); the UAT pair is heavy (each tier spawns a CPU-hungry seeding phase plus per-scenario Claude Code agents). Practical guidance (maintainer practice, 2026-07-16):

- **The two E2E tiers run in parallel freely.** **Firefox E2E** (`pnpm test:e2e`, port 9222, artifacts → `tests/e2e/_artifacts-ff/`) and **Chrome E2E** (`pnpm test:e2e:chrome`, port 9223, artifacts → `tests/e2e/_artifacts-cft/`) run the *same* test files on different browsers. Each launches its own browser + profile and writes to its own per-browser artifacts dir, so the fixtures/screenshots the tests write never race. (Before the per-browser split, a concurrent run's fixture cleanup deleted the other's `test-thumb.png` mid-test → `NS_ERROR_FILE_NOT_FOUND`; the four hand-built fixture paths now route through `_helpers.ts`'s browser-scoped `ARTIFACTS_DIR`, and each run script wipes only its own dir.)
- **Run the two UAT tiers one at a time on a constrained box.** **Firefox UAT** (port 9876, `$UAT_DAEMON_PORT`) and **Chrome UAT** (`UAT_BROWSER=chrome`, port 9877) are port- and artifact-disjoint (per-run timestamped dirs with a `-ff` / `-cft` suffix matching the E2E dirs — see [`tests/e2e-chrome/README.md`](tests/e2e-chrome/README.md) "Port allocation"), so co-running is *safe*, but each daemon's environment-seeding phase (19 sites × 2 passes) is CPU-hungry and Firefox UAT's daemon-health timeout is only 300s (Chrome's is 600s). On a CPU-constrained machine the two seeding phases starve each other and Firefox UAT times out before it seeds — run them sequentially there, and only overlap them if you have plenty of cores.
- Parallel means **across tiers, not within one**: a second concurrent `pnpm test:e2e` (or `test:e2e:chrome`) is refused by the runner lock (`tests/e2e/.runner-lock`, and the Chrome tier's own independent lock), and one UAT daemon owns its port for the whole run.
- **Don't overlap the two Chrome *build*-staging tools:** `pnpm chrome:smoke` and `pnpm test:e2e:chrome` both stage the unpacked build to `dist/chrome-dev/`, so running them at the same time races on that dir — the smoke is a solo pre-check anyway.
- **Timing caveat:** `tests/e2e/boot-timing.test.ts` asserts boot-latency medians, and the UAT daemon's environment-seeding phase is CPU-hungry. If a timing assertion fails during a parallel run, re-run that one file solo before treating it as a regression — everything else in both suites uses bounded polls and is contention-tolerant.

### Before Committing

- **Run `pnpm test`** (which runs both `test:fast` and `test:e2e`). Fast tests alone are not sufficient — E2E tests catch rendering bugs that unit/integration tests cannot. If E2E tests were already run as part of finishing the current feature and no files changed since, this step can be skipped. **Do not skip E2E tests because you assume the environment is unavailable — run the command and let it fail or succeed.**
- **If the change touches a Chrome-relevant path**, also run `pnpm chrome:smoke` (fast) or `pnpm test:e2e:chrome` (full parity suite) before committing — same rule as the Firefox E2E gate above.
- **For user-visible UI changes, run the UAT tier** with `pnpm test:uat` and review the run's `summary.md` + screenshots before requesting review. UAT is pre-release / local-only (it spends Claude Code subscription tokens and never runs in CI) — it catches the "looks broken to a user" bug class deterministic tests miss. See [`TESTING.md`](TESTING.md#uat-tests-testsuat--see-uat_planmd) and [`tests/uat/README.md`](tests/uat/README.md).
- If your new tests use `fs.readFileSync` on files under `webextension/`, the ESLint rule `ntt/no-source-grep` will flag it — add a disable comment with justification if the check is purely structural. The justification must say *why a behavioral test isn't possible*, and a source-string match may never be the sole coverage for a functional behavior — see [`TESTING.md`](TESTING.md#test-design-principles).
- **Daily patch bump.** The patch version bumps **once per day, on that day's first commit**: run `pnpm version patch`. It bumps `version` in `package.json` and makes a `vX.Y.Z` commit + tag; the next `pnpm build` mirrors the version into `manifest.json` via `scripts/sync-version.mjs` (so you never hand-edit the manifest version). `package.json` is the single source of truth. Run it on a clean tree — commit your in-progress work first, then bump. Later commits the same day reuse that day's version (no further bump until tomorrow).
- Update `CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/) format. **Keep entries to one line each** — concise like git commit messages, not paragraphs. Accumulate entries under `[Unreleased]` as you work; when you do the day's first commit + bump, **promote `[Unreleased]` into a version-led, dated section headed `## [X.Y.Z] — YYYY-MM-DD`** — where `X.Y.Z` is the version you just bumped to and the date is today. Same-day commits append to that one section (one heading per date — never add a second heading for a date that already exists, and don't re-add `[Unreleased]` until the next day's work).
- **Run `pnpm audit --audit-level=high` before every commit** — not only when you touch `package.json`/`pnpm-lock.yaml`. It is the *first* gate CI runs on every push (before lint/tests) and fails the build on any high/critical advisory. Crucially, advisories surface against **existing, unchanged** dependencies as they are newly disclosed, so a clean diff is no guarantee your push will pass — a dep that was fine yesterday can fail CI today. When it flags a *transitive* dep, pin a patched version with an `overrides` entry in `pnpm-workspace.yaml` (exact version, no `^`/`~`, per the supply-chain guardrails above), then `pnpm install` and re-audit. Mirror CI exactly with the `--audit-level=high` flag.

### Keeping dependencies current

Every dependency is **exact-pinned** (no `^`/`~`) with a tracked `pnpm-lock.yaml`, so nothing updates on its own — `pnpm update` is a no-op and `pnpm install` only ever reproduces the lock. That is deliberate: reproducible installs plus a human review checkpoint on every supply-chain change. The cost is that staying current is a manual, periodic chore. Treat it as **two separate concerns**:

- **Security (automated, reactive).** `pnpm audit --audit-level=high` runs first in CI on every push and is now a pre-commit step (above). It catches *disclosed* high/critical advisories with no effort on your part. Two limits: it only fires once an advisory is published (a latent vuln in a pinned version can sit for years, then fail CI the day it's indexed), and the `high` gate hides medium/low — run bare `pnpm audit` occasionally to see those. The proactive complement is `pnpm-workspace.yaml`'s `minimumReleaseAge: 10080` (7-day cooldown — the value is in **minutes**, and is enforced only by pnpm 11+; under the former pnpm 10.0.0 pin it was silently inert), which blocks freshly-published — possibly compromised — versions.
- **Staleness (manual, periodic).** Nothing automates this. Run `pnpm outdated` on a cadence — **monthly or quarterly** is plenty for this dev-only set. To bump one: edit the exact version in `package.json` → `pnpm install` → diff the lockfile and skim the changelog/`postinstall` (per the supply-chain guardrails below) → run the full gate (`pnpm lint && pnpm typecheck && pnpm lint:webext && pnpm test:fast`) → commit.

**Why the stakes are low:** the package has **no runtime dependencies** (no `dependencies` key; the shipped extension vendors its own `zip.js`). Every dep is dev-tooling, so an advisory or a stale version can at worst affect the build/test machine — it cannot reach a user's browser. `pnpm audit` here protects your dev environment and guards against supply-chain tampering, not shipped code.

**Dependabot is configured ([`.github/dependabot.yml`](.github/dependabot.yml)) for security only.** Version-bump PRs are suppressed (`open-pull-requests-limit: 0`) so they don't fight the hard-pin policy; security-fix PRs are grouped. This requires the repo toggle — **Settings → Code security → enable "Dependabot alerts" and "Dependabot security updates"** — which is what actually turns the feature on (a committed file can't). It closes the one gap in `pnpm audit`: advisories disclosed *between* your pushes still notify you. Note Dependabot can only auto-fix a *direct* dep; a transitive advisory (like the `shell-quote`/`undici`/`hono` precedents) it can only **alert** on — you still apply the `pnpm-workspace.yaml` `overrides` fix by hand.

### Security-boundary changes require explicit acknowledgement

The following classes of change loosen a security boundary and **must** be called out in either an `audit/` doc or the PR/commit description before merging:

- **CSP changes** in `webextension/manifest.json` — any directive widening, including adding wildcards like `https:` or `*` to `connect-src`, `img-src`, `style-src`, etc.
- **New required permissions** in `webextension/manifest.json` (`permissions` array) or a widened **`host_permissions`** array (MV3 splits host-match patterns like `<all_urls>` out of `permissions`). Optional permissions are fine; promoting optional → required is a boundary change. Note `host_permissions` is user-revocable at runtime (Firefox shows it in the install prompt) — code that depends on it must degrade gracefully, not throw, when revoked.
- **Allow-list additions** in `webextension/lib/backup.js` (the restore allow-list grows).
- **Removing URL/protocol validation** anywhere (`isValidURL`, the `safeProtocols` allow-list in `lib/backup.js`, the `safeHexColor` / `safeBackgroundUrl` regexes, etc.).
- **Adding `style.X = template + userInput + template`** patterns where the template includes CSS that consumes URLs (`url(...)`, `background`, `background-image`, etc.). Always prefer `style.setProperty('--var', validatedValue)` over interpolating into a shorthand.

For each, the commit message or PR description must state: (a) what boundary moved, (b) why the previous boundary was inadequate, (c) the new threat model, (d) what compensating control (if any) replaces the removed defence-in-depth. The test suite cannot detect a *widened* CSP (it permits more, not less), so this is a human-review gate.

Precedent: the 2026-05-04 audit's tightened CSP was silently widened to `connect-src https:` in a Phase 3/4 feature commit and only caught in the 2026-05-31 review (then reverted — see [`audit/2026-05-31-csp-tightening.md`](audit/2026-05-31-csp-tightening.md)). The checklist above would have caught it at commit time.

### AI Coding Assistants

Contributions generated with the help of AI are welcome but must follow the standard development process. The test harness with unit tests and E2E tests MUST be used extensively to validate AI generated code. These are the important guardrails to ensure agentic compliance with the project's code quality standards.

- **Human Accountability:** The human submitter is responsible for reviewing all AI-generated code, ensuring license compliance, and taking full responsibility for the contribution. AI agents MUST NOT add `Signed-off-by` tags.
- **Attribution:** Mentioning AI assistance in commit messages is optional.
- **Supply-chain guardrails:** When AI-assisted contributions touch `package.json`, `pnpm-lock.yaml`, or build/test scripts, the human submitter is specifically responsible for: pinned versions on new deps (no `^` / `~`); diffing the lockfile to spot unexpected new transitive deps and source-URL changes on existing ones; reading any `postinstall` scripts before installing; cross-checking new dep names against npm registry stats (download volume, last publish date, listed maintainers) to catch typo-squats. The `minimumReleaseAge: 10080` (7 days, in minutes) setting in `pnpm-workspace.yaml` — enforced by pnpm 11+ because the project pins pnpm via `packageManager` and rejects npm/yarn in `scripts/check-pnpm.js` — is the floor, not a substitute for review.

### Decisions of record

The load-bearing "why" behind rules that constrain new code, kept terse so nobody re-derives (or accidentally re-opens) a rejected alternative. Detail on several of these lives inline above; this is the compact index.

- **The 20 `runtime.onMessage` wire names are frozen.** Internals may rename; the wire strings never do — enforced by `tests/integration/message-contract.test.ts`. The frozen-names decision forbids renames/drops, not deliberate additions: `Theme.colorScheme` was added 2026-07-16 (CHROME.md D4) to relay the page's `prefers-color-scheme` reading to the background for the Chrome action-icon sync (a Chrome MV3 service worker has no `window`/`matchMedia` to read it itself).
- **Zero runtime dependencies; `idb` rejected, IndexedDB wrapper stays hand-rolled.** The shipped extension has no `dependencies` key at all (it vendors its own `zip.js`); `lib/db.js`'s `withStore` is ~50 lines and the reconnect semantics are ours either way.
- **Minimum Firefox 152.0.** Empirically bisected: Firefox exposes `tabs.captureVisibleTab`/`captureTab` to MV3 extensions only from 152.0. Consequence: the E2E/UAT tiers run on release-channel Firefox, not ESR, until a 152-based ESR ships.
- **No build step.** JS + JSDoc, checked by `tsc --noEmit`, gets most of TypeScript's safety at zero compiler cost — see "Language" above.
- **Event-page state placement.** `captureSessions`/`networkIdleWatchers` stay in-memory (short-lived, event-anchored, self-healing on loss); `pendingCaptures` lives in `storage.session` (must survive an event-page respawn while waiting on tab activation).
- **Chrome via single-source / dual-build, not parallel branches.** A long-lived Chrome branch carries permanent merge cost; the manifest-overlay approach (see Architecture above) keeps one source tree.
- **Chrome ships WITHOUT dynamic context menus.** The in-tile action row (edit / never-capture / pin / remove) carries the identical operations; Firefox's `menus.onShown`-based per-tile menu is progressive enhancement. The `menus` capability is optional-by-design — registered only when the platform provides it, and no page/background logic may assume it exists. Rejected: a degraded static Chrome menu (two UX surfaces for zero added capability). (chrome-prep Decision 1)
- **Theme source: `prefers-color-scheme` is the base on both platforms; `browser.theme` is a Firefox-only bonus** layered on top when present. No code may assume `browser.theme` exists. (chrome-prep Decision 2)
- **The restore validators stay independent.** `lib/backup.js`'s `safeHexColor`/`safeBackgroundUrl`/`safeProtocols` allow-list is the restore security boundary and is deliberately NOT deduplicated against other validation code elsewhere — defence-in-depth by design; see "Security-boundary changes" above.
- **Language: JS + JSDoc on production, TypeScript on tests, no build step.** Re-escalatable to full TS later (a JSDoc `.js` is a rename away) — see "Language" above for the full rationale.

### Where things live

- **Work** (features, bugs, backlog) → GitHub issues.
- **Decisions** (why something is built the way it is) → this file.
- **History** (what shipped and when) → `CHANGELOG.md` + `audit/` + `git log`.

### Key Files

- [`webextension/manifest.json`](webextension/manifest.json): The core extension manifest (MV3). **Generated** — see [`manifest/README.md`](manifest/README.md); edit `manifest/base.json`/`manifest/firefox.json` instead.
- [`webextension/newTab.html`](webextension/newTab.html): The markup for the new tab page UI.
- [`webextension/newTab.js`](webextension/newTab.js): The residual page controller (boot, event-listener wiring, `updateUI` dispatch) — see Architecture above for the full module breakdown.
- [`webextension/api.js`](webextension/api.js): The page-side half of the `api` capability seam (menus/theme/search wrappers) — see Architecture above.
- [`webextension/lib/background-main.js`](webextension/lib/background-main.js): The background's single ES-module entry point — every listener registration lives here (message dispatch registration, webRequest/webNavigation/tabs/menus/idle).
- [`webextension/lib/messages.js`](webextension/lib/messages.js): The `runtime.onMessage` dispatch table (the 20 frozen wire names — enforced by `tests/integration/message-contract.test.ts`).
- [`webextension/lib/platform.js`](webextension/lib/platform.js): The background-side half of the `api` capability seam — the file that branches per-platform capability logic for Chrome (see Architecture above).
- [`manifest/README.md`](manifest/README.md): The two-target manifest merge semantics (`base.json` + `firefox.json`/`chrome.json`).
- [`CHROME.md`](CHROME.md): The Chrome-port program plan and live status board (stage 3) — E2E parity, UAT, and smoke all green; store release prep (D7) is what's left.
- [`README.md`](README.md): Project overview, features, Scope section, quick start.
- [`TESTING.md`](TESTING.md): The canonical guide for testing and workflow rules.
