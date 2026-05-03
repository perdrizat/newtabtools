# New Tab PowerTools

A new tab page for Firefox, built around the sites you actually visit and laid out the way you want. Think of it as **PowerTools for your browser**—extending the new tab experience in creative ways, much like Microsoft PowerToys does for Windows.

> **Status: takeover in preparation.** The original maintainer stepped back (see note below) and put the upstream repo in read-only mode. This repository is the working tree for a continuation effort. It is **not yet published** under new ownership on AMO — the version currently on [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/new-tab-tools/) is still the original maintainer's last release. The bug intake process and the AMO listing for the continuation are not yet finalized; please do not file new issues here until that's announced.

## Main features

> Firefox's built-in new tab page covers the basics: drag-to-reorder shortcuts, custom titles, a custom uploaded image per tile, and (since version 138) custom wallpapers. NTT replaces that page entirely and adds the controls and visual cues the default doesn't expose.

- **Tiles you can actually see.** Firefox's built-in shortcuts stay small no matter how few you choose, reserving the unused space rather than reflowing. NTT lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and the tiles scale to fill the viewport. Big enough to read titles and recognize pages at a glance.
- **Tiles that look like the sites they link to.** NTT auto-captures a thumbnail of each top site the way it actually appeared the last time you visited, and uses that as the tile image. Firefox's native shortcuts only accept a manual image upload, which never reflects the live page. *(This feature relied on a Firefox API Mozilla recently removed; restoring it on top of modern WebExtension APIs is a flagship goal of the takeover — see [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md).)*
- **Pixel-level layout control.** Pick exact rows and columns, tune foreground opacity, tile title size, page margins, and grid spacing — then lock the grid so you don't reorder it by accident. None of these knobs are exposed in Firefox's native page.
- **Top sites that aren't dominated by one domain.** Cap how many tiles a single host can take (with subdomain wildcards like `.example.com`), hide auto-generated history tiles entirely, or pull pin suggestions from your open tabs, bookmarks, and history via autocomplete. Native Firefox enforces a hard "one tile per domain" rule and offers no autocomplete in its Add Shortcut form.
- **Per-tile personalization.** Set a custom background color per tile (native supports a custom *image* but not a *color*), edit titles and URLs, manually upload a thumbnail when auto-capture isn't an option (login walls, dark pages, sites you haven't visited yet).
- **Recovery and portability.** A dedicated row of recently closed tabs sits below the grid for one-click restore — Firefox's native "Recent activity" surfaces visited pages and bookmarks, but not closed-tab session restore. Export your tiles, thumbnails, and settings to a single backup file and restore on another machine, no Firefox Sync required.

## What's in this repo

- `webextension/` — the extension source. MV2, Firefox-only, minimum version pinned to the latest Firefox ESR. Functionally unchanged from the upstream's last release.
- [`TESTING.md`](TESTING.md) — the canonical testing guide. Fast feedback loop (Vitest + jsdom) and end-to-end validation (Puppeteer + WebDriver BiDi), `jest-webextension-mock` for the API contract layer, and Mode A / Mode B flow rules for new vs. legacy code. Required reading before touching the code.
- [`ROADMAP.md`](ROADMAP.md) — log of deferred decisions with enough context to pick them up later. First entry: Chrome support and MV3 migration are deferred until Firefox-only stabilization is finished.
- [`CHANGELOG.md`](CHANGELOG.md) — Keep a Changelog format.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — bug-report guidance carried over from the original maintainer; will be updated once the continuation's intake process is in place.

## Where the takeover stands

Done:
1. License-compatibility confirmed (MPL-2.0 explicitly permits continuation).
2. Testing strategy, bootstrap plan, and deferred-work roadmap documented.
3. Forked the repository under the continuation maintainer's GitHub account; re-pointed local remotes.
4. Completed bootstrap: test infrastructure green in CI; the first three E2E smokes passing.

Outstanding (in rough order):
5. Work on a few features to get comfortable with the codebase and the TDD workflow.
6. Decide the AMO publication path — either ownership transfer from the original maintainer (preserves the existing extension ID and user base) or publication as a new extension under a new ID and name.
7. First republished release on AMO, functionally identical to the upstream's last release. This proves the publish pipeline before any code changes ship.
8. Open the issue tracker for new bug reports.

Until at least step 7 is done, this repository is not ready for general use and will not be published to AMO as an installable extension.

## For developers

- **Workflow:** red/green TDD per [`TESTING.md`](TESTING.md). Mode A for new code (extract pure logic first), Mode B for legacy code (characterize at the API seam, then refactor under green).
- **Manual dev:** `web-ext run --source-dir webextension/` after bootstrap.
- **Lint:** `eslint webextension/` and `web-ext lint --source-dir webextension/`.
- **Tests:** `npm run test:fast` is the inner TDD loop; `npm run test:e2e` runs at feature completion and on prepare-for-commit, never inside the inner loop.
- **Scope:** Firefox-only, MV2-only. Cross-browser support and MV3 migration are explicitly deferred — see [`ROADMAP.md`](ROADMAP.md). Do not introduce Chrome targets, MV3 manifest constructs, or cross-browser test matrices without an explicit decision recorded there.

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
