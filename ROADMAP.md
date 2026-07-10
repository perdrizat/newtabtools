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
- [ ] First submission to the AMO Developer Hub — ships as **3.0.0**, gated on the
  page-modules arc ([`PAGE_MODULES.md`](PAGE_MODULES.md), releases as 2.4.0) and
  the follow-up security/code audit round (maintainer decision 2026-07-10; the
  premature 3.0.0 tag was renumbered to 2.3.0). ID/listing decision is settled:
  new listing under `newtabtools@symlink.ch` (not an ID-transfer). Listing copy,
  `PRIVACY.md`, `LICENSE`, and reviewer notes are in place.

## Later — Chrome extension (stage 3)

After the AMO release bakes. Single-source / dual-build (shared `webextension/`
with per-target manifest variants), **not** a long-lived parallel branch. The
capability layer Chrome forks already exists (`lib/platform.js`) and the image
pipeline sits behind the `lib/thumbnail-image.js` seam (swap for
OffscreenCanvas/`createImageBitmap` in a service-worker build) — remaining
Chrome-only work is that swap, a polyfill, the dual-manifest build, and CWS
review posture for `<all_urls>`. The previous maintainer's `chrome` branch is
historical reference only — do not merge it.

---

## Backlog (unscheduled)

Concrete items not yet on a horizon. Roughly priority-ordered within each group.

**Tooling / debt**
- Page scripts as real ES modules / retire the `globalThis` bridge — the successor
  arc the modernization work deliberately left out. Untangles the
  `newTabTools ↔ Grid/Page/Updater` global mesh and lets `common.js`/`prefs.js`
  gain real `export`s. **Planned:** see [`PAGE_MODULES.md`](PAGE_MODULES.md)
  (ships as 2.4.0).
- Page-scope `el(tag, className, text?)` DOM builder + `textContent` normalization
  across the ~37 near-identical `createElement` blocks (2026-07-09 Stage-H review
  §8 — deferred by design to keep the conversion diff mechanical).
- Dedupe the near-identical favicon cursor walks in `lib/messages.js`
  (`getFavicons`/`getFaviconsByHost`; Stage-M review, opportunistic).
- `lib/background-main.js` is excluded from `checkJs` (documented tsconfig gotcha:
  excluding the entry keeps tsc from pulling untyped dual-scope imports into the
  program) — spot-check it manually on change, or find a lint-grade alternative.
- Retire the surviving page `globalThis` bridges — three prerequisites, in
  order (see `PAGE_MODULES.md` TEST-ONLY bridge policy + the 2026-07-10 P2–P5
  review findings 1–2): (a) convert awesomebar.js's `Grid`/`newTabTools`
  bare-global reads to real imports — blocked on typing the monoliths (a
  static import would pull newTab.js/fx-newTab.js into the checked program),
  so it rides the future monolith-typing/splitting arc; (b) retire
  `pageMessageHandler`'s now-dead early-broadcast queue (`flushQueued`, the
  `typeof Updater/Grid` triggers, the M5-era queue tests — provably
  unreachable since P5's import cycle guarantees evaluation order); (c) move
  the E2E/UAT harness off page-global access (`window.Tiles`/`Prefs`/`Grid`/…
  reached via page-context evaluation) — drive test setup through messages/UI
  instead. Also sweep the remaining dead-true `typeof Prefs/Grid` guards in
  newTab.js when (b) lands.

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
  `lib/platform.js` accessors. Retires when the page goes modular (see backlog /
  `PAGE_MODULES.md`).
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
  [`MODERNIZATION.md`](MODERNIZATION.md) Stage M (2026-07-09), followed by the
  HTML5 page conversion in Stage H.
- **Chrome via single-source / dual-build, not parallel branches** — long-lived branches
  carry permanent merge cost.
- **AMO: new listing / ID `newtabtools@symlink.ch`, not ID-transfer** — clean state
  over inheriting every existing user's (possibly stale or tampered) IndexedDB + prefs.
- **Security review absorbed into the normal workflow** (2026-05-04). All 7 findings
  from the pre-takeover review are fixed; AI-contribution supply-chain guardrails live
  in `CONTRIBUTING.md`. See `audit/2026-05-04-security-review.md` for the original.
