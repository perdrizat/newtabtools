# NewTab PowerTools

A new tab page for Firefox, built around the sites you actually visit and laid out the way you want — **PowerTools for your browser**, extending the new tab experience much like Microsoft PowerToys does for Windows.

**Available on [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/newtab-powertools/).** NewTab PowerTools is the actively-maintained continuation of Geoff Lankow's *New Tab Tools* (MPL-2.0, see the maintainer's note below). The **v2 release** reworks the UI to sit closer to today's Firefox new tab page while keeping the power-user controls: a single titlebar row (recently-closed cards · an awesome bar that searches your tiles, bookmarks, and history · controls), a slide-in **configuration drawer** (Tile / Page / Advanced), a **theme system** (system / light / dark / high-contrast), and **real favicons** on tiles. It's backed by a deep, mandatory test suite — 1000+ unit/integration tests (Vitest + jsdom) and 100+ E2E tests against Firefox ESR (Puppeteer + WebDriver BiDi), plus an LLM-driven UAT tier — run on every change.

## Main features

> Firefox's built-in new tab page covers the basics: drag-to-reorder shortcuts, custom titles, a custom uploaded image per tile, and (since version 138) custom wallpapers. NTT replaces that page entirely and adds the controls and visual cues the default doesn't expose.

- **Tiles you can actually see.** Firefox's built-in shortcuts stay small no matter how few you choose, reserving the unused space rather than reflowing. NTT lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and the tiles scale to fill the viewport. Big enough to read titles and recognize pages at a glance.
- **Tiles that look like the sites they link to.** NTT auto-captures a thumbnail of each top site the way it actually appeared the last time you visited, and uses that as the tile image. Firefox's native shortcuts only accept a manual image upload, which never reflects the live page. The capture uses a multi-stage approach (immediate, 500ms, and 2s network-idle) with blankness detection to handle heavy SPAs like X.com.
- **Pixel-level layout control.** Pick exact rows and columns, lock a tile aspect ratio (16:9, 4:3, 1:1, 3:4 portrait, or fill-viewport), tune foreground opacity, tile title size, page margins, and grid spacing — then lock the grid so you don't reorder it by accident. None of these knobs are exposed in Firefox's native page.
- **Top sites that aren't dominated by one domain.** Cap how many tiles a single host can take (with subdomain wildcards like `.example.com`), hide auto-generated history tiles entirely, or pull pin suggestions from your open tabs, bookmarks, and history via autocomplete. Native Firefox enforces a hard "one tile per domain" rule and offers no autocomplete in its Add Shortcut form.
- **Per-tile personalization.** Set a custom background color per tile (native supports a custom *image* but not a *color*), edit titles and URLs, manually upload a thumbnail when auto-capture isn't an option (login walls, dark pages, sites you haven't visited yet).
- **Recovery and portability.** A row of recently closed tabs lives in the titlebar for one-click restore — Firefox's native "Recent activity" surfaces visited pages and bookmarks, but not closed-tab session restore. Export your tiles, thumbnails, and settings to a single backup file and restore on another machine, no Firefox Sync required.

## What's in this repo

- `webextension/` — the extension source. Currently MV2, Firefox-only, minimum version pinned to the latest Firefox ESR.
- [`MV3_MIGRATION.md`](MV3_MIGRATION.md) — the active migration plan for Manifest V3 (Firefox-only first, Chrome deferred).
- [`TESTING.md`](TESTING.md) — the canonical testing guide. Test tiers (Unit, Integration, E2E, plus a pre-release LLM-driven UAT tier) using Vitest + jsdom for the first two and Puppeteer + WebDriver BiDi against Firefox ESR for E2E, with `jest-webextension-mock` mocking the WebExtension API surface at the Integration tier. Includes the TDD-cycle rules for new vs. legacy code. Required reading before touching the code.
- [`ROADMAP.md`](ROADMAP.md) — direction (Now / Next / Later), scope & non-goals, backlog, and the load-bearing decisions of record.
- [`CHANGELOG.md`](CHANGELOG.md) — Keep a Changelog format.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — developer guide, TDD workflow, AI-assisted contribution guardrails.

## For developers
 
If you want to contribute to NewTab PowerTools, please read the **[Contributing Guide](CONTRIBUTING.md)** first. 

### Quick Start

1. **Environment Setup:** You will need Node.js >= 22, `pnpm` >= 10, and Firefox ESR. See the **[Environment Setup Guide](TESTING.md#environment-setup)** for installation instructions.

2. **Clone and install:**
   ```bash
   git clone git@github.com:perdrizat/newtabtools.git
   cd newtabtools
   pnpm install
   ```

3. **Build the XPI and load it in Firefox:**
   ```bash
   pnpm build
   ```
   This syncs the version into `manifest.json` and packages the add-on to `dist/newtab_powertools-<version>.zip` (a zip *is* an XPI — Firefox accepts either extension). To load it into your own browser profile via the debug interface:
   1. Open `about:debugging#/runtime/this-firefox`.
   2. Click **Load Temporary Add-on…**.
   3. Select `dist/newtab_powertools-<version>.zip` — or pick `webextension/manifest.json` to load the unpacked source directly.

   The add-on stays loaded until you restart Firefox. For a throwaway run in a fresh profile that's discarded on exit, use `pnpm dev` instead.

### Testing is mandatory
Because of the advent of AI coding assistants, **testing is mandatory** and we employ a strict red/green TDD workflow. See the **[Testing Guide](TESTING.md)** for:
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
