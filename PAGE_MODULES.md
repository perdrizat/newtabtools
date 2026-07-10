# Page Modules Arc — Page Scripts as Real ES Modules / Retire the globalThis Bridge

**Status: DONE** (executed 2026-07-10 on branch `page-modules`; slices P1–P5
landed, each with its own adjudicated code review). Successor arc to the 2026-07 background
ES-module rewrite + HTML5 page conversion (records: git history; reviews and
inventories in `audit/2026-07-09-*`). Ships as **2.4.0** (minor, maintainer
decision; 3.0.0 is reserved for the AMO release once this arc and the follow-up
audits land) — behavior-preserving by definition, UAT-verified as such.
The P gate (full UAT + audit + version bump + docs sweep) is the one remaining
step; see the status board and checklist below.

Historical starting point (state *before* this arc; no longer current —
superseded by P1–P5 below): `newTab.html` loaded eight classic
`<script>` tags (`common.js` mid-body at :445; `icons.js`, `stats.js`,
`tiles-shim.js`, `prefs.js`, `awesomebar.js`, `newTab.js`, `fx-newTab.js` at
:461-467) sharing ONE implicit global scope, held together by `/* globals */`
headers and load order. The background was already fully modular; the two worlds
met at the dual-scope bridge (`common.js`/`prefs.js` assigned `globalThis.X =`,
`lib/platform.js` getters read them). This arc made the page speak real
`import`/`export` and deleted that read path (TEST-ONLY `globalThis`
assignments survive per the policy below).

## Status board (live)

| Step | Status | Commit |
|---|---|---|
| P1 — module entry flip (`page-main.js`) + boot orchestration | done | `4de0411` |
| P2 — leaf modules: icons, stats, tiles-shim | done | `4e2924b` |
| P3 — dual-scope endgame: common/prefs real exports + prefs change seam | done | `aa8adcf` |
| P4 — awesomebar module | done | `b4e7a12` |
| P5 — the monolith pair (newTab.js + fx-newTab.js) + harness retirement | done | `03501ba` + `6505173` |
| P gate — full UAT + audit + minor bump | done | (release commit) |

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
imports. The surviving assignments stay at the BOTTOM OF THEIR DEFINING FILE
(a page-main.js consolidation was considered and rejected 2026-07-10: the
fast-tier suites import the defining files directly and would lose the
globals; the booting entry can't be imported by them). Retiring them for real
means moving the E2E/UAT harness off page-globals — out of scope, ROADMAP
backlog. Consequence for the planned module-scope.test.ts negative
assertions: they can never land while the dual-scope files self-assign —
dropped from the plan, recorded here.

**Outcome (chrome-prep C3d, 2026-07-10):** this policy is retired. The
maintainer's chrome-prep directive 1 moved the E2E/UAT harness off page
globals for real (runtime messages/`browser.storage.local`/DOM observation/
synthesized DOM events), so every TEST-ONLY bridge assignment this policy
produced — including the dual-scope survivors in common.js/prefs.js — was
deleted; the module-scope.test.ts negative assertions this policy's
consequence note said could never land now do, in both
`tests/integration/module-scope.test.ts` and `page-module-scope.test.ts`. See
CHROME_PREP.md C3d for the full account.

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
*(Revised 2026-07-10: consumers do NOT gain import lines yet — newTab.js/
fx-newTab.js/awesomebar.js are still vm-loaded by the fast-tier harness until
their own slices, and `vm.runInThisContext` can't parse `import` syntax. The
`globalThis` assignments therefore SURVIVE — they still have real in-page
consumers until P5, plus the E2E/UAT harness per the TEST-ONLY policy above.
P2's deliverable is: the leaf files speak `export`, `page-main.js` documents
the graph with named imports, and the leaves' own test suites go native.)*
- [x] `icons.js` → `export const NttIcons`; `stats.js` → `export const
      TileStats`; `tiles-shim.js` → `export const Tiles, Background` — each
      KEEPING its `globalThis` assignment, comment updated to name the
      remaining consumers (page files until P4/P5; E2E/UAT page-context).
      `/* exported */` pragmas deleted (real `export` replaces them); eslint's
      script-mode `webextension/**/*.js` block can no longer parse `export`,
      so the three files moved into the module-mode block alongside
      `lib/**/*.js`/`page-main.js` (narrowest fix — only these three filenames
      added, no broader glob change).
- [x] `page-main.js`: side-effect imports stay as-is (a named-but-unused
      import would only trip `no-unused-vars`; the entry stays the load-order
      authority, nothing more). Header comment updated for accuracy (three of
      the eight files now have real exports; the rest stay classic-script
      until P4/P5).
- [x] Tests for these files move vm-load → native import: `icons.test.ts`
      (native `import()`), `stats.test.ts` (native `import`, `TileStats` now a
      shared singleton — `_hasHistoryPermission` reset + `globalThis.browser`
      replaced per test instead of a fresh vm context per call),
      `tile-stats.test.ts`'s two `stats.js` `vm.runInContext` blocks (same
      singleton treatment; its unrelated `prefs.js` vm blocks are untouched —
      P3 scope). `tiles-shim.js` had no dedicated vm-load suite to migrate
      (only `page-module-scope.test.ts`/`page-main-boot.test.ts` touch it,
      already native-importing since P1, left unchanged per this slice's
      guard-test rule). `_helpers.ts`'s `mountSite()` stops vm-loading
      icons.js — replaced with a top-level `import '../../webextension/
      icons.js'` (its `globalThis.NttIcons` bridge assignment covers what the
      vm load provided); `mountSite()` and its ~20 call sites stay sync, no
      async churn needed.
      RED confirmed: reverting `icons.test.ts` to its vm form against the
      now-exported `icons.js` throws `SyntaxError: Unexpected token 'export'`
      at `vm.runInThisContext` — the same failure mode applies to
      `stats.test.ts`/`tile-stats.test.ts`'s `vm.runInContext` calls and
      `mountSite`'s `vm.runInThisContext(iconsSource, …)`.
      `pnpm typecheck` newly pulled `icons.js`/`stats.js` into the program
      (native, statically-resolvable `import` specifiers, unlike P1's
      computed-path dynamic imports) — minimal JSDoc added (`el`/`create`/
      `kebab`/`grip`/`dot` params in icons.js; `TileStats` method params +
      `_hasHistoryPermission: boolean | null` in stats.js; `visitTime ?? 0`
      guards for the WebExtension type's optional `visitTime` field).
- [x] Gates + targeted E2E: fast 1282/1282, lint/typecheck/lint:webext clean;
      targeted E2E 29/29 in 3.7 min (loads-cleanly, boot-timing,
      event-page-lifecycle, tile-redesign, pin-persists).

### P3 — dual-scope endgame (touches background; FULL E2E per the tiering)
*(Revised 2026-07-10, same strangler reality as P2: the `globalThis`
assignments for `Prefs`/`Blocked`/`Filters`/`NeverCapture`/`compareVersions`
SURVIVE this slice — newTab.js/fx-newTab.js/awesomebar.js still read them as
bare identifiers until P4/P5, and E2E/UAT page-context evaluation reads
`Prefs`/`Filters` too. What P3 retires is the background's READ path: the
five `lib/platform.js` getters die, lib consumers import for real. The
planned module-scope.test.ts negative assertions therefore defer to P5.)*
- [x] `common.js`: `export function compareVersions`; `prefs.js`:
      `export const Prefs, Blocked, Filters, NeverCapture` — bridge
      assignments stay (cast through `any` on the way out — see below),
      comments updated to name remaining consumers.
- [x] `Prefs.onChange(listener)` subscription replaces the
      `'newTabTools' in window` branch. The page's listener registers in
      `page-main.js` (newTab.js can't import until P5; the callback calls
      `newTabTools.updateUI`/`Grid.refresh`/`Updater.updateGrid` as bare
      globals at event time — legal per Decision 3, it's post-boot); the
      background registers none. `prefsChanged` invokes every registered
      listener with the array of changed pref names (the same info the old
      branch consumed), after the pre-existing thumbnailSize-only
      short-circuit. Behavioral coverage:
      `tests/integration/prefs-onchange-seam.test.ts` (registration/firing,
      no-listener background scenario, and — leaf-importing the real page
      files + spying on `newTabTools`/`Grid`/`Updater`, then natively
      importing `page-main.js` — proof its own registration reproduces the
      old branch's `updateUI`/`_markAutoSaved`/`Grid.refresh`/
      `Updater.updateGrid` dance exactly, including the drawer-open/tile-tab
      conditional for `resizeOptionsThumbnail`).
- [x] `lib/background-main.js` named-imports common/prefs; `lib/platform.js`
      loses the five bridge getters (capability wrappers stay); lib consumers
      (`capture.js`, `tiles-store.js`, `backup.js`, `messages.js`) switch to
      real imports.
- [x] Fast-tier migration: every suite that vm-loads `prefs.js`/`common.js`
      (via `loadModule` or raw vm) moves to native import. Grepped and found:
      `prefs-persistence.test.ts` (full-file `vm.runInThisContext`),
      `tile-stats.test.ts`'s "statType — behavioral validation" describe
      (`vm.runInContext` on a sandbox), `filter-cap.test.ts`'s "Filter host
      normalization" describe (`vm.runInThisContext`), `never-capture.test.ts`
      (`loadModule`, fresh `vm.createContext` per test) — all four migrated to
      native `import`, with `Prefs`/`Blocked`/`Filters`/`NeverCapture` treated
      as shared singletons (internal state reset per test — `_listeners`,
      `_list`, `_theme` etc. — rather than a fresh vm context) per the P2
      `stats.js`-singleton precedent. `common.js` had no dedicated vm-load
      suite to migrate (only referenced via `globalThis.compareVersions` mock
      stubs elsewhere, unaffected).
      **Second-order fallout (not anticipated by the grep above):** three
      suites exercising `lib/tiles-store.js` directly (`filter-cap.test.ts`'s
      "Filter matching" describe, `tiles-pin.test.ts`,
      `background-and-history.test.ts`'s "Hide history tiles" describe) used
      to override `globalThis.Prefs`/`Blocked`/`Filters` with a fresh
      stand-in object to drive tiles-store.js's behavior — this worked only
      because the old `getPrefs()`/`getBlocked()`/`getFilters()` accessors
      read `globalThis` at call time. Now that tiles-store.js imports these
      for real, a replacement object is invisible to it; all three migrated
      to mutate the real singletons' properties in place instead (aliased
      imports `RealPrefs`/`RealBlocked`/`RealFilters` in `filter-cap.test.ts`,
      since its OTHER describe block still legitimately relies on the bare
      `Prefs`/`Filters` identifiers resolving to its own unrelated
      `globalThis` stub for a vm-loaded newTab.js UI harness). Also found and
      fixed: `backup-restore.test.ts` had a dead `Filters.normalizeHost` stub
      (same blind spot — `lib/backup.js` now imports `Filters` for real too),
      coincidentally still passing only because the stub reimplemented the
      exact same logic; removed in favor of the real singleton.
      **JSDoc-fallout ambient-global gotcha (the other unanticipated one):**
      giving `Prefs` a real, full JSDoc shape (`PrefsAccessors`, covering the
      `__defineGetter__`/`__defineSetter__`-wired pref properties the plain
      object literal doesn't statically have) plus reaching it via
      `background-main.js`'s now-unexcluded, now-checked-JS-eligible
      `import` caused TypeScript's checked-JS "ambient global inferred from a
      `globalThis.X = …` assignment" behavior to override
      `tests/integration/globals.d.ts`'s deliberately loose
      `declare global { var Prefs: any; … }` with the full internal shape —
      breaking every test-only partial mock across the suite (not just
      prefs.js's own file). Fixed at the source: the bridge assignments
      (`globalThis.Prefs = /** @type {any} */ (Prefs);` etc., in both
      prefs.js and common.js) cast through `any`, keeping the ambient global
      loose for tests while `import { Prefs } from '../prefs.js'` still gets
      the full type for real lib/ consumers.
- [x] eslint: `common.js`/`prefs.js` move to the module-mode block.
- [x] Stretch: un-excluded `lib/background-main.js` from tsconfig — clean.
      Fallout was a handful of JSDoc additions (five listener-callback
      params via three named top-level functions instead of anonymous
      `addListener(function(...) {...})` — the JSDoc needs a declaration to
      attach to; one `tabs.Tab.windowId?: number` optional-vs-required cast,
      matching the file's existing `tab.id` cast precedent) — well under the
      "revert if >~15 errors" threshold.
- [x] Gates + FULL E2E + UAT spot-run 20–23: fast 1296/1296, lint/typecheck/
      lint:webext clean, E2E 127/127, UAT 4/4 (21-restore's "applied fully
      live, no reload" is the onChange seam verified end-to-end). *(Fast
      gates green — see report; FULL E2E + UAT spot-run are orchestrator-run,
      not part of this slice.)*

### P4 — awesomebar module
*(Revised 2026-07-10, same strangler reality: newTab.js can't import until
P5, so `globalThis.AwesomeBar` SURVIVES as a production bridge until then —
what P4 converts is awesomebar.js's own READ side: it becomes the first page
file with real `import`s, consuming the P2/P3 exports.)*
- [x] `export const AwesomeBar` + real `import { NttIcons } from './icons.js'`,
      `import { Prefs } from './prefs.js'`. The checklist's planned third
      import, `Tiles` (tiles-shim.js), was NOT added: grepping the file's own
      `/* globals */` header (`Grid, NttIcons, Prefs, newTabTools` — `Tiles`
      was never in it) and its body (no `Tiles` identifier anywhere;
      `_tiles()` reads `Grid.sites`, not `Tiles`) confirms the header's claim
      didn't include it and the body doesn't use it — so the true import set
      is `{NttIcons, Prefs}`, narrower than the plan's draft text. `Grid`/
      `newTabTools` stay bare globals (fx-newTab.js/newTab.js can't export
      until P5); `/* globals */` header shrunk to `Grid, newTabTools`. The
      `globalThis.AwesomeBar` assignment stays, comment updated (consumer:
      newTab.js until P5, plus E2E/UAT page-context).
- [x] awesomebar test suites → native imports. `awesomebar.test.ts` (pure
      `buildResults`/`nextIndex` model) drops `loadModule` entirely — no
      chrome/browser mocks needed for either describe block.
      `awesomebar-dom.test.ts` (DOM/browser wiring) drops its
      `vm.runInThisContext` + `fs.readFileSync` load for a native import;
      its old `globalThis.NttIcons = {...}` / `globalThis.Prefs = {...}`
      stubs, installed *before* the vm load, no longer work now that
      awesomebar.js real-imports both (a stand-in object assigned to
      `globalThis.X` is invisible to a real import binding — the same P3
      tiles-store.js "second-order fallout" gotcha). Fixed the same way P3
      fixed it: `NttIcons` needs no stub at all (its `create()` works fine
      against jsdom's `document.createElementNS`); `Prefs` is imported for
      real and mutated in place per test (`Prefs.titleBarSearch = true` in
      `beforeEach`, restored in a new `afterEach` from a `beforeAll`-captured
      original value) instead of replaced.
      `tests/integration/_helpers.ts`'s `loadModule` (`vm.createContext` +
      `vm.runInContext` sandbox loader) had zero remaining consumers once
      `awesomebar.test.ts` migrated (per the P3 report, it was the last) —
      deleted here rather than waiting for P5, with the helper's comments
      updated (its `vm`/`vi` imports stay: `mountSite` still
      `vm.runInThisContext`-loads fx-newTab.js, a classic script until P5).
      Guard tests `page-module-scope.test.ts` / `page-main-boot.test.ts`
      needed no changes — both already natively `import()` awesomebar.js by
      computed path (dynamic, not statically analyzed), so its new internal
      `import`s of icons.js/prefs.js just hit the module cache those tests
      already populated earlier in the load order.
- [x] eslint: `awesomebar.js` moved to the module-mode block (alongside
      icons.js/stats.js/tiles-shim.js/common.js/prefs.js); the script-mode
      block's comment updated — its set shrinks to newTab.js/fx-newTab.js/
      action.js.
      **JSDoc fallout (larger than P2/P3's "handful" precedent, but still
      fixed with real JSDoc, no exclusions):** natively importing
      awesomebar.js from `.ts` test files pulled it into the checked-JS
      program for the first time (it isn't reachable from any
      `tsconfig.json` `include` glob otherwise). It's a DOM/browser-glue
      object literal with many untyped params and runtime-assigned
      properties, so the fallout was substantial: three typedefs
      (`SourceItem`, `Sources`, `ResultItem`) replacing `buildResults`'
      member-less inline object-literal JSDoc types (`{tiles?, ...}` — a
      JSDoc shape omitting member types, which produces implicit-`any`
      members); explicit `@type`/`@param`/`@returns` on every method and
      helper arrow function; `input`/`searchBox`/`dropdown` declared as
      typed fields (`HTMLInputElement`/`HTMLElement`, cast through `any` at
      their pre-`init()` placeholder value — the same "cast through `any`
      for a narrow, documented reason" idiom prefs.js already uses for its
      `__defineGetter__` wiring) rather than left nullable throughout (which
      would have forced non-null assertions at every one of their ~20 call
      sites); inline casts for chrome-API callback params (`chrome` is
      ambiently typed `any` in `tests/integration/globals.d.ts`, so TS can't
      infer a callback's parameter type from an `any`-typed call and flags
      it regardless). Two real (non-JSDoc-only) fixes surfaced along the
      way, both behavior-preserving: `_iconFor` gained an explicit
      null-check on `NttIcons.create()`'s result before returning it (its
      declared return type is nullable; all four names this file passes it
      always produce a real icon, so the fallback span is unreachable in
      practice, same as before) — and `_query`'s `this._tiles(q)` call
      dropped a stray, always-ignored `q` argument (`_tiles` takes no
      parameters; the extra argument was silently accepted by JS and never
      flagged until awesomebar.js entered the typed program).
- [x] Gates: fast 1296/1296, lint/typecheck/lint:webext clean; targeted E2E
      15/15 in 1.8 min (loads-cleanly, boot-timing, event-page-lifecycle,
      awesomebar, titlebar).

### P5 — the monolith pair + harness retirement (one slice; they are one cycle)
*(Revised 2026-07-10 per the P1–P4 precedents and the TEST-ONLY bridge
policy: the bridge assignments do NOT die — after P5 no page file reads
globals (everything imports), so every surviving assignment is re-marked
TEST-ONLY at its defining file's bottom. fx-newTab.js additionally exports
the internals the fast tier constructs directly (`Site`, and `Drag`/`Drop`/
`Transformation` for the drag suites) — real exports beat more bridges for
tests that import the file anyway. The monoliths deliberately stay OUT of
the typed program: fast tests reach them via the established computed-path
`@vite-ignore` dynamic-import pattern (P1's page-module-scope precedent), so
tsc never follows the specifier; full JSDoc backfill of ~4.8k monolith lines
is type-as-you-touch, a different arc.)*
- [x] `newTab.js` exports `newTabTools` (`export const`), `pageMessageHandler`
      (`export function`) + real imports of everything it reads: leaves via
      P2–P4 exports (`AwesomeBar`, `Background`/`Tiles`, `NttIcons`,
      `TileStats`, `Blocked`/`Filters`/`NeverCapture`/`Prefs`,
      `compareVersions`) plus `Grid`/`Page`/`Updater` from `./fx-newTab.js`
      (legal cycle, Decision 3 — verified every cross-reference is call-time
      only: fx-newTab.js's own dependency-evaluation order means it finishes
      its top level, definitions-only, before newTab.js's top level runs, so
      even the `typeof Grid !== 'undefined'` guards in `pageMessageHandler`
      are always-true by the time any message can arrive). `fx-newTab.js`
      exports `Page`/`Grid`/`Updater`/`UndoDialog`/`Site`/`Drag`/`Drop`/
      `Transformation` + real imports of `newTabTools` from `./newTab.js`
      (NOT `pageMessageHandler` — grepped, only referenced in a comment, the
      same "narrower than the plan's draft text" precedent as P4's `Tiles`)
      plus `Blocked`/`NeverCapture`/`Prefs`/`NttIcons`/`Tiles`/`TileStats`.
      `/* globals */`/`/* exported */` headers deleted from both.
- [x] `page-main.js`: boots via named imports — `Prefs` from prefs.js,
      `newTabTools`/`pageMessageHandler` from newTab.js, `Grid`/`UndoDialog`/
      `Updater` from fx-newTab.js; its `/* globals */` header is gone. The
      three now-named-import specifiers (prefs.js/newTab.js/fx-newTab.js)
      replaced their former side-effect-only line rather than sitting
      alongside it (a plain `import './prefs.js';` next to
      `import { Prefs } from './prefs.js';` would be a harmless but
      redundant duplicate); the other five files stay side-effect-only,
      preserving the eight-file load-order documentation.
- [x] All surviving `globalThis` assignments re-marked TEST-ONLY in
      newTab.js/fx-newTab.js (`newTabTools`, `pageMessageHandler`, `Page`,
      `Grid`, `Updater`, `UndoDialog`, `Drag`) — no page file reads a global
      anymore. `tiles-shim.js`'s `Tiles`/`Background` bridge assignments
      needed the same `any`-cast fix P3 applied to prefs.js/common.js (a real
      `import` of `Tiles` in a test file pulled tiles-shim.js into the
      typechecked program for the first time, surfacing the ambient-global-
      from-assignment collision). `Site`/`Drop`/`Transformation` deliberately
      do NOT gain a matching `globalThis` assignment — real exports cover the
      fast tier, which imports the file directly.
- [x] Test migration: `_helpers.ts`'s `mountSite` is now async
      (`ensureSiteEnv()`, exported, is the memoized once-per-file loader) —
      mounts the real `newTab.html` body first, then a computed-path
      `await import()` of fx-newTab.js (`@vite-ignore`). The old
      full-replacement `Prefs`/`Tiles`/`Blocked`/`NeverCapture`/`TileStats`/
      `newTabTools`/`UndoDialog`/`Grid`/`Updater` stand-ins are gone; the real
      singletons provide their defaults (`Prefs.statType` seeded to `'none'`
      as a plain pre-`init()` property — `Prefs.init()` itself is NOT called,
      real boot is out of scope). `tests/setup.js`'s `chrome.i18n.getMessage`
      mock now echoes its key back (was `Translated<key>`) so `getString`
      assertions keep their old meaning. Direct vm users: grepped every
      `vm.runInThisContext`/`vm.runInContext`/`readFileSync` hit against
      newTab.js/fx-newTab.js (~32 files) and classified by pattern — the
      large majority extract individual method/function bodies via regex
      into a synthetic harness object (`extractMethod`-style) and never
      actually parse the real file, so they're unaffected by the
      `import`/`export` syntax change; only three did a genuine whole-file
      load: `tile-url-render.test.ts` and `drag-reorder.test.ts` (migrated to
      the same computed-path `import()` pattern, driving the real `Prefs`/
      `Tiles`/`newTabTools` singletons in place instead of pre-seeding
      `globalThis`) plus `_helpers.ts` itself. `mountSite` survives (still the
      DOM+Site fixture for `edit-mode.test.ts`/`tile-redesign.test.ts`/
      `tile-surface.test.ts`, all updated to `await` it); those three also
      needed their own `globalThis.X = {...}` replacements (Prefs/TileStats/
      NeverCapture) converted to in-place singleton mutation.
      `page-module-scope.test.ts` needed one adjustment (not a bridge
      removal): its load-order regex only matched bare side-effect imports,
      so it missed page-main.js's three now-named imports — widened to match
      both forms; the test's assertions are otherwise unchanged and pass.
      `page-main-boot.test.ts` needed no changes.
- [x] eslint: the script-mode `webextension/**/*.js` block is retired
      entirely (not just narrowed) — action.js (no `import`/`export` of its
      own, but already loaded `type="module"` since P1) joins the one
      module-mode block instead, which is the smaller diff and the more
      accurate parse mode for how the browser actually loads it. `nttGlobals`
      pruned to names grepped as still referenced by E2E `page.evaluate()`
      callbacks (`Blocked`/`DropTargetShim` dropped — zero remaining
      references anywhere under `tests/`). `/* globals */`/`/* exported */`
      headers deleted under `webextension/` (awesomebar.js briefly kept a
      narrower `/* globals Grid, newTabTools */` — resolved same day at the
      P gate by the P2–P5 review finding-1 dependency inversion:
      `getString`/`isValidURL` extracted to common.js, tiles injected via
      `AwesomeBar.init({tilesSource})`; no page file reads any global now).
- [x] tsconfig: no include change; verified `pnpm typecheck` is clean and the
      monoliths are not reachable via any static specifier (only computed-path
      `webextPath(...)` dynamic imports reference them) — confirmed by grep
      and by the clean typecheck run itself.
- [x] Gates + FULL E2E + UAT spot-run 01/10/23/31: fast 1296/1296,
      lint/typecheck/lint:webext clean, E2E 127/127, UAT 4/4 (first attempt
      aborted by an API session rate limit — not a page defect; clean on
      retry).

### P gate
- [x] Full `pnpm test` (fast 1302/1302 + full E2E 127/127, E2E and full UAT
      run in parallel — maintainer-approved, separate ports/profiles),
      **full UAT 11/11** (21 benign observations), `pnpm audit
      --audit-level=high` clean, boot-timing re-checked, CHANGELOG promoted
      to `## [2.4.0] — 2026-07-10`, minor bump + build.
      **Boot-timing at gate (2026-07-10, fully modular page):** firstTileSeen
      median 96 (pre-arc baseline 95 — unchanged), domInteractive median 12
      (pre-arc 26), domContentLoadedEventEnd median 25, fcp median 13
      (pre-arc 27). The arc is timing-neutral on grid-populated and improved
      on parse metrics.
      **Pre-release addendum:** the P2–P5 review's revised finding-1
      remediation (awesomebar dependency inversion — `getString`/`isValidURL`
      to common.js, `tilesSource` injection) landed at the gate per
      maintainer decision; all gates re-run green on the final tree.
- [x] Docs sweep: CONTRIBUTING architecture + "Rules for new code" Modules
      bullet (page files are no longer the classic-script exception), TESTING
      harness idioms (imports everywhere; loadModule gone, mountSite async),
      README architecture line, ROADMAP backlog entry closed, this file's
      board.

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
