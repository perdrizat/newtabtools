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
| Slice C — async normalization | ~ in progress (agent implementing) | — |
| Slice D — the MV3 flip | pending | — |
| Final gate — full test/UAT/audit/build | pending | — |
| Post-flip retest on ESR 140 | backlog | — |

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

### Slice D — the flip (atomic)
- [ ] `manifest.json`: `manifest_version: 3`; `browser_action` → `action`
      (keep `theme_icons`, drop `browser_style`); CSP string → `{"extension_pages": "..."}`
      (directives unchanged); `<all_urls>` → `host_permissions`;
      `bookmarks`/`downloads`/`history` stay in `optional_permissions` (API perms);
      `background.scripts` unchanged, no `persistent` key.
- [ ] `chrome.browserAction` → `browser.action` (4 sites).
- [ ] `permissions.contains` guard in the capture path.
- [ ] `tests/unit/manifest.test.ts`: CSP-as-object assertions, `manifest_version === 3`,
      host_permissions split (red first).
- [ ] `scripts/build-uat.mjs`: permission-merge logic must handle
      `host_permissions`/`optional_permissions` in MV3.
- [ ] Test harness prefs from the spike → `tests/e2e/run_esr_tests.sh` and
      `tests/uat/_tools/browser-daemon.mjs` (+ preflight if needed).
- [ ] New E2E test: force suspension via `extensions.background.idle.timeout`,
      verify respawn recovery (capture, menus, IDB access).
- [ ] Security-boundary acknowledgement in the commit message: permission-model
      change (install-prompt + revocable host permissions), CSP format change.

### Final gate
- [ ] Full `pnpm test` (fast + E2E), full UAT suite (all scenarios), `pnpm lint`,
      `pnpm typecheck`, `pnpm lint:webext` (web-ext lint against MV3),
      `pnpm audit --audit-level=high`.
- [ ] Version bump (`pnpm version patch` per daily rule — or minor, maintainer's call),
      CHANGELOG promotion, `pnpm build` artifact in `dist/`.
- [ ] Docs sweep: CONTRIBUTING.md architecture section (MV2→MV3), TESTING.md,
      README, docs/amo-listing.md reviewer notes.

## Post-MV3 backlog (explicitly deferred)

- **Retest the finished MV3 build against Firefox 140/ESR.** The Fx-152 capture gate
  was established with a minimal probe during the spike (2026-07-09). Once the real
  migrated extension exists, re-run it (probe + E2E capture tests) on ESR 140 to
  confirm the gate is a genuine upstream version restriction and not a temporary
  issue or a side effect of our own probe/migration choices. If capture turns out to
  work on 140, lower `strict_min_version` accordingly.
- XHTML→HTML conversion (dedicated high-risk task; full UAT review).
- ES-module extraction of the background as a clean rewrite behind the frozen
  message contract, with `lib/platform.js` capability layer — designed against
  service-worker constraints as Chrome preparation.
- Chrome/stage 3 (ROADMAP unchanged): offscreen/`OffscreenCanvas` for the capture
  pipeline, polyfill, dual-manifest build, CWS review posture for `<all_urls>`.

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
