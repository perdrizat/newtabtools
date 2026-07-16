# Chrome Port Program — Stage 3: a Real Chrome Build

## Status board (live)

| Arc | Status | Commit(s) |
|---|---|---|
| D0 — decisions of record | done 2026-07-15 (this file) | — |
| D1 — Chrome runtime harness + first boot | done 2026-07-15 (5/5 smoke GREEN on CfT 151; Selenium path green) | — |
| D2 — service-worker boot blockers (thumbnail seam, backup blob URL, theme gate, scheme filter) | done 2026-07-16 (Chrome smoke 5/5 zero errors; Firefox E2E 125/126 + the one flake green solo — contention class; UAT 4/4) | `7cfbca6`+`2ae483c` |
| D3 — capture pipeline on Chrome (availability fork, quota, SW respawn proof) | done 2026-07-16 (smoke 8/8: capture round-trip stores a real image on Chrome; SW kill/respawn + storage.session survival) | — |
| D4 — icons, action, manifest completeness | core done 2026-07-16 (`178a773`); `syncActionIconWithTheme` wiring remains | `178a773` |
| D5 — Chrome E2E tier + CI | pending | — |
| D6 — UAT on Chrome | pending | — |
| D7 — store release prep (CWS + AMO) | pending | — |
| D gate — full Firefox suite green (unchanged) + Chrome tier green + audit + **3.0.0 to both stores** | pending | — |

**Status: IN EXECUTION (adopted + D0 decided with maintainer 2026-07-15).**
Successor to the chrome-prep
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
tree, Chrome via manifest-overlay dual-build, never a branch; the 19 wire
names frozen; restore validators independent; Firefox behavior MUST NOT
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
8. **Single version stream.** CWS and AMO both ship X.Y.Z from
   `package.json` — subsumed by Decision 7's simultaneous dual-store
   release.
9. **ESLint guard hardening: yes.** Add `no-restricted-properties` for
   `URL.createObjectURL`/`revokeObjectURL` in `webextension/lib/**` (minus
   the seam file(s) that legitimately hold them after Decision 2) — closes
   the guard blind spot that let backup.js through. Lands with the D2
   backup fix.

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
- [x] `minimum_chrome_version` pinned: **144** (CfT stable is 151 at pin
      time; ~7 releases ≈ 7 months back — Decision 5's "months old, not
      years"; every per-API floor is far older). Applied to
      `manifest/chrome.json` in D4.

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
- [ ] **Tracked gap (page rendering, deliberately out of D3):** thumbnails/
      favicons cross the wire as `Map`s of `Blob`s — Chrome's JSON
      messaging degrades a `Map` to `{}` and can't carry a `Blob` at all,
      so tiles will not RENDER stored thumbnails on Chrome yet (capture +
      storage proven working). Dual-shape reads landed at 4 page call
      sites as groundwork. Design decision needed (page reads IDB directly
      — likely simplest, both platforms share the origin — vs base64 over
      the wire per the D2 backup precedent). Moved to D5 pre-work below.
- [ ] **Tracked gap:** `filters-ui.js`'s callback-style
      `topSites.get(options, cb)` — Chrome rejects any 2-arg call shape
      outright ("No matching signature"); needs an argument-count-aware
      branch at that call site. Moved to D5 pre-work below.

### D4 — icons, action, manifest completeness
- [ ] PNG icon set per Decision 4 (16/32/48/128 + action icons); chrome
      overlay's `icons`/`action.default_icon` re-pointed; Firefox manifest
      untouched (keeps SVG + `theme_icons`).
- [ ] `syncActionIconWithTheme` wired: `action.setIcon` driven by
      `prefers-color-scheme` on Chrome (the `theme_icons` substitute);
      no-op on Firefox.
- [ ] `manifest/chrome.json`: `minimum_chrome_version` (Decision 5),
      `incognito` policy stated explicitly.
- [ ] CSP review for the Chrome target (the Mozilla-CDN `connect-src` is
      wallpaper-catalog plumbing — decide keep/drop for Chrome).

### D5 — Chrome E2E tier + CI
- [ ] **Pre-work, from D3's live findings:** (a) thumbnail/favicon
      rendering on Chrome — the Blob-over-wire gap (design: page-side
      direct IDB read vs base64 wire; see D3's tracked-gap entry);
      (b) `filters-ui.js`'s 2-arg `topSites.get` call shape (Chrome rejects
      it). Both need landing before the smoke's "tile renders it" check can
      go green.
- [ ] `test:e2e:chrome` per Decision 3: the D1 launcher grows into a small
      suite (boot, grid, capture, backup, theme fallback, SW respawn);
      runner-lock discipline mirrored from `run_esr_tests.sh`.
      **Parallel-run rule (maintainer 2026-07-16):** the Chrome tier must
      be runnable concurrently with Firefox E2E (9222) and the UAT daemon
      (9876) — keep the pipe/ephemeral transports (no fixed port); if one
      ever becomes necessary, 9223 is reserved (see
      `tests/e2e-chrome/README.md` "Port allocation").
- [ ] Origin/install abstraction in a `_helpers` seam only as far as the
      smoke tier needs — full-parity porting is explicitly out of scope
      (future arc, own program if warranted).
- [ ] CI job (GitHub Actions ships Chrome on ubuntu runners) — Chrome
      smoke on PR, same tiering philosophy as the Firefox suite.

### D6 — UAT on Chrome (Decision 6: the pre-release visual pass)
- [ ] `browser-daemon.mjs` Chrome variant: Selenium `.forBrowser('chrome')`
      + `--load-extension` (geckodriver's `installAddon` has no Chrome
      analogue), deterministic ID via the dev `key`, environment seed
      reused (history/consent seeding is browser-agnostic Selenium
      driving; `chrome-extension://` origin threaded through `urls.mjs`).
      HTTP API port: **9877** (≠ Firefox UAT's 9876) so both daemons can
      run in parallel (maintainer 2026-07-16; see `tests/e2e-chrome/README.md`
      "Port allocation").
- [ ] Scenario pass on Chrome: run the existing scenario set against the
      Chrome daemon; triage per-scenario (some assert Firefox-specific
      chrome — theme following, menus — and need Chrome variants or
      skips marked in the scenario frontmatter).
- [ ] Runs green on the actual store-candidate artifact
      (`pnpm build chrome` output, not a dev stage).

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
