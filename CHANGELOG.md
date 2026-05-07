# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2026-05-07]

### Added

- `Tiles.clear` message handler in `background.js` — enables single-operation IDB wipe for test cleanup
- Hermetic E2E test fixtures — all 17 test files call `resetTestState(browser)` in `beforeAll` to clear tiles and reset prefs, ensuring tests pass regardless of execution order
- Extension globals (`Prefs`, `Grid`, `Tiles`, etc.) declared in ESLint config for E2E and integration test files

### Changed

- `resetTestState` rewritten for speed: uses `Tiles.clear` (single IDB clear) instead of `getAllTiles` + per-tile `removeTile`, writes all prefs in one `chrome.storage.local.set` call with a read-back fence, skips full Grid init
- `waitForGridReady` now polls `Grid.ready` (actual init completion) instead of `#newtab-scrollbox` (static XHTML element that exists before JS runs)
- Reduced `page.goto` timeout from 10s to 3s in E2E helpers — the `domcontentloaded` event never fires for `moz-extension://` pages via BiDi, so the timeout is always caught
- `configurable-grid.test.js` calls `Grid.refresh()` directly after setting prefs, bypassing unreliable `storage.onChanged` async chain
- `lock-grid.test.js` pins a test tile before asserting control visibility (controls don't exist without tiles)
- Added "how to run" note to TESTING.md clarifying that E2E tests must be run via `npm run test:e2e`, not `npx vitest` directly

### Fixed

- E2E suite reliability: 4 of 17 test files were timing out at 60s in `beforeAll` due to slow `resetTestState`. Suite time dropped from ~13 min to ~6 min with all 35 tests green.

- **Phase 1 feature characterization — slots 5–16 (complete).** Localization smoke test (`tests/unit/localization.test.ts`, 10 tests), pin/unpin tile logic (`tests/integration/tiles-pin.test.ts`, 21 tests with in-memory IDB mock), settings persistence (`tests/integration/prefs-persistence.test.ts`, 44 tests covering Prefs/Blocked/Filters), tile editing (`tests/integration/tile-editing.test.ts`, 13 tests covering title/URL/thumb/bgcolor/background), drag-reorder (`tests/integration/drag-reorder.test.ts`, 13 tests covering Drag/Drop/lock guard/HTML-escaping), theme switching (`tests/integration/theme.test.ts`, 19 tests covering light/dark/auto theme + contrast detection + browser.theme API), layout features (`tests/integration/layout.test.ts`, 21 tests covering rows/columns/opacity/margin/spacing/titleSize/locked UI wiring), filter cap with subdomain wildcards (`tests/integration/filter-cap.test.ts`, 16 tests covering exact/wildcard matching + UI plus/minus buttons), recently-closed tabs (`tests/integration/recent-tabs.test.ts`, 17 tests covering refreshRecent + one-click restore), page background + hide history (`tests/integration/background-and-history.test.ts`, 9 tests covering refreshBackgroundImage rendering + Prefs.history toggle), auto-thumbnail (`tests/integration/auto-thumbnail.test.ts`, 25 tests covering capture pipeline + display + cleanup + known working/failing URL characterization). Slot 4 (optional-permission flows) deferred — no security trust boundary.
- **Phase 1 E2E characterization — slots 17–29 (complete).** 24 E2E tests across 12 new test files covering every differentiating and key parity feature: auto-thumbnail capture + persistence, arbitrarily large tiles flex layout, configurable columns/rows + persistence, layout micro-tuning (opacity/titleSize/spacing/margin), lock-grid toggle + control visibility, per-tile background color set/reset, per-domain filter cap UI + plus/minus buttons, recently-closed-tabs row + toggle, page background image upload/remove, light/dark/auto theme switching + darkIcons, drag-reorder via synthetic DnD + persistence, per-tile custom title + custom thumbnail, add-shortcut autocomplete from tabs + URL validation gate. Also fixed pre-existing pin-persists E2E test (Puppeteer BiDi click → dispatchEvent).

## [2026-05-05]

### Added

- **Phase 1 security boundary characterization — slots 1–3 complete:** Three integration test suites (56 tests) + one E2E suite (2 tests) + one unit suite (14 tests) covering every security boundary from the pre-takeover audit
  
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
