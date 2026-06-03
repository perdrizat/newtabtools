# C1 — Restore dogfood

**Goal:** prove the UAT loop works end to end — the standard restore preamble
runs, the fixture's tiles appear, and one screenshot reads as a cleanly
laid-out grid. This is the gate: if C1 can't pass reliably, the tier needs
rethinking before more scenarios are added.

Follow the **standard preamble** from the `uat-scenario` skill (open the drawer →
Advanced → restore the fixture zip → wait for the tiles). Do not skip it — the
restore *is* what this scenario exercises.

## Verify (structural — `browser_evaluate`)

1. **Tiles rendered:** `document.querySelectorAll('.newtab-site').length` === `9`
   — the fixture's nine tiles rendered live (no reload).
2. **Grid dimensions:** `document.querySelectorAll('.newtab-cell').length` === `16`
   — the fixture's 4×4 grid applied (a default profile shows 9; 16 confirms the
   restore changed the grid).
3. **Fixture content present:** the set of `.newtab-title` texts includes at
   least one known fixture title — e.g. one contains `finews.ch` and one
   contains `Tages-Anzeiger`. This proves it's the *fixture's* tiles, not some
   default set.

## Evidence

- Take one screenshot named `01-grid` of the populated grid (evidence-only is
  fine, but you will also judge this one — so read it back, see below).

## Visual judgment

- Read the `01-grid` screenshot inline. Judge: **does the grid look populated
  and cleanly laid out?**
  - Pass = the nine tiles are visible and arranged in a grid, no overlap, no
    blank/empty render, no catastrophic layout break.
  - Fail = blank grid, overlapping/clipped tiles, tiles off-screen, or content
    that's unreadable.
- The fixture's wallpaper is a Mozilla-CDN image that may not load in a headless/
  offline run — note its presence or absence as an observation, but do **not**
  fail the scenario on a missing wallpaper.

## Output

- `report.json` — the three structural assertions above plus the visual verdict.
- `summary.md` — one short paragraph: lead with the verdict, then what the grid
  looked like (layout, tiles, wallpaper).
