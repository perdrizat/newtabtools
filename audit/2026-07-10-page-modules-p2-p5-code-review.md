# Code Review — Page Modules Arc, slices P2–P5

**Date:** 2026-07-10
**Branch:** `page-modules`
**Scope:** `git diff 57cf557` (against `2.3.0`) — the full arc, minus slice P1
(already reviewed in
[`2026-07-10-page-modules-p1-code-review.md`](2026-07-10-page-modules-p1-code-review.md),
findings adjudicated). Covers **P2** (leaf modules `icons`/`stats`/`tiles-shim`
→ real `export`s, `4e2924b`), **P3** (dual-scope endgame: `common`/`prefs` real
exports, `lib/platform.js` bridge-getter deletion, the `Prefs.onChange` seam,
`aa8adcf`), **P4** (`awesomebar.js` → real imports, `b4e7a12`), and **P5** (the
`newTab.js`↔`fx-newTab.js` ESM cycle + harness retirement — **uncommitted
working tree, its Gates + FULL E2E + UAT still open** `[ ]`).
**Effort:** medium (7 finder angles). P5 (ungated) and P3 (highest-coupling
committed slice) got the most firepower; the cycle-semantics, cross-file, and
P3-parity angles were ground-truthed directly (module-evaluation-order trace,
old-vs-new `prefsChanged` diff, E2E global-read grep).

> **Coverage note (honest):** a session rate-limit terminated 3 of 7 finders
> mid-run (conventions, P5 test-harness, reuse/efficiency). Their partial results
> all trended clean (see "Also noted"); the correctness-critical angles — cycle
> semantics, cross-file tracer, P2/P4 line-scan, and P3 (which re-ran
> `tsc`/`eslint`/fast-tier **1296/1296** green, plus the 9 fallout files together
> at 227 passing) — completed. Treat the reuse/conventions/P5-test-isolation
> dimensions as *lightly* covered, not exhaustively; P2/P3/P4 are well-covered.

---

## Verdict

**No live correctness bug found across P2–P5.** Each load-bearing risk was
verified:

- **The `newTab.js`↔`fx-newTab.js` ESM cycle is safe (P5).** Traced the actual
  evaluation order: `page-main.js` imports `newTab.js` before `fx-newTab.js`, so
  DFS enters `newTab.js` → its trailing `import … from './fx-newTab.js'` forces
  `fx-newTab.js` to evaluate first; `fx-newTab.js`'s back-edge to `newTab.js`
  hits an in-progress module and is skipped without re-entry. Every cross-module
  reference (`fx`→`newTabTools`, `newTab`→`Grid`/`Page`/`Updater`) is inside a
  method/callback, never a top-level read, so the `export const newTabTools` TDZ
  is never touched during evaluation. `newTab.js`'s top-level DOM-wiring IIFE
  runs after `fx-newTab.js` is fully evaluated.
- **The `Prefs.onChange` seam reproduces the old `prefsChanged` branch exactly
  (P3).** Old vs new are line-for-line identical: `updateUI(keys)` →
  `_markAutoSaved()` guard → `rows`/`columns` ⇒ `Grid.refresh()` + drawer-open/
  tile-tab `resizeOptionsThumbnail`, `else history` ⇒ `Updater.updateGrid()`. The
  thumbnailSize-only short-circuit still fires *before* any listener, so a
  thumbnailSize-only change still skips the page dance. The background registers
  no listener (was `'newTabTools' in window` false there) — equivalent.
- **`lib/platform.js` getter deletion left no orphan caller (P3).** The five
  consumers (`background-main`, `tiles-store`, `capture`, `backup`, `messages`)
  all switched to real `import`s; P3 is committed and passed its gates (fast
  1296/1296, typecheck clean, E2E 127/127) — an orphaned `getPrefs()` call would
  have failed typecheck.
- **P2/P4 leaf/awesomebar exports are clean.** The two claimed P4 behavior fixes
  check out (`_iconFor`'s null-branch is unreachable-but-harmless; `_tiles(q)`'s
  dropped arg is a true no-op); `visitTime ?? 0` is behavior-preserving for the
  0-vs-undefined case.
- **Unbridged/pruned symbols are safe (P5).** No live E2E/UAT test reads
  `Site`/`Drop`/`Transformation` (given real exports, no `globalThis` bridge) or
  the pruned `Blocked`/`DropTargetShim` off the page — the only grep hits are a
  string literal and a historical `tests/uat/artifacts/…/xpi-patch/` snapshot.
- **No security boundary moved.** `manifest.json` is not in the diff; `lib/backup.js`'s
  only change is swapping `getFilters()` for a real `import { Filters }` — the
  restore allow-list and protocol validation are untouched.

The one finding is a **labeling/documentation defect with a concrete
future-failure path**, plus minor cleanup.

---

## Findings

### 1. `awesomebar.js` is a production consumer of two "TEST-ONLY" bridges — the label is false in four places  — *correctness-adjacent / documentation*
**File:** `webextension/awesomebar.js:5` (and `fx-newTab.js` ~2349, `newTab.js` ~2452, `CHANGELOG.md`, `eslint.config.js` ~178) · severity: low-medium
**Verify: CONFIRMED** (independently traced + finder-confirmed).

P5 re-labels the surviving `globalThis.Grid = Grid` (`fx-newTab.js`) and
`globalThis.newTabTools = newTabTools` (`newTab.js`) as **"TEST-ONLY BRIDGE …
no production consumer reads a page global anymore,"** echoed in `CHANGELOG.md`
and the merged `eslint.config.js` block. But `awesomebar.js` — imported
unconditionally by `page-main.js`, i.e. production — still declares
`/* globals Grid, newTabTools */` (its own P5 comment admits converting them to
real imports "was not part of this slice's scope") and reads both at call time:

```js
// _tiles():
if (typeof Grid !== 'undefined' && Grid && Grid.sites) { for (let s of Grid.sites) … }
// render:
newTabTools.getString(labelKey)            // ~line 352
newTabTools.getString('search_prompt', …)  // ~line 368
newTabTools.isValidURL(url)                 // ~line 429
```

In module scope those bare identifiers resolve **only** through
`globalThis.Grid`/`globalThis.newTabTools` — the exact assignments now marked
TEST-ONLY. So the two bridges remain load-bearing for the titlebar-search
feature, and PAGE_MODULES.md's framing that retiring them is merely "moving the
E2E/UAT harness off page-globals" is incomplete (it must also convert
`awesomebar.js`).

**Failure scenario:** a maintainer executes the ROADMAP "retire the surviving
`globalThis` bridges" backlog item, trusting the TEST-ONLY label, and deletes
`globalThis.Grid`/`globalThis.newTabTools`. The `_tiles()` read degrades
silently (`typeof Grid` → false, grid-aware results vanish), but the unguarded
`newTabTools.getString(...)`/`isValidURL(...)` calls throw `ReferenceError` the
moment the user opens the awesome bar — broken titlebar search. **Fix (correct
the paper trail now; the code is fine):** downgrade the blanket "no production
consumer reads a page global anymore" claim in `fx-newTab.js`, `newTab.js`,
`CHANGELOG.md`, and `eslint.config.js` to name the `awesomebar.js` exception —
PAGE_MODULES.md's P5 checklist item 5 is already honest about it; the other four
spots overreach. The real remediation (convert awesomebar's two globals to
imports) is correctly deferred, but the label must match reality until then.

### 2. Dead `typeof X !== 'undefined'` guards left behind by the import conversion  — *simplification*
**File:** `webextension/newTab.js:2174` (`pageMessageHandler`), `webextension/awesomebar.js:210,321` · severity: low
**Verify: CONFIRMED** (imported bindings are never `undefined`).

`pageMessageHandler` still guards `if (typeof Updater !== 'undefined')` /
`typeof Grid` and `awesomebar.js` guards `typeof NttIcons`/`typeof Prefs` — all
now real imported bindings, so these are permanently true (and `typeof` on a
live import binding can't be `'undefined'`). Harmless but dead; they read as
"this might be missing" when the conversion guarantees it isn't. Drop them (or,
for the awesomebar pair, fold into the finding-1 import conversion). Note the
`Grid`/`newTabTools` guards in `awesomebar.js` must stay until finding 1 is
resolved (those are *not* imports yet).

---

## Also noted (not elevated)

- **Shared-singleton test pattern (P3/P5).** Suites now mutate the real imported
  `Prefs`/`Tiles`/`NeverCapture`/`TileStats`/`Blocked`/`Filters` singletons in
  place rather than replacing `globalThis.X` stand-ins. Vitest isolates modules
  per test *file* by default, so cross-file leakage is contained; within-file
  leakage is guarded by `beforeEach`/`afterEach` resets where I checked
  (`tile-redesign` restores `statType`/`compute`; `filter-cap` aliases
  `RealPrefs`/`RealBlocked`/`RealFilters` to avoid shadowing its other describe's
  stubs). The P5 test-harness finder confirmed **all `mountSite` callers were
  updated to `await`** before it was cut off. This dimension is *lightly*
  reviewed — a full pass on cross-test contamination (a suite that mutates a
  singleton without restoring it) did not complete; worth a spot-check before the
  P gate.
- **`any`-cast bridges (P3/P5).** `globalThis.Prefs = /** @type {any} */ (Prefs)`
  etc. The conventions finder (partial) judged each cast "documented narrowly …
  satisfies the repo's bar; not a violation" — each carries an inline reason (the
  ambient-global-inference collision, the Annex B `__defineGetter__` typing gap).
- **`ensureSiteEnv()` seed ordering.** The memoized `Prefs.statType='none'` seed
  runs inside the one-time promise; `tile-redesign`'s `mountWithStat` correctly
  `await ensureSiteEnv()` *before* overriding `statType`, per the diff's own
  comment. No missed call site found in the completed grep.
- **Stale ambient declarations in `globals.d.ts` (P5).** After the conversion,
  `Site`/`Drop`/`Transformation`/`Cell`/`DropTargetShim`/`zip` are no longer read
  as bare identifiers by any test (all consumers use named/namespace imports or
  `(globalThis as any)` casts). The `declare global { var … }` entries for them
  are now dead noise — TypeScript doesn't flag unused ambient globals, so no build
  failure, but they misrepresent the real test-global surface. Prune when
  convenient. (Cross-file tracer confirmed every name E2E *does* read in page
  context — `Grid`/`newTabTools`/`Drag`/`Tiles`/`Prefs`/`Filters`/`NttIcons`/
  `Updater`/`TileStats`/`Page`/`Background` — is still bridged.)
- **Boot flash / P5 gate.** P5's own Gates + FULL E2E + UAT (checklist `[ ]`) is
  the real module-loading + visual gate; the cycle correctness above is verified
  in jsdom, which "transforms imports rather than using the browser loader"
  (PAGE_MODULES.md risk). `pnpm test:e2e` + the UAT spot-run (01/10/23/31) remain
  the actual gate — not yet run for P5.

## Security boundary check

No boundary moved. `manifest.json` untouched (not in the diff). `lib/backup.js`'s
only change is `getFilters()` → `import { Filters } from '../prefs.js'`; the
restore allow-list, `safeProtocols`, and URL/color validation are unchanged. No
CSP, permissions, or `host_permissions` edits anywhere in the arc.

---

## Adjudication (2026-07-10, same day)

- **The open P5 gate noted in the scope line closed before this adjudication:**
  full E2E 127/127, UAT spot-run 01/10/23/31 4/4 (first attempt aborted by the
  same session rate limit that cut the finders short; clean on retry).
- **1 — executed as prescribed (paper trail corrected; conversion deferred).**
  The four overreaching "no production consumer" claims (fx-newTab.js,
  newTab.js, eslint.config.js, CHANGELOG) now name the awesomebar.js
  exception and mark `Grid`/`newTabTools`'s bridges LOAD-BEARING. The real
  conversion is blocked on exactly what the review inferred: a static import
  of the monoliths from awesomebar.js (which is in the typed program) would
  pull both into `checkJs` — it rides the future monolith-typing arc, now an
  explicit ROADMAP backlog prerequisite.
- **2 — executed narrowly.** awesomebar.js's dead `typeof Prefs`/`typeof
  NttIcons` guards dropped (real imports since P4). Declined for now: the
  `pageMessageHandler` `typeof Updater/Grid` guards — they double as the
  early-broadcast queue's triggers; removing them means retiring the whole
  (now provably dead) queue mechanism plus its M5-era tests, a standalone
  cleanup recorded in the ROADMAP backlog rather than a drive-by. The six
  additional dead-true `typeof` guards in newTab.js (1216–1824, not listed by
  the finding) are likewise left for that sweep — deliberately-untouched
  monolith style.
- **Also-noted items:** stale `globals.d.ts` ambient declarations pruned
  (`Site`/`Drop`/`Cell`/`DropTargetShim`/`zip`); the singleton
  cross-contamination spot-check is accepted as covered by the per-file module
  registry isolation + the repeated 1296-green fast runs; the `any`-cast
  bridge pattern stands as reviewed.
