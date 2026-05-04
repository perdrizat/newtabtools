# Roadmap

This file logs decisions about future direction — both decisions taken and decisions deliberately deferred — with enough context for a future maintainer to pick them up later without having to re-derive the reasoning. Each entry carries a **Status** field: **Chosen**, **Deferred**, or **Superseded**.

It is not a task list and not a release plan. Entries are dated; outdated ones should be removed or updated, not left to rot.

---

## Codebase strategy: cherry-pick + reference rewrite

**Status:** Chosen. Decided 2026-05-03.

**Decision:** Take option 2 from [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md). Use Mozilla's Activity Stream as a *visual and behavioural reference* (license-compatible — both MPL-2.0). Reimplement the parity features cleanly in WebExtension scope, port the salvageable parts of NTT for the gap features, drop the rest.

### Why this option

The two alternatives have specific failure modes that this one avoids:

- **Modernize as-is** would lock NTT into maintaining ~600 lines of code that now duplicate native Firefox (per-tile image upload, drag-reorder, custom title, custom URL — all native since Firefox 134). Forever-maintenance on dead-equivalent functionality.
- **Lean rewrite** would push the first user-visible release months further out and risks losing edge-case behaviour the original NTT got right. Too long without a shipping artefact.

Cherry-pick + reference rewrite preserves the parts of NTT that solve real problems (the auto-thumbnail pipeline, the per-domain filter, the export format), discards the parts Firefox now handles, and keeps the codebase small enough for a single maintainer.

### What it means in practice

- **Strangler-fig migration**, not a big-bang rewrite. The existing extension keeps running. Features get replaced one at a time. Each replacement ships incrementally — no long-lived rewrite branch.
- **New code lives under `webextension/lib/`** as ES modules, with Unit tests in `tests/unit/`. The legacy `webextension/*.js` files shrink as features move out.
- **The migration ledger lives in [`MIGRATION.md`](MIGRATION.md).** Every feature in [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md) has a row with current state, strategy, and test status. That doc is the working document; this one is the why.

### Sequencing relative to Chrome / MV3

The cherry-pick + reference rewrite is **stage 1**. Once it's substantially complete and shipped, stage 2 is the Firefox MV3 port; stage 3 is adding Chrome as a second build target. See "Chrome support / MV3 migration" below for the gate that triggers stages 2 and 3.

During stage 1, write code that won't fight MV3 later: promise-based `browser.*` only (no callback mixing), no DOM dependencies in background-scope code, Firefox-only APIs isolated behind a thin capability layer (e.g. `webextension/lib/platform.js`), avoid `<all_urls>` if a narrower permission set works.

---

## Language: JavaScript with JSDoc on production, TypeScript on tests

**Status:** Chosen. Decided 2026-05-04.

**Decision:** Production code stays JavaScript with JSDoc-based type annotations, checked by `tsc --noEmit`. Test code uses TypeScript. There is no build step for the extension itself.

### Why this option

Three options were on the table:

1. **Plain JavaScript everywhere** (status quo). Forfeits the type-safety win. Particularly painful during the test-first Phase 1 of the cherry-pick rewrite — a lot of test code is being written, and it's the area where AI-assisted contributions benefit most from type checking.
2. **JSDoc + `checkJs` on production, TypeScript on tests.** ← chosen.
3. **Full TypeScript everywhere.** Highest type-safety ceiling but introduces a build step (TS-to-JS compilation, plus `web-ext run` and the E2E lifecycle script consuming `dist/` instead of `webextension/`), which a single maintainer absorbs forever. The build pipeline becomes a category of "extension won't load" bugs that don't exist today.

Option 2 captures the bulk of TypeScript's safety benefit without putting a build step between source and runtime. Tests in TS get type checking on assertion shapes and mock setup; production `.js` with JSDoc gets contract checking and IDE support; cross-file type information flows because TS reads JSDoc when `allowJs` and `checkJs` are enabled. Vitest handles `.ts` test files natively (esbuild under the hood), so no test-runner change is needed beyond the include glob.

The decision can be re-escalated to option 3 later — any JSDoc-annotated `.js` file is a rename + light cleanup away from being a `.ts` file. Keeping that escape hatch open is a real virtue.

### Concrete tooling tasks

Tracked in [`MIGRATION.md`](MIGRATION.md) Phase 0 as a foundation step that must land before Phase 1's test-writing sweep begins.

### Rules for new code

See [`MIGRATION.md`](MIGRATION.md) "Language and type safety" for the full rules and the "what not to do" list.

---

## Security review absorbed (2026-05-04)

**Status:** Chosen (integration plan). Logged 2026-05-04.

**Decision:** Absorb the findings of the [pre-takeover security review](audit/2026-05-04-security-review.md) into the existing roadmap rather than treating security as a separate workstream. Verdict from the review was a cautious go: nothing blocks continuation, but specific findings gate AMO republish.

### How findings map onto the existing phases

- **Cheap wins** — §2.3 (CSP), §2.4 (sender validation), §2.7 (`npm audit` in CI) are added to [`MIGRATION.md`](MIGRATION.md) Phase 0 as a security-hardening checklist item, peer to the tooling-prep checklist. Single-PR changes; lower the blast radius for everything that follows.
- **High-severity findings as Phase 1.5 / Phase 4 work under the safety net** — §2.1 (stored XSS via the zip-restore path) and §2.2 (replace the 2013 vendored `zip.js`) are gated behind Phase 1 characterization tests on the restore path. Fixing them before the tests exist would change behaviour without a safety net — exactly the anti-pattern the strangler-fig discipline is designed to avoid.
- **Phase 1 sequencing reordered** — the four security boundaries (`runtime.onMessage`, tile-URL render, zip restore, optional-permission flows) become slots 1–4 of the Phase 1 sweep. They were originally scattered through the order; the audit elevated them to first-priority characterization targets, and they double as the migration safety net the roadmap already calls for.
- **Permission scope-down** — §2.6 (`<all_urls>` + dynamic content-script injection) stays bundled with the auto-thumbnail rewrite at [`MIGRATION.md`](MIGRATION.md) Phase 4, because the scope-down depends on switching from the `drawWindow` content-script to `tabs.captureTab`.
- **AMO republish gate codified** — finding §2.1 fixed, §2.2 dependency replaced, threat-model doc landed. Recorded in [`README.md`](README.md) step 8.

### Strategic notes raised by the audit

- **MV2-sunset risk on the Chrome / MV3 deferral.** See the time-box note added to that entry below — the gate now has a calendar revisit date in addition to the substantive pre-requisites.
- **AMO publication path has a security dimension.** ID-transfer inherits every existing user's IndexedDB and prefs (potentially long-stale, possibly tampered). New-ID is clean state. Whichever way the maintainer decides on [`README.md`](README.md) step 7, this factor should be weighed alongside user-base preservation.
- **AI-contribution supply-chain** — explicit guardrails added to [`CONTRIBUTING.md`](CONTRIBUTING.md) "AI Coding Assistants" (pinned versions, lockfile review, `postinstall` scrutiny, typo-squat checks).

---

## Chrome support / MV3 migration

**Status:** Deferred. Logged 2026-05-02.

**Decision:** Stay Firefox-only on Manifest V2 for now. Do not pick up the previous maintainer's `chrome` branch. Re-evaluate after Firefox-only stabilization is complete (see "Pre-requisite gate" below).

### Why deferred

The takeover is in progress, the codebase has zero tests, and an MV3 migration is a project-shaped piece of work — not a side-effect of merging a branch. Doing both simultaneously means doing the migration without a safety net, which is the highest-risk version of the move.

### Pre-requisite gate (when to revisit)

Do **not** revisit this until all of the following are true:

- The full Unit + Integration suite is green in CI on a clean clone.
- The minimum E2E suite passes against Firefox ESR in CI.
- At least one real bug fix has shipped under the documented TDD flow (Unit-first for new code, Integration-characterization-first for legacy code), so the workflow is proven.
- The maintainer has spent enough time in `newTab.js`, `tiles.js`, and the background scripts to feel comfortable navigating them.

Below this bar, picking up Chrome multiplies risk without buying confidence. Above it, the test suite becomes the migration's safety net.

**Calendar time-box:** revisit this gate by **2027-Q2** regardless of whether the substantive pre-requisites have been met. Mozilla has signalled a multi-year MV2 wind-down on Firefox; indefinite deferral is a strategic risk. The time-box doesn't commit to action — it commits to *re-deciding* on a date. Added 2026-05-04 in response to the pre-takeover security review.

### What "doing it" actually entails

This is not a branch merge. It's three coupled projects:

1. **Chrome forces MV3.** Chrome stable stopped accepting MV2 in 2024. Targeting Chrome means migrating the whole codebase to Manifest V3 first.
2. **Firefox MV3 ≠ Chrome MV3.** They differ in real ways:
   - Firefox keeps blocking `webRequest`; Chrome doesn't (it requires `declarativeNetRequest`). This codebase doesn't use `webRequest` blocking today, but the asymmetry exists.
   - Firefox's MV3 background is an **event page** with DOM access; Chrome's is a **service worker** without DOM, without XHR (only `fetch`), and that gets killed when idle. Background state must be persisted.
   - `chrome.*` in MV3 returns promises (it didn't in MV2 callback style). Code mixing callbacks and promises will need cleanup.
3. **Build strategy.** The previous maintainer used a separate long-lived `chrome` branch. The modern approach is **single source / dual build**: shared `webextension/` with per-target manifest variants (`manifests/firefox.json`, `manifests/chrome.json`) and a build script that emits two artifacts (`firefox.xpi`, `chrome.zip`). Long-lived parallel branches carry permanent merge cost; avoid that if possible.

### Concrete migration cost (Firefox-only constructs in current code)

These are the specific things that won't port unchanged. Listing them so the cost is concrete in 6 months instead of vague.

**Manifest (`webextension/manifest.json`):**
- `applications.gecko` block — Firefox-only; Chrome ignores it but AMO requires a different shape under MV3.
- `browser_action` — MV3 unifies into `action`.
- `browser_action.theme_icons` — Firefox-only.
- `browser_action.browser_style: true` — Firefox-only (deprecated in MV3 even on Firefox).
- `<all_urls>` in `permissions` — MV3 splits host patterns into `host_permissions`.
- `background.scripts` array — MV3 changes the shape (service worker on Chrome, event page on Firefox).
- `manifest_version: 2` — flips to 3 with all of the above flowing from it.

**Code (`webextension/`):**
- `browser.theme.getCurrent()` and `browser.theme.onUpdated` — Firefox-only API. Used by the auto-theme feature in `newTab.js` (~line 625, ~line 721). Chrome has no equivalent; that feature would need to be Firefox-only with a feature flag.
- `browser.menus.getTargetElement(info.targetElementId)` — Firefox-only. Used in the context-menu handlers in `newTab.js` (~line 431, ~line 443). Chrome's `contextMenus` API has no equivalent; the click target has to be derived differently.
- `browser.menus.refresh()` — Firefox-only.
- `browser.menus.onShown` — Firefox-only.
- `browser.runtime.getBrowserInfo()` — Firefox-only. Used in `newTab.js` (~line 1006) for a version comparison.
- `chrome.sessions.getRecentlyClosed`, `chrome.sessions.restore`, `chrome.sessions.onChanged` — exist on Chrome but with behavioral differences worth verifying.
- The new tab page is **XHTML** (`newTab.xhtml`); Chrome handles it but is more comfortable with HTML. Worth deciding whether to convert during the migration.
- The background uses `lib/zip.js` for export functionality. Under Chrome's service-worker model, anything that holds in-memory state across events needs to move to storage; verify the zip code's behavior in a non-persistent context.
- `chrome.*` callback style is used heavily in `newTab.js` (e.g. `chrome.tabs.query({}, tabs => {...})` ~line 89). MV3 promises this is fine on both browsers, but mixing styles within a single function gets confusing and is worth normalizing during the port.

### Effect on the testing tiers when revived

- **Unit tests:** unchanged. Pure functions don't care about the host browser. This is the strongest argument for the "extract pure logic first" discipline — it pays off doubly when going multi-target.
- **Integration tests:** add seam tests where Chrome and Firefox diverge (`browser.theme.*`, `browser.menus.getTargetElement`, `browser.runtime.getBrowserInfo`, `chrome.sessions.*` differences). `jest-webextension-mock` already supports both `chrome.*` and `browser.*` namespaces, so most existing tests stay valid.
- **E2E tests:** add a second Playwright project for Chromium. Playwright supports both browsers natively, so this is configuration, not new infrastructure. CI matrix doubles in length.
- **MV2-only rule in [`TESTING.md`](TESTING.md):** retires the moment this work begins. Picking up Chrome *is* the explicit migration decision the rule was gating.

### Suggested order of work (when picked up)

1. Confirm the pre-requisite gate is met. If not, stop.
2. Read the previous maintainer's `chrome` branch as **historical reference**, not a starting foundation. By the time this is picked up the branch will likely be 2+ years stale; treat its value as "what conditional code paths existed and why," not "what to merge."
3. Plan the MV3 port as a Firefox-first project: convert background, split permissions, replace removed APIs, retest the full Firefox suite under MV3, ship a Firefox MV3 release and let it bake.
4. Then add Chrome as a second target via single-source / dual-build. Run the full test pyramid against both. Decide what to do about Firefox-only features (auto-theme, the menus integration) — feature-flag, polyfill, or accept divergence.
5. Update [`TESTING.md`](TESTING.md) to repeal the MV2-only rule and document the cross-browser test matrix.

### Reference: previous maintainer's `chrome` branch

The branch exists in the repo history. Useful for understanding what conditional code the previous maintainer wrote (manifest variants, API shims, build differences). Do not attempt a merge. By the time of revival the branch will be stale and the approach (long-lived parallel branches) is one this roadmap explicitly recommends moving away from in favor of single-source / dual-build.
