---
name: uat-scenario
description: Execute a NewTab PowerTools UAT scenario against a live release-Firefox session (held by the browser-daemon and reached via the ntt-uat MCP server). Produce a structured report.json plus a natural-language summary.md.
allowed-tools:
  - mcp__ntt-uat__browser_navigate
  - mcp__ntt-uat__browser_click
  - mcp__ntt-uat__browser_evaluate
  - mcp__ntt-uat__browser_file_upload
  - mcp__ntt-uat__browser_take_screenshot
  - mcp__ntt-uat__browser_read_screenshot
  - Write
---

You are running a UAT scenario for the NewTab PowerTools Firefox extension. The runner has given you a scenario markdown file. A runner-injected prologue at the top of the prompt tells you the **scenario slug**, the **fixture zip path**, and the **exact absolute paths** to write your report (JSON) and summary (markdown) to. Your job:

1. Run the standard preamble (below) unless the scenario opts out.
2. Walk the scenario's Setup → Verify → Visual judgment sections.
3. Write your report and summary to the two exact paths named in the prologue.

All scenarios of a run share one flat artifacts directory, so the runner gives you per-scenario filenames — use the prologue's paths verbatim; do not invent `report.json` / `summary.md` in some other location. The runner reads your report to roll up pass/fail; humans read your summary to understand what happened. Screenshots are auto-named and placed by the tools — you only pass a short shot name like `01-grid`.

## Standard preamble

Every scenario starts from the same NewTab PowerTools state — the fixture restored via the UI. The browser daemon already launched Firefox, seeded its history with a fixed list of URLs, and installed the extension; you don't need to repeat any of that. Unless the scenario says "skip preamble," do exactly this:

1. `mcp__ntt-uat__browser_navigate` to the extension's `newTab.xhtml`. The daemon is already there, but navigating again confirms the page is reachable and gets you a stable starting frame.
2. Click `#options-toggle` to open the settings drawer.
3. Click `[data-drawer-tab="advanced"]` to switch to the Advanced panel.
4. `mcp__ntt-uat__browser_file_upload` the fixture into selector `#options-restore-file`. The fixture's absolute path is given in the runner prologue ("Fixture zip (absolute path)") — use it verbatim; do not compute it.
5. Click `#options-restore`.
6. Wait until `document.querySelectorAll('.newtab-site').length === 9` (use `browser_evaluate` in a small polling loop; 10-second budget). The tiles render **live** — no page reload is needed.

**Grid vs. tiles — don't confuse them.** The fixture sets a 4×4 grid, so after restore there are **16** `.newtab-cell` elements (the grid slots) of which **9** become populated `.newtab-site` tiles. `.newtab-cell` count is therefore *not* a restore signal — a fresh/default profile already shows 9 empty cells (3×3). Always assert on `.newtab-site` (populated tiles) or on tile content (titles/links), never on raw `.newtab-cell` count, to confirm a restore worked.

If any preamble step fails — selector missing, file input rejects the zip, count never hits 9 — record it as a critical assertion in `report.json` and stop the scenario. A broken preamble means restore itself is broken, which is itself a finding.

## Assertion vocabulary

Match the tool to the kind of assertion:

| Kind | Tool | When |
|---|---|---|
| **Structural** (count, text, attribute, URL, dimension, computed style) | `mcp__ntt-uat__browser_evaluate` | Anything you can express as a JS expression returning a primitive |
| **Evidence-only** (capture for the record) | `mcp__ntt-uat__browser_take_screenshot` | When the scenario or your judgment calls for a screenshot but you don't need to look at it yourself — the runner archives it; do NOT `browser_read_screenshot` evidence-only shots |
| **Visual judgment** (does this look right?) | `browser_take_screenshot` + then `browser_read_screenshot` | When the scenario asks you to judge — read the image inline, write a verdict in `summary.md` and `report.json` |

`browser_read_screenshot` costs ~1200 image tokens. Read only the shots you must judge.

## Output

### Report (JSON)

Write it to the exact "report" path given in the runner prologue. Schema:

```json
{
  "scenario": "<slug from the runner prologue>",
  "passed": true,
  "assertions": [
    {
      "name": "preamble: drawer opens after #options-toggle click",
      "kind": "structural",
      "passed": true,
      "expected": "drawer element has [open] attribute",
      "actual": "open",
      "evidence": null
    },
    {
      "name": "grid: 9 populated tiles after restore",
      "kind": "structural",
      "passed": true,
      "expected": "9 .newtab-site tiles (in a 16-cell 4×4 grid)",
      "actual": "9 tiles, 16 cells",
      "evidence": null
    },
    {
      "name": "visual: grid layout integrity",
      "kind": "visual",
      "passed": true,
      "expected": "tiles visible, no obvious layout breaks",
      "actual": "all 9 tiles rendered with thumbnails, no overlap, wallpaper visible",
      "evidence": "<screenshot filename — the basename browser_take_screenshot reported in its `saved` field>"
    }
  ],
  "screenshots": ["<filenames as reported by browser_take_screenshot's `saved`>"]
}
```

`passed` at the top level is `true` only if every assertion's `passed` is `true`. For `evidence` / `screenshots`, record the **actual saved filename** (the basename of the `saved` path `browser_take_screenshot` returns — it carries a run-stamp + scenario prefix), not the short name you passed in, so a human can find it in the flat run directory.

### Summary (markdown)

Write it to the exact "summary" path given in the runner prologue. One to three short paragraphs:

- **Lead with the verdict.** "All assertions passed" or "X of Y failed".
- **Then what you saw.** Focus on the visual judgments — that's the bug class UAT targets that automated tests miss. Flag any of:
  - **Occlusion** — element covering content it shouldn't (the original motivating bug class)
  - **Contrast** — text unreadable against background
  - **Layering** — z-order surprises
  - **Layout breaks** — overlaps, off-screen, weird wrapping at certain widths

Avoid generic "looks fine." Be specific even when nothing's wrong: "Grid renders cleanly at the default viewport, 4×4 layout with the 9 fixture tiles visible. Wallpaper loads and provides comfortable contrast for the tile titles."

## Constraints

- Use only the seven allowed tools above. No `Bash`, no `Read`, no `Edit`.
- Do NOT navigate to URLs outside the extension's `moz-extension://` origin. Tiles are rendered, not visited — the daemon has already seeded Firefox's history with the test URLs.
- Do NOT call `browser_read_screenshot` on evidence-only screenshots.
- `Write` requires absolute paths. Use the exact report/summary paths from the runner prologue verbatim.
- Stop early if the preamble fails. There's no point continuing if restore is broken.

## When the UI has drifted from the selectors above

If a documented selector returns no element (e.g. `#options-toggle` was renamed in a refactor), don't guess:

1. Record the missing selector as a critical assertion in `report.json` with `actual: "selector not found"`.
2. Note the drift in `summary.md` so this skill prompt can be updated.
3. Stop the scenario — most subsequent steps will fail downstream of a missing selector.

## Style

- Tight assertion names ("grid: 9 tiles after restore"), descriptive expected/actual values.
- No emoji.
- No prescriptive fixes in `summary.md` — your job is to report, not diagnose.
