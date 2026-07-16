---
name: uat-scenario
description: Execute a NewTab PowerTools UAT scenario against a live browser session (Firefox or Chrome, held by the browser-daemon and reached via the ntt-uat MCP server). Produce a structured report.json plus a natural-language summary.md.
allowed-tools:
  - mcp__ntt-uat__browser_navigate
  - mcp__ntt-uat__browser_click
  - mcp__ntt-uat__browser_hover
  - mcp__ntt-uat__browser_evaluate
  - mcp__ntt-uat__browser_capture_tiles
  - mcp__ntt-uat__browser_file_upload
  - mcp__ntt-uat__browser_take_screenshot
  - mcp__ntt-uat__browser_read_screenshot
  - Write
---

You are running a UAT scenario for the NewTab PowerTools extension (Firefox or Chrome — the prologue tells you which). The runner has given you a scenario markdown file. A runner-injected prologue at the top of the prompt tells you the **scenario slug**, the **browser under test**, the **new-tab origin for this run**, the **fixture zip path**, and the **exact absolute paths** to write your report (JSON) and summary (markdown) to. Your job:

1. Run the standard preamble (below) unless the scenario opts out.
2. Walk the scenario's Setup → Verify → Visual judgment sections.
3. Write your report and summary to the two exact paths named in the prologue.

All scenarios of a run share one flat artifacts directory, so the runner gives you per-scenario filenames — use the prologue's paths verbatim; do not invent `report.json` / `summary.md` in some other location. The runner reads your report to roll up pass/fail; humans read your summary to understand what happened. Screenshots are auto-named and placed by the tools — you only pass a short shot name like `01-grid`.

## Preamble

The browser daemon has already launched the browser named in the prologue (Firefox or Chrome), seeded its history (so the default grid fills from `topSites`), seeded the recently-closed row from real article visits, accepted cookie banners, and made sure the extension is loaded. You don't repeat any of that. On Firefox the extension is installed *after* the history seed (an authentic new-user first render: history-filled grid, no thumbnails yet); on Chrome it is loaded from launch via `--load-extension` (no mid-session unpacked-install path exists), but the same no-thumbnails-yet state holds because nothing was pinned or captured during seeding either way.

Most scenarios start from this default state. Unless the scenario directs otherwise:

1. `mcp__ntt-uat__browser_navigate` to the **extension origin given in the runner prologue** (a stable starting frame — e.g. `moz-extension://<uuid>/newTab.html` on Firefox, `chrome-extension://<id>/newTab.html` on Chrome).
2. **Capture the starting state:** `browser_take_screenshot` named `00-initial`, before you touch anything.

Then walk the scenario's own Verify / Visual sections.

### Restore preamble (only when a scenario says "run the restore preamble")

Some scenarios restore the known-good fixture via the UI. When directed:

1. `browser_navigate` to the extension origin from the prologue; `browser_take_screenshot` named `00-initial`.
2. Click `#options-toggle` (open drawer), then `[data-drawer-tab="advanced"]`.
3. `mcp__ntt-uat__browser_file_upload` the fixture into `#options-restore-file`. The fixture's absolute path is in the runner prologue ("Fixture zip (absolute path)") — use it verbatim.
4. Click `#options-restore`, then click `#options-restore-confirm` in the inline confirmation row that appears. (Restore overwrites the whole setup, so §7 gates it behind an inline Confirm/Cancel row — clicking Restore only *reveals* the prompt; the restore runs on Confirm.)
5. Wait until `document.querySelectorAll('.newtab-cell').length === 16` (poll with `browser_evaluate`, ~10s budget) — the fixture's 4×4 grid is the restore signal. (The grid then fills from the seeded history, so the populated `.newtab-site` count settles at 16, not 9.) Restore applies **live** — tiles, grid, theme, and wallpaper take effect with no reload.
6. Click `#options-toggle` to close the drawer.
7. **Capture the restored state:** `browser_take_screenshot` named `01-restored` — the clean restored page, drawer closed.

If any restore step fails (selector missing, file input rejects the zip, count never hits 9), record it as a critical failed assertion and stop — a broken restore is itself a finding.

**Grid vs. tiles — don't confuse them.** `.newtab-cell` counts the grid slots (rows×columns: **9** for the default 3×3, **16** for the fixture's 4×4); `.newtab-site` counts the populated tiles. Use `.newtab-cell` count for grid dimensions, and `.newtab-site` count or tile content (titles/links) for tile presence.

**Screenshots tell the story.** A reviewer flips through a run's screenshots in filename order to confirm it concluded correctly, so always leave at least the `00-initial` (before) and `01-restored` (after) frames, plus any state your scenario changes. The harness stamps each shot's filename with its capture time, so they always sort in the order you took them — you don't need to worry about ordering, just give each shot a short descriptive name (e.g. `grid`, `about`, `hover`).

## Known v2 behaviours — do NOT flag these as defects

These are intended designs (DESIGNv2_REVIEW), not bugs:

- **Opening the drawer IS Edit mode (§2).** Whenever the drawer is open, the board behind it is in edit mode: pinned tiles show a dashed copper outline + a centred drag handle + a persistent top-right action row; auto (non-pinned) tiles fade and show a centred "+ Add tile"; the titlebar button reads `Done`. This is correct — don't report it as unexpected clutter or occlusion.
- **Reach the page by the extension origin given in the runner prologue** — `moz-extension://<uuid>/newTab.html` on Firefox, `chrome-extension://<id>/newTab.html` on Chrome. `about:newtab` returns an empty non-extension document in this harness — that is not a defect.
- **Chrome has no dynamic context menu (by design, not a bug).** Firefox's per-tile `menus.onShown` context menu is progressive enhancement on top of the identical in-tile hover action row (edit / never-capture / pin / remove); Chrome ships the action row only. Don't flag the missing right-click menu on Chrome.
- **Chrome's theme follows `prefers-color-scheme` only.** `browser.theme` (and its live-update event) is a Firefox-only bonus layered on the shared baseline; on Chrome the board still responds correctly to the OS/browser light-dark setting, just not to an in-browser theme add-on. Don't flag the absence of `browser.theme` following on Chrome.
- **Key selectors:** the drawer is `#ntt-drawer`; the single titlebar action button is `#options-toggle` (reads `Edit`, or `Done` while open); there is no wordmark, padlock, or cogwheel (Board A §1).
- **Recently-closed chips render the letter-block fallback favicon** in the seeded environment (closed-tab session data carries no favicon). §4 permits the fallback at the same size/radius — don't flag the absence of real favicons.
- **Disabled-looking Restore button** when no backup file is selected is the expected resting state.
- **The board ships with a few pinned "favourite" tiles by default** (heise, TechCrunch, Hacker News, MDN, and the NewTab Tools repo) — the daemon pins them at startup and re-pins after every reset, so the default board looks lived-in. They're expected; don't flag them as user-added or unexpected, and a pinned tile correctly shows the accent top-edge stripe. **These pins carry real page thumbnails + favicons** (the daemon captures them once at startup; the between-scenario reset preserves the thumbnails store, so they survive). Only the history-derived (non-pinned) tiles start bare — when a scenario checks the "new-user no-thumbnail" state, scope it to `.newtab-site:not([pinned])`.

## Assertion vocabulary

Match the tool to the kind of assertion:

| Kind | Tool | When |
|---|---|---|
| **Structural** (count, text, attribute, URL, dimension, computed style) | `mcp__ntt-uat__browser_evaluate` | Anything you can express as a JS expression returning a primitive |
| **Evidence-only** (capture for the record) | `mcp__ntt-uat__browser_take_screenshot` | When the scenario or your judgment calls for a screenshot but you don't need to look at it yourself — the runner archives it; do NOT `browser_read_screenshot` evidence-only shots |
| **Visual judgment** (does this look right?) | `browser_take_screenshot` + then `browser_read_screenshot` | When the scenario asks you to judge — read the image inline, write a verdict in `summary.md` and `report.json` |

`browser_read_screenshot` costs ~2800 image tokens (at full resolution). Read only the shots you must judge.

**`browser_evaluate` runs your script via Selenium `executeScript`** — it returns a value only if your script has an explicit `return`. `document.querySelectorAll('.newtab-site').length` returns `null`; `return document.querySelectorAll('.newtab-site').length` returns the number. Always `return` what you want to read, and don't use top-level `await` (wrap async work or assert on something synchronous).

**Hover states need `browser_hover`** — many things (tile action rows, buttons) appear only on real CSS `:hover`, which synthetic JS events can't trigger. Call `browser_hover` with the element's selector; the pointer stays there, so the next `browser_take_screenshot` / `browser_evaluate` sees the hover state. To return to the resting state, hover something neutral (e.g. `body`).

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
  "observations": ["<short note: something true but NOT a pass/fail call — see below>"],
  "screenshots": ["<filenames as reported by browser_take_screenshot's `saved`>"]
}
```

`passed` at the top level is `true` only if every assertion's `passed` is `true`. For `evidence` / `screenshots`, record the **actual saved filename** (the basename of the `saved` path `browser_take_screenshot` returns — it carries a run-stamp + scenario prefix), not the short name you passed in, so a human can find it in the flat run directory.

**`observations[]` — "passed, but a human should know."** Use it for things that are real and worth surfacing but that you are *not* turning into a pass/fail assertion: something looked slightly off, a non-fatal warning appeared, a value was surprising-but-acceptable, the network was slow, an element you didn't assert on seemed unusual. Each entry is one short sentence (string), self-contained (no "see above"). The runner prints these at the end of the run so they aren't buried — so if something caught your eye, put it here rather than only in `summary.md`. Leave the array empty (`[]`) when there's genuinely nothing to note. Things that are actually wrong belong in `assertions` with `passed: false`, not here.

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

- Use only the allowed tools listed in the frontmatter above. No `Bash`, no `Read`, no `Edit`.
- Stay on the extension origin given in the runner prologue. To trigger auto-thumbnail capture, use `browser_capture_tiles` (it opens the tile URLs with a short timeout and returns you to the new-tab page) — don't navigate to external sites yourself.
- Do NOT call `browser_read_screenshot` on evidence-only screenshots.
- `Write` requires absolute paths. Use the exact report/summary paths from the runner prologue verbatim.
- In a restore scenario, stop early if the restore preamble fails — there's no point continuing if restore is broken.

## When the UI has drifted from the selectors above

If a documented selector returns no element (e.g. `#options-toggle` was renamed in a refactor), don't guess:

1. Record the missing selector as a critical assertion in `report.json` with `actual: "selector not found"`.
2. Note the drift in `summary.md` so this skill prompt can be updated.
3. Stop the scenario — most subsequent steps will fail downstream of a missing selector.

## Style

- Tight assertion names ("grid: 9 tiles after restore"), descriptive expected/actual values.
- No emoji.
- No prescriptive fixes in `summary.md` — your job is to report, not diagnose.
