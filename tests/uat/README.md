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
# build the unsigned extension package once (writes the .xpi to ./dist/, gitignored)
pnpm build

# browser path only (no SDK needed):
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/browser-smoke.mjs

# full MCP path + payload measurement (after `pnpm add -D @modelcontextprotocol/sdk@<pinned>`):
FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/mcp-smoke.mjs
```

## Dependencies

- `selenium-webdriver@4.44.0` (pinned per CONTRIBUTING supply-chain guardrails).
- `@modelcontextprotocol/sdk@1.29.0` (pinned 2026-06-02). Selected because it was the npm `dist-tags.latest` at pinning time, well past the `.npmrc` `minimum-release-age=604800` (7-day) supply-chain floor. Bump cadence: review on each UAT-runner change that touches MCP tool schemas.
- geckodriver — provisioned by Selenium Manager on first run, or installed onto PATH.
- release Firefox — on PATH or via `$FIREFOX_BIN`.

## fixtureVersion

**`fixtureVersion: 1`** — `newtabtools_knowngood.zip` (checked in; ~2.1 MB).
`sha256: f184515d564694d020cc0431f576a645b57bb9ae86040672c405760675ac0103` (verified 2026-06-02; the prior recorded hash `7f36e54…` had drifted from a fixture regeneration that didn't refresh this doc — content shape unchanged per `prefs.json` + `tiles.json` inspection).

Contents: `prefs.json` (4×4 grid, medium spacing/title/margin, opacity 80, system
theme + auto-follow, `tileAspect: fill`, recent + history on, Mozilla-CDN
wallpaper, populated blocklist), `tiles.json` (9 tiles at **positions 0–8**;
ids 1/2/4/8/9 carry thumbnails), and `tileImages/{1,2,4,8,9}.png`.

Bump `fixtureVersion` and update the hash here on every regeneration (a schema
change — new prefs key or tile field — invalidates the comparison baseline that
scenarios assume).

> The .xpi the tools install lives under `dist/` (canonical build output, shared with AMO
> release; written by `pnpm build`). UAT-specific evidence (screenshots, scenario reports)
> lives under `tests/uat/artifacts/`. Both are git-ignored. Override resolution via
> `XPI_DIR=` (where the tools look for the .xpi) or `EXTENSION_XPI=` (explicit path).
> Pinned dependency versions and a troubleshooting section (keyed to preflight failure
> messages) get added here as the tier is built out.
