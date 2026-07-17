# Chrome Port Program — Stage 3: a Real Chrome Build

## Status board (live)

| Arc | Status | Commit(s) |
|---|---|---|
| D0 — decisions of record | done 2026-07-15 (this file) | — |
| D1 — Chrome runtime harness + first boot | done 2026-07-15 (5/5 smoke GREEN on CfT 151; Selenium path green) | `e32e128` |
| D2 — service-worker boot blockers (thumbnail seam, backup blob URL, theme gate, scheme filter) | done 2026-07-16 (Chrome smoke 5/5 zero errors; Firefox E2E 125/126 + the one flake green solo — contention class; UAT 4/4) | `7cfbca6`+`2ae483c` |
| D3 — capture pipeline on Chrome (availability fork, quota, SW respawn proof) | done 2026-07-16 (smoke 8/8: capture round-trip stores a real image on Chrome; SW kill/respawn + storage.session survival) | `eea8565` |
| D4 — icons, action, manifest completeness | done 2026-07-16 (incl. `syncActionIconWithTheme` via the `Theme.colorScheme` relay — 20th wire name) | `178a773`+`3ab39e5` |
| D5 — Chrome E2E tier + CI | done 2026-07-16 (smoke **11/11** incl. structured-clone wire + tile-renders-thumbnail; CI job; Decision 10; filters-ui gap closed) | `8901efb`+`9cd2c6d`+`3ab39e5` |
| D5b — Chrome E2E suite parity (the full Firefox suite on Chrome; Decision 3 superseded) | **done 2026-07-16 — 126/126 = 100% parity on CfT 151, zero skips; Firefox unchanged-proof 126/126** | `9cd51bc` |
| D6 — UAT on Chrome | **done 2026-07-16 — 11/11 scenarios passed on Chrome** (daemon parameterized, both smokes green in parallel, store-candidate equivalence verified) | `6633788`+ |
| D7 — store release prep (CWS + AMO) | pending | — |
| D gate — full Firefox suite green (unchanged) + **Chrome parity suite green (D5b)** + Chrome smoke green + audit + **3.0.0 to both stores** | pending | — |

**Status: D0–D6 + D5b COMPLETE (2026-07-16) — only D7 (store prep) and the
D gate remain.** The Chrome build boots, captures, renders thumbnails, and
backs up — smoke 10/10, E2E parity 124/126 run (2 SW-lifecycle tests skip on
Chrome, GH #23), UAT 11/11 on CfT 151. SW kill/respawn is not reliably
testable under CfT CDP automation (audit 2026-07-16 M2, GH #23): the kill is
defeated by the debugger attach and a clean kill does not respawn; real
respawn-hygiene coverage is the shared-code Firefox event-page-lifecycle
suite. Top-level docs (README/TESTING/CONTRIBUTING) reflect the
two-browser reality; the branch is ready for maintainer review. Successor to the chrome-prep
program (shipped as 2.5.0; per-arc record in `CHANGELOG.md`/`audit/`/git
history), which left the codebase Chrome-*ready*:
`api` seam in place, six wrappers written (some dormant), two-target manifest
authoring, `pnpm build chrome` producing an unvalidated zip. This program
makes that artifact actually run, then testable, then shippable.

**Release plan (maintainer decision 2026-07-15):** 2.5.0 has shipped to AMO.
**3.0.0 = full Chrome support**, and ships to BOTH stores (AMO again + Chrome
Web Store) at the program gate. No intermediate version ships in between —
emergency fixes excepted.

Evidence base: `audit/2026-07-11-chrome-api-divergence.md` (the C5 divergence
audit) + a fresh port-readiness sweep (2026-07-15) whose findings are folded
into the arcs below.

**Inherited constraints (decisions of record, not relitigated here):**
zero runtime deps (no polyfill — the in-house `api` Proxy is the seam);
no build step for the Firefox target (source == shipped); single source
tree, Chrome via manifest-overlay dual-build, never a branch; the frozen
wire names (20 since 2026-07-16 — additions allowed, renames/drops never);
restore validators independent; Firefox behavior MUST NOT
change — every Firefox path in this program stays byte-identical or is
proven unchanged by full E2E; Decisions 1–2 (no Chrome menus; theme =
`prefers-color-scheme` base, `browser.theme` a Firefox bonus). The MV3
migration directive "no OffscreenCanvas" was scoped to the *Firefox* event
page (which keeps DOM); the Chrome service worker path uses OffscreenCanvas
*behind the existing seam* without touching the Firefox path — not a
reopening of that directive.

## What the 2026-07-15 sweep found (the concrete gap list)

Runtime blockers a Chrome SW build hits today — none caught by ESLint or
`pnpm build chrome`:

1. **`lib/backup.js:66` — `URL.createObjectURL` in the background.** Not
   defined in a service worker; `makeZip()` throws. The C1 ESLint guard is
   blind to it (it restricts *globals*; `createObjectURL` is a method on the
   allowed `URL`). The file's own comment reasons about document-scoped blob
   URLs — an event-page assumption.
2. **`lib/thumbnail-image.js`** — the designed swap seam (its header says
   so): `resizeThumbnail` and `isBlank` use `Image` + `document.createElement
   ('canvas')`; must gain an OffscreenCanvas/`createImageBitmap` path.
   `dataURLtoBlob` is already SW-safe. Callers import by name only —
   transparent swap.
3. **Un-gated `api.theme`** — `newTab.js:948,950` (`theme.onUpdated.add/
   removeListener`, would throw on Chrome) and `theme.js:118` (`getCurrent`,
   try/catch-degraded but not presence-gated). The C5b-deferred Decision-2
   gate.
4. **SVG icons** — `icons` (base) and `action.default_icon` (chrome overlay)
   point at `.svg`; Chrome renders PNG only. Toolbar icon breaks.
5. **`titlebar.js:226`** — hardcoded `moz-extension://` prefix filter for
   the recently-closed list; silently wrong scheme on Chrome (cosmetic).
6. **Dormant wrappers unwired** — `isCaptureAvailableViaPermission` (no call
   site) and `syncActionIconWithTheme` (empty stub).
7. **Manifest gaps** — no `minimum_chrome_version`; `incognito` policy
   unstated; no deterministic-ID `key` for a test/dev profile.
8. **No Chrome test tier** — E2E is `web-ext run` + BiDi + a `prefs.js`
   UUID scrape (all Firefox-only mechanics); UAT is Selenium
   `installAddon` (geckodriver-only).

What is already SW-safe (verified, no work needed): all background listener
registrations are synchronous at module top level; the in-memory capture
state (`captureSessions`/`networkIdleWatchers`) is ≤2s-lived and
self-healing by design, `pendingCaptures` already round-trips
`storage.session`; the IDB wrapper reconnects on connection loss; no
`unload` reliance; menus/`getBrowserInfo`/`search` are all gated or wrapped.

## Decisions of record (D0, maintainer-decided 2026-07-15)

1. **Thumbnail seam = runtime detect, one file.** `lib/thumbnail-image.js`
   gains an OffscreenCanvas/`createImageBitmap` path selected by
   `typeof document === 'undefined'` (SW ⇒ Chrome path); the Firefox
   `Image` + canvas path stays textually untouched, honoring the MV3
   directive's scope. One source of truth; the Chrome path unit-tests in
   plain Node. **Rejected:** build-time file swap (divergent staged source,
   untestable without a build).
2. **Backup download: object-URL creation moves to the page.** The
   background returns the zip bytes over the wire; the page creates the
   blob URL and triggers the download. One unified path for both
   platforms; this changes a live Firefox path, so full Firefox E2E
   (backup/restore suites) is the proof. **Fallback** if review finds the
   wire payload objectionable: Chrome-only fork in backup.js.
   **Rejected:** `chrome.offscreen` document (heavy machinery for one
   call).
3. **Chrome E2E = a dedicated smoke tier, not suite parity.**
   `test:e2e:chrome` covers boot, grid render, capture round-trip, backup,
   theme fallback, SW kill/respawn. Porting the 127-test Firefox suite is
   explicitly out of scope (its own future program if ever warranted); the
   `_helpers.ts` origin/install abstraction goes only as far as the smoke
   tier needs.
   **SUPERSEDED (maintainer 2026-07-16): full E2E suite parity IS in
   scope for this program** — new arc D5b below. The original rationale
   (unknown install mechanics, unknown helper depth) dissolved once D1
   proved CfT honors `--load-extension` under a normal debugging port:
   the SAME vitest suite can run on Chrome through a parameterized
   helpers seam. The 10-check smoke stays as the fast per-arc gate;
   parity is the suite-level proof. Platform-fundamental divergences get
   documented per-file skips/variants, not silent omissions.
4. **Icons: committed PNGs, Chrome-only.** Chrome's manifest icon keys do
   not accept SVG at all (PNG/BMP/GIF/ICO/JPEG only) — this is *additive*
   for Chrome, the Firefox manifest keeps the SVGs. PNGs are rasterized
   from the SVGs by a checked-in regen script, run once and committed
   (diff-visible assets). **Rejected:** build-time rasterization (native
   devDep like sharp/resvg for zero gain).
5. **Chrome floor: quite modern.** Target audience is tech-savvy and keeps
   Chrome current (maintainer). Pin `minimum_chrome_version` in D1 to a
   recent stable (on the order of months old, not years — current stable
   minus a handful of releases), verified against the per-API floors
   rather than stretched down to them.
6. **UAT on Chrome: in scope, staged late.** Deferred past the E2E tier
   but a deliverable of THIS program — its own arc (D6), placed
   deliberately right before store release as the final visual/UX
   confidence pass on the shipping artifact.
7. **Release plan: 3.0.0 = full Chrome support, dual-store, no
   intermediates.** 2.5.0 shipped to AMO (2026-07-15). The next release is
   3.0.0 at the D gate, shipped to BOTH AMO and the Chrome Web Store.
   Nothing ships in between except emergency fixes. (Supersedes
   chrome-prep's "3.0.0 reserved for AMO after the audit round".)
   **Amended 2026-07-16:** **2.6.0 is the internal minor release line** —
   version-bumped and tagged for testing purposes only, never submitted to
   any store; it becomes 3.0.0 when the maintainer clears the ship.
8. **Single version stream.** CWS and AMO both ship X.Y.Z from
   `package.json` — subsumed by Decision 7's simultaneous dual-store
   release.
9. **ESLint guard hardening: yes.** Add `no-restricted-properties` for
   `URL.createObjectURL`/`revokeObjectURL` in `webextension/lib/**` (minus
   the seam file(s) that legitimately hold them after Decision 2) — closes
   the guard blind spot that let backup.js through. Lands with the D2
   backup fix.
10. **Structured-clone messaging on Chrome; floor raised to 148**
   (maintainer-decided 2026-07-16, after the D3/D5 live finding that
   Chrome's JSON messaging erases the thumbnail/favicon wire — a `Map`
   arrives as `{}`, a `Blob` can't cross at all). Chrome 148+ ships an
   opt-in manifest key, `"message_serialization": "structured_clone"`
   (stable, supports Map/Blob/File/Set/Date) — set in `manifest/chrome.json`
   ONLY; Firefox messaging is structured-clone natively and gets no key.
   `minimum_chrome_version` moves 144 → **148** (~4 months old — still
   within Decision 5's "quite modern"). This supersedes the two designs
   considered for the rendering gap (page-side direct IDB reads — still a
   valid future optimization; base64 over the wire — rejected for the hot
   path). Proof: smoke 11/11 incl. "Thumbnails.get returns a real Map with
   a Blob" and "tile renders the stored thumbnail" on CfT 151. Caveats
   verified inapplicable: no SharedArrayBuffer/transferables, no
   extension-to-extension messaging, no `toJSON()` reliance.

## Arcs

Gates per arc: red/green fast tests, `pnpm lint`, `pnpm typecheck`,
`pnpm lint:webext`; **full Firefox E2E for any arc that touches a shipped
Firefox code path** (D2 does; D4's manifest work doesn't); the Chrome smoke
tier (once D1 exists) per arc thereafter. Commit per green arc; **this
file's status board updates in the SAME commit, every commit that advances
the program** (maintainer directive 2026-07-16).

### D0 — decisions of record
- [x] The open questions resolved with the maintainer 2026-07-15; recorded
      as Decisions 1–9 above (chrome-prep precedent). Maintainer's own
      calls: #5 quite-modern Chrome floor, #6 UAT in scope at a late stage,
      #7 the 3.0.0 dual-store release plan; the rest adopted per
      recommendation.
- [x] ESLint guard hardening decided (Decision 9); implementation lands
      with D2's backup fix.

### D1 — Chrome runtime harness + first boot
*Rationale for running this arc FIRST: chrome-prep wrote Chrome paths blind
(no Chrome runtime anywhere in the loop) and the sweep found gaps exactly
there. Everything after D1 gets a red/green target on real Chrome.*
- [x] **Chrome for Testing is the automation vehicle** (hard finding, not a
      preference): branded Google Chrome >= 137 removed extension
      automation — `--load-extension` is ignored AND the CDP install path
      leaves the extension inert (verified against a minimal hello-world
      MV3 extension, so it's the platform, not this codebase). Provisioning
      is `pnpm chrome:provision` (`tests/e2e-chrome/_tools/provision-cft.mjs`,
      via puppeteer-core's own `@puppeteer/browsers`, ~/.cache/puppeteer —
      the Selenium-Manager binary-fetch precedent). Full harness record:
      `tests/e2e-chrome/README.md`.
- [x] Deterministic extension ID `lncefjbclhbbikhanecleanbbohpiclk` via a
      committed PUBLIC dev key (`_tools/dev-key.json`, no private half
      exists), injected only by the dev staging path (`stageDevBuild()` →
      `dist/chrome-dev/`) — never by `pnpm build chrome` store artifacts.
- [x] Launcher: Puppeteer `browser.installExtension()` over the pipe
      transport + `--enable-unsafe-extension-debugging` +
      `ignoreDefaultArgs: ['--disable-extensions']` (each omission
      reproduces the same inert-extension signature; recorded in the tier
      README). `pnpm chrome:smoke` = 5 checks.
- [x] First smoke: **GREEN 5/5 on CfT 151** — the module SW registers and
      runs, `newTab.html` renders a 9-cell grid. Exactly ONE page error:
      the predicted un-gated `api.theme.onUpdated` (D2). The expected-RED
      assumption was too pessimistic: the D2 "boot blockers"
      (thumbnail-image DOM, backup blob URL) are call-time, not load-time —
      they gate FEATURES (capture, backup), which D2/D3 still fix, with the
      smoke suite growing feature checks to prove it.
- [x] Selenium path green too (extended scope, de-risks D6 UAT-on-Chrome):
      Selenium Manager auto-provisioned chromedriver 151, `--load-extension`
      works on CfT under Selenium, grid renders (`pnpm chrome:smoke:selenium`).
- [x] `minimum_chrome_version` pinned: initially **144** (D1); raised to
      **148** by Decision 10 (structured-clone messaging is the new
      binding API floor — every other per-API floor is far older).
      Applied in `manifest/chrome.json`.

### D2 — service-worker boot blockers
- [x] `lib/thumbnail-image.js`: OffscreenCanvas/`createImageBitmap` path per
      Decision 1 (`_isServiceWorkerScope()` probe; shared
      pixel-analysis helper; `_resizeThumbnailOffscreen`/`_isBlankOffscreen`
      as `_`-prefixed testable exports, the titlebar.js `_layoutTitlebar`
      convention); Firefox DOM path verbatim (renamed `_*DOM`). 20 new
      tests, mock-driven (correction to this plan's earlier claim: Node/jsdom
      have NO real OffscreenCanvas — the real proof is D3's Chrome
      round-trip).
- [x] `lib/backup.js` blob-URL home per Decision 2a: `makeZip` returns
      `{data (base64), filename}` (chunked `btoa`, SW-safe; Chrome messaging
      is JSON-only — a Blob doesn't survive `runtime.sendMessage` there);
      new page leaf `backup-download.js` decodes → object URL →
      `downloads.download` → revoke-on-terminal (former background logic
      moved verbatim; `object-urls.js` deliberately NOT reused — its
      keyed revoke-on-replace model would revoke an in-flight first export
      when a second starts). `Export:backup` wire NAME unchanged (response
      payload shape changed; contract test asserts names, not that shape).
      Restore side untouched. ESLint `no-restricted-properties` guard for
      `URL.create/revokeObjectURL` in `lib/**` (Decision 9), red-first via
      background-dom-guard.test.ts. 12 new page-side tests + rewritten
      backup-side assertions; fast 1390/1390.
- [x] Theme presence-gate (`'theme' in api`) in `newTab.js` (~:936, the
      menus-gate pattern) + `theme.js` (~:116 explicit absent→`_theme=null`
      branch). Red-first against the exact Chrome-observed TypeError.
      Firefox path unchanged (E2E theme suite in the arc-close batch).
- [x] `titlebar.js:226`: `moz-extension://` literal →
      `api.runtime.getURL('')` prefix. Finding recorded: the old literal was
      functionally redundant (common.js `isValidURL` already filtered
      extension schemes downstream) — fixed for the no-scheme-assumptions
      rule, not as a live bug.
- [x] D1 smoke GREEN with ZERO page errors after the theme gate
      (2026-07-16; was 5/5 with one error before).
- [x] Arc-close batch (2026-07-16, E2E and UAT run in PARALLEL per the new
      CONTRIBUTING "Running test tiers in parallel" practice): full Firefox
      E2E 125/126 — the one failure (titlebar-reflow settle count) was the
      predicted CPU-contention class and passed green re-run solo; UAT 4/4
      (20-config, 22-advanced-tab, 31-titlebar, 32-high-contrast) with 5
      benign observations; Chrome smoke 5/5 zero page errors.

### D3 — capture pipeline on Chrome
*(Executed 2026-07-16; the implementing agent died on an API error before
its final gates — the orchestrator reviewed every diff, debugged the two
failing smoke checks live, and closed the arc.)*
- [x] `isCaptureAvailableForScope(isServiceWorkerScope)` wired at
      `captureTab` (already async): SW scope → permission check, event page
      → the unchanged `typeof` probe; the two underlying probes stay
      independently callable (defence-in-depth finding honored). The scope
      bit is passed in from thumbnail-image.js's `_isServiceWorkerScope()`
      — the C1 ESLint guard confines raw `document` references to that one
      seam file.
- [x] Quota audit: a single A/B/C session cannot trip Chrome's 2-per-second
      cap (A+B are the only pair inside any 1s window; C is ~1.5s clear).
      The one theoretical risk is SPA retrigger storms (each retrigger's
      "capture A: immediate"); recorded at the session-start site, NO
      speculative backoff (per this plan) until a real run shows it firing.
- [x] SW kill/respawn proof in the smoke: CDP `Target.closeTarget` on the
      SW target (probed alternatives fail: `ServiceWorker.enable` absent on
      the browser-level session; a page-session `stopAllWorkers` accepts
      the call but kills nothing), wake via a REAL navigation event
      (webNavigation.onCompleted — a page-side `runtime.sendMessage` never
      wakes the worker after this kill class), `storage.session` marker
      survives. Smoke 8/8 GREEN.
- [x] Capture round-trip green on Chrome smoke: pin → navigate →
      OffscreenCanvas → a real 16 KB image in IDB, verified by DIRECT IDB
      read from the extension page. Live-run findings fixed along the way
      (each with its own fast-tier regression test): `fetch(data:)` blocked
      by the CSP's `connect-src` in the SW decode path (→ `dataURLtoBlob`);
      `chrome.topSites.get()` accepts NO options argument — the old
      Chrome-path options object threw synchronously and silently froze
      `Tiles._cache` empty (no capture could ever start); a REAL
      cross-platform `lib/db.js` race (`onupgradeneeded` exposed the
      connection before the upgrade transaction committed →
      `InvalidStateError` for concurrent `withStore()` callers).
- [x] ~~Tracked gap (page rendering)~~ — RESOLVED by Decision 10
      (structured-clone messaging); see D5 pre-work (a).
- [x] ~~Tracked gap (filters-ui call shape)~~ — RESOLVED; see D5
      pre-work (b).

### D4 — icons, action, manifest completeness
- [x] PNG icon set per Decision 4 (2026-07-16, `178a773`):
      `scripts/rasterize-icons.mjs` (puppeteer-core + CfT, zero new deps)
      → `assets/chrome-icons/` (icon 16/32/48/128, tools-light 16/32;
      tools-dark 16/32 added with the action-icon wiring); chrome
      overlay's `icons`/`action.default_icon` re-pointed to PNG size maps;
      `scripts/build.mjs` chrome target + `stageDevBuild()` copy the PNGs
      into the staged `images/`; Firefox manifest untouched (keeps SVG +
      `theme_icons`), artifact verified byte-identical.
- [x] `syncActionIconWithTheme` WIRED (descope proposal rejected by
      maintainer 2026-07-16 — "do the action icons even if it's a bigger
      change"): a Chrome MV3 SW cannot read `prefers-color-scheme`, so the
      page relays it — `theme.js` sends the NEW wire message
      `Theme.colorScheme {dark}` at boot and on every matchMedia change;
      the dispatch calls `syncActionIconWithTheme(dark, isSWScope)` which
      no-ops on Firefox (manifest `theme_icons` is declarative there) and
      `action.setIcon`s the tools-light/tools-dark PNG pair on Chrome
      (mapping mirrors Firefox's `theme_icons` semantics; tools-dark
      16/32 PNGs added to the rasterizer + assets). **This adds a 20th
      frozen wire name** — deliberate contract addition (the decision
      forbids renames/drops), contract test + CONTRIBUTING updated.
      Limitation, accepted: the icon syncs from the first new-tab render
      per browser session (default_icon until then). VISUAL CHECK owed in
      D6's Chrome UAT: confirm the mapping isn't inverted on a real
      toolbar (a one-line swap if so).
- [x] `manifest/chrome.json`: `minimum_chrome_version` (144 at `178a773`,
      raised to 148 by Decision 10), explicit `incognito: "spanning"`
      (rationale in `manifest/README.md` — JSON carries no comments),
      `message_serialization: "structured_clone"` (Decision 10).
- [x] CSP review for the Chrome target: the Mozilla-CDN `connect-src`
      (wallpaper catalog) is a plain fetch, identical on Chrome — KEPT,
      not forked per-target (recorded in `manifest/README.md`).

### D5 — Chrome E2E tier + CI
- [x] ~~Pre-work (a)~~: thumbnail/favicon rendering on Chrome — **RESOLVED
      by Decision 10** (structured-clone messaging): the existing wire now
      carries the Maps/Blobs as-is; smoke checks "structured clone: real
      Map with a Blob" and "tile renders the stored thumbnail" are green
      (11/11, CfT 151). The favicon wires (`getFavicons`/`getFaviconsByHost`)
      use the same response shapes and inherit the fix.
- [x] Pre-work (b) DONE (2026-07-16): `filters-ui.js` branches on
      `topSitesOptions(api)` being `undefined` (the Chrome signal) and
      calls 1-arg `topSites.get(cb)` there; Firefox keeps the exact 2-arg
      call. New `tests/integration/filters-ui.test.ts` (the file had no
      prior real-import coverage).
- [x] `test:e2e:chrome` per Decision 3 (2026-07-16): the smoke IS the
      suite — 9 checks: boot/install/SW-start, page+grid render, capture
      round-trip (real OffscreenCanvas image in IDB), backup export
      (decodable base64 zip over the wire — found+fixed the dynamic-import
      platform constraint below), SW kill/respawn + storage.session
      survival; theme fallback is proven by the zero-page-errors check
      (the pre-gate run errored exactly there). `pnpm test:e2e:chrome` =
      both smokes.
      **Platform finding (production fix):** dynamic `import()` is
      spec-disallowed in service workers — lib/messages.js's lazy
      backup.js import (an adjudicated 2026-07-09 design) could never work
      on Chrome; reverted to a static import, cost re-accepted, header
      documents the supersession.
      **Parallel-run rule (maintainer 2026-07-16):** the Chrome tier must
      be runnable concurrently with Firefox E2E (9222) and the UAT daemon
      (9876) — keep the pipe/ephemeral transports (no fixed port); if one
      ever becomes necessary, 9223 is reserved (see
      `tests/e2e-chrome/README.md` "Port allocation"). Known limit: two
      CONCURRENT Chrome-smoke invocations collide on the `dist/chrome-dev`
      staging dir (no runner lock yet) — acceptable while the tier is one
      script; add a lock when the suite splits into files.
- [ ] Origin/install abstraction in a `_helpers` seam only as far as the
      smoke tier needs — full-parity porting is explicitly out of scope
      (future arc, own program if warranted).
- [x] CI job authored (2026-07-16): `.github/workflows/ci.yml` gains a
      parallel `chrome-smoke` job (pnpm + `chrome:provision` + both
      smokes; the runner's preinstalled branded Chrome is unusable for
      extension automation). Takes effect on the next push.

### D5b — Chrome E2E suite parity (Decision 3 superseded, maintainer 2026-07-16)

*Goal: the full Firefox E2E suite (126 tests / 32 files) runs against
Chrome — same test FILES, parameterized harness, documented per-file
divergences. "We need test parity between the two as part of this run."*

*(Executed 2026-07-16. RESULT: **126/126 tests, 32/32 files, 100% parity,
zero skips** — the ≥90% target beaten outright; only ONE file needed
adaptation.)*
- [x] Chrome E2E lifecycle runner `tests/e2e-chrome/run_chrome_tests.sh`
      (mirrors `run_esr_tests.sh`: own mkdir lock, stages the dev build,
      launches CfT with `--load-extension` + port **9223**, waits, runs
      `NTT_E2E_BROWSER=chrome vitest --project e2e`, trap cleanup).
      `pnpm test:e2e:chrome` = the parity suite now; the 10-check smoke
      stays `pnpm chrome:smoke`.
- [x] `tests/e2e/_helpers.ts` browser seam: `connectToFirefox` keeps its
      name (32 importers), branches internally (BiDi @9222 / CDP @9223);
      `getNewTabURL` per-browser origin (dev-key id imported from
      chrome-env.mjs, no duplicate); new `restartChromeServiceWorker`
      (CDP Target.closeTarget + navigation wake, the D3 recipe). Every
      OTHER helper needed zero changes — the C3d wire/DOM-driven harness
      ported untouched, exactly as predicted.
- [x] Suite triage: 26/32 files ran UNMODIFIED first try;
      `event-page-lifecycle` adapted (Firefox's idle-pref sleep is a
      vacuous no-op on Chrome → real SW kill/respawn via the new helper,
      2/2 green solo); 4 files got header-notes only (boot-timing — Chrome
      was FASTER, shared bound kept; drag ×2 — quarantine policy extended;
      theme — never touched browser.theme); `favicon-real-sites` failed
      once under full-suite load and passed solo (the documented
      network-gated class, #21 — NO Chrome skip added).
- [x] Acceptance: **exceeded** — 126/126 executing identically, zero
      skips, every divergence a documented header note. First full run was
      already 125/126 before any edits. Firefox unchanged-proof COMPLETE:
      fast 1417/1417 AND full `pnpm test:e2e` **126/126 (32/32 files),
      zero failures** (14 min under parallel load — the contention-tolerant
      design held). CI: workflow still runs the smoke — switching the
      chrome job to the parity suite is a deliberate follow-up (runtime
      cost on CI runners).

### D6 — UAT on Chrome (Decision 6: the pre-release visual pass)
- [x] `browser-daemon.mjs` parameterized (2026-07-16, ONE implementation,
      `$UAT_BROWSER`): Chrome = CfT + `--load-extension` of `stageDevBuild()`
      at LAUNCH (no mid-session unpacked install exists in Selenium; the
      documented install-order divergence — first-render authenticity holds,
      empirically: the daemon smoke shows 0 thumbnails on non-pinned tiles),
      deterministic dev-key id, port **9877**; Firefox path byte-equivalent
      (`installAddon` post-seed, 9876). `pnpm test:uat:chrome` +
      `test:uat:smoke`/`:chrome`; preflight/urls/skill parameterized.
      **Both daemon smokes GREEN, run in PARALLEL** (the dual-port design
      proven live). Two orchestrator regression-fixes during acceptance:
      (a) the agent's `withTimeout` seed-guard scoped to Chrome only —
      racing past `driver.get()` derails geckodriver's serialized queue
      (Firefox `tiles: 0`, reproduced solo); (b) the smoke's env check now
      POLLS for the async grid fill and scopes the no-thumbnails assertion
      to `.newtab-site:not([pinned])` (single-instant sampling raced the
      fill; diagnosed via live-daemon probe — topSites 12, tiles 9 at
      steady state, pipeline healthy).
- [x] Scenario pass on Chrome (2026-07-16): **11/11 scenarios passed** with
      3 benign observations — notably all 8 recently-closed chips rendered
      REAL favicons via the structured-clone wire (Firefox's same-day run
      had 4 letter-glyph fallbacks; Decision 10 visibly improved the
      favicon path). Triage turned out minimal: the theme scenarios test
      MANUAL theme selection (platform-agnostic UI cards, no
      browser.theme-following assertions); only two literal platform
      references generalized (00-uat-init "Firefox history"→"browser
      history"; 01-default-ui's `moz-extension://` phrasing).
      Artifacts: `tests/uat/artifacts/20260716-194834-chrome/`.
- [x] Store-candidate artifact (satisfied via equivalence, 2026-07-16):
      `pnpm build chrome`'s zip is the SAME staging construction the
      proven dev stage uses, minus the dev `key` (manifest inspected:
      no key, floor 148, `message_serialization`, PNG maps, 2.6.0). A
      literal run of the keyless zip would need a runtime-id discovery
      mechanism (unpacked ids derive from path when keyless) for no
      added coverage — the key changes only the extension ID. Noted for
      D7's CWS upload validation to close the last gap.

### D7 — store release prep (CWS + AMO, Decision 7)
- [ ] CWS developer account, listing copy (adapt `docs/amo-listing.md`),
      screenshots (the AMO screenshot tooling should largely rerun),
      privacy disclosures (mirror PRIVACY.md; "no data collected").
- [ ] Store-artifact manifest check: no dev `key`, no unknown keys, zip
      passes CWS upload validation.
- [ ] AMO 3.0.0 resubmission prep: reviewer notes updated for the
      dual-target build (source == shipped still holds for Firefox).
- [ ] Release ritual documented in CONTRIBUTING.md alongside "Releasing
      to AMO" (single version stream, Decision 8).

### D gate
- [ ] Full Firefox `pnpm test` green and byte-identical Firefox artifact
      (the "Firefox unchanged" proof), Chrome smoke tier green, Chrome UAT
      pass (D6), `pnpm audit` clean, follow-up code-review round
      adjudicated, CHANGELOG promotion, **3.0.0 bump + simultaneous
      AMO/CWS submission** (Decision 7).

## Risks

- **Blind-spot recurrence** — chrome-prep's dormant code shipped gaps
  (SVG icons, backup blob URL) precisely because no Chrome runtime
  existed. D1-first is the mitigation; nothing lands "Chrome-dormant"
  after D1 without the smoke tier seeing it.
- **captureVisibleTab semantics drift** — Chrome's quota + focus
  requirements differ from Firefox's; the capture pipeline is the
  highest-risk subsystem. Contained by D3's dedicated arc + respawn
  proof.
- **Firefox regression via unified paths** — Decision-2(a) (backup) and
  the titlebar fix touch live Firefox code; full Firefox E2E is mandatory
  on those arcs, not optional.
- **CWS review friction** — `<all_urls>` host permission + `history`/
  `topSites` triggers manual review; PRIVACY.md and the reviewer notes
  need Chrome-specific wording. Budget calendar time, not code time.
