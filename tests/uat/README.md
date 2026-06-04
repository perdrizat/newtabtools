# UAT tier — tooling

LLM-driven user-acceptance testing. Design + rationale: [`../../TESTING.md`](../../TESTING.md) "UAT tests" section. This file is the tooling/operational guide.

**Browser:** a long-lived daemon (`_tools/browser-daemon.mjs`) holds one Selenium
+ geckodriver session driving **release-channel Firefox** for the whole run, with
the unsigned extension installed temporarily (`installAddon(xpi, true)`) and the
`moz-extension://` UUID pinned via a pre-seeded pref. It seeds history with a
fixed set of URLs at startup and exposes a localhost HTTP API on port **9876**
(`$UAT_DAEMON_PORT`; ≠ E2E's 9222). (E2E is unrelated — it stays on Firefox ESR +
Puppeteer-BiDi.)

**Agent bridge:** a thin MCP server (`_tools/mcp-server.mjs`) Claude spawns per
scenario that forwards each `browser_*` tool call to the daemon — it holds no
browser state, so many cheap per-scenario MCP processes share the one warm
browser. Screenshots are disk-backed and read on demand: `browser_take_screenshot`
writes a PNG and returns the *path*; `browser_read_screenshot` pulls one *inline*
only when the agent must judge it, so image-token cost tracks what's judged.

## What's here

| File | Purpose | Needs SDK? |
|---|---|---|
| `_tools/browser-daemon.mjs` | long-lived browser host (Firefox + history seed + HTTP API) | no |
| `_tools/mcp-server.mjs` | thin MCP→HTTP client to the daemon | yes |
| `_tools/mcp-config.json` | config Claude reads to spawn the MCP server | — |
| `_tools/daemon-smoke.mjs` | daemon HTTP-API contract smoke | no |
| `_tools/mcp-smoke.mjs` | full MCP path; prints payload sizes | yes |
| `_tools/browser-smoke.mjs` | standalone browser-path check (no MCP) | no |
| `_tools/fallback-cli.mjs` | reference fallback (CLI-over-Bash); not used by the harness | no |
| `_tools/preflight.mjs` | env validator (Node, pnpm, Firefox, .xpi, fixture sha, claude CLI, SDK, daemon port) | no |
| `_tools/runner.mjs` | orchestrator: ensure skill symlink → preflight → start daemon → per-scenario `claude -p` → reset between → aggregated report | yes |
| `scenarios/*.md` | the scenarios the runner walks | — |
| `uat-scenario.md` | the agent skill prompt (see "Skill" below) | — |

The `newtabtools_knowngood.zip` fixture is checked in (see fixtureVersion below).

Run the whole suite with `pnpm test:uat`, or a subset by slug: `pnpm test:uat 01-restore-dogfood`.

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
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/browser-smoke.mjs

# daemon HTTP-API contract (no SDK needed):
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/daemon-smoke.mjs

# full MCP path + payload measurement:
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/mcp-smoke.mjs
```

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
> Pinned dependency versions and a troubleshooting section (keyed to preflight failure
> messages) get added here as the tier is built out.
