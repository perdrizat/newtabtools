# Roadmap

Forward-looking direction and backlog for New Tab PowerTools. A living document —
prune entries as they ship or go stale.

- **What shipped** lives in git history and `CHANGELOG.md`, not here.
- **How it's built / tested** lives in `CONTRIBUTING.md`, `TESTING.md`, and
  `MV3_MIGRATION.md`.
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
- [ ] First submission to the AMO Developer Hub. ID/listing decision is settled: new
  listing under `newtabtools@symlink.ch`, v1.0.0 (not an ID-transfer). Listing copy,
  `PRIVACY.md`, `LICENSE`, and reviewer notes are in place.

## Next — Firefox MV3 (stage 2)

The major arc after shipping. Gated, not immediate. Full plan and contributor
directives in [`MV3_MIGRATION.md`](MV3_MIGRATION.md).

- **Gate to start:** full Unit + Integration suite green in CI on a clean clone; the
  minimum E2E suite green against Firefox ESR; at least one real bug fix shipped under
  the TDD flow; maintainer comfortable navigating `newTab.js` / `tiles.js` / the
  background scripts.
- **Calendar time-box:** re-decide by **2027-Q2** regardless of the substantive gate —
  Mozilla has signalled a multi-year MV2 wind-down, so indefinite deferral is a
  strategic risk. The time-box commits to *re-deciding*, not to acting.
- **Shape:** Firefox-first (MV3 event pages keep DOM access, halving scope vs. Chrome);
  no TypeScript / no build step; ES-module extraction of the background scripts.

## Later — Chrome extension (stage 3)

After Firefox MV3 ships and bakes. Single-source / dual-build (shared `webextension/`
with per-target manifest variants), **not** a long-lived parallel branch. Requires the
Chrome-only work deferred from MV3: `chrome.offscreen` for DOM, a polyfill, and routing
the Firefox-only APIs through a capability layer (`lib/platform.js`). The previous
maintainer's `chrome` branch is historical reference only — do not merge it.

---

## Backlog (unscheduled)

Concrete items not yet on a horizon. Roughly priority-ordered within each group.

**Tooling / debt**
- Extract pure logic from the legacy monolith scripts into `webextension/lib/` ES
  modules. Bundled with MV3 — MV2 script-mode files can't import ES modules, so doing
  it now would mean maintaining duplicate copies.

**UAT tier** (the tier itself is built — see `TESTING.md` and `tests/uat/README.md`)
- The suite walks a first-run journey on a seeded environment: `00-uat-init`,
  `01-default-ui` (incl. first-run thumbnail + favicon capture), `02-config`,
  `03-restore`, `04-action-buttons`. More scenarios for differentiating features
  that benefit from visual judgment: locked-grid, per-domain filter caps, per-tile
  background colour, backup export, multi-page grids.
- Aggregate run-level `summary.md` (table of scenarios × verdicts + a section
  highlighting preamble failures); today the runner writes a per-scenario summary +
  an aggregate `report.json` + a terminal digest.
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
  takeover means migrating without a safety net. Deferred behind the gate above.
- **Chrome via single-source / dual-build, not parallel branches** — long-lived branches
  carry permanent merge cost.
- **AMO: new listing / ID `newtabtools@symlink.ch`, not ID-transfer** — clean state
  over inheriting every existing user's (possibly stale or tampered) IndexedDB + prefs.
- **Security review absorbed into the normal workflow** (2026-05-04). All 7 findings
  from the pre-takeover review are fixed; AI-contribution supply-chain guardrails live
  in `CONTRIBUTING.md`. See `audit/2026-05-04-security-review.md` for the original.
