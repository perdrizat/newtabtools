# Feature Scope: Native Firefox vs. New Tab Tools

This document drives the takeover's scope decisions. It identifies what Firefox's built-in new tab page does today (late 2025 / early 2026), what the gap is that justifies NTT's existence, and which features the continuation should keep, deepen, or drop. It also informs the E2E test surface — see "Test scope implications" at the bottom.

## The framing rule

NTT replaces Firefox's new tab page **entirely** via `chrome_url_overrides.newtab`. There is no way to extend, augment, or hybridize the native page — Firefox excludes `about:newtab` from content script injection by design. The choice is binary: native or NTT.

This means: **any feature a typical Firefox user expects from the default page must also exist in NTT, or installing NTT feels like a downgrade.** Even features Firefox does natively need to be reimplemented in NTT to maintain parity. Power-user features (the gap) are the *reason* to install NTT, but parity features are the *price of entry*.

Three feature categories follow:

- **Differentiating** — things Firefox can't do. Full investment, full E2E coverage, active development.
- **Parity (Match)** — things Firefox does that NTT must also do so users don't feel they've lost ground. Maintained, basic E2E coverage, no innovation beyond what native does.
- **Drop** — legacy elements that no longer fit the fork (the previous maintainer's donate link, manual update notices that AMO now handles).

## Native Firefox baseline (Firefox 134+, with custom wallpapers since 138)

Two recent inflection points make most of this list new since 2025:

- **Firefox 134 (January 2025)** — major new tab redesign. Per-shortcut **custom uploaded image**, custom title, custom URL, drag-reorder, configurable rows.
- **Firefox 138 (May 2025)** — page-level **custom wallpaper upload**, plus preset wallpaper categories (Solid, Abstract, Celestial, Photographs, Firefox-designed).

What the native page does today, exposed to end users:

- **Shortcuts grid** with pin/unpin, drag-reorder, custom title, custom URL, **custom uploaded image per tile**, dismissal. Up to 4 rows; columns scale to window width.
- **Wallpapers** — preset categories or custom uploaded image.
- **Theme follow** — light/dark picked up from the Firefox theme automatically; no in-page manual override.
- **Recent activity** row — visited pages, bookmarks, downloads (toggleable).
- **Recommended Stories** (Pocket-derived) and sponsored shortcuts (toggleable).
- **Widgets** — Weather (location, °C/°F), Lists, Timer (some experimental).
- **Section toggles** for everything via gear icon.
- **Blank page** option.
- Per-domain de-dup: hard 1-tile-per-domain rule, not user-tunable.

Source code lives at [`browser/extensions/newtab/`](https://searchfox.org/mozilla-central/source/browser/extensions/newtab/) in mozilla-central. Internal pref keys still use the historical "Activity Stream" name (`browser.newtabpage.activity-stream.*`) but the user-facing name is "New Tab" / "Firefox Home."

## Architectural reality

Activity Stream is a **system addon** built into Firefox itself. It is React/Redux-based but uses chrome-privileged APIs — `Services.jsm`, `ChromeUtils`, `BackgroundPageThumbs`, raw queries against the Places SQLite database — that ordinary WebExtensions cannot touch. When NTT overrides the new tab page, Firefox hands it a blank document. NTT cannot import Activity Stream's React components because they're entangled with browser-internal C++ and message routers that don't exist in WebExtension scope.

What this rules out:
- Submitting power-user features upstream to Mozilla. They will reject; their goal is one default for everyone.
- Maintaining a Firefox fork (Waterfox, Floorp, etc.) just to ship NTT.
- Porting Activity Stream's executable code into a WebExtension.

What it leaves open (three options for the takeover):
1. **Modernize the existing NTT codebase as-is.** Keep all 1,200 lines of `newTab.js`, fix bugs, add the gap features. Familiar, comfortable, but a lot of legacy code to maintain when half of it is now duplicate-of-Firefox.
2. **Cherry-pick + reference rewrite.** Use Activity Stream as a *visual and behavioral reference* (license-compatible: both MPL-2.0). Reimplement the parity features cleanly in WebExtension scope, port the salvageable parts of NTT for the gap features, drop the rest.
3. **Lean rewrite.** Start fresh from a clean WebExtension skeleton; reimplement parity features minimally and the gap features fully. Smallest codebase; most work upfront.

**Decided 2026-05-03: option 2.** It preserves the parts of NTT that solve real problems (the auto-thumbnail pipeline, the filter logic, the export format), discards the parts Firefox now handles, and keeps the codebase small enough for a single maintainer.

## Feature scope (the keep/match/drop matrix)

### Differentiating — full investment, full E2E coverage

These are the reasons New Tab Tools exists in 2026.

| Feature | Native status | Notes |
|---|---|---|
| **Auto-thumbnail of recently visited pages** | **missing** | **Rewritten.** The legacy `drawWindow` content script has been replaced with `captureVisibleTab()` called from the background page — no content scripts injected into visited pages (§2.6 resolved). Uses multi-stage capture: A (immediate), B (500ms for SPA first paint), C (network idle, capped at 2s). Blankness detection via canvas pixel sampling picks the best non-blank capture. Works on heavy SPAs like X.com. **This is the flagship gap feature** — Firefox's per-tile custom image takes a static upload, never auto-captures what the page actually looks like when visited. |
| **Arbitrarily large tiles** | **missing** | Native Firefox tiles are capped at a small thumbnail size, and reducing rows from 4 to 1 doesn't make individual tiles bigger — the layout reserves the unused space rather than reflowing. NTT's grid scales tile size to fill the viewport: a 2×2 grid in a wide browser window produces tiles that are genuinely large. This is one of the most visceral "I can finally *see* my pinned sites" benefits when switching from native. Note: this is an emergent property of an unconstrained grid, not a separate "tile size" slider — it follows directly from "Configurable columns" + the grid being free to use available space. |
| **Configurable columns and unconstrained grid** | **missing** | Native does rows (1-4) but column count scales responsively to window width with no user override, and tile size stays small regardless of how few tiles are shown. NTT lets users pick exact rows × columns and the grid fills the available viewport, which is what makes large tiles possible. |
| **Layout micro-tuning** | **missing** | Foreground opacity slider, tile title size (Small/Medium/Large), per-side margin (Small/Medium/Large), grid spacing. None exposed in native Firefox; never will be (Mozilla optimizes for one default). |
| **Lock-grid toggle** | **missing** | Prevents accidental drag-reorder. No native equivalent. |
| **Per-domain filter cap** with subdomain wildcards (`.example.com`) | **missing** | Native enforces a hard 1-tile-per-domain rule. NTT lets users tune it per host. |
| **Per-tile background color** | **missing** | Native supports a custom *image* per tile, but not a custom solid color. Niche but unique. |
| **Recently-closed-tabs row** with one-click restore | **missing** | Native's "Recent Activity" surfaces visited / bookmarks / downloads — not session restore. NTT provides a dedicated, always-visible horizontal row specifically for recently closed tabs. |
| **Add-shortcut autocomplete** from open tabs / bookmarks / history | **missing** | Native's Add Shortcut dialog is a plain title+URL form. NTT autocompletes from your actual browsing context. UX win. |
| **Local backup/restore** (single-file zip with tiles, thumbnails, settings) | **missing** | Native relies on Firefox Sync. Doesn't snapshot a layout to a portable file. |

### Parity (Match) — maintain, don't innovate beyond native

These exist in native Firefox. NTT must implement them or installing NTT means losing them.

| Feature | Native status | Why we must keep it |
|---|---|---|
| Pin arbitrary URL | Native (134+) | Without this, NTT shortcuts are useless. |
| Per-tile custom uploaded image | Native (134+) | Even with auto-capture, manual upload is the fallback for sites that don't capture cleanly (login walls, dark pages, infrequently visited tiles). |
| Per-tile custom title | Native (134+) | Basic editing; users expect it. |
| Drag-reorder tiles | Native | Basic interaction; users expect it. |
| Configurable rows | Native (1-4) | Native already does this; NTT extends it (see "Configurable columns" above). |
| Page background image | Native (138+) | NTT replaces the entire page; without page-level wallpaper, users lose what they had natively. |
| Light / dark / auto theme | Native (auto) | Same reason — without it, NTT looks broken in users' chosen Firefox theme. |
| Hide history-derived tiles | Native (toggle) | Common preference; users expect to be able to suppress noisy auto-tiles. |
| Localization (multi-language UI) | Native via Firefox locale | Existing NTT translations are an asset; must preserve. |

### Drop — legacy elements that no longer fit

| Feature | Why drop |
|---|---|
| ~~Donation link to the previous maintainer~~ | **Deleted.** Settings-panel fieldset, alert handler, CSS, and locale strings removed. |
| ~~In-app update notice~~ | **Deleted.** Banner, version-tracking prefs (`versionLastUpdate`, `versionLastAck`), locale strings, and `background.js` version-update trigger all removed. |
| ~~Beta channel link, "What Changed?" link~~ | **Deleted** (removed as part of update-notice cleanup). |
| Capture-and-save-current-thumbnail button | **Kept.** Now uses the same `captureVisibleTab` path as auto-capture. Useful for manual re-capture of individual tiles. |

### Out of scope (won't add)

Native features NTT was never going to build, and shouldn't start now:
- Pocket / Recommended Stories — Mozilla-controlled content backend; not feasible from a WebExtension and not aligned with NTT's purpose.
- Sponsored shortcuts — same.
- Weather widget — depends on Mozilla's API and location services; out of scope.
- Lists / Timer — Mozilla's experimental widgets; not part of NTT's identity.

NTT users who want these stay with the native page. NTT's pitch is layout precision and personalization, not content surfaces.

## Test scope implications

This matrix maps directly onto [`TESTING.md`](TESTING.md)'s E2E coverage. The categories drive how much E2E investment each feature gets:

- **Differentiating features:** every one gets dedicated E2E tests — the auto-thumbnail pipeline, opacity slider, lock-grid, per-domain cap, recently-closed restore, autocomplete-on-add, backup roundtrip. These are the features regressions must catch.
- **Parity features:** smoke-level E2E only. Verify the feature works at all; don't try to match Firefox behavior bug-for-bug.
- **Drop features:** no E2E. As they're removed from the codebase, remove the related tests.

Concrete starting set, mapping to the E2E categories already in [`TESTING.md`](TESTING.md):

| E2E test | Category in scope matrix |
|---|---|
| Extension installs, newtab override renders with zero console errors | Smoke |
| Pin a tile and reload — pin persists | Parity |
| Per-tile custom image upload appears and persists | Parity |
| Per-tile custom title persists | Parity |
| Per-tile background color set/reset persists | **Differentiating** |
| Page background image upload + removal | Parity |
| Theme light / dark / auto round-trips | Parity |
| Rows × columns reflows the grid as expected | **Differentiating** (columns specifically) |
| Reducing row/column count enlarges tile size; tiles fill available viewport | **Differentiating** (the "large tiles" benefit) |
| Opacity / spacing / margin round-trip via settings | **Differentiating** |
| Tile title size round-trips | **Differentiating** |
| Lock-grid prevents drag-reorder | **Differentiating** |
| Hide history-derived tiles toggle | Parity |
| Per-domain filter cap with `.example.com` wildcard | **Differentiating** |
| Recently-closed-tabs row appears, restore works | **Differentiating** |
| Add-shortcut autocomplete pulls from tabs / bookmarks / history (with permissions granted) | **Differentiating** |
| Backup zip is non-empty; restore round-trips a backup | **Differentiating** |
| **Auto-thumbnail captures a recently-loaded page** | **Differentiating (flagship)** |
| Context menu pin / unpin / block / edit acts on the right tile | Parity |

Differentiating features get test depth — multiple cases per feature, edge cases, error states. Parity features get a happy-path smoke. Drop features get no E2E and are deleted from the suite when they leave the codebase.

## Codebase strategy decision

**Decided 2026-05-03: option 2 (cherry-pick + reference rewrite).** See [`ROADMAP.md`](ROADMAP.md) for the rationale. The per-feature migration plan and test-status ledger live in [`MIGRATION.md`](MIGRATION.md).
