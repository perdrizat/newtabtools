# UAT tier — tooling

LLM-driven user-acceptance testing. Full design + rationale: [`../../UAT_PLAN.md`](../../UAT_PLAN.md).

**Backend:** Selenium + geckodriver driving **release-channel Firefox**, with the
unsigned extension installed temporarily (`installAddon(xpi, true)`) and the
`moz-extension://` UUID pinned via a pre-seeded pref. (E2E is unrelated — it
stays on Firefox ESR + Puppeteer-BiDi.)

**Agent bridge:** a small MCP server (`_tools/mcp-server.mjs`) that holds the
Selenium session and exposes `browser_*` tools. Screenshot strategy is **Option
C** (decided 2026-06-01, see UAT_PLAN.md): `browser_take_screenshot` writes a PNG
to disk and returns the *path*; `browser_read_screenshot` pulls one *inline on
demand* — so the agent pays the image-token cost only for shots it must judge.

## What's here now (prototype stage)

| File | Purpose | Needs SDK? |
|---|---|---|
| `_tools/mcp-server.mjs` | the MCP browser-control server (Option C) | yes |
| `_tools/mcp-smoke.mjs` | drives the server, prints payload sizes | yes |
| `_tools/mcp-config.json` | config Claude reads to spawn the server | — |
| `_tools/browser-smoke.mjs` | standalone browser-path check (no MCP) | no |
| `_tools/fallback-cli.mjs` | Plan-B reference: CLI-over-Bash + daemon (rejected; kept for reference) | no |

The `newtabtools_knowngood.zip` fixture is checked in (see fixtureVersion below).
Still to build (see UAT_PLAN.md Steps 1–6): `preflight.ts`, `runner.ts`,
`scenarios/*.md`, and `.claude/skills/uat-scenario.md`.

## Run the smokes

```bash
# build the unsigned extension package once (into the gitignored artifacts dir)
npx web-ext build --source-dir webextension/ --artifacts-dir tests/uat/artifacts --overwrite-dest

# browser path only (no SDK needed):
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/browser-smoke.mjs

# full MCP path + payload measurement (after `npm i -D @modelcontextprotocol/sdk`):
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/mcp-smoke.mjs
```

## Dependencies

- `selenium-webdriver` (pin exact, per CONTRIBUTING supply-chain guardrails).
- `@modelcontextprotocol/sdk` — **not yet installed**; pin exact when added and
  record the version + date here.
- geckodriver — provisioned by Selenium Manager on first run, or installed onto PATH.
- release Firefox — on PATH or via `$FIREFOX_BIN`.

## fixtureVersion

**`fixtureVersion: 1`** — `newtabtools_knowngood.zip` (checked in; ~2.1 MB).
`sha256: 7f36e5410182f95e6cc4a9023361968694b9ff882dbdc38dbbcf683cd56fa8e6`.

Contents: `prefs.json` (4×4 grid, medium spacing/title/margin, opacity 80, system
theme + auto-follow, `tileAspect: fill`, recent + history on, Mozilla-CDN
wallpaper, populated blocklist), `tiles.json` (9 tiles at **positions 0–8**;
ids 1/2/4/8/9 carry thumbnails), and `tileImages/{1,2,4,8,9}.png`.

Bump `fixtureVersion` and update the hash here on every regeneration (a schema
change — new prefs key or tile field — invalidates the comparison baseline that
scenarios assume).

> `artifacts/` is git-ignored. Pinned dependency versions and a troubleshooting
> section (keyed to preflight failure messages) get added here as the tier is built out.
