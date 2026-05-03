# Roadmap

This file logs decisions about future direction that have been considered and deferred, with enough context for a future maintainer to pick them up later without having to re-derive the reasoning.

It is not a task list and not a release plan. Entries are dated; outdated ones should be removed or updated, not left to rot.

---

## Chrome support / MV3 migration

**Status:** Deferred. Logged 2026-05-02.

**Decision:** Stay Firefox-only on Manifest V2 for now. Do not pick up the previous maintainer's `chrome` branch. Re-evaluate after Firefox-only stabilization is complete (see "Pre-requisite gate" below).

### Why deferred

The takeover is in progress, the codebase has zero tests, and an MV3 migration is a project-shaped piece of work — not a side-effect of merging a branch. Doing both simultaneously means doing the migration without a safety net, which is the highest-risk version of the move.

### Pre-requisite gate (when to revisit)

Do **not** revisit this until all of the following are true:

- The full Layer 1 + Layer 2 test suite is green in CI on a clean clone.
- The minimum E2E suite passes against Firefox ESR in CI.
- At least one real bug fix has shipped under the Mode A / Mode B TDD flow, so the workflow is proven.
- The maintainer has spent enough time in `newTab.js`, `tiles.js`, and the background scripts to feel comfortable navigating them.

Below this bar, picking up Chrome multiplies risk without buying confidence. Above it, the test suite becomes the migration's safety net.

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

### Effect on the testing pyramid when revived

- **Layer 1 (pure logic):** unchanged. Pure functions don't care about the host browser. This is the strongest argument for the Mode A / Layer 1 discipline — it pays off doubly when going multi-target.
- **Layer 2 (API-mocked):** add seam tests where Chrome and Firefox diverge (`browser.theme.*`, `browser.menus.getTargetElement`, `browser.runtime.getBrowserInfo`, `chrome.sessions.*` differences). `jest-webextension-mock` already supports both `chrome.*` and `browser.*` namespaces, so most existing tests stay valid.
- **Layer 3 (E2E):** add a second Playwright project for Chromium. Playwright supports both browsers natively, so this is configuration, not new infrastructure. CI matrix doubles in length.
- **MV2-only rule in `TESTING.md`:** retires the moment this work begins. Picking up Chrome *is* the explicit migration decision the rule was gating.

### Suggested order of work (when picked up)

1. Confirm the pre-requisite gate is met. If not, stop.
2. Read the previous maintainer's `chrome` branch as **historical reference**, not a starting foundation. By the time this is picked up the branch will likely be 2+ years stale; treat its value as "what conditional code paths existed and why," not "what to merge."
3. Plan the MV3 port as a Firefox-first project: convert background, split permissions, replace removed APIs, retest the full Firefox suite under MV3, ship a Firefox MV3 release and let it bake.
4. Then add Chrome as a second target via single-source / dual-build. Run the full test pyramid against both. Decide what to do about Firefox-only features (auto-theme, the menus integration) — feature-flag, polyfill, or accept divergence.
5. Update `TESTING.md` to repeal the MV2-only rule and document the cross-browser test matrix.

### Reference: previous maintainer's `chrome` branch

The branch exists in the repo history. Useful for understanding what conditional code the previous maintainer wrote (manifest variants, API shims, build differences). Do not attempt a merge. By the time of revival the branch will be stale and the approach (long-lived parallel branches) is one this roadmap explicitly recommends moving away from in favor of single-source / dual-build.
