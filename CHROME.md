# Chrome Port Program — Stage 3: a Real Chrome Build

**Status: ADOPTED (authored + D0 decided with maintainer 2026-07-15).** No
code has been written under this program yet. Successor to the chrome-prep
program (`CHROME_PREP.md`, 2.5.0), which left the codebase Chrome-*ready*:
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

## Status board (live)

| Arc | Status | Commit(s) |
|---|---|---|
| D0 — decisions of record | done 2026-07-15 (this file) | — |
| D1 — Chrome runtime harness + first boot | pending | — |
| D2 — service-worker boot blockers (thumbnail seam, backup blob URL, theme gate, scheme filter) | pending | — |
| D3 — capture pipeline on Chrome (availability fork, quota, SW respawn proof) | pending | — |
| D4 — icons, action, manifest completeness | pending | — |
| D5 — Chrome E2E tier + CI | pending | — |
| D6 — UAT on Chrome | pending | — |
| D7 — store release prep (CWS + AMO) | pending | — |
| D gate — full Firefox suite green (unchanged) + Chrome tier green + audit + **3.0.0 to both stores** | pending | — |

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
   CHROME_PREP.md's "3.0.0 reserved for AMO after the audit round".)
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
tier (once D1 exists) per arc thereafter. Commit per green arc; status
board updates per arc.

### D0 — decisions of record
- [x] The open questions resolved with the maintainer 2026-07-15; recorded
      as Decisions 1–9 above (CHROME_PREP.md precedent). Maintainer's own
      calls: #5 quite-modern Chrome floor, #6 UAT in scope at a late stage,
      #7 the 3.0.0 dual-store release plan; the rest adopted per
      recommendation.
- [x] ESLint guard hardening decided (Decision 9); implementation lands
      with D2's backup fix.

### D1 — Chrome runtime harness + first boot
*Rationale for running this arc FIRST: chrome-prep wrote Chrome paths blind
(no Chrome runtime anywhere in the loop) and the sweep found gaps exactly
there. Everything after D1 gets a red/green target on real Chrome.*
- [ ] Chrome-for-Testing provisioning documented (not auto-installed; the
      no-installs rule stands — preflight prints the command).
- [ ] Deterministic extension ID: manifest `key` in a dev/test-only overlay
      (NOT the store artifact), `chrome-extension://<id>/newTab.html`
      reachable.
- [ ] Minimal launcher: Puppeteer (already a devDep, CDP native) +
      `--load-extension` of the staged `dist/chrome-build/` (or an
      unpacked-stage variant of `scripts/build.mjs`), headless=new.
- [ ] First smoke: extension loads, SW starts without an uncaught error,
      new-tab page renders a grid. EXPECTED RED on arrival (the D2
      blockers); the smoke is the program's red/green harness, so red here
      is the deliverable, not a failure.
- [ ] Per-API `minimum_chrome_version` verification; pin the floor
      (Decision 5).

### D2 — service-worker boot blockers
- [ ] `lib/thumbnail-image.js`: OffscreenCanvas/`createImageBitmap` path
      per Decision 1; same three exports; Firefox path untouched (or
      textually untouched under runtime detect). Unit tests for both paths
      (Node has OffscreenCanvas; the Image-path tests already exist).
- [ ] `lib/backup.js` blob-URL home per Decision 2; ESLint guard extended
      (D0) so the class can't come back. Red/green at the fast tier +
      full Firefox E2E (backup/restore suites) since this touches a live
      Firefox path.
- [ ] Theme presence-gate (`'theme' in api`) in `newTab.js` + `theme.js`
      (Decision 2 of CHROME_PREP): base `prefers-color-scheme` both
      platforms, `browser.theme` layered only when present. Firefox
      unchanged (full E2E theme suite).
- [ ] `titlebar.js:226`: `moz-extension://` literal → `api.runtime.getURL('')`
      prefix (works on both platforms; fast-tier test).
- [ ] D1 smoke goes GREEN at the end of this arc — the arc's exit
      criterion.

### D3 — capture pipeline on Chrome
- [ ] Wire `isCaptureAvailableViaPermission` as the Chrome fork of
      `isCaptureAvailable` (platform-detect at the existing seam; Firefox
      keeps the `typeof` probe per the defence-in-depth finding).
- [ ] `captureVisibleTab` quota: Chrome enforces
      `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` (2/s) — audit the
      multi-stage capture (A/B/C passes) against it; add
      backoff/coalescing only if the Chrome E2E proves it's actually hit.
- [ ] SW kill/respawn proof: Chrome E2E test that terminates the worker
      (CDP) mid-idle and proves `pendingCaptures` survives via
      `storage.session` and the capture self-heals — the Chrome analogue
      of the Firefox `extensions.background.idle.timeout=10000` respawn
      regime.
- [ ] Thumbnail round-trip green on Chrome smoke (navigate → capture →
      IDB → tile renders it).

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
- [ ] `test:e2e:chrome` per Decision 3: the D1 launcher grows into a small
      suite (boot, grid, capture, backup, theme fallback, SW respawn);
      runner-lock discipline mirrored from `run_esr_tests.sh`.
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
