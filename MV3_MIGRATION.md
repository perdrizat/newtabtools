# MV3 Migration — Live Working Plan

**Status: IN PROGRESS** on branch `mv3-migration` (started 2026-07-09, single-sitting agentic migration).
This document is the living checklist for the migration and the durable state across
context windows. Update it as each slice lands. It supersedes the previous version of
this file; the corrected directives below are decisions of record.

## Status board (live)

| Step | Status | Commit |
|---|---|---|
| Phase 0 — spike + bisect | ✓ done | `653042a`, `dd02699` |
| Decisions: min_version 152.0, E2E on release FF | ✓ approved by maintainer | — |
| Slice A — getViews → messaging | ✓ done (fast 1139, E2E 124) | `12b410c` |
| Slice B — event-page resilience | ✓ done (fast 1152, E2E 124) | `6bb6017` |
| Slice C — async normalization | ✓ done (fast 1153, E2E 124) | `03ffabc` |
| Slice D — the MV3 flip | ✓ done (fast 1162, E2E 126 on FF152/MV3) | `a0eb4fa` |
| UAT-found respawn-reload bug | ✓ fixed (fast 1166, E2E 126, UAT 22+23 re-run clean) | `dbd72dc` |
| Final gate — full test/UAT/audit/build | ✓ done — all gates green, v2.1.0 | see tag `v2.1.0` |
| Post-flip retest on ESR 140 | backlog (once next ESR ships / on demand) | — |

| Pre-release fixes (mv3-code-review §2.1/§2.2 + queue) | ✓ done (fast 1190, E2E 126; §4/§5 cleanups → MODERNIZATION arc) | `1904fbe` |
| Next-arc plan (Modules vs HTML5 sequencing) | ✓ done — **modules first**; plan in [`MODERNIZATION.md`](MODERNIZATION.md) | — |

**Migration complete 2026-07-09.** Released as v2.1.0 (Firefox ≥152, MV3); tag
`v2.1.0` moved to include the pre-release fixes (`1904fbe`). Release is CLEAR to
push/submit. Remaining review cleanups (§4.1 helpers, §4.3 broadcast queue, §3.1
action sweep) execute inside the MODERNIZATION arc.

## Strategic decisions (updated 2026-07-09)

1. **Firefox-only MV3.** Chrome stays deferred (ROADMAP stage 3). Firefox MV3 uses
   **event pages** — full DOM/`window`/canvas/IndexedDB access, no service worker, no
   offscreen documents.
2. **CORRECTED: ES modules are NOT required for Firefox MV3.** The classic
   `background.scripts` array remains valid in MV3 (MDN documents
   `"background": {"scripts": [...]}` as the MV3 form). The previous claim here that
   "MV3 strictly requires ES modules" was wrong. ES-module extraction is **out of scope**
   for this migration — it lands post-MV3, file-by-file, converting each file's tests
   from `vm` script-loading to native `import` as it goes.
3. **XHTML→HTML conversion is out of scope.** MV3 is happy overriding newtab with an
   `.xhtml` page. The conversion (self-closing `<span/>`s in the tile template,
   `nodeName` case traps, ~40 test/tooling references) is a separate post-MV3 task.
4. **No TypeScript / no build step** (unchanged).
5. **Release shape:** the first AMO submission will be MV3 directly — no MV2→MV3
   update-path concern (no existing AMO users).
6. **Full rewrite considered and rejected (2026-07-09).** A clean-slate rewrite
   (incl. Chrome-first) would discard the behavior-encoding test suite (~1130 fast
   tests are architecture-coupled) and the edge-case knowledge in the capture
   pipeline, for benefits reachable incrementally. Decision: migrate; later rewrite
   only the background as ES modules with a platform layer (post-MV3, pre-Chrome).

## Technical directives (corrected)

### State in the event page
- `captureSessions`, `networkIdleWatchers`: **keep in-memory** (unchanged directive).
  They live ~2s inside an active capture; async storage would add races for no benefit.
  Worst case a capture in flight at suspension is lost; next visit recaptures.
- **CORRECTED: `pendingCaptures` must move to `browser.storage.session`.** The old
  "completes within the 2-second deadline" rationale does not apply to it — it waits
  for tab *activation* (unbounded; minutes/hours), so it will not survive event-page
  suspension in-memory. It is serializable (`tabId → {url, windowId}`) and its
  consumer (`tabs.onActivated`) tolerates async lookup. `storage.session` is available
  in Firefox ≥115 in MV2, so this ships pre-flip.

### DOM independence
Unchanged: do NOT migrate `resizeThumbnail`/`isBlank` to `OffscreenCanvas`. Firefox
event pages keep `Image` and `<canvas>`.

### Replacing `chrome.extension.getViews()` (removed in MV3)
Two call sites, both background→page:
- `background.js` (`Tiles.pinTile` handler): calls `view.Updater.updateGrid()`.
- `export.js` (`readZip`): calls `view.newTabTools.refreshBackgroundImage()`,
  `view.Grid.refresh()`, `view.newTabTools.getThumbnails()`.
Replacement: `browser.runtime.sendMessage({name: 'Page.updateGrid' | 'Page.restoreComplete'})`
broadcast + a **new page-side `runtime.onMessage` listener** in `newTab.js` (there is
none today). Broadcast is fire-and-forget from the background's perspective; when no
newtab page is open the sendMessage promise rejects with "Receiving end does not
exist" — swallow it. Each open page refreshes itself; the restore initiator's own
refresh happens in its message-response path as today.

### Event-page respawn hygiene
- Top-level side effects re-run on every respawn. `browser.menus.create` must be
  duplicate-tolerant (register in `runtime.onInstalled`, or pass ids + swallow the
  duplicate error via the create callback checking `runtime.lastError`).
- The one-shot idle-cleanup listener re-arms per respawn: guard `cleanupThumbnails`
  with a storage-backed last-run date so it runs at most daily.
- All listeners must be registered synchronously at top level (they nearly all are —
  verify during Slice B; the page-side `menus.onClicked` in `newTab.js` is fine
  because tile menus only exist while a newtab page is open).

### IndexedDB
The `db` global has no reconnect: `db = 'broken'` is permanent for the context, and
there are no `onclose`/`onversionchange` handlers. Event pages are torn down and
respawned routinely, so: add `onclose`/`onversionchange` handlers that clear `db`,
and make `waitForDB()` re-run `initDB()` when `db` is unset/broken instead of
rejecting forever.

### Capture pipeline & permissions
- MV3 moves `<all_urls>` from `permissions` to `host_permissions`. **No permission is
  widened.** Since Firefox 127 host permissions are shown in the install prompt and
  granted at install (we require ≥140). Users can revoke at runtime, so the capture
  path gains a `browser.permissions.contains({origins: ['<all_urls>']})` guard for
  graceful degradation (skip capture, no throw).
- `captureVisibleTab` requires the `<all_urls>` host permission (activeTab cannot
  substitute — capture fires on navigation, not user gesture).
- webRequest stays observational-only (no `webRequestBlocking`); fine in Firefox MV3.

## Spike findings (Phase 0) — answered 2026-07-09

Probe: minimal MV3 extension (`host_permissions: ["<all_urls>"]`, `permissions:
["tabs","webRequest","webNavigation","menus","storage"]`, classic scripts array,
CSP object) + HTTP beacon server. Runs: web-ext on firefox-esr 140.12, selenium/
geckodriver on both firefox-esr 140.12 and release 152.0.5, all headless.

- [x] **Q1 — temporary installs auto-grant host permissions.** On both harness paths
      (web-ext and geckodriver `installAddon(…, true)`), `permissions.getAll()`
      reported `origins: ["<all_urls>"]` with **zero extra prefs**.
      `extensions.originControls.grantByDefault` and `granted_host_permissions` are
      no-ops for temporary installs. E2E/UAT need no permission plumbing.
- [x] **Q2 — CRITICAL: `tabs.captureVisibleTab` does not exist under MV3 on
      Firefox ESR 140, even with `<all_urls>` granted.** `typeof` is `undefined`;
      the call throws synchronously. Adding `activeTab` exposes it only until the
      first event-page respawn, then it vanishes again (gesture-tied, unusable for
      background capture). **On release Firefox 152.0.5 it works** (real ~28KB JPEG
      captured, same probe, same permissions, no prefs). This is a Firefox-version
      gate, not a permission gate. **Bisect result (official binaries 146/149/150/
      151/152): the boundary is exactly Firefox 152.0** — `captureVisibleTab` and
      `captureTab` are both `undefined` through 151.0 and working functions from
      152.0 (end-to-end capture confirmed on 152.0; 151.0 throws).
      Consequences: (a) `strict_min_version` becomes **"152.0"**;
      (b) the E2E tier cannot run on ESR 140 post-flip — Mozilla APT currently has
      no newer ESR, so E2E moves to a release-channel binary (runner + CI);
      (c) UAT (release Firefox) already works.
- [x] **Q3 — webRequest events keep arriving and wake the event page.** Observed
      continuously across suspension cycles. Network-idle detection survives MV3.
- [x] **Q4 — respawn behavior confirmed.** With `extensions.background.idle.timeout=5000`
      the event page tore down and respawned on essentially every 10s-spaced event
      (~23 `bg-loaded` in 4 min). Every respawn: `menus.create` fails with
      "The menu id X already exists" (Slice B fix confirmed necessary). Top-level
      listeners re-fired reliably after every respawn.
- [x] **Q5 — manifest translation accepted cleanly.** `background.scripts` array with
      no `persistent` key + CSP object: zero manifest warnings from Firefox
      (`web-ext run --verbose`: "Validating manifest… Installed … as a temporary
      add-on"). Permission split confirmed: only `<all_urls>` moves to
      `host_permissions`; API permissions and `optional_permissions` stay put.

Harness invocations that worked (bake into Slice D):
- E2E: `web-ext run --source-dir … --firefox <binary> --start-url <url> --arg=-headless --no-reload [--pref=extensions.background.idle.timeout=5000]`
- UAT: geckodriver 0.37 (non-snap) + selenium `installAddon(zip, true)`, headless — unchanged.
- Suspension testing pref: `extensions.background.idle.timeout` (ms).

## Execution checklist (one sitting, commit per green slice)

Gates per slice: red/green fast tests, `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e`.
UAT: full suite after Slice D.

### Slice A — kill `extension.getViews()` (MV2-safe) — ✓ DONE
- [x] Page-side `runtime.onMessage` listener in `newTab.js` (`pageMessageHandler`):
      `Page.updateGrid` → `Updater.updateGrid()`; `Page.restoreComplete` →
      `refreshBackgroundImage()` + `Grid.refresh()` + `getThumbnails()`. Always
      returns false (never claims sendResponse routing); typeof-guards the
      fx-newTab.js globals.
- [x] `background.js` `Tiles.pinTile`: broadcast `Page.updateGrid`, rejection swallowed.
- [x] `export.js` `readZip`: `notifyRestoreComplete()` broadcast at both exit
      points; `Background.setBackground` now awaited first. Note: the prefs-only
      restore path now also triggers a page refresh (previously it didn't — accepted
      improvement).
- [x] Both hardcoded `/newTab.xhtml` pathname checks removed; `grep chrome.extension`
      in webextension/ is empty.
- [x] Tests: new `page-messages.test.ts` (7); pinTile + restore broadcast coverage
      reworked in `background-messages.test.ts` / `backup-restore.test.ts`; deleted
      source-grep `backup-restore-refresh.test.ts` (regression now behavioral).
- [x] Gates: fast 1139 ✓, lint ✓, typecheck ✓, E2E 124 ✓.

### Slice B — event-page resilience (MV2-safe) — ✓ DONE
- [x] `menus.create` ×5 via `createMenuTolerant()` — duplicate error on respawn is
      read from `runtime.lastError` and swallowed; creation stays top-level
      (chosen over `onInstalled`: survives respawn AND browser restart).
- [x] IDB: `onclose`/`onversionchange` clear the `db` global; `waitForDB()` memoizes
      one in-flight `initDB()` (`dbInitPromise`), cleared on settle → later calls
      retry. Terminal `'broken'` sentinel + hand-rolled waitingQueue removed;
      failing open still rejects current callers (database-error UI preserved).
- [x] `pendingCaptures` → `storage.session` key (object by tabId); enqueue/consume/
      cleanup are async RMW. Known benign race: two near-simultaneous background-tab
      navigations can drop one deferred capture (self-heals on next visit).
- [x] Idle-cleanup guarded by `thumbnailCleanupLastRun` date in `storage.local`
      (at most daily, was once per respawn).
- [x] Listener audit: one violation found+fixed — `prefs.js` `storage.onChanged`
      registration hoisted out of the async `storage.local.get` callback. Reviewed:
      legacy-key removal event now reaches `prefsChanged`, harmless (`parsePrefs`
      ignores unknown keys; fires once, only on v1-upgraded profiles).
- [x] Gates: fast 1152 ✓ (+13, new `event-page-resilience.test.ts`), lint ✓,
      typecheck ✓, E2E 124 ✓.

### Slice C — async normalization (MV2-safe) — ✓ DONE
- [x] All callback-style `chrome.*` sites in prefs/tiles/export/action/background
      converted to promise `browser.*` + async/await; fire-and-forget writes carry
      `.catch(console.error)`.
- [x] `captureTab()` rewritten async, branch-for-branch (tab-gone, inactive,
      capture-throw); 4 callers keep session-identity checks; unused `label`
      param dropped. Characterization test added for cross-URL session invalidation.
- [x] `chrome.browserAction.*` deliberately left for Slice D's rename.
- [x] 11 integration test files: callback mocks → promise mocks; no assertions
      weakened.
- [x] Gates: fast 1153 ✓, lint ✓, typecheck ✓, E2E 124 ✓.

### Slice D — the flip (atomic) — ✓ DONE
- [x] `manifest.json` flipped: MV3, `action` (no `browser_style`), CSP object
      (directives byte-identical), `<all_urls>` → `host_permissions`,
      `strict_min_version` 152.0, `background.scripts` unchanged.
- [x] `browser.action.enable/disable` (4 sites, with rejection handling).
- [x] Capture degradation double-guard: `permissions.contains` in
      `startCaptureSession` (no session when revoked) + API-existence check in
      `captureTab` (Firefox hides the method without the grant).
- [x] `manifest.test.ts` updated red-first (17 red → 45/45 green).
- [x] `build-uat.mjs` handles MV3 permission split; UAT preflight now fails fast
      on Firefox < 152.
- [x] E2E harness on release Firefox (default `firefox`, `$FIREFOX_ESR_BIN` still
      honored; CI installs release `firefox`); suite-wide
      `extensions.background.idle.timeout=10000` so the event page really
      suspends between tests; cleanup pkill scoped to the test profile.
- [x] New `tests/e2e/event-page-lifecycle.test.ts`: post-suspension IDB
      reconnect (message round-trip) + full capture pipeline through a
      respawned event page. (One orchestrator fix during review: poll from the
      extension page, not the navigated content page.)
- [x] Gates: fast 1162 ✓, lint ✓, typecheck ✓, lint:webext 0 findings ✓,
      E2E 126 ✓ on Firefox 152 (MV3, with real suspensions).
- [x] Security-boundary acknowledgement in the commit message.

### Final gate — ✓ DONE
- [x] fast 1166 ✓ · E2E 126 ✓ (FF152/MV3, real suspensions) · lint ✓ · typecheck ✓ ·
      lint:webext 0 findings ✓ · audit clean ✓.
- [x] Full UAT suite run 20260709-110359: 10/11 → found the respawn-reload bug
      (below), fixed (`dbd72dc`), scenarios 22+23 re-run clean (run
      20260709-1224xx, 2/2, no reload observations).

**UAT run 20260709-110359 (full suite, 10/11):**
- [x] **REAL BUG — FIXED (`dbd72dc`): respawn-triggered page reloads.** The top-level
      `tabs.query` sweep's `tabs.reload(NEW_TAB_URL)` branch re-runs on every
      event-page respawn → open new-tab pages reload every ~30-60s, killing the
      drawer (scenario 22 observed 4×) and edit mode (scenario 23 FAILED on
      "edit mode persists"). MV2 ran this once per session for post-update refresh.
      Fix: reload moves to `runtime.onInstalled`; enable/disable sweep stays
      top-level. Slice B's audit had mis-judged this sweep "idempotent" — the
      deterministic tiers all missed it (E2E navigates per test and never holds
      transient UI state across a suspension); UAT's visual judgment caught it.
- Cosmetic, → backlog (not this migration): never-capture host input placeholder
      clips at the input edge ("…or .example.c"); action-row chips can blend
      white-on-white against mostly-white thumbnails (scenario 23 observation);
      scenario-11 text still describes the old "dark scrim" action row.
- Environmental, no action: Cloudflare-interstitial thumbnails from seeding
      (phoronix), harness focus-stealing / stale screenshot frames, about:newtab
      prologue omission (known harness behavior).
- [x] Version bump: **minor → 2.1.0** (MV3 + min-version raise is feature-class
      within the 2.x line), CHANGELOG promoted to `## [2.1.0] — 2026-07-09`,
      `pnpm build` artifact in `dist/`.
- [x] Docs sweep (`7012019`): CONTRIBUTING/CLAUDE/AGENTS, TESTING.md,
      tests/e2e/README.md, README.md, ROADMAP.md (3 new decisions of record),
      docs/amo-submission-notes.md (MV3 + host-permission revocability for
      reviewers). PRIVACY.md needed no change.

## Pre-release fixes (from audit/2026-07-09-mv3-code-review.md — REQUIRED before push/AMO)

Adjudicated 2026-07-09 (verified against source; orchestrator review widened §2.1).
Code changes deferred until the maintainer's review round closes; then fix in this
order, TDD, E2E-gated:

1. **§2.1+§2.2 CONFIRMED (widened): unguarded `db` access on event-page wake.**
   Unguarded message handlers: `Tiles.isPinned` (:120), `Tiles.getTile`/`putTile`/
   `removeTile` (:135-141 — missed by the report), `Thumbnails.save` (:173),
   `Thumbnails.get` (:185), `getFavicons` (:211), `getFaviconsByHost` (:235); plus
   the `webNavigation.onCompleted` capture path's `Tiles.ensureReady()` (also
   missed — worst case: sticky-disables auto-capture for a whole respawn).
   Amplifier: `tiles.js:53` sets `_ready = true` before the throwing transaction →
   sticky empty state. Fix: `waitForDB()` wrap on every handler that reaches `db`
   (match the guarded siblings) + move `_ready = true` into `op.onsuccess`.
   Regression test: integration-tier with an on-command-resolving `indexedDB.open`
   mock, dispatching each message BEFORE the open resolves (E2E can't reach the
   popup and passes this race by timing luck).
2. **§2.4 PLAUSIBLE-accepted:** `pickAndStore` re-guards `db` via `waitForDB()`
   after its awaits + `.catch` (connection can drop mid-chain via `onclose`).
3. **§2.3 accepted (was documented-benign at Slice B):** serialize
   `pendingCaptures` mutations behind a single helper (`addPending`/`takePending`/
   `removePending`, one in-flight write promise) — same change lands the §4.1
   dedup of the three open-coded RMW blocks.
4. **§4.1 partial:** extract `broadcastToPages(name)` into `common.js` (dedups
   `background.js` pinTile + `export.js` notifyRestoreComplete). Unify the
   `['http:','https:','ftp:']` constant across background/tiles/action-sweep —
   but **keep `export.js`'s `safeProtocols` copy independent**: the restore
   allow-list is a declared security boundary (CONTRIBUTING) and must not be
   silently widened by a capture-eligibility change. §4.3 accepted low: queue
   early `Page.*` broadcasts in `pageMessageHandler` and flush once fx-newTab.js
   globals exist.
5. **§3.1 accepted-opportunistic:** action sweep → `onInstalled`/`onStartup` seed
   + `onCompleted` maintenance (per-tab action state persists outside the event
   page). Batch with item 3 if touching that area.
6. **§3.2 DECLINED (decision of record):** in-memory mirror of `pendingCaptures`
   for `onActivated` — self-defeating (`onActivated` is the wake event, so the
   mirror is never hydrated when it matters; awaiting hydration IS the storage
   read; not awaiting reintroduces the exact lost-state bug the storage move
   fixed). The avoided read is a sub-ms in-memory parent-process lookup.

Also fold in here when executing: the object-URL revocation fix from the first
review round (queued below).

## Post-MV3 backlog (explicitly deferred)

Items marked *(review 2026-07-09)* were raised or endorsed by the external code
review of the migration; disposition per maintainer decision 2026-07-09.

- **Fix: unrevoked object URL in `export.js`** *(review 2026-07-09 §1a — accepted;
  queued behind the in-flight review round, no code changes until it closes).*
  `makeZip`'s `URL.createObjectURL(blob)` is never revoked — pre-existing leak, one
  blob per backup export until the event page suspends. Fix shape: revoke from a
  `downloads.onChanged` listener when that download id reaches a terminal state
  (`complete`/`interrupted`); TDD as usual.
- **Retest the finished MV3 build against Firefox 140/ESR.** The Fx-152 capture gate
  was established with a minimal probe during the spike (2026-07-09). Once the real
  migrated extension exists, re-run it (probe + E2E capture tests) on ESR 140 to
  confirm the gate is a genuine upstream version restriction and not a temporary
  issue or a side effect of our own probe/migration choices. If capture turns out to
  work on 140, lower `strict_min_version` accordingly.
- XHTML→HTML conversion (dedicated high-risk task; full UAT review). *(review
  2026-07-09 §3b concurs; hazards inventoried in audit/2026-07-09-mv3-inventory.md
  §2. Slots as the natural first step of the ES-module arc / Chrome prep — not
  ahead of the AMO submission.)*
- ES-module extraction of the background as a clean rewrite behind the frozen
  message contract, with `lib/platform.js` capability layer — designed against
  service-worker constraints as Chrome preparation. *(review 2026-07-09 §3a
  concurs; deliberately excluded from the flip so MV3-semantics regressions and
  refactor regressions could never be confounded.)*
- Chrome/stage 3 (ROADMAP unchanged): offscreen/`OffscreenCanvas` +
  `createImageBitmap` for the capture pipeline's canvas/`Image` usage *(review
  2026-07-09 §2a — agreed as Chrome-prep, rejected as a Firefox-only change:
  Firefox event pages keep DOM by design and the pipeline is freshly verified)*,
  polyfill, dual-manifest build, CWS review posture for `<all_urls>`.

### Considered and rejected (decisions of record)

- **`idb` library to replace the hand-rolled IndexedDB wrapper** *(review
  2026-07-09 §3c — declined 2026-07-09).* (1) The extension ships zero third-party
  runtime deps by supply-chain policy (sole exception: vendored, reproducibility-
  documented `zip.js`); vendoring `idb` adds reviewed attack/review surface to
  replace ~60 well-tested wrapper lines — and the reconnect semantics added in
  Slice B would still have to be hand-written on top. (2) `idb` is an ES module;
  the script-mode background cannot import it until the module extraction lands,
  so the suggestion is blocked on that arc regardless. Revisit at module-extraction
  time (alternative: promisify the raw cursor walks ourselves, no dependency).
- **Persisting `captureSessions`/`networkIdleWatchers`** — remains rejected; see
  the "State in the event page" directive above (≤2s lifetime, event-anchored to
  a fresh idle clock, self-healing on loss; measured in the spike).

## Reference: inventory anchors (2026-07-09 survey)

Background scope: `getViews` at `background.js:143`, `export.js:46`; IDB open/state
`background.js:35-91`; capture state maps `background.js:303,488,489`; menus create
`background.js:744-766`; webRequest listeners `background.js:341-343`; webNavigation
`background.js:683`; onMessage dispatch `background.js:97-297` (19 message names);
callback sites listed in Slice C. Page scope: no `onMessage` listener today; messaging
client sites in `tiles-shim.js`, `action.js`, `newTab.js`, `fx-newTab.js`.
Manifest-asserting tests: `tests/unit/manifest.test.ts` (CSP shape, permissions,
background.scripts), `tests/integration/sync-version.test.ts`.
`build-uat.mjs:16-21` merges optional permissions (MV2 model).
