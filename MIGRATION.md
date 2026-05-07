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
| **Auto-thumbnail of recently visited pages** | **partially working** — captures simple pages, fails on ~50% of pages (CSP, cross-origin restrictions, sites that block content-script execution, timing issues) | Port + rewrite (capture) — replace the `drawWindow` content-script with `browser.tabs.captureTab` triggered by `browser.webNavigation.onCompleted`; cache by URL in `browser.storage.local`. The non-standard `drawWindow` API is also a long-term liability — modernizing is both a coverage and a portability win. | `thumbnail.js` (line 14: `drawWindow` content-script), thumbnail wiring in `newTab.js` | **Integration + E2E** (Thumbnails.save/get handler dispatch in `background-messages.test.ts`; `auto-thumbnail.test.ts` — 25 tests: content script structure, webNavigation trigger logic, getThumbnails display, save/get handlers, cleanupThumbnails, characterization pins for known working/failing/partial URLs; `tests/e2e/auto-thumbnail.test.js` — 2 E2E tests: capture after navigating to pinned URL + persistence across reload) |
| **Arbitrarily large tiles** | working | Port from NTT — emergent property of the unconstrained-grid layout; preserve verbatim | grid layout in `newTab.js` / `newTab.css` | **E2E** (`tests/e2e/large-tiles.test.js` — 2 E2E tests: flex layout fills grid space with equal-width cells; grid rows × columns structure consistency) |
| **Configurable columns and unconstrained grid** | working | Port from NTT | grid setup in `newTab.js` (rows × columns prefs, layout calculations) | **Integration + E2E** (`layout.test.ts` — optionsOnChange int parse + updateUI input value for rows/columns; `tests/e2e/configurable-grid.test.js` — 2 E2E tests: columns/rows change via settings + persistence) |
| **Layout micro-tuning** (opacity, title size, margin, spacing) | working | Port from NTT — settings logic; reimplement the settings UI cleanly | settings panel in `newTab.js` / `newTab.xhtml`; prefs in `prefs.js` | **Integration + E2E** (prefs read/write/validation in `prefs-persistence.test.ts`; UI wiring in `layout.test.ts`; `tests/e2e/layout-tuning.test.js` — 4 E2E tests: opacity/titleSize/spacing/margin via settings) |
| **Lock-grid toggle** | working | Port from NTT | drag-reorder gate in `newTab.js` | **Integration + E2E** (locked pref validation in `prefs-persistence.test.ts`; lock guard in `drag-reorder.test.ts`; updateUI locked attr/icon in `layout.test.ts`; `tests/e2e/lock-grid.test.js` — 2 E2E tests: lock toggle attribute + control visibility) |
| **Per-domain filter cap** with subdomain wildcards | working | Port from NTT — filter logic is self-contained pure-ish code, good extraction candidate | filter handling in `tiles.js` / `newTab.js` | **Integration + E2E** (Filters set/get/clear in `prefs-persistence.test.ts`; filter matching + UI wiring in `filter-cap.test.ts` — 16 tests; `tests/e2e/filter-cap.test.js` — 2 E2E tests: add filter via UI + plus/minus button adjustment) |
| **Per-tile background color** | working | Port from NTT — `parseColour` already extracted and tested | `webextension/lib/colour.js` (extracted); UI wiring in `newTab.js` | **Unit + Integration + E2E** (`tests/unit/lib/colour.test.js`; bgcolor-set/reset in `tile-editing.test.ts`; `tests/e2e/tile-bgcolor.test.js` — 1 E2E test: set/reset bgcolor via settings) |
| **Recently-closed-tabs row** with one-click restore | working | Port from NTT — uses standard `chrome.sessions` API | `newTab.js` ~line 796 (`chrome.sessions.getRecentlyClosed`, `restore`, `onChanged`) | **Integration + E2E** (`recent-tabs.test.ts` — 17 tests; `tests/e2e/recent-tabs.test.js` — 2 E2E tests: closed tab appears in row + toggle hide/show via Prefs.recent) |
| **Add-shortcut autocomplete** from open tabs / bookmarks / history | working (with optional permissions granted) | Reimplement (AS reference) — clean state management; rethink the optional-permission flow | `newTab.js` ~line 123, ~line 173 (`chrome.history.search`); permission prompt wiring | **Unit + E2E** (partial — `isValidURL` scheme whitelist in `url-validation.test.ts`; `tests/e2e/autocomplete.test.js` — 2 E2E tests: autocomplete suggestions from open tabs + URL validation gate for pin button) |
| **Local backup/restore** (single-file zip) | working | Port from NTT — keep the zip pipeline; ensure no DOM-in-background dependencies that would block MV3 service-worker port later | `export.js`, `lib/zip.js` (vendored) | **Integration + E2E** (Export/Import handler dispatch + known bug characterization in `background-messages.test.ts`; full makeZip/readZip pipeline + §2.1/§2.5 malicious-input characterization in `backup-restore.test.ts`; E2E restore round-trip with `uploadFile` + persistence verification in `tests/e2e/backup-restore.test.js`) |

## Parity (match) features — reimplement cleanly

| Feature | Current state | Strategy | Implementation refs (legacy) | Test status |
|---|---|---|---|---|
| Pin arbitrary URL | working | Reimplement (AS reference) — first slice candidate; already covered by E2E so the safety net exists | `tiles.js#pinTile` (line 159), `background.js` 'Tiles.pinTile' handler (line 130) | **Integration + E2E** (`background-messages.test.ts` Tiles.pinTile handler; `tiles-pin.test.ts` — 21 tests: pinTile/putTile/removeTile/getTile/isPinned/ensureReady/getAllTiles/clear + Background get/set; `tests/e2e/pin-persists.test.js`) |
| Per-tile custom uploaded image | working | Reimplement (AS reference) | tile image handling in `newTab.js` / `tiles.js` | **Integration + E2E** (`tile-editing.test.ts` — savedthumb-set/remove, savethumb message + image store; `tests/e2e/tile-custom.test.js` — 1 E2E test: upload custom thumbnail via settings) |
| Per-tile custom title | working | Reimplement (AS reference) | title editing in `newTab.js` | **Integration + E2E** (`tile-editing.test.ts` — title-set writes link.title + putTile; `tests/e2e/tile-custom.test.js` — 1 E2E test: set custom title via settings + persistence) |
| Drag-reorder tiles | working | Reimplement (AS reference) — drag-drop is finicky, characterize current behaviour carefully before swapping | drag handlers in `newTab.js` | **Integration + E2E** (`drag-reorder.test.ts` — 13 tests; `tests/e2e/drag-reorder.test.js` — 2 E2E tests: synthetic drag swap + persistence, locked grid prevents drag) |
| Configurable rows | working | Reimplement (AS reference) — covered alongside "Configurable columns" above | shared with grid layout | **Integration + E2E** (`layout.test.ts`; covered by `tests/e2e/configurable-grid.test.js`) |
| Page background image | working | Reimplement (AS reference) | wallpaper handling in `newTab.js` / `prefs.js` | **Integration + E2E** (Background handler dispatch in `background-messages.test.ts`; IDB in `tiles-pin.test.ts`; `tile-editing.test.ts`; `background-and-history.test.ts`; `tests/e2e/page-background.test.js` — 1 E2E test: upload/remove background image) |
| Light / dark / auto theme | working | Reimplement (AS reference) — isolate Firefox-only `browser.theme.*` calls behind `webextension/lib/platform.js` | `newTab.js` ~line 625, ~line 721 (`browser.theme.getCurrent`, `onUpdated`) | **Integration + E2E** (`theme.test.ts` — 19 tests; `tests/e2e/theme.test.js` — 2 E2E tests: theme radio switch + darkIcons stylesheet, themeAuto toggle) |
| Hide history-derived tiles | working | Reimplement (AS reference) | filter integration in `tiles.js` / `newTab.js` | **Integration** (`background-and-history.test.ts` — Prefs.history toggle skips/enables topSites; `layout.test.ts` — updateUI history checkbox + filter disabled) |
| Localization (multi-language UI) | working | Port from NTT — `_locales/` moves over verbatim, no rewrite needed | `webextension/_locales/` | **Unit** (`tests/unit/localization.test.ts` — 10 tests: en structure, code-reference integrity, non-en locale validation) |

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
- [x] **Security hardening (cheap wins).** Landed 2026-05-04. The three single-PR fixes from the [pre-takeover security review](audit/2026-05-04-security-review.md) so the characterization-test sweep covers an already-hardened surface:
  - [x] **§2.3 — Content Security Policy.** Added `content_security_policy` to `webextension/manifest.json`: `default-src 'self'; object-src 'none'; base-uri 'none'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'`. The `img-src` and `style-src` allow-listings are necessary for the existing `URL.createObjectURL` thumbnail path and the inline `style=""` attributes in `newTab.xhtml` / `action.html`. Verified via `web-ext lint`, the full E2E suite, and a regression test at `tests/unit/manifest.test.js` that asserts the key directives are present and that `'unsafe-eval'` / `'unsafe-inline'`-in-script-src never sneak in.
  - [x] **§2.4 — Sender validation.** Pure-logic helper `isAuthorizedSender` extracted to `webextension/lib/messaging.js` with Unit tests at `tests/unit/lib/messaging.test.js` (red/green TDD). Inline check added at the top of the `runtime.onMessage` handler in `background.js`. The inline copy mirrors the lib helper; when the strangler-fig migration reaches the messaging boundary in Phase 1/2, the inline copy is replaced by an `import`. **Note on test coverage:** the helper itself has Unit tests, but the *wiring* in `background.js` (i.e. that the inline check is actually present and active) is intentionally not tested in isolation — Phase 1 slot 1 (`runtime.onMessage` boundary characterization) covers this comprehensively, including legitimate-sender dispatch and hostile-sender drop across every message handler. Writing a partial version now and replacing it in Phase 1 would be wasted work.
  - [x] **§2.7 — Dependency audit in CI.** Added `Dependency audit` step to [`.github/workflows/ci.yml`](.github/workflows/ci.yml) running `npm audit --audit-level=high`. The 3 pre-existing moderate-severity advisories in dev-stack transitive deps (`web-ext` → `node-notifier` → `uuid`) are below the gate and stay visible without blocking.

  - [x] **§2.1 — Stored XSS via zip restore (HIGH).** Fixed 2026-05-06. URL scheme allow-list (`http:`, `https:`, `ftp:`) applied at two boundaries: (1) `export.js` `readZip` skips tiles with non-safe protocols before `Tiles.putTile` (primary fix — malicious URLs never reach storage); (2) `fx-newTab.js` `addTitle` renders `#` instead of the URL for non-safe protocols (defense-in-depth — blocks execution even if a bad URL reaches IDB via another path). Characterization tests in slots 2 and 3 flipped from pinning the vulnerability to asserting the fix. All 309 fast tests + 35 E2E tests pass.

  - [x] **§2.2 — Vendored zip.js from 2013 (HIGH).** Fixed 2026-05-07. Replaced the 2013 vendored copy (~5,300 lines: `zip.js` + `deflate.js` + `inflate.js` + `z-worker.js`) with `@zip.js/zip.js` v2.8.26 (`zip-core.min.js`, 62KB). Added as pinned devDependency for `npm audit` coverage; dist file copied to `webextension/lib/zip.js` via `npm run update-zip`. `export.js` rewritten to use the modern Promise-based API (`ZipWriter`/`ZipReader` constructors, async `add`/`close`/`getEntries`/`getData`). Web workers disabled (`zip.configure({ useWebWorkers: false })`). Old worker files deleted. Backwards compatible: modern zip.js reads old deflate-compressed backups transparently. All 309 fast tests + 35 E2E tests pass.
  - [x] **§2.5 — Unfiltered pref keys on restore (MEDIUM).** Fixed 2026-05-07. `readZip` now filters restored prefs through an allow-list of known keys (`theme`, `themeAuto`, `opacity`, `rows`, `columns`, `margin`, `spacing`, `titleSize`, `locked`, `history`, `recent`, `blocked`, `filters`) before `chrome.storage.local.set`. Unknown/malicious keys are silently dropped. Characterization test flipped from pinning the vulnerability to asserting the fix.

  Both high-severity findings (§2.1, §2.2) are now resolved. See the AMO republish gate in [`README.md`](README.md) for the full pre-publication security preconditions.
- [x] **Tooling prep for type checking.** Landed 2026-05-04. Phase 1 will write new tests in TypeScript; the toolchain to support that is now in place.
  - [x] Added [`tsconfig.json`](tsconfig.json) with `"allowJs": true, "checkJs": true, "noEmit": true, "strict": true`, types from `firefox-webext-browser` and `node`.
  - [x] Pinned dev deps: `typescript@6.0.3`, `@types/firefox-webext-browser@143.0.0`, `@types/node@20.19.39`, `@typescript-eslint/parser@8.59.1`, `@typescript-eslint/eslint-plugin@8.59.1` (per the supply-chain guardrails in [`CONTRIBUTING.md`](CONTRIBUTING.md)).
  - [x] Updated [`vitest.config.js`](vitest.config.js) include patterns to `tests/**/*.test.{js,ts}` for both `fast` and `e2e` projects.
  - [x] Updated [`eslint.config.js`](eslint.config.js) with a `tests/**/*.ts` block using `@typescript-eslint/parser`. The existing script-mode / module-mode split for `webextension/**/*.js` stays.
  - [x] Added `"typecheck": "tsc --noEmit"` to [`package.json`](package.json) and a `Type check` step to [`.github/workflows/ci.yml`](.github/workflows/ci.yml) between `Lint` and `Web-ext Lint`.
  - **Pragmatic divergence from the original spec:** the tsconfig `include` is **not** the full `webextension/**/*.js`. The legacy script-mode files (`newTab.js`, `fx-newTab.js`, `background.js`, `tiles.js`, `prefs.js`, `common.js`, `export.js`, `thumbnail.js`, `action.js`) have zero JSDoc and would produce hundreds of `noImplicitAny` errors under `strict + checkJs`. Annotating them today is wasted work — they're scheduled for replacement during the strangler-fig migration anyway. Current scope: `webextension/lib/**/*.js` (new code) + `tests/unit/**/*.js` + `tests/integration/**/*.js` + `tests/**/*.ts`. Coverage grows automatically as features migrate into `lib/` during phases 3 and 4. The e2e JS tests in `tests/e2e/*.test.js` are also outside scope until they're either annotated or converted to TS in Phase 1; ESLint still covers them.
  - Verified: `npm run typecheck` passes (zero errors); `npm run lint` clean; `npm run test:fast` green (29 tests across 3 files); `.test.ts` pipeline tested end-to-end with a throwaway file (since removed).

### Phase 1: Test-first characterization sweep

The goal of this phase is to build a comprehensive safety net **before any code is rewritten**. Every Differentiating and Parity feature gets at least one Integration test pinning down current behaviour, and Differentiating features get E2E coverage with edge cases as well.

By the end of phase 1, the **Test status** column in the tables above shows at least "Integration" on every Differentiating and Parity row, and "E2E" or "Integration + E2E" on every Differentiating row. **Phase 2 begins only when this is green in CI.**

Per-feature work pattern:
1. Identify the legacy code path (use the **Implementation refs** column as the starting point).
2. Write Integration tests that mock `browser.*` and exercise the function or wiring. Capture *current* behaviour, including known quirks — this is a characterization test in Michael Feathers' sense, not an aspirational test.
3. For Differentiating features (and Parity features that don't have one yet): add an E2E test that drives the feature from the user's perspective in real Firefox.
4. Update the **Test status** column for that row in this doc.

Suggested execution order. The first three slots are the security boundaries identified in the [pre-takeover security review](audit/2026-05-04-security-review.md) §4 — these were characterized first, both because the audit prioritizes them and because they're the foundation under which the high-severity findings could be safely fixed. §2.1 (stored XSS) is now fixed under this safety net (see Phase 0 §2.1 entry); §2.2 (vendored zip.js) is deferred to Phase 4. Slot 4 (optional-permission flows) was originally grouped here but re-evaluated as feature behaviour, not a trust boundary — deferred to Phase 4. The remaining slots run loosely from low-risk to high-complexity.

**Security boundaries (slots 1–3, slot 4 deferred):**

1. **`runtime.onMessage` boundary** — ✅ characterize message dispatch in `background.js`. Cover every handler case, sender validation, and message-shape variation. Required before §2.4 fix lands and before any rewrite touches the message protocol. **Done:** `tests/integration/background-messages.test.ts` — 27 tests covering sender validation (4 reject cases + 1 accept), all 13 switch-case handlers, known bugs in Export/Import (`sendResponse()` invoked immediately), and unknown-message fallthrough.
2. **Tile-URL render path** — ✅ characterize + fix how stored URLs reach `setAttribute('href', url)` (the `fx-newTab.js:831` site of finding §2.1). Tests cover `http(s)`, `ftp:`, `javascript:`, `data:`, `moz-extension:`, and unknown schemes. **Done:** Unit test `tests/unit/url-validation.test.ts` (14 tests characterizing `isValidURL` scheme whitelist) + Integration test `tests/integration/tile-url-render.test.ts` (11 tests loading the real `addTitle` via vm — safe schemes pass through, dangerous schemes render `#`). **§2.1 defense-in-depth fix landed:** `addTitle` now checks URL protocol against `['http:', 'https:', 'ftp:']` and sets `href="#"` for anything else. Characterization tests flipped from pinning the vulnerability to asserting the fix. E2E deferred to slot 3: the dangerous injection vector is malicious URLs entering IDB via backup restore, not the pin-URL input flow (which already rejects dangerous schemes).
3. **Local backup/restore — zip pipeline + URL/schema validation** — ✅ characterize + fix `export.js` makeZip/readZip pipeline. Covers §2.5 prefs-restore boundary and the URL-validation half of §2.1. **Done:** `tests/integration/backup-restore.test.ts` — 18 tests covering makeZip export pipeline (6: pref key filtering, tiles/images export, background inclusion/omission, download trigger), readZip benign restore (4: prefs, tiles, image rehydration, background), readZip malicious inputs (4: javascript: URLs skipped by allow-list §2.1 fix, data: URLs skipped §2.1 fix, unexpected pref keys applied without filtering §2.5, HTML in titles), readZip edge cases (4: missing entries, empty tiles). **§2.1 primary fix landed:** `readZip` now checks each tile URL against `['http:', 'https:', 'ftp:']` before `Tiles.putTile` — malicious URLs are silently dropped at restore time and never reach storage. Characterization tests flipped from pinning the vulnerability to asserting the fix. E2E for backup (makeZip) deferred: `chrome.downloads.download` with `saveAs:true` requires the optional `downloads` permission and opens a system dialog. E2E for restore (readZip) landed: `tests/e2e/backup-restore.test.js` — 2 tests using Puppeteer BiDi `uploadFile` to inject a stored-format ZIP fixture built in Node.js (zero-dependency ZIP builder), then verifying tiles appear in the grid and persist across reload.
4. **Optional-permission flows + add-shortcut autocomplete** — ⏭ deferred (partially addressed by slot 29). Slot 29 (`tests/e2e/autocomplete.test.js`) now covers the core autocomplete logic: tab-source suggestions, `maybeAddItem` rendering, URL validation gate, and `pinURLBlocked` default state. The remaining untested paths are all behind optional-permission gates: `chrome.bookmarks.getTree` and `chrome.history.search` data sources in autocomplete (same `maybeAddItem` logic, different data), `chrome.permissions.request` dialogs (browser chrome — untestable from Puppeteer), `chrome.history.search` title-lookup in pin handler, `chrome.history.deleteUrl` self-cleanup on startup, and `downloads` permission request for backup export. None are security boundaries. Characterize during the Phase 4 feature rewrite of "Add-shortcut autocomplete" when optional-permission pre-grant in the test profile can be set up.

**Feature characterization (slots 5–16):**

5. Localization — ✅ smoke test that `_locales/` resolves. **Done:** `tests/unit/localization.test.ts` — 10 tests: en structure (valid JSON, 50+ keys, every entry has non-empty message), code-reference integrity (every JS/XHTML/manifest key resolves to en), non-en locale validation (valid JSON, stale-key check, characterization of `zh-CN` missing `extensionName` and `bg` missing `extensionDescription`).
6. Pin / unpin — ✅ Integration tests at the `tiles.js`/`background.js` seam; E2E already exists. **Done:** `tests/integration/tiles-pin.test.ts` — 21 tests covering pinTile (position assignment, first-gap finding, duplicate rejection), putTile, removeTile (dedup cleanup), getTile, isPinned, ensureReady/getAllTiles (cache, truncation, duplicate logging), clear, plus Background get/set/clear via in-memory IDB mock.
7. Settings panel persistence — ✅ Integration tests for prefs read/write; E2E already exists for open/close. **Done:** `tests/integration/prefs-persistence.test.ts` — 44 tests covering Prefs.init (storage read, getter/setter wiring, onChanged listener), parsePrefs validation for every pref key (valid + invalid), prefsChanged propagation, version date setters, Blocked (block/unblock/isBlocked/clear with persistence), Filters (setFilter/getList copy semantics/clear with persistence).
8. Per-tile custom title, per-tile custom image — ✅ small, isolated UI features. **Done:** `tests/integration/tile-editing.test.ts` — 13 tests extracting `optionsOnClick` from real `newTab.js` and exercising title-set, url-set, savedthumb-set/remove, savethumb (Thumbnails.get message + image store + no-thumb guard), bgcolor-set/reset/display-click, bg-set/bg-remove, disabled-target guard. Also covers slot 12 (per-tile background color) and slot 15 (page background image set/remove).
9. Drag-reorder — ✅ characterize carefully at the Integration tier first; E2E to follow once the interaction model is captured. **Done:** `tests/integration/drag-reorder.test.ts` — 13 tests loading real `fx-newTab.js` via vm: lock guard (Prefs.locked blocks dragstart), Drag.start (sets draggedSite, marks parent as dragged, stores cell dimensions, sets frozen + dimensions on node), _setDragData (all 4 MIME types, HTML-escapes quotes/angles), Drag.end (clears state, removes dragged attrs, slides site back), Drop._pinDraggedSite (pins at new index, no-op on same cell), Drop.drop (calls Updater.updateGrid).
10. Light / dark / auto theme — ✅ Firefox-only API surface. **Done:** `tests/integration/theme.test.ts` — 19 tests extracting `updateThemeColours`, `getThemedImageURL`, `optionsOnChange`, `updateUI`, and `parseColour` from real `newTab.js`: optionsOnChange pref writes (3: theme radio, themeAuto checkbox, disabled guard), updateThemeColours (8: clears CSS props when auto off, reads getCurrent, uses updateInfo.theme, computes CSS custom properties, toolbar fallback, contrast detection light/dark, getCurrent rejection handling, unparseable colors), updateUI (5: sets theme attribute, darkIcons disabled for light, enabled for dark, registers/removes onUpdated listener), parseColour (2: rgb parse, null for bad input).
11. Layout features (rows × columns + opacity + margin + spacing + title size + lock-grid) — ✅ interrelated; one coordinated test plan rather than per-knob tests. **Done:** `tests/integration/layout.test.ts` — 21 tests extracting `updateUI` and `optionsOnChange` from real `newTab.js`: optionsOnChange (7: rows/columns/opacity parsed as int, margin split to array, spacing/titleSize as string, locked as checked boolean), updateUI (14: rows/columns input values, opacity input + CSS custom property, titleSize/spacing input + attribute, margin input join + CSS classes, locked attribute set/remove + themed icon, history checkbox + filter disabled, full null-keys refresh).
12. Per-tile background color — Integration test for the rendering wiring; Unit already exists for `parseColour`.
13. Filter cap with subdomain wildcards — ✅ **Done:** `tests/integration/filter-cap.test.ts` — 16 tests in two describe blocks. UI wiring (9): options-filter-set calls Filters.setFilter + Updater.updateGrid + clears inputs + highlights host, plus/minus buttons increment/decrement count + setFilter, minus at zero shows unlimited + disables button, minus returns early when already unlimited, plus from unlimited starts at 0. Filter matching (7): exact host filter at 0 blocks all, filter at 1 allows one, dot-prefix wildcard matches subdomains, dot-prefix matches bare domain, no filter allows all, blocked sites filtered regardless, non-http protocols filtered out.
14. Recently-closed-tabs row + restore — ✅ **Done:** `tests/integration/recent-tabs.test.ts` — 17 tests extracting `refreshRecent`, `trimRecent`, and `isValidURL` from real `newTab.js`: Prefs.recent guard (2: hides list when false, calls getRecentlyClosed when true), item creation (4: anchor href/class/sessionId, title with URL, title=URL, empty title), skipping (2: incognito tabs, window sessions), favicon (3: valid favIconUrl adds img, falsy skips, javascript: protocol skips), visibility (2: hides when no items, shows when items), onclick (1: calls chrome.sessions.restore), multiple items (1: creates correct count), text fallback (1: uses URL when title empty).
15. Page background image, hide history-derived tiles — ✅ **Done:** `tests/integration/background-and-history.test.ts` — 9 tests in two describe blocks. Page background rendering (4): applies background URL to document.body + backgroundFake, clears both when no background, disables/enables remove button. Hide history tiles (5): Prefs.history=false skips topSites and returns only pinned, sparse slice characterization, empty array when no pins, history=true calls topSites and fills slots, no duplication of pinned URLs. Page background set/remove already covered by slot 8.
16. Auto-thumbnail — ✅ most complex. **Done:** `tests/integration/auto-thumbnail.test.ts` — 25 tests across 6 describe blocks. Content script structure (3: thumbnailSize from storage, drawWindow + white bg, canvas scaling). webNavigation.onCompleted trigger (5: frameId guard, protocol filter, browserAction disable, staleness check, incognito guard). getThumbnails display (5: sends Thumbnails.get with correct URLs, applies CSS backgroundImage, skips custom-uploaded images, updates siteThumbnail for selected site, handles null cells). Thumbnails.save/get handlers (4: stores all fields, guards url+image, returns Map, updates used date). cleanupThumbnails (4: two-week expiry, IDB index + upperBound, cursor delete, idle trigger). Known capture behaviour characterization (4: working URLs — insideparadeplatz.ch + finews.ch; not working — heise.de/newsticker empty capture; partially working — qoqa.ch/de incomplete load; all valid https).

**E2E characterization (slots 17–28):**

Integration coverage is complete for all features. The remaining gap is E2E coverage — driving each feature from the user's perspective in real Firefox via Puppeteer BiDi. Existing E2E suites (`loads-cleanly`, `pin-persists`, `settings-panel`, `backup-restore`) cover the security-critical paths. These slots cover the remaining Differentiating features (required by Phase 1 criteria) and key Parity features that benefit from visual/interaction verification.

17. ✅ Auto-thumbnail visible on reload — navigate to a known-working URL (e.g. a local test page served by the harness), return to new tab, verify a thumbnail `backgroundImage` is set on the tile. Characterize: thumbnail may be absent for known-failing URLs (heise.de pattern). **Done:** `tests/e2e/auto-thumbnail.test.js` — 2 E2E tests: pin example.com → navigate → verify thumbnail backgroundImage set on tile; reload → verify persistence. Cleanup unpins the tile afterward.
18. ✅ Arbitrarily large tiles — verify tiles grow/shrink with window size and take up the maximum available space. Resize the viewport and confirm tile dimensions scale proportionally. **Done:** `tests/e2e/large-tiles.test.js` — 2 E2E tests: flex layout fills grid space with equal-width cells; grid rows × columns structure consistency. Note: `page.setViewport()` is not supported in Firefox BiDi, so resize-based scaling test is not possible; instead verifies flex properties, cell dimensions, and proportional fill directly.
19. ✅ Configurable columns and rows — **Done:** `tests/e2e/configurable-grid.test.js` — 2 E2E tests: change columns (3→5) via settings + verify grid + persistence; change rows (3→5) + persistence.
20. ✅ Layout micro-tuning — **Done:** `tests/e2e/layout-tuning.test.js` — 4 E2E tests: opacity updates `--opacity` CSS variable, titleSize updates `titlesize` attribute, spacing updates `spacing` attribute, margin updates margin element classes.
21. ✅ Lock-grid toggle — **Done:** `tests/e2e/lock-grid.test.js` — 2 E2E tests: lock toggle adds `locked` attr + hides `.newtab-control` (display: none), lock-toggle button reflects state.
22. ✅ Per-tile background color — **Done:** `tests/e2e/tile-bgcolor.test.js` — 1 E2E test: set bgcolor `#ff0000` via color input + set button, verify `rgb(255, 0, 0)` on thumbnail, reset + verify cleared.
23. ✅ Per-domain filter cap — **Done:** `tests/e2e/filter-cap.test.js` — 2 E2E tests: add filter via UI (host + count) + verify row in table + Filters.getList(); plus/minus buttons adjust count.
24. ✅ Recently-closed-tabs row — **Done:** `tests/e2e/recent-tabs.test.js` — 2 E2E tests: close a tab → verify it appears in recently-closed row; toggle Prefs.recent off → verify row hidden.
25. ✅ Page background image — **Done:** `tests/e2e/page-background.test.js` — 1 E2E test: upload PNG via file input + set button → verify body backgroundImage set; remove → verify cleared.
26. ✅ Light / dark / auto theme — **Done:** `tests/e2e/theme.test.js` — 2 E2E tests: switch theme radio dark/light + verify theme attribute + darkIcons stylesheet state; themeAuto checkbox toggle.
27. ✅ Drag-reorder tiles — **Done:** `tests/e2e/drag-reorder.test.js` — 2 E2E tests: synthetic DnD swap (untrusted events accepted by drop handler) + persistence across reload; locked grid hides controls.
28. ✅ Per-tile custom title and image — **Done:** `tests/e2e/tile-custom.test.js` — 2 E2E tests: set custom title via settings + persistence across reload; upload custom thumbnail via file input.
29. ✅ Add-shortcut autocomplete — **Done:** `tests/e2e/autocomplete.test.js` — 2 E2E tests: type in pin-URL input → autocomplete shows suggestions from open tabs (no optional permissions needed); URL validation gate — `javascript:` disables pin button, `https:` enables it. Note: bookmarks/history autocomplete deferred (requires optional permissions pre-grant in profile).

Localization and hide-history-derived-tiles are adequately covered by Integration + Unit tests and don't need dedicated E2E slots — localization is structural, and hide-history is a pref toggle whose grid effect is covered by slot 23's filter cap test pattern.

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
