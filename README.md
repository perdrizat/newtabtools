# New Tab PowerTools

A new tab page for Firefox, built around the sites you actually visit and laid out the way you want. Think of it as **PowerTools for your browser**—extending the new tab experience in creative ways, much like Microsoft PowerToys does for Windows.

> **Status: preparing for AMO publication.** The original maintainer stepped back (see note below) and put the upstream repo in read-only mode. This repository is the working tree for a continuation effort. The codebase migration (cherry-pick + reference rewrite) is complete — all 22 features characterized, tested, and working, all 7 security findings resolved. Next step is AMO publication (pending contact with the original maintainer about a possible handover). MV3 migration follows; see [`MV3_MIGRATION.md`](MV3_MIGRATION.md) for the plan.

## Main features

> Firefox's built-in new tab page covers the basics: drag-to-reorder shortcuts, custom titles, a custom uploaded image per tile, and (since version 138) custom wallpapers. NTT replaces that page entirely and adds the controls and visual cues the default doesn't expose.

- **Tiles you can actually see.** Firefox's built-in shortcuts stay small no matter how few you choose, reserving the unused space rather than reflowing. NTT lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and the tiles scale to fill the viewport. Big enough to read titles and recognize pages at a glance.
- **Tiles that look like the sites they link to.** NTT auto-captures a thumbnail of each top site the way it actually appeared the last time you visited, and uses that as the tile image. Firefox's native shortcuts only accept a manual image upload, which never reflects the live page. The capture uses a multi-stage approach (immediate, 500ms, and 2s network-idle) with blankness detection to handle heavy SPAs like X.com.
- **Pixel-level layout control.** Pick exact rows and columns, tune foreground opacity, tile title size, page margins, and grid spacing — then lock the grid so you don't reorder it by accident. None of these knobs are exposed in Firefox's native page.
- **Top sites that aren't dominated by one domain.** Cap how many tiles a single host can take (with subdomain wildcards like `.example.com`), hide auto-generated history tiles entirely, or pull pin suggestions from your open tabs, bookmarks, and history via autocomplete. Native Firefox enforces a hard "one tile per domain" rule and offers no autocomplete in its Add Shortcut form.
- **Per-tile personalization.** Set a custom background color per tile (native supports a custom *image* but not a *color*), edit titles and URLs, manually upload a thumbnail when auto-capture isn't an option (login walls, dark pages, sites you haven't visited yet).
- **Recovery and portability.** A dedicated row of recently closed tabs sits below the grid for one-click restore — Firefox's native "Recent activity" surfaces visited pages and bookmarks, but not closed-tab session restore. Export your tiles, thumbnails, and settings to a single backup file and restore on another machine, no Firefox Sync required.

## What's in this repo

- `webextension/` — the extension source. Currently MV2, Firefox-only, minimum version pinned to the latest Firefox ESR.
- [`MV3_MIGRATION.md`](MV3_MIGRATION.md) — the active migration plan for Manifest V3 (Firefox-only first, Chrome deferred).
- [`TESTING.md`](TESTING.md) — the canonical testing guide. Three test tiers (Unit, Integration, E2E) using Vitest + jsdom for the first two and Puppeteer + WebDriver BiDi against Firefox ESR for the third, with `jest-webextension-mock` mocking the WebExtension API surface at the Integration tier. Includes the TDD-cycle rules for new vs. legacy code. Required reading before touching the code.
- [`ROADMAP.md`](ROADMAP.md) — log of architectural decisions, both taken and deferred.
- [`MIGRATION_COMPLETED.md`](MIGRATION_COMPLETED.md) — historical record of the completed cherry-pick + reference rewrite migration. Per-feature table with strategy, implementation refs, and test status.
- [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md) — gap analysis vs. native Firefox; drives which features get full E2E coverage and which get parity smokes.
- [`CHANGELOG.md`](CHANGELOG.md) — Keep a Changelog format.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — developer guide, TDD workflow, AI-assisted contribution guardrails.

## Project history

**Completed:**
- [x] License-compatibility confirmed (MPL-2.0 explicitly permits continuation).
- [x] Testing strategy, bootstrap plan, and roadmap documented.
- [x] Forked the repository; test infrastructure green in CI.
- [x] Codebase strategy chosen: cherry-pick + reference rewrite (see [`ROADMAP.md`](ROADMAP.md)).
- [x] Security: all 7 findings from the [pre-takeover review](audit/2026-05-04-security-review.md) resolved. [Post-takeover code review](audit/2026-05-11-code-review.md) completed.
- [x] Test-first characterization sweep: 313 integration + 38 E2E tests across all 22 features.
- [x] Codebase migration complete (see [`MIGRATION_COMPLETED.md`](MIGRATION_COMPLETED.md)). Auto-thumbnail rewritten, drop sweep done, all features working.
**Next:**
- [ ] Contact the original maintainer about a possible ownership transfer (extension ID + user base). Fallback: publish as a new extension under a new ID.
- [ ] First release on AMO.
- [ ] Manifest V3 migration (Firefox-only first). See [`MV3_MIGRATION.md`](MV3_MIGRATION.md).
- [ ] Open the issue tracker for new bug reports.

## For developers
 
If you want to contribute to the New Tab PowerTools, please read the **[Contributing Guide](CONTRIBUTING.md)** first. 

Because of the advent of AI coding assistants, **testing is mandatory** and we employ a strict red/green TDD workflow. See the **[Testing Guide](TESTING.md)** for:
- **[Environment Setup](TESTING.md#environment-setup):** Installing Node.js and Firefox ESR.
- **[CLI Reference](TESTING.md#cli-reference):** Commands for dev, linting, and testing.
- **[Testing Strategy](TESTING.md#the-testing-strategy):** Our tier-by-tier TDD workflow.

## License

[Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/) — unchanged from the original project. All source files retain their MPL-2.0 headers. Source availability via this public repository satisfies the license's source-distribution clause.

## Original maintainer's note

Preserved here as historical record and to credit the original work:

> As you can probably tell from the long list of unanswered issues, I clearly don't have time for this. This Github project will now be put in read-only mode.
>
> Since 2018 I have been working full-time developing Thunderbird, and even if I did have any spare time outside of work, the last thing I would want to do is maintain more code, especially as it's the same tools and processes as my day job.
>
> Thank you to everybody who has supported New Tab Tools over the years, by donating, translating the text, sending pull requests, or helping others.

— Geoff Lankow ([@darktrojan](https://github.com/darktrojan))

This continuation builds on Geoff's many years of work on the extension and the user community he established. The codebase, the original feature set, and most of what makes the extension worth continuing are his.
