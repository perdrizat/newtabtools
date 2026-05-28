# UAT Plan — LLM-driven user acceptance testing

A new test tier above E2E: an LLM agent walks through scenarios, judges whether things look and work correctly, and produces a human-reviewable report. Replaces the manual pre-release QA pass with an automated one that runs the same scenarios faster, generates evidence artifacts, and catches the bug class structural tests miss (occlusion, contrast, layering, "looks broken to a user").

This plan uses **Claude Code in headless mode** (not the Claude API) as the agent driver, with **our own MCP server** wrapping the existing E2E Puppeteer-over-BiDi setup for browser control. The scenarios are plain English. The whole tier is opt-in (`npm run test:uat`), gated on a separate model budget, and never blocks PR merges.

## Goals

1. Catch user-visible regressions (the "thumbnails occluded by overlay" bug class) before AMO releases without writing more pixel-fragile tests.
2. Stay in the existing repo conventions: TypeScript runner, Firefox ESR via `web-ext` + WebDriver BiDi (same as E2E), artifacts under `tests/uat/artifacts/`.
3. Use the developer's existing Claude Code subscription rather than provisioning a separate Anthropic API key.
4. Produce structured JSON reports + annotated screenshots as artifacts. Treat results as "investigate" not "build pass/fail."
5. Work on any contributor's machine without manual setup beyond `npm install` + a one-time `claude /login`. The harness checks its own prerequisites and either auto-installs them or prints precise next-step instructions.
6. Run every scenario against the **same known-good starting state** — a checked-in NTT backup zip — so findings reflect the code change, not profile drift.

## Non-goals

- Replacing unit / integration / E2E tests. UAT runs slower, costs money, and is non-deterministic — keep the deterministic tiers as the source of truth for behavior.
- Running on every commit or every PR. Pre-release only.
- Cross-browser testing. Firefox ESR only, same as the rest of the E2E tier.
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

### Chosen: roll our own MCP server, wrapping the existing Puppeteer-over-BiDi setup

`tests/uat/_tools/mcp-server.ts` is a stdio MCP server using `@modelcontextprotocol/sdk`. It holds a Puppeteer connection to the Firefox-ESR launched by `web-ext` (the same lifecycle the E2E tier uses), and exposes a small set of MCP tools (`browser_navigate`, `browser_click`, `browser_hover`, `browser_file_upload`, `browser_take_screenshot`, `browser_snapshot`, `browser_evaluate`). The tool names are deliberately compatible with `@playwright/mcp`'s schema so scenarios and the skill prompt stay portable if a better off-the-shelf option emerges later.

Trade-off accepted: ~150 LOC of new code we own and maintain, versus an off-the-shelf option that tests the wrong browser.

### Fallback (Plan B): single CLI + Bash

If the MCP wrapper hits an unexpected wall (stdio framing, protocol drift, etc.), pivot to the single-CLI route. ~50 LOC more, loses screenshot ergonomics and allowlist precision, but reuses everything else (Firefox launch lifecycle, helpers, fixture).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  npm run test:uat                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  preflight.ts                                                    │
│  - node version meets engines floor                              │
│  - @modelcontextprotocol/sdk resolved at the pinned version      │
│  - firefox-esr on PATH (or pointed at by env)                    │
│  - web-ext available (already a devDep, double-check)            │
│  - claude binary present and authenticated                       │
│  - tsx resolvable                                                │
│  - known-good fixture present at tests/uat/                      │
│      newtabtools_knowngood.zip                                   │
│  Auto-installs npm deps via `npm install`; for the rest, prints  │
│  copy-pastable fix instructions and exits non-zero.              │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  tests/uat/runner.ts                                             │
│  - boots Firefox ESR via run_esr_tests.sh-equivalent             │
│    (web-ext run, BiDi on 9222) — reuses the E2E launch flow      │
│  - for each scenarios/*.md:                                      │
│      spawns: claude -p --output-format=stream-json \             │
│               --mcp-config <config> \                            │
│               --allowedTools "mcp__ntt-uat__*" \                 │
│               < skill-prompt + scenario-body                     │
│      env: NEWTAB_URL, ARTIFACTS_DIR, KNOWN_GOOD_ZIP              │
│      captures: streamed JSON events, screenshots, final report   │
│      writes: artifacts/<scenario-id>/<timestamp>/*               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Claude Code (headless, autonomous)                              │
│  - loaded skill: .claude/skills/uat-scenario.md                  │
│  - per-scenario preamble: open NTT, verify load, open settings,  │
│    restore from $KNOWN_GOOD_ZIP, verify tiles present, reload    │
│  - then: execute scenario-specific steps                         │
│  - tools (via our MCP server below): browser_navigate,           │
│    browser_click, browser_hover, browser_file_upload,            │
│    browser_take_screenshot, browser_snapshot, browser_evaluate   │
└────────────────────────┬─────────────────────────────────────────┘
                         │  stdio (spawned by Claude)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  tests/uat/_tools/mcp-server.ts (our own ~150 LOC)               │
│  - @modelcontextprotocol/sdk Server over stdio                   │
│  - holds 1 Puppeteer connection to Firefox-ESR via BiDi 9222     │
│  - reuses tests/e2e/_helpers.js (getExtensionUUID, file upload,  │
│    waitForCondition, etc.)                                       │
│  - returns screenshot tool results as MCP image content (inline) │
└──────────────────────────────────────────────────────────────────┘
```

Why these pieces:

- **Claude Code headless mode** (`claude -p`) runs the agent loop, handles auth via the developer's subscription, supports streamed JSON output for the runner to consume.
- **Our own MCP server** (`tests/uat/_tools/mcp-server.ts`) bridges Claude's MCP tool calls to the existing Puppeteer-over-BiDi infrastructure. Custom rather than off-the-shelf because no off-the-shelf MCP server can drive system Firefox ESR (see Spike outcome above).
- **Skill** (`.claude/skills/uat-scenario.md`) bundles the system prompt, output-format contract, allowed tools, and the per-scenario restore preamble — so each scenario file stays short and focused on the user flow being tested.
- **Preflight** is a separate Node script the runner invokes before doing anything else. Contributors run on different infra (WSL, native Linux, macOS); the most common failure mode for an LLM-driven tier is "the prereq I assumed exists doesn't" — surfaced opaquely deep inside a tool call.
- **Known-good zip fixture** is a checked-in NTT backup containing 4×4 grid prefs and 9 representative tiles (some with thumbnails). Every scenario starts from this state, so findings reflect the code change, not profile drift — and the restore flow itself is dogfooded on every run.

---

## Components

### 1. Known-good fixture (`tests/uat/newtabtools_knowngood.zip`)

A checked-in NTT backup zip used as the starting state for every UAT scenario. Contents:

- `prefs.json` — 4×4 grid, medium spacing/title/margin, system theme with auto-follow, `tileAspect: fill`, a populated blocklist, a wallpaper URL from Mozilla's CDN.
- `tiles.json` — 9 tiles at positions 2–7 (positions 0–1 deliberately empty so layout edge cases are exercised). URLs point at real Swiss news/shopping sites — the agent must never navigate to them; tiles are rendered, not visited.
- `tileImages/*.png` — 5 thumbnails for the tiles that have them, ~400KB each, real captures of the live pages.

Why this shape:
- **4×4 grid with empty positions 0–1** stresses gap rendering, drag-reorder, hover overlap.
- **Mix of tiles with and without thumbnails** exercises the auto-thumbnail fallback path.
- **Wallpaper from a CDN URL** dogfoods the background-image render path. If the CDN is unreachable the wallpaper won't load — scenarios that care should note this as an acceptable failure mode.
- **System theme + themeAuto** means rendered colours depend on the host OS theme. Scenarios that care about a specific theme must override via Setup.

**Rules for the fixture:**
- It is part of the test contract. Don't regenerate it on a whim — every change invalidates the comparison baseline that scenarios assume.
- When the schema changes (new prefs key, new tile field), regenerate the fixture and bump a `fixtureVersion` line in `tests/uat/README.md`. The Skill prompt references this version so the agent can flag obviously-stale fixtures.
- Keep it under 5MB. Current size: ~2.1MB.
- Never put credentials, tokens, or personal browsing data in the fixture. The current contents are public site URLs and screenshots of public pages.

### 2. Directory layout

```
tests/uat/
  newtabtools_knowngood.zip      # the fixture (checked in)
  scenarios/
    01-fresh-install.md
    02-tile-hover.md
    03-dark-theme.md
    04-pin-toggle.md
    05-locked-state.md
    # later phases:
    # 06-drawer-open.md
    # 07-zen-mode.md
  _tools/
    mcp-config.json              # config Claude reads to spawn the MCP server
    mcp-server.ts                # our MCP server (~150 LOC), spawned per scenario
    skill-loader.ts              # reads .claude/skills/uat-scenario.md, returns prompt body
  preflight.ts                   # prerequisite check + auto-install where possible
  runner.ts                      # orchestrator (TypeScript, run via tsx)
  README.md                      # how to run, add scenarios, debug artifacts
  artifacts/                     # gitignored — per-run output
.claude/
  skills/
    uat-scenario.md              # the agent skill
```

Add to `.gitignore`: `tests/uat/artifacts/`. The fixture itself is checked in.

### 3. Preflight (`tests/uat/preflight.ts`)

Runs at the very start of `npm run test:uat`. Hard requirement: a contributor can clone the repo on a clean machine, run `npm install && npm run test:uat`, and either the run starts or they're told exactly what to do next.

**Checks (in order; fail-fast):**

| # | Check | If missing |
|---|---|---|
| 1 | Node version meets `package.json` `engines` floor | Print upgrade instructions; exit 1 |
| 2 | `node_modules/@modelcontextprotocol/sdk` exists at the pinned version | Auto-run `npm install`; if still missing, exit 1 |
| 3 | `firefox-esr` resolvable (`which firefox-esr` or `$FIREFOX_BIN`) | Print `TESTING.md` install instructions; exit 1 |
| 4 | `web-ext` resolvable (already a devDep, double-check) | Auto-run `npm install`; if still missing, exit 1 |
| 5 | `claude` CLI on PATH | Print install link (`https://docs.claude.com/claude-code`); exit 1 |
| 6 | `claude` is authenticated | Run `claude -p "ping"` with a 10s timeout; if it errors or asks for login, instruct `claude /login` and exit 1 |
| 7 | `tsx` resolvable | Re-run `npm install`; if still missing, exit 1 |
| 8 | `tests/uat/newtabtools_knowngood.zip` exists and is non-empty | Print location and regeneration steps from `tests/uat/README.md`; exit 1 |

**Modes:**
- Default: check + auto-install where safe (npm deps only). Refuse to touch system packages (Firefox ESR) — print instructions instead.
- `--check-only`: don't install anything, just report. Useful for CI debugging.
- `--verbose`: log each probe with timing.

**Output format:** one line per check, `[OK]` / `[FIX]` / `[FAIL]`. End-of-run summary names the first failure and points at `tests/uat/README.md#troubleshooting`. No emoji.

The preflight is the first thing `runner.ts` does — failure aborts before Firefox is launched, before any model tokens are spent.

### 4. Scenario file format

Plain markdown. The runner concatenates this with the skill prompt and pipes to Claude Code via stdin. One scenario per file.

```markdown
---
id: 02-tile-hover
title: Tile hover action row does not occlude content
phase: 1
# Optional: opt out of the standard restore preamble. Use only when the
# scenario itself is testing the restore flow or a clean-state edge case.
# setup: skip-restore
---

## Steps
1. Take a screenshot of the resting state of the grid.
2. Hover over the first tile in position 2 (the QoQa tile).
3. Take a screenshot of the hover state.

## What to judge
- In the resting state: every tile thumbnail must be fully visible. No overlay,
  action row, or other element may be covering more than 30% of any thumbnail.
- In the hover state: the hover action row (5 buttons, top-right) must appear
  on the hovered tile, and must NOT cover the tile title at the bottom.
- The pin stripe (if pinned) must remain visible at the top in both states.
- Positions 0 and 1 are deliberately empty in the fixture — gaps there are
  expected and not a finding.

## Output
Return the structured findings JSON as specified in the skill prompt.
```

**Rules:**
- "What to judge" is fully self-contained in language. No references to design files or reference images.
- Every scenario starts from the known-good fixture state restored by the preamble. Scenarios that *do* want to start clean (e.g. an empty-state scenario) set `setup: skip-restore` in the frontmatter.
- Tile references use the fixture's positions (e.g. "the tile at position 2") rather than CSS selectors that may drift.

### 5. Skill definition (`.claude/skills/uat-scenario.md`)

```markdown
---
name: uat-scenario
description: Execute a NTT user acceptance scenario and report findings.
allowed-tools:
  - mcp__ntt-uat__browser_navigate
  - mcp__ntt-uat__browser_click
  - mcp__ntt-uat__browser_hover
  - mcp__ntt-uat__browser_type
  - mcp__ntt-uat__browser_press_key
  - mcp__ntt-uat__browser_take_screenshot
  - mcp__ntt-uat__browser_snapshot
  - mcp__ntt-uat__browser_evaluate
  - mcp__ntt-uat__browser_file_upload
---

You are running a User Acceptance Test scenario for the New Tab Tools Firefox
extension. The user will provide a scenario describing steps and what to judge.

## Per-scenario preamble (always run, unless frontmatter sets setup: skip-restore)

Before executing the scenario's own Steps section, perform this preamble. It
puts the extension into a known-good state so judgments reflect the code
under test, not profile drift.

1. Navigate to $NEWTAB_URL. Take a "00-loaded.png" screenshot. Confirm the NTT
   new-tab page rendered (look for `#newtab-scrollbox`). If it didn't load,
   record a critical finding and stop — there is no point continuing.
2. Open Settings via the gear icon (`#options-toggle`).
3. Click the "Backup / Restore" entry (`#options-backup-restore`).
4. Use browser_file_upload to upload $KNOWN_GOOD_ZIP into the restore file
   input (`#options-restore-file`).
5. Click the "Restore" button (`#options-restore`).
6. Wait until the grid repopulates. The fixture defines 9 tiles at positions
   2–7 (positions 0–1 are deliberately empty); confirm at least one tile is
   present before continuing.
7. Close the settings panel. Reload the new-tab page so the restored prefs
   apply (theme, wallpaper, grid dimensions). Take a "01-restored.png"
   screenshot.

The preamble is part of the scenario — if any step fails, record a critical
finding (severity: critical, location: "preamble step <N>") and stop. A broken
preamble is itself a UAT finding, because it means the restore feature is
broken and every scenario downstream is unreliable.

Do NOT navigate to any of the URLs listed in the fixture's tiles (Swiss news
and shopping sites). Tiles are rendered, not visited.

## Scenario execution

After the preamble (or instead of it, if `setup: skip-restore`):

1. Execute the scenario's Steps in order using the MCP tools.
2. Take screenshots at every state change. Save with descriptive filenames
   under $ARTIFACTS_DIR.
3. Judge the rendered page against the scenario's "What to judge" criteria.
   The criteria are the sole ground truth — do not import expectations from
   elsewhere. Look for: occlusion, contrast issues, missing elements, broken
   layout, unreadable text.
4. At the end, emit ONE block of JSON matching the schema below. Nothing else.

## Output schema

{
  "scenario_id": "<from frontmatter>",
  "verdict": "pass" | "fail" | "investigate",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "location": "<selector or visual description, or 'preamble step N'>",
      "description": "<what's wrong>",
      "evidence": ["<screenshot filename>"]
    }
  ],
  "evidence": ["<all screenshot filenames captured>"],
  "notes": "<one paragraph: how the run went, anything ambiguous, did the wallpaper CDN load>"
}

## Important

- One JSON block, at the end, no prose around it. The runner parses stdout.
- Do not call tools outside the allowed list.
- Do not navigate away from moz-extension:// pages. Tile URLs are not to be
  visited.
- If you cannot complete a step (element missing, timeout), record it as a
  finding with severity "critical" and continue if possible.
- If the scenario's criteria are ambiguous, mark the verdict "investigate" and
  describe the ambiguity in `notes`. Do not guess.
- If the wallpaper CDN is unreachable (background image fails to load), note it
  in `notes` but do not flag as a finding unless the scenario explicitly says
  the wallpaper must be present.
```

Notes:
- No `Bash(...)` in `allowed-tools`. The agent shouldn't need shell access for a UAT scenario; reducing surface area lowers blast radius if a prompt is malformed.
- No design-reference language. Each scenario's text is the spec.
- The preamble dogfoods the restore flow on every run. If restore breaks, the very first scenario fails fast with a clear finding — and that's a useful signal, not a workaround target.

### 6. Runner (`tests/uat/runner.ts`)

Responsibilities:

- Run `preflight.ts` first. Abort on non-zero exit.
- Parse CLI args: `--scenario <id>` (default: all), `--model <name>` (default: sonnet).
- Launch Firefox ESR via the existing `run_esr_tests.sh`-style lifecycle, or reuse if already running. Capture the BiDi port (9222).
- Generate the per-run `mcp-config.json` pointing Claude at our MCP server (`tests/uat/_tools/mcp-server.ts`) and passing the BiDi port via env.
- For each scenario file:
  - Create `artifacts/<scenario-id>/<ISO-timestamp>/` directory.
  - Build the prompt: skill body + scenario body + injected `$NEWTAB_URL`, `$ARTIFACTS_DIR`, `$KNOWN_GOOD_ZIP` (absolute path to `tests/uat/newtabtools_knowngood.zip`).
  - Invoke Claude Code in headless mode with stream-json output:
    ```bash
    claude -p \
      --output-format=stream-json \
      --mcp-config tests/uat/_tools/mcp-config.json \
      --allowedTools "mcp__ntt-uat__*" \
      --max-turns 50 \
      --model claude-sonnet-4-6
    ```
  - Pipe the prompt to stdin, consume stream-json events, write a transcript log.
  - Extract the final JSON block from the assistant's last message. Validate against the schema.
  - Save `report.json`, `transcript.jsonl`, all screenshots.
- After all scenarios: write a summary `artifacts/<run-timestamp>/summary.md` aggregating verdicts and critical findings. Print path to stdout.
- Exit code: 0 always (this tier never fails the build). The developer reviews the summary.

Implementation notes:

- Use `execa` or Node's `child_process.spawn` for the CLI subprocess.
- Stream-json parsing: each line is one event (`{type: "user"|"assistant"|"tool_use"|...}`). Fail loudly on unknown event types rather than silently dropping them — this is the early warning for Claude Code release drift.
- The runner is a Node script run via `tsx`, not via vitest. Vitest is the wrong harness here — there's no assertion model, just artifact production.
- Keep the runner under ~250 lines. Most logic is shelling out and file I/O.
- Between scenarios, ensure the profile is clean (or that the next scenario's preamble fully restores state). The fixture-based preamble already handles this for scenarios that opt in; for `setup: skip-restore` scenarios, the runner clears tiles via `chrome.runtime.sendMessage({name: 'Tiles.clear'})` (the same handler the E2E suite uses).

### 7. MCP server (`tests/uat/_tools/mcp-server.ts`)

A stdio MCP server using `@modelcontextprotocol/sdk`. Spawned per Claude Code invocation. Holds one Puppeteer connection to the Firefox-ESR launched by the runner. Roughly:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import puppeteer from 'puppeteer-core';
import { connectToFirefox, getExtensionUUID } from '../../e2e/_helpers.js';

const browser = await connectToFirefox();
const page = await browser.newPage();

const server = new Server({ name: 'ntt-uat', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler('tools/list', () => ({ tools: [
  { name: 'browser_navigate',       inputSchema: { /* url */ } },
  { name: 'browser_click',          inputSchema: { /* selector */ } },
  { name: 'browser_hover',          inputSchema: { /* selector */ } },
  { name: 'browser_file_upload',    inputSchema: { /* selector, path */ } },
  { name: 'browser_take_screenshot',inputSchema: { /* name */ } },
  { name: 'browser_snapshot',       inputSchema: { /* (none) */ } },
  { name: 'browser_evaluate',       inputSchema: { /* expression */ } },
]}));

server.setRequestHandler('tools/call', async (req) => {
  switch (req.params.name) {
    case 'browser_take_screenshot': {
      const png = await page.screenshot({ type: 'png' });
      return { content: [
        { type: 'text', text: `saved ${req.params.arguments.name}` },
        { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
      ]};
    }
    // ...etc
  }
});

await server.connect(new StdioServerTransport());
```

Tool names match `@playwright/mcp`'s schema so scenarios and the skill prompt are portable if a better off-the-shelf option emerges later. The `image` content type in tool results is what lets the agent see screenshots inline (the key reason for choosing MCP over Bash+CLI).

The corresponding `tests/uat/_tools/mcp-config.json`:

```json
{
  "mcpServers": {
    "ntt-uat": {
      "command": "tsx",
      "args": ["./tests/uat/_tools/mcp-server.ts"],
      "env": {
        "NTT_UAT_BIDI_PORT": "9222"
      }
    }
  }
}
```

`@modelcontextprotocol/sdk` is installed as a **pinned devDependency** in `package.json` (no `^` / `~`). Version recorded in `tests/uat/README.md` with the date and rationale, per `CONTRIBUTING.md` supply-chain guardrails.

**Plan B fallback if this proves painful:** swap to `tests/uat/_tools/uat-cli.ts` (single CLI, Bash-invoked). Scenarios and skill prompt would change tool-call shape but not content. See Spike outcome.

---

## Cost & running

| Run mode | Frequency | Cost per run | Monthly |
|---|---|---|---|
| Local on-demand (`npm run test:uat`) | a few per phase | covered by CC subscription | n/a |
| Pre-AMO release | every 2 weeks | covered by CC subscription | n/a |

Subscription mode only for the initial implementation. The runner does not read `ANTHROPIC_API_KEY`. CI nightly + API mode are deliberately deferred until the manual workflow proves value.

Implication: every contributor needs an authenticated `claude` CLI on their machine. The preflight enforces this; the `tests/uat/README.md` documents the one-time `claude /login` step.

---

## Implementation steps (in order)

### Step 0 — Architecture spike (✅ complete, 2026-05-21)

Outcome documented in §"Spike outcome" above. Decision: roll-your-own MCP wrapping Puppeteer-over-BiDi, with `Bash + CLI` as Plan B fallback.

### Step 1 — Scaffold + preflight (1.5 hours)

- Create `tests/uat/` with the directory layout above.
- Add `tests/uat/artifacts/` to `.gitignore`. The fixture stays committed.
- Add `"test:uat": "tsx tests/uat/runner.ts"` to `package.json` scripts.
- Add `tsx` and `@modelcontextprotocol/sdk@<pinned>` as devDependencies (no `^`).
- Write `tests/uat/preflight.ts` with the checks listed in §3, including the fixture-presence check.
- Stub `runner.ts` with a hello-world that runs preflight, then spawns `claude -p "say hi"` and writes the response to an artifact.
- Verify on a clean checkout (or via a fresh `git clean -xdf` if you're willing). Preflight should either pass or print actionable instructions.

### Step 2 — Skill + MCP server wiring (2-3 hours)

- Write `.claude/skills/uat-scenario.md` from the template above (with the per-scenario restore preamble, no design-reference language).
- Write `tests/uat/_tools/mcp-server.ts` per the sketch in §7. Reuse `tests/e2e/_helpers.js` for the Puppeteer connection and UUID discovery.
- Write `tests/uat/_tools/mcp-config.json` pointing at the local MCP server.
- Extend the runner to:
  - Boot Firefox ESR via a `run_esr_tests.sh`-style lifecycle (web-ext + BiDi 9222). Reuse if running.
  - Spawn `claude -p` with the MCP config attached.
  - Pipe a hardcoded test prompt that exercises the preamble end-to-end: navigate to NTT, open settings, restore the fixture, screenshot the populated grid.
  - Save screenshots and the response as artifacts.
- Verify end-to-end: extension loads, agent restores the fixture, populated grid screenshot lands in `artifacts/` (and the agent saw it inline).

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
- Add to `CONTRIBUTING.md`'s "Before Committing" section: "For changes that affect the UI, run `npm run test:uat` and review the summary before requesting review."
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

1. **MCP SDK release drift.** `@modelcontextprotocol/sdk` is at v1.29.x and still evolving. Mitigation: pinned dep, lockfile review on upgrade, `npm audit --audit-level=high` is already in CI. Tested CC + SDK versions recorded in `tests/uat/README.md`.
2. **Skill prompt non-determinism.** Same scenario may produce different findings across runs. Mitigation: run each scenario 2-3x during initial calibration, tune the criteria language until findings stabilize. Document the prompt-tuning process in `tests/uat/README.md` so it's repeatable.
3. **Hallucinated findings.** The agent may flag non-issues or miss real ones. Mitigation: screenshots are ground truth — they're saved as artifacts so the developer can spot-check disagreements. The verdict is "investigate" not "fail" — humans always look at the summary before releasing.
4. **Cost runaway.** Easy to leave the runner running in a loop. Mitigation: hard-cap `--max-turns 50` in the runner, log a warning if any scenario hits the cap, never schedule on PR merge or commit push.
5. **CC subscription quota.** Heavy UAT use could throttle interactive Claude Code sessions. Mitigation: pre-release-only usage keeps load light; if it grows, revisit the API-mode deferral.
6. **Stream-json schema drift.** Claude Code's `--output-format=stream-json` is not a stable API contract. Mitigation: the parser fails loudly on unknown event types rather than silently dropping. Pin the tested CC version range in `tests/uat/README.md`; the preflight does not assert a CC version (would block on every release), but the README does.
7. **MCP wrapper proves painful** (stdio framing, BiDi quirks under MCP). Mitigation: Plan B is the single-CLI route (Bash-invoked). Same Firefox-launch lifecycle, same helpers, same fixture; only the tool-call shape changes. Documented in §"Spike outcome".
8. **Preflight staleness.** Prerequisites can change (Node floor, Firefox ESR version requirements, MCP SDK API). Mitigation: preflight failure messages link to a `tests/uat/README.md#troubleshooting` section that gets updated whenever a check is added or modified.
9. **Recursive dependency on the restore flow.** Every scenario's preamble depends on Settings → Backup/Restore working. If restore breaks, every scenario fails the preamble step. Mitigation: this is intentional dogfooding, not a bug — a broken restore *should* fail UAT loudly. Scenarios that specifically test pre-restore states use `setup: skip-restore`.
10. **Fixture staleness.** When schema changes (new prefs key, new tile field), the fixture goes out of date. Mitigation: `fixtureVersion` in `tests/uat/README.md`; the skill is told what version is current and flags obviously-stale fixtures. Regeneration steps documented in `tests/uat/README.md`.
11. **Wallpaper CDN dependency.** The fixture's `backgroundUrl` points to Mozilla's wallpaper CDN. If unreachable (offline run, blocked egress, CDN deprecation), the wallpaper won't load. Mitigation: the skill is told to note CDN-unreachable in `notes` but not flag it as a finding unless a scenario explicitly requires the wallpaper. Optionally: regenerate the fixture without a wallpaper, or with a `data:` URL wallpaper, if CDN reachability becomes a flake source.

---

## Definition of done

- `npm run test:uat` runs five scenarios end-to-end against a live Firefox ESR with the extension loaded, on a freshly-cloned working tree after `npm install` and a one-time `claude /login`.
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
- **Off-the-shelf MCP server.** If Microsoft (or a community fork) ships first-class system-Firefox-ESR support via WebDriver BiDi, swap our `mcp-server.ts` for it. Tool names are already chosen to be schema-compatible with `@playwright/mcp`.
