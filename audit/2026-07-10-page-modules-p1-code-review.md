# Code Review — Page Modules Arc, slice P1 (module entry flip)

**Date:** 2026-07-10
**Branch:** `page-modules`
**Scope:** `git diff HEAD` against the `2.3.0` commit (`57cf557`) — the
uncommitted P1 working tree. Slice P1 of [`PAGE_MODULES.md`](../PAGE_MODULES.md):
flip the new-tab page from eight classic `<script>` tags to one
`<script type="module" src="page-main.js">`, add a `globalThis.X = X` bridge to
each page file, hoist `fx-newTab.js`'s boot trailer into `page-main.js`, and
flip `action.html`/`action.js` to a module. Successor to the Stage M/H reviews
([`2026-07-09-modernization-m`](2026-07-09-modernization-m-code-review.md),
[`-h`](2026-07-09-modernization-h-code-review.md)).
**Effort:** medium (8 finder angles × ≤6 candidates → verify; the module-
semantics angle ground-truthed with `node --input-type=module --check` on all
eight files and an empirical 19/19 run of the new page-module-scope test).

---

## Verdict

**No live correctness bug found.** The classic-script → ES-module flip is
semantically sound on every axis checked, each verified independently:

- **No strict-mode regression.** `node --check` in module mode passes for all
  eight files; no top-level implicit-global assignment, `with`, octal, dup
  param, or `arguments.callee`; every `this.` use is inside a method/callback,
  never at a module top level (where `this` is now `undefined`, not `window`).
- **Bridge is complete.** Every name any file reads cross-file — or that E2E/UAT
  page-context evaluation reaches — is assigned to `globalThis` (the six new
  bridges plus the pre-existing dual-scope `common.js`/`prefs.js` set). The
  file-local names (`Site`/`Cell`/`Drop`/`DropTargetShim`/`DropPreview`/
  `Transformation`) are confirmed read by nothing but the script-mode vm
  harness. No consumed-but-unbridged name exists.
- **Import order matches the old tag order exactly** (`git show
  HEAD:webextension/newTab.html` vs. `page-main.js`'s imports: common, icons,
  stats, tiles-shim, prefs, awesomebar, newTab, fx-newTab). No reorder-induced
  top-level undefined read.
- **Decision 3 holds.** `fx-newTab.js`'s top level is now definition-only; the
  boot trailer runs only from `page-main.js`. The page-module-scope test proves
  importing the files runs no cross-module top-level code.
- **`action.js` flip is safe.** It is fully self-contained (two internal
  functions, top-level DOM wiring, no cross-file globals, no inline handlers in
  `action.html` that reference its scope).
- **No security boundary moved.** `manifest.json` untouched (CSP, permissions,
  host_permissions byte-identical); no validation removed. CHANGELOG entries are
  one line each under `[Unreleased]`; no duplicate dated heading.

The findings below are test-coverage gaps, one robustness behavior-change worth
recording, and cleanup — ranked by what a maintainer should act on first. The
boot-flash risk is **not** listed: it is the arc's own open UAT gate (Decision 4,
checklist item still `[ ]`), tracked WIP rather than a review finding.

---

## Findings

### 1. `page-main.js` — the file that owns P1's behavior change — is executed by no fast-tier test; its wiring is guarded only by a source-string grep  — *test-coverage*
**File:** `webextension/page-main.js:44` · **Category:** test-coverage · severity: medium
**Verify: CONFIRMED** (`grep -rn page-main tests/`).

`page-main.js` is the entire point of P1: the eight-import list *and* the hoisted
boot order (`UndoDialog.init(); newTabTools.startup();
pageMessageHandler.flushQueued();`). Nothing in the fast tier executes it —
`page-module-scope.test.ts` imports the eight *leaf* files directly (never the
entry), and `tile-stats.test.ts:28` only does
`fs.readFileSync(page-main.js).toContain('./stats.js')`. That source grep is the
`ntt/no-source-grep` antipattern re-licensed with a disable comment; per
CLAUDE.md ("Before Committing") *"a source-string match may never be the sole
coverage for a functional behavior"* — and here it effectively is the sole
fast-tier coverage of the import wiring. The only executor is
`boot-timing.test.ts`, which asserts *timing*, not boot order or import
completeness.

**Failure scenario:** a P2 edit comments out an import or swaps two trailer
lines (e.g. `flushQueued()` before `startup()`). `toContain('./stats.js')` still
passes, `boot-timing` still greens as long as a tile eventually paints within
±25ms, and the regression ships past the fast tier. **Fix:** a behavioral test
that imports `page-main.js` with mocks pre-installed (Stage-M pattern) — it
subsumes the grep and dissolves the waiver in finding-adjacent §G below.

### 2. `action.js` now ships as an ES module but every test loads it as a classic script  — *test-coverage*
**File:** `tests/integration/action-popup.test.ts:52` · **Category:** test-coverage · severity: low-medium
**Verify: CONFIRMED** (`vm.runInThisContext(actionJs, …)` — script mode).

P1 flips `action.html` to `<script type="module" src="action.js">`, but
`action-popup.test.ts` still loads `action.js` via `vm.runInThisContext`
(classic, sloppy-mode). The test's own docstring notes a browser-action popup is
browser chrome, so **E2E/UAT cannot reach it either** — leaving *zero* coverage
of `action.js` under the strict-mode, module-scoped semantics it now runs with in
production. Today it's safe (the file is tiny and self-contained), so this is a
latent gap, not a live bug.

**Failure scenario:** a later `action.js` edit relies on sloppy-mode behavior
(an implicit-global assignment, a `var`/function redeclaration) — it passes the
classic-mode vm test but throws under real module loading, and no tier catches
it before users hit a broken toolbar popup. **Fix:** load `action.js` via native
`import()` in the integration test (mocks pre-installed), matching production.

### 3. Boot is now all-or-nothing: any top-level throw in one import aborts the whole page  — *robustness / behavior change*
**File:** `webextension/page-main.js:44` · **Category:** correctness (robustness) · severity: low
**Verify: PLAUSIBLE** (spec-certain mechanism; trigger requires a future throwing edit).

ES-module graph evaluation is a single dependency-ordered pass: a throw during
evaluation of any of the eight imports rejects the whole graph, so `page-main.js`'s
boot calls never run and the page renders as a permanently inert shell. Under the
old classic tags a throwing `<script>` did not stop the next tag. In practice the
eight scripts shared one scope and were already interdependent (a broken
`icons.js` starves tile rendering regardless), so the partial-degradation the old
model *nominally* offered was thin — which is why this is low, not a blocker. Worth
recording as a deliberate property of the new model, not a silent one.

### 4. Removed-behavior sweep is incomplete — a second neutralizing-strip site was missed  — *cleanup (removed-behavior)*
**File:** `tests/integration/tile-url-render.test.ts:44` · **Category:** simplification · severity: low
**Verify: CONFIRMED** (`.replace(/^UndoDialog\.init\(\);$/m …)` still present).

The diff correctly deleted the `UndoDialog.init()`/`newTabTools.startup()`
neutralizing strips from `_helpers.ts`'s `mountSite()` (they became no-ops once
the trailer moved to `page-main.js`), but the *identical* strips in
`tile-url-render.test.ts:44-46` were left — now dead `.replace()` no-ops. Worse,
the comment above them ("*lines 1939-1941 call UndoDialog.init() and
newTabTools.startup()*") now misdescribes `fx-newTab.js`, which per Decision 3 no
longer runs those at its top level. A future reader believes the opposite of what
the code does. **Fix:** delete the two `.replace()`s and the stale comment, same
as the `_helpers.ts` sweep.

### 5. `globalThis.Drag` is bridged solely to satisfy a test's access pattern  — *altitude*
**File:** `webextension/fx-newTab.js:290` · **Category:** altitude · severity: low
**Verify: CONFIRMED** (the file's own comment + cross-file grep: no in-page consumer).

Five of the six new bridges expose names with real cross-file production
consumers; `Drag` has none — its own comment says so — and is bridged only
because `tests/e2e/drag-layout.test.ts` drives `Drag.start` via page-context
`evaluate()`. This widens the page's public global surface to match what a *test*
reaches into, not what production needs, and the bridge list stops being a
faithful map of real cross-file coupling.

**Cost:** P2–P5 must remember to keep `Drag` on `globalThis` (or rewire the E2E
test) though no production code needs it; meanwhile any page code can silently
start depending on `window.Drag` as undocumented API. A test-only export marker
(or driving drag through a real user-gesture path in E2E) would keep the bridge
list = real consumers.

### 6. New eslint block for `page-main.js` duplicates the `lib/**/*.js` block verbatim  — *simplification*
**File:** `eslint.config.js:199` · **Category:** simplification · severity: low
**Verify: CONFIRMED** (byte-identical `languageOptions`/`rules`).

The added `files: ['webextension/page-main.js']` config object has
`ecmaVersion: 2020`, `sourceType: 'module'`, `globals: webExtGlobals`, and
`projectRules` — identical to the `lib/**/*.js` block (the comment even says "same
pattern"). **Cost:** two config objects to keep in sync; a future ecmaVersion/rule
change to ES-module files is easy to apply to one and forget the other. **Fix:**
`files: ['webextension/lib/**/*.js', 'webextension/page-main.js']` — one object,
no drift.

### 7. Two inconsistent ad-hoc `browser.menus` mocks for the same `tests/setup.js` gap  — *reuse*
**File:** `tests/integration/page-module-scope.test.ts:76` · **Category:** reuse · severity: low
**Verify: CONFIRMED** (`module-scope.test.ts` has its own, differently-shaped copy).

`page-module-scope.test.ts` hand-adds `browser.menus`
(`onShown`/`onClicked`/`update`/`refresh`) because `jest-webextension-mock`
doesn't model it — but the background counterpart this file explicitly mirrors,
`module-scope.test.ts`, already hand-adds its own *differently-shaped*
(`create`/`update`/`refresh`/`onShown`, no `onClicked`) copy. **Cost:** two
divergent mocks of one API; the next module-scope test hand-rolls a third, and a
real `menus` shape change means updating N copies. **Fix:** one shared
`browser.menus` mock in `tests/setup.js`.

### 8. Test's `PAGE_FILES_IN_LOAD_ORDER` hardcodes the import order, free to drift from `page-main.js`  — *simplification*
**File:** `tests/integration/page-module-scope.test.ts:52` · **Category:** simplification · severity: low
**Verify: CONFIRMED** (literal array; no mechanism ties it to `page-main.js`).

The array duplicates `page-main.js`'s eight `import` lines with nothing asserting
the two agree, while its comment claims to mirror "page-main.js's exact
side-effect-import order." **Cost:** P2–P5 explicitly reorder/rename imports; the
test will keep using the old order and pass while its comment goes false —
precisely when this test is the thing meant to catch order regressions. **Fix:**
derive the list from `page-main.js` (parse its import lines) or assert the two
match.

---

## Also noted (not elevated)

- **The `ntt/no-source-grep` waiver in `tile-stats.test.ts:207` states *what*,
  not *why*.** CLAUDE.md requires the justification to say *why a behavioral test
  isn't possible*; "wiring check: side-effect import list" describes the check.
  Folded into finding 1 because the real fix — a behavioral `page-main.js` test —
  removes the grep and its waiver entirely.
- **Copy-pasted 3-line bridge comment across six files** and the **17 one-per-
  global assertions** in the scope test are duplication, but both are
  deliberately transient (the bridges and their comments are deleted slice-by-
  slice in P2–P5, and the assertion style mirrors the established
  `module-scope.test.ts` convention). Not worth churning now.
- **Vestigial `newTabTools`/`UndoDialog` stub mocks in `_helpers.ts`** (seeded
  "if not already set" for the old trailer era) are now inert; harmless, a weaker
  instance of finding 4. Sweep alongside it if touching the file.
- **Boot flash (Decision 4).** The classic→deferred-module switch moves all
  execution after first parse; the measured ≈0 timing delta covers DOM marks, not
  visual flash on cold/throttled machines. This is the arc's tracked P1 UAT gate
  (`[ ] Gates + FULL UAT`), still open — the correct detector, and correctly not
  yet claimed done.

## Security boundary check

No boundary moved. `manifest.json` untouched — CSP directives, `permissions`,
`host_permissions`, `optional_permissions` byte-identical. No URL/protocol
validation removed. The module flip is a loading-mechanism change; it grants no
new capability.

---

## Adjudication (2026-07-10, same day)

- **1 — executed.** `tests/integration/page-main-boot.test.ts` leaf-imports the
  eight page files, spies/stubs the three boot entry points, then natively
  imports `page-main.js` (cache-shared graph) and asserts once-each + exact
  order. The `tile-stats.test.ts` source grep and its waiver are deleted
  (subsumed); the "newTab.html loads page-main.js" check stays.
- **2 — executed.** `action-popup.test.ts` loads `action.js` via native
  `import()` (module semantics, `vi.resetModules()` + cache-busting suffix for
  per-test fresh state).
- **3 — executed as documentation.** All-or-nothing boot recorded as a
  deliberate property in PAGE_MODULES.md's Risks; no code change (agreed the
  old per-tag degradation was illusory).
- **4 — executed.** `tile-url-render.test.ts`'s dead strips + stale comment
  removed. The adjacent "also noted" `_helpers.ts` stub sweep was NOT taken:
  the `newTabTools` stub is live, not inert — `mountSite` loads fx-newTab.js
  without newTab.js, and `Site` methods call `newTabTools.getString()` at
  call time through that stub.
- **5 — adjudicated: keep, with marker** (maintainer decision). The `Drag`
  bridge stays (rewiring E2E to synthesized drag gestures re-introduces the
  flakiness the test's design deliberately bypasses; the bridge is transient
  and retires in P5), now explicitly marked `TEST-ONLY BRIDGE — not
  production API` at the assignment site in fx-newTab.js.
- **6 — executed.** One merged eslint block:
  `files: ['webextension/lib/**/*.js', 'webextension/page-main.js']`.
- **7 — executed.** Shared `browser.menus` mock in `tests/setup.js`; both
  module-scope tests dropped their divergent ad-hoc copies.
- **8 — executed.** `PAGE_FILES_IN_LOAD_ORDER` is now parsed from
  `page-main.js`'s import lines (single source of truth, loud sanity net),
  with a why-based `ntt/no-source-grep` justification.
