# UAT Plan — LLM-driven user acceptance testing

A new test tier above E2E: an LLM agent walks through scenarios, judges whether things look and work correctly, and produces a human-reviewable report. Replaces the manual pre-release QA pass with an automated one that runs the same scenarios faster, generates evidence artifacts, and catches the bug class structural tests miss (occlusion, contrast, layering, "looks broken to a user").

This plan uses **Claude Code in headless mode** (not the Claude API) as the agent driver, with **Playwright MCP** for browser control. The scenarios are plain English. The whole tier is opt-in (`npm run test:uat`), gated on a separate model budget, and never blocks PR merges.

## Goals

1. Catch user-visible regressions (the "thumbnails occluded by overlay" bug class) before AMO releases without writing more pixel-fragile tests.
2. Stay in the existing repo conventions: TypeScript runner, Firefox ESR via `run_esr_tests.sh`, artifacts under `tests/uat/artifacts/`.
3. Use the developer's existing Claude Code subscription rather than provisioning a separate Anthropic API key — and remain portable to other CLI agents (Codex, Gemini) by keeping the scenario format CLI-agnostic.
4. Produce structured JSON reports + annotated screenshots as artifacts. Treat results as "investigate" not "build pass/fail."

## Non-goals

- Replacing unit / integration / E2E tests. UAT runs slower, costs money, and is non-deterministic — keep the deterministic tiers as the source of truth for behavior.
- Running on every commit or every PR. Pre-release only, with optional nightly cron.
- Cross-browser testing. Firefox ESR only, same as the rest of the E2E tier.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  npm run test:uat                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  tests/uat/runner.ts                                             │
│  - boots Firefox ESR via run_esr_tests.sh (port 9222)            │
│  - starts Playwright MCP server, connected to that Firefox       │
│  - for each scenarios/*.md:                                      │
│      spawns: claude -p --output-format=stream-json \             │
│               --mcp-config <config> \                            │
│               --allowedTools "mcp__playwright__*,..." \          │
│               < skill-prompt + scenario-body                     │
│      captures: streamed JSON events, screenshots, final report   │
│      writes: artifacts/<scenario-id>/<timestamp>/*               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Claude Code (headless, autonomous)                              │
│  - loaded skill: .claude/skills/uat-scenario.md                  │
│  - tools: Playwright MCP (browser_navigate, browser_click,       │
│           browser_take_screenshot, browser_snapshot, ...)        │
│  - drives Firefox, takes screenshots, judges, reports            │
└──────────────────────────────────────────────────────────────────┘
```

Why these pieces:

- **Claude Code headless mode** (`claude -p`) runs the agent loop, handles auth via the developer's subscription, supports streamed JSON output for the runner to consume.
- **Playwright MCP** (`@playwright/mcp` from Microsoft, maintained, Firefox-supported via WebDriver BiDi) exposes `browser_navigate`, `browser_click`, `browser_take_screenshot`, `browser_snapshot` (a11y tree), and others as MCP tools. The agent picks which to call.
- **Skill** (`.claude/skills/uat-scenario.md`) bundles the system prompt, output-format contract, allowed tools, and design context — so each scenario file stays short and focused on the user flow being tested.

---

## Components

### 1. Directory layout

```
tests/uat/
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
    mcp-config.json              # Playwright MCP config (Firefox profile, BiDi port)
    skill-loader.ts              # reads .claude/skills/uat-scenario.md, returns prompt body
  runner.ts                      # orchestrator (TypeScript, run via tsx/vitest)
  README.md                      # how to run, add scenarios, debug artifacts
  artifacts/                     # gitignored — per-run output
.claude/
  skills/
    uat-scenario.md              # the agent skill
```

Add to `.gitignore`: `tests/uat/artifacts/`.

### 2. Scenario file format

Plain markdown. The runner concatenates this with the skill prompt and pipes to Claude Code via stdin. One scenario per file.

```markdown
---
id: 02-tile-hover
title: Tile hover action row does not occlude content
phase: 1
---

## Setup
- Open the extension's new tab page (URL provided by the runner as $NEWTAB_URL).
- Ensure at least one pinned tile exists (use chrome.runtime.sendMessage to pin
  https://uat-hover.example.com if needed; the runner provides a helper).

## Steps
1. Take a screenshot of the resting state.
2. Hover over the first tile.
3. Take a screenshot of the hover state.

## What to judge
- In the resting state: the tile thumbnail must be fully visible. No overlay,
  action row, or other element may be covering more than 30% of the thumbnail.
- In the hover state: the action row (5 buttons, top-right) must appear, and
  must NOT cover the tile title at the bottom.
- The pin stripe (if pinned) must remain visible at the top in both states.

## Output
Return the structured findings JSON as specified in the skill prompt.
```

### 3. Skill definition (`.claude/skills/uat-scenario.md`)

```markdown
---
name: uat-scenario
description: Execute a NTT user acceptance scenario and report findings.
allowed-tools:
  - mcp__playwright__browser_navigate
  - mcp__playwright__browser_click
  - mcp__playwright__browser_hover
  - mcp__playwright__browser_type
  - mcp__playwright__browser_press_key
  - mcp__playwright__browser_take_screenshot
  - mcp__playwright__browser_snapshot
  - mcp__playwright__browser_evaluate
  - Bash(npm run *)
---

You are running a User Acceptance Test scenario for the New Tab Tools Firefox
extension. The user will provide a scenario describing setup, steps, and what
to judge. Your job:

1. Execute the steps in order using the Playwright MCP tools.
2. Take screenshots at every state change. Save them with descriptive filenames
   under $ARTIFACTS_DIR (provided in your environment).
3. Judge the rendered page against the scenario's "What to judge" criteria.
   Be specific. Look for: occlusion (elements covering other elements),
   contrast issues, missing elements, broken layout, unreadable text.
4. At the end, emit ONE block of JSON matching the schema below. Nothing else.

Schema:
{
  "scenario_id": "<from frontmatter>",
  "verdict": "pass" | "fail" | "investigate",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "location": "<selector or visual description>",
      "description": "<what's wrong>",
      "evidence": ["<screenshot filename>"]
    }
  ],
  "evidence": ["<all screenshot filenames captured>"],
  "notes": "<one paragraph: how the run went, anything ambiguous>"
}

Design reference: when judging visual correctness, refer to the design boards
under design_handoff_ntt_v2/ — particularly NTT v2.html — for the intended
appearance. If something looks different from the design, only flag it if it
breaks usability or violates the criteria the scenario specifies.

Important:
- One JSON block, at the end, no prose around it. The runner parses stdout.
- Do not call tools outside the allowed list.
- If you cannot complete a step (element missing, timeout), record it as a
  finding with severity "critical" and continue if possible.
```

### 4. Runner (`tests/uat/runner.ts`)

Responsibilities:

- Parse CLI args: `--scenario <id>` (default: all), `--model <name>` (default: sonnet), `--cli <claude|codex|gemini>` (default: claude).
- Launch Firefox ESR via the existing `run_esr_tests.sh` lifecycle, or reuse if already running. Capture the BiDi port.
- Generate the per-run `mcp-config.json` pointing Playwright MCP at that Firefox instance.
- For each scenario file:
  - Create `artifacts/<scenario-id>/<ISO-timestamp>/` directory.
  - Build the prompt: skill body + scenario body + injected `$NEWTAB_URL` and `$ARTIFACTS_DIR`.
  - Invoke the chosen CLI in headless mode with stream-json output:
    ```bash
    claude -p \
      --output-format=stream-json \
      --mcp-config tests/uat/_tools/mcp-config.json \
      --allowedTools "mcp__playwright__*" \
      --max-turns 50 \
      --model claude-sonnet-4-6
    ```
  - Pipe the prompt to stdin, consume stream-json events, write a transcript log.
  - Extract the final JSON block from the assistant's last message. Validate against the schema.
  - Save `report.json`, `transcript.jsonl`, all screenshots.
- After all scenarios: write a summary `artifacts/<timestamp>/summary.md` aggregating verdicts and critical findings. Print path to stdout.
- Exit code: 0 always (this tier never fails the build). The developer reviews the summary.

Implementation notes:

- Use `execa` or Node's `child_process.spawn` for the CLI subprocess.
- Stream-json parsing: each line is one event (`{type: "user"|"assistant"|"tool_use"|...}`). The runner only needs to extract the final assistant text.
- The runner is a Node script run via `tsx`, not via vitest. Vitest is the wrong harness here — there's no assertion model, just artifact production.
- Keep the runner under ~250 lines. Most logic is shelling out and file I/O.

### 5. Playwright MCP setup (`tests/uat/_tools/mcp-config.json`)

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y",
        "@playwright/mcp@latest",
        "--browser=firefox",
        "--cdp-endpoint=http://127.0.0.1:9222"
      ]
    }
  }
}
```

The `--cdp-endpoint` (or BiDi equivalent — confirm at implementation time) points to the already-running Firefox ESR launched by `run_esr_tests.sh`. The runner overwrites the port at runtime if needed.

If Playwright MCP's Firefox support turns out to be incomplete for this case (verify in step 0 below), fallback options:

- **Roll-your-own MCP server** wrapping the existing Puppeteer-over-BiDi code in `tests/e2e/_helpers.ts`. ~150 lines of TypeScript using `@modelcontextprotocol/sdk`. Exposes the same tool surface (`browser_navigate`, etc.).
- **Bash tool only**: drop MCP entirely, write small Node scripts in `tests/uat/_tools/` (`screenshot.ts`, `click.ts <selector>`, `evaluate.ts <expr>`) and let Claude Code call them via Bash. Uglier and slower (each command reconnects to Firefox) but simpler to stand up.

Decision: try Playwright MCP first (cleanest). Fall back to roll-your-own if Firefox support has gaps.

---

## Multi-LLM portability

The scenario files and the skill body are plain markdown — CLI-agnostic. The runner has a thin adapter layer:

```ts
const CLI_ADAPTERS = {
  claude: {
    command: 'claude',
    args: (cfg) => ['-p', '--output-format=stream-json',
                    '--mcp-config', cfg.mcpConfig,
                    '--allowedTools', cfg.allowedTools.join(','),
                    '--model', cfg.model],
    parseStream: parseClaudeStreamJson,
  },
  codex: {
    command: 'codex',
    args: (cfg) => ['exec', '--json', '--model', cfg.model],
    parseStream: parseCodexStreamJson,
  },
  gemini: {
    command: 'gemini',
    args: (cfg) => ['-p', '--output-format', 'json', '--model', cfg.model],
    parseStream: parseGeminiStreamJson,
  },
};
```

Each adapter takes the same prompt + MCP config and returns the same `{ finalText, toolCalls, transcript }` shape. Switching agents is a `--cli` flag.

Caveats per CLI:

- **Codex** and **Gemini CLI** have different MCP support maturity at the time of writing. Implementor should verify Firefox-over-MCP works in each before committing to portability. If it doesn't, document `--cli claude` as the supported path and codex/gemini as best-effort.
- Skill format is Claude-specific. For other CLIs, the runner inlines the skill body into the prompt (skill loader returns a string regardless of CLI; only Claude consumes the `--skill` mechanism if/when it lands).

---

## Cost & running

| Run mode | Frequency | Cost per run | Monthly |
|---|---|---|---|
| Local on-demand (`npm run test:uat`) | a few per phase | ~$1-2 in equivalent API cost | covered by CC subscription |
| Nightly via GitHub Actions cron | 30/month | ~$1-2 | $30-60 if using API; subscription if local |
| Pre-AMO release | every 2 weeks | ~$1-2 | $2-4 |

Using Claude Code via the developer's subscription: the cost is the subscription quota, not per-call API charges. For nightly CI, this means running on the developer's machine (or a self-hosted runner with CC installed and authenticated) rather than GitHub-hosted runners. Decide between:

- **Subscription mode** (cheaper, requires self-hosted runner): no per-call cost, but CC must be authenticated and the runner must have a desktop session for the auth context.
- **API mode** (more flexible, GitHub-hosted): set `ANTHROPIC_API_KEY` in CI, pay per call. Recommended for nightly automation.

Start with subscription-mode local runs. Add CI nightly later if the manual workflow proves the value.

---

## Implementation steps (in order)

### Step 0 — Spike Playwright MCP with Firefox (1-2 hours)

Before committing to the architecture, verify the foundation:

```bash
# In a scratch directory:
npx @playwright/mcp@latest --browser=firefox --help
# Connect to a running Firefox-ESR-with-BiDi (use run_esr_tests.sh)
# Manually invoke browser_take_screenshot from a minimal MCP client
```

If Firefox + Playwright MCP works for navigate / click / screenshot, proceed. If not, switch to the roll-your-own MCP option before continuing.

### Step 1 — Scaffold (1 hour)

- Create `tests/uat/` with the directory layout above.
- Add `tests/uat/artifacts/` to `.gitignore`.
- Add `"test:uat": "tsx tests/uat/runner.ts"` to `package.json` scripts.
- Add `tests/uat/README.md` with: how to run, how to add a scenario, how to interpret artifacts.
- Stub the runner with a "hello world" that just spawns `claude -p "say hi"` and writes the response to an artifact.

### Step 2 — Skill + Playwright MCP wiring (2-3 hours)

- Write `.claude/skills/uat-scenario.md` from the template above.
- Write `tests/uat/_tools/mcp-config.json` pointing at Firefox.
- Extend the runner to:
  - Boot Firefox ESR via `run_esr_tests.sh` (or reuse if running).
  - Spawn `claude -p` with the MCP config attached.
  - Pipe a hardcoded test prompt: "Take a screenshot of $NEWTAB_URL and describe what you see."
  - Save the screenshot and the response as artifacts.
- Verify end-to-end: extension loads, agent screenshots it, screenshot lands in `artifacts/`.

### Step 3 — First real scenario (2 hours)

- Write `scenarios/01-fresh-install.md` covering the bug class that motivated this work: "Open NTT. Are tile thumbnails fully visible, or is anything covering them?"
- Extend the runner to load + execute one scenario, parse the final JSON, validate it against the schema, save `report.json`.
- Run it. Read the artifacts. Iterate on the skill prompt until the agent produces useful, specific findings (not "looks fine" or hallucinated issues).
- **Acceptance criterion**: replay the runner against the commit where the "occluded thumbnail" bug was present. The agent must flag it. If not, the skill prompt or the scenario judgment criteria need work — fix before adding more scenarios.

### Step 4 — Remaining initial scenarios (3-4 hours)

- Write `02-tile-hover.md` through `05-locked-state.md` (templates listed in the directory layout).
- Run the full suite. Review artifacts. Tune the skill if a scenario class consistently produces bad judgments.

### Step 5 — Summary + multi-scenario reporting (1 hour)

- Runner aggregates per-scenario reports into `artifacts/<run-timestamp>/summary.md`.
- Summary format: a table of scenarios × verdicts, then a section per critical/major finding with screenshot links.
- Print the summary path to stdout when the run completes.

### Step 6 — CLI adapter abstraction (2 hours, optional / later)

- Refactor the runner to use the `CLI_ADAPTERS` pattern above.
- Add stub `codex` and `gemini` adapters. Document which one(s) actually work in `tests/uat/README.md`.
- Defer this if step 2-5 is enough value on its own.

### Step 7 — Document in TESTING.md and CONTRIBUTING.md (30 min)

- Add a "UAT tier" section to `TESTING.md` explaining what it is, when to run, how to interpret.
- Add to CONTRIBUTING.md's "Before Committing" section: "For changes that affect the UI, run `npm run test:uat` and review the summary before requesting review."

---

## Risks & open questions

1. **Playwright MCP Firefox support depth.** Verify in step 0. If incomplete, fall back to roll-your-own MCP wrapping the existing Puppeteer helpers (~150 LOC).
2. **Skill prompt non-determinism.** Same scenario may produce different findings across runs. Mitigation: run each scenario 2-3x during initial calibration, tune the criteria language until findings stabilize. Document the prompt-tuning process in `tests/uat/README.md` so it's repeatable.
3. **Hallucinated findings.** The agent may flag non-issues or miss real ones. Mitigation: screenshots are ground truth — they're saved as artifacts so the developer can spot-check disagreements. The verdict is "investigate" not "fail" — humans always look at the summary before releasing.
4. **Cost runaway.** Easy to leave the runner running in a loop. Mitigation: hard-cap `--max-turns 50` in the runner, log a warning if any scenario hits the cap, never schedule on PR merge or commit push.
5. **Skill drift from design.** As the design evolves through Phases 2-4, the skill's "design reference" must be updated. Mitigation: the skill points at `design_handoff_ntt_v2/` files which the maintainer is already updating. Add a checklist item to each phase: "Update UAT skill design refs if anything moved."
6. **CC subscription quota.** If using subscription mode rather than API mode, heavy UAT use could throttle interactive Claude Code sessions. Mitigation: pre-release-only usage keeps load light; if it grows, switch nightly runs to API mode.
7. **Authentication in CI.** Claude Code subscription auth doesn't easily work in headless CI. If nightly UAT is desired, plan for `ANTHROPIC_API_KEY` mode in CI from the start.

---

## Definition of done

- `npm run test:uat` runs five scenarios end-to-end against a live Firefox ESR with the extension loaded.
- Each scenario produces `report.json`, `transcript.jsonl`, and per-step screenshots under `artifacts/`.
- A `summary.md` aggregates verdicts and critical findings.
- Replaying the runner against the "occluded thumbnail" bug commit produces a `fail` or `investigate` verdict with a finding that names the occlusion.
- `TESTING.md` documents the tier and its place in the workflow.
- The developer's manual pre-release QA pass is shorter because the UAT run catches the obvious things first.

---

## What's explicitly deferred

- **Auto-update baselines / regression-only mode.** UAT here is judgment-based, not snapshot-based — there are no baselines to manage. The pixel-diff approach from the earlier review (§4 in REVIEW_FOLLOWUPS.md) is a separate tool for a different job; this plan does not replace it.
- **Visual diffing of agent runs across commits.** Possible later: store last-known-good artifacts, ask the agent to compare current vs. baseline. Adds complexity; defer until basic UAT proves valuable.
- **Per-PR UAT runs.** Non-determinism + cost = bad gate. Manual trigger only for now.
- **Cross-browser** (Chrome, Safari). The extension is Firefox-only; cross-browser UAT is out of scope until that changes.
