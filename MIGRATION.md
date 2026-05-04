# Migration: Cherry-pick + Reference Rewrite

The migration ledger for the codebase strategy chosen in [`ROADMAP.md`](ROADMAP.md). For the *why* and the rejected alternatives, see that doc; for the feature scope and the rationale per category, see [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md). This file is the working document — it tells you what's done, what's next, and what tests cover what.

## Strategy in one paragraph

Strangler-fig migration. The existing extension keeps running. One feature at a time, the legacy code path is replaced: write a characterization Integration test against today's behaviour, extract pure-logic helpers into `webextension/lib/<name>.js` with Unit tests, reimplement using the helpers, swap the wiring, delete the legacy code, confirm E2E green. No long-lived rewrite branch; every replacement ships incrementally on AMO.

Mozilla's Activity Stream (`browser/extensions/newtab/` in mozilla-central) is the **behavioural reference** for parity features — read it to learn what the user-visible behaviour should be, do not copy code. Activity Stream uses chrome-privileged APIs that ordinary WebExtensions cannot touch; the reference work is interpretive.

## Strategy column legend

- **Reimplement (AS reference)** — parity feature. Rebuild from scratch using Activity Stream as the behavioural spec. Drop the legacy implementation when the new one ships.
- **Port from NTT** — gap feature where the existing NTT implementation is salvageable. Move it to `webextension/lib/`, add tests around it, modernize the call sites.
- **Port + rewrite (capture)** — gap feature where part of the existing implementation is salvageable but a critical piece must be rebuilt for coverage or portability reasons. Used for auto-thumbnail (the `drawWindow` content-script captures simple pages but fails on ~50% in practice and is non-standard Firefox-only API; the cache and render layers are fine and worth porting).
- **Delete** — feature is leaving the codebase.

## Test status column legend

For each row, what *currently* exists in the test suite. Updated as tests land.

- **None** — no tests yet
- **Unit** — Unit test exists
- **Integration** — Integration test exists
- **E2E** — E2E test exists
- Combinations (e.g. **Unit + E2E**) — when applicable across tiers

## Differentiating features — full investment

| Feature | Current state | Strategy | Implementation refs (legacy) | Test status |
|---|---|---|---|---|
| **Auto-thumbnail of recently visited pages** | **partially working** — captures simple pages, fails on ~50% of pages (CSP, cross-origin restrictions, sites that block content-script execution, timing issues) | Port + rewrite (capture) — replace the `drawWindow` content-script with `browser.tabs.captureTab` triggered by `browser.webNavigation.onCompleted`; cache by URL in `browser.storage.local`. The non-standard `drawWindow` API is also a long-term liability — modernizing is both a coverage and a portability win. | `thumbnail.js` (line 14: `drawWindow` content-script), thumbnail wiring in `newTab.js` | None |
| **Arbitrarily large tiles** | working | Port from NTT — emergent property of the unconstrained-grid layout; preserve verbatim | grid layout in `newTab.js` / `newTab.css` | None |
| **Configurable columns and unconstrained grid** | working | Port from NTT | grid setup in `newTab.js` (rows × columns prefs, layout calculations) | None |
| **Layout micro-tuning** (opacity, title size, margin, spacing) | working | Port from NTT — settings logic; reimplement the settings UI cleanly | settings panel in `newTab.js` / `newTab.xhtml`; prefs in `prefs.js` | None |
| **Lock-grid toggle** | working | Port from NTT | drag-reorder gate in `newTab.js` | None |
| **Per-domain filter cap** with subdomain wildcards | working | Port from NTT — filter logic is self-contained pure-ish code, good extraction candidate | filter handling in `tiles.js` / `newTab.js` | None |
| **Per-tile background color** | working | Port from NTT — `parseColour` already extracted and tested | `webextension/lib/colour.js` (extracted); UI wiring in `newTab.js` | **Unit** (`tests/unit/lib/colour.test.js`) |
| **Recently-closed-tabs row** with one-click restore | working | Port from NTT — uses standard `chrome.sessions` API | `newTab.js` ~line 796 (`chrome.sessions.getRecentlyClosed`, `restore`, `onChanged`) | None |
| **Add-shortcut autocomplete** from open tabs / bookmarks / history | working (with optional permissions granted) | Reimplement (AS reference) — clean state management; rethink the optional-permission flow | `newTab.js` ~line 123, ~line 173 (`chrome.history.search`); permission prompt wiring | None |
| **Local backup/restore** (single-file zip) | working | Port from NTT — keep the zip pipeline; ensure no DOM-in-background dependencies that would block MV3 service-worker port later | `export.js`, `lib/zip.js` (vendored) | None |

## Parity (match) features — reimplement cleanly

| Feature | Current state | Strategy | Implementation refs (legacy) | Test status |
|---|---|---|---|---|
| Pin arbitrary URL | working | Reimplement (AS reference) — first slice candidate; already covered by E2E so the safety net exists | `tiles.js#pinTile` (line 159), `background.js` 'Tiles.pinTile' handler (line 130) | **E2E** (`tests/e2e/pin-persists.test.js`) |
| Per-tile custom uploaded image | working | Reimplement (AS reference) | tile image handling in `newTab.js` / `tiles.js` | None |
| Per-tile custom title | working | Reimplement (AS reference) | title editing in `newTab.js` | None |
| Drag-reorder tiles | working | Reimplement (AS reference) — drag-drop is finicky, characterize current behaviour carefully before swapping | drag handlers in `newTab.js` | None |
| Configurable rows | working | Reimplement (AS reference) — covered alongside "Configurable columns" above | shared with grid layout | None |
| Page background image | working | Reimplement (AS reference) | wallpaper handling in `newTab.js` / `prefs.js` | None |
| Light / dark / auto theme | working | Reimplement (AS reference) — isolate Firefox-only `browser.theme.*` calls behind `webextension/lib/platform.js` | `newTab.js` ~line 625, ~line 721 (`browser.theme.getCurrent`, `onUpdated`) | None |
| Hide history-derived tiles | working | Reimplement (AS reference) | filter integration in `tiles.js` / `newTab.js` | None |
| Localization (multi-language UI) | working | Port from NTT — `_locales/` moves over verbatim, no rewrite needed | `webextension/_locales/` | None |

## Drop features

| Feature | Current state | Strategy | Implementation refs (legacy) | Test status |
|---|---|---|---|---|
| Donation link to previous maintainer | already disabled (alert only) | Delete — once the fork has its own donation story (or none) | settings panel donation row in `newTab.js` / `newTab.xhtml` | None |
| In-app update notice ("New Tab Tools has been updated…") | working | Delete — strip the modal and its prefs (`versionLastUpdate`, `versionLastAck`); AMO handles update notifications | update modal in `newTab.js`; prefs in `prefs.js` | None |
| Beta channel link, "What Changed?" link to AMO version-history | beta link removed by previous maintainer; version-history link still present | Delete — re-evaluate after AMO publication path is decided | links in `newTab.xhtml` / `action.html` | None |
| Capture-and-save-current-thumbnail button | working (manual UI for the broken auto-capture) | Delete — once auto-thumbnail revival ships and is proven | thumbnail-save action in `newTab.js` | None |

## Sequencing

A suggested order. Adjust as you learn the codebase, but the *spirit* — comprehensive safety net first, small slices second, parity before differentiating-feature rebuilds, flagship last — should hold.

### Phase 0: Foundation (you are here)

- [x] Decision recorded in [`ROADMAP.md`](ROADMAP.md).
- [x] This migration ledger exists.
- [ ] **Security hardening (cheap wins).** Land the three single-PR fixes from the [pre-takeover security review](audit/2026-05-04-security-review.md) before Phase 1 starts, so the characterization-test sweep covers an already-hardened surface. Each is small and lowers blast radius for everything downstream. Concrete tasks:
  - **§2.3 — Content Security Policy.** Add a tightened `content_security_policy` to `webextension/manifest.json`: `default-src 'self'; object-src 'none'; base-uri 'none'`. Caps the blast radius of the stored-XSS finding §2.1.
  - **§2.4 — Sender validation.** At the top of every `runtime.onMessage` handler in `background.js`, drop messages where `sender.id !== browser.runtime.id`. Closes the hostile-page-messages-background vector created by `<all_urls>` content-script injection.
  - **§2.7 — Dependency audit in CI.** Add a `Dependency audit` step to [`.github/workflows/ci.yml`](.github/workflows/ci.yml) running `npm audit --audit-level=high`, failing on high or critical. Establishes the baseline before Phase 0 / Phase 1 deps land.

  The high-severity findings (§2.1 stored XSS, §2.2 vendored `zip.js` from 2013) are *not* in this checklist — they're gated behind Phase 1 characterization tests on the restore path, then fixed in Phase 1.5 / Phase 4 under the safety net. See the AMO republish gate in [`README.md`](README.md) for the full pre-publication security preconditions.
- [ ] **Tooling prep for type checking.** Phase 1 will write a lot of new tests in TypeScript, so this must land before Phase 1 starts. Concrete tasks:
  - Add `tsconfig.json` at the repo root with `"allowJs": true, "checkJs": true, "noEmit": true, "strict": true`, and `include` covering `webextension/**/*.js` and `tests/**/*.{js,ts}`. Exclude the vendored `webextension/lib/{deflate,inflate,z-worker,zip}.js`.
  - Install dev deps: `typescript`, `@types/firefox-webext-browser`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`.
  - Update [`vitest.config.js`](vitest.config.js) — change include patterns from `tests/**/*.test.js` to `tests/**/*.test.{js,ts}` for both the `fast` and `e2e` projects.
  - Update [`eslint.config.js`](eslint.config.js) — add a block for `tests/**/*.ts` using `@typescript-eslint/parser`. The existing script-mode / module-mode split for `webextension/**/*.js` stays.
  - Add `"typecheck": "tsc --noEmit"` to `package.json` scripts; add a `Type check` step to [`.github/workflows/ci.yml`](.github/workflows/ci.yml) before the test steps.
  - Verify on a fresh clone: `npm install && npm run typecheck && npm run lint && npm run test:fast` should be green.

### Phase 1: Test-first characterization sweep

The goal of this phase is to build a comprehensive safety net **before any code is rewritten**. Every Differentiating and Parity feature gets at least one Integration test pinning down current behaviour, and Differentiating features get E2E coverage with edge cases as well.

By the end of phase 1, the **Test status** column in the tables above shows at least "Integration" on every Differentiating and Parity row, and "E2E" or "Integration + E2E" on every Differentiating row. **Phase 2 begins only when this is green in CI.**

Per-feature work pattern:
1. Identify the legacy code path (use the **Implementation refs** column as the starting point).
2. Write Integration tests that mock `browser.*` and exercise the function or wiring. Capture *current* behaviour, including known quirks — this is a characterization test in Michael Feathers' sense, not an aspirational test.
3. For Differentiating features (and Parity features that don't have one yet): add an E2E test that drives the feature from the user's perspective in real Firefox.
4. Update the **Test status** column for that row in this doc.

Suggested execution order. The first four slots are the security boundaries identified in the [pre-takeover security review](audit/2026-05-04-security-review.md) §4 — these are characterized first, both because the audit prioritizes them and because they're the foundation under which the high-severity findings (§2.1, §2.2) can be safely fixed in Phase 1.5 / Phase 4. The remaining slots run loosely from low-risk to high-complexity.

**Security boundaries (slots 1–4):**

1. **`runtime.onMessage` boundary** — characterize message dispatch in `background.js`. Cover every handler case, sender validation, and message-shape variation. Required before §2.4 fix lands and before any rewrite touches the message protocol.
2. **Tile-URL render path** — characterize how stored URLs reach `setAttribute('href', url)` (the `fx-newTab.js:831` site of finding §2.1). Tests must cover `http(s)`, `javascript:`, `data:`, `moz-extension:`, and unknown schemes — the malicious cases are part of the characterization, not optional.
3. **Local backup/restore — zip pipeline + URL/schema validation** (also covers the §2.5 prefs-restore boundary and the URL-validation half of §2.1). Round-trip a benign backup; round-trip backups containing malicious URLs and unexpected pref keys; characterize what `export.js` actually persists today. This subsumes the original "Local backup/restore" feature slot.
4. **Optional-permission flows + add-shortcut autocomplete** — `bookmarks` / `history` / `downloads` request, grant, and deny paths, plus the autocomplete that depends on them. This subsumes the original "Add-shortcut autocomplete" feature slot.

**Feature characterization (slots 5–16):**

5. Localization — quick smoke that `_locales/` resolves at all.
6. Pin / unpin — Integration tests at the `tiles.js`/`background.js` seam; E2E already exists.
7. Settings panel persistence — Integration tests for prefs read/write; E2E already exists for open/close.
8. Per-tile custom title, per-tile custom image — small, isolated UI features.
9. Drag-reorder — characterize carefully at the Integration tier first; E2E to follow once the interaction model is captured.
10. Light / dark / auto theme — Firefox-only API surface; tests should exercise both `browser.theme.getCurrent` and `browser.theme.onUpdated` paths.
11. Layout features (rows × columns + opacity + margin + spacing + title size + lock-grid) — interrelated; one coordinated test plan rather than per-knob tests.
12. Per-tile background color — Integration test for the rendering wiring; Unit already exists for `parseColour`.
13. Filter cap with subdomain wildcards.
14. Recently-closed-tabs row + restore.
15. Page background image, hide history-derived tiles.
16. Auto-thumbnail — most complex; tests must cover today's behaviour AND the failure modes (the ~50% of pages that don't capture). The known failure modes themselves are valuable test cases.

This phase is deliberately heavy upfront. The trade-off: weeks-to-months of work before any user-visible rewrite ships, in exchange for a safety net that makes every subsequent rewrite low-risk. If the phase is taking too long, the right adjustment is to *narrow E2E coverage*, not to *skip Integration coverage*.

### Phase 2: First-slice walkthrough

With the test net in place, pick the first feature to actually rewrite. Recommend **Pin arbitrary URL** — small, self-contained, parity-tier (so the strategy is "Reimplement (AS reference)"), and already covered by an E2E test from phase 1.

For the chosen feature:
1. Confirm the characterization Integration test from phase 1 still passes against the legacy code.
2. Extract pure-logic helpers to `webextension/lib/<name>.js` with Unit tests.
3. Reimplement using the extracted helpers + a thin orchestration layer.
4. Wire the new path in. Delete the corresponding legacy code in `newTab.js` (or wherever it lives) once Integration and E2E stay green.
5. Update `CHANGELOG.md`. Bump the row's **Test status** column in this doc (e.g. "Integration + E2E" → "Unit + Integration + E2E" once the extracted helpers have Unit coverage).

This is the template. Every subsequent feature follows the same five steps.

### Phase 3: Parity sweep

Reimplement the remaining parity features in roughly the order of risk-vs-reward:

1. Localization (`_locales/` move) — lowest risk, no behaviour change.
2. Per-tile custom title, per-tile custom image — small, isolated.
3. Configurable rows + configurable columns + arbitrarily large tiles — these collapse into one shared layout module.
4. Drag-reorder — swap under the integration safety net from phase 1.
5. Light / dark / auto theme — uses Firefox-only APIs; first chance to introduce `webextension/lib/platform.js` as a capability layer.
6. Page background image, hide history-derived tiles — straightforward at this point.

By the end of phase 3, every parity feature is on the new code path and the corresponding legacy code is gone.

### Phase 4: Differentiating-feature port

In rough order of risk:
1. **Per-tile background color** — already partially extracted (`lib/colour.js` with Unit tests). Easiest port; good warmup.
2. **Lock-grid toggle**, **per-domain filter cap**, **layout micro-tuning** — self-contained logic.
3. **Recently-closed-tabs row** — simple `chrome.sessions` wiring.
4. **Local backup/restore** — port the zip pipeline; verify no DOM-in-background dependencies sneaked in.
5. **Add-shortcut autocomplete** — rethink the optional-permission flow.
6. **Auto-thumbnail revival** — flagship feature, highest risk, most user-visible. Save for last when the pattern is fully proven and the test infrastructure is mature.

### Phase 5: Drop sweep

Once each drop feature's removal is unblocked (e.g. auto-thumbnail must ship before the manual capture button can go), delete in one pass and clean up dead prefs.

### Phase 6: Stabilization → unblock MV3 stage

When phases 1–5 are substantially done, the pre-requisite gate in [`ROADMAP.md`](ROADMAP.md)'s "Chrome support / MV3 migration" entry will be met. That's the natural moment to start the Firefox MV3 port (stage 2), and after it bakes, Chrome support (stage 3).

## Language and type safety

Production code is JavaScript with JSDoc-based type annotations; tests are TypeScript. Both are checked by `tsc --noEmit` with `allowJs: true` and `checkJs: true`. The extension itself has **no build step** — `web-ext run` and the E2E lifecycle script consume `webextension/` directly. Vitest handles `.ts` test files natively (it uses esbuild under the hood); no extra runner config beyond the include glob.

Why this combination: full TypeScript would put a compilation step between source and runtime that a single maintainer absorbs forever. Plain JavaScript forfeits the type-safety win — particularly painful during Phase 1, which is mostly new test code. JSDoc + `checkJs` on production with TS for tests gets ~80% of TS's safety benefit at zero build-step cost. Cross-file type information flows because TS reads JSDoc when `allowJs` and `checkJs` are enabled, so a `.ts` test importing `webextension/lib/colour.js` sees the JSDoc-declared signature of `parseColour`.

### Rules for new code

- **Production files in `webextension/`:** stay `.js`. Add JSDoc types to function signatures, exported objects, and any `browser.*` callback parameters. The project-wide `tsconfig.json` `checkJs: true` checks every `.js` file by default; you don't need `// @ts-check` per file.
- **Test files in `tests/`:** new tests use `.ts`. Existing `.test.js` files keep working — convert opportunistically when you're already editing them. Don't run a one-shot conversion campaign.
- **WebExtension API types** come from `@types/firefox-webext-browser` (added in Phase 0 tooling prep). When Chrome support arrives in stage 3, `@types/chrome` joins it.
- **Modules:** new code under `webextension/lib/` is ES modules. The eslint config already enforces this (script-mode for legacy `webextension/*.js`, module-mode for `webextension/lib/**/*.js`).

### What not to do

- **Don't introduce a build step** for the extension. If a feature seems to need TS-only ergonomics that JSDoc can't express, that's almost always a sign to simplify the design, not to add a compiler.
- **Don't suppress type errors** with `// @ts-ignore` to make a test pass. Either fix the underlying JSDoc on the production code, or use `// @ts-expect-error` with a one-line comment — the `expect-error` form preserves the signal if the underlying issue is later fixed.
- **Don't add `.ts` files under `webextension/`.** Production code is `.js` only. The escape hatch (renaming to `.ts` later) is preserved by *not* using it now.

## Forward-compatibility checklist (MV3 + Chrome)

The cherry-pick + reference rewrite is stage 1; Firefox MV3 is stage 2; Chrome is stage 3. To make stages 2 and 3 tractable rather than expensive, every line of new or rewritten code should follow the rules below. These are non-negotiable for new code; for ported code, fix anything that obviously violates them while you're already touching the file.

### Promises and async style

- **Use `browser.*`** (promise-returning), never `chrome.*` callbacks. The `chrome.*` namespace exists on Firefox for compatibility but its callback style does not survive cleanly to MV3.
- **Don't mix the two styles within a single function.** Mixed-style code is the single biggest source of confusion when reading the legacy `newTab.js`.
- **`await` everything;** avoid `.then()` chains where promises serve.

### Background-scope code

The background context's lifecycle differs across browsers and manifest versions:

| Context | Firefox MV2 | Firefox MV3 | Chrome MV3 |
|---|---|---|---|
| Form | persistent script | event page | service worker |
| DOM access | yes | yes | **no** |
| Lifetime | persistent | event-driven | killed when idle |
| `XMLHttpRequest` | yes | yes | **no** |

Write background code that survives the worst case (Chrome service worker):

- **Persist all state through `browser.storage.local`,** never in module-scope variables. The service worker can be killed at any time and restarted on the next event.
- **Use `fetch()`,** never `XMLHttpRequest`.
- **No DOM dependencies in background scope** — that includes `document`, `window` (beyond globals), and any DOM-specific APIs.
- **Avoid synchronous APIs.**

### Browser-specific API surface

Firefox-only APIs must live behind a capability layer at `webextension/lib/platform.js` with feature detection. The known set today:

- `browser.theme.getCurrent`, `browser.theme.onUpdated` — auto-theme integration.
- `browser.menus.getTargetElement`, `browser.menus.refresh`, `browser.menus.onShown` — context-menu refinements.
- `browser.runtime.getBrowserInfo` — version checks.

Chrome supports `chrome.sessions.*` but with behavioural differences from Firefox. Verify against the Chrome docs before relying on a Firefox-specific quirk.

### Manifest

- **Avoid `<all_urls>`** if a narrower permission set works. MV3 splits host patterns into `host_permissions` separately from `permissions`; less to migrate later.
- **Don't reach for blocking `webRequest`** — Chrome MV3 requires `declarativeNetRequest` instead.
- **Treat `browser_action` as `action`** — they unify in MV3. Don't write code that depends on `browser_action`-specific semantics.
- **Firefox-only manifest keys** (`applications.gecko`, `browser_action.theme_icons`, `browser_action.browser_style`) are tolerated for now but flagged when seen — do not introduce new ones.

### Markup

The new tab page is `newTab.xhtml`. Both browsers handle it; Chrome handles HTML more comfortably. Whether to convert to HTML during the rewrite is an open question — flag it for explicit decision before any wholesale conversion. Per-feature rewrites can stay in XHTML.

### When in doubt

If you're not sure whether a pattern is MV3-safe, **assume it isn't** and look it up. The cost of writing portable code now is low; the cost of unportable code surfacing during the MV3 port is high.

## How to update this doc

- After every shipped feature: bump that row's **Test status** column and (if applicable) move it to a "Done" subsection or strike through the row. Don't let the doc rot.
- When a strategy changes for a row (e.g. you discover a feature is more salvageable than expected), update the **Strategy** cell with a one-line note.
- New features added to [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md) need a corresponding row here.
