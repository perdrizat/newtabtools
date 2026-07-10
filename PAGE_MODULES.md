# Page Modules Arc — Page Scripts as Real ES Modules / Retire the globalThis Bridge

**Status: IN PROGRESS** (authored 2026-07-10; execution started 2026-07-10 on branch `page-modules`). Successor arc to the 2026-07 background
ES-module rewrite + HTML5 page conversion (records: git history; reviews and
inventories in `audit/2026-07-09-*`). Ships as **2.4.0** (minor, maintainer
decision; 3.0.0 is reserved for the AMO release once this arc and the follow-up
audits land) — behavior-preserving by definition, UAT-verified as such.
This file becomes the living checklist when work starts; update it per slice.

Current state this arc changes: `newTab.html` loads eight classic
`<script>` tags (`common.js` mid-body at :445; `icons.js`, `stats.js`,
`tiles-shim.js`, `prefs.js`, `awesomebar.js`, `newTab.js`, `fx-newTab.js` at
:461-467) sharing ONE implicit global scope, held together by `/* globals */`
headers and load order. The background is already fully modular; the two worlds
meet at the dual-scope bridge (`common.js`/`prefs.js` assign `globalThis.X =`,
`lib/platform.js` getters read them). This arc makes the page speak real
`import`/`export` and deletes the bridge.

## Status board (live)

| Step | Status | Commit |
|---|---|---|
| P1 — module entry flip (`page-main.js`) + boot orchestration | in progress | — |
| P2 — leaf modules: icons, stats, tiles-shim | pending | — |
| P3 — dual-scope endgame: common/prefs real exports + prefs change seam | pending | — |
| P4 — awesomebar module | pending | — |
| P5 — the monolith pair (newTab.js + fx-newTab.js) + harness retirement | pending | — |
| P gate — full UAT + audit + minor bump | pending | — |

## Decisions of record

### 1. Conversion strategy: flip-then-carve (the proven M1 pattern), not mixed-mode, not big-bang

**Chosen:** P1 converts the page's *loading* in one slice — every cross-file
name becomes an explicit `globalThis.X =` assignment (the dual-scope files
already have this form; page-only files convert from `var X`), and the eight
script tags collapse to one `<script type="module" src="page-main.js">` that
side-effect-imports the eight files in today's order and then runs the boot
calls explicitly. Behavior-identical modulo timing (Decision 4); the vm test
harness keeps passing untouched (the bridge form is script-parseable — the same
property that made Stage M's M1 zero-test-churn). Then P2–P5 convert files to
real `import`/`export` one slice at a time; once P1 lands, every page file IS a
module, so any file can adopt import syntax whenever its slice comes.

**Rejected — mixed classic/module strangler:** classic scripts execute during
parse; module scripts are deferred and execute after parse. Mixing the two
modes on one page *inverts relative execution order* (all classic before all
modules), so any classic consumer of a module-provided global runs before its
provider exists. With a circular mesh there is no safe partial ordering.

**Rejected — one-shot real-imports big-bang:** eight files including two
~2.3k-line monoliths plus cycle-untangling in a single diff is unreviewable and
un-bisectable; the whole point of the M1 precedent is that the risky timing
change and the mechanical syntax change land separately.

### 2. The monoliths convert in place; no splitting

`newTab.js` (2430 lines) and `fx-newTab.js` (2333) become single modules with
explicit exports. Splitting them into feature modules (Grid/Drag/undo/drawer…)
is a different, later arc — folding it in here would widen a deliberately
mechanical diff (the Stage-H discipline, revalidated by its review).

### 3. The newTab.js ↔ fx-newTab.js cycle: keep it as a real ESM cycle, with boot hoisted out

The mesh is genuinely circular (`newTabTools` ↔ `Grid`/`Page`/`Updater`/
`UndoDialog`; plus `pageMessageHandler` read by fx-newTab). ESM import cycles
are legal; the TDZ hazard is only *top-level* reads of not-yet-initialized
bindings. Every current cross-reference is call-time (that is exactly why
classic load order works today) — except fx-newTab.js's top-level trailer
(`UndoDialog.init(); newTabTools.startup(); pageMessageHandler.flushQueued()`),
which moves into `page-main.js` in P1. Rule of the arc, enforced by a
page-side module-scope test: **no page module executes another module's code at
its own top level** — all cross-module calls happen from `page-main.js`'s boot
or later. **Rejected:** init-injection (threading ~12 objects through
constructors — churn without insight) and an event-bus/registry seam
(indirection that hides the dependency graph this arc exists to expose).

### 4. Boot timing: `page-main.js` is the single orchestrator; defer is a feature but must be measured

Module scripts run after the full parse, just before `DOMContentLoaded` —
*later* than today's mid-parse execution at the bottom of `<body>`. Two
consequences: (a) the mid-body `common.js` tag (pure load-order plumbing) and
bottom-of-body placement become irrelevant; (b) first paint can now precede
boot, so a visible empty-page flash is possible on slow machines. P1 therefore
measures boot delta (E2E `waitForGridReady` timing vs. pre-flip baseline) and
gates on **full UAT** (visual judgment is the flash detector). Contingency if a
flash is observed — pre-hide the board via a CSS default that boot removes — is
recorded here but NOT pre-implemented. `startup()`'s `window.chrome` guard
stays.

### 5. tiles-shim.js converts in place

It stays the page-side message-proxy for `Tiles`/`Background` (wire names
frozen — `tests/integration/message-contract.test.ts`), gains real exports in
P2. Folding it into `lib/` was rejected: `lib/` modules are background-scoped;
this file is page transport.

### 6. Dual-scope endgame: real exports + a prefs change-notification seam

P3 gives `common.js`/`prefs.js` real `export`s; the page imports them directly,
`lib/background-main.js` switches its side-effect imports to named imports, and
`lib/platform.js`'s five bridge getters (`getPrefs`…`getCompareVersions`) are
deleted — lib consumers do real imports. The one design problem: `prefsChanged`
(prefs.js:201-215) currently sniffs `'newTabTools' in window` and calls page
globals (`newTabTools.updateUI`, `Grid.refresh`, `Updater.updateGrid`). A real
import in that direction would drag the page into the background's module
graph. **Chosen:** invert it — `Prefs.onChange(listener)` subscription; the
page registers a listener (in newTab.js or page-main) that does today's
updateUI/refresh dance; the background registers none. prefs.js becomes
scope-pure. **Rejected:** keeping the window-sniff (perpetuates the implicit
coupling) and a broadcast-message hop (prefs already runs in-page; no IPC
needed). Stretch (same slice, only if cheap): with the dual-scope files typed
as real modules, revisit `lib/background-main.js`'s `checkJs` exclusion — its
documented excuse (untyped dual-scope imports) dies here.

### 7. UAT gating (risk-adjusted, per the H2 precedent)

Full UAT twice: after **P1** (the timing/boot flip — where user-visible risk
concentrates) and at the **P gate** (release). Spot-runs after P3 (drawer
scenarios 20–23 — the prefs seam feeds the drawer's auto-save/update loop) and
after P5 (01/10/23/31 — tile grid + titlebar). E2E per slice, always.

## Execution checklist (commit per green slice)

Gates per slice unless noted: red/green fast tests, `pnpm lint`,
`pnpm typecheck`, `pnpm lint:webext`, plus E2E per the tiering below.

**E2E tiering (maintainer decision 2026-07-10, revised from full-per-slice):**
- **P2, P4:** targeted E2E only — the touched subsystem's test files plus the
  smoke trio `loads-cleanly` + `boot-timing` + `event-page-lifecycle`
  (`pnpm test:e2e tests/e2e/<file> …`; the runner forwards file args).
- **P3:** FULL suite (touches the background module graph + the prefs seam —
  the highest-coupling slice; lifecycle interplay is the point).
- **P5, P gate:** FULL suite + UAT per Decision 7.
- Rationale: the diffuse-blast-radius failure class P1 hit (`Drag` unbridged,
  caught by an unrelated E2E file) is now guarded statically — the fast-tier
  bridge-inventory test plus the TEST-ONLY-bridge policy below. A regression
  that still slips through surfaces at the next full run and bisects in one
  step (slices are committed individually).

**TEST-ONLY bridge policy (the enabler):** globals consumed by E2E/UAT
page-context evaluation (`Tiles`, `Prefs`, `Grid`, `newTabTools`, `NttIcons`,
`Updater`, `TileStats`, `Filters`, `Drag` — grep before each slice) must
SURVIVE their file's export conversion as `TEST-ONLY BRIDGE` -marked
`globalThis` assignments (the fx-newTab.js `Drag` precedent), even where the
plan below says the assignment "dies" — only production consumers move to real
imports. The surviving assignments consolidate into `page-main.js` at P5;
retiring them for real means moving the E2E/UAT harness off page-globals —
out of scope, ROADMAP backlog.

### P1 — module entry flip + boot orchestration
- [x] Convert cross-file page globals to explicit `globalThis.X =` form.
      Landed set: `NttIcons` (icons.js), `TileStats` (stats.js),
      `Tiles`/`Background` (tiles-shim.js), `AwesomeBar` (awesomebar.js),
      `newTabTools` + `pageMessageHandler` (newTab.js), `Page`/`Grid`/
      `Updater`/`UndoDialog`/`Drag` (fx-newTab.js — `Drag` isn't
      cross-referenced in-page but E2E drag-layout drives it via page-context
      evaluation; `Site`/`Cell`/`Drop`/`DropTargetShim`/`DropPreview`/
      `Transformation` stay file-local — only the script-mode vm harness
      reads them). `common.js`/`prefs.js` already assigned `globalThis`.
- [x] fx-newTab.js's top-level trailer (`UndoDialog.init()`,
      `newTabTools.startup()`, the guarded `flushQueued()`) moved to
      `page-main.js` — fx-newTab.js's top level is definition-only.
- [x] New `webextension/page-main.js`: side-effect imports of the eight files
      in the former tag order, then the boot calls; header documents the
      bridge story + Decision 3's rule. eslint got a one-file module-mode
      carve-out for it; tsconfig deliberately unchanged (adding page-main.js
      would drag all eight untyped page files into the program via
      import-following — same rationale as the background-main.js exclusion;
      P5 revisits).
- [x] `newTab.html`: mid-body common.js tag + seven bottom tags deleted; one
      `<script type="module" src="page-main.js"></script>` in `<head>`.
- [x] `action.html`/`action.js`: same flip (module attribute only —
      verified action.js references only its own scope + chrome APIs).
- [x] mountSite()'s regex strips deleted (nothing left to neutralize);
      harness comment updated. One pre-existing wiring test retargeted
      (tile-stats.test.ts's "linked in newTab.html" → "imported by
      page-main.js"); zero other test churn.
- [x] New page module-scope test: `tests/integration/page-module-scope.test.ts`
      (RED-proven: pre-fix, fx-newTab.js's trailer threw `ReferenceError:
      newTabTools is not defined` on native import, and 11 of the bridge
      globals were undefined).
- [x] Boot-timing measurement: captured pre/post via
      `tests/e2e/boot-timing.test.ts` (permanent instrument, single-file run:
      `pnpm test:e2e tests/e2e/boot-timing.test.ts`; numbers persist to
      `tests/e2e/_artifacts/boot-timing.txt`).
      **Pre-flip baseline (2026-07-10, classic scripts, headless FF 152.0.5):**
      firstTileSeen 99/95/95 (median 95), domInteractive median 26,
      domContentLoadedEventEnd median 28, fcp median 27 — all ms, page clock.
      **Post-flip (same day/binary, module entry):** firstTileSeen median
      95–98 across runs (delta ≈ 0, within the instrument's ±25ms poll
      granularity), domInteractive median 14–15 (improved — the parser no
      longer blocks on mid-body classic scripts), domContentLoadedEventEnd
      median 25–29, fcp median 21–28. **Verdict: the Decision-4 defer risk is
      a measured non-event**; UAT visual judgment remains the flash gate.
      Note: BiDi preload scripts don't apply to moz-extension:// pages, so
      firstTileSeen is harness-polled at 25ms granularity (see the test's
      header comment).
- [x] Gates + **FULL UAT**: fast 1282/1282, lint/typecheck/lint:webext clean,
      E2E 127/127 (one interim failure — E2E's page-context `Drag.start`
      access needed the bridge too; landed as the marked TEST-ONLY `Drag`
      bridge), **UAT 11/11, no boot flash observed** (Decision-4 gate closed:
      measured ≈0 delta + clean visual judgment). Code review
      `audit/2026-07-10-page-modules-p1-code-review.md` adjudicated same day:
      findings 1–4, 6–8 executed (behavioral page-main boot test, action.js
      module-mode test, all-or-nothing-boot risk recorded below, strip sweep
      completed, eslint blocks merged, shared menus mock, derived load order);
      finding 5 adjudicated keep-with-TEST-ONLY-marker (maintainer decision).

### P2 — leaf modules
- [ ] `icons.js` → `export const NttIcons`; `stats.js` → `export const
      TileStats`; `tiles-shim.js` → `export const Tiles, Background`.
- [ ] Consumers (awesomebar, newTab, fx-newTab — still bridge-form modules) gain
      real `import {NttIcons} from './icons.js'` etc.; the `globalThis`
      assignments for these three names die; `/* globals */` headers shrink.
- [ ] Tests for these files move vm-load → native import (icons.test.ts,
      stats/tile-stats suites, tiles-shim consumers); mountSite stops
      vm-loading icons.js (imports it instead).
- [ ] Gates.

### P3 — dual-scope endgame (touches background; E2E lifecycle tests are the point)
- [ ] `common.js`: `export function compareVersions`; `prefs.js`:
      `export const Prefs/Blocked/Filters/NeverCapture` + `Prefs.onChange()`
      subscription replacing the `'newTabTools' in window` branch (page
      registers the updateUI/Grid.refresh listener; background registers none).
- [ ] Page consumers import them; `lib/background-main.js` named-imports them;
      `lib/platform.js` loses the five getters (capability wrappers stay);
      lib consumers (`capture.js`, `tiles-store.js`, `backup.js`,
      `messages.js`) switch to real imports; `module-scope.test.ts` gains
      negative assertions (Prefs etc. NOT on `globalThis` anymore).
- [ ] Stretch: un-exclude `lib/background-main.js` from tsconfig if the typed
      dual-scope modules make it clean.
- [ ] Gates + UAT spot-run 20–23 (drawer/auto-save loop).

### P4 — awesomebar module
- [ ] `export const AwesomeBar`; imports NttIcons/Prefs/Tiles; its
      `globalThis` assignment dies; newTab.js imports it.
- [ ] awesomebar test suites → native imports.
- [ ] Gates.

### P5 — the monolith pair + harness retirement (one slice; they are one cycle)
- [ ] `newTab.js` exports `newTabTools`, `pageMessageHandler`; `fx-newTab.js`
      exports `Page`/`Grid`/`Updater`/`UndoDialog` (+ whatever P1's grep proved
      cross-referenced); each imports the other (legal cycle, Decision 3);
      `page-main.js` shrinks to two imports + boot calls; the last page
      `globalThis` assignments die.
- [ ] Test migration (the big one): page suites move from
      `loadModule`/`mountSite`/`vm.runInThisContext` to native imports with
      mocked chrome/browser installed pre-import (Stage-M pattern; beware the
      top-level `runtime.onMessage.addListener` in newTab.js — mocks must
      absorb it per import, and `vi.resetModules()` between suites).
      `loadModule`/`mountSite` are deleted when the last consumer migrates.
- [ ] eslint: the script-mode `webextension/**/*.js` block dies (everything is
      module-mode); `nttGlobals` in the test configs prunes to whatever E2E
      page-context evaluation still needs; `/* globals */`+`/* exported */`
      headers deleted repo-wide under `webextension/`.
- [ ] tsconfig: page files now enter the program via imports — decide
      deliberately what gets typed (JSDoc backfill stays type-as-you-touch;
      use targeted `@ts-expect-error` only per CONTRIBUTING rules).
- [ ] Gates + UAT spot-run 01/10/23/31.

### P gate
- [ ] Full `pnpm test`, **full UAT**, `pnpm audit --audit-level=high`, boot-
      timing numbers vs. P1 baseline re-checked, minor version bump (2.4.0, daily
      rule), CHANGELOG promotion, build.
- [ ] Docs sweep: CONTRIBUTING architecture + "Rules for new code" Modules
      bullet (page files are no longer the classic-script exception), TESTING
      harness idioms (imports everywhere; loadModule/mountSite gone), README
      architecture line, ROADMAP backlog entry closed, this file's board.

## Test-harness strategy (summary)

P1 is zero-test-churn by design (bridge form stays script-parseable). From P2
on, each slice migrates its own files' tests from vm loaders to native imports
— the same per-slice retirement Stage M ran for the background. `mountSite`'s
DOM/jsdom setup survives as a plain fixture helper until P5, then dies with
`loadModule`. The structural markup tests (readNewTabHtml users) are untouched
— this arc doesn't edit markup beyond the script tags.

## Risks

- **Boot flash (the user-visible one).** Defer moves execution after first
  parse; measured at P1, full-UAT-gated, CSS pre-hide contingency documented in
  Decision 4. This is the arc's H2-equivalent risk concentration.
- **Cycle TDZ.** Managed by Decision 3's no-top-level-cross-calls rule + the
  page module-scope test; the only known top-level cross-calls (fx-newTab
  trailer) are hoisted in P1.
- **Double listener registration in tests.** newTab.js registers
  `runtime.onMessage` at import time; native-import tests must mock + reset
  modules or listeners accumulate across suites.
- **jsdom vs. real module semantics.** Vitest transforms imports rather than
  using the browser loader — fidelity is good but not the real thing; E2E per
  slice is the actual module-loading gate (as it was for Stage M's M1).
- **Diff churn collision.** Do not interleave with other work touching
  newTab.js/fx-newTab.js; the P5 diff is large even though mechanical.
- **Boot is all-or-nothing.** ES-module graph evaluation is a single
  dependency-ordered pass: a top-level throw in any of page-main.js's eight
  imports rejects the whole graph, so its boot sequence never runs and the
  page renders as a permanently inert shell — the old classic `<script>` tags
  degraded per-script instead (a throwing tag didn't stop the next one).
  Accepted deliberately in P1 (review 2026-07-10 finding 3): the eight scripts
  already shared one scope and were already interdependent, so the old
  model's partial degradation was thin in practice.

## Out of scope (this arc)

- Splitting the monoliths into feature modules (later arc; P5 leaves them whole).
- The page-scope `el()` DOM-builder / `textContent` normalization (separate
  ROADMAP backlog item — keep this arc's diffs mechanical).
- TypeScript, any build step (standing decisions); Chrome (stage 3).
- UI/feature changes of any kind; markup changes beyond the script tags.
- Background architecture changes beyond deleting the platform bridge getters.
