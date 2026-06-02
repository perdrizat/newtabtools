# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2026-06-02c] — AMO listing prep, week 1 (copy + licenses)

### Changed

- `extensionName` renamed to "NewTab PowerTools" across all 20 locales that had the key (en + 19 non-en). `zh-CN` falls back to en automatically (it didn't have the key). Brand name kept in English across locales — convention for product names (PowerToys, GitHub, Microsoft all do this).
- `extensionDescription` (en only) rewritten to reflect the NTT v2 UI: "A configurable new tab page for Firefox. Auto-captures tile thumbnails of pages you visit, with full layout control and a recently-closed tabs row." Other locales' outdated translations remain (Firefox falls back to the locale's translation if present, en if not — both paths work).

### Added

- `PRIVACY.md` at repo root — privacy policy explaining local-only processing, the single outbound destination (Mozilla wallpapers service), retention/uninstall behavior. AMO listing's Privacy Policy URL will point here.
- `LICENSE` at repo root — full canonical MPL-2.0 text from mozilla.org. Manifest already declared MPL-2.0; this file makes it visible in GitHub's UI and to reviewers.
- `docs/amo-submission-notes.md` — reviewer-facing notes for AMO submission. Covers source-disclosure for the vendored minified `lib/zip.js` (BSD-3-Clause, `@zip.js/zip.js` v2.8.26), `<all_urls>` permission justification (lifted from `audit/2026-05-04-security-review.md` §2.6 + commit `da13254`), per-permission rationale, and project lineage. Paste into AMO Developer Hub's reviewer-notes field at submission.
- `docs/amo-listing.md` — canonical AMO listing copy (name, summary, long-description HTML, category, tags, support/privacy/homepage URLs, screenshots placeholder). Edit here first, then paste into Developer Hub.
- New `webextension/images/icon.svg` — NTPT wordmark (NT row 1, PT row 2) on terracotta `#c96442` background, cream `#faf8f4` letters. Matches the v2 design palette (`webextension/tokens.css`). Replaces the inherited gradient cog icon from upstream — the rebrand identity is now consistent across the new-tab UI, the addons manager, and AMO surfaces. Marked as a placeholder for the eventual designer pass.

### Fixed

- `README.md` — title and inline branding aligned to the canonical CamelCase brand "NewTab PowerTools" (was "New Tab PowerTools" spaced); status paragraph updated to reflect what Week 1 AMO prep landed and what remains (screenshots + Developer Hub submission); "Next:" checklist re-ordered to put screenshots and AMO submission ahead of MV3 migration.

## [2026-06-02b] — AMO submission readiness

### Changed

- Manifest forward-port for AMO submission: `applications` → `browser_specific_settings` (MV3-compatible key name); `strict_min_version` 128 → 140 (ESR 128 EOL'd 2025-09; ESR 140 is current and supports `data_collection_permissions`).
- `webextension/newTab.js:799` — `browser.extension.getURL` → `browser.runtime.getURL` (the `extension` namespace is MV3-removed).

### Added

- `browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }` — Mozilla's built-in data-consent declaration. Accurate for NTT: tile/thumbnail data lives in local IndexedDB; the only outbound connection is the Mozilla wallpapers service; no telemetry, no third-party endpoints.
- `tests/unit/manifest.test.ts` — regression guard asserting the data-consent declaration stays `["none"]` and the legacy `applications` key stays absent.
- `pnpm verify` script — runs `lint && typecheck && lint:webext && test:fast && build` in one command. Faster feedback loop than `pre_commit_check.sh` + manual gate-by-gate runs; E2E intentionally excluded (separate `pnpm test:e2e` for the heavier ~11-minute gate).

### Known accepted

- `web-ext lint` warning `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` — `data_collection_permissions` was added to Firefox-for-Android in version 142, our overall `strict_min_version` is 140 (desktop ESR). NTT can't run on Firefox-Android anyway (no `chrome_url_overrides.newtab` surface on Android Firefox UI). AMO accepts (0 errors). Not worth carrying an empty `gecko_android` block to silence.

## [2026-06-02] — Fork identity, pnpm migration, build pipeline

### Changed

- **Fork identity.** Extension ID changed from `newtabtools@darktrojan.net` to `newtabtools@symlink.ch` (new AMO listing). Updated in 6 places: `webextension/manifest.json`, two integration tests, three UAT tools. `package.json` `author` set to `"Markus Perdrizat"` (was empty).
- **Version reset to semver: `92.1` → `1.0.0`** in `webextension/manifest.json`. The 92.x line was Geoff's own incremental scheme inherited from upstream; restarting the line as `1.0.0` aligns with `package.json`'s already-existing `1.0.0` and gives a clean semver trail under the new AMO ID. Going forward, manifest and package versions bump together.

### Added

- `pnpm build` script in `package.json` — wraps `web-ext build` and writes the unsigned `.xpi` to `dist/` (the canonical build output, shared between UAT installation and AMO release upload). Replaces the previous long `web-ext build …` command in docs.
- UAT tools (`browser-smoke.mjs`, `mcp-server.mjs`, `fallback-cli.mjs`) now resolve the `.xpi` from a separate `XPI_DIR` (default `dist/`), while still writing their own evidence (screenshots, scenario reports) to `ARTIFACTS_DIR` (default `tests/uat/artifacts/`). Both env vars are overridable.
- `.gitignore` ignores `dist/`.
- **Package manager: npm → pnpm.** `.npmrc` adds `minimum-release-age=604800` (the 7-day supply-chain guard that `CONTRIBUTING.md` previously claimed but did not enforce — npm has no equivalent setting). Pinned via `packageManager: pnpm@10.0.0` in `package.json`; `scripts/check-pnpm.js` rejects `npm install`/`yarn install` so the guard can't be silently bypassed.
- `package.json` adds `engines` (Node ≥ 22, pnpm ≥ 10) and `preinstall` hook; `.node-version` (= 22) lets fnm/nvm pick the right Node automatically.
- `selenium-webdriver` pinned to exact `4.44.0` (was `^4.44.0`, violated the project's exact-pin rule).
- `.github/workflows/ci.yml` switched to `pnpm/action-setup@v4` + `pnpm install --frozen-lockfile`; Node now read from `.node-version`.
- Docs swept for `npm` → `pnpm` commands: `CONTRIBUTING.md`, `TESTING.md`, `UAT_PLAN.md`, `tests/uat/README.md`.

### Fixed

- `CONTRIBUTING.md` no longer claims `min-release-age=7` exists in `.npmrc` — the setting is now real (`minimum-release-age=604800`, pnpm-native) and the doc references the correct name + value + enforcement mechanism.

## [2026-06-01] — UAT tier scaffolding & doc refresh

### Added

- UAT tier prototypes under `tests/uat/_tools/`: `mcp-server.mjs` (MCP browser-control over Selenium + release Firefox), `mcp-smoke.mjs`, `browser-smoke.mjs`, `fallback-cli.mjs`, `mcp-config.json`, plus `tests/uat/README.md`.
- Checked-in UAT fixture `tests/uat/newtabtools_knowngood.zip` (`fixtureVersion: 1`; `.gitignore` negation since `*.zip` is globally ignored).
- `selenium-webdriver` devDependency for the UAT browser path.

### Changed

- Refreshed `README.md` to reflect the shipped NTT v2 UI (status bar removed; awesome bar added) and updated test-suite counts.
- Re-planned the UAT tier (`UAT_PLAN.md`) onto Selenium + geckodriver + release-channel Firefox (prototype-validated); E2E stays on ESR + Puppeteer-BiDi.
- Chose the UAT agent↔browser bridge: MCP server with **Option C** screenshots (take→disk path, read→inline on demand) over eager-inline MCP and CLI-over-Bash; documented in `UAT_PLAN.md`.
- UAT tooling writes build artifacts and screenshots to the git-ignored `tests/uat/artifacts/` — no `/tmp` dependency.
- Documented UAT dev-environment setup (release Firefox + geckodriver + deps) in `TESTING.md`, recorded the decision to keep UAT out of push/PR CI, and reconciled the `UAT_PLAN.md` fixture description (9 tiles at positions 0–8) to the actual fixture.

## [2026-06-01] — NTT v2 Phase 5 security remediation

### Security

- Removed the `connect-src https:` wildcard from the CSP — favicons now render as live `<img src=favIconUrl>` under `img-src https:` (paint-only, no fetch channel); only `data:` favicons are still cached in IDB.
- Validate `backgroundUrl` against the Mozilla CDN allow-list regex on backup restore, dropping anything else.
- Filter recently-closed tab URLs through `isValidURL` so only `ftp:`/`http:`/`https:` protocols render.
- "Reset everything" now also clears the Thumbnails and Background IndexedDB stores.

### Added

- `audit/2026-05-31-csp-tightening.md` documenting the wildcard removal, the favicon `<img>` threat model, and the empirical disproof of the `page-icon:` approach.
- CONTRIBUTING "Security-boundary changes require explicit acknowledgement" checklist (CSP/permission/allow-list/validation changes).
- Awesome-bar XSS regression test pinning attacker-controlled title/URL to `textContent`.
- Generalized CSP regression guard (`tests/unit/manifest.test.ts`): fails the build if any of `default-src`/`script-src`/`style-src`/`connect-src` carries an `http:`/`https:`/`ws:`/`wss:` scheme wildcard or a bare `*`.

### Fixed

- Grid `min-width` clamped to `min(600px, 100%)` so the drawer no longer forces horizontal overflow at narrow widths.

## [2026-05-31] — NTT v2 Phase 5: cleanup & consolidation

### Removed

- **Phase 5 cleanup.** Deleted the retired bottom status bar outright (markup, CSS, and JS — 4-0 had only hidden it) and removed the dead `#options` settings-modal CSS left over from the Phase 3 drawer migration. On startup, stale pref keys from removed features (`titleBarClock`, `titleBarWordmark`, `titleBarStatus`) are pruned from storage so they don't ride along in backups.

### Changed

- **Phase 5 cleanup.** Consolidated the drawer's legacy `<fieldset>` / `<legend>` / `<p>` markup (Pin URL, per-tile editor, history filter, Backup & Restore, Reset) onto the `.ntt-form-group` primitives used elsewhere, so all three tabs share one type scale. No behavior change.

## [2026-05-30] — NTT v2 Phase 4: status bar removed + awesome bar

### Added

- **Awesome bar (Phase 4-3).** The titlebar search box is now a working search dropdown: press `/` anywhere (preempting Firefox Quick Find) or click it, type, and pick from your tiles, bookmarks, and history, plus a "search the web" entry that uses your default engine. Up/Down to navigate, Enter to open (Cmd/Ctrl+Enter for a new tab), Esc to dismiss; the grid dims while it's open. Search is on by default (`titleBarSearch`); bookmarks/history results are best-effort behind the optional permissions. Adds the `search` permission.

### Changed

- Search box (`titleBarSearch`) now defaults **on** so the awesome bar is available out of the box.

### Removed

- **Bottom status bar (Phase 4-0).** Retired to align with the current Firefox new tab layout — the keyboard-hint pills + tile-count no longer render, the "Status bar (bottom)" drawer toggle and the `titleBarStatus` pref are gone. The removed-tile undo notice it used to host is now a standalone floating toast, so tile-removal undo still works.

## [2026-05-30] — NTT v2 titlebar: inline recently-closed + reflow fix

### Changed

- **Titlebar redesign — recently-closed inline.** The titlebar reads left→right: the recently-closed cards, then a fixed-width search box, then a single **masthead** box at the right end combining the brand wordmark with the lock + cogwheel controls. The cards live in a greedy flex container (`flex: 1 1 0`) the browser sizes to the leftover room, which also acts as the spacer pinning the masthead right; `_layoutTitlebar` reads that container's width and `computeTitlebarSlots` shrinks the cards to fill it edge-to-edge (capped at the 186px default) via `--ntt-slot-w`. Re-flows on resize, spacing/margin changes, the search toggle, and config-drawer open/close.
- The masthead, search box, and recent cards share one box treatment (surface fill, rounded, 38 px tall, subtle 1px line shadow, dark-mode adaptive).
- Two-line wordmark lockup — "New Tab" in the recent-card title style over "Powertools" in the recent-card URL style (small monospace mute), sized so the masthead matches the recent-card height.
- Captured favicons in the tile overlay badge are pinned to a uniform 16 px square (`.ntt-favicon img`) instead of the source image's natural size.
- Moved the "Recently closed" control into the Page tab's Title Bar group as a plain on/off toggle above Search (was an Off/Top segmented control in the Advanced tab).

### Removed

- Titlebar clock (and the `titleBarClock` pref/toggle + locale string) and the titlebar theme toggle — theme is still switchable via the Page-tab theme cards. The separate recently-closed strip above the grid is gone (cards live in the titlebar); the removed-tile undo notice moved into the status bar.
- The "NTT Logo" titlebar toggle (`titleBarWordmark` pref + locale string): the brand wordmark is now always shown in the masthead.

### Fixed

- Recently-closed titlebar cards now reflow reliably on config-drawer open/close, window resize and the search toggle — the count is read from the greedy card container's settled `clientWidth` instead of a `getBoundingClientRect` masthead measurement that jittered mid-transition and stuck the row at one card until reload.

## [2026-05-29] — NTT v2 Phase 3 (config drawer) + Phase 4-5 (favicons & tile visuals)

### Added

- **Configuration drawer** replacing the centred options modal — a right-side push-layout panel opened by the titlebar cogwheel and closed with Esc, organised into **Tile / Page / Advanced** tabs.
- **Tile tab** — click any tile to edit it (auto-selects the top-left tile on open), a Pin-URL "Add tile" form that accepts bare domains (`normalizePinURL`), and a per-tile thumbnail / title / colour editor.
- **Page tab** — grid size, spacing / margin / corner-radius sliders, titlebar element toggles, the wallpaper picker, and four theme cards including a new WCAG-AAA **high-contrast** theme.
- **Advanced tab** — history-tiles filter, Backup & Restore, a destructive **Reset everything** button, and a live **Auto-saved · Nm ago** indicator.
- **Real favicons on tiles** — captured alongside auto-thumbnails (`tab.favIconUrl`, 64 KB cap, stored in IDB) and shown on both the fallback glyph and the overlay badge; handles inline `data:` and third-party HTTPS favicons.
- **Domain-hashed fallback tile colours** in OKLCH (`oklch(65% 0.13 hue)`) for perceptually-uniform contrast; an explicit hex `backgroundColor` still wins.
- **State-aware pin icon** — an outline thumbtack when unpinned, a slashed `pin-off` when pinned, swapping live on toggle.
- **Firefox wallpaper metadata** — curated wallpapers honour their `background_position`; `solid_color` entries render as flat-colour backgrounds.
- New prefs `actionIconSize`, `tileActions`, `tileRadius`, `theme='contrast'`, `backgroundPosition`, `backgroundColor` — all round-trip through backup/restore.
- Tile-action **Edit** opens the drawer and selects the tile; **Refresh** also pulls a fresh title from browsing history.
- Extensive new test coverage — ~20 integration suites plus E2E for the drawer, theme cards, drag-layout, and `favicon-real-sites` (heise.de + techcrunch.com).

### Changed

- Cogwheel and lock toggle moved into the titlebar cluster (top-right, always visible); tile-editor navigation arrows removed in favour of click-to-select.
- "System" theme now adopts the active Firefox theme's colours (folding in the old `themeAuto` toggle); "Light" / "Dark" force the NTT palette.
- Default grid spacing / margin bumped small → medium for a more readable out-of-box layout.

### Fixed

- Favicon fetches were blocked by the manifest CSP for both inline `data:` URLs (now decoded in-process) and third-party HTTPS hosts (now unblocked via `https:`).
- **Reset everything** and backup-restore now take effect correctly — tiles are actually cleared (via the `Tiles.clear` message) and thumbnails / metadata refresh without a manual reload.
- Drag fixes — the grid no longer "explodes" into giant gaps, dragged tiles follow the pointer, and dragging works with the drawer open.
- Foreground opacity now also dims screenshot-less tiles; titlebar elements stay aligned when the clock / search / wordmark are hidden; sliders update live as you drag.
- E2E: eliminated an intermittent Puppeteer-BiDi navigation race (`navigateAndConfirm` confirms via frame-URL tracking instead of the racy goto event-wait).

### Removed

- The old `#options` modal scaffold and its `toggleOptions` / `showOptionsExtra` methods, the `themeAuto` pref + locale strings, the tile-editor navigation arrows, and the Pin-URL highlight animation.

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
