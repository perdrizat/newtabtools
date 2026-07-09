# Code Review — Modernization Stage M (background ES-module rewrite)

**Date:** 2026-07-09
**Branch:** `modernization-m`
**Scope:** `git diff master...HEAD` restricted to the hand-written background
module changes (M1–M6). The vendored `webextension/lib/zip/**` ESM tree (~9 000
lines of third-party code) and docs were excluded from correctness review.
**Effort:** medium (8 finder angles × ≤6 candidates → 1-vote verify).
**Reviewer:** automated `/code-review` fan-out.

---

## Verdict

The carve-up is **remarkably faithful**. The load-bearing risks of this refactor
were all checked and came back clean:

- **Frozen wire contract intact.** All 19 `runtime.onMessage` names sent by the
  page still map to a live `case` in `lib/messages.js`; the internal
  `getAllTiles → getGridTiles` rename did not leak into a wire name.
- **Response shapes preserved** (`{tiles, list}`, `{cache, list}`, the `Map`
  responses) — the page-side callers still get what they expect.
- **Dual-scope bridge works both ways.** `common.js`/`prefs.js` assign
  `globalThis.X = …`; the page reads bare `X`, `lib/` reads via `platform.js`
  accessors. No strict-mode-only construct survives the module-graph pull-in
  (`with`, octals, dup params, undeclared assignments all absent).
- **Schema v9, `getTZDateString`, `SAFE_PROTOCOLS`, `isBlank` decode-failure
  handling, the capture A/B/C `finalized`/session-identity race, and the
  `pendingWriteChain` serialization** were all verified byte-equivalent /
  correct. No top-level listener was dropped (`runtime.onStartup` was in fact
  added).

The findings below are, in order: one genuine **behavioral deviation introduced
by the refactor**, two **pre-existing correctness bugs preserved verbatim** in
moved code (worth fixing while the file is fresh), one **plausible issue in new
M5 code**, and cleanup. None block the M gate; #1 and the two backup bugs are
the ones a maintainer would most want to act on.

---

## Findings

### 1. Action-button sweep no longer self-heals; misses extension disable→re-enable  — *introduced*
**File:** `webextension/lib/background-main.js:185-227`
**Category:** correctness (behavior regression) · severity: low-medium

Master ran the `tabs.query({})` enable/disable sweep at **top level**, so it
re-ran on *every* event-page respawn. M5 (§3.1) deliberately moved it to a seed
that fires only on `runtime.onInstalled` **and** `runtime.onStartup`. This is a
sound optimization for the common case (per-tab action state persists across
respawns), but it changes observable behavior in two ways:

- **Disable→re-enable from `about:addons` fires neither `onInstalled` nor
  `onStartup`.** After a manual re-enable, per-tab action state is back to the
  default (enabled) for every already-open tab, and `seedActionSweep()` never
  runs to correct it. Tabs sitting on non-`http(s)`/`ftp` URLs (e.g.
  `about:config`) keep an *enabled* toolbar button until the user next
  navigates them (`webNavigation.onCompleted` re-corrects on navigation).
- **Lost periodic self-heal.** Any action state that drifted (e.g. an
  `action.enable()` that rejected because the tab was still loading) used to be
  re-corrected on the next respawn; that safety net is gone.

**Failure scenario:** user disables then re-enables the extension; a background
tab on `about:config` shows an enabled (but pointless) toolbar action until
navigated. Cosmetic, narrow trigger — but it is a real deviation from the
"behavior-preserving" claim and should be acknowledged (or covered by seeding on
a third signal). Verdict: **CONFIRMED** (deviation), low-medium user impact.

---

### 2. `readZip` applies wallpaper + prefs before a wrong-shape (but parseable) `tiles.json`/`prefs.json` aborts the restore  — *pre-existing, preserved*
**File:** `webextension/lib/backup.js:144-232`
**Category:** correctness · severity: medium

The comment at `backup.js:139-143` claims restore is atomic — "Parse every JSON
entry BEFORE writing any state … a malformed backup then aborts the whole
restore atomically." That only holds when `JSON.parse` *throws*. It does **not**
hold for JSON that parses to the wrong *shape*:

- `tiles.json = '{"x":1}'` → `getAsJSON` returns an object, survives
  `if (!tiles)` (line 220), then `for (let t of tiles)` (line 232) throws
  `TypeError: tiles is not iterable` — **after** `Background.setBackground(...)`
  (line 157) and `chrome.storage.local.set(filtered)` (line 216) have already
  written wallpaper and prefs.
- `prefs.json = 5` → survives `if (prefs)` (line 160), then `'theme' in prefs`
  (line 171) throws — again after `setBackground`.

This is exactly the half-applied "new grid dimensions, zero/old tiles, no error
surfaced" state the comment says it eliminated. **Byte-identical to master's
`export.js`**, so pre-existing — but the M4 slice re-owns and re-documents this
function with an atomicity claim it does not fully deliver.

**Fix:** validate shape up-front alongside the parse
(`Array.isArray(tiles)` / `typeof prefs === 'object'`), throwing *before* any
write. Verdict: **CONFIRMED**.

---

### 3. `readZip` dereferences `tilesMap.get(id)` without a null check — orphan image entry crashes the whole restore  — *pre-existing, preserved*
**File:** `webextension/lib/backup.js:235-240`
**Category:** correctness · severity: medium

```js
for (let e of entries) {
    if (e.filename.startsWith('tileImages/')) {
        let id = parseInt(e.filename.substring(11), 10);
        let image = await getAsBlob(e);
        tilesMap.get(id).image = image;   // ← throws if no tile has that id
    }
}
```

A backup containing a `tileImages/N.png` with no matching tile `id` in
`tiles.json` (hand-edited, version-mismatched, or a garbage name like
`tileImages/abc.png` where `parseInt → NaN`) makes `tilesMap.get(id)` return
`undefined` and the `.image =` assignment throw, aborting the entire import
(and, per #2, after wallpaper/prefs were already written). **Byte-identical to
master** — pre-existing, but trivially guardable
(`let t = tilesMap.get(id); if (t) t.image = image;`) and worth fixing while the
file is fresh. Verdict: **CONFIRMED**.

---

### 4. Early-broadcast flush replays `Page.updateGrid`/`Page.restoreComplete` before the grid is built  — *introduced (M5 §4.3)*
**File:** `webextension/fx-newTab.js:2334`, `webextension/newTab.js` (`pageMessageHandler.flushQueued`)
**Category:** correctness · severity: low (self-correcting)

The new queue replays deferred broadcasts at the *end of `fx-newTab.js`'s
top-level execution* via `flushQueued()`. At that moment `Updater`/`Grid` **exist
as identifiers**, so the replay takes the direct branch — but
`newTabTools.startup()` builds the grid **asynchronously** inside
`Prefs.init().then(...) → Page.init()`, which has not run yet. So a replayed
`Grid.refresh()` / `Updater.updateGrid()` (and `refreshBackgroundImage()`) runs
against a not-yet-populated grid.

In practice this is mitigated: the subsequent async `Page.init()` rebuilds from
fresh post-restore data, so the premature replay is corrected. The residual risk
is an **unguarded throw** inside the synchronous `flushQueued()` loop if
`Grid.refresh()` mis-behaves on an empty grid. Trigger is narrow (a background
broadcast arriving in the millisecond window during page load; both triggering
broadcasts are user-initiated). Verdict: **PLAUSIBLE** — consider deferring the
flush until after `Page.init()` resolves, or wrapping each replay in try/catch.

---

### 5. Three byte-identical `withObjectStore` wrappers kept in sync only by comment  — *introduced cleanup*
**File:** `webextension/lib/tiles-store.js:46`, `webextension/lib/messages.js:43`, `webextension/lib/capture.js:55`
**Category:** simplification · severity: low

The same two-line single-store narrowing wrapper is copy-pasted into three
modules, each with a comment pointing at the other two ("mirrors …"). The wrapper
carries **no per-file behavior** — only a cast of `withStore`'s union parameter
to `IDBObjectStore`. `db.js` owns the union; a single exported generic
`withObjectStore<T>(store, mode, fn)` there would serve all three call sites and
delete ~30 lines of duplicated code + cross-referencing comments. The
"intentional duplication" claim in the comments is unconvincing for a pure type
cast. Verdict: **CONFIRMED** (cleanup).

---

### 6. Dead defensive closures around the three `webRequest` listeners  — *introduced cleanup*
**File:** `webextension/lib/background-main.js:92-102`
**Category:** simplification · severity: low

The three `webRequest` listeners wrap `resetNetworkIdleTimer` in
`function(details){ resetNetworkIdleTimer(details); }`, and the adjacent 6-line
comment admits the wrapping is "no longer load-bearing" post-bridge-era, kept
only for "visual uniformity." `resetNetworkIdleTimer` is a resolved import and
can be passed directly (`.addListener(resetNetworkIdleTimer, {urls:[…]})`). The
justification comment is now larger than the code it defends and misleads future
readers into thinking the wrapping matters. Verdict: **CONFIRMED** (cleanup).

---

## Also noted (not elevated to findings)

- **`Export:backup` has no rejection handler** (`messages.js:287`,
  `makeZip().then(sendResponse)`). If the optional `downloads` permission is not
  granted, `makeZip()` rejects and `sendResponse` is never called, hanging the
  export UI. **Byte-identical to master**, and the sibling `Import:restore` case
  *did* gain a `.catch` in this refactor — the asymmetry is worth a one-line fix
  but is pre-existing.
- **`purgeNeverCaptureHost` changed from two sequential transactions to one
  combined `['thumbnails','tiles']` transaction** (`capture.js:554`). This is a
  deliberate, defensible *improvement* (all-or-nothing purge) rather than a bug —
  but it is a real semantic change from master (a pass-2 abort now rolls back
  pass-1 thumbnail deletions), flagged here for awareness.
- **Near-identical `Thumbnails.getFavicons` / `getFaviconsByHost` cursor walks**
  (`messages.js:183-250`) and the repeated full-store cursor walks in
  `Thumbnails.get` — pre-existing patterns carried verbatim; a shared
  `collectFavicons(store, keyFn, wanted)` helper would remove the drift risk, but
  no behavior bug.
- **`background-main.js` is now in `tsconfig.json`'s `exclude`**, so the entry
  file is no longer `checkJs`-typechecked (justified in-comment: it stops `tsc`
  following the untyped dual-scope imports). Not a CLAUDE.md violation, but it
  does mean the one file wiring every listener together loses static checking —
  worth a periodic manual `tsc` spot-check.
- **Non-hoisted `globalThis.X =` assignments** (`common.js:7`, `prefs.js`): the
  `var → globalThis` conversion drops function/var hoisting, so correctness now
  rests entirely on `<script>`/import load order. Currently safe (bridge files
  load first in both scopes); a future reorder or an early load-time caller would
  hit `undefined`/`ReferenceError`.

## Security boundary check

No boundary moved. `manifest.json` CSP, `permissions`, and `host_permissions`
are byte-identical to master. The `backup.js` restore allow-list (`allowedKeys`,
`safeProtocols = ['http:','https:','ftp:']`, `safeHexColor`, `safeBackgroundUrl`,
`safeHostPattern`) is preserved verbatim and kept deliberately independent of the
shared `SAFE_PROTOCOLS`. The M4 commit carries the required security-boundary
acknowledgement.
