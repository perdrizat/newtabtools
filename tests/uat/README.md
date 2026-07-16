# UAT tier — tooling

LLM-driven user-acceptance testing. Design + rationale: [`../../TESTING.md`](../../TESTING.md) "UAT tests" section. This file is the tooling/operational guide.

**Browser:** a long-lived daemon (`_tools/browser-daemon.mjs`) holds one Selenium
session for the whole run — **release-channel Firefox** by default, or **Chrome
for Testing** when `$UAT_BROWSER=chrome` (chrome-prep D6) — one parameterized
implementation, not a fork (the manifest-overlay philosophy: single source
tree). At startup it **seeds the environment** by real navigation — two passes
over a merged US/global + Swiss URL set (frecency needs ~2 visits before a site
enters `topSites`, which fills the default grid), accepting cookie banners as it
goes, then opening a top article per news site and closing the tab to seed the
recently-closed row. This seeding step is identical Selenium-driven navigation on
both browsers.

The two browsers diverge in exactly one structural way — **when** the extension
becomes present:

- **Firefox:** the `moz-extension://` UUID is pinned via a pre-seeded pref, and
  only **after** the environment seed does the daemon install the unsigned
  extension temporarily (`installAddon(xpi, true)`) — an authentic new-user
  first render (history-filled grid, no thumbnails yet).
- **Chrome:** there is no mid-session unpacked-install equivalent to
  geckodriver's `installAddon` (the CDP install route needs a pipe transport
  Selenium doesn't expose), so the staged dev build (`stageDevBuild()`, a
  deterministic id from the committed dev key) is loaded via `--load-extension`
  at **launch**, before the environment seed even starts. The first-render
  authenticity approximation still holds: nothing is pinned and no tile cache
  exists yet during seeding, so no auto-thumbnail captures fire — the first new
  tab still renders a history-filled grid with no thumbnails, just with the
  extension technically resident a few minutes earlier than on Firefox.

Everything downstream of "extension present" — pin-default-favourites,
`/capture_tiles`, `/reset_extension` — is wire/DOM-driven through
`chrome.runtime.sendMessage` (Firefox answers to the `chrome.*` alias too) and
Selenium's browser-agnostic API, so none of it is browser-specific code.

The daemon exposes a localhost HTTP API on port **9876** for Firefox / **9877**
for Chrome by default (`$UAT_DAEMON_PORT` overrides either; ≠ E2E's 9222) — the
two ports let both daemons run in parallel. (E2E is unrelated — it stays on
Firefox ESR + Puppeteer-BiDi / Chrome for Testing + Puppeteer, its own tier.)

**Agent bridge:** a thin MCP server (`_tools/mcp-server.mjs`) Claude spawns per
scenario that forwards each `browser_*` tool call to the daemon — it holds no
browser state, so many cheap per-scenario MCP processes share the one warm
browser. Screenshots are disk-backed and read on demand: `browser_take_screenshot`
writes a PNG and returns the *path*; `browser_read_screenshot` pulls one *inline*
only when the agent must judge it, so image-token cost tracks what's judged.

## What's here

| File | Purpose | Needs SDK? |
|---|---|---|
| `_tools/browser-daemon.mjs` | long-lived browser host (Firefox or Chrome, `$UAT_BROWSER` + environment seed + HTTP API) | no |
| `_tools/urls.mjs` | shared extension-origin URL builder (`moz-extension://`/`chrome-extension://`) | no |
| `_tools/mcp-server.mjs` | thin MCP→HTTP client to the daemon | yes |
| `_tools/mcp-config.json` | config Claude reads to spawn the MCP server | — |
| `_tools/daemon-smoke.mjs` | daemon HTTP-API contract smoke | no |
| `_tools/mcp-smoke.mjs` | full MCP path; prints payload sizes | yes |
| `_tools/browser-smoke.mjs` | standalone browser-path check (no MCP, Firefox only) | no |
| `_tools/fallback-cli.mjs` | reference fallback (CLI-over-Bash); not used by the harness | no |
| `_tools/preflight.mjs` | env validator (Node, pnpm, Firefox or Chrome per `$UAT_BROWSER`, fixture sha, claude CLI, SDK, daemon port) | no |
| `_tools/runner.mjs` | orchestrator: ensure skill symlink → preflight → start daemon → per-scenario `claude -p` → reset-to-default between → aggregated report | yes |
| `scenarios/*.md` | the scenarios the runner walks | — |
| `uat-scenario.md` | the agent skill prompt (see "Skill" below) | — |

The `newtabtools_knowngood.zip` fixture is checked in (see fixtureVersion below).

Run the whole suite with `pnpm test:uat` (Firefox) or `pnpm test:uat:chrome`
(Chrome), or a subset by slug: `pnpm test:uat 21-restore` /
`pnpm test:uat:chrome 00-uat-init`. Both share one runner and one daemon
implementation — `pnpm test:uat:chrome` is exactly
`UAT_BROWSER=chrome node tests/uat/_tools/runner.mjs`, so the two can run
concurrently (separate ports, separate `-chrome`-suffixed artifacts dir).

Scenario agents run on **Sonnet** by default (`$UAT_MODEL` overrides) —
visual judgment doesn't need the most expensive model, and a full run spawns
one `claude -p` per scenario.

Scenarios are numbered by category and run in filename order:

- **00s — env / smoke:** `00-uat-init` (verify the seeded environment), `01-default-ui` (default layout/chrome/drawer + the first-run auto-thumbnail & favicon capture).
- **10s — tiles:** `10-tile-surface` (overlay legibility, stat chip, hover action row, pin stripe), `11-action-buttons` (tile hover action row / occlusion).
- **20s — drawer:** `20-config` (live config changes), `21-restore` (restore the known-good backup), `22-advanced-tab` (Advanced tab on-system + confirm steps), `23-edit-mode-design` (Edit/Done mode affordances).
- **30s — design:** `30-typography` (font role discipline), `31-titlebar` (Board A bar + recent-chip identity), `32-high-contrast` (HC validation pass).

## Skill

The agent skill prompt is tracked here as `uat-scenario.md`, so it lives with the
rest of the tier. Claude Code loads skills from `.claude/skills/`, so the runner
keeps a symlink `.claude/skills/uat-scenario.md → ../../tests/uat/uat-scenario.md`
and recreates it at the start of every run if it's missing (e.g. a fresh clone).
`.claude/` itself stays git-ignored.

## Artifacts

Each run writes one flat, timestamped directory `artifacts/<YYYYMMDD-HHMMSS>/`
(git-ignored). Everything for the run lands there together — `report.json`
(aggregate), `daemon.log`, and per-scenario `<stamp>-<scenario>-{report.json,
summary.md,agent.log}` plus screenshots `<stamp>-<scenario>-<shot>.png`. The
shared prefix makes screenshots sort in capture order, so opening the first in an
image viewer and paging forward walks the run. Runs never overwrite each other.

## Run the smokes

```bash
# build the unsigned extension package once (writes the .xpi to ./dist/, gitignored)
pnpm build

# browser path only (no SDK needed):
node tests/uat/_tools/browser-smoke.mjs

# daemon HTTP-API contract (no SDK needed):
node tests/uat/_tools/daemon-smoke.mjs

# full MCP path + payload measurement:
node tests/uat/_tools/mcp-smoke.mjs
```

## Troubleshooting (preflight failures)

`pnpm test:uat:preflight` (also the first step of `pnpm test:uat`) prints `[ok]`/`[warn]`/`[fail]` per check. Fixes for the `[fail]`s:

| Preflight failure | Fix |
|---|---|
| **Node — need ≥ 24** | `fnm install && fnm use` (honors `.node-version`), or the `nvm` equivalent. |
| **pnpm — need ≥ 11** | `corepack enable && corepack prepare pnpm@11.6.0 --activate`. |
| **Firefox — did not report a Firefox version**, or **emits wrapper noise (`xdg-settings`)** | The release `firefox` is the Ubuntu **snap** shim and is broken/noisy for geckodriver. Either `sudo apt install xdg-utils` (un-break the wrapper), or — preferred — install the **Mozilla APT** build so `firefox` is a real binary, or point `$FIREFOX_BIN` at one. |
| **Firefox — not found** | Install release Firefox (Mozilla APT) or set `$FIREFOX_BIN`. |
| **Built .xpi — not found / older than manifest** | `pnpm build` (writes `dist/newtab_powertools-<version>.zip`). |
| **UAT fixture — sha256 mismatch** | Unintentional: restore `newtabtools_knowngood.zip` from git. Intentional regen: bump `fixtureVersion` + update the hash here and in `preflight.mjs`. |
| **claude CLI — not found** | Install per <https://docs.claude.com/claude-code>, then `claude /login`. |
| **@modelcontextprotocol/sdk — not resolvable** | `pnpm install`. |
| **UAT daemon port — in use / collides with 9222** | Stop the other process, or set `$UAT_DAEMON_PORT` to a free port ≠ 9222. |

## Dependencies

- `selenium-webdriver@4.44.0` (pinned per CONTRIBUTING supply-chain guardrails).
- `@modelcontextprotocol/sdk@1.29.0` (pinned 2026-06-02). Selected because it was the npm `dist-tags.latest` at pinning time, well past the `.npmrc` `minimum-release-age=604800` (7-day) supply-chain floor. Bump cadence: review on each UAT-runner change that touches MCP tool schemas.
- geckodriver — provisioned by Selenium Manager on first run, or installed onto PATH.
- release Firefox — on PATH or via `$FIREFOX_BIN`.

## fixtureVersion

**`fixtureVersion: 2`** — `newtabtools_knowngood.zip` (checked in; ~0.9 MB).
`sha256: 07e89b741dcc388eaa209740265698c46a1e09eb274e873e97750bf411339348`.

Contents: `prefs.json` (4×4 grid, medium spacing/title/margin, opacity 80, system
theme + auto-follow, `tileAspect: fill`, recent + history on, Mozilla-CDN
wallpaper), `tiles.json` (9 tiles at **positions 0–8**, ids 1–9), and
`tileImages/{1,2}.png` (only ids 1 and 2 carry stored thumbnails; the rest use
the favicon/letter fallback). A restore of this fixture yields a 16-cell (4×4)
grid with 9 populated `.newtab-site` tiles, rendered live.

The fixture is the test contract — `preflight.mjs` checks its sha256 against the
value above. It must be valid JSON (a malformed backup is dropped by `readZip`).
On any regeneration, bump `fixtureVersion`, update the hash here and in
`preflight.mjs`, and keep it under 5 MB. A schema change (new prefs key or tile
field) invalidates the comparison baseline scenarios assume.

> The .xpi the tools install lives under `dist/` (canonical build output, shared with AMO
> release; written by `pnpm build`). UAT-specific evidence (screenshots, scenario reports)
> lives under `tests/uat/artifacts/`. Both are git-ignored. Override resolution via
> `XPI_DIR=` (where the tools look for the .xpi) or `EXTENSION_XPI=` (explicit path).
