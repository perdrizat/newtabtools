# Code Review — MV3 Migration Branch

**Date:** 2026-07-09
**Scope:** The `mv3-migration` branch diff (`git diff master...HEAD`) — the Manifest V3 flip (2.1.0): persistent background → non-persistent event page, `extension.getViews()` → runtime messaging, callback → promise-based `browser.*`, `browser_action` → `action`, `<all_urls>` → `host_permissions`, CSP object form, Firefox `strict_min_version` 152.
**Reviewer context:** Precision review after the MV3 final gate was closed and the changelog promoted to 2.1.0. Companion to [`2026-07-09-mv3-inventory.md`](2026-07-09-mv3-inventory.md), which records the migration inventory and the security-boundary acknowledgements (CSP/`host_permissions` moves).
**Mode:** 8 parallel finder angles (3 correctness: line-by-line / removed-behavior / cross-file tracer; 4 cleanup: reuse / simplification / efficiency / altitude; 1 conventions), then per-candidate source verification against `webextension/*.js`. Findings dedup'd and ranked.

---

## 1. Verdict

The migration is well-executed and the security boundaries held: the CSP directive is byte-identical (moved to object form), `<all_urls>` moved to `host_permissions` (same grant, now user-revocable) with a `permissions.contains()` guard added, and no restore-allow-list or URL-validation was dropped. The **conventions pass found no CLAUDE.md violations**.

Every real bug in this review traces to one root cause: the flip to a **non-persistent event page** means state and readiness that MV2 guaranteed once-per-session now reset on each ~30s respawn, and a handful of handlers were not updated to cope. The dominant finding (§2.1) was surfaced independently by all three correctness angles.

**Release-relevant:** §2.1 + §2.2 together make the toolbar popup and the first new-tab-after-idle unreliable. The new `event-page-lifecycle` / `event-page-resilience` E2E suites may miss them if they don't force a suspend *before* the very first message reaches the background.

---

## 2. Findings — correctness

### 2.1 Message handlers dereference `db` / `Tiles.ensureReady()` without `waitForDB()` (fix before release)

[`background.js:120`](../webextension/background.js) (`Tiles.isPinned` → `ensureReady` → `getAllTiles`), [`:177`](../webextension/background.js) (`Thumbnails.save`), [`:187`](../webextension/background.js) (`Thumbnails.get`), [`:217`](../webextension/background.js) (`Thumbnails.getFavicons`), [`:242`](../webextension/background.js) (`Thumbnails.getFaviconsByHost`).

The `runtime.onMessage` listener is registered synchronously and fires the instant the event page wakes, but `indexedDB.open()` — kicked off by the top-level `Promise.all([Prefs.init(), waitForDB()])` — is still in flight, so `db` is `undefined`. These handlers touch `db.transaction(...)` (directly or via `ensureReady`) and throw before calling `sendResponse`. The sibling handlers (`Tiles.getAllTiles`, `Tiles.clear`, `Background.getBackground`, `Thumbnails.clear`, `Thumbnails.purgeHost`) correctly wrap in `waitForDB()` — the asymmetry confirms these are oversights, not intent.

**Cleanest repro:** open the toolbar popup after the browser has idled ~30s. `Tiles.isPinned` is the *sole* wake message, `db` is `undefined`, the handler throws, the popup's `await browser.runtime.sendMessage` resolves `undefined` when the channel closes, and the pin/unpin buttons show the wrong state. On a new-tab load after idle, `Thumbnails.get`/`getFavicons` intermittently fail so thumbnails/favicons don't render; `Thumbnails.save` (fire-and-forget) is silently dropped.

**Fix:** route all five through `waitForDB().then(...)` with a `.catch(() => sendResponse(...))`, matching the guarded siblings. *(Verdict: CONFIRMED for the popup case; CONFIRMED-to-PLAUSIBLE for the page cases depending on message ordering.)*

### 2.2 `Tiles.getAllTiles()` sets `this._ready = true` before the transaction that can throw

[`tiles.js:53`](../webextension/tiles.js).

`_ready = true` runs synchronously at line 53, *then* the executor calls `db.transaction('tiles')` (line 56), which throws when `db` is `undefined` (§2.1). Because `_ready` is now stuck `true`, every later `ensureReady()` returns `Promise.resolve(null)` with an empty `_list` and never retries the fetch — so `isPinned` stays wrong even after `db` finishes opening.

**Fix:** set `_ready = true` inside `op.onsuccess`, after the read succeeds. *(Verdict: CONFIRMED — amplifies §2.1 from a one-shot glitch into a sticky wrong state.)*

### 2.3 `pendingCaptures` read-modify-write races across three listeners

[`background.js:768`](../webextension/background.js) (`webNavigation.onCompleted`), [`:782`](../webextension/background.js) (`tabs.onActivated`), [`:796`](../webextension/background.js) (`tabs.onRemoved`).

The MV2 in-memory `Map` (atomic, synchronous mutations) was replaced by `storage.session` get→mutate-whole-object→set, open-coded in three listeners with no serialization. Opening several background tabs at once (e.g. "open all in new tabs" from a bookmark folder, or session restore) lets two `onCompleted` handlers both read the same snapshot; the second `set` clobbers the first tab's entry, so that tab never starts its A/B/C capture on activation.

**Fix:** centralize into a serialized `addPending` / `takePending` / `removePending` helper (a single in-flight write promise) that owns the `pendingCaptures` key — this also resolves the three-way duplication the reuse/altitude angles flagged. *(Verdict: PLAUSIBLE — real mechanism, trigger is timing-dependent on concurrent background-tab navigations.)*

### 2.4 `pickAndStore` writes to `db` after two `await`s, unguarded and uncaught

[`background.js:731`](../webextension/background.js).

The new `onclose`/`onversionchange` handlers ([`background.js:42-48`](../webextension/background.js)) set `db = undefined` when the connection drops. If that happens while `pickAndStore`'s async chain (`isBlank` + `fetchFaviconBlob` + `resizeThumbnail` + `storage.local.get`) is in flight, `db.transaction(...)` at line 731 throws as an **unhandled rejection** and the freshly-captured thumbnail is lost with no retry.

**Fix:** re-guard with `waitForDB()` after the awaits and add a `.catch`. *(Verdict: PLAUSIBLE — requires a concurrent DB version bump / connection close mid-session.)*

---

## 3. Findings — efficiency

### 3.1 Full action-button sweep runs on every event-page respawn

[`background.js:837`](../webextension/background.js).

The top-level `browser.tabs.query({})` + per-tab `action.enable/disable` was a once-per-session cost under MV2; as top-level code it now re-runs on every ~30s respawn (N async calls before the page is useful), largely duplicating what `webNavigation.onCompleted` already does per-navigation. **Cheaper:** drive per-tab action state from `onCompleted` plus a one-time seed in `runtime.onInstalled`/`onStartup`. *(Note: the per-respawn placement is documented as deliberate at [`background.js:831-836`](../webextension/background.js); flagged here as an efficiency cost, not a bug.)*

### 3.2 `onActivated` reads `storage.session` on every tab switch

[`background.js:781`](../webextension/background.js).

`pendingCaptures` is empty in the overwhelmingly common case, so nearly every tab switch (Ctrl+Tab cycling) pays a wasted async read. **Cheaper:** mirror pending tab-ids in an in-memory `Set` (hydrated once per respawn) and touch storage only when non-empty — the same in-memory pattern `captureSessions` already uses.

---

## 4. Findings — cleanup (reuse / simplification)

### 4.1 Duplicated idioms that should be shared helpers

- **Fire-and-forget page broadcast** is inlined at [`background.js:156`](../webextension/background.js) (`sendMessage({name:'Page.updateGrid'}).catch(()=>{})`) while [`export.js:54`](../webextension/export.js) just wrapped the identical idiom as `notifyRestoreComplete()`. Both load into the same background scope. Extract `broadcastToPages(name)` (in `common.js`, which loads first) and have both call it.
- **Protocol allow-list** `['http:','https:','ftp:']` is now inlined a 4th time at [`background.js:841`](../webextension/background.js) (also [`:744`](../webextension/background.js), [`tiles.js:96`](../webextension/tiles.js), named `safeProtocols` in [`export.js:180`](../webextension/export.js)). Extract one shared `safeProtocols` constant so the action-enable rule can't drift from the capture-eligibility rule.
- **`pendingCaptures` get/mutate/set** is open-coded in three listeners (§2.3) — the DRY extraction and the correctness fix are the same helper.

### 4.2 Lower-value simplifications (opportunistic)

- [`background.js:758`](../webextension/background.js) — the `onCompleted` else-branch `await`s a `.then()` chain inside an already-`async` function; flatten to sequential `await`s.
- [`background.js:841`](../webextension/background.js) — `else if`/`else` after a `continue` in the action sweep; the `else` is redundant.
- [`scripts/build-uat.mjs:23`](../scripts/build-uat.mjs) — `optional_host_permissions` branch handles a manifest shape that doesn't exist (only `optional_permissions` is present); the author documents it as defensive-if-it-ever-is.

### 4.3 `pageMessageHandler` silently drops broadcasts during the page-load window

[`newTab.js`](../webextension/newTab.js) (added block, ~line 2138).

The `typeof Updater !== 'undefined'` / `typeof Grid !== 'undefined'` guards paper over load order: a `Page.updateGrid`/`Page.restoreComplete` arriving before `fx-newTab.js` finishes loading is swallowed, leaving the grid stale until a manual reload. Rare (needs a cross-tab pin/restore mid-load) but lossy. **Deeper fix:** register the listener only after the globals exist, or queue early `Page.*` messages and flush on init. *(Verdict: PLAUSIBLE — narrow timing window; framed as altitude, borderline correctness.)*

---

## 5. Dropped after verification

- **`startCaptureSession` async-`await` "orphaned session"** — a candidate claimed a session/timer leak if the tab closes during the awaited `permissions.contains()`. Refuted: the 2s hard-deadline calls `pickAndStore`, which deletes the session, and the network-idle watcher's own 2s timer short-circuits on the deleted session. It self-cleans within 2s — not a leak.
- **`permissions.contains()` vs `typeof captureVisibleTab` "redundant guard"** — the author documents these as intentionally independent defense-in-depth layers ([`background.js:384-389`](../webextension/background.js), [`:530-535`](../webextension/background.js)). Removing either weakens the revoked-permission handling. Not a defect.
- **Conventions** — no CLAUDE.md violation. The CSP is byte-identical (object form), `<all_urls>`→`host_permissions` is the MV3 split of the same grant (guarded, and acknowledged in [`2026-07-09-mv3-inventory.md`](2026-07-09-mv3-inventory.md) / [`docs/amo-submission-notes.md`](../docs/amo-submission-notes.md)), all new functions carry typed JSDoc, no new `.ts` under `webextension/`, no `@ts-ignore`, deps unchanged.

---

## 6. Recommended order

1. **§2.1 + §2.2** — the release-relevant pair. One-to-a-few-line `waitForDB()` wraps + moving `_ready = true`. Add an E2E case that forces an event-page suspend before the first message.
2. **§2.3 / §2.4** — the two PLAUSIBLE respawn races; §2.3's fix (a serialized `pendingCaptures` helper) also lands the §4.1 dedup.
3. **§3 / §4** — efficiency and cleanup, opportunistic. §3.1/§3.2 reduce per-respawn and per-tab-switch overhead but are behavior-adjacent (respawn sweep is documented-deliberate) — batch with §2.3 if touching that area anyway.
