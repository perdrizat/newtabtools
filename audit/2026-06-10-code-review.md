# Code Review & Assessment — Pre/Post-AMO Polish Pass

**Date:** 2026-06-10
**Scope:** Full production codebase (`webextension/*.js`), test suite (unit/integration/E2E/UAT), security boundaries, coding standards, MV3 readiness.
**Reviewer context:** Periodic deep review after the run-up to AMO submission (2.0.0) and the i18n/translations follow-up (2.0.1). Many changes since the [2026-05-11 review](2026-05-11-code-review.md): NTT v2 redesign (Phases 0–5), config drawer, awesome bar, favicon pipeline, status-bar removal, UAT tier, pnpm migration, i18n tooling.
**Mode:** Deep-dive static review with three parallel passes (security, test completeness, coding standards), then per-claim source verification. Fast tests executed (**1013 pass, 0 fail, 4.8s**). Typecheck clean. Lint: 4 warnings (stale directives, see §4.2). E2E/UAT not executed (require Firefox ESR GUI).

---

## 1. Verdict

The codebase is in good shape and the security hardening from prior audits has **held, not regressed** — I re-verified every boundary the 2026-05-04 / 2026-05-31 reviews touched. There are **no security blockers** to an AMO release. The findings below are correctness polish, a resource leak, a handful of worthwhile test gaps, and maintainability debt (most of which belongs to the deferred MV3 migration).

Three one-line correctness items (§4.1, §4.2) are worth fixing before the next release tag — together they close a silent-error hole and take the build to zero warnings. Everything else is opportunistic.

> **Reviewer correction (see §9):** the dev response in §8 is upheld on all five disputes. Two findings (§5.1, §5.5-restore) were **false-negative absence claims** and are withdrawn/downgraded; §4.1's "silent-error hole" framing here is wrong — it's a deprecated-API **nit**. Read §1 through the §9 corrections.

---

## 2. What's strong

### 2.1 Security boundaries intact

Every defense from the prior audits is still correctly in place — this is the most important finding of the review, given how much changed:

- **CSP** ([`manifest.json:64`](../webextension/manifest.json)): `connect-src` is `'self'` + the single named Mozilla settings host — no `https:` wildcard. The `img-src https:` wildcard remains as the documented favicon paint-channel tradeoff ([2026-05-31-csp-tightening.md](2026-05-31-csp-tightening.md)). The `manifest.test.ts` guard against a `connect-src` wildcard regression is present and has teeth.
- **Restore boundary** ([`export.js`](../webextension/export.js)): allow-list intact; `safeProtocols`, `safeHexColor`, and the CDN-only `safeBackgroundUrl` regex all validate at the restore boundary. Restore is atomic (parse-all-before-write, surfaces import errors).
- **Message handlers** ([`background.js:97`](../webextension/background.js)): `sender.id !== browser.runtime.id` gate drops anything not from the extension's own pages.
- **URL validation**: `isValidURL` (3-scheme allow-list) gates tile hrefs, recently-closed tab URLs, awesomebar results (before `tabs.create`/`tabs.update`), and favicon URLs.
- **No `eval` / `new Function` / external scripts.** The single `innerHTML` use ([`fx-newTab.js:431`](../webextension/fx-newTab.js)) is `= ''` on an empty node — not a sink.

No critical/high/medium security findings.

### 2.2 Test infrastructure

1013 fast tests in under 5s, no `.skip`/`.todo` debt. The **security-critical paths are tested behaviorally** — verified by reading the bodies, not the headers: malicious `backgroundColor` (`tile-redesign.test.ts` constructs a real tile via `mountSite` and asserts the payload never reaches `--ntt-brand`), backup/restore validation (`backup-restore.test.ts`, via `vm.runInContext` with assertions on stored values), awesome-bar XSS (`awesomebar-dom.test.ts`, real jsdom `textContent` checks), reset clearing IDB (`reset-and-autosave.test.ts`). The stuff that would hurt users is real coverage.

**Caveat — the behavioral discipline is not uniform.** A meaningful slice of the integration tier asserts on *source strings* (`expect(fs.readFileSync(...)).toContain(...)`) rather than exercising the code. See §5.5 — this is a real depth gap, and it means the headline test count overstates behavioral coverage.

### 2.3 Structure

Clear module boundaries with `/* exported */` / `/* globals */` headers, no global-namespace pollution, consistent naming (PascalCase singletons / camelCase methods / `_private`), `let`/`const` over `var`. `fx-newTab.js` carries disciplined JSDoc (122 blocks). The favicon capture pipeline and the awesome-bar result model (`buildResults`/`nextIndex` as pure, unit-tested functions) are good examples of testable design.

---

## 3. Findings — corrected severities

One item from the automated standards pass was **overstated** and is recorded here so it doesn't cause alarm:

- **[`tiles.js:200-203`](../webextension/tiles.js) (`Background.getBackground`)** — flagged as "high / unreachable code":
  ```js
  if (this.result[0]) { resolve(this.result[0]); }
  resolve(null);
  ```
  **Not a bug.** Promise resolve-once semantics: the first `resolve` wins when `result[0]` is truthy; the second is ignored. When falsy, `resolve(null)` runs. Behaves correctly. It's a readability nit (should be `else`), severity **nit**, not a release gate.

---

## 4. Findings — real

### 4.1 Correctness (fix before next release)

> **Superseded — severity corrected to nit (§8.3/§9.3).** The "silently lost" mechanism below is wrong: Firefox aliases `console.exception` → `console.error`, and `.catch(undefined)` surfaces as *Uncaught (in promise)* rather than swallowing. The one-word fix stands.

**`console.exception` is non-standard** — [`fx-newTab.js:2162`](../webextension/fx-newTab.js): `.then(callback).catch(console.exception)`. `console.exception` is not a standard method; where it resolves to `undefined`, `.catch(undefined)` is a no-op and the rejection becomes unhandled. This is the catch on `_fillEmptyCells`'s thumbnail fetch — so a thumbnail-load failure is silently lost rather than logged. **Fix:** `console.error`. Every other catch in the codebase already uses it. *(Severity: low — observability hole, not a crash.)*

### 4.2 Build hygiene (fix before next release)

**Stale `eslint-disable` directives** — the only 4 lint warnings, all "Unused eslint-disable directive":
- [`tests/unit/i18n.test.ts:6`](../tests/unit/i18n.test.ts) and `:12`
- [`tests/integration/sync-version.test.ts:22`](../tests/integration/sync-version.test.ts) and `:39`

Line 6 in `i18n.test.ts` sits above a `path.dirname` call, not a `readFileSync`, so the directive never applied. Delete the four comments; `pnpm lint` goes fully clean. *(Severity: nit.)*

### 4.3 Resource leak (low–medium)

> **Severity corrected to low and repackaged (§8.4/§9.4):** real finding, but TDD + E2E-gated work, not a pre-tag batch item; blob URLs free on document unload, so accumulation is per-document-bounded.

**`URL.createObjectURL` without `revokeObjectURL` in `newTab.js`** — 6 create sites, zero revokes: [`newTab.js`](../webextension/newTab.js) lines 266, 525, 578, 1310, 1467, 1963. Contrast [`fx-newTab.js:1019/1090`](../webextension/fx-newTab.js), which correctly revokes the prior URL before creating a new one (the Phase-0/1 fix pattern). The repeated-render sites matter most:
- `:1310` — favicon, re-run on every recently-closed / autocomplete refresh
- `:1963` — thumbnail CSS background
- `:1467` — thumbnail on selection

The new tab page is long-lived and re-renders often, so these accumulate over a session. **Fix:** mirror the `fx-newTab.js` pattern — stash the URL on the instance and revoke before reassigning. *(Severity: low–medium.)*

### 4.4 Unhandled `Promise.all` chains (low)

No `.catch` on: [`background.js:608`](../webextension/background.js) (favicon-fetch chain — silently abandons a capture session on rejection), [`fx-newTab.js:215`](../webextension/fx-newTab.js), [`awesomebar.js:218`](../webextension/awesomebar.js). Lower stakes than §4.1 (these reject to the console rather than no-op), but the background.js one is worth a handler. *(Severity: low.)*

### 4.5 Leftover comments (nit)

- Two commented-out `console.log`s: [`background.js:43,53`](../webextension/background.js).
- Duplicated `// TODO: This is a silly name` on `getAllTiles`: [`tiles.js:52`](../webextension/tiles.js), [`tiles-shim.js:12`](../webextension/tiles-shim.js).
  > **Decision (2026-06-22) — not a standalone task; removed from the loose backlog.** `getAllTiles` is misleadingly named (it returns the grid-fit subset, `rows×columns`, not all tiles). Rename it during **MV3 Phase 1's `tiles.js` ES-module extraction**, when its export surface is being redefined anyway — doing a 51-ref/IPC-string/39-test rename standalone now is pure churn on a file MV3 will restructure. Or simply drop it (cosmetic). The in-code TODOs were reworded to NOTEs so they stop reading as open tasks.

---

## 5. Test completeness

Coverage is strong and behavioral. Worthwhile gaps, in priority order:

1. **`background.js` network-idle state machine** (`armNetworkIdle`/`resetNetworkIdleTimer`, ~lines 289–329) — **no test.** A timer-driven state machine that gates screenshot capture; if it silently stops firing, auto-thumbnails break with nothing to catch it. Testable with `vi.useFakeTimers`. **Highest-value gap.** **[WITHDRAWN — see §9.1: this exact test exists in `auto-thumbnail.test.ts` (fake timers, direct `armNetworkIdle` calls, races, cleanup).]**
2. **`stats.js` edge cases** — `formatCount`/`formatAge` are pure and trivially unit-testable but only covered indirectly. Missing: 0 visits, very large counts, clock-skew negative ms.
3. **`action.js`** (toolbar-popup pin/capture entry point) — no E2E; the primary "pin current tab" path from the Firefox toolbar is exercised only through mocks. **[Narrowed to low — see §9.6/§10: the `Tiles.pinTile` message is covered; the untested part is the popup's button→message glue, and the realistic tier for it is integration, not E2E.]**
4. **Flaky-by-design selectors** — several E2E tests query `document.querySelector('.newtab-site')` against the live DOM (e.g. [`css-grid-layout.test.ts:194`](../tests/e2e/css-grid-layout.test.ts)). They pass because `resetTestState` makes runs hermetic, but they assume a tile is rendered — the same pattern that broke CI earlier in the project. Convert to a `<template>` query or `Grid.sites` lookup. *(Low risk while test order holds.)*
   > **Decision (2026-06-22) — permanently declined.** A sweep found ~25 `.newtab-site`/`.newtab-cell` selectors, but most are legitimate cell *counts*, geometry, or `[pinned]`/`[data-selected]` state checks — not identity-flaky; only a few "first tile I created" sites qualify. With `resetTestState` keeping runs hermetic the risk is latent, and a correct conversion needs per-site triage + a new `Grid.sites` helper + an E2E re-run per change. Not worth the churn/risk for the current payoff; revisit only if order-dependent flakiness actually recurs.

None block AMO. The network-idle test covers a real silent-failure mode and is the one to write soon.

### 5.5 Test depth — the source-string layer (correction to an earlier overstatement)

A first automated pass reported the suite as "fully behavioral, no lazy source-greps." Reading the test *bodies* contradicts that. The `ntt/no-source-grep` lint rule only catches `fs.readFileSync` on `webextension/` files without a justification comment — it does **not** catch a justified `readFileSync` whose assertions are `toContain`/`toMatch` on source text. So the rule reports green while the test proves only that a string exists in a file.

Measured across the integration tier (57 files):

- **14 files are pure source-string** — they read a `webextension/` source/asset and assert on its text with **zero** behavioral exercise (no `mountSite`, no `vm` load, no DOM construction): `about-section`, **`advanced-tab`**, `backup-restore-refresh`, `branding`, `css-grid`, `drag-invariants`, `drawer-font-consistency`, `drawer-hidden-css`, `logo-fallback-opacity`, `sync-version`, `tile-aspect`, `titlebar-layout`, `tokens`, `typography`.
- These split three ways:
  - **Defensible** (CSS-token / typography / version-sync / layout-rule presence): jsdom can't resolve the stylesheet cascade, so "the CSS file defines `--ntt-radius`" is a reasonable structural guard — *provided* a visual claim that matters has an E2E/UAT counterpart.
  - **Redundant**: `tile-redesign.test.ts` carries ~40 source-string assertions (e.g. `expect(fxSource).toContain('_renderActions')`) sitting on top of a genuinely good behavioral suite (lines 265–345). The string layer was left in when the behavioral tests were added, not replaced — it's noise that breaks on harmless refactors.
  - **False confidence** (the real problem): [`advanced-tab.test.ts`](../tests/integration/advanced-tab.test.ts) — **51 string assertions, 0 behavioral.** Its own docstring promises that destructive actions (Reset, Restore) "gate behind an inline Confirm/Cancel — no `window.confirm`." The tests assert only that the markup carries `class="ntt-btn-danger"` and that the CSS styles that class. **Nothing verifies the confirm gate actually fires on click.** A string-match passes whether or not the safety behavior is wired. This is the exact superficial-vs-functional gap to close. *(Severity: medium — a safety-critical UX behavior is described as tested but isn't.)* **[DOWNGRADED to low, retraction in §9.2: the Restore gate is fully E2E-tested on click (`backup-restore.test.ts`); the residue is Reset's click→reveal only.]**

The two failure modes these create, both live in this codebase: (1) a selector typo or an overridden CSS rule passes a `toMatch` while the rendered result is broken — only an E2E `getComputedStyle` catches it; (2) a behavior named in the test's own description goes unverified (the confirm gate).

**Fix — triage, not a crusade:** add a behavioral test for the advanced-tab confirm-gate (copy the `reset-and-autosave.test.ts` pattern: load handler via `vm`, dispatch click, assert), delete the redundant string layer in `tile-redesign.test.ts`, and leave the defensible Tier-1 files alone — but ensure each visually-meaningful CSS claim has an E2E/UAT counterpart (the UAT tier is the right home for "the pin stripe is actually visible").

### 5.6 Documentation gap — the rule exists but has a loophole (recommendation)

[`TESTING.md`](../TESTING.md) "Test Design Principles" already states *tests assert behavior, not source contents* and the "What NOT to do" list bars "assert on … DOM strings as a substitute for behaviour." The principle is right; what's missing is the **boundary**: the "source-grep is acceptable for purely structural checks" exemption is being stretched to cover functional behaviors (the advanced-tab confirm gate).

**Recommended** (a maintainer call — not changed by this review): add one clause to that exemption — a source-string match may **never be the sole coverage for a functional behavior** — and require the `ntt/no-source-grep` justification comment to state *why a behavioral test isn't possible*, not just *what* is being checked. A one-line pointer in [`CONTRIBUTING.md`](../CONTRIBUTING.md) "Before Committing" would carry it to the commit-time gate. Left to the maintainer to adopt and word.

---

## 6. Coding standards & MV3 debt

- **JSDoc is uneven.** `fx-newTab.js` is well-annotated; the 2200-line `newTabTools` controller in `newTab.js`, plus `export.js` (`makeZip`/`readZip`) and `stats.js` (`compute`), have almost none. `checkJs:true` still type-checks them, but the public surface of the largest file is undocumented. Backfill signatures on exported methods incrementally.
  > **Decision (2026-06-22) — not a scheduled standalone item; removed from the loose backlog.** Handle "type-as-you-touch" (annotate a method when you edit it), and JSDoc the specific `newTab.js` areas MV3 modifies **just-in-time during the migration** (typed code is safer to refactor; the JS+JSDoc choice persists through MV3, so it's not throwaway). A blanket pre-MV3 pass on 2,258 lines isn't worth blocking shipping; a dedicated bundle would just bloat the migration.
- **MV3 migration debt** (deferred per `MV3_MIGRATION.md`, logged here for the specific spots):
  - `background.js` uses DOM APIs — `Image`, `canvas`, `document.createElement` in `resizeThumbnail`/`isBlank` ([`:335-468`](../webextension/background.js)). MV3 service workers have no DOM; these are migration-blockers.
  - Persistent-background state held as module globals (`db`, `captureSessions`, `networkIdleWatchers`) assumes a page that stays alive; under MV3 it must be persisted/reconstructed on wake.
  - `chrome.extension.getViews` ([`export.js:46`](../webextension/export.js), `background.js`) has no MV3 equivalent.
- **chrome.* / browser.* split** — ~75 chrome callbacks vs ~28 browser promises. Coherent in logic (callback APIs stay `chrome.*`, promise APIs use `browser.*`) but two mental models that complicate the MV3 promise migration. Not worth churning now.

---

## 7. Recommended order

> **SUPERSEDED — do not execute this list as written.** The agreed order is **§8.7** (adjudicated in §9). Notably, §4.3 (`revokeObjectURL`) moved out of the pre-tag batch into TDD + E2E-gated work, and §5.1 below is withdrawn.

**Before the next release tag (~30 min):**
1. §4.1 — `console.exception` → `console.error`.
2. §4.2 — delete the 4 stale `eslint-disable` directives (build → 0 warnings).
3. §4.3 — add `revokeObjectURL` to the `newTab.js` create sites (mirror `fx-newTab.js`).

**Opportunistically after:**
- §5.5 behavioral test for the advanced-tab Reset/Restore confirm gate (medium — closes a "described but untested" safety behavior); then delete the redundant source-string layer in `tile-redesign.test.ts`.
- §5.1 network-idle timer test (real silent-failure coverage).
- §5.2 `stats.js` edge-case unit tests.
- §6 JSDoc backfill on `newTab.js` public methods.
- §4.4 / §4.5 / §3 cleanups.

**Documentation (recommended — maintainer's call, not changed by this review):**
- §5.6 — tighten [`TESTING.md`](../TESTING.md) "Test Design Principles" (source-string may never be the sole coverage for a functional behavior; justification comment must say why a behavioral test isn't possible) + a pointer line in [`CONTRIBUTING.md`](../CONTRIBUTING.md) "Before Committing".

**Defer to MV3 migration:** §6 DOM-in-background, persistent-state, chrome/browser unification.

---

## 8. Dev response (2026-06-10)

Thanks for the review — the security re-verification (§2.1) and the §3 self-correction are exactly what we want from this pass, and we accept most findings as written: §4.2 (stale directives), §4.3's leak census (independently re-verified: 6 `createObjectURL`, 0 `revokeObjectURL` in `newTab.js`), §4.4, §4.5, §5.5's redundant-string-layer point on `tile-redesign.test.ts`, §5.6's TESTING.md tightening, and the §6 MV3 deferrals.

We dispute five findings/recommendations. Each was re-verified against source before writing this; the two most severe are *absence* claims that a cross-tier symbol search disproves.

### 8.1 DISPUTED — §5.1 network-idle "no test / highest-value gap" (severity of the error: high)

The prescribed test already exists. [`tests/integration/auto-thumbnail.test.ts`](../tests/integration/auto-thumbnail.test.ts) behaviorally exercises the network-idle state machine with `vi.useFakeTimers`, including direct calls to `armNetworkIdle`:

- *"network idle fires after 2s of no network activity"* (`:503`) — calls `armNetworkIdle(99, callback)` directly
- *"webRequest resets the idle timer"* (`:516`) — the `resetNetworkIdleTimer` path
- the races: *"C via network idle fires before hard deadline when network settles"* (`:408`), *"network idle after 2s skips C, finalizes with A+B+C from hard deadline"* (`:422`)
- cleanup: *"onRemoved cleans up captureSessions, pendingCaptures, and network idle"* (`:489`)

That is the silent-failure mode §5.1 describes, covered — fake timers and all. Acting on the report as written would produce a duplicate suite. **Request:** withdraw §5.1, and re-verify §5.3 (`action.js` "no E2E") with the same symbol-grep bar before we act on it, since it is the same claim shape.

### 8.2 DISPUTED — §5.5 confirm gate "nothing verifies it fires on click" (medium → low)

The per-file arithmetic on `advanced-tab.test.ts` is correct (it is string-based), but the conclusion assesses coverage at single-file granularity in a deliberately tiered suite:

- **Restore gate — fully verified end-to-end in real Firefox.** [`tests/e2e/backup-restore.test.ts:196-208`](../tests/e2e/backup-restore.test.ts) clicks `#options-restore`, **waits for `#options-restore-confirm-row` to become visible** (named failure: *"restore confirm row did not appear"*), clicks `#options-restore-confirm`, then asserts the restore executes (tiles appear in `Grid.sites`). That is literally "the confirm gate fires on click," tested.
- **Reset gate** — [`reset-and-autosave.test.ts:86-92`](../tests/integration/reset-and-autosave.test.ts) behaviorally proves `window.confirm` is *not* used (the §7-redesign regression the docstring describes) and exercises the post-confirm handler; the click→reveal chain is covered in UAT scenario [`22-advanced-tab`](../tests/uat/scenarios/22-advanced-tab.md) ("… + confirm steps").

§5.5 itself states the correct standard one paragraph earlier — string checks are defensible *"provided a … claim that matters has an E2E/UAT counterpart"* — but doesn't apply that cross-tier rule to the confirm gate. The genuine residue is one gap: **Reset's click→reveal has no deterministic test** (UAT only). We accept that as a **low** finding and will add the one test. **Request:** restate §5.5's medium as that low, and drop "a safety-critical UX behavior is described as tested but isn't."

### 8.3 DISPUTED — §4.1 `console.exception` as a "silent-error hole" (low → nit)

The mechanism is wrong on both branches. (1) This is a Firefox-only extension, and Firefox implements `console.exception` as a deprecated alias of `console.error` — today the catch logs fine. (2) Even on a runtime where it resolved to `undefined`, `.catch(undefined)` does not swallow the rejection: per spec the rejection passes through and the browser reports it as *Uncaught (in promise)* in the console. Either way, nothing is "silently lost." We'll still make the one-word fix (deprecated, non-standard API; forward-compat per [`MV3_MIGRATION.md`](../MV3_MIGRATION.md)) — but it is a **nit**, and §1's "closes a silent-error hole" framing should be softened accordingly.

### 8.4 DISPUTED — §7's packaging of §4.3 into the "~30 min before next tag" batch

The leak is real; the risk framing isn't. Adding `revokeObjectURL` touches six sites including render-critical paths (favicon `:1310`, thumbnail CSS background `:1963`, selection thumbnail `:1467`), and *premature* revocation is a known breakage class (revoke a blob URL still referenced by a CSS background and it cannot repaint). Under this project's rules that is TDD + E2E-gated work, not a pre-tag cleanup batched with comment deletions. Two smaller corrections: blob URLs are freed when the page instance goes away, so accumulation is bounded per tab ("long-lived" overstates it), and severity is **low**, not low–medium. **Request:** move §4.3 from the pre-tag list to the opportunistic list, gated on `pnpm test:e2e`.

### 8.5 DISPUTED (minor) — §5.4 "convert to a `<template>` query"

Half the suggestion is right (`Grid.sites` lookup). But for [`css-grid-layout.test.ts`](../tests/e2e/css-grid-layout.test.ts) a `<template>` query is the wrong tool: those tests assert **rendered layout geometry** (bounding rects), and template content is inert — it has no layout to measure. The fix there is "establish the tile (pin one in `beforeAll`), then measure the live node," not "query the template."

### 8.6 Methodological note for the next pass

The two high-severity errors (8.1, 8.2) share one root cause: **absence claims made without a cross-tier symbol search**. The review's own methodology for *presence* claims was sound (§2.2: "verified by reading the bodies, not the headers"). We'd ask that the same bar apply to absence claims: a "no test exists" finding requires `grep -r <symbol>` across `tests/unit`, `tests/integration`, `tests/e2e`, **and** `tests/uat/scenarios` before it lands in a report — single-file or single-tier inspection is not sufficient evidence of a gap.

### 8.7 Action items we accept (revised order)

1. §4.2 — delete the 4 stale `eslint-disable` directives.
2. §4.1 — `console.exception` → `console.error` (as a nit, with §8.3's rationale).
3. §8.2 residue — one deterministic test for Reset's click→confirm-reveal.
4. §4.3 — `revokeObjectURL` on the six `newTab.js` sites, TDD + E2E-gated (not pre-tag).
5. §5.2, §5.5 (tile-redesign string-layer deletion), §4.4, §4.5, §6 JSDoc — opportunistic, as proposed.
6. §5.6 — TESTING.md/CONTRIBUTING.md wording: accepted, we'll draft it.

---

## 9. Reviewer response to §8 (2026-06-10)

I re-verified all five disputes against source. **The dev team is right on every one.** Adjudication below; the revised action list in §8.7 stands as the source of truth.

**§9.1 — §5.1 network-idle: WITHDRAWN.** Confirmed false negative. [`tests/integration/auto-thumbnail.test.ts`](../tests/integration/auto-thumbnail.test.ts) calls `armNetworkIdle` directly under `vi.useFakeTimers` (`:504`, `:517`, `:535`), and covers idle-fires-after-2s (`:503`), webRequest-resets-timer (`:516`), disarm-cancels (`:534`), the C-vs-hard-deadline races (`:408`, `:422`), and session cleanup (`:489`). My "highest-value gap" was the report's worst error — I propagated an automated-pass "NO TEST" note into a headline finding without the cross-tier grep. Withdrawn entirely.

**§9.2 — §5.5 confirm gate: DOWNGRADED medium → low, "described as tested but isn't" RETRACTED.** The restore gate *is* tested on click, end-to-end: [`tests/e2e/backup-restore.test.ts`](../tests/e2e/backup-restore.test.ts) clicks `#options-restore`, waits for `#options-restore-confirm-row` to un-hide (named failure "restore confirm row did not appear", `:203`), clicks `#options-restore-confirm` (`:206`), asserts the restore runs. The per-file arithmetic on `advanced-tab.test.ts` was right but the coverage verdict applied single-file granularity to a deliberately tiered suite — and ignored my own stated standard one paragraph earlier ("provided a claim that matters has an E2E/UAT counterpart"). Genuine residue: Reset's click→reveal is UAT-only; accepted as a **low** finding (one deterministic test), per §8.7.3.

**§9.3 — §4.1 console.exception: severity corrected to NIT.** Both branches of my "silently lost" mechanism are wrong. Firefox implements `console.exception` as a deprecated alias of `console.error`, so it logs today; and on a runtime where it were `undefined`, `.catch(undefined)` does not swallow — the rejection propagates and is reported as *Uncaught (in promise)*. Not silent either way. The one-word fix is still worth making (deprecated/non-standard, forward-compat), but as a nit. §1's "silent-error hole" framing is retracted (see the correction banner under §1).

**§9.4 — §4.3 packaging: AGREED.** Adding `revokeObjectURL` to six sites including render-critical CSS-background paths (`:1310`, `:1963`, `:1467`) is a premature-revocation footgun (revoke a blob URL still referenced by a `background-image` and it can't repaint) — that's TDD + E2E-gated work, not a pre-tag batch with comment deletions. Moved to opportunistic, E2E-gated. Severity **low** (blob URLs free on document unload, so accumulation is per-document-bounded — my "over a session" was loose). The finding itself stands; only its packaging and severity were wrong.

**§9.5 — §5.4 template suggestion: PARTIALLY RETRACTED.** `Grid.sites` lookup is the right fix; the `<template>`-query alternative is wrong for [`css-grid-layout.test.ts`](../tests/e2e/css-grid-layout.test.ts) specifically, because those tests measure rendered geometry (bounding rects) and template content is inert. Correct fix there: pin a tile in `beforeAll`, measure the live node.

**§9.6 — methodology (§8.6): ACCEPTED, and it's the real lesson of this pass.** Two false negatives (§9.1, §9.2) share one root cause: absence claims made from single-tier inspection. The report held presence claims to "read the bodies, not the headers" (§2.2) but didn't hold *absence* claims to the same bar. Adopted as a standing rule for future reviews: **a "no test exists" finding requires a symbol grep across `tests/unit`, `tests/integration`, `tests/e2e`, and `tests/uat/scenarios` before it lands.** Applying that bar to the one finding the dev team asked me to re-check (§5.3 `action.js`): the popup's own button→message glue is genuinely untested, but the `Tiles.pinTile` message it sends is covered (`background-messages.test.ts`, `tiles-pin.test.ts`) — so §5.3 holds as a **low** finding (thin untested glue), not the broad gap the original wording implied.

Net: of the report's findings, two absence claims fall (§5.1 withdrawn, §5.5 downgraded), two severities correct down (§4.1→nit, §4.3→low + repackaged), one suggestion half-retracted (§5.4). The security re-verification (§2.1), the §3 self-correction, and the §4.2/§4.4/§4.5/§5.2/§5.6/§6 findings stand as written. Good catch by the dev team — the disputes were evidence-backed and correct.

---

## 10. Dev response to §9 (2026-06-10) — closing

All adjudications accepted; no open disagreements remain. One correction on the §9.6 re-check of §5.3, then the queue is executed:

**§10.1 — §5.3 accepted as narrowed (low), but the prescribed tier must change.** The original §5.3 prescribed E2E for the popup glue. That is not achievable in this harness: a browser-action popup is browser chrome, not a content page — Puppeteer-over-BiDi cannot open or attach to it (this is presumably *why* the gap exists). The realistic remedy is an **integration test** of `action.js`'s button→`sendMessage` wiring (the `loadModule`/vm pattern), same shape as the §8.7.3 Reset test. Executed as such below.

**§10.2 — §8.7 execution record (this commit):**
1. §4.2 — the 4 stale `eslint-disable` directives deleted; `pnpm lint` fully clean. ✓
2. §4.1 — `console.exception` → `console.error` (nit, per §9.3). ✓
3. §8.7.3 — deterministic characterization test added: Reset click → confirm row reveals, action only fires on Confirm (and Cancel re-hides without acting). ✓
4. §10.1 — integration test added for `action.js` button→message glue. ✓
5. §8.7.4 — `revokeObjectURL` added to the `newTab.js` create sites (revoke-prior-on-replace, mirroring `fx-newTab.js`), guarded by behavioral tests, E2E-gated. ✓
6. §5.6 — TESTING.md exemption tightened + CONTRIBUTING.md pointer. ✓

Remaining opportunistic items (not this commit): §5.2 `stats.js` edge cases, §5.5 tile-redesign string-layer deletion, §4.4 `Promise.all` catches, §4.5 comment cleanup, §6 JSDoc backfill.
