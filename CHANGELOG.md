# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2.5.0] — 2026-07-13

### Added

- ESLint guard (`no-restricted-globals` on `webextension/lib/**/*.js`, seam `lib/thumbnail-image.js` and vendored `lib/zip/**` excluded) forbidding `document`/`window`/`Image`/`OffscreenCanvas`/`DOMParser`/`XMLSerializer`/`localStorage` in the background scope, plus a regression test asserting the rule via ESLint's own config resolution (CHROME_PREP.md C1).
- `webextension/dom.js`: page-side `el(tag, className, text)` DOM-builder leaf + `tests/unit/dom.test.ts`; mechanically normalized 26 of the 37 `document.createElement` blocks across `newTab.js`/`fx-newTab.js`/`awesomebar.js` onto it (behavior-identical; CHROME_PREP.md C2).
- `tests/unit/raw-module-eval.test.ts` + `tests/unit/_fixtures/raw-import-page-graph.mjs`: raw-Node (no vite transform) import of page-main.js asserting the failure class is a missing-browser-API ReferenceError, never SyntaxError or a TDZ `before initialization` — the permanent tripwire for the C3b TDZ incident class the fast tier cannot see.
- `tests/e2e/run_esr_tests.sh` gains a `mkdir`-based concurrency lock (`tests/e2e/.runner-lock`, PID-checked, stale locks reclaimed) that refuses a second concurrent invocation instead of letting it clobber the first run's shared profile dir/port.
- `webextension/lib/platform.js` (background) and new `webextension/api.js` (page) each export `api`, a normalized namespace leaf routing every `browser.*`/`chrome.*` call through one identifier (chrome-prep C5a, CHROME_PREP.md); `api` is a live-resolving Proxy over `globalThis.browser ?? chrome` (not a frozen `const`) so per-test global reassignment keeps working. Every raw call site under `webextension/` (page + `lib/**`, excluding vendored `lib/zip/**`) now reads `api.*` — namespace-only, no call-shape/argument changes; behavior-identical on Firefox (full `pnpm test` green, including the full E2E suite).
- Six Chrome-prep capability wrappers, homed per `audit/2026-07-11-chrome-api-divergence.md` (chrome-prep C5b): `lib/platform.js` gains `sessionGet`/`sessionSet` (`storage.session`, documents the Chrome `TRUSTED_CONTEXTS`/10MB-quota divergence), `isCaptureAvailableViaPermission` (Chrome-dormant permission-based fork of `isCaptureAvailable`, unwired), and `syncActionIconWithTheme` (Chrome-dormant action/theme-icon no-op stub); `webextension/api.js` gains `searchWeb` (Firefox `search.search` unconditionally preferred over `search.query`, since Firefox 94+ has both); `webextension/common.js` gains `topSitesOptions` (shared `getBrowserInfo` short-circuit, replacing the `lib/tiles-store.js`/`filters-ui.js` duplicate). All six are Firefox-behavior-identical; Chrome paths are written but dormant (no Chrome manifest yet).
- Two-target manifest authoring (chrome-prep C6, CHROME_PREP.md): `manifest/base.json` (shared fields) + `manifest/firefox.json` (the live target) + `manifest/chrome.json` (dormant MV3 overlay — module `service_worker`, no `theme_icons`/`browser_specific_settings`/`menus` permission) merged by `scripts/build-manifest.mjs` (shallow, top-level-key-only merge; deterministic key order; version injected from `package.json`, not carried by any manifest source file); `scripts/sync-version.mjs` now regenerates the committed `webextension/manifest.json` through this merge instead of patching its version field directly. `pnpm build` gains a target arg (`firefox` default, byte-identical to before; `chrome` stages `dist/chrome-build/` and zips it, unvalidated beyond "it builds") via new `scripts/build.mjs`. Guard test `tests/unit/manifest-authoring.test.ts`; see `manifest/README.md`.

### Changed

- E2E/UAT harness stops reading page globals entirely (chrome-prep C3d, CHROME_PREP.md maintainer directive 1): `tests/e2e/_helpers.ts`'s `waitForGridReady` polls DOM (`#newtab-grid .newtab-cell`) instead of `Grid.ready`; `clearPinnedTiles`/`resetPrefs`/`resetTestState` drive `Tiles.clear`/`browser.storage.local` messages; new shared helpers (`setPrefs`, `getPref`, `getFilters`/`setFilter`, `openDrawerUI`/`closeDrawerUI`/`switchDrawerTabUI`, `siteLinkExists`, `nudgeRecentRefresh`) replace `(window as any).Prefs/Grid/newTabTools/Filters` reads across all 27 affected E2E test files; drag tests (`drag-layout.test.ts`, `drag-reorder.test.ts`) now drive real synthesized `dragstart`/`drag`/`dragend`/`drop` `DragEvent`s on real tile/cell nodes instead of calling `Drag.start()` directly with a mock event (known-flaky class, accepted by directive; quarantine policy documented in each file's header). UAT's `browser-daemon.mjs` was already message-driven; scenarios `23-edit-mode-design.md`/`31-titlebar.md` move their one `window.Grid`/`window.Prefs` step to DOM observation / `browser.storage.local`.
- Four vm-harness tests (`recent-tabs.test.ts`, `objecturl-revoke.test.ts`, `favicons.test.ts`, `favicon-overlay-and-pin.test.ts`) that extract page methods by source instead of importing them now also expose the real `el` on `globalThis`, mirroring the existing `isValidURL` exposure, since the C2 sweep introduced the same bare-identifier dependency inside the extracted method bodies.
- `webextension/fx-newTab.js` and `webextension/newTab.js` are both fully-typed checked JS (real JSDoc — no `any`-cast escape hatches beyond the documented `globalThis` bridge exceptions); the staged `@ts-nocheck` scaffold on newTab.js is gone (CHROME_PREP.md C3b/C3c, error trajectory 390 → 0).
- C3b TDZ incident (E2E-caught, fixed in-slice): the `newTabTools` cycle-import typing moved off a top-level `const` read (raw-load `ReferenceError: … before initialization`, page never booted) onto newTab.js's export itself via `NewTabToolsPageRefs` + const-impl/typed-export (the prefs.js `PrefsAccessors` pattern).
- `tiles-shim.js` gains a real `Tile` typedef (mirroring `lib/tiles-store.js`'s) and precise `Tiles.*` method signatures, surfaced by fx-newTab.js's now-checked usage; `Tile` also gains `titleIsUserSet` and `Background.setBackground`'s `file` param becomes correctly optional (C3c — both surfaced by newTab.js's now-checked usage).
- `tsconfig.json`'s `lib` gains `ES2021` (newTab.js's `getThemedImageURL` genuinely calls `String.prototype.replaceAll`; `noEmit: true` so this never affects emitted code) (C3c).
- `tests/integration/_helpers.ts`'s `ensureSiteEnv`/`mountSite`, and the `fx-newTab.js` import in `drag-reorder.test.ts`/`tile-url-render.test.ts`, drop the computed-path `webextPath(...)` obfuscation for a literal-string dynamic `import()` now that `tsc` type-checks fx-newTab.js directly (still dynamic, not static, to preserve DOM-mount-before-import ordering); the now-dead `webextPath`/`WEBEXT_DIR` helper is deleted (C3c, no remaining call sites).
- `fx-newTab.js`'s `Transformation`/`Updater`/`UndoDialog` singletons move verbatim to their own `webextension/transformation.js`/`updater.js`/`undo-dialog.js` modules (chrome-prep C4a, CHROME_PREP.md; fx-newTab.js 2550 → 1961 lines); `page-main.js`/`newTab.js` and every test consumer re-point to the new specifiers (no re-export shim). `Cell` gains a real `export` (previously module-local) so the movers can reference it as a type via `import('./fx-newTab.js').Cell`.
- `fx-newTab.js`'s drag-and-drop subsystem (`Drag`/`Drop`/`DropTargetShim`/`DropPreview` + their shared `DELAY_REARRANGE_MS` constant) moves verbatim to a new `webextension/drag-drop.js` module (chrome-prep C4b, CHROME_PREP.md; fx-newTab.js 1961 → 1200 lines). `DropTargetShim`/`DropPreview` gain a real `export` (previously module-local `var`), matching the other two's existing export; `fx-newTab.js` re-points its own `Drag`/`Drop`/`DropTargetShim` use to the new specifier (no re-export shim), and `transformation.js` re-points its `Drag` import likewise. `page-main.js`'s import list is unaffected (it never called any of the four directly).
- `fx-newTab.js` is DELETED (chrome-prep C4c, CHROME_PREP.md): its remaining `Page`/`Grid`/`Cell`/`Site` singletons + helpers move verbatim into four new modules — `webextension/page.js` (73 lines, `Page`), `webextension/grid.js` (233 lines, `Grid` + the `Link` type-import), `webextension/cell.js` (265 lines, `Cell` + the `DOMRect` polyfill/`NttRect` typedef, placed with `Cell` as its dominant in-file consumer, + the `CellNode` typedef), `webextension/site.js` (701 lines, `Site` + `siteGlyph`/`siteHue`/`siteBrandColor` + the `Link`/`SiteNode` typedefs). `newTab.js`/`page-main.js`/`transformation.js`/`updater.js`/`undo-dialog.js`/`drag-drop.js` and every test consumer re-point to the new specifiers (no re-export shim); `page-main.js`'s import list stays at ten entries (honest accounting, C4b precedent — it only ever named-imported `Grid`, now from `grid.js`; `cell.js`/`site.js`/`page.js` are reached transitively). `tsconfig.json`'s `include` drops the `fx-newTab.js` entry outright rather than adding four new ones — all four new modules are reachable via import-following from the remaining `newTab.js` entry, verified by an unchanged `pnpm typecheck` error count (zero).
- `newTab.js` splits into seven new leaf modules (chrome-prep C4d, CHROME_PREP.md; newTab.js 2891 → 1991 lines): `theme.js` (194 lines), `wallpaper.js` (258 lines), `titlebar.js` (393 lines), `autosave-indicator.js` (88 lines), `filters-ui.js` (129 lines), `object-urls.js` (46 lines), `ui-refs.js` (58 lines, a narrow six-field shared-`uiElements` sibling — newTab.js keeps its own `uiElements` table for every other, residual-only ref). All extracted verbatim (types travel unchanged); residual newTab.js imports and calls their exports directly at every former `this.X`/`newTabTools.X` call site. `page-main.js`'s import list grows ten → eleven (`_markAutoSaved` from autosave-indicator.js, its one direct call; the other six leaves are reached transitively, C4b/C4c honest-accounting precedent). ~35 vm-harness/real-import integration tests re-point to the new specifiers or the real `Prefs`/`Grid`/`Background`/`uiRefs` singletons (a stand-in `globalThis.Prefs = {...}` no longer reaches a real-imported module — the `ensureSiteEnv` "second-order fallout" class); `titlebar.js`/`filters-ui.js` extend the existing newTab.js↔grid.js↔site.js cycle with one more call-time-only `Grid.sites` read each.
- `lib/background-main.js`'s context-menu creation/`onShown` registration and `newTab.js`'s `menus.onShown`/`onClicked` registration are now presence-gated on `api.menus` (single guard around the whole block, each scope) — registers nothing (not throwing) when `menus` is absent, expressing Decision 1 for a future Chrome build; unchanged on Firefox (chrome-prep C5b).
- `lib/tiles-store.js` and `filters-ui.js`'s duplicated `topSites.get()` options branch (one `await`-style, one callback-style) both now call `common.js`'s shared `topSitesOptions(api)` (chrome-prep C5b, closing the C5a-deferred dedup).
- `awesomebar.js`'s web-search dispatch now calls `api.js`'s `searchWeb` wrapper instead of `api.search.search` directly (chrome-prep C5b).
- `permissions.request` call sites (`newTab.js`) and the network-idle `webRequest` listeners (`lib/background-main.js`) gain one-line comments flagging Chrome-specific gotchas (user-gesture strictness; no MV3 `'blocking'` support) — comment-only, no behavior change (chrome-prep C5b, audit §traps).
- ROADMAP.md dissolution (C-gate docs sweep): AMO release process moved to `CONTRIBUTING.md` "Releasing to AMO"; code-constraining decisions of record moved to `CONTRIBUTING.md` "Decisions of record"; Scope & North Star / Non-goals moved to `README.md` "Scope"; remaining backlog items drafted as GitHub issues (Chrome extension stage 3, favicon cursor-walk dedup, UAT backlog scenarios, README troubleshooting, SARIF/JUnit result surfacing) rather than filed directly. `ROADMAP.md`/`PAGE_MODULES.md` flagged for deletion (pending orchestrator removal); every markdown cross-reference redirected to `CONTRIBUTING.md`, `README.md`, `CHANGELOG.md`, or `CHROME_PREP.md` as appropriate.
- `CONTRIBUTING.md`'s Architecture section rewritten to describe the post-chrome-prep page (~20 feature modules grouped by concern) and the `api` capability-seam design; Key Files list updated (`fx-newTab.js` removed, `api.js`/`manifest/README.md`/`README.md` added).
- `TESTING.md` gains the raw-module-eval tripwire note, the E2E runner concurrency lock, and the drag-test quarantine policy; stale `ROADMAP.md`/`PAGE_MODULES.md` links redirected.
- `CHROME_PREP.md`'s status header updated to record all arcs (C0–C6) complete, pending the C gate.

### Fixed

- `tests/integration/drag-invariants.test.ts`'s `--ntt-rows`/`--ntt-cols` wiring-check regexes tolerate the JSDoc type-assertion casts chrome-prep C3b added around `Prefs.rows`/`Prefs.columns` (type-only, erased at runtime).
- Six `'Grid' in window` sniffs in `newTab.js` (statType chip re-render, cacheCellPositions rAF, never-capture button refresh, data-selected ring sweep, history-permission chip re-render, applyTileAspect) flipped from always-true to always-false when C3d deleted the `globalThis.Grid` bridge, silently disabling their branches — sniffs dropped (`Grid` is a real import; real null-guards like `Grid.node` kept); caught by the full-E2E rank-chip failure.
- `Tiles.removeTile` wire misuse: seven E2E call sites sent `{ url }` but the dispatch reads `message.tile` (silent cleanup no-op); plus twelve sites sent `Tiles.unpinTile`, which is not among the 19 frozen wire names at all (also silent no-op) — all nineteen swapped onto a new `removeTileByUrl(page, url)` helper in `tests/e2e/_helpers.ts` (getTile→removeTile, wire-shape gotcha documented).
- Fixed-sleep-after-`setPrefs` races (fixed sleep vs the async storage.onChanged→updateUI chain, flaky under full-suite load) converted to bounded DOM polls: drawer.test.ts (rank chips), tile-aspect.test.ts (tileaspect attr), layout-tuning.test.ts (titlesize/spacing/margin), filter-cap.test.ts (filter-button enablement), drag-reorder.test.ts (locked attr), recent-tabs.test.ts (stored-favicon img).
- `webextension/drag-drop.js`'s `DropTargetShim._drop` no longer dereferences a `null` `_lastDropTarget` (TypeError when a drop lands with no cell under it) — early-returns instead; adjudicated chrome-prep C3b typing finding.
- `webextension/newTab.js`'s pin-URL autocomplete `maybeAddItem` no longer throws on a title-less tab/bookmark/history item (`title` is optional on all three WebExtension shapes) — normalizes a missing `title` to `''` at the boundary instead of storing the literal string `"undefined"`; adjudicated chrome-prep C3c typing finding.
- Removed the dead `contextMenu`/`contextMenuPin`/`contextMenuUnpin` `uiElements` entries in `webextension/newTab.js` — their ids don't exist in `newTab.html` (always resolved to `null`) and nothing read them; adjudicated chrome-prep C3c typing finding.
- `webextension/lib/tiles-store.js`'s `Tile` typedef gains the missing `titleIsUserSet` property, mirroring `tiles-shim.js`'s page-side copy (doc-truth only); adjudicated chrome-prep C3c typing finding.

### Removed

- `pageMessageHandler`'s early-broadcast queue (`_queue`/`_enqueue`/`flushQueued()`) in `newTab.js`/`page-main.js`, and 8 dead-true `typeof Prefs`/`typeof Grid`/`typeof NeverCapture`/`typeof TileStats`/`typeof AwesomeBar`/`typeof newTabTools` guards across `newTab.js`/`fx-newTab.js` — all provably unreachable since PAGE_MODULES.md's P5 import cycle guarantees fx-newTab.js finishes evaluating before newTab.js's listener can ever be invoked (CHROME_PREP.md C3a).
- Every remaining `globalThis.X = X;` TEST-ONLY bridge assignment across `webextension/` (chrome-prep C3d): `prefs.js` (`Prefs`/`Blocked`/`Filters`/`NeverCapture`), `tiles-shim.js` (`Tiles`/`Background`), `common.js` (`compareVersions`), `icons.js` (`NttIcons`), `stats.js` (`TileStats`), `awesomebar.js` (`AwesomeBar`), `newTab.js` (`newTabTools`/`pageMessageHandler`), `fx-newTab.js` (`Page`/`Grid`/`Updater`/`UndoDialog`/`Drag`) — 17 assignments in 8 files. The repo now has ZERO `globalThis` bridge assignments; every production and test consumer reaches these via a real `import`. `tests/integration/page-module-scope.test.ts` and `module-scope.test.ts` flip their inventories to negative assertions; `tests/integration/globals.d.ts` shrinks to the vm-harness plumbing that remains (`Prefs`/`Filters`/`Tiles`/`Background`/`Updater`/`Grid`/`chrome`); `nttGlobals` in `eslint.config.js` is deleted for the E2E/UAT/scripts glob (no bare-identifier reads remain there) and replaced by a minimal `nttVmHarnessGlobals` (`Filters`/`Prefs`/`Tiles`/`Updater`) for the fast-tier TS glob's vm-harness plumbing only.

## [2.4.0] — 2026-07-10

The page-modules arc (`PAGE_MODULES.md`, slices P1–P5 + two adjudicated code
reviews): the new-tab page's eight classic `<script>` tags became real ES
modules behind a single `page-main.js` entry; the vm test harness retired;
the dual-scope bridge is now a read path of real imports with TEST-ONLY
`globalThis` survivors. Behavior-preserving — boot delta measured ≈ 0,
full UAT 11/11.

### Added

- `webextension/page-main.js`: the new-tab page's single ES-module entry point, replacing eight classic `<script>` tags (PAGE_MODULES.md P1).
- `tests/integration/page-module-scope.test.ts`: page-side module-scope regression test asserting the eight page files' bridged globals land on `globalThis` and that importing them runs no cross-module top-level code.
- `tests/e2e/boot-timing.test.ts`: permanent boot-timing instrument (polled firstTileSeen + navigation/paint entries, persisted to `_artifacts/boot-timing.txt`); P1 boot delta measured ≈ 0.
- `audit/2026-07-10-page-modules-p1-code-review.md`: medium-effort review of P1 (no live bug — strict-mode/bridge/import-order verified clean; flagged page-main.js's untested boot orchestration, action.js's module flip lacking a module-mode test, all-or-nothing boot, and an incomplete removed-behavior sweep).
- `audit/2026-07-10-page-modules-p2-p5-code-review.md`: medium-effort review of P2–P5 (no live bug — ESM cycle evaluation order, `Prefs.onChange` parity, and platform-getter deletion verified clean; flagged that `awesomebar.js` still reads `Grid`/`newTabTools` as production globals despite the bridges being re-labeled "TEST-ONLY", plus dead `typeof` guards).
- `tests/integration/page-main-boot.test.ts`: behavioral coverage for `page-main.js` (import completeness + `UndoDialog.init()` → `newTabTools.startup()` → `pageMessageHandler.flushQueued()` boot order), replacing a source-grep waiver (P1 review finding 1).
- `tests/setup.js`: shared `browser.menus` mock (create/update/refresh/onShown/onClicked), replacing two divergent ad-hoc copies in `module-scope.test.ts` and `page-module-scope.test.ts` (P1 review finding 7).
- `Prefs.onChange(listener)`: subscription seam replacing prefs.js's old `'newTabTools' in window` branch; `page-main.js` registers the page's listener after boot to reproduce the old `updateUI`/`_markAutoSaved`/`Grid.refresh`/`Updater.updateGrid` dance (PAGE_MODULES.md P3, Decision 6).
- `tests/integration/prefs-onchange-seam.test.ts`: behavioral coverage for the `Prefs.onChange` seam (listener registration/firing, no-listener background scenario, page-main.js's reproduced old-branch behavior).
- `tests/integration/_helpers.ts`: `ensureSiteEnv()` (exported), the shared once-per-file loader for the real page-module cycle, replacing `mountSite`'s old vm-load + stub-object setup.
- `common.js` gains `getString`/`isValidURL` exports (moved verbatim from newTab.js's `newTabTools` object) — generic page-side i18n/URL-validation leaves, not page-controller logic (P2–P5 review finding 1, revised remediation).
- `AwesomeBar.init({ tilesSource })`: the widget's one dependency on the grid (a read-only `url`/`title` tiles list) is now an injected callback instead of a `Grid.sites` bare-global read; newTab.js wires it with `AwesomeBar.init({ tilesSource: () => Grid.sites })`.
- `tests/integration/common.test.ts`: behavioral coverage for `getString` (delegates to `chrome.i18n.getMessage` with substitutions collected into an array) and `isValidURL` (ftp/http/https allow-listed; `javascript:`/`data:`/garbage rejected).

### Changed

- `newTab.js`/`fx-newTab.js` gain real `export`s (`newTabTools`/`pageMessageHandler`; `Page`/`Grid`/`Updater`/`UndoDialog`/`Site`/`Drag`/`Drop`/`Transformation`) and real `import`s of every leaf/dual-scope name they read, plus each other — a legal ESM cycle, every cross-reference call-time only (PAGE_MODULES.md P5, Decision 3). `/* globals */`/`/* exported */` headers deleted from both.
- `page-main.js` boots via named imports (`UndoDialog`/`Grid`/`Updater` from fx-newTab.js, `newTabTools`/`pageMessageHandler` from newTab.js, `Prefs` from prefs.js) instead of bare-identifier globals; its `/* globals */` header is gone.
- `tiles-shim.js`: `Tiles`/`Background` gain JSDoc param types; their `globalThis` bridge assignments now cast through `any` (same ambient-global-inference fix P3 applied to prefs.js/common.js), needed once a test file's real `import` first pulled the file into the typechecked program.
- Every surviving page-file `globalThis.X = X;` bridge assignment is re-marked TEST-ONLY, genuinely, with no remaining production exception: `getString`/`isValidURL` extracted from `newTabTools` to real `common.js` exports (`newTabTools.getString`/`isValidURL` are now one-line delegates), and awesomebar.js's tiles read moved to an injected `AwesomeBar.init({ tilesSource: () => Grid.sites })` callback wired by newTab.js — dependency inversion dissolves awesomebar.js's coupling to `Grid`/`newTabTools` outright (P2–P5 review finding 1, revised remediation, executed same day pre-2.4.0).
- awesomebar.js: dead `typeof Prefs`/`typeof NttIcons` guards dropped (real imports since P4 — permanently true; P2–P5 review finding 2); the `Grid`/`newTabTools` bare-global reads (and the `/* globals Grid, newTabTools */` pragma) are gone too, per finding 1's resolution above — awesomebar.js reads no page global at all now.
- `eslint.config.js`: the former script-mode `webextension/**/*.js` block (action.js only, by the end) is merged into the one module-mode block now that every page file is a real ES module; `nttGlobals` pruned to names E2E `page.evaluate()` callbacks still reference (`Blocked`/`DropTargetShim` dropped — zero remaining references).
- `tests/integration/_helpers.ts`'s `mountSite` is now async: it natively `import()`s `fx-newTab.js` by computed path (so `tsc` doesn't follow the monolith into the typed program) instead of `vm.runInThisContext`, mounting the shipped `newTab.html` body first so newTab.js's top-level DOM-wiring IIFE (reached via the cycle) has real element ids. Its old full-replacement `Prefs`/`Tiles`/`Blocked`/`NeverCapture`/`TileStats`/`newTabTools`/`UndoDialog`/`Grid`/`Updater` stand-ins are gone — the real singletons (imported for real by the monoliths now) provide them; callers needing a non-default value mutate the real singleton in place instead of replacing `globalThis.X` (a stand-in object is invisible to a real `import` binding).
- `tests/setup.js`: `chrome.i18n.getMessage` mock now echoes its key back (was jest-webextension-mock's default `Translated<key>`), matching what every `getString`-dependent assertion already assumed under the old per-suite stand-ins.
- `tests/integration/tile-url-render.test.ts`, `drag-reorder.test.ts`: migrated from `vm.runInThisContext`-loading the raw `fx-newTab.js` source to a native computed-path `import()`; `drag-reorder.test.ts` now drives the real `Prefs`/`Tiles`/`newTabTools` singletons in place instead of pre-seeding `globalThis`.
- `tests/integration/tile-redesign.test.ts`, `tile-surface.test.ts`, `edit-mode.test.ts`: `mountSite()` calls now `await`ed; `tile-redesign.test.ts` imports the real `Prefs`/`NeverCapture`/`TileStats` singletons and mutates them in place instead of replacing `globalThis.X`.
- `tests/integration/page-module-scope.test.ts`: its load-order regex now matches both side-effect and named `import` forms (page-main.js's newTab.js/fx-newTab.js/prefs.js imports became named this slice).
- `tests/integration/awesomebar-dom.test.ts`: drops the `globalThis.newTabTools`/`globalThis.Grid` stand-ins for `AwesomeBar.init({ tilesSource })` + real `common.js` `getString`/`isValidURL`, per the finding-1 dependency inversion above; adds coverage for the no-`tilesSource` degradation path.
- `tests/integration/recent-tabs.test.ts`, `objecturl-revoke.test.ts`, `tile-editing.test.ts`, `title-refresh.test.ts`: their `vm.runInThisContext` harnesses extract newTab.js's `isValidURL` method body, which is now a one-line delegate to common.js's real export — each harness now exposes the real `isValidURL` on `globalThis` before running so the delegate's bare-identifier call resolves (vm.runInThisContext shares the real global object).
- `newTab.html`/`action.html` now load `page-main.js`/`action.js` as ES modules instead of classic scripts; `icons.js`, `stats.js`, `tiles-shim.js`, `awesomebar.js`, `newTab.js`, `fx-newTab.js` each gain an explicit `globalThis.X = X;` bridge assignment for their cross-file names.
- `fx-newTab.js`'s top-level boot trailer (`UndoDialog.init(); newTabTools.startup(); pageMessageHandler.flushQueued();`) hoisted into `page-main.js` — fx-newTab.js's top level is now definition-only (PAGE_MODULES.md Decision 3).
- `tests/integration/action-popup.test.ts` now natively `import()`s `action.js` (module semantics) instead of `vm.runInThisContext` (classic script), matching production's module flip (P1 review finding 2).
- `tests/integration/page-module-scope.test.ts`'s `PAGE_FILES_IN_LOAD_ORDER` is now parsed from `page-main.js`'s own import lines instead of hardcoded, so the two can't drift (P1 review finding 8).
- `eslint.config.js`: merged the duplicate `webextension/page-main.js` block into the `webextension/lib/**/*.js` module-mode block (P1 review finding 6).
- `PAGE_MODULES.md`: recorded the all-or-nothing boot property (a throw in any of page-main.js's eight imports aborts the whole boot) as a deliberate, accepted P1 behavior change (P1 review finding 3).
- `icons.js`/`stats.js`/`tiles-shim.js` gain real `export`s (`NttIcons`/`TileStats`/`Tiles`/`Background`), keeping their `globalThis` bridge assignments for still-classic-script consumers (PAGE_MODULES.md P2).
- Their fast-tier suites (`icons.test.ts`, `stats.test.ts`, `tile-stats.test.ts`, `_helpers.ts`'s `mountSite`) move from vm-loading to native `import`.
- `common.js`/`prefs.js` gain real `export`s (`compareVersions`; `Prefs`/`Blocked`/`Filters`/`NeverCapture`), keeping their `globalThis` bridge assignments (cast through `any` so checked-JS's ambient-global-from-assignment inference doesn't override the deliberately loose test-only `declare global` types) for still-classic-script page consumers + E2E/UAT page-context evaluation (PAGE_MODULES.md P3).
- `lib/platform.js` loses its five Decision-2 bridge getters (`getPrefs`/`getBlocked`/`getFilters`/`getNeverCapture`/`getCompareVersions`); every lib consumer (`background-main.js`, `tiles-store.js`, `capture.js`, `backup.js`, `messages.js`) now imports `Prefs`/`Blocked`/`Filters`/`NeverCapture`/`compareVersions` for real.
- `tsconfig.json`: `lib/background-main.js` no longer excluded from the typechecked program now that common.js/prefs.js are real typed modules; minimal JSDoc added to close the resulting fallout (background-main.js's listener-callback params, prefs.js's dynamic getter/setter wiring + method params, common.js's `compareVersions` internals).
- Fast-tier suites that vm-loaded `prefs.js` (`prefs-persistence.test.ts`, `tile-stats.test.ts`'s statType behavioral suite, `filter-cap.test.ts`'s host-normalization suite, `never-capture.test.ts`) move to native `import`, with `Prefs`/`Blocked`/`Filters`/`NeverCapture` treated as shared singletons (state reset per test) rather than a fresh `vm` context per suite.
- Tests exercising `lib/tiles-store.js` (`filter-cap.test.ts`, `tiles-pin.test.ts`, `background-and-history.test.ts`) now mutate the real `Prefs`/`Blocked`/`Filters` singletons in place instead of replacing `globalThis.X` with a stand-in object — the lib's real imports no longer read `globalThis` at call time, so a replacement object is no longer visible to it.
- `eslint.config.js`: `common.js`/`prefs.js` move into the module-mode block (real `export` syntax needs `sourceType: 'module'`).
- `awesomebar.js` gains real `export`/`import`s (`NttIcons`/`Prefs` from icons.js/prefs.js) — the first page file to real-import another; `globalThis.AwesomeBar` bridge assignment stays (newTab.js reads it until P5) (PAGE_MODULES.md P4).
- `tests/integration/awesomebar.test.ts`/`awesomebar-dom.test.ts` move from `loadModule`/`vm.runInThisContext` to native `import`; the DOM suite mutates the real `Prefs` singleton in place instead of stubbing `globalThis.Prefs`/`globalThis.NttIcons`.
- `eslint.config.js`: `awesomebar.js` moves into the module-mode block.
- Docs sweep for the P gate: `CONTRIBUTING.md`, `TESTING.md`, `README.md`, `ROADMAP.md`, `PAGE_MODULES.md` updated to describe the page as fully modular, retiring stale dual-scope-bridge/vm-harness/classic-`<script>` claims.

### Removed

- `tests/integration/tile-stats.test.ts`'s source-grep "is imported by page-main.js" test, subsumed by `page-main-boot.test.ts` (P1 review finding 1).
- Two dead `.replace()` neutralizing strips and their stale comment in `tests/integration/tile-url-render.test.ts` — `fx-newTab.js`'s top level has been definition-only since P1, so there was nothing left to strip (P1 review finding 4).
- `tests/integration/reset-and-autosave.test.ts`'s `prefsChanged` source-grep test, replaced by `prefs-onchange-seam.test.ts`'s behavioral coverage of the same call site (now in `page-main.js`, not `prefs.js`).
- `tests/integration/backup-restore.test.ts`'s dead `Filters.normalizeHost` stub — `lib/backup.js` imports the real `Filters` singleton now, so the stand-in was no longer reachable (and coincidentally passed only because it reimplemented the same logic).
- `tests/integration/_helpers.ts`'s `loadModule` vm-sandbox loader — `awesomebar.test.ts` was its last consumer (PAGE_MODULES.md P4).

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
