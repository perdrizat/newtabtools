# Chrome API Divergence Audit — chrome-prep C5

**Date:** 2026-07-11
**Branch:** `chrome-prep` (after C4d, HEAD `8376d0b`)
**Scope:** every `browser.*`/`chrome.*` call site under `webextension/` (page
modules + `lib/**`, excluding vendored `lib/zip/**`). The input to C5's
targeted capability seam (CHROME_PREP.md Decision 4).

## Headline

Distinct API surfaces: **29 portable** (namespace-normalization only —
`browser` → `globalThis.browser ?? chrome`), **6 divergent-wrap** (need a
capability wrapper), **4 firefox-only** (degrade to absent per Decisions 1/2).
This confirms Decision 4: the seam is 6 named capabilities on top of ~29
namespace-only surfaces — not a blanket-wrap job.

## Divergent-wrap surfaces (the actual seam)

1. **`storage.session`** (`lib/background-main.js:249,254`; `lib/capture.js:463,466`)
   — call shape identical, but Chrome MV3 defaults access level to
   `TRUSTED_CONTEXTS` and a 10 MB quota; Firefox has no access-level concept.
   No wrapper exists yet in `lib/platform.js` — C5 adds get/set helpers.
2. **`captureVisibleTab` / `isCaptureAvailable`** (`lib/capture.js:149`;
   `lib/platform.js:50`) — the `typeof`-undefined probe is a Firefox-specific
   detection trick (Fx hides the function without `<all_urls>`; Chrome keeps it
   defined and rejects the call). Chrome fork needs permission-based detection
   (`hasAllUrlsPermission`, already in platform.js).
3. **`search.search`** (`awesomebar.js:429`) — Chrome's equivalent is
   `chrome.search.query({text, disposition, tabId})`: renamed method, `text`
   not `query`, no `engine` param. Page-side wrapper translates the shape.
4. **`action.enable/disable`** (`lib/platform.js:60,68`) — calls are portable,
   but the manifest's `theme_icons` light/dark auto-swap has NO Chrome MV3
   equivalent; a Chrome fork needs new `action.setIcon()`-driven logic that
   doesn't exist in the FF-only codebase. platform.js's action wrapper is where
   it belongs.
5. **`menus.create` / `createMenuTolerant`** (`lib/platform.js:92`) — Chrome has
   no `menus` namespace. The wrapper presence-gates on `browser.menus` and
   no-ops on Chrome (Decision 1: no degraded static menu).
6. **`runtime.getBrowserInfo`** (`lib/tiles-store.js:127`; `filters-ui.js:87`)
   — absent on Chrome; used only to branch a pre-Fx63 `topSites.get` options
   shape. Wrapper short-circuits to the modern options object when absent
   rather than calling it (verbatim port would throw on Chrome).

## Firefox-only (degrade to absent)

- Background menus `onShown`/`update`/`refresh` (`lib/background-main.js:288-293`).
- Page-side menus `onShown`/`onClicked`/`getTargetElement`/`update`/`refresh`
  (`newTab.js:763-790`, registered at `:1916-1917`) — route through the new
  page capability leaf, presence-gated (Decision 1).
- `theme.getCurrent`/`onUpdated` (`theme.js:117`; `newTab.js:941,943`) —
  base is `prefers-color-scheme`, Firefox layers `browser.theme` on top only
  if present (Decision 2). `theme.js` is already the natural home.

## Seam homes

**`lib/platform.js` (background)** already holds `hasAllUrlsPermission`,
`isCaptureAvailable`, `enableAction`/`disableAction`, `getMessage`,
`createMenuTolerant`, `broadcastToPages`. C5 EXTENDS: non-`typeof` capture
detection, `browser.menus` presence guard, a `storage.session` wrapper
(net-new), theme-driven action-icon logic (net-new).

**New page-side capability leaf** (page files can't import `lib/`) carries:
menus presence-gating (newTab.js context-menu registration), theme
presence-gating (theme.js + newTab.js onUpdated), and the `search` shape
translation (awesomebar.js).

## Namespace inconsistency (the normalization surface)

CONTRIBUTING says background uses promise-based `browser.*` throughout, but
it's violated: `lib/background-main.js` mixes `browser.*` and raw `chrome.*`
(webRequest ×3, webNavigation, tabs.onActivated/onRemoved, idle, runtime.getURL);
`lib/backup.js` uses both in one file (`:46` browser, `:232` chrome);
`prefs.js:163` raw `chrome.storage.onChanged`. The page side is mostly raw
callback-style `chrome.*` (newTab.js, awesomebar.js, tiles-shim.js, titlebar.js,
site.js, grid.js, filters-ui.js, common.js). `action.js` is the one fully
consistent `browser.*` page file. A single `const api = globalThis.browser ??
chrome` per scope normalizes all of it without behavior change (Chrome's
`chrome.*` is promise-capable in MV3).

## Traps on portable-looking sites (implementation care)

- `storage.session` quota/lifecycle differs even though call shape doesn't —
  document in the wrapper, don't assume identical.
- `action`/`theme_icons`: the manifest gap is invisible at the JS call level.
- `permissions.request` (newTab.js:444,650,1402): Chrome enforces the
  user-gesture rule strictly; all three are inside click handlers today —
  a future deferral behind `await` breaks only on Chrome.
- `runtime.getBrowserInfo`: throws on Chrome if ported verbatim (see #6).
- `webRequest` (`lib/background-main.js:93-95`): safe as written (non-blocking);
  flag so no one adds `'blocking'` expecting MV3 Chrome support.
- `topSites.get` options logic is duplicated in two styles (tiles-store.js await
  vs filters-ui.js callback) — align while normalizing to prevent fork drift.

## C5 design decision (2026-07-11, from this audit)

- **Namespace leaf per scope:** a background `api` (in `lib/platform.js` or a
  sibling it re-exports) and a page `api` capability leaf. Every raw `chrome.*`
  and bare `browser.*` site becomes `api.*`. Behavior-preserving on Firefox
  (that's the gate); Chrome-readiness is the payoff.
- **Six wrappers only** (the divergent surfaces above), homed per §"Seam homes".
- **No polyfill dep** (zero-runtime-deps policy) — `globalThis.browser ?? chrome`
  in-house.
- **Firefox behavior must not change** — this arc is Chrome-*readiness*, not a
  Chrome port. Every wrapper's Firefox path is the current code; the Chrome
  path is written but dormant (no Chrome manifest until stage 3). Full E2E +
  UAT are the "Firefox unchanged" proof.
