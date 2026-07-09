# Modernization Arc — Background ES Modules, then HTML5 Page

**Status: STAGE M IN PROGRESS** on branch `modernization-m` (started 2026-07-09).
Successor arc to the completed MV3 migration ([`MV3_MIGRATION.md`](MV3_MIGRATION.md)).
One document for the whole arc, two stages: **M — background ES-module rewrite**
(first), **H — XHTML→HTML5 conversion** (second). This file is the living
checklist; update it per slice, like MV3_MIGRATION.md was.

Prerequisite (met 2026-07-09): the MV3 pre-release fix queue is executed and
2.1.0 is released. Stage M deliberately *replaces* some of those point fixes with
structural equivalents — see M2.

**Folded-in extras (maintainer 2026-07-09):** Stage M also absorbs every open
MV3_MIGRATION.md backlog/review item that is not HTML5-shaped: the §4.1 helper
dedups (M2/M5), the §4.3 early-broadcast queue (M5), the §3.1 action-sweep move
(M5), the ESR-140 retest (parallel verification task), and the three cosmetic
UAT findings (new slice M6). Excluded as HTML5-shaped: nothing — all XHTML items
were already Stage H.

## Status board (live)

| Step | Status | Commit |
|---|---|---|
| Sequencing decision (M before H) | ✓ decided 2026-07-09 | — |
| ESR-140 retest (MV3 capture gate confirmation) | ✓ done — gate CONFIRMED on the real 2.1.0 build (capture APIs absent on 140; min-version enforced even on temp installs; keep 152.0) | — |
| M1 — globalThis bridge + module entry flip | ✓ done (fast 1225, E2E 126, no wake-latency regression; zip spike FAILED → M4's ESM vendoring pulled forward: `lib/zip/` 25-file tree + `zip-global.js` bridge; AMO zip-reproducibility note now stale → M-gate docs) | — |
| M2 — `lib/db.js` + tiles store (ready-gated) | ✓ done (fast 1228, E2E 126; `db` global dead, `withStore` gate; bonus: `Thumbnails.delete`+`cleanupThumbnails` were still unguarded, now gated; `getGridTiles` rename; SAFE_PROTOCOLS unified, export.js independent) | — |
| M3 — capture pipeline module + image seam | ✓ done (fast 1234, E2E 126; background.js 1063→545 lines; agent-caught eval-time bridge-reference bug fixed via deferred closures; favicon test extraction hack deleted) | — |
| M4 — backup/export module + zip.js ESM vendoring | ✓ done (fast 1232, E2E 126; export.js dissolved into lib/backup.js, boundary verbatim; zip-global shim retired; zip-core.d.ts shadow types, update-zip preserves it) | — |
| M5 — `lib/platform.js` + entry consolidation + review leftovers | pending | — |
| M6 — cosmetic UAT findings (placeholder clip, chip contrast, scenario text) | pending | — |
| M gate — full E2E + full UAT + audit | pending | — |
| H1 — case-trap prefix fixes (XHTML-safe) | pending | — |
| H2 — markup conversion + rename + touchpoints | pending | — |
| H3 — `createElementNS` collapse | pending | — |
| H4 — tooling/i18n/UAT constants sweep | pending | — |
| H gate — full E2E + full UAT + audit | pending | — |

## Decisions of record

### 1. Sequencing: modules first, HTML5 second (2026-07-09)

Chosen on leverage, not dependency — the two stages are nearly disjoint
(background files vs page files; the only overlap is the dual-scope
`prefs.js`/`common.js`, whose complexity exists in either order).

- **Verification window.** The MV3 arc just built the exact harness a background
  rewrite needs: E2E runs with `extensions.background.idle.timeout=10000` so the
  event page suspends between every test, plus the suspension-recovery lifecycle
  test. A rewrite of startup/readiness code is safest while that stress rig — and
  the wake-race failure class it exists for — is fresh. Waiting a stage dulls it.
- **Absorbs the patch debt properly.** The pre-release fixes wrap ~10 handlers in
  `waitForDB()` by hand. M2 replaces the scattered-wrapper pattern with a
  ready-gated store API where an unguarded `db` access is unrepresentable. HTML5
  contributes nothing to that class.
- **Risk separation by observability.** Stage M is UI-invisible (guarded by 126
  E2E + the frozen message contract; UAT baseline stays untouched as a control).
  Stage H is UI-visible (guarded by UAT/screenshots; the background beneath it is
  then frozen). Each stage gets a clean control variable. The reverse order
  spends the UAT baseline on the low-visual-risk stage first.
- **Chrome long pole.** Stage-3 Chrome needs `lib/platform.js` + a no-DOM capture
  seam — both are M deliverables. H unlocks comparatively little (Chromium
  renders XHTML pages anyway).

**Rejected order (H first):** "smaller, quick win, aligns jsdom" — all true and
all minor. It double-spends the freshest verification asset (the MV3 lifecycle
rig) on the stage that doesn't need it, and leaves the wake-race class living on
hand wraps for a stage longer.

### 2. Dual-scope files: globalThis bridge, page stays classic

`common.js` and `prefs.js` load in BOTH the background and the page
(inventory §1.1). Real `export` syntax would break the page's classic `<script>`
loading; converting the page scripts to `<script type="module">` is NOT viable as
a side-effect (module scripts don't share top-level scope — the page's
`newTabTools ↔ Grid/Page/Updater` global mesh and the duplicate `var
HTML_NAMESPACE` would shatter; that untangling is its own future arc).

**Bridge:** the dual-scope files convert their top-level definitions from
`var X = …` to `globalThis.X = …`. That form works identically as a classic page
script AND as a side-effect `import` from a background module. Background modules
that need `Prefs`/`NeverCapture`/`compareVersions` do
`import '../prefs.js'` (side-effect) and read the global via one typed accessor
in `lib/platform.js` — a single documented seam, not scattered `globalThis`
reads. The bridge retires only when the page itself goes modular (out of scope).

### 3. Frozen message contract

The 19 `runtime.onMessage` names (inventory §1.8) are wire protocol. Stage M may
rename internals (`getAllTiles` → grid-fit name, per the 2026-06-10 §4.5
deferral) but never a message string. A contract test (integration) asserting the
dispatch table's names is part of M1 and survives the whole arc.

### 4. idb library: re-evaluated at M2 — outcome: stay hand-rolled (2026-07-09)

M2's `withStore` is ~50 lines of logic and behaviorally fine; the friction was
TypeScript, not IndexedDB (a `string|string[]`-polymorphic callback signature
fought JSDoc `@overload`, resolved with a precisely-typed `withObjectStore`
wrapper in tiles-store.js). Honest note from the implementation: `idb`'s typed
wrapper would have sidestepped that, so a reasonable adopt case exists if the
pattern repeats in M3/M4 — but zero-runtime-deps holds and the default-no
stance stands. Revisit only if M3/M4 hit the same typing wall.

## Stage M — background ES-module rewrite

Strategy: **flip to modules first with behavior identical, then carve.** Every
slice keeps the extension fully live and E2E-gated — no long-lived dark branch of
unloaded lib files.

### M1 — globalThis bridge + module entry flip (behavior-preserving)
- [ ] Convert top-level `var X =` / `function X` definitions to `globalThis.X =`
      in all six background files (and keep page behavior identical for the two
      dual-scope files — page scripts read the same globals).
- [ ] New `webextension/lib/background-main.js`: static side-effect imports of
      the six files in the manifest's current order; all listener registrations
      stay where they are (still top-level synchronous on import).
- [ ] `manifest.json`: `background: {"scripts": ["lib/background-main.js"],
      "type": "module"}`. `manifest.test.ts` red-first for the new shape.
- [ ] Strict-mode audit: modules force strict; sweep for sloppy-mode reliance
      (undeclared assignments, duplicate params, octals) before the flip.
- [ ] `lib/zip.js` — **M1's only unknown; spike FIRST.** With `"type": "module"`
      every file reachable from the background entry loads as a module, and the
      vendored zip.js build may not run as one (UMD wrappers bind to top-level
      `this`, which is `undefined` in module scope; CSP rules out any eval-based
      shim). Spike: side-effect-import the current file and exercise
      `makeZip`/`readZip`. If it breaks, pull M4's ESM re-vendoring forward into
      M1 (zip.js ships an official ESM build); if it works, defer to M4 as
      planned.
- [ ] Message-contract test (Decision 3) added.
- [ ] Tests: the vm-loaders keep working in M1 (files are still parseable as
      scripts? NO — `globalThis.X =` parses fine in script mode; vm loaders keep
      passing). Zero test-harness change this slice by design.
- [ ] Gates: fast, lint (eslint glob: entry lives under `lib/**` = module mode
      already; the six files stay script-parseable), typecheck, E2E.

### M2 — `lib/db.js` + `lib/tiles-store.js` (the readiness redesign)
- [ ] `lib/db.js`: owns open/reconnect (`onclose`/`onversionchange`), exposes
      `withStore(names, mode, fn)` that awaits readiness — **no caller can touch
      a raw `db` global**; the global disappears. Absorbs and supersedes the
      pre-release `waitForDB()` wraps and the `pickAndStore` re-guard.
- [ ] `lib/tiles-store.js`: Tiles/Background models moved from `tiles.js`;
      `_ready` state redesigned (set on success only — supersedes the tiles.js:53
      fix); **internal rename `getAllTiles` → `getGridTiles`** (wire name frozen);
      update `tiles-shim.js`'s NOTE comment.
- [ ] Unify the `['http:','https:','ftp:']` protocol constant across
      background/tiles/action-sweep (MV3 review §4.1) — **export.js's copy stays
      independent** (restore security boundary, decision of record).
- [ ] idb re-evaluation checkpoint (Decision 4) — record outcome.
- [ ] Tests: per-file migration begins — tests covering tiles/db behavior move
      from vm-load to native `import` of the lib modules (tiles-pin,
      background-and-history, parts of event-page-resilience). `loadModule`
      stays for not-yet-migrated files; delete each vm scaffold as its file
      migrates. The §2.1-regression integration test (on-command `indexedDB.open`
      mock, message dispatched before open resolves) is rewritten against
      `withStore` and MUST survive.
- [ ] Gates: fast, lint, typecheck, E2E.

### M3 — `lib/capture.js` + image seam
- [ ] Capture pipeline (sessions, network-idle, `captureTab`, `pickAndStore`)
      moves to `lib/capture.js`; `pendingCaptures` serialized helper comes along.
- [ ] `lib/thumbnail-image.js`: `resizeThumbnail`/`isBlank` behind a narrow
      interface. Firefox impl keeps DOM `Image`/canvas (per standing directive);
      the module boundary IS the OffscreenCanvas-for-Chrome seam (backlog item
      folds here as a documented seam, not an implementation).
- [ ] Tests: auto-thumbnail suite migrates to imports (largest single test file —
      budget accordingly).
- [ ] Gates: fast, lint, typecheck, E2E (the lifecycle/suspension tests are the
      point of this slice's gate).

### M4 — `lib/backup.js` + zip.js ESM vendoring
- [ ] Vendor `@zip.js/zip.js`'s ESM build via `pnpm update-zip` (script updated);
      supply-chain review per CONTRIBUTING (lockfile diff, exact pin unchanged,
      reproducibility note in docs/amo-submission-notes.md).
- [ ] `makeZip`/`readZip` → `lib/backup.js` importing zip ESM;
      `purgeNeverCaptureHost` import edge resolved explicitly.
- [ ] Restore boundary (`allowedKeys`, `safeProtocols`, validators) moves
      verbatim — **security boundary: no widening, keep export.js's protocol
      list independent** (2026-07-09 decision), acknowledge the file move in the
      commit message.
- [ ] Tests: backup-restore suite migrates to imports.
- [ ] Gates: fast, lint, typecheck, E2E.

### M5 — `lib/platform.js` + consolidation
- [ ] `lib/platform.js`: capability layer — browser API surface used by the
      background (permissions checks, capture API presence probe, action
      enable/disable, i18n, menus), the `globalThis` bridge accessor
      (Decision 2), and `broadcastToPages()`. This is the file Chrome/stage-3
      forks; keep it thin and typed.
- [ ] `background-main.js` becomes the only listener-registration site (all
      `addListener` top-level in one readable file); old `background.js`
      dissolves; delete emptied files; eslint glob cleanup (script-mode block
      shrinks to the page files + dual-scope bridge files).
- [ ] MV3 review §3.1: action-button sweep moves from per-respawn top-level to a
      `runtime.onInstalled`/`onStartup` seed + `webNavigation.onCompleted`
      maintenance (per-tab action state persists outside the event page).
- [ ] MV3 review §4.3: `pageMessageHandler` (newTab.js) queues early `Page.*`
      broadcasts and flushes once the fx-newTab.js globals exist (replaces the
      silent typeof-guard drop).
- [ ] Docs: CONTRIBUTING architecture section, TESTING.md test-writing idioms
      (import, not vm), MV3_MIGRATION.md backlog items closed, this file's board.
- [ ] Gates: fast, lint, typecheck, `pnpm lint:webext`, E2E.

### M6 — cosmetic UAT findings (UI-visible, so before the full-UAT gate)
- [ ] Never-capture host input: placeholder no longer clips at the input edge
      (shorten placeholder or widen input; UAT scenario 22 observation).
- [ ] Action-row chips: no white-on-white blend against mostly-white thumbnails
      (scenario 23 observation — add a subtle scrim/border token treatment).
- [ ] `tests/uat/scenarios/11-action-buttons.md`: update stale "dark scrim" prose
      to the current light-chip design.
- [ ] Gates: fast, lint, typecheck, E2E; visual verification lands in the M gate's
      full UAT run.

### M final gate
- [ ] Full `pnpm test`, **full UAT suite** (background swap is invisible, but
      capture (01), actions (11), restore (21), advanced (22) re-verify the
      pipelines end-to-end), `pnpm audit --audit-level=high`, version bump per
      daily rule, CHANGELOG promotion, build.

## Stage H — XHTML → HTML5 conversion

All hazards from inventory §2. Strategy: make the JS case-safe first (works under
both parsers), then convert markup, then collapse namespaces — each slice green
under the parser it ships with.

### H1 — case-trap prefix fixes (safe under XHTML today)
- [ ] `newTab.js:2320`-class `nodeName`/`tagName` comparisons → case-insensitive
      (`.toLowerCase()`), all occurrences (re-grep; inventory lists the known
      three). Ships under XHTML unchanged behavior.
- [ ] Audit CSS selectors and tests for case sensitivity assumptions.
- [ ] Gates: fast, E2E.

### H2 — markup conversion + rename + touchpoints (the flip)
- [ ] `newTab.xhtml` → `newTab.html`: expand every self-closing non-void tag
      (the 9 template `<span/>`s at :426-436, `<button/>` at :327 — these
      SILENTLY mis-nest under HTML parsing, this is the whole risk); add
      `<!DOCTYPE html>` + `<meta charset="utf-8"/>`; drop the root `xmlns`
      (keep the SVG one); keep attribute spellings.
- [ ] Rename touchpoints in one commit: `manifest.json` `chrome_url_overrides`,
      `background` `NEW_TAB_URL`, `tests/e2e/_helpers.ts:118`, UAT tools ×5 +
      `uat-scenario.md`, `scripts/amo-screenshots.mjs`, the ~16 source-grep
      integration tests' path constants, `tests/unit/i18n.test.ts` file list,
      `loads-cleanly` E2E (XML-parse-error assertion → grid-renders assertion).
- [ ] jsdom: fast tier already parses HTML by default (inventory §3.2) — after
      this slice the harness is *more* faithful, not less; delete the
      TESTING.md XHTML gotcha.
- [ ] Gates: fast, E2E, **full UAT** (visual parity is the acceptance test;
      compare against pre-H2 screenshot baselines, all scenarios).

### H3 — `createElementNS` collapse
- [ ] 26 HTML-namespace call sites (newTab.js ×7, fx-newTab.js ×12,
      awesomebar.js ×7) → `createElement`; delete both `HTML_NAMESPACE` consts
      and awesomebar's `HTML_NS`. **`icons.js:11` SVG stays namespaced.**
- [ ] Update the namespace-hardcoding tests (objecturl-revoke, awesomebar-dom,
      drag-reorder, recent-tabs, auto-thumbnail:831, drawer-layout).
- [ ] Gates: fast, E2E, UAT spot-run (tile grid + awesomebar scenarios: 01, 10,
      23, 31).

### H4 — tooling/i18n sweep + docs
- [ ] `scripts/i18n-stale.mjs` / `i18n-purge.mjs` extension filters;
      `localization.test.ts` extension branch; any remaining `.xhtml` grep hit
      in the repo (target: only historical audit/ docs mention it).
- [ ] Docs: CONTRIBUTING "Core" line, TESTING.md, README.
- [ ] Gates: fast, lint, typecheck, E2E.

### H final gate
- [ ] Full `pnpm test`, full UAT, audit, bump, CHANGELOG, build.

## Test-harness strategy (summary)

- **vm loaders retire per-file, not wholesale.** Each M slice moves its files'
  tests from `vm.runInThisContext` to native `import`; `loadModule`/`mountSite`
  keep serving unmigrated (page) files through both stages and are deleted only
  when nothing uses them (post-arc, with the page-module future work).
- `mountSite`'s regex strips (`UndoDialog.init()`, `newTabTools.startup()`) are
  untouched by this arc (page files stay classic) — but H2/H3 edit the files it
  loads; re-verify the regexes after each H slice.
- The ~16 source-grep tests keep their (path-updated) structural role; no
  behavioral test is weakened by either stage. `ntt/no-source-grep`
  justifications stay valid.

## Risks

- **M1 zip.js/module-graph unknown** — spike before committing to M1's shape
  (may pull M4's ESM vendoring forward).
- **Module strict mode** — latent sloppy-mode code fails fast at M1; the audit
  step exists for this.
- **Event-page wake latency** — a module graph resolves before listeners
  register; static imports only (no top-level await in the graph), measure wake
  time in the M final gate against pre-M1.
- **H2 silent mis-nesting** — the expand-before-rename discipline plus
  tile-redesign structural tests plus full UAT screenshot review are the triple
  guard; do not hand-minimize the template markup during conversion.
- **Churn collisions** — do not interleave M and H slices; M gate closes before
  H1 opens.

## Out of scope (this arc)

- Page scripts as real ES modules / retiring the globalThis bridge (future arc;
  unblocked by M, not required by H — `<script type="module">` works in XHTML
  and HTML alike).
- Chrome implementation (stage 3) — M only builds its seams (`platform.js`,
  thumbnail-image interface).
- TypeScript, any build step (standing decisions).
- UI/feature changes of any kind; both stages are behavior-preserving by
  definition and UAT-verified as such.
