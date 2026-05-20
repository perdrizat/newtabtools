# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2026-05-20 b]

### Added

- New tile template: rounded corners, bottom gradient overlay with favicon + title, pin stripe accent bar
- Logo-emanation fallback thumbnail: radial gradient bloom with centered favicon letter when no screenshot
- Tile hover action row: 5 inline SVG buttons (edit URL, open in new tab, refresh thumbnail, pin/unpin, remove)
- `stats.js`: TileStats module computing visit count, last-visited age, trend, rank, and freshness from `browser.history`
- `statType` pref (none/visits/last/trend/rank/fresh) with backup/restore support
- Stat chip slot rendered on tiles (top-left, monospace, backdrop blur)
- Integration tests for tile redesign (42 tests), tile stats (23 tests)
- E2E test suite for tile redesign (21 tests: structure, actions, pin toggle, remove, open, refresh, visual sanity)
- E2E visual sanity checks: thumbnail dimensions, fallback coverage, glyph containment, overlay position, occlusion detection
- Behavioral tests for `_renderLogoFallback`, `_renderActions`, `updateAttributes`, and `statType` validation
- `ntt/no-source-grep` ESLint rule: flags `readFileSync` of `webextension/` files in tests, enforces behavioral-test preference
- `tests/integration/_helpers.ts`: `loadModule()` and `mountSite()` helpers for behavioral tests
- "Test Design Principles" section in TESTING.md documenting behavioral-test preference

### Changed

- Replaced old `<input>` tile controls (pin/block/remove-thumbnail) with inline SVG action buttons
- `Site._render` now calls `_renderActions`, `_renderFavicon`, `_renderStatChip`, and `_renderLogoFallback`
- `Site._onClick` handles action buttons via `data-action` attribute instead of class-based dispatch
- `Site.updateAttributes` sets `pinned` on `.newtab-site` node instead of old pin control
- Updated E2E tests (`pin-persists`, `lock-grid`, `drag-reorder`, `auto-thumbnail`) for new tile structure
- Auto-thumbnail E2E tests now assert fallback is not visually occluding loaded thumbnails
- Tile action buttons scaled to medium size (33x33px buttons, 16px icons, 7px radius) — 1.5x previous small size
- Overlay gradient strengthened to 3-stop ramp (0→0.55→0.85) for better title contrast over thumbnails
- Title text-shadow increased to `0 1px 3px rgba(0,0,0,0.55)` and bottom padding bumped for legibility
- Logo fallback gradient now uses CSS `--ntt-brand` custom property and `color-mix()` instead of string interpolation
- "Fresh" stat chip uses `[data-stat-fresh]` attribute + CSS instead of inline styles
- Extracted `siteGlyph(url)` helper to deduplicate glyph computation
- `statType` pref change now triggers stat chip re-render on all tiles via `updateUI`
- Removed `aspect-ratio: 16/9` from `.newtab-site` — cell controls aspect ratio (§2.3)

### Fixed

- Thumbnail `objectURL` leak: previous URL now revoked before creating new one
- Open action validates URL protocol before `chrome.tabs.create` (§1.2)
- E2E `css-grid-layout` drag test: pin a test tile in `beforeAll` so `.newtab-site` exists on fresh CI profiles
- `getThumbnails()` now removes `.ntt-logo-fallback` overlay when an IDB thumbnail is loaded, fixing logo letter covering screenshots
- Action button SVG icons now visible: added `.ntt-action-btn svg` override for blanket `svg{display:none}` rule

### Security

- `backgroundColor` validated against `/^#[0-9a-f]{3,8}$/i` at restore boundary and render time (§1.1)
- `browser.history.getVisits` guarded by cached `browser.permissions.contains` check (§1.3)

### Removed

- Old `.newtab-control` CSS rules and SVG sprite background images (`controls-light.svg`)
- Old `newtab-control-pin`, `newtab-control-block`, `newtab-control-thumbnail` input buttons from template
- Themed control image logic from `createSite` and `updateThemeColours`

## [2026-05-20]

### Added

- feat: NTT v2 Phase 0 — design tokens, SVG icons, CSS Grid layout

## [2026-05-13]

### Added

- Tile aspect ratio setting in the layout panel: `Fill viewport` (default, unchanged behavior), `16:9`, `4:3`, `1:1`, `3:4` (portrait). Resolves upstream issue #505 — tiles maintain the chosen ratio and the grid centers in the available space.
- `newTabTools.computeCellDimensions` pure helper plus `applyTileAspect` integrator; cell dimensions are JS-computed when an aspect is locked (CSS `aspect-ratio` alone collapses to zero in the existing flex layout). Recomputes on window resize and on rows/columns/spacing/tileAspect changes.
- `tileAspect` added to the §2.5 restore allow-list so the setting round-trips through backup/restore.

### Changed

- `package-lock.json` regenerated to drop `^` ranges from devDependency records, aligning the lock file with the exact pinning already declared in `package.json`.

## [2026-05-11]

### Security

- `npm audit fix` — resolved `fast-uri` path traversal via percent-encoded dot segments

### Changed

- Updated `README.md` to reflect completed migration and active MV3 work
- Removed ~25 debug `console.log`/`console.warn` calls from `background.js` (§5.5)
- Pinned all devDependency versions to exact (no `^` ranges) (§5.4)
- `MIGRATION.md` marked complete and renamed to `MIGRATION_COMPLETED.md`
- Auto-thumbnail rewrite: multi-stage capture (A/B/C) with blankness detection for heavy SPAs like X.com
- `Thumbnails.capture` handler uses new `startCaptureSession` instead of removed `captureAndStore`
- Rewrote `auto-thumbnail.test.ts` from source-scanning to behavioral tests (vm.runInThisContext + fake timers)
- Rewrote `wallpaper-picker.test.ts` fetch logic from source-scanning to behavioral tests
- Completed source-scanning → behavioral audit across all 14 integration test files
- Converted all 17 E2E test files + `_helpers` from JavaScript to TypeScript with full type annotations

### Added

- Post-takeover code review and assessment at `audit/2026-05-11-code-review.md`
- `MV3_MIGRATION.md` is now the active migration plan
- Remove-thumbnail button on tile hover (alongside pin and block controls)
- `Thumbnails.delete` message handler to remove thumbnails from IDB

### Fixed

- Export/Import `sendResponse()` invoked immediately instead of passed as callback (§5.1)
- `isValidURL` allow-list tightened from 5 schemes to 3 (`http:`, `https:`, `ftp:`) — aligns with restore/render boundaries (§5.2)
- `strict_min_version` bumped from 91.0 to 128.0 (current ESR) (§5.3)
- Hard deadline now takes a C capture before finalizing (was finalizing with A+B only)
- Tab-active guard in `captureTab` prevents capturing wrong tab when user switches mid-session
- SPA double-`onCompleted` cancels prior session timers to prevent stale hard-deadline firing

### Removed

- Donation link, "What Changed?" button, and in-app update notice (Phase 3 fork cleanup)
- `versionLastUpdate` and `versionLastAck` prefs (version notice tracking no longer needed)
- `donate`, `donate_label`, `changelog_label`, `newversion` locale strings from all 21 locale files

## [2026-05-10]

### Added

- Wallpaper picker: fetch curated wallpapers from Mozilla Remote Settings, display in category-grouped sidebar

### Changed

- Dedicated `System theme` option; default theme changed to `system` (follows OS `prefers-color-scheme`)
- Refactored `tests/e2e/theme.test.js` and `tests/unit/manifest.test.js` to TypeScript

### Fixed

- Replaced all deprecated CSS vendor prefixes (`-moz-appearance`, `:-moz-any`, `-moz-user-focus`, etc.) with standards
- Collapsed duplicate `-moz-any`/`-webkit-any` rule pairs into single `:is()` rules

## [2026-05-09]

### Security

- Fixed §2.6 — removed `executeScript` and `thumbnail.js` content script; no JS injected into visited pages

### Changed

- Auto-thumbnail rewrite: `drawWindow` → `captureVisibleTab()` with two-stage capture (immediate + network idle)
- `action.js` capture button uses `Thumbnails.capture` message instead of `executeScript`
- Added `webRequest` permission to manifest for network idle detection
- Updated `MIGRATION.md` — all 22 features complete, all 7 security findings resolved

### Removed

- Deleted `thumbnail.js` content script (replaced by background-only capture)

## [2026-05-08]

### Changed

- Audit and update `MIGRATION.md` — 21 of 22 features complete, phases collapsed from 6 to 4

### Removed

- Delete `lib/colour.js`, `lib/messaging.js` and their unit tests — unused at runtime; extraction deferred to MV3

## [2026-05-07]

### Fixed

- CI typecheck — added `globals.d.ts` for integration test globals, minor type annotations in 5 test files
- Suppressed expected error noise in test output (console spy on error-handling tests)

- Security review update — `audit/2026-05-07-security-update.md` (6 of 7 findings now fixed)
- `CONTRIBUTING.md` — run `npm audit` after changing dependencies

### Security

- Fixed §2.1 stored XSS via zip restore (HIGH) — URL scheme allow-list at restore + render boundaries
- Fixed §2.2 vendored zip.js from 2013 (HIGH) — replaced with `@zip.js/zip.js` v2.8.26; `export.js` rewritten to Promise API
- Fixed §2.5 unfiltered pref keys on restore (MEDIUM) — allow-list of known keys before `storage.local.set`
- Resolved `basic-ftp@5.3.0` high-severity advisory via `npm audit fix`

## [2026-05-06]

### Added

- Phase 1 feature characterization — slots 5–16 complete (209 integration tests across 11 suites)
- Phase 1 E2E characterization — slots 17–29 complete (24 E2E tests across 12 suites)
- Hermetic E2E fixtures — `resetTestState` ensures tests pass regardless of execution order

## [2026-05-05]

### Added

- Phase 1 security boundary characterization — slots 1–3 (56 integration + 2 E2E + 14 unit tests)
  
## [2026-05-04]

### Added

- **Security review** landed at `audit/2026-05-04-security-review.md`. Result: cautious go for the takeover. Audit findings absorbed into the roadmap.
- **Codebase strategy decided**: cherry-pick + reference rewrite. Recorded in `ROADMAP.md`.
- Created `MIGRATION.md` — **per-feature migration ledger** 
- **Phase 0 security hardening** — the three cheap-win fixes from `audit/2026-05-04-security-review.md`:

## [2026-05-03]

### Added

- Established the **Unit and Integration test tiers** using Vitest and `jsdom`, including initial characterization tests for core utility modules.
- Implemented the **E2E test tier** for Firefox ESR using Puppeteer over WebDriver BiDi, with reliable extension loading and state persistence.
- Migrated to **ESLint flat config** with specialized support for legacy scripts, new ES modules, and the E2E test environment.
- Configured **GitHub Actions CI** for automated linting and full test suite validation.

### Changed

- Harmonized testing terminology across all docs

### Removed

- Deleted `BOOTSTRAP.md` following the successful establishment of the test infrastructure.

## [2026-05-02]

### Changed

- Updated [`README.md`](README.md): updated with "New Tab PowerTools" branding and features
- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md): updated with test automation focus
- Deactivated donation button instead of linking to the original maintainer's donation page
- Updated the GitHub link to the new repository fork
- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md) to explicitly state the intention of the fork and the initial focus on test automation
- Rewrote [`README.md`](README.md) to reflect takeover-prep state and explicitly outline the high-level features parsed from AMO and the extension's codebase

### Added

- Added [`TESTING.md`](TESTING.md): canonical testing guide, including a guide for installing Firefox ESR on Ubuntu/WSL via the official Mozilla APT repository
- Added `BOOTSTRAP.md`: (Temporary) one-time test infrastructure setup guide.
- Added [`ROADMAP.md`](ROADMAP.md): deferred decisions about Chrome support and MV3 migration
- Added [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md): gap analysis vs. native Firefox
