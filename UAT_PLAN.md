# UAT Plan — LLM-driven user acceptance testing

A new test tier above E2E: an LLM agent walks through scenarios, judges whether things look and work correctly, and produces a human-reviewable report. Replaces the manual pre-release QA pass with an automated one that runs the same scenarios faster, generates evidence artifacts, and catches the bug class structural tests miss (occlusion, contrast, layering, "looks broken to a user").

This plan uses **Claude Code in headless mode** (not the Claude API) as the agent driver. Browser control is split in two: a **long-lived browser daemon** (`browser-daemon.mjs`) owns one **Selenium + geckodriver** session driving **Firefox (release channel)** for the whole run, and **our own thin MCP server** forwards the agent's tool calls to it over a localhost HTTP API. The scenarios are plain English. The whole tier is opt-in (`pnpm test:uat`), gated on a separate model budget, and never blocks PR merges. (The daemon split landed in B7 — see "Revised 2026-06-02" under Spike outcome.)

> **UAT and E2E use different browser stacks — deliberately.** E2E stays on **Firefox ESR via `web-ext` + Puppeteer-over-WebDriver-BiDi** (real min-version build, native unsigned sideload, deterministic-assertion tests). UAT runs on **release-channel Firefox via Selenium + geckodriver**, because UAT's job is "does this look right *to a user*," and most users are on release, not ESR. UAT's bug class (occlusion / contrast / layout) is the least build-sensitive thing we test, so running it on a *newer, more user-representative* Gecko is a feature, not a risk — and it gives a free differential signal (a UAT finding that doesn't reproduce on the ESR E2E rig is a candidate version-specific issue). This split was validated by a working prototype (now `tests/uat/_tools/browser-smoke.mjs`); see the 2026-06-01 revision under Spike outcome.

## Goals

1. Catch user-visible regressions (the "thumbnails occluded by overlay" bug class) before AMO releases without writing more pixel-fragile tests.
2. Stay in the existing repo conventions: ESM Node (`.mjs`) tooling, artifacts under `tests/uat/artifacts/`. Browser control is **Selenium + geckodriver against release-channel Firefox** (not the E2E tier's ESR/BiDi stack — see the note above), held by a long-lived daemon.
3. Use the developer's existing Claude Code subscription rather than provisioning a separate Anthropic API key.
4. Produce structured JSON reports + annotated screenshots as artifacts. Treat results as "investigate" not "build pass/fail."
5. Work on any contributor's machine without manual setup beyond `pnpm install` + a one-time `claude /login`. The harness checks its own prerequisites and either auto-installs them or prints precise next-step instructions.
6. Run every scenario against the **same known-good starting state** — a checked-in NTT backup zip — so findings reflect the code change, not profile drift.

## Non-goals

- Replacing unit / integration / E2E tests. UAT runs slower, costs money, and is non-deterministic — keep the deterministic tiers as the source of truth for behavior.
- Running on every commit or every PR. Pre-release only.
- Cross-browser testing. Firefox only (release channel for UAT; ESR for E2E). No Chrome/WebKit.
- Visual baseline / pixel-diff. Each scenario's "What to judge" section is fully self-contained in language; no reference images. Revisit once the design stabilizes (post-AMO + post-NTT-v2).

---

## Spike outcome (2026-05-21)

The Step 0 spike rejected two architectural options before settling on the third. Recorded here so future maintainers don't re-run the same investigation.

### Rejected: `@playwright/mcp` against external Firefox ESR

Microsoft's `@playwright/mcp` is the obvious off-the-shelf choice. The spike confirmed two independent blockers, both downstream of the same root cause (Playwright wants to own the browser; our setup needs to keep using system `firefox-esr` via `web-ext`):

1. **No external-attach for Firefox.** `@playwright/mcp`'s external-browser modes (`--cdp-endpoint`, the companion "Playwright Extension") are Chrome/Edge only. There is no equivalent for Firefox — the only way to use it for Firefox is to let it launch its own browser.
2. **Playwright cannot drive system Firefox ESR.** Confirmed by a direct `playwright-core` test: launching `/usr/bin/firefox-esr` via `firefox.launchPersistentContext` passes `-juggler-pipe` (Playwright's custom protocol), which Firefox ESR does not understand. The handshake times out. Playwright Firefox = Playwright's patched `firefox-1522` build, not the build users actually install.

Together: the cleanest use of `@playwright/mcp` would be to let it own a Playwright-bundled Firefox, which means **UAT would test a different browser than the E2E tier and the AMO release**. That undermines the value of the UAT tier — render differences between Playwright Firefox and ESR could mask real bugs or fabricate fake ones.

This is the **same root cause** that already kept Playwright out of the E2E tier (documented in `tests/e2e/README.md`).

### Rejected: Bash + standalone CLI scripts (`tests/uat/_tools/uat-cli.ts <subcommand>`)

The agent would call e.g. `Bash(tsx uat-cli.ts screenshot 01-loaded.png)`. Kept warm as a fallback. Rejected as primary for two reasons:

1. **Screenshot turn cost.** UAT is screenshot-heavy. MCP tool results return image content inline; the agent sees the screenshot in the same turn. With CLI+Bash, every screenshot becomes two events: `Bash → save-to-disk → return path`, then `Read → load image`. That's roughly 2× the agent loop iterations per screenshot. Across 5 scenarios × ~10 screenshots each, we'd push past the `--max-turns 50` cap that exists for cost control.
2. **Allowlist precision.** `--allowedTools "mcp__ntt-uat__*"` confines the agent to named tools. A `Bash(tsx tests/uat/_tools/uat-cli.ts *)` allowlist is necessarily wider — Bash glob matching covers anything that fits the pattern.

### Chosen (2026-05-21 — backend later revised, see below): roll our own MCP server, wrapping the existing Puppeteer-over-BiDi setup

`tests/uat/_tools/mcp-server.ts` is a stdio MCP server using `@modelcontextprotocol/sdk`. It holds a Puppeteer connection to the Firefox-ESR launched by `web-ext` (the same lifecycle the E2E tier uses), and exposes a small set of MCP tools (`browser_navigate`, `browser_click`, `browser_hover`, `browser_file_upload`, `browser_take_screenshot`, `browser_snapshot`, `browser_evaluate`). The tool names are deliberately compatible with `@playwright/mcp`'s schema so scenarios and the skill prompt stay portable if a better off-the-shelf option emerges later.

Trade-off accepted: ~150 LOC of new code we own and maintain, versus an off-the-shelf option that tests the wrong browser.

### Revised 2026-06-01: UAT backend → Selenium + Firefox release (E2E unchanged)

The original spike chained UAT onto the E2E tier's `web-ext`-launched **Firefox ESR** over Puppeteer-BiDi, reusing `tests/e2e/_helpers.ts`. A follow-up investigation (Playwright vs. Selenium vs. our rig) changed the UAT backend — **E2E is untouched and stays on ESR/BiDi**. What changed and why:

- **Browser:** release-channel Firefox, not ESR. UAT judges user-visible rendering, and the median user is on release; the visual bug class UAT targets is the least build-sensitive thing we test. Bonus: a UAT finding that doesn't reproduce on the ESR E2E rig is a candidate **version-specific** issue.
- **Driver:** **Selenium WebDriver + geckodriver**, not Puppeteer-over-BiDi. geckodriver owns the browser lifecycle (launch + teardown), which eliminates the hand-rolled `run_esr_tests.sh` process-management flakiness (stale `firefox-esr` → port-9222 collisions) that the E2E rig is prone to.
- **Extension load:** Selenium `driver.installAddon(<xpi>, /* temporary */ true)` — installs the **unsigned** packaged extension natively, and **temporary installs work on the release channel** (no ESR signature-relaxation needed). Replaces the `web-ext` sideload for UAT.
- **New-tab URL:** `about:newtab` shows Firefox's default page under automation, so we navigate to the extension's own page. The `moz-extension://<uuid>` host is **pinned deterministically** by pre-seeding the `extensions.webextensions.uuids` pref at launch — cleaner than the E2E rig's brittle `prefs.js` scrape (`getExtensionUUID`).
- **Why not `@playwright/mcp` / `@playwright/cli` now that UAT accepts a non-ESR build?** Still no: Playwright's Firefox-extension support is Chromium-only (loading a FF extension needs an unsupported `policies.json` hack into Playwright's *patched* build), and its CDP/extension attach modes are Chrome/Edge-only. Selenium loads a Firefox extension into an **unpatched real** Firefox in one supported call. Off-the-shelf Selenium MCP servers exist (e.g. `angiejones/mcp-selenium`) but don't expose `installAddon`, so we keep our own thin MCP server (now Selenium-backed).

**Validated:** `tests/uat/_tools/browser-smoke.mjs` (promoted from the prototype) launches release Firefox, installs the unsigned extension temporarily, pins the UUID, navigates to `newTab.xhtml`, and screenshots the rendered v2 page — launch→install→render→shot→teardown in ~2s, geckodriver-managed. The sections below reflect this backend.

### Decided 2026-06-01: screenshot delivery → disk-backed + on-demand inline read (Option C)

A second prototype round compared three ways for the agent to receive screenshots, since UAT is screenshot-heavy and that dominates its token cost:

- **A — MCP inline (eager).** `browser_take_screenshot` returns the PNG inline. Simplest, but *every* shot enters context whether judged or not, and a large/full-page shot can exceed `MAX_MCP_OUTPUT_TOKENS` and get spilled to disk + a file reference anyway.
- **B — CLI over Bash + disk** (the `@playwright/cli` shape). Token-thrifty deferral, but a stateful browser CLI needs a persistent **daemon** each command attaches to (extra moving part), and a necessarily broad `Bash(node …*)` allowlist.
- **C — MCP, disk-backed + on-demand read (✅ chosen).** `browser_take_screenshot` writes a PNG to disk and returns the *path*; `browser_read_screenshot` pulls one *inline* only when the agent needs to judge it.

**Measured:** one viewport shot is 1366×682 ≈ **1243 image tokens when viewed** — identical across A/B/C, because that's pixel cost, not transport. So the headline "CLI is 4–32× cheaper than MCP" does **not** transfer to UAT: that gap is tool-schema + verbose-data overhead on *data* tasks; UAT's bytes are screenshots that must be viewed regardless. The only real token lever is *whether/when* an image enters context — and **C captures that lever** (skip pure-evidence shots, defer reads) while keeping MCP's structural wins: **one server process IS the browser daemon** (no separate launch script — B's main cost) and a tight `mcp__ntt-uat__*` allowlist (no broad Bash). C also sidesteps A's `MAX_MCP_OUTPUT_TOKENS` spill.

**Prototypes (in `tests/uat/_tools/`):** `mcp-server.mjs` (C), `mcp-smoke.mjs` (payload measurement), `browser-smoke.mjs` (browser path, no SDK), `fallback-cli.mjs` (B, kept as the Plan-B reference). `mcp-smoke.mjs` prints the wire payloads — fixed schema overhead, the tiny disk-path result, and an on-demand inline read — so the token model stays honest once `@modelcontextprotocol/sdk` is installed.

### Revised 2026-06-02: long-lived browser daemon + thin MCP client (B7)

The earlier design folded the browser into the MCP server — "one server process IS the browser daemon" — so each `claude -p` scenario launched its own Firefox, installed the extension, and (later) would have seeded history, paying that cost once **per scenario**. Two requirements made that untenable and drove a split:

1. **History-seeded environment.** Scenarios need NTT's history-backed features (recent tiles, autocomplete) to have real data to render against. Seeding nine real URLs by navigation takes seconds-to-minutes; paying it per scenario is wasteful and, on slow links, prohibitive.
2. **Browser persistence across scenarios.** Keeping one warm Firefox for the whole run (instead of relaunch-per-scenario) is both faster and the established pattern (browserless / Playwright `launch-server` / Selenium Grid all separate the browser runtime from the client).

So the browser runtime is now a **separate long-lived process** from the agent's MCP context:

- **`browser-daemon.mjs`** — a standalone Node process that owns the single Selenium + release-Firefox session for the entire run. At startup it installs the extension, **seeds history with 9 URLs**, then exposes a localhost HTTP API (`/navigate`, `/click`, `/evaluate`, `/file_upload`, `/screenshot`, `/reset_extension`, `/health`) on **port 9876** (`$UAT_DAEMON_PORT`; deliberately ≠ E2E's 9222). Logs to `tests/uat/artifacts/daemon.log`.
- **`mcp-server.mjs`** is now a **thin MCP→HTTP client**: it forwards each `browser_*` tool call to the daemon. The MCP tool surface is unchanged, so the skill and scenarios don't know the swap happened. Claude still spawns a fresh (cheap) MCP-server process per scenario, but they all attach to the *same* warm browser.
- **`runner.mjs`** owns the daemon lifecycle: spawn → poll `/health` → run scenarios → stop in a `finally` (even on error). Between scenarios it calls `/reset_extension`, which drives the extension's **own built-in reset** (verifying the grid returns to the default 9-cell state) and then **restores the fixture** (verifying 16 cells + 9 tiles render live) — so every reset is itself a reset+restore regression check. History is **not** reset; it's the seeded environment.
- **Daemon lifecycle is per UAT run, not persistent.** A selective single-scenario run (`pnpm test:uat 01-restore-dogfood`) still auto-starts and auto-stops the daemon.

This supersedes, for the live architecture, the "no separate launch script" property claimed in the 2026-06-01 screenshot decision: there now **is** a separate launch (the daemon), spawned and torn down by the runner rather than by Claude. The Option-C screenshot contract is unchanged — the daemon writes the PNG to the per-scenario `ARTIFACTS_DIR` the MCP client passes it, and `browser_read_screenshot` reads it back inline on demand.

### Fallback (Plan B): single CLI + Bash

If the MCP wrapper hits an unexpected wall (stdio framing, protocol drift, etc.), pivot to the single-CLI route. ~50 LOC more, loses screenshot ergonomics and allowlist precision, but reuses everything else (Firefox launch lifecycle, helpers, fixture).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  pnpm test:uat  [optional: <scenario-slug> ... to run a subset]  │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  preflight.mjs  (8 checks; fail-fast, exit 1 on any [fail])      │
│  Node ≥22 · pnpm ≥10 · release Firefox (PATH/$FIREFOX_BIN) ·     │
│  built .xpi/.zip in dist/ matching manifest version ·            │
│  fixture sha256 matches recorded value · claude CLI present ·    │
│  @modelcontextprotocol/sdk resolvable ·                          │
│  UAT daemon port free (9876/$UAT_DAEMON_PORT, ≠ E2E's 9222)      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  tests/uat/_tools/runner.mjs                                     │
│  1. spawn browser-daemon.mjs; poll /health until ready           │
│  2. for each scenarios/*.md (or the selected subset):            │
│       spawn: claude -p --mcp-config <config>                     │
│              --allowedTools <6 browser_* tools + Write>           │
│              --max-turns 50   < prologue + scenario-body          │
│       env: UAT_DAEMON_PORT, ARTIFACTS_DIR=<run dir> (flat),     │
│            UAT_SHOT_PREFIX=<stamp>-<scenario>                    │
│       agent writes <prefix>-report.json/-summary.md; runner     │
│       writes <prefix>-agent.log; print screenshot names         │
│       between scenarios: POST /reset_extension (state reset)     │
│  3. stop the daemon in a finally (even on error)                 │
│  4. write artifacts/report.json (per-scenario pass + timings)    │
└───────────┬───────────────────────────────────────┬─────────────┘
            │ spawns per scenario                     │ HTTP (lifecycle)
            ▼                                         │
┌────────────────────────────────────────────┐       │
│  Claude Code (headless, per scenario)       │       │
│  - skill: .claude/skills/uat-scenario.md    │       │
│  - standard preamble: open drawer → Advanced│       │
│    → restore fixture → wait .newtab-site==9 │       │
│  - then scenario steps; writes report.json  │       │
│    + summary.md via Write                    │       │
│  - tools: browser_navigate/click/evaluate/  │       │
│    file_upload/take_screenshot/read_screenshot      │
└───────────┬─────────────────────────────────┘       │
            │ stdio (MCP)                              │
            ▼                                         │
┌────────────────────────────────────────────┐       │
│  mcp-server.mjs  (thin MCP→HTTP client)     │       │
│  - @modelcontextprotocol/sdk Server (stdio) │       │
│  - forwards each browser_* call to the      │       │
│    daemon's HTTP API; no Selenium here      │       │
│  - take_screenshot: tells daemon to write   │       │
│    PNG into this scenario's ARTIFACTS_DIR   │       │
│  - read_screenshot: reads that PNG inline   │       │
│    on demand (Option C)                      │       │
└───────────┬─────────────────────────────────┘       │
            │ HTTP  (POST /navigate /click /evaluate   │
            │        /file_upload /screenshot          │
            ▼        /reset_extension · GET /health)    ▼
┌──────────────────────────────────────────────────────────────────┐
│  tests/uat/_tools/browser-daemon.mjs  (long-lived, 1 per run)    │
│  - on start: Selenium launches release Firefox via geckodriver,  │
│    pins extensions.webextensions.uuids, installAddon(xpi, true), │
│    SEEDS HISTORY with 9 URLs, opens newTab.xhtml                  │
│  - HTTP API on 127.0.0.1:9876 ($UAT_DAEMON_PORT); daemon.log     │
│  - /reset_extension: built-in reset (→9 cells, verified) then    │
│    fixture restore (→16 cells, 9 tiles live, verified)           │
│  - on SIGTERM: driver.quit() (geckodriver tears Firefox down)    │
└──────────────────────────────────────────────────────────────────┘
```

Why these pieces:

- **Claude Code headless mode** (`claude -p`) runs the agent loop and handles auth via the developer's subscription. The runner keys off the process exit code per scenario; the agent itself writes `report.json` + `summary.md` via the `Write` tool.
- **Browser daemon** (`tests/uat/_tools/browser-daemon.mjs`) owns the one Selenium + release-Firefox session for the whole run, so launch + extension-install + history-seed is paid once, not per scenario. It exposes a localhost HTTP API and lives and dies with the run (started/stopped by the runner).
- **Thin MCP server** (`tests/uat/_tools/mcp-server.mjs`) bridges Claude's MCP tool calls to the daemon's HTTP API. Custom rather than off-the-shelf because off-the-shelf Selenium MCP servers don't expose `installAddon`, and Playwright MCP/CLI can't load a Firefox extension at all (see Spike outcome). It holds no browser state — many cheap per-scenario MCP processes share the one warm browser.
- **Skill** (`.claude/skills/uat-scenario.md`) bundles the agent instructions, allowed tools, the standard restore preamble, the assertion vocabulary, and the `report.json` / `summary.md` contract — so each scenario file stays short.
- **Preflight** is a separate Node script the runner invokes first. Contributors run on different infra (WSL, native Linux, macOS); the most common failure mode for an LLM-driven tier is "the prereq I assumed exists doesn't" — surfaced opaquely deep inside a tool call. Check #8 (daemon port free) also guards against an E2E/UAT port collision.
- **Known-good zip fixture** is a checked-in NTT backup containing 4×4 grid prefs and 9 representative tiles. Every scenario starts from this state (restored by the preamble, and re-established by `/reset_extension` between scenarios), so findings reflect the code change, not profile drift — and the restore flow itself is dogfooded on every run.

---

## Components

### 1. Known-good fixture (`tests/uat/newtabtools_knowngood.zip`)

A checked-in NTT backup zip used as the starting state for every UAT scenario. **fixtureVersion 2** (see `tests/uat/README.md` for the recorded `sha256`). Contents:

- `prefs.json` — 4×4 grid, medium spacing/title/margin, opacity 80, system theme with auto-follow, `tileAspect: fill`, recently-closed on, history-tiles on, a wallpaper URL from Mozilla's CDN.
- `tiles.json` — 9 tiles at **positions 0–8** (the remaining cells 9–15 of the 4×4 grid are empty, so trailing-gap layout is exercised). URLs point at real Swiss news / shopping / finance sites — the agent must never navigate to them; tiles are rendered, not visited.
- `tileImages/{1,2}.png` — 2 stored thumbnails (tile ids 1 and 2), real captures of the live pages; the other 7 tiles render via the favicon/letter fallback.

> **fixtureVersion 2 (2026-06-02):** v1's `tiles.json` carried trailing commas (invalid JSON) on tile ids 4/8/9, so restoring it parsed prefs but silently dropped all 9 tiles. v2 is canonical valid JSON. This also exposed and fixed a real code bug — `readZip` was non-atomic (applied prefs before parsing tiles, so a bad backup half-applied) — now fixed in `webextension/export.js`; see `tests/integration/backup-restore.test.ts`.

Why this shape:
- **4×4 grid with 9 tiles (0–8 filled, 9–15 empty)** stresses trailing-gap rendering, drag-reorder, hover overlap.
- **Mix of tiles with and without thumbnails** exercises the auto-thumbnail fallback path.
- **Wallpaper from a CDN URL** dogfoods the background-image render path. If the CDN is unreachable the wallpaper won't load — scenarios that care should note this as an acceptable failure mode.
- **System theme + themeAuto** means rendered colours depend on the host OS theme. Scenarios that care about a specific theme must override via Setup.

**Rules for the fixture:**
- It is part of the test contract. Don't regenerate it on a whim — every change invalidates the comparison baseline that scenarios assume.
- When the schema changes (new prefs key, new tile field), regenerate the fixture and bump a `fixtureVersion` line in `tests/uat/README.md`. The Skill prompt references this version so the agent can flag obviously-stale fixtures.
- Keep it under 5MB. Current size: ~0.9MB.
- Never put credentials, tokens, or personal browsing data in the fixture. The current contents are public site URLs and screenshots of public pages.

### 2. Directory layout

```
tests/uat/
  newtabtools_knowngood.zip      # the fixture (checked in; fixtureVersion 2)
  scenarios/
    01-restore-dogfood.md        # C1 — gating scenario (restore preamble + verify) [built]
    # later: 02-restore-and-verify.md (C2, comprehensive), then tile-hover / theme / etc.
  _tools/
    browser-daemon.mjs           # long-lived browser host (Selenium+FF, HTTP API)  [built]
    mcp-server.mjs               # thin MCP→HTTP client to the daemon (Option C)     [built]
    mcp-config.json              # config Claude reads to spawn the MCP server       [built]
    mcp-smoke.mjs                # full MCP-path smoke + payload measurement          [built]
    daemon-smoke.mjs             # daemon HTTP-API contract smoke                     [built]
    browser-smoke.mjs            # standalone browser-path check (no MCP/SDK)         [built]
    fallback-cli.mjs             # Plan-B reference (CLI-over-Bash; rejected)         [built]
    preflight.mjs                # prerequisite checks (8; incl. daemon port)         [built]
    runner.mjs                   # orchestrator + daemon lifecycle (ESM Node)         [built]
    # (no skill-loader — Claude Code auto-loads .claude/skills/uat-scenario.md natively)
  README.md                      # how to run, add scenarios, debug artifacts        [built]
  artifacts/                     # gitignored
    20260603-072202/             #   one flat dir per run (YYYYMMDD-HHMMSS):
      report.json                #     aggregate run report
      daemon.log                 #     daemon's log for the run
      20260603-072202-restore-dogfood-report.json   # per-scenario (prefixed)
      20260603-072202-restore-dogfood-summary.md
      20260603-072202-restore-dogfood-agent.log
      20260603-072202-restore-dogfood-01-grid.png   # screenshots (prefixed, sort in order)
.claude/
  skills/
    uat-scenario.md              # the agent skill (checked in via .gitignore exception)
```

Note: `preflight.mjs` and `runner.mjs` live under `_tools/` (not directly in `tests/uat/`).

Add to `.gitignore`: `tests/uat/artifacts/`. The fixture itself is checked in.

### 3. Preflight (`tests/uat/_tools/preflight.mjs`)

Runs at the very start of `pnpm test:uat`. Hard requirement: a contributor can clone the repo on a clean machine, run `pnpm install && pnpm test:uat`, and either the run starts or they're told exactly what to do next.

**Checks (in order; runs all, exits 1 if any failed):**

| # | Check | If missing |
|---|---|---|
| 1 | Node ≥ 22 (`.node-version` / `engines`) | Print upgrade instructions (fnm/nvm); fail |
| 2 | pnpm ≥ 10 | Print `corepack prepare pnpm@10 --activate`; fail |
| 3 | **release Firefox** resolvable (`firefox` on PATH or `$FIREFOX_BIN`) | Print install instructions; fail |
| 4 | Built `.xpi`/`.zip` in `dist/` matching the current manifest version | Print `pnpm build`; warn if stale, fail if absent |
| 5 | Fixture `tests/uat/newtabtools_knowngood.zip` sha256 matches the recorded value | Print regeneration / hash-bump note; fail on mismatch |
| 6 | `claude` CLI on PATH | Print install link (`https://docs.claude.com/claude-code`); fail |
| 7 | `@modelcontextprotocol/sdk` resolvable from the tool dir | Print `pnpm install`; fail |
| 8 | **UAT daemon port free** (`$UAT_DAEMON_PORT` or 9876) | Fail if in use; hard-fail if set to E2E's 9222 (collision guard) |

**Output format:** one line per check, `[ok]` / `[warn]` / `[fail]` + actionable detail (mirrors `pre_commit_check.sh`). Warnings don't fail the run; any `[fail]` exits 1 with a summary. No emoji.

The preflight does **not** auto-install or touch system packages — it diagnoses and prints the exact fix. It's the first thing `runner.mjs` does; failure aborts before the daemon spawns Firefox, before any model tokens are spent. (geckodriver is provisioned by Selenium Manager on first daemon run, or installed onto PATH — a system dep, not checked here.)

### 4. Scenario file format

Plain markdown, one scenario per file. The runner injects a short prologue (slug + artifacts dir) above the scenario body and pipes the whole thing to `claude -p` via stdin; the agent interprets it through the `uat-scenario` skill. The **slug is the filename** (`01-restore-dogfood.md` → `01-restore-dogfood`) — no `id` frontmatter. Sections are prose, not a fixed schema:

```markdown
# C1 — Restore dogfood

**Goal:** <one line — what this scenario proves.>

Follow the **standard preamble** from the `uat-scenario` skill (open drawer →
Advanced → restore the fixture → wait for the tiles). [Or: "Skip the preamble"
for a scenario that tests a clean/pre-restore state.]

## Verify (structural — browser_evaluate)
- <assertion expressible as a JS expression returning a primitive, e.g.
  `document.querySelectorAll('.newtab-site').length === 9`>
- <assertion on tile content, e.g. a .newtab-title contains "finews.ch">

## Evidence
- Take a screenshot named `<name>` of <state>.

## Visual judgment
- Read the `<name>` screenshot inline and judge: <criterion in plain language —
  occlusion / contrast / layering / layout breaks>. State pass/fail conditions.

## Output
- report.json (the assertions + visual verdict) and summary.md (one paragraph).
```

**Rules:**
- "What to judge" is fully self-contained in language. No references to design files or reference images.
- Every scenario starts from the known-good fixture state restored by the preamble. A scenario testing a clean/pre-restore state says "skip the preamble" in its body.
- **Assert on `.newtab-site` (populated tiles) or tile content, never on raw `.newtab-cell` count** — a default profile already shows 9 empty cells (3×3), so cell count alone doesn't prove a restore. After the fixture restore there are 16 cells (4×4) and 9 `.newtab-site` tiles.
- Tile references use the fixture's positions / titles rather than CSS selectors that may drift.

### 5. Skill definition (`.claude/skills/uat-scenario.md`)

The built skill is `.claude/skills/uat-scenario.md` (the file is the source of truth; checked in via the `.gitignore` `!.claude/skills/` exception). Summary of its actual contract:

**Frontmatter** — `name: uat-scenario`, and `allowed-tools` listing exactly the six MCP browser tools plus `Write`:
`mcp__ntt-uat__browser_{navigate,click,evaluate,file_upload,take_screenshot,read_screenshot}` + `Write`. (No `browser_hover/type/press_key/snapshot` — those were aspirational; the implemented tool surface is the six above.)

**Standard preamble** (run unless the scenario says "skip the preamble"), using the **current NTT v2 selectors**:
1. `browser_navigate` to the extension's `newTab.xhtml`.
2. Click `#options-toggle` (opens the config drawer).
3. Click `[data-drawer-tab="advanced"]` (the Advanced panel).
4. `browser_file_upload` the fixture into `#options-restore-file` (absolute path computed from the artifacts dir).
5. Click `#options-restore`.
6. Poll until `document.querySelectorAll('.newtab-site').length === 9` (tiles render **live**, no reload). The skill explicitly warns: assert on `.newtab-site` (or tile content), **not** `.newtab-cell` count — a default profile shows 9 empty cells, and the fixture's 4×4 grid has 16 cells of which 9 are populated.

A failed preamble step is recorded as a critical assertion and stops the scenario (a broken restore is itself a finding).

**Assertion vocabulary** — structural (`browser_evaluate` → primitive), evidence-only (`browser_take_screenshot`, not read back), visual judgment (`browser_take_screenshot` + `browser_read_screenshot` inline, ~1200 image tokens — read only what must be judged; Option C).

**Output** — the agent writes `report.json` (a `passed` rollup + an `assertions[]` array of `{name, kind, passed, expected, actual, evidence}`) and `summary.md` (lead with the verdict, then what was seen, flagging occlusion / contrast / layering / layout breaks) into the runner-provided artifacts directory via `Write`. (This replaced the earlier single-stdout-JSON-findings design: the runner now keys off the process exit code and reads each scenario's `report.json`, rather than parsing stdout.)

**Constraints** — only the seven allowed tools (no `Bash`/`Read`/`Edit`); never navigate outside the `moz-extension://` origin (tile URLs are rendered, not visited); a missing documented selector is recorded as drift, not guessed around.

### 6. Runner (`tests/uat/_tools/runner.mjs`)

Responsibilities (as built):

- Run `preflight.mjs` first (8 checks). Abort on non-zero exit, before the daemon or any tokens.
- Scenario selection: optional positional args select a subset by slug (`pnpm test:uat 01-restore-dogfood 02-…`); no args runs all of `scenarios/*.md` (lex-sorted). Unknown slugs abort with the available list.
- **Create this run's timestamped directory** `tests/uat/artifacts/<YYYYMMDD-HHMMSS>/`. All of the run's output lives **flat** in it — every scenario's screenshots, reports, summaries, and logs share the one directory (no per-scenario subdirs) so the whole run browses together. Successive runs get separate timestamped dirs, so nothing is overwritten. Per-scenario files are namespaced by a `<run-stamp>-<scenario label>` prefix.
- **Start the browser daemon** (`browser-daemon.mjs`) once, with `ARTIFACTS_DIR=<run dir>` + `UAT_DAEMON_PORT`. Poll `GET /health` until ready (generous timeout — history seeding is slow on cold links). The runner does **not** launch a browser itself; the daemon owns it for the whole run.
- For each selected scenario (all writing into the one flat run dir):
  - Build the prompt: a runner prologue + the scenario markdown, piped to `claude -p` via stdin. The prologue gives the agent the slug, the **absolute fixture path**, and the **exact absolute paths** to write its report (`<prefix>-report.json`) and summary (`<prefix>-summary.md`) to.
  - Spawn `claude -p --mcp-config <config> --allowedTools <6 browser_* + Write> --max-turns 50`, with env `ARTIFACTS_DIR=<run dir>`, `UAT_DAEMON_PORT`, and `UAT_SHOT_PREFIX=<run-stamp>-<scenario label>` (the prefix the MCP server prepends to screenshot filenames).
  - Capture stdout → `<prefix>-agent.log`. The agent writes its report + summary to the prologue paths; screenshots land in the run dir via the daemon, prefixed.
  - Print the scenario's screenshot filenames.
  - **Between scenarios** (not after the last) `POST /reset_extension` — drives the built-in reset then re-restores the fixture, both verified, so the next scenario starts from a known state. History is not reset.
- **Stop the daemon** in a `finally` (even if a scenario threw), and also on the runner's own SIGINT/SIGTERM.
- Write `<run dir>/report.json` aggregating per-scenario `{passed, exitCode, elapsedSec, report, screenshots}` + the run stamp. Exit non-zero if any scenario's `claude -p` exited non-zero. (Unlike the original "exit 0 always" plan, a selective/gating run *does* signal failure via exit code, which is what makes `pnpm test:uat <slug>` usable as a gate; the human still reviews artifacts for the nuanced verdict.)

Implementation notes:

- Node's `child_process.spawn` (daemon) + `spawnSync` (per-scenario `claude -p`). No `execa` dep.
- The runner keys off the per-scenario process **exit code**; it does not parse `--output-format=stream-json`. The scenario's structured verdict is the `report.json` the agent writes. (Dropping stream-json parsing removed a Claude-Code-release-drift surface.)
- The runner is a Node ESM script (`.mjs`, run via `node`) — not vitest, not TypeScript.
- **Screenshot naming:** `<run-stamp>-<scenario label>-<agent's shot name>.png` (e.g. `20260603-071342-restore-dogfood-01-grid.png`). The run stamp groups a run; the scenario label and the agent's `NN-` shot ordinal make the files sort in capture order, so opening the first in an image viewer and paging forward walks the run.
- **Isolation between scenarios** is via `/reset_extension` against the shared warm browser (built-in reset → fixture restore), not a fresh Firefox per scenario. Seeded history persists across scenarios by design (it's the environment). This is the B7 change from the original "fresh profile per scenario" model.

### 7. MCP server (`tests/uat/_tools/mcp-server.mjs`) + browser daemon (`browser-daemon.mjs`)

Since B7 these are two processes (see "Revised 2026-06-02" under Spike outcome):

**`browser-daemon.mjs`** — long-lived, one per run, started/stopped by the runner. On startup it launches release Firefox via Selenium + geckodriver, pins `extensions.webextensions.uuids`, `installAddon(xpi, true)`, **seeds history with 9 URLs**, and opens `newTab.xhtml`. It then serves a localhost HTTP API on `127.0.0.1:$UAT_DAEMON_PORT` (default **9876**, ≠ E2E's 9222) and logs to `<run dir>/daemon.log`. It resolves the `.xpi` from `dist/` (`XPI_DIR`/`EXTENSION_XPI` override). On SIGTERM it `driver.quit()`s.

| Endpoint | Backed by | Notes |
|---|---|---|
| `GET /health` | — | `{ status, ready, port }`; the runner polls this |
| `POST /navigate {url}` | `driver.get` | |
| `POST /click {selector}` | `findElement().click()` | |
| `POST /evaluate {script, async?}` | `driver.executeScript` / `executeAsyncScript` | `async:true` for callback/promise queries (e.g. `chrome.*`) |
| `POST /file_upload {selector, path}` | `findElement().sendKeys(path)` | drives the restore `<input type=file>` |
| `POST /screenshot {name, dir?}` | `driver.takeScreenshot` → **disk** | writes `<dir>/<name>.png`, returns `{saved, bytes}` |
| `POST /reset_extension` | built-in reset → fixture restore | verifies 16→9 cells then 9→16 cells + 9 tiles; `{ ok, resetCells, restoredCells, restoredSites }` |

**`mcp-server.mjs`** — the thin stdio MCP server Claude spawns per scenario (`@modelcontextprotocol/sdk`, plain `.mjs`). It holds **no** Selenium state; each `browser_*` tool forwards to the daemon over HTTP. The tool surface (Option C contract) is unchanged from the table the skill expects:

| Tool | Forwards to | Notes |
|---|---|---|
| `browser_navigate {url}` | `POST /navigate` | |
| `browser_click {selector}` | `POST /click` | |
| `browser_evaluate {script}` | `POST /evaluate` | returns the value as JSON text |
| `browser_file_upload {selector, path}` | `POST /file_upload` | |
| `browser_take_screenshot {name}` | `POST /screenshot` (into this scenario's dir) | returns `{saved, bytes}`; **no image in context**. Filename gets the `UAT_SHOT_PREFIX` |
| `browser_read_screenshot {name}` | reads the prefixed PNG off disk → **inline image** | on demand; pay image tokens only for shots you judge |

Tool names keep the `@playwright/mcp` shape so scenarios/skill stay tool-agnostic. Config (`tests/uat/_tools/mcp-config.json`):

```json
{
  "mcpServers": {
    "ntt-uat": {
      "command": "node",
      "args": ["./tests/uat/_tools/mcp-server.mjs"],
      "env": {
        "UAT_DAEMON_PORT": "${UAT_DAEMON_PORT}",
        "ARTIFACTS_DIR": "${ARTIFACTS_DIR}",
        "UAT_SHOT_PREFIX": "${UAT_SHOT_PREFIX}"
      }
    }
  }
}
```

Measure the wire payloads any time with `tests/uat/_tools/mcp-smoke.mjs` (spawns the daemon, then drives the MCP server); the daemon's own HTTP contract is covered by `daemon-smoke.mjs`.

`@modelcontextprotocol/sdk` and `selenium-webdriver` are **pinned devDependencies** (no `^`/`~`). Versions recorded in `tests/uat/README.md` with date + rationale, per `CONTRIBUTING.md` supply-chain guardrails.

**Plan B fallback if this proves painful:** the single-CLI route (`fallback-cli.mjs`, Bash-invoked). Scenarios and skill would change tool-call shape but not content. See Spike outcome.

---

## Cost & running

| Run mode | Frequency | Cost per run | Monthly |
|---|---|---|---|
| Local on-demand (`pnpm test:uat`) | a few per phase | covered by CC subscription | n/a |
| Pre-AMO release | every 2 weeks | covered by CC subscription | n/a |

Subscription mode only for the initial implementation. The runner does not read `ANTHROPIC_API_KEY`. CI nightly + API mode are deliberately deferred until the manual workflow proves value.

Implication: every contributor needs an authenticated `claude` CLI on their machine. The preflight enforces this; the `tests/uat/README.md` documents the one-time `claude /login` step.

---

## Implementation steps (in order)

### Step 0 — Architecture spike (✅ complete, 2026-05-21)

Outcome documented in §"Spike outcome" above. Decision: roll-your-own MCP, with `Bash + CLI` as Plan B fallback. **Backend revised 2026-06-01** (see the revision note under Spike outcome): the MCP server wraps **Selenium + geckodriver against release Firefox** (prototype-proven), not Puppeteer-over-BiDi-on-ESR. E2E is unchanged.

### Step 1 — Scaffold + preflight (1.5 hours)

- Create `tests/uat/` with the directory layout above.
- Add `tests/uat/artifacts/` to `.gitignore`. The fixture stays committed.
- Add `"test:uat": "node tests/uat/_tools/runner.mjs"` to `package.json` scripts.
- Pin `@modelcontextprotocol/sdk@<exact>` and `selenium-webdriver@<exact>` in devDependencies (no `^`); run `pnpm audit`. No `tsx` — the runner is `.mjs` ESM, executed by `node` directly. (geckodriver is provisioned by Selenium Manager or installed onto PATH — a system dep, not a node one.)
- Write `tests/uat/_tools/preflight.mjs` with the checks listed in §3 (release Firefox + geckodriver + the fixture-presence check).
- Stub `runner.mjs` with a hello-world that runs preflight, then spawns `claude -p "say hi"` and writes the response to an artifact.
- Verify on a clean checkout (or via a fresh `git clean -xdf` if you're willing). Preflight should either pass or print actionable instructions.

### Step 2 — Skill + MCP server wiring (2-3 hours)

- Write `.claude/skills/uat-scenario.md` from the template above (with the per-scenario restore preamble, no design-reference language; reconcile the restore selectors to the v2 drawer).
- ✅ `tests/uat/_tools/mcp-server.mjs` already exists (Option C, prototype-validated launch + pinned-UUID + `installAddon`). Remaining: wire the per-scenario `ARTIFACTS_DIR`, and reconcile any selectors. No `web-ext`/BiDi/Puppeteer here.
- Write `tests/uat/_tools/mcp-config.json` pointing at the local MCP server, with `EXTENSION_XPI` / `FIREFOX_BIN` / `NTT_UAT_UUID` in env.
- Extend the runner to:
  - Package the extension (`web-ext build`) and set `EXTENSION_XPI`. No browser launch — the MCP server owns it.
  - Spawn `claude -p` with the MCP config attached.
  - Pipe a hardcoded test prompt that exercises the preamble end-to-end: navigate to `$NEWTAB_URL`, open the drawer, restore the fixture, screenshot the populated grid.
  - Save screenshots and the response as artifacts.
- Verify end-to-end: Selenium launches release Firefox, extension installs temporarily, agent restores the fixture, populated grid screenshot lands in `artifacts/` (and the agent saw it inline).

### Step 3 — First scenario: `01-fresh-install.md` (2 hours, gate)

This is the scenario that has to catch the motivating bug.

- Write `scenarios/01-fresh-install.md` covering the bug class that motivated this work: "After restoring the known-good fixture, are the tile thumbnails fully visible, or is anything covering them?" Criteria fully in language; no design-image reference.
- Extend the runner to load + execute one scenario, parse the final JSON, validate it against the schema, save `report.json`.
- Run it. Read the artifacts. Iterate on the skill prompt until the agent produces useful, specific findings (not "looks fine" or hallucinated issues).
- **Acceptance criterion**: replay the runner against the commit where the "occluded thumbnail" bug was present. The agent must complete the preamble (restoring the fixture) and then flag the occlusion. If not, the skill prompt or the scenario judgment criteria need work — fix before adding more scenarios.

### Step 4 — Remaining initial scenarios (3-4 hours)

- Write `02-tile-hover.md` through `05-locked-state.md` (templates listed in the directory layout). All five rely on the fixture's 4×4 grid + 9 tiles + wallpaper as starting state.
- Run the full suite. Review artifacts. Tune the skill if a scenario class consistently produces bad judgments.

### Step 5 — Summary + multi-scenario reporting (1 hour)

- Runner aggregates per-scenario reports into `artifacts/<run-timestamp>/summary.md`.
- Summary format: a table of scenarios × verdicts, then a section per critical/major finding with screenshot links. A separate section highlights preamble-step failures across scenarios (these usually mean the restore feature is broken, not the scenario).
- Print the summary path to stdout when the run completes.

### Step 6 — Document in TESTING.md and CONTRIBUTING.md (30 min)

- TESTING.md UAT tier section already added (forward-looking). Expand once Steps 1-5 land.
- Add to `CONTRIBUTING.md`'s "Before Committing" section: "For changes that affect the UI, run `pnpm test:uat` and review the summary before requesting review."
- `tests/uat/README.md`: how to run, how to add a scenario, how to debug artifacts, the Step 0 spike result (linked from here), the pinned `@modelcontextprotocol/sdk` version with refresh notes, the fixture description + regeneration steps + `fixtureVersion`, a troubleshooting section keyed by preflight failure messages.

---

## Effort estimate

| Step | Hours |
|---|---|
| 0 Spike | ✅ done |
| 1 Scaffold + preflight | 1.5 |
| 2 MCP server wiring | 2–3 |
| 3 First scenario (gating) | 2 |
| 4 Scenarios 2–5 | 3–4 |
| 5 Summary | 1 |
| 6 Docs | 0.5 |
| **Total remaining** | **10–12h** |

The remaining gating point is Step 3 — if the agent can't reliably flag the motivating bug, the whole tier needs a rethink (skill rewrite, different model, possibly switching to pixel-diff after all).

---

## Risks & open questions

1. **MCP SDK release drift.** `@modelcontextprotocol/sdk` is at v1.29.x and still evolving. Mitigation: pinned dep, lockfile review on upgrade, `pnpm audit --audit-level=high` is already in CI. Tested CC + SDK versions recorded in `tests/uat/README.md`.
2. **Skill prompt non-determinism.** Same scenario may produce different findings across runs. Mitigation: run each scenario 2-3x during initial calibration, tune the criteria language until findings stabilize. Document the prompt-tuning process in `tests/uat/README.md` so it's repeatable.
3. **Hallucinated findings.** The agent may flag non-issues or miss real ones. Mitigation: screenshots are ground truth — they're saved as artifacts so the developer can spot-check disagreements. The verdict is "investigate" not "fail" — humans always look at the summary before releasing.
4. **Cost runaway.** Easy to leave the runner running in a loop. Mitigation: hard-cap `--max-turns 50` in the runner, log a warning if any scenario hits the cap, never schedule on PR merge or commit push.
5. **CC subscription quota.** Heavy UAT use could throttle interactive Claude Code sessions. Mitigation: pre-release-only usage keeps load light; if it grows, revisit the API-mode deferral.
6. **Stream-json schema drift.** Claude Code's `--output-format=stream-json` is not a stable API contract. Mitigation: the parser fails loudly on unknown event types rather than silently dropping. Pin the tested CC version range in `tests/uat/README.md`; the preflight does not assert a CC version (would block on every release), but the README does.
7. **MCP wrapper proves painful** (stdio framing, Selenium/geckodriver quirks under MCP). Mitigation: Plan B is the single-CLI route (Bash-invoked). Same Selenium launch + `installAddon`, same fixture; only the tool-call shape changes. Documented in §"Spike outcome".
8. **Preflight staleness.** Prerequisites can change (Node floor, release-Firefox/geckodriver versions, MCP SDK API). Mitigation: preflight failure messages link to a `tests/uat/README.md#troubleshooting` section that gets updated whenever a check is added or modified.
12. **Release Firefox ≠ the AMO-shipped build (and ≠ the E2E ESR build).** Deliberate — UAT judges the user-representative build, and its visual bug class is the least build-sensitive thing we test. A UAT-only finding triages by reproducing it on the ESR E2E rig: reproduces → real bug; doesn't → candidate version-specific issue. Risk is low for occlusion/contrast/layout; accept it.
13. **Selenium / pinned-UUID specifics.** `installAddon` (Node binding) needs a *packaged* `.xpi` (the runner builds it via `web-ext`, not an unpacked dir). The pinned-UUID trick depends on the internal `extensions.webextensions.uuids` pref — symptom of breakage on a Firefox upgrade: navigating to the pinned `moz-extension://` URL 404s. Recovery: read the assigned UUID back from the profile (as the E2E `getExtensionUUID` does) or stop pinning. geckodriver via Selenium Manager needs network on first run; preflight check #4 surfaces this.
9. **Recursive dependency on the restore flow.** Every scenario's preamble depends on Settings → Backup/Restore working. If restore breaks, every scenario fails the preamble step. Mitigation: this is intentional dogfooding, not a bug — a broken restore *should* fail UAT loudly. Scenarios that specifically test pre-restore states use `setup: skip-restore`.
10. **Fixture staleness.** When schema changes (new prefs key, new tile field), the fixture goes out of date. Mitigation: `fixtureVersion` in `tests/uat/README.md`; the skill is told what version is current and flags obviously-stale fixtures. Regeneration steps documented in `tests/uat/README.md`.
11. **Wallpaper CDN dependency.** The fixture's `backgroundUrl` points to Mozilla's wallpaper CDN. If unreachable (offline run, blocked egress, CDN deprecation), the wallpaper won't load. Mitigation: the skill is told to note CDN-unreachable in `notes` but not flag it as a finding unless a scenario explicitly requires the wallpaper. Optionally: regenerate the fixture without a wallpaper, or with a `data:` URL wallpaper, if CDN reachability becomes a flake source.

---

## Definition of done

- `pnpm test:uat` runs five scenarios end-to-end against a live **release-channel Firefox** (Selenium + geckodriver) with the extension temporarily installed, on a freshly-cloned working tree after `pnpm install` and a one-time `claude /login`.
- The preflight either passes or prints a precise, copy-pastable fix for any failed check, including the fixture-presence check.
- Each scenario's preamble successfully restores the known-good fixture; the agent verifies the populated grid before executing scenario-specific steps.
- Each scenario produces `report.json`, `transcript.jsonl`, and per-step screenshots under `artifacts/`.
- A `summary.md` aggregates verdicts and critical findings, with a dedicated section highlighting preamble failures.
- Replaying the runner against the "occluded thumbnail" bug commit produces a `fail` or `investigate` verdict with a finding that names the occlusion.
- `TESTING.md` documents the tier and its place in the workflow (initial forward-looking entry already landed; expand once implementation lands).
- `tests/uat/README.md` records the pinned `@modelcontextprotocol/sdk` version, the fixture description + `fixtureVersion` + regeneration steps, and a troubleshooting section keyed by preflight failure messages.
- The developer's manual pre-release QA pass is shorter because the UAT run catches the obvious things first.

---

## What's explicitly deferred

- **Multi-CLI portability** (Codex / Gemini adapter). The scenario format and skill body are CLI-agnostic by design, but the runner is Claude-only for now. A `CLI_ADAPTERS` shape can be retrofitted without rewriting scenarios.
- **API-key mode + GitHub Actions nightly cron.** Subscription mode + local runs only. The runner does not read `ANTHROPIC_API_KEY`. Revisit if the manual workflow proves valuable and CI automation becomes worth the per-call cost.
- **Visual baseline / pixel-diff.** Each scenario's criteria are stated in language. Revisit after AMO republish and NTT v2 design stabilization, if subjective judgments ("does this look right") start slipping.
- **Per-PR UAT runs.** Non-determinism + cost = bad gate. Manual trigger only for now.
- **Cross-browser** (Chrome, Safari). The extension is Firefox-only; cross-browser UAT is out of scope until that changes.
- **Programmatic / fast-path fixture restore.** The preamble dogfoods the UI restore flow on purpose. If the restore UI becomes a flake source we can add a `setup: programmatic-restore` mode that calls `chrome.runtime.sendMessage({name: 'Import:restore', ...})` directly, but that's only worth doing if the UI path proves unreliable.
- **Off-the-shelf MCP server.** If a maintained Selenium/WebDriver MCP server gains an `installAddon`/extension-load tool (e.g. a community fork of `angiejones/mcp-selenium`), swap our `mcp-server.mjs` for it. Our tool names follow the `@playwright/mcp` shape, so scenarios and the skill prompt stay portable.
- **`@playwright/cli` for token efficiency.** The Playwright agent CLI is ~4× cheaper per session than MCP, but it can't load a Firefox extension (Chromium-only) and drives Playwright's patched Firefox, not a real release build — so it's not usable here. Revisit only if it gains real-Firefox extension support.
- **Standards-based result surfacing (SARIF / JUnit XML).** Findings are currently surfaced two ways: assertions gate the exit code, and `observations[]` + failed-assertion lines are printed by the runner as a terminal digest (lightweight, no deps). Once the tier is otherwise settled, explore *also* emitting machine-readable results so they render natively in IDE/CI instead of a bespoke digest: **SARIF** (severity-leveled findings — failed assertion → `error`, observation → `note`; renders inline in VS Code / GitHub) and/or **JUnit XML** for the pass/fail tier (every CI consumes it). This sits between the two mature lineages this tier borrows from — LLM-as-judge eval frameworks (tri-state verdict, structured rationale, calibration runs) and static-analysis / visual-regression review (severity tiers, a review queue with artifacts). Open sub-questions when we get there: reproducibility/calibration of the LLM's *visual* judgments (run N times, track agreement), and whether any subjective judgment should ever gate CI (lean: no — keep advisory).
