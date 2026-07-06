# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2.0.7] — 2026-07-06

### Added

- Never-capture privacy list (GH #1): listed hosts are never screenshotted; per-tile camera toggle + Advanced-drawer host editor; adding a host purges its stored captures (`Thumbnails.purgeHost`).
- Capture-pipeline never-capture guards at every write path (`startCaptureSession`, `onCompleted`, `Thumbnails.save`, `pickAndStore`); `NeverCapture` model reuses the filter-row host semantics.
- Backup restore carries `neverCaptureHosts` (validated, normalized, purged per entry after tiles restore) — restore allow-list grew; boundary acknowledged in `audit/2026-07-05-never-capture-restore-allowlist.md`.
- Fast/E2E/UAT coverage for the never-capture feature (new `never-capture*.test.ts` files; scenarios 11 + 22 updated).

### Changed

- Docs: README, PRIVACY (new "Controlling thumbnail capture" section, last-updated 2026-07-05), and AMO listing/reviewer notes cover the never-capture list; README dev prereqs corrected to Node ≥24 / pnpm ≥11.
- Never-capture Advanced UI polish: shorter (≤2-line) helptext and a left-aligned add-host row; UAT scenario 22 now asserts both.
- Test harness fails fast on a bad Firefox env: UAT preflight adds a real geckodriver+Firefox launch handshake (catches the snap-geckodriver/wrong-binary class in ~1.5s instead of a 300s daemon hang), the UAT runner aborts the health-wait the moment the daemon exits, and `run_esr_tests.sh` validates the ESR binary up front and aborts the port-wait if web-ext dies. Both tiers honor a `$FIREFOX_ESR_BIN`/`$FIREFOX_BIN` override.

### Removed

- Per-tile Refresh action button; its on-demand title-refresh-from-history had no general replacement (titles still refresh on Set-URL and first-pin). Toolbar-popup capture unchanged.

## [2.0.6] — 2026-06-23

### Changed

- `engines.node` floor raised to `>=24` (drops the untested Node 22 claim; matches `.node-version`).
- UAT preflight now rejects a Firefox whose `--version` isn't clean — catching the Ubuntu snap-wrapper / missing-`xdg-utils` breakage with an actionable message instead of a geckodriver stack trace — aligns its Node/pnpm floors to ≥24/≥11, and is runnable standalone via `pnpm test:uat:preflight`.
- `tile-redesign.test.ts`: replaced the redundant fx-newTab.js source-string assertions with behavioral coverage (stat-chip fresh/non-fresh, favicon glyph via the shared `siteGlyph`), keeping one controller-wiring check.
- E2E `connectToFirefox` now retries the WebDriver-BiDi handshake (bounded) to cut transient CI connect flakes.
- UAT runner writes an aggregate `summary.md` (scenario×verdict table + "needs attention") alongside `report.json`; UAT README gained a preflight-failure troubleshooting section.

### Added

- `tests/integration/stats.test.ts` — edge-case coverage for `TileStats` (`formatCount`/`formatAge`/`compute`): huge counts, clock-skew negative age, zero visits, future-visitTime, and the stat-type branches.

### Security

- Removed the temporary `minimumReleaseAgeExclude: [undici]`: undici 7.28.0 has cleared the 7-day window, so the supply-chain guard now applies to it with no carve-out.

## [2.0.5] — 2026-06-22

### Changed

- Toolchain upgraded to Node 24 (`.node-version`) and pnpm 11.6.0 (`packageManager`, `engines.pnpm >=11`); pnpm-native settings moved from `.npmrc`/package.json to `pnpm-workspace.yaml`.
- Dev deps bumped: web-ext 10.4.0, puppeteer-core 25.1.0, @types/node 24.13.2, eslint 10.5.0, @typescript-eslint/{eslint-plugin,parser} 8.61.0, vitest 4.1.8, globals 17.6.0.

### Security

- Closed pre-existing high advisories in transitive test deps via overrides: undici → 7.28.0 (GHSA-vmh5-mc38-953g / -vxpw-j846-p89q / -hm92-r4w5-c3mj, via jsdom) and hono → 4.12.25 (GHSA-88fw-hqm2-52qc, via @modelcontextprotocol/sdk).
- Supply-chain age guard now actually enforced: `minimum-release-age` was inert under pnpm 10.0.0; reconfigured as `minimumReleaseAge: 10080` (minutes — the old `604800` was seconds) in `pnpm-workspace.yaml`, enforced by pnpm 11, with a scoped `minimumReleaseAgeExclude: [undici]` for the freshly-published fix.

### Removed

- shell-quote `pnpm.overrides` pin — web-ext 10.4.0 (→ fx-runner 1.5.0) ships shell-quote 1.8.4 natively.

## [2.0.4] — 2026-06-13

### Fixed

- Version-sync CI failure: `manifest.json` had drifted to `2.0.1` while `package.json` was `2.0.3` (the 2.0.2/2.0.3 bumps committed without the prebuild manifest sync); today's bump realigns both.

### Added

- `version` lifecycle script — `pnpm version` now runs `scripts/sync-version.mjs` and stages `manifest.json` into the bump commit, so the manifest can't drift from `package.json` again.

## [2.0.3] — 2026-06-11

### Added

- `.github/dependabot.yml` — security-only: version-bump PRs suppressed (`open-pull-requests-limit: 0`) to honor the hard-pin policy, security fixes grouped. Requires the repo "Dependabot security updates" toggle to activate.

### Security

- Pin `shell-quote` to 1.8.4 via `pnpm.overrides`, closing critical advisory GHSA-w7jw-789q-3m8p (transitive via `web-ext` > `fx-runner`; dev-tooling only, but CI's `pnpm audit --audit-level=high` gates on it).

### Changed

- CONTRIBUTING "Before Committing": `pnpm audit --audit-level=high` is now an unconditional pre-commit step (advisories surface against unchanged deps), not only after touching `package.json`/`pnpm-lock.yaml`.
- CONTRIBUTING: new "Keeping dependencies current" subsection — the manual `pnpm outdated` update ritual + quarterly cadence, the security-vs-staleness split, and Dependabot's security-only scope.

## [2.0.2] — 2026-06-10

### Added

- `audit/2026-06-10-code-review.md` — post-2.0.x deep review; §8 dev response disputed five findings (two disproven by cross-tier test search), §9 reviewer adjudication upheld all five, §10 closes with the agreed action list (executed below).
- Behavioral tests: Reset click→confirm-reveal gate (`confirm-gate.test.ts`), toolbar-popup button→message glue (`action-popup.test.ts` — E2E can't open browser-action popups), and object-URL revocation contracts (`objecturl-revoke.test.ts`).

### Changed

- TESTING.md "Test Design Principles": source-grep exemption bounded — a source-string match may never be the sole coverage for a functional behavior, and the `ntt/no-source-grep` justification must say why a behavioral test isn't possible (CONTRIBUTING "Before Committing" points at it).

### Fixed

- Object-URL leak (audit §4.3): all six `URL.createObjectURL` sites in `newTab.js` now revoke prior URLs (owner-keyed `_freshObjectURL`/`_dropObjectURL` helpers; per-site stash shared with `fx-newTab.js`'s `refreshThumbnail`; batch revoke for recently-closed favicons; one-shot decode-source revoke).
- `console.exception` → `console.error` in `fx-newTab.js` (deprecated non-standard alias; forward-compat nit per audit §9.3).
- Lint to zero warnings: removed 4 stale `eslint-disable` directives (audit §4.2).

## [2.0.1] — 2026-06-09

### Added

- Translator workflow: `pnpm i18n:check` (untranslated keys), `pnpm i18n:stale` (dead keys), and `pnpm i18n:purge` (remove dead keys) CLI tools, plus a "Translating" guide in CONTRIBUTING.
- German (`de`) translation substantially expanded toward full coverage.
- `ntt/no-hardcoded-text` ESLint rule + a Vitest XHTML check, preventing literal `.textContent` assignments and raw markup text from eroding i18n coverage.
- i18n regression guards: a cross-locale placeholder-integrity test (all 22 locales — catches a named `$NAME$`/`$1$` token with no `placeholders` block), an E2E render smoke (no raw message keys or `$N`/`__MSG_` leaks in the live page), and a text-integrity observation folded into the config/advanced/titlebar UAT scenarios.

### Changed

- Remaining hardcoded English extracted to `messages.json` and resolved via i18n: the drawer title/tabs, the awesomebar section headers (`SECTION_LABELS`) + search placeholder, and the wallpaper-dialog strings.
- Stale locale keys (in a translation but not `en`) are no longer a CI-gating test — maintenance drift handled by `pnpm i18n:stale`/`pnpm i18n:purge`, completeness by `pnpm i18n:check`; runtime-breaking i18n issues stay gated.
- TESTING.md setup: added the Node-version-manager (`fnm`) install prerequisite before `fnm install`, and merged the Firefox-ESR + UAT-tooling install steps into one section with a "Verify E2E & UAT tooling" box (`firefox-esr`/`firefox`/`claude` checks).

### Fixed

- CI flake: the `favicon-real-sites` E2E test (the only test that hits live third-party sites) now runs by default everywhere except GitHub Actions — gated on `GITHUB_ACTIONS` so every contributor exercises the live favicon path locally with no setup, while GitHub CI skips it; the §1.1 favicon logic stays covered deterministically at the Fast tier.

## [2.0.0] — 2026-06-08

First Mozilla Add-ons (AMO) release of the continuation fork as **NewTab PowerTools**.

### Added

- History-tiles filter: an explicit ✕ remove control on each filter row (deletes the entry; the existing step-the-limit-to-"Unlimited" path still works); the "Filter…" button is now a real toggle (panel starts hidden, caret reflects open/closed) instead of a one-way reveal.
- `Filters.normalizeHost()` + `Tiles._hostFilteredOut()` (extracted, unit-tested matching predicate — semantics unchanged).
- About section is now the brand home: the logo + title link to the AMO listing (opens in a new tab), with a separate "Source on GitHub" link; the whole block is left-aligned and all external links carry `rel="noopener"`.
- OS forced-colors support: an `@media (forced-colors: active)` block styles the tile action buttons with system-color keywords so they honour the user's HC palette.

### Changed

- High-contrast: the manual contrast theme renders the destructive ✕ with the same red fill (`#cc1633`) as light/dark — the white icon + white ring carry legibility on the black ground; the neutral trio are outlined max-contrast buttons. Only true OS `@media (forced-colors: active)` drops the hue (the OS strips custom colours), falling back to a system-colour inverted ✕ treatment.
- Restore "Choose file…" picker is now a themed `<label>` (the native `<input type=file>` is visually hidden) so it matches the drawer buttons in every theme; the selected filename shows in themed type.
- Edit mode: clicking a tile body (not an action button) opens the Tile dialog prefilled for that tile (edit URL / thumbnail / bg colour) from any drawer tab; drag still = Move.
- Recently-closed cards fall back to the extension's stored favicon (collected during tile capture) when the session record carries none, before the letter-block glyph.
- About links row is left-aligned (was centered).
- Add-tile autocomplete dropdown now uses the UI sans font — the page's `font: message-box` was leaking a system serif into it (the rest of the drawer already overrode it).
- Tile editor: the thumbnail "Choose image…" picker is now a themed `<label>` (native `<input type=file>` hidden), matching Backup/Restore; secondary (ghost) drawer buttons gained a subtle filled surface so Set/Remove read as buttons in every theme (were near-invisible transparent outlines); "Save current thumbnail" renamed to "Pin current thumbnail" (it pins the current capture so auto-refresh won't overwrite it).
- Tile tab reworked: the two sections are now "Pin next tile:" and "Update current tile:" (split by a separator). The edit rows are uniform — content left-aligned, [Set]/[Remove] right-aligned: URL ([Change URL] [Set] [Remove → deletes/unpins the tile]), Title ([Change title] [Set] [Remove → reverts to the auto title]), Pin current thumbnail ([Remove → reverts to the auto thumbnail]), Choose image ([Set] [Remove → clears the file pick]), and Background colour. The redundant "Saved image:" / "Title:" labels and the read-only URL line were dropped (the input shows + edits the URL).
- Page tab: the wallpaper row is now [Choose wallpaper] (left) / [Remove] (right). Advanced tab: the "Filter…" button is left-aligned.
- Edit-mode affordances scale with the tile: the drag handle and the "+ Pin tile" control are matching **landscape** pills sized to ~26% of the tile's shorter side tall (capped), with the grip rotated 90° to fit and the "+ Pin tile" font scaling (kept on one line). `.newtab-site` is now a CSS size container (`container-type: size`) to drive this via `cqmin`. The drag handle, "+ Pin tile", and the tile action buttons all share one `--ntt-float-shadow` token (theme-adaptive ring + drop shadow) so they match.
- Recently-closed letter-fallback favicon now derives from the registrable domain (same as tiles), not the page title.
- History-tiles filter host input is normalized on set (trim/lowercase, extract host from a pasted URL, map `*.example.com`→`.example.com`, strip path/trailing-dot) so exact-host filters reliably match. Exact-host semantics unchanged: `www.example.com` limits only that host, `.example.com` spans all subdomains. The filter panel's helptext/layout is left-aligned to the Advanced-tab rhythm (was centered).
- Edit-mode selection cue (regression fix): the redundant dashed outline is dropped from pinned tiles; the single copper **selection ring** (white-separator halo, readable on any thumbnail) now marks the one tile open in the Tile tab; dashed is reserved for the candidate ("add here") slots.
- Edit-mode candidate slots: stop dimming the thumbnail (`opacity:0.25` removed — no wallpaper bleed); keep the full thumbnail under a light scrim with an opaque "+ Pin tile" chip; the page wallpaper dims (~40%) in edit mode so gaps go calm.
- "+ Add tile" → "+ Pin tile": clicking it now pins the history candidate immediately (same as the Pin action) and opens the Tile menu with that tile selected.
- Danger colour moved to a cooler alarm red `#cc1633` (hue ~353°) in light/dark — ~22° off the copper accent (was a near-copper red that blurred with the Edit-mode selection ring). The destructive ✕ action button is now a filled danger button with background-independent separators (white icon + translucent-white ring + drop shadow), slightly larger and gapped from the neutral trio, so it stays legible on any thumbnail in both themes. Each neutral button (edit/refresh/unpin) carries its own surface — a hairline ring + drop shadow — instead of a shared bar behind the cluster, so every button reads on white-on-white / dark-on-dark thumbnails. Accent untouched.
- Renamed user-facing copy/links to "NewTab PowerTools" (the Geoff Lankow lineage credit keeps "New Tab Tools"). Internal identifiers (extension id, storage/pref keys) unchanged.

## [1.0.2] — 2026-06-07

### Changed

- UAT screenshot downscaling default changed from 0.5 to 1 (full resolution); estimated `browser_read_screenshot` token cost in docs updated from ~1.2k to ~2.8k.
- Typography role discipline (design review §6): recently-closed domains, awesomebar URLs/section captions, helper/explanatory copy, and the undo toast move from monospace to the UI sans; monospace now reserved for stat numbers + keyboard hints. Inline italics dropped from the drawer filter helptext and the restore/reset warnings.
- Tile surface (design review §3): bottom title overlay ramps into a near-solid dark floor + stronger title text-shadow so white titles stay legible on light thumbnails; hover actions trimmed to Edit URL · Reload · Pin/Unpin · Remove (dropped "open in new tab"), a kebab shows at rest, and the Remove (✕) uses the danger colour.
- Title bar (design review §1, §4): "Board A" — removed the wordmark, padlock, and cogwheel; the single right-side `Edit` button is now the only titlebar action (opens the drawer). Recently-closed chips show the registrable domain (leading `www.` stripped). Existing S/M/L spacing unchanged.
- Advanced tab on-system (design review §5): the history native checkbox is now a copper toggle (no native checkboxes anywhere in the drawer); drawer action buttons follow a three-tier hierarchy (ghost / copper primary / danger); the unpinned-count steppers are restyled to match the segmented control; the domain table gained drawer row rhythm + hairlines.
- Confirm steps (design review §7): Reset everything and Restore now reveal an inline Confirm/Cancel row (danger-filled) instead of acting immediately — `window.confirm` removed from the reset path; per-tile Remove keeps its undo toast (no confirm).
- High-contrast validation (design review §8): `--ntt-danger` bumped to the existing dark tone (`#e89279`) in the contrast theme for AAA legibility on black; added a consistent copper focus ring (search box + drawer controls) — the search input previously cleared the UA outline with no replacement (a11y gap surfaced by UAT).

### Fixed

- Danger button tier rendered identically to ghost — the ghost base selector's `:not(#id)` inflated its specificity above the danger/primary modifiers (caught by UAT; deterministic regression guard added).
- Readability (UAT-surfaced): removed the v1 blanket text-shadow glow (redundant in v2 — text sits on its own backing — and it muddied recent-closed titles + "+ Add tile"); dimmed the edit-mode auto-tile fade + added a scrim behind "+ Add tile"; high-contrast gets a defined black action-pill (destructive ✕ kept coral) and accent-coloured drawer links (was low-contrast browser-blue on the HC ground).
- Edit/Done mode (design review §2): opening the drawer IS edit mode — the board unlocks, the button flips to a copper `Done`, pinned tiles gain a persistent action row + a centred drag handle + a dashed accent outline, and auto tiles fade to offer "+ Add tile"; closing (Done) re-locks. The board is now locked by default; the standalone lock checkbox is gone. Hover actions are no longer gated on lock (available in normal mode per §3c). Grid column-reflow-on-drawer-open (§2) deferred — needs a grid recompute, flagged for follow-up.

### Added

- `tests/integration/typography.test.ts` + `tests/uat/scenarios/30-typography.md` — guard the §6 role split (textual → sans, numeric/keys → mono, never italic).
- `tests/integration/tile-surface.test.ts` + `tests/uat/scenarios/10-tile-surface.md` — guard the §3c kebab-at-rest affordance, the 4-action hover row, and the danger-coloured Remove.
- `tests/uat/scenarios/31-titlebar.md` — guard the Board A titlebar (single Edit button, no wordmark/padlock/cogwheel) + recent-chip identity.
- `tests/integration/edit-mode.test.ts` + `tests/uat/scenarios/23-edit-mode-design.md` — guard the §2 edit-mode affordances (Done button, pinned drag handle + dashed outline + persistent actions, auto-tile "+ Add tile") + the lock cycle; `grip` icon added.
- `tests/integration/advanced-tab.test.ts` + `tests/uat/scenarios/22-advanced-tab.md` + `tests/uat/scenarios/32-high-contrast.md` — guard the §5 on-system Advanced tab (toggle, button hierarchy, steppers, table), the §7 confirm steps, and the §8 high-contrast validation pass.
- UAT scenarios renumbered by category: tiles 1x (`10-tile-surface`, `11-action-buttons`), drawer 2x (`20-config`, `21-restore`, `22-advanced-tab`, `23-edit-mode-design`), design 3x (`30-typography`, `31-titlebar`, `32-high-contrast`); env/smoke keep `00`/`01`.
- UAT daemon `resetToDefault` is now a lighter message-based reset (clears the `tiles` + `background` IDB stores + `storage.local` prefs) that deliberately preserves the `thumbnails` store, so the default pins' captured imagery survives between scenarios (Option B). The previous UI-click reset (`#options-reset-all` → `#options-reset-confirm`) wiped thumbnails on every reset.
- UAT daemon now pins a default "favourites" set (heise, TechCrunch, Hacker News, MDN, the NTT repo) at startup and after every reset, and captures their screenshots + favicons once at startup so the pinned tiles show real thumbnails + favicons (re-attached by URL on every re-pin via the preserved thumbnails store). `00-uat-init`/`01-default-ui` no-thumbnail checks now scope to non-pinned (`:not([pinned])`) tiles.
- TESTING.md: documented running a single fast/integration/unit file via `pnpm test:fast <name>` (vitest never invoked directly). CONTRIBUTING.md: daily patch-bump (`pnpm version patch`) + version-led dated CHANGELOG sections.

## [2026-06-05]

### Changed

- UAT tier rebaselined around a seeded environment + a first-run user journey. The daemon now seeds Firefox history by real navigation (two passes over a merged US/global + Swiss URL set → `topSites`) and seeds the recently-closed row (open the top 2 articles per news site via a DOM heuristic, then close the tabs) **before** installing the extension — so the first new-tab render is an authentic new-user state (history-filled grid, no thumbnails). Cookie banners are accepted during the seed with a 3s settle so async consent platforms (e.g. Sourcepoint/BBC) render their Accept control first; the acceptance persists for the run, keeping later captures banner-free.
- `/reset_extension` now resets to the default 3×3 state only (dropped the auto-restore-fixture); the seeded environment (history, cookies, recently-closed) is browser-level and survives the reset. Restoring the known-good fixture is now an explicit scenario step.
- Scenario suite replaced: `00-uat-init` (verify the seeded env), `01-default-ui` (default layout/chrome/drawer + first-run auto-thumbnail & favicon capture), `02-config` (live config changes), `03-restore` (restore the backup), `04-action-buttons` (tile hover action row). Old `01-restore-dogfood` / `02-restore-and-verify` / `03-tile-hover-occlusion` removed. The skill preamble is now navigate-only by default with an opt-in restore block.

### Added

- `browser_capture_tiles` MCP tool + daemon `/capture_tiles` endpoint — opens tile URLs (bounded page-load timeout) to trigger the extension's auto-thumbnail + favicon capture, then returns to the new-tab page; lets the capture test run as one call instead of agent-driven external navigation.

### Fixed

- UAT runner now flags an assertion as failed on `pass: false` as well as `passed: false`, so an agent's field-name variant can't slip a real failure through as a false green.

## [2026-06-04]

### Added

- `scripts/amo-screenshots.mjs` — generates the AMO listing screenshots (`assets/screenshots/`, native 1280×800 PNG) via the UAT browser daemon. Reproduces a real user's new tab: pins 5 favourites, fills the rest of the grid from browsing history, and browses a curated tech-leaning site list in 3 passes (2 frecency builders → re-render folds topSites into the auto-capture cache → 1 capture pass dismissing cookie banners) so ~15/16 tiles get real thumbnails. Opens/closes deep article tabs to populate the recently-closed row + add-tile autocomplete, then renders an 8-shot gallery (heroes last, at peak coverage) — 4×4 medium and 3×3 "maxi" grids in light + dark themes on different wallpapers, plus settings-drawer, autocomplete, per-domain-filter, and recently-closed feature shots. Headless-blocking sites (Amazon, YouTube, etc.) are omitted.
- `assets/screenshots/01..08-*.png` — the AMO listing screenshots.
- Browser daemon gained `UAT_FIXTURE` / `UAT_WINDOW` / `UAT_VIEWPORT` (exact inner size) / `UAT_SEED_URLS` / `UAT_PAGELOAD_MS` overrides and `/open_tabs`, `/close_other_tabs`, `/dismiss_consent` endpoints — real-tab management + best-effort cookie-banner dismissal (page + cross-origin CMP iframes). Reusable for future UAT scenarios.
- `tests/uat/scenarios/03-tile-hover-occlusion.md` — UAT scenario for the motivating bug class: hovering a tile shows the action-button row, which must stay inside the tile and not cover the title. Validated by mutation testing (moving the buttons over the title makes both the occlusion assertion and the visual judgment fail).
- `browser_hover` MCP tool + daemon `/hover` endpoint — real pointer move so CSS `:hover` states (tile action rows) activate; synthetic JS events can't trigger them.

### Changed

- Docs restructure: `ROADMAP.md` rewritten as a forward-looking roadmap (Now/Next/Later) + backlog + decisions-of-record, replacing the rewrite-era decision log. Durable content rehomed before retiring three now-completed planning docs — the language/type-safety rules → `CONTRIBUTING.md`, the Firefox-only-API capability-layer note → `MV3_MIGRATION.md`, and the scope/non-goals + remaining-work items → `ROADMAP.md`. Inbound links in `README.md`/`TESTING.md`/`CONTRIBUTING.md`/`tests/uat/README.md` repointed.
- UAT runner now gates pass/fail on the agent's **report verdict**, not just the `claude -p` exit code — the agent exits 0 even when its report records failed assertions, so a scenario with a `passed:false` report (or any failed assertion) now correctly fails the run and the runner exit code.
- `tests/uat/scenarios/02-restore-and-verify.md` asserts the About block is fully visible without scrolling at the standard Full HD viewport (guards a prior "About below the fold" observation, resolved by the FHD render size).
- Docs: `TESTING.md` UAT section refreshed from "planned" to the built daemon architecture; `CONTRIBUTING.md` "Before Committing" now points UI changes at `pnpm test:uat`.

### Removed

- `FEATURE_SCOPE.md`, `UAT_PLAN.md`, `MIGRATION_COMPLETED.md` — served their purpose guiding the (now-complete) rewrite + UAT build-out; their durable content moved per above, history preserved in git.

### Added

- UAT (LLM-driven user-acceptance) test tier completed and runnable via `pnpm test:uat` (opt-in; separate from E2E). New `pnpm test:uat` script. Components under `tests/uat/`:
- `tests/uat/scenarios/02-restore-and-verify.md` — comprehensive UAT scenario: grid structure (9 tiles / 16 cells / spacing), tile content by position, About section (live version vs `getManifest()`, brand, GitHub link), and two visual judgments (grid layout + About-panel readability).

### Changed

- UAT artifacts now lead with the time each file was **created** (`YYYYMMDD-HHMMSS`), not the run-start time, so a strict filename sort matches capture order — screenshots stamped at capture, reports/summaries/logs stamped at scenario end. Fixes scenarios sorting alphabetically (e.g. `restore-and-verify` ahead of the earlier `restore-dogfood`) in image browsers that sort purely by filename.
- UAT renders at Full HD (1920×1080, 100% / DPR 1) but saves screenshots downscaled to 50% (`$UAT_SHOT_SCALE`, default 0.5 → ~960px wide) to cut the agent's image-token cost while keeping tile titles and About text legible — these tests judge layout/occlusion/contrast, not exact pixels. Downscaling runs in-page on a `<canvas>` (no new dependency; the extension CSP already allows `img-src data:`).
- UAT runner surfaces results to the terminal: per-scenario failed assertions + `observations[]` (a "passed but noteworthy" channel formalized in the skill), and a final "Needs attention" block with an observation count — so findings aren't buried in the report files.

### Fixed

- Restoring a backup now applies the wallpaper **live** — previously a restored `backgroundUrl` (CDN wallpaper) didn't appear until the user manually reloaded the new-tab page. `updateUI` re-applies background prefs (`backgroundUrl`/`backgroundColor`/`backgroundPosition`) on change, the same live path tiles/theme/grid already used. Regression test: `tests/integration/restore-wallpaper-live.test.ts`.
- Restore is now atomic (`webextension/export.js`): `readZip` parses all backup JSON up front, so a malformed backup aborts before any state is written — previously prefs were applied first and a `tiles.json` parse error then left a half-applied state (new grid, zero tiles) with no error surfaced. `webextension/background.js` `Import:restore` now reports `{ok:true}` / `{ok:false,error}` instead of swallowing the rejection. New tests in `backup-restore.test.ts` + `background-messages.test.ts`.

## [1.0.1] — 2026-06-02

### Added

- About section in the advanced drawer panel: brand + dynamic version string (read at load time from `chrome.runtime.getManifest().version`), tagline, lineage note, and a link row to GitHub, the hosted `PRIVACY.md`, and the hosted `LICENSE`. Replaces the prior bare GitHub-only link. Five new `options_about_*` locale keys in en; other locales fall back per existing convention. Surfaces the version where bug reports need it; first concrete render target for UAT pilot scenario 01.
- `@modelcontextprotocol/sdk@1.29.0` pinned in `package.json` devDependencies. Recorded in `tests/uat/README.md` Dependencies section. Required by the upcoming UAT runner.
- `scripts/sync-version.mjs` — propagates `package.json` version into `webextension/manifest.json` so a single `pnpm version <bump>` is the canonical bump command. Wired into `pnpm build` as a prebuild step.
- `tests/integration/about-section.test.ts` and `tests/integration/sync-version.test.ts` — regression guards for the About markup / render path and for version drift between `package.json` and `manifest.json`.
- `tests/uat/_tools/preflight.mjs` — UAT environment validator. Seven checks (Node ≥ 22, pnpm ≥ 10, Firefox release on PATH or `$FIREFOX_BIN`, built `.xpi` matching current manifest version, UAT fixture sha256 matches recorded value, `claude` CLI present, `@modelcontextprotocol/sdk` resolvable). Runs all checks, exits 1 on any fail. Will be invoked by the upcoming `runner.mjs` before spawning the Claude agent.

### Fixed

- `tests/uat/README.md` — recorded fixture `sha256` refreshed from stale `7f36e54…` to current `f184515…`. The prior value pre-dated a fixture regeneration that didn't refresh the doc; content shape unchanged (verified by inspection of `prefs.json` + `tiles.json`).

### Changed

- Version bumped to **1.0.1** (was 1.0.0). First post-1.0 release: brings the About section, the version-sync tooling, and the UAT SDK pin. No user-facing functionality changes beyond the About surface.

## [2026-06-02c] — AMO listing prep, week 1 (copy + licenses)

### Changed

- `extensionName` renamed to "NewTab PowerTools" across all 20 locales that had the key (en + 19 non-en). `zh-CN` falls back to en automatically (it didn't have the key). Brand name kept in English across locales — convention for product names (PowerToys, GitHub, Microsoft all do this).
- `extensionDescription` (en only) rewritten to reflect the NTT v2 UI: "A configurable new tab page for Firefox. Auto-captures tile thumbnails of pages you visit, with full layout control and a recently-closed tabs row." Other locales' outdated translations remain (Firefox falls back to the locale's translation if present, en if not — both paths work).

### Added

- `PRIVACY.md` at repo root — privacy policy explaining local-only processing, the single outbound destination (Mozilla wallpapers service), retention/uninstall behavior. AMO listing's Privacy Policy URL will point here.
- `LICENSE` at repo root — full canonical MPL-2.0 text from mozilla.org. Manifest already declared MPL-2.0; this file makes it visible in GitHub's UI and to reviewers.
- `docs/amo-submission-notes.md` — reviewer-facing notes for AMO submission. Covers source-disclosure for the vendored minified `lib/zip.js` (BSD-3-Clause, `@zip.js/zip.js` v2.8.26), `<all_urls>` permission justification (lifted from `audit/2026-05-04-security-review.md` §2.6 + commit `da13254`), per-permission rationale, and project lineage. Paste into AMO Developer Hub's reviewer-notes field at submission.
- `docs/amo-listing.md` — canonical AMO listing copy (name, summary, long-description HTML, category, tags, support/privacy/homepage URLs, screenshots placeholder). Edit here first, then paste into Developer Hub.
- New `webextension/images/icon.svg` — NTPT wordmark (NT row 1, PT row 2) on terracotta `#c96442` background, cream `#faf8f4` letters. Matches the v2 design palette (`webextension/tokens.css`). Replaces the inherited gradient cog icon from upstream — the rebrand identity is now consistent across the new-tab UI, the addons manager, and AMO surfaces. Marked as a placeholder for the eventual designer pass.

### Fixed

- `README.md` — title and inline branding aligned to the canonical CamelCase brand "NewTab PowerTools" (was "New Tab PowerTools" spaced); status paragraph updated to reflect what Week 1 AMO prep landed and what remains (screenshots + Developer Hub submission); "Next:" checklist re-ordered to put screenshots and AMO submission ahead of MV3 migration.

## [2026-06-02b] — AMO submission readiness

### Changed

- Manifest forward-port for AMO submission: `applications` → `browser_specific_settings` (MV3-compatible key name); `strict_min_version` 128 → 140 (ESR 128 EOL'd 2025-09; ESR 140 is current and supports `data_collection_permissions`).
- `webextension/newTab.js:799` — `browser.extension.getURL` → `browser.runtime.getURL` (the `extension` namespace is MV3-removed).

### Added

- `browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }` — Mozilla's built-in data-consent declaration. Accurate for NTT: tile/thumbnail data lives in local IndexedDB; the only outbound connection is the Mozilla wallpapers service; no telemetry, no third-party endpoints.
- `tests/unit/manifest.test.ts` — regression guard asserting the data-consent declaration stays `["none"]` and the legacy `applications` key stays absent.
- `pnpm verify` script — runs `lint && typecheck && lint:webext && test:fast && build` in one command. Faster feedback loop than `pre_commit_check.sh` + manual gate-by-gate runs; E2E intentionally excluded (separate `pnpm test:e2e` for the heavier ~11-minute gate).

### Known accepted

- `web-ext lint` warning `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` — `data_collection_permissions` was added to Firefox-for-Android in version 142, our overall `strict_min_version` is 140 (desktop ESR). NTT can't run on Firefox-Android anyway (no `chrome_url_overrides.newtab` surface on Android Firefox UI). AMO accepts (0 errors). Not worth carrying an empty `gecko_android` block to silence.

## [2026-06-02] — Fork identity, pnpm migration, build pipeline

### Changed

- **Fork identity.** Extension ID changed from `newtabtools@darktrojan.net` to `newtabtools@symlink.ch` (new AMO listing). Updated in 6 places: `webextension/manifest.json`, two integration tests, three UAT tools. `package.json` `author` set to `"Markus Perdrizat"` (was empty).
- **Version reset to semver: `92.1` → `1.0.0`** in `webextension/manifest.json`. The 92.x line was Geoff's own incremental scheme inherited from upstream; restarting the line as `1.0.0` aligns with `package.json`'s already-existing `1.0.0` and gives a clean semver trail under the new AMO ID. Going forward, manifest and package versions bump together.

### Added

- `pnpm build` script in `package.json` — wraps `web-ext build` and writes the unsigned `.xpi` to `dist/` (the canonical build output, shared between UAT installation and AMO release upload). Replaces the previous long `web-ext build …` command in docs.
- UAT tools (`browser-smoke.mjs`, `mcp-server.mjs`, `fallback-cli.mjs`) now resolve the `.xpi` from a separate `XPI_DIR` (default `dist/`), while still writing their own evidence (screenshots, scenario reports) to `ARTIFACTS_DIR` (default `tests/uat/artifacts/`). Both env vars are overridable.
- `.gitignore` ignores `dist/`.
- **Package manager: npm → pnpm.** `.npmrc` adds `minimum-release-age=604800` (the 7-day supply-chain guard that `CONTRIBUTING.md` previously claimed but did not enforce — npm has no equivalent setting). Pinned via `packageManager: pnpm@10.0.0` in `package.json`; `scripts/check-pnpm.js` rejects `npm install`/`yarn install` so the guard can't be silently bypassed.
- `package.json` adds `engines` (Node ≥ 22, pnpm ≥ 10) and `preinstall` hook; `.node-version` (= 22) lets fnm/nvm pick the right Node automatically.
- `selenium-webdriver` pinned to exact `4.44.0` (was `^4.44.0`, violated the project's exact-pin rule).
- `.github/workflows/ci.yml` switched to `pnpm/action-setup@v4` + `pnpm install --frozen-lockfile`; Node now read from `.node-version`.
- Docs swept for `npm` → `pnpm` commands: `CONTRIBUTING.md`, `TESTING.md`, `UAT_PLAN.md`, `tests/uat/README.md`.

### Fixed

- `CONTRIBUTING.md` no longer claims `min-release-age=7` exists in `.npmrc` — the setting is now real (`minimum-release-age=604800`, pnpm-native) and the doc references the correct name + value + enforcement mechanism.

## [2026-06-01] — UAT tier scaffolding & doc refresh

### Added

- UAT tier prototypes under `tests/uat/_tools/`: `mcp-server.mjs` (MCP browser-control over Selenium + release Firefox), `mcp-smoke.mjs`, `browser-smoke.mjs`, `fallback-cli.mjs`, `mcp-config.json`, plus `tests/uat/README.md`.
- Checked-in UAT fixture `tests/uat/newtabtools_knowngood.zip` (`fixtureVersion: 1`; `.gitignore` negation since `*.zip` is globally ignored).
- `selenium-webdriver` devDependency for the UAT browser path.

### Changed

- Refreshed `README.md` to reflect the shipped NTT v2 UI (status bar removed; awesome bar added) and updated test-suite counts.
- Re-planned the UAT tier (`UAT_PLAN.md`) onto Selenium + geckodriver + release-channel Firefox (prototype-validated); E2E stays on ESR + Puppeteer-BiDi.
- Chose the UAT agent↔browser bridge: MCP server with **Option C** screenshots (take→disk path, read→inline on demand) over eager-inline MCP and CLI-over-Bash; documented in `UAT_PLAN.md`.
- UAT tooling writes build artifacts and screenshots to the git-ignored `tests/uat/artifacts/` — no `/tmp` dependency.
- Documented UAT dev-environment setup (release Firefox + geckodriver + deps) in `TESTING.md`, recorded the decision to keep UAT out of push/PR CI, and reconciled the `UAT_PLAN.md` fixture description (9 tiles at positions 0–8) to the actual fixture.

## [2026-06-01] — NTT v2 Phase 5 security remediation

### Security

- Removed the `connect-src https:` wildcard from the CSP — favicons now render as live `<img src=favIconUrl>` under `img-src https:` (paint-only, no fetch channel); only `data:` favicons are still cached in IDB.
- Validate `backgroundUrl` against the Mozilla CDN allow-list regex on backup restore, dropping anything else.
- Filter recently-closed tab URLs through `isValidURL` so only `ftp:`/`http:`/`https:` protocols render.
- "Reset everything" now also clears the Thumbnails and Background IndexedDB stores.

### Added

- `audit/2026-05-31-csp-tightening.md` documenting the wildcard removal, the favicon `<img>` threat model, and the empirical disproof of the `page-icon:` approach.
- CONTRIBUTING "Security-boundary changes require explicit acknowledgement" checklist (CSP/permission/allow-list/validation changes).
- Awesome-bar XSS regression test pinning attacker-controlled title/URL to `textContent`.
- Generalized CSP regression guard (`tests/unit/manifest.test.ts`): fails the build if any of `default-src`/`script-src`/`style-src`/`connect-src` carries an `http:`/`https:`/`ws:`/`wss:` scheme wildcard or a bare `*`.

### Fixed

- Grid `min-width` clamped to `min(600px, 100%)` so the drawer no longer forces horizontal overflow at narrow widths.

## [2026-05-31] — NTT v2 Phase 5: cleanup & consolidation

### Removed

- **Phase 5 cleanup.** Deleted the retired bottom status bar outright (markup, CSS, and JS — 4-0 had only hidden it) and removed the dead `#options` settings-modal CSS left over from the Phase 3 drawer migration. On startup, stale pref keys from removed features (`titleBarClock`, `titleBarWordmark`, `titleBarStatus`) are pruned from storage so they don't ride along in backups.

### Changed

- **Phase 5 cleanup.** Consolidated the drawer's legacy `<fieldset>` / `<legend>` / `<p>` markup (Pin URL, per-tile editor, history filter, Backup & Restore, Reset) onto the `.ntt-form-group` primitives used elsewhere, so all three tabs share one type scale. No behavior change.

## [2026-05-30] — NTT v2 Phase 4: status bar removed + awesome bar

### Added

- **Awesome bar (Phase 4-3).** The titlebar search box is now a working search dropdown: press `/` anywhere (preempting Firefox Quick Find) or click it, type, and pick from your tiles, bookmarks, and history, plus a "search the web" entry that uses your default engine. Up/Down to navigate, Enter to open (Cmd/Ctrl+Enter for a new tab), Esc to dismiss; the grid dims while it's open. Search is on by default (`titleBarSearch`); bookmarks/history results are best-effort behind the optional permissions. Adds the `search` permission.

### Changed

- Search box (`titleBarSearch`) now defaults **on** so the awesome bar is available out of the box.

### Removed

- **Bottom status bar (Phase 4-0).** Retired to align with the current Firefox new tab layout — the keyboard-hint pills + tile-count no longer render, the "Status bar (bottom)" drawer toggle and the `titleBarStatus` pref are gone. The removed-tile undo notice it used to host is now a standalone floating toast, so tile-removal undo still works.

## [2026-05-30] — NTT v2 titlebar: inline recently-closed + reflow fix

### Changed

- **Titlebar redesign — recently-closed inline.** The titlebar reads left→right: the recently-closed cards, then a fixed-width search box, then a single **masthead** box at the right end combining the brand wordmark with the lock + cogwheel controls. The cards live in a greedy flex container (`flex: 1 1 0`) the browser sizes to the leftover room, which also acts as the spacer pinning the masthead right; `_layoutTitlebar` reads that container's width and `computeTitlebarSlots` shrinks the cards to fill it edge-to-edge (capped at the 186px default) via `--ntt-slot-w`. Re-flows on resize, spacing/margin changes, the search toggle, and config-drawer open/close.
- The masthead, search box, and recent cards share one box treatment (surface fill, rounded, 38 px tall, subtle 1px line shadow, dark-mode adaptive).
- Two-line wordmark lockup — "New Tab" in the recent-card title style over "Powertools" in the recent-card URL style (small monospace mute), sized so the masthead matches the recent-card height.
- Captured favicons in the tile overlay badge are pinned to a uniform 16 px square (`.ntt-favicon img`) instead of the source image's natural size.
- Moved the "Recently closed" control into the Page tab's Title Bar group as a plain on/off toggle above Search (was an Off/Top segmented control in the Advanced tab).

### Removed

- Titlebar clock (and the `titleBarClock` pref/toggle + locale string) and the titlebar theme toggle — theme is still switchable via the Page-tab theme cards. The separate recently-closed strip above the grid is gone (cards live in the titlebar); the removed-tile undo notice moved into the status bar.
- The "NTT Logo" titlebar toggle (`titleBarWordmark` pref + locale string): the brand wordmark is now always shown in the masthead.

### Fixed

- Recently-closed titlebar cards now reflow reliably on config-drawer open/close, window resize and the search toggle — the count is read from the greedy card container's settled `clientWidth` instead of a `getBoundingClientRect` masthead measurement that jittered mid-transition and stuck the row at one card until reload.

## [2026-05-29] — NTT v2 Phase 3 (config drawer) + Phase 4-5 (favicons & tile visuals)

### Added

- **Configuration drawer** replacing the centred options modal — a right-side push-layout panel opened by the titlebar cogwheel and closed with Esc, organised into **Tile / Page / Advanced** tabs.
- **Tile tab** — click any tile to edit it (auto-selects the top-left tile on open), a Pin-URL "Add tile" form that accepts bare domains (`normalizePinURL`), and a per-tile thumbnail / title / colour editor.
- **Page tab** — grid size, spacing / margin / corner-radius sliders, titlebar element toggles, the wallpaper picker, and four theme cards including a new WCAG-AAA **high-contrast** theme.
- **Advanced tab** — history-tiles filter, Backup & Restore, a destructive **Reset everything** button, and a live **Auto-saved · Nm ago** indicator.
- **Real favicons on tiles** — captured alongside auto-thumbnails (`tab.favIconUrl`, 64 KB cap, stored in IDB) and shown on both the fallback glyph and the overlay badge; handles inline `data:` and third-party HTTPS favicons.
- **Domain-hashed fallback tile colours** in OKLCH (`oklch(65% 0.13 hue)`) for perceptually-uniform contrast; an explicit hex `backgroundColor` still wins.
- **State-aware pin icon** — an outline thumbtack when unpinned, a slashed `pin-off` when pinned, swapping live on toggle.
- **Firefox wallpaper metadata** — curated wallpapers honour their `background_position`; `solid_color` entries render as flat-colour backgrounds.
- New prefs `actionIconSize`, `tileActions`, `tileRadius`, `theme='contrast'`, `backgroundPosition`, `backgroundColor` — all round-trip through backup/restore.
- Tile-action **Edit** opens the drawer and selects the tile; **Refresh** also pulls a fresh title from browsing history.
- Extensive new test coverage — ~20 integration suites plus E2E for the drawer, theme cards, drag-layout, and `favicon-real-sites` (heise.de + techcrunch.com).

### Changed

- Cogwheel and lock toggle moved into the titlebar cluster (top-right, always visible); tile-editor navigation arrows removed in favour of click-to-select.
- "System" theme now adopts the active Firefox theme's colours (folding in the old `themeAuto` toggle); "Light" / "Dark" force the NTT palette.
- Default grid spacing / margin bumped small → medium for a more readable out-of-box layout.

### Fixed

- Favicon fetches were blocked by the manifest CSP for both inline `data:` URLs (now decoded in-process) and third-party HTTPS hosts (now unblocked via `https:`).
- **Reset everything** and backup-restore now take effect correctly — tiles are actually cleared (via the `Tiles.clear` message) and thumbnails / metadata refresh without a manual reload.
- Drag fixes — the grid no longer "explodes" into giant gaps, dragged tiles follow the pointer, and dragging works with the drawer open.
- Foreground opacity now also dims screenshot-less tiles; titlebar elements stay aligned when the clock / search / wordmark are hidden; sliders update live as you drag.
- E2E: eliminated an intermittent Puppeteer-BiDi navigation race (`navigateAndConfirm` confirms via frame-URL tracking instead of the racy goto event-wait).

### Removed

- The old `#options` modal scaffold and its `toggleOptions` / `showOptionsExtra` methods, the `themeAuto` pref + locale strings, the tile-editor navigation arrows, and the Pin-URL highlight animation.

## [2026-05-28]

### Added

- NTT v2 Phase 2-2: status bar with keyboard hint pills (left) and live tile count + grid dimensions (right)
- `_updateStatusBar()` + MutationObserver on `#newtab-grid` to keep the count in sync as tiles change

### Changed

- gapMap defaults updated to match design tokens: small=10px, medium=18px (matches `--ntt-gap` token default), large=28px
- Grid `margin` pref now also scales status bar padding (medium/large)

### Security

- Bumped `web-ext` 10.1.0 → 10.3.0 to clear GHSA-ph9p-34f9-6g65 (tmp path traversal) and GHSA-w5hq-g745-h8pq (uuid bounds check) via transitive deps; `npm audit` now reports 0 vulnerabilities

## [2026-05-23]

### Added

- NTT v2 Phase 2-1: titlebar with wordmark, live clock, theme toggle, settings gear
- Titlebar prefs (`titleBarWordmark`, `titleBarSearch`, `titleBarClock`, `titleBarStatus`) for toggling each element
- Titlebar prefs added to backup/restore allow-list
- Search input in titlebar (hidden by default — wired in Phase 4)

### Changed

- Cogwheel moved to absolute top-right corner, outside content margins
- `#newtab-margin-top` padding-top removed (titlebar handles top spacing now)
- Search bar defaults to hidden (`titleBarSearch: false`) until search logic is implemented
- Removed duplicate settings gear from titlebar (cogwheel is the single settings entry point)

### Fixed

- Titlebar respects grid margin setting (padding matches side margins)
- Titlebar-to-content spacing matches `--ntt-gap` (grid spacing)
- Clock/theme-toggle right-aligned with tile grid edge

## [2026-05-21]

### Changed

- Recently-closed bar redesigned as mini-tile cards with inline "Recently Closed" label on the left

## [2026-05-20]

### Added

- feat: NTT v2 Phase 0 — design tokens, SVG icons, CSS Grid layout
- feat: NTT v2 Phase 1 — tile redesign, stats, action buttons, visual bug fixes

## [2026-05-13]

### Added

- Tile aspect ratio setting in the layout panel: `Fill viewport` (default, unchanged behavior), `16:9`, `4:3`, `1:1`, `3:4` (portrait). Resolves upstream issue #505 — tiles maintain the chosen ratio and the grid centers in the available space.
- `newTabTools.computeCellDimensions` pure helper plus `applyTileAspect` integrator; cell dimensions are JS-computed when an aspect is locked (CSS `aspect-ratio` alone collapses to zero in the existing flex layout). Recomputes on window resize and on rows/columns/spacing/tileAspect changes.
- `tileAspect` added to the §2.5 restore allow-list so the setting round-trips through backup/restore.

### Changed

- `package-lock.json` regenerated to drop `^` ranges from devDependency records, aligning the lock file with the exact pinning already declared in `package.json`.

## [2026-05-11]

### Security

- `npm audit fix` — resolved `fast-uri` path traversal via percent-encoded dot segments

### Changed

- Updated `README.md` to reflect completed migration and active MV3 work
- Removed ~25 debug `console.log`/`console.warn` calls from `background.js` (§5.5)
- Pinned all devDependency versions to exact (no `^` ranges) (§5.4)
- `MIGRATION.md` marked complete and renamed to `MIGRATION_COMPLETED.md`
- Auto-thumbnail rewrite: multi-stage capture (A/B/C) with blankness detection for heavy SPAs like X.com
- `Thumbnails.capture` handler uses new `startCaptureSession` instead of removed `captureAndStore`
- Rewrote `auto-thumbnail.test.ts` from source-scanning to behavioral tests (vm.runInThisContext + fake timers)
- Rewrote `wallpaper-picker.test.ts` fetch logic from source-scanning to behavioral tests
- Completed source-scanning → behavioral audit across all 14 integration test files
- Converted all 17 E2E test files + `_helpers` from JavaScript to TypeScript with full type annotations

### Added

- Post-takeover code review and assessment at `audit/2026-05-11-code-review.md`
- `MV3_MIGRATION.md` is now the active migration plan
- Remove-thumbnail button on tile hover (alongside pin and block controls)
- `Thumbnails.delete` message handler to remove thumbnails from IDB

### Fixed

- Export/Import `sendResponse()` invoked immediately instead of passed as callback (§5.1)
- `isValidURL` allow-list tightened from 5 schemes to 3 (`http:`, `https:`, `ftp:`) — aligns with restore/render boundaries (§5.2)
- `strict_min_version` bumped from 91.0 to 128.0 (current ESR) (§5.3)
- Hard deadline now takes a C capture before finalizing (was finalizing with A+B only)
- Tab-active guard in `captureTab` prevents capturing wrong tab when user switches mid-session
- SPA double-`onCompleted` cancels prior session timers to prevent stale hard-deadline firing

### Removed

- Donation link, "What Changed?" button, and in-app update notice (Phase 3 fork cleanup)
- `versionLastUpdate` and `versionLastAck` prefs (version notice tracking no longer needed)
- `donate`, `donate_label`, `changelog_label`, `newversion` locale strings from all 21 locale files

## [2026-05-10]

### Added

- Wallpaper picker: fetch curated wallpapers from Mozilla Remote Settings, display in category-grouped sidebar

### Changed

- Dedicated `System theme` option; default theme changed to `system` (follows OS `prefers-color-scheme`)
- Refactored `tests/e2e/theme.test.js` and `tests/unit/manifest.test.js` to TypeScript

### Fixed

- Replaced all deprecated CSS vendor prefixes (`-moz-appearance`, `:-moz-any`, `-moz-user-focus`, etc.) with standards
- Collapsed duplicate `-moz-any`/`-webkit-any` rule pairs into single `:is()` rules

## [2026-05-09]

### Security

- Fixed §2.6 — removed `executeScript` and `thumbnail.js` content script; no JS injected into visited pages

### Changed

- Auto-thumbnail rewrite: `drawWindow` → `captureVisibleTab()` with two-stage capture (immediate + network idle)
- `action.js` capture button uses `Thumbnails.capture` message instead of `executeScript`
- Added `webRequest` permission to manifest for network idle detection
- Updated `MIGRATION.md` — all 22 features complete, all 7 security findings resolved

### Removed

- Deleted `thumbnail.js` content script (replaced by background-only capture)

## [2026-05-08]

### Changed

- Audit and update `MIGRATION.md` — 21 of 22 features complete, phases collapsed from 6 to 4

### Removed

- Delete `lib/colour.js`, `lib/messaging.js` and their unit tests — unused at runtime; extraction deferred to MV3

## [2026-05-07]

### Fixed

- CI typecheck — added `globals.d.ts` for integration test globals, minor type annotations in 5 test files
- Suppressed expected error noise in test output (console spy on error-handling tests)

- Security review update — `audit/2026-05-07-security-update.md` (6 of 7 findings now fixed)
- `CONTRIBUTING.md` — run `npm audit` after changing dependencies

### Security

- Fixed §2.1 stored XSS via zip restore (HIGH) — URL scheme allow-list at restore + render boundaries
- Fixed §2.2 vendored zip.js from 2013 (HIGH) — replaced with `@zip.js/zip.js` v2.8.26; `export.js` rewritten to Promise API
- Fixed §2.5 unfiltered pref keys on restore (MEDIUM) — allow-list of known keys before `storage.local.set`
- Resolved `basic-ftp@5.3.0` high-severity advisory via `npm audit fix`

## [2026-05-06]

### Added

- Phase 1 feature characterization — slots 5–16 complete (209 integration tests across 11 suites)
- Phase 1 E2E characterization — slots 17–29 complete (24 E2E tests across 12 suites)
- Hermetic E2E fixtures — `resetTestState` ensures tests pass regardless of execution order

## [2026-05-05]

### Added

- Phase 1 security boundary characterization — slots 1–3 (56 integration + 2 E2E + 14 unit tests)
  
## [2026-05-04]

### Added

- **Security review** landed at `audit/2026-05-04-security-review.md`. Result: cautious go for the takeover. Audit findings absorbed into the roadmap.
- **Codebase strategy decided**: cherry-pick + reference rewrite. Recorded in `ROADMAP.md`.
- Created `MIGRATION.md` — **per-feature migration ledger** 
- **Phase 0 security hardening** — the three cheap-win fixes from `audit/2026-05-04-security-review.md`:

## [2026-05-03]

### Added

- Established the **Unit and Integration test tiers** using Vitest and `jsdom`, including initial characterization tests for core utility modules.
- Implemented the **E2E test tier** for Firefox ESR using Puppeteer over WebDriver BiDi, with reliable extension loading and state persistence.
- Migrated to **ESLint flat config** with specialized support for legacy scripts, new ES modules, and the E2E test environment.
- Configured **GitHub Actions CI** for automated linting and full test suite validation.

### Changed

- Harmonized testing terminology across all docs

### Removed

- Deleted `BOOTSTRAP.md` following the successful establishment of the test infrastructure.

## [2026-05-02]

### Changed

- Updated [`README.md`](README.md): updated with "New Tab PowerTools" branding and features
- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md): updated with test automation focus
- Deactivated donation button instead of linking to the original maintainer's donation page
- Updated the GitHub link to the new repository fork
- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md) to explicitly state the intention of the fork and the initial focus on test automation
- Rewrote [`README.md`](README.md) to reflect takeover-prep state and explicitly outline the high-level features parsed from AMO and the extension's codebase

### Added

- Added [`TESTING.md`](TESTING.md): canonical testing guide, including a guide for installing Firefox ESR on Ubuntu/WSL via the official Mozilla APT repository
- Added `BOOTSTRAP.md`: (Temporary) one-time test infrastructure setup guide.
- Added [`ROADMAP.md`](ROADMAP.md): deferred decisions about Chrome support and MV3 migration
- Added [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md): gap analysis vs. native Firefox
