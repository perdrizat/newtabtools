# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- NTT v2 Phase 3-2: Tile + Appearance drawer tabs
- Appearance tab now shows four theme cards (Inherit Firefox / Pure white / Deep black / High-contrast) replacing the radio stack; clicking writes `Prefs.theme`
- New `theme = 'contrast'` value with WCAG-AAA-ish CSS tokens (`:root[theme="contrast"]`)
- Tile tab shows the existing Pin URL form ("Add tile") + an empty-state placeholder when nothing is selected, and the relocated per-tile editor when a tile is selected
- Tile selection: clicking a tile while the drawer is open *and* the Tile tab is active selects the tile (preventDefault on the link) and applies `[data-selected="true"]` for the new copper-ring CSS
- Wallpaper / page-background controls moved from Tile tab into the Appearance tab
- NTT v2 Phase 3 reshuffle: drawer tabs collapsed from Tile / Layout / Appearance / Advanced to **Tile / Page / Advanced**; Page merges Layout + Appearance
- Tile tab reshuffle: per-tile editor + separator + Tile Aspect Ratio (now a 5-button segmented), Tile Chrome, Tile Stats, Action Icon Size, "Prevent tiles being dragged" checkbox
- Page tab content order: Grid → Spacing → Theme → Title Bar → Background Image → Foreground Opacity
- Advanced tab: Recently Closed (moved up from Layout), History checkbox, Browsing History Tiles filter, combined "Backup & Restore" fieldset, About link
- Cogwheel moved into `#ntt-titlebar-buttons` (right side, 32×32, hover affordance)
- Lock-toggle moved into `#ntt-titlebar-buttons` (left of cogwheel) — always visible top-right
- New `historyTitleFor(url)` helper on `newTabTools` — gesture-safe lookup against `chrome.history`, resolves to `null` when the optional permission isn't granted
- New `link.titleIsUserSet` flag — Set Title marks it true; the tile-action `refresh` button skips title sync when the flag is set
- New `normalizePinURL(raw)` helper — auto-prepends `https://` for bare domains so the Pin form works without a protocol
- 4 tile-editor navigation arrows removed; navigate by clicking the target tile in the grid while the drawer is open
- Locale strings: `options_button` (cogwheel tooltip), `backup_restore_header`, `options_theme_help`, `options_theme_*_sub`, `options_theme_contrast`, `options_theme_contrast_sub`, `tile_empty_state`, `bg_choose`
- Integration tests (8 new files, 76 new tests): `drag-invariants`, `drawer-appearance`, `drawer-tile`, `backup-restore-refresh`, `edit-action`, `pin-url-normalize`, `title-refresh`, `titlebar-layout`, `logo-fallback-opacity`
- E2E tests: `tests/e2e/drag-layout.test.ts` (4 cases for frozen-tile offsetParent, row-collapse, drawer cache refresh, Drag.start cache reset) + 2 new titlebar cases (right alignment when clock hidden / search hidden)

### Changed

- `_syncDrawerSegmented` now matches any `[role="radiogroup"][data-pref="X"]` so the same helper covers `.ntt-segmented` and the new `.ntt-theme-cards`
- `set selectedSiteIndex(null)` shows the empty state, hides the edit area, and clears `[data-selected]` from all tiles (previously the setter assumed a valid index)
- `tests/e2e/theme.test.ts` rewritten to drive the Appearance tab theme cards instead of the removed radio inputs
- `Tiles.pinTile` + page reload pattern in the new Phase 3-2 E2E setups to guarantee the grid surfaces the pinned tile
- "Fill viewport" tile-aspect label shortened to **"Fill"**; "Wordmark" titlebar-toggle label renamed to **"NTT Logo"**
- Backup + Restore consolidated into a single `<fieldset>` inside the Advanced tab
- `#ntt-titlebar` `padding-top` aligned with `padding-left/right` at every spacing tier (`30px 30px 0` / `60px 60px 0` / `120px 120px 0`); `border-bottom` separator dropped (tile-gap spacing only)
- `#ntt-titlebar > #ntt-clock { margin-left: auto }` keeps the clock + buttons cluster right-aligned regardless of which other titlebar children are visible
- `#ntt-clock[hidden] + #ntt-titlebar-buttons { margin-left: auto }` sibling rule promotes the buttons group to own the auto-margin when the clock itself is hidden
- `#ntt-titlebar:has(#ntt-wordmark[hidden]) #ntt-search { margin: 0 }` snaps the search bar to the left edge when the wordmark is hidden
- Drawer width: `.options-row` (100%), `#options-url` (100%), inputs (`min-width: 0`) so the per-tile editor fits inside the 360 px drawer
- Pin URL flow simplified — dropped the SVG-sweep highlight animation; `Updater.updateGrid()` awaits and `selectedSiteIndex` jumps to the newly pinned site so it surfaces without a page reload
- Set URL flow: normalises the URL, clears the old title, consults `historyTitleFor` for a fresh one, and reflects the result in the editor inputs inline
- Tile-action "Edit" button now opens the drawer + switches to the Tile tab + selects the clicked tile (was: only populated the Pin URL input)
- Tile-action "Refresh" button also refreshes the title from history (unless `link.titleIsUserSet` is true) so screenshot and title stay in sync
- Action buttons gain `type="button"` so XHTML's default `type="submit"` behaviour doesn't swallow the click
- `Site.block()` errors now surface via `.catch(console.error)` instead of being a silent unhandled rejection
- Tile-editor preview thumbnail shrunk from 250×150 to 200×120 to fit the drawer envelope comfortably
- `_renderActions` builds buttons via XHTML namespace AND now sets `type="button"`
- `Grid.cacheCellPositions` early-returns when there are no cells (defensive for the post-drawer-transition timeout firing after teardown)
- `cacheCellPositions` is now called: (a) at the start of every drag (`Drag.start`), and (b) 240 ms after `openDrawer` / `closeDrawer` trigger the push-layout
- `--ntt-rows` CSS variable set on `#newtab-grid` alongside `--ntt-cols` so `grid-template-rows: repeat(var(--ntt-rows), 1fr)` has a value to use

### Fixed

- Drag mid-rearrange used to "explode" the grid into giant vertical gaps because `#newtab-grid` had no explicit `grid-template-rows` — empty cells auto-sized to 0 height. Now `grid-template-rows: repeat(var(--ntt-rows), 1fr)` keeps the row heights stable; aspect-locked modes override to `none` so they continue sizing from `aspect-ratio`.
- Dragged tile floated to (cellLeft + cursorX) instead of following the pointer because `.newtab-cell` was `position: relative`, making the cell the offsetParent of any `[frozen]` tile. Cell switched to `position: static`; the page wrapper (`#newtab-vertical-margin`) is the offsetParent again.
- Dragging with the drawer open used stale cell dimensions (the push-layout shrank the grid but no `resize` event fired, so `Grid.cells[].position` stayed at pre-drawer values). `Drag.start` now refreshes the cache and `openDrawer`/`closeDrawer` schedule a refresh 240 ms after the transition.
- Pin URL "Add tile" form silently rejected protocol-less entries like `example.com` because `<input type="url">` required a scheme. `normalizePinURL` auto-prepends `https://`.
- "Type a new tile URL" Set button kept the old title; it now clears it and tries to repopulate from browsing history.
- Tile-action "Edit" used to only populate the Pin URL input — it didn't open the drawer or switch tabs.
- Tile-action "Remove" was a fire-and-forget Promise call; failures inside `block()` were swallowed. Errors now surface via `console.error`. Plus `type="button"` on every action so XHTML's default form-submit behaviour can't intercept the click.
- After restoring a backup, custom thumbnails and tile metadata only appeared after a manual page reload — `Updater.updateGrid` reused in-memory Site instances whose `_link` reference predated the restore. `Grid.refresh()` rebuilds every site from scratch, and an explicit `getThumbnails()` pulls auto-captured screenshots from the IDB store immediately.
- Foreground opacity (`Prefs.opacity`) now also dims tiles without a screenshot — the radial-gradient background fades via a `::before` pseudo-element, while the logo glyph stays at full opacity (stacked via `position: relative; z-index: 1`). `.newtab-thumbnail:has(.ntt-logo-fallback)` clears the surface fill so the wallpaper can show through.
- Clock + buttons cluster used to collapse left when the search bar was hidden (default state). `margin-left: auto` on `#ntt-clock` keeps it glued to the right edge, and a sibling rule promotes the buttons group when the clock itself is hidden.
- Search bar centred against nothing when the wordmark was hidden; now snaps to the left edge via `:has(#ntt-wordmark[hidden])`.

### Removed

- `#ntt-cogwheel-wrap` (absolute-positioned wrap around the cogwheel) — both the wrap div and the CSS rule are gone
- `#locked-toggle` no longer lives in `#newtab-margin-bottom`
- 4 tile-editor navigation arrows (`#options-previous-row-tile`, `#options-previous-tile`, `#options-next-tile`, `#options-next-row-tile`) and the corresponding `case` branches + `uiElements` entries
- Pin URL SVG-sweep highlight animation

## [2026-05-29]

### Added

- NTT v2 Phase 3-1: right-side configuration drawer with Tile / Layout / Appearance / Advanced tabs, replacing the centered options modal
- Layout tab: cols × rows segmented controls (3-7 × 2-5), three S/M/L snap sliders for spacing / margin / corner radius, recently-closed Off/Top segmented, 4 title-bar toggle rows, tile-chrome toggles (overlay, hover actions), tile-stat segmented (6 options), action-icon-size S/M/L segmented
- New prefs `actionIconSize` (`small`/`medium`/`large`, default `medium`), `tileActions` (boolean, default `true`), `tileRadius` (`small`/`medium`/`large`, default `medium`) — all added to backup/restore allow-list
- CSS custom properties `--ntt-action-btn-size` (22/33/44px), `--ntt-action-icon-size` (11/16/22px), `--ntt-radius` (4/10/18px) driven by the new prefs
- Drawer methods on `newTabTools`: `openDrawer`/`closeDrawer`/`toggleDrawer`/`switchDrawerTab`, plus `drawerOnClick`/`drawerOnChange` and `_syncDrawerSegmented`/`_syncDrawerToggle`/`_syncDrawerSlider` helpers
- Auto-request of optional `history` permission when user picks a stat type that needs it (Visits / Last / Trend / Fresh); rank stat type works without the permission via tile cell index
- Integration tests: `tests/integration/drawer.test.ts` (13 tests for open/close/toggle/switchTab), `tests/integration/drawer-layout.test.ts` (28 tests for Layout bindings, updateUI reflection, and 7 regression tests), `tests/integration/drawer-permissions.test.ts` (6 tests for gesture-safe permission request + stat chip rank wiring), `tests/integration/drawer-hidden-css.test.ts` (5 tests for `[hidden]` CSS overrides)
- E2E tests: `tests/e2e/drawer.test.ts` (10 tests including realtime slider drag, wordmark hide, label-click delegation, rank chip render without permission)

### Changed

- Cogwheel click now opens the drawer (`toggleDrawer`); context menu "Edit" jumps to the Tile tab via `openDrawer` + `switchDrawerTab('tile')`
- Esc closes the drawer when open (previously closed the old modal)
- Tile editing UI relocated as-is into the drawer's Tile panel; history/filter/export UI relocated into the Advanced panel; theme / opacity / tileAspect kept under the Appearance panel
- Toggle rows are clickable anywhere on the row (label, kbd hint, or button), not just on the small toggle switch
- "System" theme now also adopts browser theme colors when the active Firefox theme declares any (collapses the old `themeAuto` toggle into `theme = 'system'`)
- "Light"/"Dark" theme options now explicitly force the NTT palette, ignoring browser theme colors
- `settings-panel.test.ts` rewritten to test drawer open/close (was modal)
- `layout-tuning.test.ts` drives `Prefs.titleSize`/`spacing`/`margin` directly (the old `<select>` form elements are gone)
- `recent-tabs.test.ts` drives `Prefs.recent` directly (the old checkbox is gone)
- `filter-cap.test.ts` opens drawer + switches to Advanced tab instead of asserting `options-extra` attribute

### Fixed

- Spacing / margin / corner-radius sliders update the px value label and `--ntt-gap` / `--ntt-radius` CSS vars in realtime as the user drags (previously waited for chrome.storage round-trip and silently no-op'd because `Element.tagName` is lowercase in XHTML but uppercase in jsdom)
- `<input type="range">` `input` events now drive the drawer change handler (was only listening for `change`, which only fires on slider release)
- `#ntt-wordmark` / `#ntt-search` / `#ntt-clock` / `#ntt-statusbar` actually hide when their `titleBar*` pref is false — added `[hidden]` CSS overrides since `display: flex` on the ID selector previously outranked the UA `[hidden] { display: none }` rule
- Rank stat chip renders the tile's 1-indexed position (passes `this.cell.index + 1` to `TileStats.compute`); rank previously fell through to the history-permission branch and returned null for every tile
- `_ensureHistoryPermission` calls `chrome.permissions.request` synchronously from the click handler (Firefox loses the user-gesture context across async callbacks; the prior `permissions.contains` → callback → `permissions.request` chain silently failed to show the prompt)
- `updateThemeColours` no longer throws on Firefox's default theme (which returns `colors: null`) — now safely falls through to the NTT palette

### Removed

- Old `#options` modal markup and CSS scaffold (`#options-bg`, `#options-close`, `options-extra` flow)
- `toggleOptions` / `hideOptions` / `showOptionsExtra` methods
- The `options-backup-restore` button (backup/restore lives directly in the Advanced panel now)
- `themeAuto` checkbox from options pane and `options_theme_auto` locale strings (en, en-GB); pref removed from prefs.js, parsePrefs allow-list, and backup/restore allow-list

## [2026-05-28]

### Added

- NTT v2 Phase 2-2: status bar with keyboard hint pills (left) and live tile count + grid dimensions (right)
- `_updateStatusBar()` + MutationObserver on `#newtab-grid` to keep the count in sync as tiles change

### Changed

- gapMap defaults updated to match design tokens: small=10px, medium=18px (matches `--ntt-gap` token default), large=28px
- Grid `margin` pref now also scales status bar padding (medium/large)

### Security

- Bumped `web-ext` 10.1.0 → 10.3.0 to clear GHSA-ph9p-34f9-6g65 (tmp path traversal) and GHSA-w5hq-g745-h8pq (uuid bounds check) via transitive deps; `npm audit` now reports 0 vulnerabilities

## [2026-05-23]

### Added

- NTT v2 Phase 2-1: titlebar with wordmark, live clock, theme toggle, settings gear
- Titlebar prefs (`titleBarWordmark`, `titleBarSearch`, `titleBarClock`, `titleBarStatus`) for toggling each element
- Titlebar prefs added to backup/restore allow-list
- Search input in titlebar (hidden by default — wired in Phase 4)

### Changed

- Cogwheel moved to absolute top-right corner, outside content margins
- `#newtab-margin-top` padding-top removed (titlebar handles top spacing now)
- Search bar defaults to hidden (`titleBarSearch: false`) until search logic is implemented
- Removed duplicate settings gear from titlebar (cogwheel is the single settings entry point)

### Fixed

- Titlebar respects grid margin setting (padding matches side margins)
- Titlebar-to-content spacing matches `--ntt-gap` (grid spacing)
- Clock/theme-toggle right-aligned with tile grid edge

## [2026-05-21]

### Changed

- Recently-closed bar redesigned as mini-tile cards with inline "Recently Closed" label on the left

## [2026-05-20]

### Added

- feat: NTT v2 Phase 0 — design tokens, SVG icons, CSS Grid layout
- feat: NTT v2 Phase 1 — tile redesign, stats, action buttons, visual bug fixes

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
