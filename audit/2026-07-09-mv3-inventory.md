# MV3 Migration — Codebase Inventory (2026-07-09)

Detailed survey backing the plan in `MV3_MIGRATION.md`. Three scopes: background,
front end, test infrastructure. Line numbers are as of commit `99b0952` (branch
point of `mv3-migration`) and will drift as slices land — treat as anchors, not
gospel.

---

## 1. Background scope

Files (manifest `background.scripts` order): `common.js`, `tiles.js`, `prefs.js`,
`background.js`, `lib/zip.js`, `export.js`. Popup: `action.js`. `common.js` and
`prefs.js` are loaded in BOTH background and page scopes.

### 1.1 chrome.* callback-style call sites (Slice C conversion list)

- storage: `prefs.js:73` get(cb); `prefs.js:215,305` set(…, resolve); `prefs.js:37,68`,
  `prefs.js:241` fire-and-forget set/remove; `background.js:656` get(cb);
  `export.js:19` get(resolve). (`export.js:142` already awaits set — style precedent.)
- tabs: `background.js:372` get(cb) (+ `runtime.lastError` read at `:373`),
  `background.js:380` captureVisibleTab(cb), `background.js:701` get(cb),
  `background.js:732` query(cb) (top-level startup), `action.js:11` query(cb).
- misc: `tiles.js:87` topSites.get(cb); `background.js:19` management.getSelf(cb);
  `export.js:37` downloads.download(…, resolve); `action.js:22,30,36` sendMessage(cb).
- Already promise-style `browser.*`: `tiles.js:80` getBrowserInfo; `browser.menus.*`
  at `background.js:744-775`.
- `chrome.browserAction.disable/enable`: `background.js:689,693,737,739` (→
  `browser.action` in Slice D).
- `captureTab()` (`background.js:371-388`) nests two callbacks and threads through
  the capture state machine — the one conversion with real refactor weight.

### 1.2 getViews (removed in MV3) — Slice A targets

- `background.js:143-147` (`Tiles.pinTile` handler): iterates views, filters
  `pathname == '/newTab.xhtml'`, calls `view.Updater.updateGrid()`.
- `export.js:46` (`readZip`): filters views, then `export.js:83`
  `await v.newTabTools.refreshBackgroundImage()`, `:200` `await v.Grid.refresh()`,
  `:204` `v.newTabTools.getThumbnails()`.
- No `runtime.getBackgroundPage()` anywhere. Page scope has NO `onMessage` listener
  today — Slice A adds the first one.

### 1.3 DOM usage in background (fine for FF event pages; Chrome blockers, for the record)

`background.js:351,450` `new Image()`; `:354,453` `createElement('canvas')`;
`:357-359` drawImage/toBlob; `:458` getImageData; `:408` atob; `:416` new Blob;
`export.js:38` `URL.createObjectURL` (never revoked — known leak);
`lib/zip.js` uses setTimeout/atob/FileReader internally (`zip.configure({useWebWorkers:false})`
at `export.js:8`). `prefs.js:192-205` touches page globals guarded by
`if ('newTabTools' in window)`.

### 1.4 Timers (all setTimeout, background.js)

`:311` armNetworkIdle 2000ms; `:333` resetNetworkIdleTimer re-arm 2000ms;
`:541` capture B 500ms; `:561` capture C hard deadline 2000ms. None >30s; risk is
the state they gate, not the durations.

### 1.5 In-memory state (event-page teardown analysis)

- `db` (`background.js:35`) — IDB handle or the string `'broken'`;
  `initDB.waitingQueue` (`:88`). No reconnect; no `onclose`/`onversionchange`.
- `networkIdleWatchers` (`:303`), `captureSessions` (`:488`) — in-capture state,
  ~2s lifetime, stays in-memory (directive).
- `pendingCaptures` (`:489`) — unbounded lifetime, consumed by `onActivated`
  (`:718-724`) → moves to `storage.session` (Slice B).
- `Prefs`/`Blocked._list`/`Filters._list`/`NeverCapture._list` (prefs.js),
  `Tiles._ready/_cache/_list` (tiles.js:9-11) — rebuilt by the startup IIFE
  (`background.js:7-33` `Promise.all([Prefs.init(), initDB()])`), self-healing.
  Note: `NeverCapture.matches` reads at `background.js:167,509` with no
  re-hydration guard — a just-respawned page could race `Prefs.init` (millisecond
  class, accepted, same as MV2 startup).

### 1.6 IndexedDB

`initDB()` `background.js:38-75`: `indexedDB.open('newTabTools', 9)`; stores
`tiles` (keyPath id, autoIncrement, index url), `background` (autoIncrement),
`thumbnails` (keyPath url, index used). `waitForDB()` `:77-91`. Failure path
`:24-33` sets `db='broken'` permanently. Raw `db.transaction` usage inside message
handlers: `:168,178,208,233,254,275` + `cleanupThumbnails` `:780-789`,
`pickAndStore` `:673`, `purgeNeverCaptureHost` `:820-852`. `tiles.js` reads the
`db` global at `:47,56,143,153,165,172,182,199,209` (declared in a file that loads
*later* — deferred access only).

### 1.7 webRequest / webNavigation

webRequest (observational, no blocking): `background.js:341-343`
onBeforeRequest/onCompleted/onErrorOccurred → `resetNetworkIdleTimer` (`:328-339`),
all `{urls:['<all_urls>']}`. webNavigation.onCompleted `background.js:683-716`:
top-frame only, toggles browserAction by scheme, starts/defers capture sessions,
skips incognito (`:702`) and never-capture (`:698`).

### 1.8 Message surface (the frozen contract)

Single onMessage dispatcher `background.js:97-297`, sender-validated (`:100-104`).
Names: Tiles.isPinned/getAllTiles/getTile/putTile/removeTile/clear/pinTile;
Background.getBackground/setBackground; Thumbnails.save/get/capture/getFavicons/
getFaviconsByHost/delete/purgeHost/clear; Export:backup; Import:restore.
`Thumbnails.save` and `Thumbnails.delete` have no production senders — they are
test seams (E2E seeds thumbnails via `Thumbnails.save`), keep them.
Client sites: `action.js:22,30,36`; `tiles-shim.js:14,27,35,48,56,61`;
`newTab.js:251,369,379,389,1380,1431,1434,1437,2064,2117`; `fx-newTab.js:1199`.
Payload caveat: `Thumbnails.get` returns a `Map`; `Import:restore` and
`Background.setBackground` send `File`/`Blob` — structured-clone over
`runtime.sendMessage`, works in Firefox (both MV2 and MV3 event pages).

### 1.9 Cross-file globals (module-extraction map, post-MV3)

`common.js`→`compareVersions` (used tiles.js:82, newTab.js). `prefs.js`→`Prefs`,
`Blocked`, `Filters`, `NeverCapture` (used background.js, tiles.js, export.js,
page scripts). `tiles.js`→`Tiles`, `Background` (used background.js, export.js).
`background.js`→`db` (used tiles.js), `purgeNeverCaptureHost` (used
export.js:150,189). `export.js`→`makeZip`, `readZip` (used background.js:282,287).
`lib/zip.js`→`zip` global (used export.js).

### 1.10 alarms / idle / storage.session

No `alarms`, no `storage.session` usage today. `chrome.idle.onStateChanged`
one-shot listener `background.js:856-863` (self-removing; re-arms per respawn →
Slice B last-run-date guard).

---

## 2. Front-end scope

### 2.1 newTab.xhtml (467 lines) XML specifics — post-MV3 HTML-conversion hazards

- `xmlns` on `<html>` (line 6, plus state attrs `options-hidden`/`drawer-tab`);
  SVG namespace at `:440`. No DOCTYPE, no XML PI, no CDATA, no `<meta charset>`
  (HTML conversion must add one; `action.html:9` has it).
- **Self-closing non-void tags that mis-nest under HTML parsing**: tile template
  (`:423-439`) spans at `:426,428,429,430,431,432,433,435,436`; self-closed
  `<button>` at `:327`. These silently swallow siblings if parsed as HTML.
- `tagName`/`nodeName` case: XHTML is lowercase; `newTab.js:2320`
  `while (target.nodeName != 'li')` breaks under HTML. `newTab.js:1636` sidesteps
  (documented); `awesomebar.js:169` normalizes.
- Script tags (`:443` common.js early; `:459-465` icons, stats, tiles-shim, prefs,
  awesomebar, newTab, fx-newTab) — all classic, no inline scripts.

### 2.2 createElementNS (collapse to createElement after HTML conversion)

`icons.js:11` (SVG — must STAY namespaced). HTML-namespace calls:
`awesomebar.js:123,271,291,298,306,308,313`; `newTab.js:533,1319,1326,1348,1350,
1354,1362`; `fx-newTab.js:428,492,493,501,508,1013,1036,1083,1087,1134,1144,1419`.
Constants: `newTab.js:7`, `fx-newTab.js:37` (duplicate `var HTML_NAMESPACE`),
`awesomebar.js:17`.

### 2.3 Page↔background

All via `chrome.runtime.sendMessage` callbacks (clean). `tiles-shim.js` is the
page-side proxy for `Tiles`/`Background` with a local `_list` pin cache
(`isPinned` reads it synchronously).

### 2.4 Firefox-only APIs in page scope (Chrome capability layer, stage 3)

`browser.menus.getTargetElement` (`newTab.js:479,491`), `menus.update/refresh`
(`:483-487`), `menus.onShown/onClicked` (`:2263-2264`); `browser.theme.getCurrent`
(`:870`), `onUpdated` (`:973-975`); `browser.search.search` (`awesomebar.js:349`);
`chrome.sessions.*` (`newTab.js:1250,1265,2042`); `chrome.topSites.get` with
Firefox options (`newTab.js:1969`).

### 2.5 Hardcoded `newTab.xhtml` (rename inventory, post-MV3)

Production: `manifest.json:20`; `background.js:36,144`; `export.js:46` (the latter
two go away in Slice A). Tooling: `scripts/amo-screenshots.mjs:40`,
`scripts/i18n-stale.mjs:31`, `scripts/i18n-purge.mjs:44`,
`tests/uat/_tools/{browser-daemon.mjs:63,509, fallback-cli.mjs:35,
daemon-smoke.mjs:26, browser-smoke.mjs:25}`, `tests/uat/uat-scenario.md:30,39,58`,
`tests/e2e/_helpers.ts:118`. Plus ~16 integration source-grep tests, `tests/unit/
i18n.test.ts:7`, `localization.test.ts:65`, and namespace-hardcoding tests
(`objecturl-revoke.test.ts:213`, `awesomebar-dom.test.ts:37`,
`drag-reorder.test.ts:84-89`, `recent-tabs.test.ts:65`, `auto-thumbnail.test.ts:831`,
`drawer-layout.test.ts:283-289`).

---

## 3. Test infrastructure

### 3.1 Fast tier loads production JS as script-mode vm (module-extraction blocker)

`tests/integration/_helpers.ts:41-42` (`loadModule` → `vm.runInContext`),
`:79,121` (`mountSite` → `vm.runInThisContext`; also regex-strips
`UndoDialog.init();` and `newTabTools.startup();` at `:119-120`). ~49 integration
files use the pattern; globals leak onto `globalThis` to simulate the shared MV2
scope (`tests/integration/globals.d.ts` documents it).
`favicon-data-url.test.ts:34-72` string-extracts individual functions from
background.js. Any production file gaining `import`/`export` breaks its loaders —
convert tests to native `import` per file when modules land (post-MV3).

### 3.2 jsdom / XHTML

vitest fast project = jsdom with DEFAULT HTML parsing (no `contentType` override
anywhere, despite TESTING.md:151's guidance). Tests needing XML semantics
hardcode the namespace or read the file as a string instead.

### 3.3 E2E tier

`tests/e2e/run_esr_tests.sh:38` binary `firefox-esr` (`$FIREFOX_ESR_BIN`
override), validated `:44-50`; `web-ext run` unpacked `webextension/` with
`--remote-debugging-port 9222 -headless` (`:55-60`); Puppeteer webDriverBiDi
connect (`_helpers.ts:13,43-45`); UUID scraped from profile `prefs.js`
(`_helpers.ts:77-111`, documented brittle); `page.waitForFunction` banned (CSP)
→ `waitForCondition` (`:129-153`). CI: `.github/workflows/ci.yml:42` installs
`firefox-esr` from Mozilla APT → **Slice D switches E2E to a release binary**
(runner default + CI install + `$FIREFOX_ESR_BIN` semantics).

### 3.4 UAT tier

Selenium + geckodriver (non-snap 0.37 from `~/.cache/selenium/...`), release
`firefox` (`$FIREFOX_BIN`), preflight launch handshake
(`preflight.mjs:78-147`); `driver.installAddon(xpi, true)` from `dist/`
preferring `*-uat.zip` (`browser-daemon.mjs:149-198`); UUID pinned via pref
(`browser-daemon.mjs:61-62,165`). Already MV3-compatible per spike.

### 3.5 Manifest-asserting tests (Slice D red-first list)

`tests/unit/manifest.test.ts`: CSP string-shape asserts (`:26-134`),
`strict_min_version >= 140` (`:137-140` → becomes >= 152), `browser_specific_settings`
(`:144-147`), `data_collection_permissions` (`:149-156`), permissions include
`webRequest` + `<all_urls>` (`:160-166` → `<all_urls>` moves to host_permissions),
`background.scripts` excludes thumbnail.js (`:168-170`). Also
`sync-version.test.ts:24-25` (version mirror), `e2e/_helpers.ts:20-21` (gecko id).

### 3.6 ESLint

`eslint.config.js:150-166`: `webextension/**/*.js` = sourceType `script`,
ecma 2018; `:167-179`: `webextension/lib/**/*.js` = module, ecma 2020 (zip.js
ignored `:141-147`). Module-converted files must move under the module glob
(post-MV3). `ntt/no-source-grep` (`:36-86`) guards test source-greps.

### 3.7 Other MV2-coupled tooling

`scripts/build-uat.mjs:16-21` merges `optional_permissions` into `permissions`
and deletes the key (MV2 model — Slice D: handle `host_permissions` too).
`scripts/sync-version.mjs` writes only `manifest.version`. No web-ext config file;
flags inline in `package.json` scripts and `run_esr_tests.sh`.
