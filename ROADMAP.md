# Roadmap

Forward-looking direction and backlog for New Tab PowerTools. A living document —
prune entries as they ship or go stale.

- **What shipped** lives in git history and `CHANGELOG.md`, not here.
- **How it's built / tested** lives in `CONTRIBUTING.md` and `TESTING.md`.
- Completed-arc working documents (`MV3_MIGRATION.md`, `MODERNIZATION.md`) were
  removed after their arcs shipped (2026-07-09) — retrieve via git history; their
  code reviews and inventories live on in `audit/`.
- This file holds *where we're going* and *why the load-bearing choices were made*.

---

## Scope & North Star

NTT replaces Firefox's new-tab page **entirely** via `chrome_url_overrides.newtab` —
Firefox excludes `about:newtab` from extension injection, so the choice is binary:
native or NTT. That sets the product rule:

- **Parity features are the price of entry** — anything a typical user expects from
  the default page (pin, custom tile image/title, drag-reorder, rows, wallpaper,
  light/dark theme, hide-history, localization) must exist in NTT or installing it
  feels like a downgrade. Match native; don't innovate beyond it.
- **Differentiating features are the reason to install** — the things Firefox can't
  do: auto-thumbnail capture of visited pages (the flagship), arbitrarily large
  tiles via an unconstrained configurable grid, layout micro-tuning, lock-grid,
  per-domain filter caps, per-tile background colour, recently-closed-tabs row,
  add-shortcut autocomplete, local backup/restore. These get full investment and
  full test depth.

**Constraint that shapes everything:** Firefox's own new-tab (Activity Stream) is a
chrome-privileged system add-on. Its features can't be submitted upstream, and its
code can't be ported into a WebExtension. NTT reimplements parity behaviour in
WebExtension scope, using Activity Stream only as a behavioural reference.

## Non-goals (won't build)

Native features that are out of scope by design — NTT's pitch is layout precision and
personalization, not content surfaces. Users who want these stay on the native page.

- Pocket / Recommended Stories (Mozilla-controlled content backend).
- Sponsored shortcuts.
- Weather widget (depends on Mozilla's API + location services).
- Lists / Timer (Mozilla's experimental widgets).

---

## Now — first AMO release

The product and security work is done (all features built + tested across four test
tiers; all 7 pre-takeover security findings resolved). The remaining last mile:

- [ ] Capture 5 marketing screenshots from a clean profile loaded with
  `tests/uat/newtabtools_knowngood.zip` (see `docs/amo-listing.md` "Screenshots
  checklist"). The UAT browser daemon already renders that fixture at Full HD and can
  produce these.
- [ ] First submission to the AMO Developer Hub — ships as **3.0.0**, gated on
  the chrome-prep program ([`CHROME_PREP.md`](CHROME_PREP.md), releases as
  2.5.0) and its follow-up security/code audit round (maintainer decisions
  2026-07-10; the page-modules arc shipped as 2.4.0, and the premature 3.0.0
  tag was renumbered to 2.3.0). ID/listing decision is settled: new listing
  under `newtabtools@symlink.ch` (not an ID-transfer). Listing copy,
  `PRIVACY.md`, `LICENSE`, and reviewer notes are in place.

## Next — Chrome-prep program (2.5.0)

**Planned and in progress: see [`CHROME_PREP.md`](CHROME_PREP.md)** (maintainer
decision 2026-07-10: the full program precedes the 3.0.0 AMO release). Arcs:
background DOM-guard, leaf utilities, typed monoliths + principled
gesture-driven test harness + total bridge retirement, monolith split into
feature modules, capability-seam completion (divergence audit, targeted
wrappers, in-house namespace normalization — no polyfill dep), two-target
manifest authoring. Two Chrome design decisions settled up front (context
menus: in-tile action row is the Chrome interaction; theme:
`prefers-color-scheme` source, `browser.theme` as Firefox bonus).

## Later — Chrome extension (stage 3)

After the AMO release bakes, and on top of the chrome-prep program above.
Single-source / dual-build (shared `webextension/` with per-target manifest
overlays), **not** a long-lived parallel branch. The port then reduces to:
fork the seam implementations, write the OffscreenCanvas
`lib/thumbnail-image.js`, add the Chrome manifest overlay. The previous
maintainer's `chrome` branch is historical reference only — do not merge it.

---

## Backlog (unscheduled)

Concrete items not yet on a horizon. Roughly priority-ordered within each group.

**Tooling / debt**
- Page scripts as real ES modules / retire the `globalThis` bridge — **Done**
  (page-modules arc, executed 2026-07-10, slices P1–P5; ships as 2.4.0).
  Untangled the `newTabTools ↔ Grid/Page/Updater` global mesh; `common.js`/
  `prefs.js` gained real `export`s. Record: [`PAGE_MODULES.md`](PAGE_MODULES.md)
  + git history. The live remainder is the surviving-bridge entry below.
- Page-scope `el(tag, className, text?)` DOM builder + `textContent` normalization
  — **scheduled: chrome-prep arc C2** ([`CHROME_PREP.md`](CHROME_PREP.md)).
- Dedupe the near-identical favicon cursor walks in `lib/messages.js`
  (`getFavicons`/`getFaviconsByHost`; Stage-M review, opportunistic).
- Retire the surviving page `globalThis` bridges — **scheduled: chrome-prep
  arc C3** ([`CHROME_PREP.md`](CHROME_PREP.md)), which absorbs both remaining
  prerequisites: the dead early-broadcast queue retirement (+ the dead-true
  `typeof` guard sweep in newTab.js) and the E2E/UAT harness migration off
  page-globals (maintainer directive: principled gesture/UI driving, no test
  handle). History of prerequisite (a) — the awesomebar dependency inversion —
  is in the 2026-07-10 P2–P5 review adjudication (done, shipped in 2.4.0).

**UAT tier** (the tier itself is built — see `TESTING.md` and `tests/uat/README.md`)
- The 11-scenario suite covers env/smoke (`00`, `01`), tiles (`10`, `11`), drawer
  (`20`–`23`), and design (`30`–`32`). More scenarios for differentiating features
  that benefit from visual judgment: locked-grid, per-domain filter caps, per-tile
  background colour, backup export, multi-page grids.
- README troubleshooting section keyed to preflight failure messages.
- Explore standards-based result surfacing — SARIF (severity-leveled findings, renders
  in IDE/CI) and/or JUnit XML — once the tier is otherwise settled. Open question:
  reproducibility/calibration of the LLM's *visual* judgments.

**Features**
- _(new ideas land here)_

---

## Decisions of record

The load-bearing "why", kept terse so future maintainers don't re-derive rejected
alternatives. Detail lives in git history / the linked docs.

- **Codebase strategy: cherry-pick + reference rewrite** (2026-05-03). Reimplement
  parity features cleanly in WebExtension scope, port the salvageable NTT gap features,
  drop what Firefox now handles natively. Chosen over "modernize as-is" (forever-
  maintaining ~600 lines of dead-equivalent code) and "lean rewrite" (ships too late,
  loses edge-case behaviour). **Done** — the strangler-fig migration is complete.
- **Language: JS + JSDoc on production, TypeScript on tests, no build step**
  (2026-05-04). Captures most of TS's safety benefit without a compiler between source
  and runtime. Re-escalatable to full TS later (a JSDoc `.js` is a rename away). Rules
  in [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Firefox-only, MV2, for now** (2026-05-02). Chrome forces MV3; doing both during the
  takeover means migrating without a safety net. **Outcome (2026-07-09): the MV3 flip
  shipped as 2.1.0** (records: git history, `audit/2026-07-09-mv3-*`). Firefox stays
  the only target; Chrome remains deferred to stage 3 above.
- **Event-page state placement** (2026-07-09). `captureSessions`/`networkIdleWatchers`
  stay in-memory (≤2s lifetime, event-anchored to a fresh idle clock, self-healing on
  loss — measured); `pendingCaptures` lives in `storage.session` (unbounded wait for
  tab activation, must survive respawn). Persisting the former was considered and
  rejected; an in-memory mirror of the latter likewise (the wake event IS the reader).
- **The 19 `runtime.onMessage` wire names are frozen** (2026-07-09). Internals may
  rename (`getAllTiles`→`getGridTiles` did); wire strings never do —
  `tests/integration/message-contract.test.ts` enforces it.
- **Dual-scope `globalThis` bridge** (2026-07-09). `common.js`/`prefs.js` load both as
  classic page scripts and into the background module graph, so they assign
  `globalThis.X = …` instead of using `export`; background modules read them only via
  `lib/platform.js` accessors. **Outcome (2026-07-10):** retired as a read path in
  the page-modules arc — both files gained real `export`s, `lib/platform.js`'s five
  bridge getters are deleted, and background/page consumers import for real.
  TEST-ONLY `globalThis` assignments survive for E2E/UAT page-context evaluation
  only — no production exception remains (awesomebar.js's `Grid`/`newTabTools`
  reads were dissolved by dependency inversion, P2–P5 review finding 1) — see
  [`PAGE_MODULES.md`](PAGE_MODULES.md).
- **`idb` library rejected; IndexedDB wrapper stays hand-rolled** (2026-07-09,
  re-evaluated at module extraction). Zero-runtime-deps policy; `lib/db.js`'s
  `withStore` is ~50 lines and the reconnect semantics are ours either way. Revisit
  only if its typing friction recurs.
- **Minimum Firefox raised to 152.0** (2026-07-09). Empirically bisected: Firefox
  exposes `tabs.captureVisibleTab`/`captureTab` to MV3 extensions only from 152.0
  (`undefined` on every build through 151.0, official binaries 146–152 bisected).
  Not a permission gate — a Firefox-version gate. Consequence: the E2E tier moved
  from Firefox ESR to release-channel Firefox until a 152-based ESR ships.
- **Full rewrite considered and rejected** (2026-07-09). A clean-slate rewrite
  (incl. Chrome-first) would have discarded the behavior-encoding test suite
  (~1130 fast tests, architecture-coupled) and the edge-case knowledge in the
  capture pipeline, for benefits reachable incrementally. Migrated instead.
  **Outcome:** the ES-module rewrite of the background shipped as
  modernization Stage M / 2.2.0 (2026-07-09), followed by the HTML5 page
  conversion in Stage H / 2.3.0, and the page-modules arc / 2.4.0
  (`PAGE_MODULES.md`); the arc working docs live in git history.
- **Chrome via single-source / dual-build, not parallel branches** — long-lived branches
  carry permanent merge cost.
- **AMO: new listing / ID `newtabtools@symlink.ch`, not ID-transfer** — clean state
  over inheriting every existing user's (possibly stale or tampered) IndexedDB + prefs.
- **Security review absorbed into the normal workflow** (2026-05-04). All 7 findings
  from the pre-takeover review are fixed; AI-contribution supply-chain guardrails live
  in `CONTRIBUTING.md`. See `audit/2026-05-04-security-review.md` for the original.
