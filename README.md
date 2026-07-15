# NewTab PowerTools

A new tab page for Firefox, built around the sites you actually visit and laid out the way you want — **PowerTools for your browser**, extending the new tab experience much like Microsoft PowerToys does for Windows.

**Available on [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/newtab-powertools/).** NewTab PowerTools is the actively-maintained continuation of Geoff Lankow's *New Tab Tools* (MPL-2.0, see the maintainer's note below). The **v2 release** reworks the UI to sit closer to today's Firefox new tab page while keeping the power-user controls: a single titlebar row (recently-closed cards · an awesome bar that searches your tiles, bookmarks, and history · controls), a slide-in **configuration drawer** (Tile / Page / Advanced), a **theme system** (system / light / dark / high-contrast), and **real favicons** on tiles. It's backed by a deep, mandatory test suite — 1000+ unit/integration tests (Vitest + jsdom) and 100+ E2E tests against release-channel Firefox (Puppeteer + WebDriver BiDi), plus an LLM-driven UAT tier — run on every change.

## Main features

> Firefox's built-in new tab page covers the basics: drag-to-reorder shortcuts, custom titles, a custom uploaded image per tile, and (since version 138) custom wallpapers. NTT replaces that page entirely and adds the controls and visual cues the default doesn't expose.

- **Tiles you can actually see.** Firefox's built-in shortcuts stay small no matter how few you choose, reserving the unused space rather than reflowing. NTT lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and the tiles scale to fill the viewport. Big enough to read titles and recognize pages at a glance.
- **Tiles that look like the sites they link to.** NTT auto-captures a thumbnail of each top site the way it actually appeared the last time you visited, and uses that as the tile image. Firefox's native shortcuts only accept a manual image upload, which never reflects the live page. The capture uses a multi-stage approach (immediate, 500ms, and 2s network-idle) with blankness detection to handle heavy SPAs like X.com.
- **Pixel-level layout control.** Pick exact rows and columns, lock a tile aspect ratio (16:9, 4:3, 1:1, 3:4 portrait, or fill-viewport), tune foreground opacity, tile title size, page margins, and grid spacing — then lock the grid so you don't reorder it by accident. None of these knobs are exposed in Firefox's native page.
- **Top sites that aren't dominated by one domain.** Cap how many tiles a single host can take (with subdomain wildcards like `.example.com`), hide auto-generated history tiles entirely, or pull pin suggestions from your open tabs, bookmarks, and history via autocomplete. Native Firefox enforces a hard "one tile per domain" rule and offers no autocomplete in its Add Shortcut form.
- **Per-tile personalization.** Set a custom background color per tile (native supports a custom *image* but not a *color*), edit titles and URLs, manually upload a thumbnail when auto-capture isn't an option (login walls, dark pages, sites you haven't visited yet).
- **Never-capture list (privacy).** Exclude any site from auto-thumbnail capture — one click on a tile's ✕-camera button, or manage the list in the Advanced drawer (exact host, or `.example.com` to cover subdomains). Listed hosts are never screenshotted, and adding one deletes any captures already stored for it. Keep banking, webmail, and intranets out of your tile imagery and backups. Firefox's native page has no such control.
- **Recovery and portability.** A row of recently closed tabs lives in the titlebar for one-click restore — Firefox's native "Recent activity" surfaces visited pages and bookmarks, but not closed-tab session restore. Export your tiles, thumbnails, and settings to a single backup file and restore on another machine, no Firefox Sync required.

## Scope

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

Firefox's own new-tab page (Activity Stream) is a chrome-privileged system add-on:
its features can't be submitted upstream, and its code can't be ported into a
WebExtension. NTT reimplements parity behaviour in WebExtension scope, using
Activity Stream only as a behavioural reference.

**Won't build** (native features out of scope by design — NTT's pitch is layout
precision and personalization, not content surfaces): Pocket / Recommended Stories,
sponsored shortcuts, the weather widget, and Mozilla's experimental Lists/Timer
widgets. Users who want these stay on the native page.

## What's in this repo

- `webextension/` — the extension source. Manifest V3, Firefox-only, minimum version Firefox 152. The new tab page is an HTML5 document (`newTab.html`) loaded through a single ES-module entry (`page-main.js`) fanning out into ~20 feature modules; the background is a modular ES-module architecture under `webextension/lib/` (single entry `lib/background-main.js`). See [`CONTRIBUTING.md`](CONTRIBUTING.md) "Architecture" for the module breakdown.
- [`TESTING.md`](TESTING.md) — the canonical testing guide. Test tiers (Unit, Integration, E2E, plus a pre-release LLM-driven UAT tier) using Vitest + jsdom for the first two and Puppeteer + WebDriver BiDi against release-channel Firefox (>= 152) for E2E, with `jest-webextension-mock` mocking the WebExtension API surface at the Integration tier. Includes the TDD-cycle rules for new vs. legacy code. Required reading before touching the code.
- [`CHANGELOG.md`](CHANGELOG.md) — Keep a Changelog format.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — developer guide, TDD workflow, decisions of record, AI-assisted contribution guardrails. Completed-arc working documents (the MV3 migration, background-modules + HTML5 modernization, the page-modules arc, the chrome-prep program) live in git history and their reviews in [`audit/`](audit/).

## For developers
 
If you want to contribute to NewTab PowerTools, please read the **[Contributing Guide](CONTRIBUTING.md)** first. 

### Quick Start

1. **Environment Setup:** You will need Node.js >= 24, `pnpm` >= 11, and release-channel Firefox (>= 152). See the **[Environment Setup Guide](TESTING.md#environment-setup)** for installation instructions.

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

### Troubleshooting

Hit a failing `pnpm test:uat:preflight` or a broken E2E setup? Search this table for the exact text you saw. It covers the most common cases; the full preflight-check list lives in [`tests/uat/README.md`](tests/uat/README.md#troubleshooting-preflight-failures) and general environment setup in [`TESTING.md`](TESTING.md#environment-setup).

| You see | Cause | Fix |
|---|---|---|
| `Firefox (release)` ... `not found` | No `firefox` binary on PATH | Install release Firefox — Mozilla APT repo, see `TESTING.md` — or set `$FIREFOX_BIN`. |
| `is below the minimum required version (152)` | Firefox on PATH is older than 152 | MV3's `tabs.captureVisibleTab` needs Firefox >= 152; upgrade Firefox or point `$FIREFOX_BIN`/`$FIREFOX_ESR_BIN` at a newer build. |
| `'$FIREFOX_BIN' not found on PATH` (from `run_esr_tests.sh`) | Same root cause, E2E's own guard | Same fix as above. |
| `claude CLI` ... `not found on PATH` | Claude Code CLI isn't installed | Install per <https://docs.claude.com/claude-code>, then `claude /login`. |
| A UAT scenario fails with an auth error even though `claude --version` works | CLI installed but not logged in, or the session expired | Run `claude /login` again. |
| `Built .xpi` ... `not found in dist/` | `pnpm build` hasn't been run (or is stale) | `pnpm build`. |
| `UAT fixture` ... `sha256 mismatch` | `newtabtools_knowngood.zip` was modified or corrupted | Restore it from git (unintentional change), or bump `fixtureVersion` (intentional regen) — see `tests/uat/README.md`. |
| `UAT daemon port` ... `already in use` | Something else is already bound to port 9876 | Stop the other process, or set `$UAT_DAEMON_PORT`. |
| `Firefox launch (geckodriver)` ... `Selenium could not start Firefox via geckodriver` | geckodriver missing, mismatched, or a snap-confined build shadowing it on PATH | Remove a snap-confined `geckodriver` from PATH so Selenium Manager can fetch a clean one, or run `pnpm install`. |
| `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` | pnpm wants to reinstall/prune `node_modules` but has no interactive TTY to confirm it | Run `pnpm install` yourself in an interactive shell. |
| `[chrome-smoke] x no Chrome binary found` | The forward-looking Chrome tier (`pnpm chrome:smoke`, `tests/e2e-chrome/`) can't find a Chrome/Chromium binary | Install Chrome (the Google `.deb`) or set `$CHROME_BIN`. |

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
