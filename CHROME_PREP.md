# Chrome-Prep Program — Capability Seams, Typed Monoliths, Feature Modules

**Status: IN PROGRESS** (authored 2026-07-10, maintainer-approved same day).
Ships as **2.5.0** when complete (maintainer decision: the full program precedes
the 3.0.0 AMO release; 3.0.0 stays reserved for AMO after this program and its
follow-up audit round). Successor to the page-modules arc (`PAGE_MODULES.md`,
2.4.0). Origin: an auditor-volunteered phase plan, adjudicated 2026-07-10 —
adopted with corrections recorded per-arc below (stale items dropped, one
security-boundary trap excluded, one scope reduction, harness design decided
by maintainer).

**The maintainer's two binding directives (2026-07-10):**
1. **Principled harness design for the typing arc (C3):** the E2E/UAT harness
   moves to REAL UI/gesture driving — no `__ntt_test` handle, no test hook in
   production code. Consequence accepted explicitly: the drag E2E test may be
   flaky for a while (synthesized DnD in headless Firefox). The payoff: every
   `globalThis` bridge assignment in the repo can then be deleted — including
   the dual-scope survivors in common.js/prefs.js — ending the program with
   ZERO bridge assignments.
2. **Real JSDoc for the monoliths:** quality typedefs and precise shapes, not
   `any`-cast escape hatches. Budgeted as a big effort, deliberately.

## Status board (live)

| Arc | Status | Commit(s) |
|---|---|---|
| C0 — design decisions of record (menus, theme) | done | `c7ebfcc` |
| C1 — background DOM-guard (no DOM outside thumbnail-image.js) | done | `c3cab0a` |
| C2 — leaf utilities: `el()` builder + textContent normalization + color helper | fast-green, gates pending | — |
| C3 — type the monoliths + principled harness + retire ALL bridges | pending | — |
| C4 — split the monoliths into feature modules | pending | — |
| C5 — capability-seam completion (divergence audit, targeted wrappers) | pending | — |
| C6 — two-target manifest authoring | pending | — |
| C gate — full suite + full UAT + audit + 2.5.0 | pending | — |

## Decisions of record

### 1. Chrome context menus: the in-tile action row IS the Chrome interaction (C0)

Firefox's per-tile dynamic context menu depends on `menus.onShown` +
`menus.getTargetElement` (`lib/background-main.js:288`) — Chrome's
`contextMenus` API has neither. **Decided:** Chrome ships WITHOUT dynamic
context menus. The in-tile action row (edit / never-capture / pin / remove)
already carries the identical operations on every tile; Firefox's context menu
is progressive enhancement, not a portability requirement. The seam's menu
capability is therefore optional-by-design: registered when the platform
provides `menus.onShown`, absent otherwise, and no page/background logic may
assume it exists. **Rejected:** a degraded static Chrome menu (two UX surfaces
to keep in sync for zero added capability).

### 2. Chrome theme: `prefers-color-scheme` is the source; `browser.theme` is a Firefox bonus (C0)

`browser.theme` is Firefox-only (used in newTab.js). The existing `system`
theme mode already runs on `prefers-color-scheme`. **Decided:** "theme source"
becomes a capability: base = system `prefers-color-scheme` (both platforms);
Firefox layers `browser.theme` detection on top. No code may assume
`browser.theme` exists.

### 3. The restore validators stay OUT of the shared-leaf extraction (C2)

The auditor's phase list swept "the safe* validators" into the leaf-utilities
extraction. **Rejected for `lib/backup.js`:** `safeHexColor`/
`safeBackgroundUrl` (and the `safeProtocols` allow-list) are the restore
security boundary, with a standing decision of record that its validation
stays independent (deliberate defence-in-depth duplication; any change is a
documented security-boundary event per CONTRIBUTING). C2 extracts page-side
helpers only (`siteBrandColor` etc.); the restore chain is untouched.

### 4. C5 is a divergence audit + targeted wrappers, not blanket indirection

**Rejected:** "route ALL `browser.`/`chrome.` calls through wrappers." Chrome
MV3's `chrome.*` is promise-capable, so most call sites are portable with a
single `const api = globalThis.browser ?? chrome` in a leaf (in-house — the
webextension-polyfill runtime dep would violate the zero-runtime-dep policy).
**Chosen:** audit every `browser.`/`chrome.` site, wrap only the genuinely
divergent capabilities (menus, theme, search, captureTab/captureVisibleTab,
action, storage.session semantics), normalize the namespace once. Note
`lib/platform.js` is background-scoped — the page side gets its own small
capability leaf (page files cannot import `lib/`); the two seams stay
parallel, not shared (no new dual-scope file).

### 5. Order: guard → leaves → types → split → seam → manifests

The auditor's ordering logic (leaves before types before split before seam) is
adopted — split without types = refactoring 4.8k lines blind; seam before
split = threading wrappers through code about to dissolve. Two adjustments:
the C1 guard runs FIRST (cheapest, pure insurance, protects the already-carved
thumbnail seam while everything else churns), and C6 (manifest authoring) runs
LAST (pays off only at port time; a sibling script of `sync-version.mjs`, no
build step).

### 6. What was already done before this program (auditor text was stale)

"Phase 0" (land page-modules) and the core of "Phase 1" (getString/isValidURL
extraction + awesomebar `tilesSource` inversion) shipped in 2.4.0. C2 is the
Phase-1 remainder only.

## Arcs

Gates per arc: red/green fast tests, `pnpm lint`, `pnpm typecheck`,
`pnpm lint:webext`; E2E tiering per the PAGE_MODULES precedent (targeted for
narrow arcs C1/C2/C6, full for C3/C4/C5); UAT spot-runs at visually-risky
points, full UAT at the C gate. Commit per green arc; this file's board updates
per arc.

### C0 — design decisions (this file, ROADMAP)
- [x] Decisions 1–2 recorded here; ROADMAP "Next"/"Later — Chrome" sections
      updated to reference this program; AMO gating re-pointed at 2.5.0;
      absorbed backlog items re-pointed (el() → C2, bridge retirement → C3);
      no code.

### C1 — background DOM-guard
- [x] ESLint guard (project rule or `no-restricted-globals`/`no-restricted-
      properties` config): `document`/`window`/`Image`/canvas/DOM constructors
      forbidden in `webextension/lib/**` EXCEPT `lib/thumbnail-image.js` (the
      Chrome/OffscreenCanvas swap seam). Red-first: prove the rule fires on a
      violation, then that the tree is clean.
- [x] Audit pass over lib/** confirming no existing leak (report, don't assume).
- [x] Gates + targeted E2E: fast 1306/1306, lint/typecheck/lint:webext clean,
      smoke trio 6/6. Audit verdict: zero existing violations in lib/** —
      the thumbnail seam was already airtight; the guard is pure insurance.

### C2 — leaf utilities (Phase-1 remainder)
- [x] `el(tag, className, text?)` page DOM-builder leaf (`webextension/dom.js`
      + `tests/unit/dom.test.ts`) + normalize the `createElement` blocks
      (Stage-H review §8 backlog item). Real count: **37** `createElement`
      call sites across the three page files (`newTab.js` 18, `fx-newTab.js`
      12, `awesomebar.js` 7) — **26 normalizable** (create + optional
      className + optional textContent in immediate sequence) swept onto
      `el()` (`newTab.js` 12, `fx-newTab.js` 9, `awesomebar.js` 5); **11**
      left as hand-written `document.createElement` because the block is
      complex (canvas setup, conditional-branch thumbnails, attribute/event
      wiring, or a bare create with no immediate className/textContent to
      dedup) — force-fitting those would obscure rather than clarify.
      Mechanical, per-file sweep; behavior-identical (fast tier: 1315/1315,
      zero assertion changes — 4 vm-harness tests needed a one-line `globalThis.el`
      exposure, same pattern as their existing `isValidURL` exposure, because
      they extract page methods by source rather than importing them).
- [x] `siteBrandColor` (fx-newTab.js): confirmed exactly one production
      consumer (`fx-newTab.js:1090`, inside `_renderLogoFallback`) — left in
      place per the plan's anticipated outcome; not extracted.
- [x] Restore validators NOT touched (Decision 3) — `lib/backup.js` untouched
      by this arc.
- [x] Gates: fast 1315/1315, lint/typecheck/lint:webext clean; targeted E2E
      46/46 (smoke trio + tile-redesign, recent-tabs, drawer, awesomebar —
      every rendering surface the sweep touched).

### C3 — type the monoliths + principled harness + bridge endgame
- [ ] Full-quality JSDoc for newTab.js + fx-newTab.js (typedefs for Site/link/
      grid-cell shapes, event payloads; no `any`-casts as escape hatches —
      maintainer directive 2). Monoliths enter the typed program; the
      computed-path "hide from tsc" import pattern retires.
- [ ] Retire `pageMessageHandler`'s dead early-broadcast queue (+ its M5-era
      tests) and the dead-true `typeof` guards (newTab.js 1216–1824 sweep) —
      provably unreachable since P5's import cycle.
- [ ] Harness migration (maintainer directive 1): E2E/UAT stop reading page
      globals — state seeding via runtime messages (most already are), UI
      assertions via DOM, drag via synthesized gestures (flakiness accepted
      for now; quarantine/retry policy documented in the test file). UAT
      daemon's `window.Prefs`/`window.Grid` uses move to UI driving.
- [ ] Delete EVERY `globalThis` bridge assignment (page files AND the
      dual-scope survivors in common.js/prefs.js); `page-module-scope.test.ts`
      flips its inventory to negative assertions; `globals.d.ts` shrinks to
      jest-webextension-mock's surface; `nttGlobals` dies from eslint config.
- [ ] Gates + FULL E2E + UAT spot-run (01/10/23/31 + 20–23).

### C4 — split the monoliths
- [ ] fx-newTab.js → grid, site, cell, drag-drop, transformation, updater,
      undo modules; newTab.js → drawer, wallpaper, theme, startup, message
      glue. Explicit import graphs; page-main.js stays the only boot site.
      Slice-per-module-group, commit per green slice (this arc gets its own
      slice table when it starts).
- [ ] Gates + FULL E2E per slice group + UAT spot-runs.

### C5 — capability-seam completion (Decision 4)
- [ ] Divergence audit: every `browser.`/`chrome.` site classified
      portable-as-is vs divergent (the audit artifact lands in `audit/`).
- [ ] Namespace normalization leaf (`const api = globalThis.browser ?? chrome`);
      divergent capabilities wrapped: background in `lib/platform.js`, page in
      a new page capability leaf. Menus/theme wrappers express Decisions 1–2.
- [ ] Gates + FULL E2E.

### C6 — two-target manifest authoring
- [ ] `manifest.base.json` + per-browser overlays merged by a
      `scripts/build-manifest.mjs` sibling of `sync-version.mjs`; emitted
      `manifest.json` per target; `pnpm build` grows a target arg. No bundler;
      source == shipped holds for both targets.
- [ ] Gates + targeted E2E (loads-cleanly + lifecycle).

### C gate
- [ ] Full `pnpm test`, full UAT, `pnpm audit --audit-level=high`,
      boot-timing re-check, 2.5.0 bump, CHANGELOG promotion, build, docs sweep
      (CONTRIBUTING/TESTING/README/ROADMAP + this file), follow-up code review
      round adjudicated.

## What the Chrome port then reduces to (unchanged from the audit)

Fork the seam implementations (namespace, search, theme-degrade, menus-absent),
write the OffscreenCanvas `thumbnail-image.js`, add the Chrome manifest
overlay. Bounded, reviewable, a handful of files.

## Risks

- **C3's gesture-driven drag E2E** — known-flaky class, accepted by directive;
  contain with bounded retries + a documented quarantine policy rather than
  reverting to page-global driving.
- **C3/C4 diff size** — the two largest arcs since MV3; slice discipline and
  per-slice reviews (the M/H/P precedent) are the containment.
- **JSDoc drift during C4** — typing lands in C3, then C4 moves the typed code;
  keep C4 slices mechanical (move, don't rewrite) so types travel unchanged.
- **AMO delay** — the whole program precedes 3.0.0 by maintainer decision;
  revisit if AMO urgency changes.
