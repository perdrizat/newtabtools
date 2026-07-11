# Chrome-Prep Program — Capability Seams, Typed Monoliths, Feature Modules

**Status: IN PROGRESS** (authored 2026-07-10, maintainer-approved same day).
Ships as **2.5.0** when complete (maintainer decision: the full program precedes
the 3.0.0 AMO release; 3.0.0 stays reserved for AMO after this program and its
follow-up audit round). Successor to the page-modules arc (`PAGE_MODULES.md`,
2.4.0). Origin: an auditor-volunteered phase plan, adjudicated 2026-07-10 —
adopted with corrections recorded per-arc below (stale items dropped, one
security-boundary trap excluded, one scope reduction, harness design decided
by maintainer).

**The maintainer's two binding directives (2026-07-10):**
1. **Principled harness design for the typing arc (C3):** the E2E/UAT harness
   moves to REAL UI/gesture driving — no `__ntt_test` handle, no test hook in
   production code. Consequence accepted explicitly: the drag E2E test may be
   flaky for a while (synthesized DnD in headless Firefox). The payoff: every
   `globalThis` bridge assignment in the repo can then be deleted — including
   the dual-scope survivors in common.js/prefs.js — ending the program with
   ZERO bridge assignments.
2. **Real JSDoc for the monoliths:** quality typedefs and precise shapes, not
   `any`-cast escape hatches. Budgeted as a big effort, deliberately.

## Status board (live)

| Arc | Status | Commit(s) |
|---|---|---|
| C0 — design decisions of record (menus, theme) | done | `c7ebfcc` |
| C1 — background DOM-guard (no DOM outside thumbnail-image.js) | done | `c3cab0a` |
| C2 — leaf utilities: `el()` builder + textContent normalization + color helper | done | `007f363` |
| C3 — type the monoliths + principled harness + retire ALL bridges | done | `f9a5dfc`+`114473a`+`8bd1e12`+`8d8d656` |
| C4 — split the monoliths into feature modules | done | `6a6ff20`+`1bdb418`+`df6a292`+`0c16178` |
| C5 — capability-seam completion (divergence audit, targeted wrappers) | in progress (C5a done) | — |
| C6 — two-target manifest authoring | pending | — |
| C gate — full suite + full UAT + audit + 2.5.0 | pending | — |

## Decisions of record

### 1. Chrome context menus: the in-tile action row IS the Chrome interaction (C0)

Firefox's per-tile dynamic context menu depends on `menus.onShown` +
`menus.getTargetElement` (`lib/background-main.js:288`) — Chrome's
`contextMenus` API has neither. **Decided:** Chrome ships WITHOUT dynamic
context menus. The in-tile action row (edit / never-capture / pin / remove)
already carries the identical operations on every tile; Firefox's context menu
is progressive enhancement, not a portability requirement. The seam's menu
capability is therefore optional-by-design: registered when the platform
provides `menus.onShown`, absent otherwise, and no page/background logic may
assume it exists. **Rejected:** a degraded static Chrome menu (two UX surfaces
to keep in sync for zero added capability).

### 2. Chrome theme: `prefers-color-scheme` is the source; `browser.theme` is a Firefox bonus (C0)

`browser.theme` is Firefox-only (used in newTab.js). The existing `system`
theme mode already runs on `prefers-color-scheme`. **Decided:** "theme source"
becomes a capability: base = system `prefers-color-scheme` (both platforms);
Firefox layers `browser.theme` detection on top. No code may assume
`browser.theme` exists.

### 3. The restore validators stay OUT of the shared-leaf extraction (C2)

The auditor's phase list swept "the safe* validators" into the leaf-utilities
extraction. **Rejected for `lib/backup.js`:** `safeHexColor`/
`safeBackgroundUrl` (and the `safeProtocols` allow-list) are the restore
security boundary, with a standing decision of record that its validation
stays independent (deliberate defence-in-depth duplication; any change is a
documented security-boundary event per CONTRIBUTING). C2 extracts page-side
helpers only (`siteBrandColor` etc.); the restore chain is untouched.

### 4. C5 is a divergence audit + targeted wrappers, not blanket indirection

**Rejected:** "route ALL `browser.`/`chrome.` calls through wrappers." Chrome
MV3's `chrome.*` is promise-capable, so most call sites are portable with a
single `const api = globalThis.browser ?? chrome` in a leaf (in-house — the
webextension-polyfill runtime dep would violate the zero-runtime-dep policy).
**Chosen:** audit every `browser.`/`chrome.` site, wrap only the genuinely
divergent capabilities (menus, theme, search, captureTab/captureVisibleTab,
action, storage.session semantics), normalize the namespace once. Note
`lib/platform.js` is background-scoped — the page side gets its own small
capability leaf (page files cannot import `lib/`); the two seams stay
parallel, not shared (no new dual-scope file).

### 5. Order: guard → leaves → types → split → seam → manifests

The auditor's ordering logic (leaves before types before split before seam) is
adopted — split without types = refactoring 4.8k lines blind; seam before
split = threading wrappers through code about to dissolve. Two adjustments:
the C1 guard runs FIRST (cheapest, pure insurance, protects the already-carved
thumbnail seam while everything else churns), and C6 (manifest authoring) runs
LAST (pays off only at port time; a sibling script of `sync-version.mjs`, no
build step).

### 6. What was already done before this program (auditor text was stale)

"Phase 0" (land page-modules) and the core of "Phase 1" (getString/isValidURL
extraction + awesomebar `tilesSource` inversion) shipped in 2.4.0. C2 is the
Phase-1 remainder only.

## Arcs

Gates per arc: red/green fast tests, `pnpm lint`, `pnpm typecheck`,
`pnpm lint:webext`; E2E tiering per the PAGE_MODULES precedent (targeted for
narrow arcs C1/C2/C6, full for C3/C4/C5); UAT spot-runs at visually-risky
points, full UAT at the C gate. Commit per green arc; this file's board updates
per arc.

### C0 — design decisions (this file, ROADMAP)
- [x] Decisions 1–2 recorded here; ROADMAP "Next"/"Later — Chrome" sections
      updated to reference this program; AMO gating re-pointed at 2.5.0;
      absorbed backlog items re-pointed (el() → C2, bridge retirement → C3);
      no code.

### C1 — background DOM-guard
- [x] ESLint guard (project rule or `no-restricted-globals`/`no-restricted-
      properties` config): `document`/`window`/`Image`/canvas/DOM constructors
      forbidden in `webextension/lib/**` EXCEPT `lib/thumbnail-image.js` (the
      Chrome/OffscreenCanvas swap seam). Red-first: prove the rule fires on a
      violation, then that the tree is clean.
- [x] Audit pass over lib/** confirming no existing leak (report, don't assume).
- [x] Gates + targeted E2E: fast 1306/1306, lint/typecheck/lint:webext clean,
      smoke trio 6/6. Audit verdict: zero existing violations in lib/** —
      the thumbnail seam was already airtight; the guard is pure insurance.

### C2 — leaf utilities (Phase-1 remainder)
- [x] `el(tag, className, text?)` page DOM-builder leaf (`webextension/dom.js`
      + `tests/unit/dom.test.ts`) + normalize the `createElement` blocks
      (Stage-H review §8 backlog item). Real count: **37** `createElement`
      call sites across the three page files (`newTab.js` 18, `fx-newTab.js`
      12, `awesomebar.js` 7) — **26 normalizable** (create + optional
      className + optional textContent in immediate sequence) swept onto
      `el()` (`newTab.js` 12, `fx-newTab.js` 9, `awesomebar.js` 5); **11**
      left as hand-written `document.createElement` because the block is
      complex (canvas setup, conditional-branch thumbnails, attribute/event
      wiring, or a bare create with no immediate className/textContent to
      dedup) — force-fitting those would obscure rather than clarify.
      Mechanical, per-file sweep; behavior-identical (fast tier: 1315/1315,
      zero assertion changes — 4 vm-harness tests needed a one-line `globalThis.el`
      exposure, same pattern as their existing `isValidURL` exposure, because
      they extract page methods by source rather than importing them).
- [x] `siteBrandColor` (fx-newTab.js): confirmed exactly one production
      consumer (`fx-newTab.js:1090`, inside `_renderLogoFallback`) — left in
      place per the plan's anticipated outcome; not extracted.
- [x] Restore validators NOT touched (Decision 3) — `lib/backup.js` untouched
      by this arc.
- [x] Gates: fast 1315/1315, lint/typecheck/lint:webext clean; targeted E2E
      46/46 (smoke trio + tile-redesign, recent-tabs, drawer, awesomebar —
      every rendering surface the sweep touched).

### C3 — type the monoliths + principled harness + bridge endgame

*Slicing (2026-07-10): the newTab↔fx-newTab import cycle means tsc pulls BOTH
files into the program together — so the typing stages through a documented,
temporary `@ts-nocheck` on the not-yet-typed partner (dies within the arc,
same staged-scaffold logic as P1's bridge):*
- *C3a — dead-code retirement (queue, guards) — shrinks the typing surface;*
- *C3b — fx-newTab.js fully typed, newTab.js `@ts-nocheck` (staged);*
- *C3c — newTab.js fully typed, scaffold removed, computed-path import
  pattern retired;*
- *C3d — principled harness migration + delete ALL bridges + negative
  assertions + `globals.d.ts`/`nttGlobals` cleanup. FULL E2E at C3d; smoke
  trio for a–c (a is behavior-removal with test replacement; b/c are
  type-only).*
- [x] Full-quality JSDoc for newTab.js + fx-newTab.js (typedefs for Site/link/
      grid-cell shapes, event payloads; no `any`-casts as escape hatches —
      maintainer directive 2). Monoliths enter the typed program; the
      computed-path "hide from tsc" import pattern retires.
      **C3c (2026-07-10): newTab.js done — both monoliths fully typed, the
      staged `@ts-nocheck` scaffold removed.** Error trajectory: 390 → 0.
      Typedef inventory added: `NewTabToolsPageRefs` trimmed back to the
      three refs fx-newTab.js's cycle import actually reads
      (`page`/`databaseError`/`selectedSiteIndex`) — every other
      `uiElements` ref (32 properties) is instead declared directly on the
      `NewTabToolsObject` literal (the Cell.prototype `position`/`_grid`
      precedent), because an intersection applied only to the exported
      binding never helps `this`-typing inside the literal's OWN methods,
      only external readers; plus `AutocompleteCandidate`, `Link` (reused
      from tiles-shim.js, mirroring fx-newTab.js's own alias),
      `Site`/`CellNode`/`SiteNode` (type-only imports from fx-newTab.js —
      TDZ-safe, types are erased), `WallpaperRecord`/`RawWallpaperRecord`,
      `SessionTab` (patches a `browser.tabs.Tab` typings gap: `lastModified`
      is real at runtime for `sessions`-obtained tabs but missing from
      `@types/firefox-webext-browser`), `DelegatedEventTarget` (the
      click/change delegated-handler `event.target` shape, shared by
      `optionsOnClick`/`optionsOnChange`/`drawerOnClick`/`drawerOnChange`).
      2 `@ts-expect-error` (the `canvas.mozOpaque`/`mozImageSmoothingEnabled`
      legacy Firefox canvas extensions in `setThumbnail` — global-interface
      augmentation, same class as C3b's `DOMRect` shim, well under the ~5
      budget). `tsconfig.json` `lib` gains `ES2021` (newTab.js's
      `getThemedImageURL` genuinely calls `String.prototype.replaceAll`,
      unavailable in the prior `ES2020` floor — both the Fx152+ target and
      this project's Node floor have shipped it for years; `noEmit: true` so
      this never affects emitted code). Leaf fallout fixed: tiles-shim.js's
      `Tile` typedef gains `titleIsUserSet` (used, undeclared) and
      `Background.setBackground`'s `file` param becomes correctly optional
      (newTab.js's `selectWallpaper`/`resetWallpaper` call it with zero
      arguments; the background treats omitted/`null` as "clear" — the old
      JSDoc required a non-optional argument that didn't match either real
      call pattern). Latent findings surfaced by typing, reported not fixed:
      `contextMenu`/`contextMenuPin`/`contextMenuUnpin`'s uiElements ids
      (`context-menu`/`newtabtools-pintile`/`newtabtools-unpintile`) don't
      exist anywhere in newTab.html — always resolve to `null`, dead but
      inert (nothing reads them); the pinURL-autocomplete `maybeAddItem`
      candidate shape assumes `url`/`title` are always present though
      `browser.tabs.Tab`/`BookmarkTreeNode`/`HistoryItem` declare both
      optional; a bookmarks-tree folder with `children === undefined` would
      throw (pre-existing, unguarded before this slice too); `updateThemeColours`
      never validated a theme color could be an RGB(A) tuple instead of a
      string (`browser.theme.ThemeColor`'s legacy format) before handing it
      to `parseColour`; the wallpaper grid's solid-colour `<div>` swatch gets
      a harmless no-op `.alt` write (only meaningful on `<img>`). Test-side
      dividend: `tests/integration/_helpers.ts`'s dead `webextPath`/
      `WEBEXT_DIR` (no remaining call site once C3b/C3c literal-string
      `import()`s replaced every computed-path use) deleted; `ensureSiteEnv`'s
      dynamic `import()` of fx-newTab.js stays dynamic — confirmed the
      existing comment already correctly attributes this to DOM-mount-before-
      evaluation ordering (newTab.js's top-level DOM-wiring IIFE needs the
      shipped `newTab.html` body mounted first; a static import is hoisted
      above a module's own top-level code, so there's no way to sequence
      "mount then import" with one), not tsc-hiding — no change needed there.
      Other computed-path `webext(relPath)` dynamic imports remain in
      `page-module-scope.test.ts`/`page-main-boot.test.ts`/
      `prefs-onchange-seam.test.ts`/`auto-thumbnail.test.ts`: these load
      page-main.js/lib/background-main.js, which import action.js/page-main.js
      — still deliberately OUTSIDE the typed program (their own future
      slice) — so those stay computed-path on purpose, unrelated to this
      slice's monoliths. `tsconfig.json`'s `include` keeps the two explicit
      `webextension/fx-newTab.js`/`webextension/newTab.js` entries rather
      than a `webextension/*.js` glob: a glob would also match
      action.js/page-main.js, growing the checked program rather than
      leaving it identical (rejected per the C3c instruction to simplify
      only if the result is unchanged). Gates: fast 1310/1310 (incl. the
      raw-module-eval tripwire), lint/typecheck/lint:webext clean.
      **C3b (2026-07-10): fx-newTab.js done, newTab.js staged.**
      `tsconfig.json` gains explicit `webextension/fx-newTab.js` +
      `webextension/newTab.js` include entries (the ESM cycle pulls both into
      the program together regardless — awesomebar.js/common.js/dom.js/
      icons.js/prefs.js/stats.js/tiles-shim.js follow via import-following,
      no entries needed). fx-newTab.js is fully typed: central typedefs
      (`Link` reused from tiles-shim.js's new `Tile`, `NttRect`,
      `SiteIndexState`, `CellNode`/`SiteNode` expando aliases,
      `NewTabToolsPageRefs`); `Site`/`Cell` stay constructor-function +
      `.prototype` (per maintainer directive, not converted to `class`);
      4 total `@ts-expect-error` (all on the top-of-file `DOMRect.prototype`
      shim — real global-interface augmentation, not expressible from
      checked JS without a new ambient `.d.ts`). newTab.js gets a staged,
      loud `@ts-nocheck` — the ONLY suppression this slice besides the 4
      above — removed in C3c. Leaf fallout fixed: `tiles-shim.js` gains a
      `Tile` typedef + precise `Tiles.*` signatures. Test-side dividend:
      `_helpers.ts`'s `ensureSiteEnv`/`mountSite`, `drag-reorder.test.ts`,
      `tile-url-render.test.ts` drop the computed-path `webextPath(...)`
      obfuscation for a literal-string dynamic `import()` (still dynamic,
      not static — the DOM-mount-before-import ordering newTab.js's
      top-level DOM-wiring needs can't be expressed with a static import).
      Two latent argument-count/null findings surfaced by typing, reported
      not fixed: `Cell.handleEvent` calls `Drop.enter`/`Drop.drop` with an
      unused second (`event`) argument the functions never declared; `Drop`'s
      `_drop` passes a possibly-`null` `_lastDropTarget` into
      `_dispatchEvent`, which dereferences it unconditionally.
      **C3b incident (caught by full E2E, fixed same slice):** the first cut
      typed the `newTabTools` cycle import via an aliased import + top-level
      `const` — a TOP-LEVEL READ of the cycle binding while in TDZ (Decision
      3 violation): raw module loading threw `ReferenceError: … before
      initialization`, page-main.js's whole graph rejected, and the page
      never booted in real Firefox — while the fast tier stayed green,
      because vite/vitest's module transform does not preserve TDZ semantics
      for cyclic imports. Fix: plain `import { newTabTools }`; the
      `NewTabToolsPageRefs` intersection moved ONTO newTab.js's export
      (const-impl + typed-export, the prefs.js `PrefsAccessors` pattern —
      `@ts-nocheck` suppresses reporting in-file but still publishes declared
      types to importers). Permanent tripwire:
      `tests/unit/raw-module-eval.test.ts` + its
      `tests/unit/_fixtures/raw-import-page-graph.mjs` fixture spawn raw Node
      (no transform) to import page-main.js and assert the failure class is
      a missing-browser-API ReferenceError, never SyntaxError or a TDZ
      `before initialization` — red on the bug, green after the fix. The
      diff review also reverted a boundary-contract drift: `Drag.drag` takes
      the `Site` again and `DropTargetShim._dragover` dereferences
      `._newtabSite` at the call site, as before (C4 moves these functions;
      contracts must travel unchanged). Gates: fast 1310/1310,
      lint/typecheck/lint:webext clean.
- [x] Retire `pageMessageHandler`'s dead early-broadcast queue (+ its M5-era
      tests) and the dead-true `typeof` guards (newTab.js 1216–1824 sweep) —
      provably unreachable since P5's import cycle. (C3a, chrome-prep) Direct
      dispatch in `pageMessageHandler`; `flushQueued()`/`_queue`/`_enqueue`
      deleted, `page-main.js`'s boot call dropped. 8 dead-true guards removed
      across `newTab.js` (`Prefs`×3, `Grid`×3, `NeverCapture`, `TileStats`,
      `AwesomeBar`) and `fx-newTab.js` (`TileStats`, `newTabTools`×3);
      property-check guards (e.g. `typeof Grid.cacheCellPositions ===
      'function'`) and unrelated feature-detection guards (`ResizeObserver`,
      `document`, `chrome.permissions`) kept. `awesomebar.js` swept too — its
      one `typeof document` guard is unrelated feature detection, kept.
      Tests: `page-messages.test.ts`'s queue-replay describe block replaced
      with direct-dispatch + apparatus-is-gone assertions;
      `page-main-boot.test.ts`'s boot order shrinks to init→startup;
      `prefs-onchange-seam.test.ts` drops its now-nonexistent `flushQueued`
      spy. 3 vm-harness tests (`drawer.test.ts`, `tile-tab-defaults.test.ts`,
      `recent-tabs.test.ts`) gained `Prefs`/`Grid` stand-ins the removed
      guards used to make optional. Gates: fast 1309/1309, lint/typecheck/
      lint:webext clean.
- [x] Harness migration (maintainer directive 1): E2E/UAT stop reading page
      globals. `tests/e2e/_helpers.ts`: `waitForGridReady` polls DOM
      (`#newtab-grid` gaining `.newtab-cell` children — the same readiness
      point `Grid.ready`/`!!Grid._node` captured, verified against
      `Grid.init`/`_render`/`_renderGrid`'s synchronous-cells-before-async-
      sites ordering); `clearPinnedTiles` moves to the `Tiles.clear` wire
      message; `resetPrefs` moves to `browser.storage.local.set` + read-back
      fence (both now share a `waitForExtensionRuntime` helper with
      `resetTestState`, which was already message-driven). New shared
      helpers: `setPrefs`/`getPref` (storage read/write with fence),
      `getFilters`/`setFilter` (the `filters` storage key — `Filters` is a
      real storage-backed dual-scope singleton, so writing the key IS the
      principled equivalent of the old `Filters.setFilter()` call),
      `openDrawerUI`/`closeDrawerUI` (click `#options-toggle`, only when it
      would actually change state), `switchDrawerTabUI` (click
      `[data-drawer-tab]`), `siteLinkExists` (DOM poll predicate replacing
      `Grid.sites.some(s => s.url === u)`), `nudgeRecentRefresh` (forces
      `newTab.js`'s `refreshRecent` — which has no wire/storage trigger of
      its own — by toggling the drawer, since `openDrawer`/`closeDrawer`'s
      own `_refreshGridPositionsAfterDrawerTransition` calls it ~240ms after
      either transition; a real DOM-driven substitute for calling the page
      method directly). All 27 E2E files with page-global reads migrated:
      drawer, drag-layout, drag-reorder, tile-custom, tile-redesign,
      filter-cap, css-grid-layout, lock-grid, wallpaper-picker,
      configurable-grid, tile-bgcolor, backup-restore, never-capture,
      recent-tabs, titlebar-reflow, layout-tuning, tile-aspect, theme,
      large-tiles, auto-thumbnail, pin-persists, favicon-real-sites (+5 more
      with a single occurrence each). The "select a tile for editing"
      pattern (`newTabTools.openDrawer(); switchDrawerTab('tile');
      selectedSiteIndex = idx;`) collapses to one real click on the tile's
      own `.ntt-action-btn[data-action="edit"]` action button (fx-newTab.js's
      `Site._onClick` 'edit' case already does all three steps) — simpler
      than the original page-global sequence, not just an equivalent.
      `isPinned`/`neverCapture` reads move to the `pinned`/`never-capture`
      DOM attributes fx-newTab.js already reflects onto the site node.
      **Drag tests** (`drag-layout.test.ts`, `drag-reorder.test.ts`): real
      `dragstart`/`drag`/`dragend`/`drop` `DragEvent`s (with a genuine
      `new DataTransfer()` — Firefox's page context allows constructing one;
      no shim object needed) dispatched on the actual `.newtab-site`/
      `.newtab-cell` nodes, replacing direct `Drag.start(site, mockEvent)`
      calls; `drag-layout.test.ts`'s cache-staleness regression reframed as
      DOM proof (live `getBoundingClientRect()` narrowing after the drawer
      opens) plus a real dragstart proving the frozen tile's width tracks
      the CURRENT cell geometry (`Drag.start` measures `cellNode.offsetWidth`
      live, so this is the true end-to-end proof, not a mocked-event
      internals check); both files carry a header NOTE marking the
      known-flaky class + quarantine policy (investigate on 3 consecutive CI
      failures, never revert to page-global driving) per directive 1.
      3 first-run-stable local runs each (drag-layout.test.ts 4/4 ×2,
      drag-reorder.test.ts 2/2 ×2). Two E2E tests whose assertions were
      fundamentally about internal, non-DOM-observable state (`NttIcons`
      catalog completeness in `css-grid-layout.test.ts`) were reframed as DOM
      proof that the icons pipeline is wired into the real page (rendered
      inline SVGs on real action buttons) — the exhaustive catalog check
      already lives at the fast tier (`tests/integration/icons.test.ts`, a
      real module import, not a page-global read). UAT: `browser-daemon.mjs`
      was already message-driven (verified, no changes needed); scenarios
      `23-edit-mode-design.md` (`window.Grid` read → DOM query by tile URL)
      and `31-titlebar.md` (`window.Prefs.titleBarSearch` write → 
      `chrome.storage.local.set`) migrated. Bonus fix (adjacent regression,
      same root cause): `scripts/amo-screenshots.mjs`'s `newTabTools.*`
      eval-string reads (a manual release tool, not a gated test tier) moved
      to DOM `input`-event dispatch.
- [x] Delete EVERY `globalThis` bridge assignment (page files AND the
      dual-scope survivors in common.js/prefs.js) — 17 assignments across 8
      files (`prefs.js` ×4, `tiles-shim.js` ×2, `common.js`, `icons.js`,
      `stats.js`, `awesomebar.js`, `newTab.js` ×2, `fx-newTab.js` ×5). Repo-
      wide grep for `globalThis\.\w+\s*=` under `webextension/` now returns
      zero matches. `tests/integration/page-module-scope.test.ts` and
      `module-scope.test.ts` flip their inventories to negative assertions
      (`toBeUndefined()`); `module-scope.test.ts`'s four Decision-2
      "permanent" bridge checks become real `import`s of
      `Prefs`/`Blocked`/`Filters`/`NeverCapture`/`compareVersions` plus a
      negative `globalThis` assertion for each. `globals.d.ts` shrinks to
      the vm-harness plumbing that still does a plain (non-cast)
      `globalThis.X = {...}` write for a `vm`-extracted method-body fixture
      (`Prefs`/`Filters`/`Tiles`/`Background`/`Updater`/`Grid`/`chrome` —
      `Blocked`/`NeverCapture`/`compareVersions`/`Drag`/`newTabTools`
      dropped, zero remaining bare-identifier references). `nttGlobals`
      dies from eslint config for the E2E/UAT/scripts `.js`/`.mjs` glob (zero
      bare-identifier reads remain there); a new, minimal
      `nttVmHarnessGlobals` (`Filters`/`Prefs`/`Tiles`/`Updater` — the four
      names grepped as still read bare) replaces it for the fast-tier `.ts`
      glob's vm-harness plumbing only. Fast-tier fallout fixed: 8 test files
      that read a bridge global expecting production to have set it
      (`page-main-boot.test.ts`, `prefs-onchange-seam.test.ts`,
      `db-wake-race.test.ts`, `event-page-resilience.test.ts`,
      `auto-thumbnail.test.ts`, plus the two module-scope suites) migrated to
      real imports/captured module-namespace bindings from their existing
      dynamic `import()`s; suites that only SET a `globalThis.X` stand-in for
      vm-extracted method bodies were left untouched (test-internal
      plumbing, not a production-bridge dependency). Doc-comment sweep: every
      "stays bridge-mode, permanently" claim in `lib/messages.js`,
      `lib/backup.js`, `lib/platform.js`, `lib/capture.js`,
      `lib/tiles-store.js`, `page-main.js`, `prefs.js`, `common.js`,
      `eslint.config.js` corrected to record the C3d retirement. Gates: fast
      1311/1311, lint/typecheck/lint:webext clean, tripwire green
      (`ReferenceError: window is not defined` — missing-browser-API class,
      not TDZ/SyntaxError).
- [x] Full-E2E fallout round (coordinator review of the first C3d cut). One
      real PRODUCTION defect: six `'Grid' in window` sniffs in newTab.js
      (statType chip re-render — the failing rank test — cacheCellPositions
      rAF, never-capture button refresh, data-selected ring sweep,
      history-permission chip re-render, applyTileAspect) were satisfied only
      by the deleted `globalThis.Grid` bridge, so C3d flipped them from
      always-true to always-false, silently disabling the branches. Sniffs
      dropped — `Grid` is a real static import, and each block keeps its real
      null-guard (`Grid.node`, `Grid.sites`) — behavior-identical to the
      bridge era. Six vm-harness suites (layout, theme, drawer-appearance,
      drawer-layout, recent-toggle, statusbar, restore-wallpaper-live) gained
      a `Grid: { sites: [] }` stand-in the dropped sniffs used to make
      optional (C3a fallout pattern). WIRE-PAYLOAD AUDIT (every
      `sendMessage({name})` in tests/e2e + tests/uat/_tools cross-checked
      against lib/messages.js's `message.*` reads): two silent-no-op defect
      classes found and fixed via a new `removeTileByUrl(page, url)` helper
      (`Tiles.getTile` → `Tiles.removeTile {tile}`; wire-shape gotcha
      documented, boot-timing.test.ts's comment referenced) — (1) seven
      `Tiles.removeTile {url}` sends (dispatch reads `message.tile`), (2)
      twelve `Tiles.unpinTile` sends (not a wire name at all — not among the
      19 frozen names). All other payloads verified correct: `Tiles.pinTile`
      {title,url} ×26, `Tiles.clear` ×6, `Tiles.getTile` {url} ×2,
      `Tiles.getAllTiles`, `Thumbnails.save` {url,image} ×2, `Thumbnails.get`
      {urls} ×3, `Thumbnails.getFavicons` {urls},
      `Background.setBackground` {file}. Timing hardening: fixed-sleep-after-
      `setPrefs` one-shot assertions (racy against the async
      storage.onChanged→updateUI chain under full-suite load) converted to
      bounded `waitForCondition` DOM polls in drawer (rank chips),
      tile-aspect, layout-tuning, filter-cap (button enablement),
      drag-reorder (locked attr), recent-tabs (favicon img). Gates re-run:
      fast 1311/1311, lint/typecheck clean, targeted E2E
      drawer+tile-redesign+drag-layout+never-capture 42/42 and
      tile-custom+drag-reorder+tile-aspect+layout-tuning+filter-cap+
      recent-tabs+tile-bgcolor+auto-thumbnail 25/25.
- [x] Gates + FULL E2E + UAT spot-run: full E2E 127/127 (after the fix
      round), UAT 7/7 (01/10/20-23/31) + 3/3 re-spot post-fix. Incident
      record: the FIRST full run caught a production defect the targeted
      runs could not — six `'Grid' in window` sniffs flipped always-false by
      the bridge deletion (silently disabling stat chips, cacheCellPositions,
      never-capture refresh, selected sweep, permission re-render,
      applyTileAspect; the sniffs predated the deletion in the agent's work
      order) — plus, via the payload audit, two wire-defect classes
      (`Tiles.removeTile` `{url}` vs `message.tile`, 7 sites incl. 2
      pre-existing; `Tiles.unpinTile`, a nonexistent wire name, 12 sites) —
      all silent cleanup no-ops, fixed via the shared `removeTileByUrl`
      helper.

### C4 — split the monoliths

*Slicing (2026-07-10). Rules of the arc: MOVE typed code, don't rewrite it
(types travel unchanged — the C3 risk note); no re-export shims — consumers
update to the new specifiers in the same slice; every new module keeps the
no-top-level-cross-calls rule (tripwire after each slice); page-main.js stays
the only boot site. FULL E2E per slice; purity review per slice.*

- [x] **C4a** — fx-newTab's separable singletons out: `transformation.js`
      (289 lines), `updater.js` (236 lines), `undo-dialog.js` (154 lines);
      fx-newTab.js 2550 → 1961 lines. Each moved verbatim (types unchanged);
      `Cell` gained a real `export` (previously module-local) so the movers
      can reference it as a type via `import('./fx-newTab.js').Cell` — the
      only non-mechanical edit, required for the move, not a rewrite of any
      moved line. `page-main.js`/`newTab.js` re-pointed to the new
      specifiers (no re-export shim); fx-newTab.js itself now imports all
      three back (legal Decision-3 cycle: Grid/Site/Drag/Drop call
      Transformation/Updater/UndoDialog, call-time only). page-main.js's
      import list grows 8 → 10 entries (`page-module-scope.test.ts`'s
      derived sanity net updated to match — `common.js` first/`fx-newTab.js`
      last unchanged, only the length). Gates: fast 1311/1311, lint/
      typecheck/lint:webext clean, tripwire green (missing-browser-API
      `ReferenceError`, not TDZ/SyntaxError); targeted E2E
      drag-layout+drag-reorder+tile-redesign 27/27, loads-cleanly+
      boot-timing 4/4.
- [x] **C4b** — `drag-drop.js` (813 lines total): `Drag`/`Drop`/
      `DropTargetShim`/`DropPreview` + their shared `DELAY_REARRANGE_MS`
      constant, moved verbatim (types unchanged); fx-newTab.js 1961 → 1200
      lines (772 removed / 11 added per numstat — the adversarial review
      corrected the implementer's 768/7 arithmetic; totals reconcile). `DropTargetShim`/`DropPreview` gain a
      real `export` (previously module-local `var`) so fx-newTab.js/tests can
      import them — the only non-mechanical edit, required for the move (same
      class as C4a's `Cell` export). fx-newTab.js re-points its own
      `Drag`/`Drop`/`DropTargetShim` use to the new specifier (`DropPreview`
      has no remaining call site there — only `Drop`, now in drag-drop.js,
      calls it, so it isn't imported back); `transformation.js`'s `Drag`
      import (used by `rearrangeSites`'s dragged-site check) re-points from
      `./fx-newTab.js` to `./drag-drop.js` likewise — the only sibling C4a
      module needing a specifier change (`updater.js` has no runtime
      Drag/Drop reference, only a stale comment mention, left as-is).
      `page-main.js`'s import list is UNAFFECTED (stays at ten entries): it
      never calls any of the four directly, same as C4a's `Transformation`
      (drag-drop.js's evaluation is reached transitively through
      fx-newTab.js's own import) — the arc's own "honestly" instruction
      pointed at growing 10→11, but the actual consumer inventory doesn't
      support it, so the derived `page-module-scope.test.ts` sanity net and
      the two hand-written mirrors (`page-main-boot.test.ts`,
      `prefs-onchange-seam.test.ts`) all stay at 10, with a comment recording
      why. Consumer fallout: `tests/integration/drag-reorder.test.ts`
      (vm-harness suite) imports `Drag`/`Drop` from the new specifier instead
      of destructuring off `fx`, mirroring the C4a `Updater`/`Transformation`
      pattern; `tests/integration/drag-invariants.test.ts`'s
      "`Drag.start` refreshes the cell position cache" source-grep assertion
      now reads `drag-drop.js` instead of `fx-newTab.js` (the other two
      assertions in that describe block — `--ntt-rows`/`--ntt-cols`,
      `cacheCellPositions`'s early-return — stay on `fxSource`, since `Grid`
      didn't move); `tests/integration/_helpers.ts`'s `ensureSiteEnv` doc
      comment updated to note the five names' new home. Gates: fast
      1311/1311, lint/typecheck/lint:webext clean, tripwire green (missing-
      browser-API `ReferenceError`, not TDZ/SyntaxError); targeted E2E
      drag-layout+drag-reorder+tile-redesign+loads-cleanly+boot-timing 31/31.
- *Interim round (2026-07-10, between C4b and C4c, not an arc slice): the
  adjudicated "Bucket A" latent-bug fixes from C3's disclosed NOTEs landed —
  `DropTargetShim._drop`'s null-`_lastDropTarget` guard, `maybeAddItem`'s
  title-less-item boundary normalization, the dead `contextMenu`/
  `contextMenuPin`/`contextMenuUnpin` `uiElements` removal, and
  `lib/tiles-store.js`'s `Tile.titleIsUserSet` doc-truth fix — plus the E2E
  runner concurrency lock (`tests/e2e/run_esr_tests.sh`). See CHANGELOG.md
  `[Unreleased]` for the itemized list.*
- [x] **C4c** — fx-newTab.js (1200 lines) DELETED, dissolved into four new
      modules, each moved verbatim (types unchanged): `site.js` (701 lines:
      `Site` + its private rendering helpers `siteGlyph`/`siteHue`/
      `siteBrandColor`; owns the `Link`/`SiteNode` typedefs), `cell.js`
      (265 lines: `Cell`; owns `CellNode` + the `DOMRect` polyfill/prototype
      shim and its `NttRect` typedef — placement decision: `Cell` is
      `NttRect`'s only in-file consumer among the four movers, so the shim
      travels with its dominant consumer; all 4 `@ts-expect-error`s moved
      verbatim, count unchanged), `grid.js` (233 lines: `Grid`), `page.js`
      (73 lines: `Page` — its own small module per the slice note; a leaf
      among the movers, nothing imports `Page` back, so it adds no new
      cycle). Sum 1272 (+72 vs 1200 = per-file MPL headers + module
      doc-comments + the cross-module `import` lines/typedef blocks that
      replace single-file adjacency). One new value cycle:
      grid.js<->site.js (`Grid.createSite` constructs `Site`; `Site`'s
      never-capture handler calls `Grid.refresh()`) — call-time-only both
      ways, tripwire green. Consumers re-pointed, no re-export shim:
      newTab.js (`Grid`→grid.js, `Page`→page.js), page-main.js
      (`Grid`→grid.js; import list stays at ten — C4b honest-accounting
      precedent: cell.js/site.js/page.js reached transitively),
      transformation.js/updater.js/drag-drop.js (`Grid`→grid.js + typedef
      re-points), undo-dialog.js (typedef re-points only), awesomebar.js
      (verified: none). tsconfig `include`: the fx-newTab.js entry DROPPED,
      not replaced with four new ones — all four movers are reachable via
      import-following from the remaining newTab.js entry (verified:
      typecheck error count unchanged at zero). Tests: `_helpers.ts`'s
      `ensureSiteEnv` dynamic import → site.js; drag-reorder/
      tile-url-render/pin-url-autocomplete-title re-pointed; source-grep
      suites (site-brand-color, favicon-overlay-and-pin, favicons,
      edit-action, drawer-permissions, auto-thumbnail, css-grid,
      drag-invariants) re-read site.js/grid.js; page-module-scope's derived
      sanity-net last-entry invariant → grid.js; page-main-boot/
      prefs-onchange-seam hardcoded arrays → grid.js. Repo-wide `fx-newTab`
      grep: zero live references — only historical docs (CHANGELOG/
      PAGE_MODULES/CHROME_PREP/audit/) + frozen UAT artifacts remain.
      Gates: fast 1314/1314, lint/typecheck/lint:webext clean, tripwire
      green (missing-browser-API `ReferenceError: window is not defined`,
      not TDZ/SyntaxError); E2E ran the FULL suite 127/127 across 32 files
      (the targeted six-file invocation's `--` separator made vitest run
      everything — a superset of the requested batch; boot-timing median
      firstTileSeen 95ms, unchanged). UAT spot-run (tiles: 01/10/23) still
      owed before the C gate.
- [x] **C4d** — newTab.js split. **DESIGN DECIDED (2026-07-11, from the
      coupling-map analysis).**
      **Extract as leaf modules (fan-out-only, no new cycle edges):**
      `theme.js` (updateThemeColours/getThemedImageURL/_theme + parseColour,
      its dominant consumer), `wallpaper.js` (cache/picker/apply +
      _wallpaperCache), `titlebar.js` (recent-tabs: _initTitlebar/
      _layoutTitlebar/refreshRecent/_formatAge + computeTitlebarSlots +
      private state; reads Grid.sites call-time only), `autosave-indicator.js`
      (+ formatRelativeTime), `filters-ui.js` (fillFilterUI/
      fillNeverCaptureUI), and a tiny `object-urls.js` (the _objectURLs Map +
      _freshObjectURL/_dropObjectURL — genuinely shared between wallpaper and
      tile-editing; becomes explicit shared plumbing instead of hidden
      `this` state).
      **Mechanism:** new `ui-refs.js` leaf — a typed refs object populated
      once by newTab.js's boot IIFE; extracted modules import it and access
      fields call-time only (Decision-3 safe; the NewTabToolsPageRefs
      pattern generalized).
      **Stay in the residual controller (newTab.js):** startup/boot + ALL
      event-listener wiring (single delegated listeners stay whole);
      `updateUI(keys)` dispatch (central by design — a fan-in hub; moving it
      is naming, not decoupling); tile-tab editing + the `selectedSiteIndex`
      seam (a real selection-controller API used by site.js/context-menu/
      drawer — its extraction is a future arc); drawer chrome; context menu;
      pin-URL autocomplete (its window keydown handler is shared with
      wallpaper/drawer Escape — splitting fragments one listener into
      three); backup/restore+reset (small, stateless, not worth a module).
      **Stated rule:** extracted leaves NEVER call back into
      newTab.js/updateUI — residual code calls leaf render functions
      directly, one-way.
      **Purity regime for this slice:** `this.X` → `uiRefs.X`/module-function
      rewrites are sanctioned; every transformation is declared in the
      ledger, and the adversarial review verifies bodies modulo exactly the
      declared rewrites.
      UAT spot-run (drawer: 20–23) at the end.
      **Completion note (2026-07-11):** newTab.js 2891 → 1991 lines. Per-module
      line counts: `theme.js` 194, `wallpaper.js` 258, `titlebar.js` 393,
      `autosave-indicator.js` 88, `filters-ui.js` 129, `object-urls.js` 46,
      `ui-refs.js` 58 (sum 1166; the delta over the 900-line reduction is
      per-file MPL headers + module doc-comments + import lines, the C4c
      precedent). `ui-refs.js` field inventory: `backgroundFake`/
      `removeBackgroundButton` (wallpaper.js only), `recentList`/
      `optionsFilterHostAutocomplete` (titlebar.js/filters-ui.js only),
      `optionsFilter`/`optionsNeverCaptureList` (read by both a leaf and
      residual code — the two residual call sites now read the same
      `uiRefs` object instead of a duplicate ref). uiElements-vs-uiRefs
      choice: newTab.js KEEPS its own `uiElements` table for every other,
      residual-only ref (the smaller honest diff — only 6 of ~35 fields
      move) — recorded here and in ui-refs.js's own header comment.
      `object-urls.js`'s `_objectURLs` stays a plain object (not a real ES
      `Map`) — the design note's prose is descriptive, not a rewrite
      mandate; converting would trade a verbatim move for an unsanctioned
      rewrite. One new cycle class: `titlebar.js`→`grid.js` and
      `filters-ui.js`→`grid.js` (call-time-only `Grid.sites` reads),
      extending the existing newTab.js↔grid.js↔site.js cycle — no leaf
      imports newTab.js directly. `page-main.js`'s import list grows ten →
      eleven (`_markAutoSaved`, autosave-indicator.js — its one direct call;
      placed before `grid.js` so the "ends with grid.js" sanity-net
      invariant holds); the other six leaves are reached transitively
      through newTab.js's own imports (C4b/C4c honest-accounting
      precedent), adding no entry. Consumer/test re-point: ~14 integration
      test files re-pointed from vm-extracting moved bodies out of
      newTab.js's source onto real imports of the new modules (plus
      `page-module-scope.test.ts`/`page-main-boot.test.ts`/
      `prefs-onchange-seam.test.ts`'s load-order arrays/length, ten → eleven).
      Latent bugs disclosed, not fixed: `titlebar.js`'s `_recentCardCount`
      module state is write-only (was already dead as a `this.` property in
      the original newTab.js; only newly lint-visible as a lexical
      binding — silenced with a disclosed `eslint-disable` line, not
      deleted). Gates: fast 1314/1314, lint/typecheck/lint:webext clean,
      tripwire green (`ReferenceError: window is not defined`, not
      TDZ/SyntaxError); targeted E2E (loads-cleanly, boot-timing, theme,
      wallpaper-picker, titlebar, recent-tabs, drawer, filter-cap,
      never-capture) 38/38. UAT spot-run (drawer: 20–23) still owed before
      the C gate — out of scope for this slice's requested gates.
- [ ] Gates + FULL E2E per slice + UAT spot-runs as marked.

### C5 — capability-seam completion (Decision 4)
- [x] Divergence audit: `audit/2026-07-11-chrome-api-divergence.md` — **29
      portable / 6 divergent-wrap / 4 firefox-only** distinct surfaces;
      confirms Decision 4 (small targeted seam, not blanket indirection).
      **Design decided (2026-07-11):** a namespace leaf per scope
      (`const api = globalThis.browser ?? chrome`, in-house — no polyfill dep),
      six wrappers only (storage.session, capture-availability, search-shape,
      action/theme-icons, menus presence-gate, getBrowserInfo short-circuit),
      background home `lib/platform.js`, new page capability leaf for
      menus/theme/search. **Firefox behavior must not change** — Chrome paths
      are written-but-dormant (no Chrome manifest until stage 3); full E2E +
      UAT are the "Firefox unchanged" proof.
- [x] **C5a** — namespace normalization: background `api` (platform.js) + page
      `api` leaf (`webextension/api.js`); every raw `chrome.*`/bare
      `browser.*` site → `api.*` (behavior-identical on Firefox — full
      `pnpm test` green, incl. full E2E). `api` is a live-resolving Proxy over
      `globalThis.browser ?? chrome`, not a frozen `const` (a frozen
      reference would silently miss the ~20 tests that reassign
      `globalThis.chrome`/`browser` per test case) and is typed `any`, not
      `typeof browser` (the namespace still carries pre-existing
      callback-style calls `@types/firefox-webext-browser`'s promise-only
      surface has no overload for). The duplicated topSites-options logic
      (tiles-store.js await vs filters-ui.js callback) is namespace-normalized
      but NOT aligned — deferred to C5b per its own note below.
- [ ] **C5b** — the six wrappers, homed per the audit; menus/theme express
      Decisions 1–2 (presence-gated, absent on Chrome). Latent-care items from
      the audit §traps addressed (storage.session note, permissions.request
      gesture rule, webRequest no-blocking comment).
- [ ] Gates + FULL E2E per sub-slice + UAT spot-run (drawer 20–23 for theme,
      11 for the menu/action-row path).

### C6 — two-target manifest authoring
- [ ] `manifest.base.json` + per-browser overlays merged by a
      `scripts/build-manifest.mjs` sibling of `sync-version.mjs`; emitted
      `manifest.json` per target; `pnpm build` grows a target arg. No bundler;
      source == shipped holds for both targets.
- [ ] Gates + targeted E2E (loads-cleanly + lifecycle).

### C gate
- [ ] Full `pnpm test`, full UAT, `pnpm audit --audit-level=high`,
      boot-timing re-check, 2.5.0 bump, CHANGELOG promotion, build, docs sweep
      (CONTRIBUTING/TESTING/README + this file), follow-up code review
      round adjudicated.
- [ ] **Dissolve ROADMAP.md** (maintainer decision 2026-07-10): work items →
      GitHub issues (Chrome-port stage 3, favicon cursor-walk dedup, UAT
      backlog scenarios, README troubleshooting, SARIF/JUnit exploration) —
      EXCEPT the AMO release process, which goes into CONTRIBUTING.md as a
      "Releasing to AMO" note for future contributors (maintainer amendment:
      no GH issue for it — screenshots checklist pointer to
      `docs/amo-listing.md`, the new-listing/ID decision
      `newtabtools@symlink.ch`, listing copy/PRIVACY/reviewer-notes state,
      the 3.0.0 reservation); Scope & North Star + Non-goals → README
      "Scope" section; code-constraining decisions of record (frozen wire
      names, zero-runtime-deps, Fx-152 gate, no-build, event-page state
      placement, Chrome-via-dual-build, restore-validator independence) →
      CONTRIBUTING; historical outcomes → deleted (git history + audit/ +
      closed issues #2–#5 already hold them). Add a three-line "Where things
      live" note to CONTRIBUTING (work → GH issues; decisions → CONTRIBUTING;
      history → CHANGELOG/audit/git). Then `git rm ROADMAP.md` + redirect
      every ROADMAP reference (CONTRIBUTING Key Files, README, TESTING,
      CLAUDE.md-symlink content, eslint/test comments if any).

## What the Chrome port then reduces to (unchanged from the audit)

Fork the seam implementations (namespace, search, theme-degrade, menus-absent),
write the OffscreenCanvas `thumbnail-image.js`, add the Chrome manifest
overlay. Bounded, reviewable, a handful of files.

## Risks

- **C3's gesture-driven drag E2E** — known-flaky class, accepted by directive;
  contain with bounded retries + a documented quarantine policy rather than
  reverting to page-global driving.
- **C3/C4 diff size** — the two largest arcs since MV3; slice discipline and
  per-slice reviews (the M/H/P precedent) are the containment.
- **JSDoc drift during C4** — typing lands in C3, then C4 moves the typed code;
  keep C4 slices mechanical (move, don't rewrite) so types travel unchanged.
- **AMO delay** — the whole program precedes 3.0.0 by maintainer decision;
  revisit if AMO urgency changes.
