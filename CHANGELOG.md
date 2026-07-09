# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2.3.0] — 2026-07-10

HTML5 page conversion (Stage H of the modernization arc) + post-arc review
cleanups and repo-docs restructure. Renumbered from the retracted `v3.0.0` tag
(never shipped anywhere) — **3.0.0 is reserved for the AMO release** after the
page-modules arc (2.4.0) and the follow-up audits.

### Added

- `audit/2026-07-09-modernization-h-code-review.md`: medium-effort review of the Stage H XHTML→HTML5 conversion (no live bug; template/case/rename sweeps verified complete; flagged the unbounded pin-URL `li` walk, the narrowed loads-cleanly parse net, an inert drawer-layout test, and cleanup items incl. the orphan debug SVG).
- `PAGE_MODULES.md`: working plan for the next arc — page scripts as real ES modules / retire the `globalThis` bridge (flip-then-carve, 5 slices, ships as a minor 3.x).
- Markup well-formedness net: `tests/unit/markup-wellformedness.test.ts` rejects self-closed non-void tags in `newTab.html` (H-review §2a); generic per-template mis-nesting depth-profile guard replaces the hardcoded tile-template manifest (§2b/§6).

### Changed

- H-review cleanups executed: pin-URL autocomplete uses `closest('li')` (unbounded-walk hazard gone, §1); inert drawer-layout tagName test retargeted (§3); orphan debug SVG removed from `newTab.html` (§4); `readNewTabHtml()` helper dedupes 15 test-path copies (§5); `NEW_TAB_PAGE` constant + shared `newTabURL()` harness helper (§7); awesomebar `Promise.all` chain gains a `.catch` (June §4.4); tile-redesign's 12 redundant source-string assertions deleted, each with a verified E2E behavioral counterpart (June §5.5).
- Repo docs restructured: completed-arc working docs (`MV3_MIGRATION.md`, `MODERNIZATION.md`) removed — records live in git history and `audit/`; their load-bearing decisions absorbed into `ROADMAP.md` decisions of record; README/CONTRIBUTING/TESTING/e2e-README references redirected; ROADMAP pruned (shipped MV3 section, stale v1.0.0 line, current UAT scenario list) and backlog refreshed.

- The new-tab page is now HTML5 (H2) — `newTab.xhtml` → `newTab.html` (`<!DOCTYPE html>`, charset meta, xmlns dropped, 10 self-closing non-void tags expanded to prevent parser mis-nesting); all path touchpoints renamed (manifest, E2E/UAT tooling, ~16 structural tests); `loads-cleanly` E2E now asserts DOCTYPE + no-quirks-mode. Full UAT 11/11 on the converted page.
- 26 HTML-namespace `createElementNS` sites collapsed to `createElement` (H3; newTab.js ×7, fx-newTab.js ×12, awesomebar.js ×7); `HTML_NAMESPACE`/`HTML_NS` constants deleted; `icons.js` SVG creation stays namespaced (required).
- Docs + tooling sweep (H4): README/CONTRIBUTING/TESTING/ROADMAP reflect the modular lib/ background and HTML5 page; i18n scripts drop the dead `.xhtml` filter; stale Node/pnpm versions in TESTING.md corrected (≥24 / 11.x).

### Fixed

- Page JS made parser-agnostic ahead of the HTML5 flip (H1) — the pin-URL autocomplete's `nodeName != 'li'` walk (would crash under an HTML parser) normalized; also fixed an inert uppercase tag filter in the i18n-render E2E test.

### Removed

- CHANGELOG entries pre-2.0.0 pruned to an Archive note (recoverable via git history); leftover `debug_cmp.mjs`/`debug_verge.mjs` scratch scripts deleted.

## [2.2.0] — 2026-07-09

Background ES-module rewrite — Stage M of the modernization arc.

### Changed

- Modernization M1: background flipped to a single ES-module entry (`lib/background-main.js`, `type: module`) over a `globalThis` bridge in the six background files; behavior-identical, page scripts unchanged.
- zip.js re-vendored as the unbundled ESM core tree (`lib/zip/`, 25 files from the same pinned `@zip.js/zip.js`) + `lib/zip-global.js` bridge — the old single-file UMD build doesn't survive module loading; `update-zip` script rewritten accordingly.
- Modernization M2: IndexedDB behind `lib/db.js` `withStore()` (raw `db` global removed — unguarded access now unrepresentable; `waitForDB` handler wraps collapsed); `Tiles`/`Background` as real ES modules in `lib/tiles-store.js` (`getAllTiles`→`getGridTiles` internal rename, wire name frozen); shared `SAFE_PROTOCOLS` in `lib/constants.js` (restore boundary's copy stays independent); first test batch migrated vm-load→native import.
- Modernization M3: capture pipeline extracted to `lib/capture.js`; image processing behind `lib/thumbnail-image.js` (the documented Chrome/OffscreenCanvas seam); background.js halved (1063→545 lines); webRequest listeners defer bridge-name resolution to first event (eval-time ReferenceError avoided); favicon tests import real modules instead of regex-extracting source.
- Modernization M4: `export.js` dissolved into `lib/backup.js` (real imports; restore validation chain moved verbatim — security boundary unchanged); `zip-global.js` shim retired; hand-written `zip-core.d.ts` shadow types preserved by `update-zip`.
- Modernization M5: `background.js` dissolved — dispatch in `lib/messages.js`, all listeners in `lib/background-main.js`, capability layer in `lib/platform.js` (Chrome fork point, incl. `broadcastToPages`); `globalThis` bridge shrunk to the 5 dual-scope symbols; action sweep seeds on `onInstalled`/`onStartup` instead of every respawn; page-side `Page.*` broadcasts queue until fx-newTab globals exist (was silent drop); last background vm-load tests migrated to native imports.

### Added

- `audit/2026-07-09-modernization-m-code-review.md`: medium-effort review of the Stage M module carve-up (wire contract/response shapes/dual-scope bridge verified intact; flagged the action-sweep disable→re-enable gap, two pre-existing `readZip` robustness bugs, and the flush-queue-before-grid-build race).

### Fixed

- `Thumbnails.delete` and `cleanupThumbnails` reached the raw IDB connection unguarded on event-page wake (missed by the pre-2.1.0 sweep); now readiness-gated via `withStore`.
- Never-capture host input widened to the row (placeholder no longer clips); tile action chips gained a `--ntt-line` hairline + soft shadow so they separate from light thumbnails; UAT scenario 11 prose updated to the light-chip design.
- Restore is truly atomic (M7): wrong-shape `tiles.json`/`prefs.json` rejects before any write; orphan `tileImages/` entries ignored instead of crashing the import.
- `Export:backup` responds with an error instead of hanging the UI when `makeZip` rejects (e.g. downloads permission missing).
- Action-button seed sweep re-runs after extension disable→re-enable (session-flag guard at wake) — restores the self-heal lost with the per-respawn sweep.
- Early `Page.*` broadcast replays are fault-isolated (per-replay try/catch).
- M7 cleanups: single `withObjectStore` in `lib/db.js`; dead webRequest listener closures removed; backup/zip module lazy-loads on first use (25-file zip tree no longer parses on every event-page respawn).

## [2.1.0] — 2026-07-09

Manifest V3 migration (Firefox-only). Minimum Firefox is now **152.0**.

### Changed

- MV3_MIGRATION.md rewritten as the live migration plan (branch `mv3-migration`): ES modules and XHTML→HTML descoped from the flip, `pendingCaptures` directive corrected to `storage.session`, spike questions + slice checklist added.
- MV3_MIGRATION.md backlog updated from external code review: object-URL revocation fix queued (code deferred until reviews close), XHTML/ES-module items cross-referenced, `idb` and capture-session persistence recorded as considered-and-rejected.
- MV3_MIGRATION.md: adjudicated audit/2026-07-09-mv3-code-review.md — confirmed+widened the unguarded-`db`-on-wake finding (§2.1/§2.2) as a pre-release blocker with an ordered fix queue; declined §3.2 (racy in-memory mirror); push/AMO gated on the fixes.
- New MODERNIZATION.md: next-arc plan — background ES-module rewrite first (M1-M5, ready-gated `lib/db.js`, `lib/platform.js` Chrome seam), XHTML→HTML5 second (H1-H4); sequencing decision + rejected order recorded.
- MV3 spike findings recorded: temporary installs auto-grant host permissions; capture APIs are absent under MV3 until exactly Firefox 152.0 (bisected) → planned `strict_min_version` 152.0 and E2E on release-channel Firefox; post-MV3 note to retest against ESR 140.
- Added `audit/2026-07-09-mv3-inventory.md`: full file:line codebase inventory (background, front end, test infra) backing the migration plan.
- MV3 Slice A: removed both `extension.getViews()` sites — background/export now broadcast `Page.updateGrid`/`Page.restoreComplete`; new page-side `runtime.onMessage` listener; restore refresh (incl. prefs-only path) is message-driven.
- MV3 Slice B: respawn-safe background — duplicate-tolerant menu creation, IDB auto-reconnect (`onclose`/`onversionchange` + retryable `waitForDB`), `pendingCaptures` moved to `storage.session`, thumbnail cleanup capped at once daily, `storage.onChanged` listener registration made synchronous.
- MV3 Slice C: background/popup callback-style `chrome.*` calls normalized to promise-based `browser.*` (async `captureTab` rewrite preserving session-identity semantics); `chrome.browserAction` kept for the Slice D rename.
- MV3 Slice D: manifest flipped to MV3 (`action`, CSP object, `host_permissions: ["<all_urls>"]`, `strict_min_version` 152.0); capture path degrades gracefully when host permissions are revoked; E2E tier moved to release-channel Firefox with a 10s event-page idle timeout + new suspension-recovery E2E test; `build-uat.mjs`/UAT preflight updated for MV3/Firefox ≥152.

### Fixed

- MV3 respawn-reload bug (caught by UAT): new-tab-page reload sweep moved from top-level (re-ran every event-page respawn, reloading open pages every ~30s and killing drawer/edit-mode state) into `runtime.onInstalled`.
- Wake-race db access (audit §2.1/§2.2, widened): all db-touching message handlers + the capture path's `ensureReady` now guard on `waitForDB()`; `Tiles._ready` set only after a successful read (was stuck true on a thrown transaction); deterministic wake-race regression suite added.
- `pickAndStore` re-guards the IDB connection after its async chain and catches failures (connection could drop mid-capture, losing the thumbnail as an unhandled rejection).
- `pendingCaptures` read-modify-writes serialized through one write chain (concurrent background-tab navigations could clobber each other's deferred captures).
- Backup export now revokes its object URL when the download completes/fails (previously leaked one blob per export).

## [2.0.7] — 2026-07-06

### Added

- Never-capture privacy list (GH #1): listed hosts are never screenshotted; per-tile camera toggle + Advanced-drawer host editor; adding a host purges its stored captures (`Thumbnails.purgeHost`).
- Capture-pipeline never-capture guards at every write path (`startCaptureSession`, `onCompleted`, `Thumbnails.save`, `pickAndStore`); `NeverCapture` model reuses the filter-row host semantics.
- Backup restore carries `neverCaptureHosts` (validated, normalized, purged per entry after tiles restore) — restore allow-list grew; boundary acknowledged in `audit/2026-07-05-never-capture-restore-allowlist.md`.
- Fast/E2E/UAT coverage for the never-capture feature (new `never-capture*.test.ts` files; scenarios 11 + 22 updated).

### Changed

- Docs: README, PRIVACY (new "Controlling thumbnail capture" section, last-updated 2026-07-05), and AMO listing/reviewer notes cover the never-capture list; README dev prereqs corrected to Node ≥24 / pnpm ≥11.
- Never-capture Advanced UI polish: shorter (≤2-line) helptext and a left-aligned add-host row; UAT scenario 22 now asserts both.
- Test harness fails fast on a bad Firefox env: UAT preflight adds a real geckodriver+Firefox launch handshake (catches the snap-geckodriver/wrong-binary class in ~1.5s instead of a 300s daemon hang), the UAT runner aborts the health-wait the moment the daemon exits, and `run_esr_tests.sh` validates the ESR binary up front and aborts the port-wait if web-ext dies. Both tiers honor a `$FIREFOX_ESR_BIN`/`$FIREFOX_BIN` override.
- Migrated 6 transient/dialog components (wallpaper picker, pin-URL autocomplete, undo-toast buttons, shared close-button, awesomebar, database-error) onto `--ntt-*` design tokens with dark/contrast/forced-colors coverage; removed hardcoded `#b2aeaa`/`#0a84ff`; added `tests/integration/ui-consistency.test.ts` as a regression guard.

### Removed

- Per-tile Refresh action button; its on-demand title-refresh-from-history had no general replacement (titles still refresh on Set-URL and first-pin). Toolbar-popup capture unchanged.

## [2.0.6] — 2026-06-23

### Changed

- `engines.node` floor raised to `>=24` (drops the untested Node 22 claim; matches `.node-version`).
- UAT preflight now rejects a Firefox whose `--version` isn't clean — catching the Ubuntu snap-wrapper / missing-`xdg-utils` breakage with an actionable message instead of a geckodriver stack trace — aligns its Node/pnpm floors to ≥24/≥11, and is runnable standalone via `pnpm test:uat:preflight`.
- `tile-redesign.test.ts`: replaced the redundant fx-newTab.js source-string assertions with behavioral coverage (stat-chip fresh/non-fresh, favicon glyph via the shared `siteGlyph`), keeping one controller-wiring check.
- E2E `connectToFirefox` now retries the WebDriver-BiDi handshake (bounded) to cut transient CI connect flakes.
- UAT runner writes an aggregate `summary.md` (scenario×verdict table + "needs attention") alongside `report.json`; UAT README gained a preflight-failure troubleshooting section.

### Added

- `tests/integration/stats.test.ts` — edge-case coverage for `TileStats` (`formatCount`/`formatAge`/`compute`): huge counts, clock-skew negative age, zero visits, future-visitTime, and the stat-type branches.

### Security

- Removed the temporary `minimumReleaseAgeExclude: [undici]`: undici 7.28.0 has cleared the 7-day window, so the supply-chain guard now applies to it with no carve-out.

## [2.0.5] — 2026-06-22

### Changed

- Toolchain upgraded to Node 24 (`.node-version`) and pnpm 11.6.0 (`packageManager`, `engines.pnpm >=11`); pnpm-native settings moved from `.npmrc`/package.json to `pnpm-workspace.yaml`.
- Dev deps bumped: web-ext 10.4.0, puppeteer-core 25.1.0, @types/node 24.13.2, eslint 10.5.0, @typescript-eslint/{eslint-plugin,parser} 8.61.0, vitest 4.1.8, globals 17.6.0.

### Security

- Closed pre-existing high advisories in transitive test deps via overrides: undici → 7.28.0 (GHSA-vmh5-mc38-953g / -vxpw-j846-p89q / -hm92-r4w5-c3mj, via jsdom) and hono → 4.12.25 (GHSA-88fw-hqm2-52qc, via @modelcontextprotocol/sdk).
- Supply-chain age guard now actually enforced: `minimum-release-age` was inert under pnpm 10.0.0; reconfigured as `minimumReleaseAge: 10080` (minutes — the old `604800` was seconds) in `pnpm-workspace.yaml`, enforced by pnpm 11, with a scoped `minimumReleaseAgeExclude: [undici]` for the freshly-published fix.

### Removed

- shell-quote `pnpm.overrides` pin — web-ext 10.4.0 (→ fx-runner 1.5.0) ships shell-quote 1.8.4 natively.

## [2.0.4] — 2026-06-13

### Fixed

- Version-sync CI failure: `manifest.json` had drifted to `2.0.1` while `package.json` was `2.0.3` (the 2.0.2/2.0.3 bumps committed without the prebuild manifest sync); today's bump realigns both.

### Added

- `version` lifecycle script — `pnpm version` now runs `scripts/sync-version.mjs` and stages `manifest.json` into the bump commit, so the manifest can't drift from `package.json` again.

## [2.0.3] — 2026-06-11

### Added

- `.github/dependabot.yml` — security-only: version-bump PRs suppressed (`open-pull-requests-limit: 0`) to honor the hard-pin policy, security fixes grouped. Requires the repo "Dependabot security updates" toggle to activate.

### Security

- Pin `shell-quote` to 1.8.4 via `pnpm.overrides`, closing critical advisory GHSA-w7jw-789q-3m8p (transitive via `web-ext` > `fx-runner`; dev-tooling only, but CI's `pnpm audit --audit-level=high` gates on it).

### Changed

- CONTRIBUTING "Before Committing": `pnpm audit --audit-level=high` is now an unconditional pre-commit step (advisories surface against unchanged deps), not only after touching `package.json`/`pnpm-lock.yaml`.
- CONTRIBUTING: new "Keeping dependencies current" subsection — the manual `pnpm outdated` update ritual + quarterly cadence, the security-vs-staleness split, and Dependabot's security-only scope.

## [2.0.2] — 2026-06-10

### Added

- `audit/2026-06-10-code-review.md` — post-2.0.x deep review; §8 dev response disputed five findings (two disproven by cross-tier test search), §9 reviewer adjudication upheld all five, §10 closes with the agreed action list (executed below).
- Behavioral tests: Reset click→confirm-reveal gate (`confirm-gate.test.ts`), toolbar-popup button→message glue (`action-popup.test.ts` — E2E can't open browser-action popups), and object-URL revocation contracts (`objecturl-revoke.test.ts`).

### Changed

- TESTING.md "Test Design Principles": source-grep exemption bounded — a source-string match may never be the sole coverage for a functional behavior, and the `ntt/no-source-grep` justification must say why a behavioral test isn't possible (CONTRIBUTING "Before Committing" points at it).

### Fixed

- Object-URL leak (audit §4.3): all six `URL.createObjectURL` sites in `newTab.js` now revoke prior URLs (owner-keyed `_freshObjectURL`/`_dropObjectURL` helpers; per-site stash shared with `fx-newTab.js`'s `refreshThumbnail`; batch revoke for recently-closed favicons; one-shot decode-source revoke).
- `console.exception` → `console.error` in `fx-newTab.js` (deprecated non-standard alias; forward-compat nit per audit §9.3).
- Lint to zero warnings: removed 4 stale `eslint-disable` directives (audit §4.2).

## [2.0.1] — 2026-06-09

### Added

- Translator workflow: `pnpm i18n:check` (untranslated keys), `pnpm i18n:stale` (dead keys), and `pnpm i18n:purge` (remove dead keys) CLI tools, plus a "Translating" guide in CONTRIBUTING.
- German (`de`) translation substantially expanded toward full coverage.
- `ntt/no-hardcoded-text` ESLint rule + a Vitest XHTML check, preventing literal `.textContent` assignments and raw markup text from eroding i18n coverage.
- i18n regression guards: a cross-locale placeholder-integrity test (all 22 locales — catches a named `$NAME$`/`$1$` token with no `placeholders` block), an E2E render smoke (no raw message keys or `$N`/`__MSG_` leaks in the live page), and a text-integrity observation folded into the config/advanced/titlebar UAT scenarios.

### Changed

- Remaining hardcoded English extracted to `messages.json` and resolved via i18n: the drawer title/tabs, the awesomebar section headers (`SECTION_LABELS`) + search placeholder, and the wallpaper-dialog strings.
- Stale locale keys (in a translation but not `en`) are no longer a CI-gating test — maintenance drift handled by `pnpm i18n:stale`/`pnpm i18n:purge`, completeness by `pnpm i18n:check`; runtime-breaking i18n issues stay gated.
- TESTING.md setup: added the Node-version-manager (`fnm`) install prerequisite before `fnm install`, and merged the Firefox-ESR + UAT-tooling install steps into one section with a "Verify E2E & UAT tooling" box (`firefox-esr`/`firefox`/`claude` checks).

### Fixed

- CI flake: the `favicon-real-sites` E2E test (the only test that hits live third-party sites) now runs by default everywhere except GitHub Actions — gated on `GITHUB_ACTIONS` so every contributor exercises the live favicon path locally with no setup, while GitHub CI skips it; the §1.1 favicon logic stays covered deterministically at the Fast tier.

## [2.0.0] — 2026-06-08

First Mozilla Add-ons (AMO) release of the continuation fork as **NewTab PowerTools**.

### Added

- History-tiles filter: an explicit ✕ remove control on each filter row (deletes the entry; the existing step-the-limit-to-"Unlimited" path still works); the "Filter…" button is now a real toggle (panel starts hidden, caret reflects open/closed) instead of a one-way reveal.
- `Filters.normalizeHost()` + `Tiles._hostFilteredOut()` (extracted, unit-tested matching predicate — semantics unchanged).
- About section is now the brand home: the logo + title link to the AMO listing (opens in a new tab), with a separate "Source on GitHub" link; the whole block is left-aligned and all external links carry `rel="noopener"`.
- OS forced-colors support: an `@media (forced-colors: active)` block styles the tile action buttons with system-color keywords so they honour the user's HC palette.

### Changed

- High-contrast: the manual contrast theme renders the destructive ✕ with the same red fill (`#cc1633`) as light/dark — the white icon + white ring carry legibility on the black ground; the neutral trio are outlined max-contrast buttons. Only true OS `@media (forced-colors: active)` drops the hue (the OS strips custom colours), falling back to a system-colour inverted ✕ treatment.
- Restore "Choose file…" picker is now a themed `<label>` (the native `<input type=file>` is visually hidden) so it matches the drawer buttons in every theme; the selected filename shows in themed type.
- Edit mode: clicking a tile body (not an action button) opens the Tile dialog prefilled for that tile (edit URL / thumbnail / bg colour) from any drawer tab; drag still = Move.
- Recently-closed cards fall back to the extension's stored favicon (collected during tile capture) when the session record carries none, before the letter-block glyph.
- About links row is left-aligned (was centered).
- Add-tile autocomplete dropdown now uses the UI sans font — the page's `font: message-box` was leaking a system serif into it (the rest of the drawer already overrode it).
- Tile editor: the thumbnail "Choose image…" picker is now a themed `<label>` (native `<input type=file>` hidden), matching Backup/Restore; secondary (ghost) drawer buttons gained a subtle filled surface so Set/Remove read as buttons in every theme (were near-invisible transparent outlines); "Save current thumbnail" renamed to "Pin current thumbnail" (it pins the current capture so auto-refresh won't overwrite it).
- Tile tab reworked: the two sections are now "Pin next tile:" and "Update current tile:" (split by a separator). The edit rows are uniform — content left-aligned, [Set]/[Remove] right-aligned: URL ([Change URL] [Set] [Remove → deletes/unpins the tile]), Title ([Change title] [Set] [Remove → reverts to the auto title]), Pin current thumbnail ([Remove → reverts to the auto thumbnail]), Choose image ([Set] [Remove → clears the file pick]), and Background colour. The redundant "Saved image:" / "Title:" labels and the read-only URL line were dropped (the input shows + edits the URL).
- Page tab: the wallpaper row is now [Choose wallpaper] (left) / [Remove] (right). Advanced tab: the "Filter…" button is left-aligned.
- Edit-mode affordances scale with the tile: the drag handle and the "+ Pin tile" control are matching **landscape** pills sized to ~26% of the tile's shorter side tall (capped), with the grip rotated 90° to fit and the "+ Pin tile" font scaling (kept on one line). `.newtab-site` is now a CSS size container (`container-type: size`) to drive this via `cqmin`. The drag handle, "+ Pin tile", and the tile action buttons all share one `--ntt-float-shadow` token (theme-adaptive ring + drop shadow) so they match.
- Recently-closed letter-fallback favicon now derives from the registrable domain (same as tiles), not the page title.
- History-tiles filter host input is normalized on set (trim/lowercase, extract host from a pasted URL, map `*.example.com`→`.example.com`, strip path/trailing-dot) so exact-host filters reliably match. Exact-host semantics unchanged: `www.example.com` limits only that host, `.example.com` spans all subdomains. The filter panel's helptext/layout is left-aligned to the Advanced-tab rhythm (was centered).
- Edit-mode selection cue (regression fix): the redundant dashed outline is dropped from pinned tiles; the single copper **selection ring** (white-separator halo, readable on any thumbnail) now marks the one tile open in the Tile tab; dashed is reserved for the candidate ("add here") slots.
- Edit-mode candidate slots: stop dimming the thumbnail (`opacity:0.25` removed — no wallpaper bleed); keep the full thumbnail under a light scrim with an opaque "+ Pin tile" chip; the page wallpaper dims (~40%) in edit mode so gaps go calm.
- "+ Add tile" → "+ Pin tile": clicking it now pins the history candidate immediately (same as the Pin action) and opens the Tile menu with that tile selected.
- Danger colour moved to a cooler alarm red `#cc1633` (hue ~353°) in light/dark — ~22° off the copper accent (was a near-copper red that blurred with the Edit-mode selection ring). The destructive ✕ action button is now a filled danger button with background-independent separators (white icon + translucent-white ring + drop shadow), slightly larger and gapped from the neutral trio, so it stays legible on any thumbnail in both themes. Each neutral button (edit/refresh/unpin) carries its own surface — a hairline ring + drop shadow — instead of a shared bar behind the cluster, so every button reads on white-on-white / dark-on-dark thumbnails. Accent untouched.
- Renamed user-facing copy/links to "NewTab PowerTools" (the Geoff Lankow lineage credit keeps "New Tab Tools"). Internal identifiers (extension id, storage/pref keys) unchanged.

## Archive

Entries before 2.0.0 (the first AMO-era release: the 1.0.x fork bootstrap,
the NTT v2 redesign phases, AMO listing prep, and the original takeover
security work) were pruned on 2026-07-10. They are fully recoverable from
git history (`git log --follow CHANGELOG.md`); the takeover-era security
reviews live in `audit/`.
