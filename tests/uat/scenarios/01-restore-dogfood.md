# Restore dogfood

**Goal:** prove the UAT loop works end to end — the standard restore preamble
runs, the fixture's tiles appear, and one screenshot reads as a cleanly
laid-out grid. This is the tier's gate: if this scenario can't pass reliably,
the harness itself needs attention before more scenarios are added.

Follow the **standard preamble** from the `uat-scenario` skill (open the drawer →
Advanced → restore the fixture zip → wait for the tiles). Do not skip it — the
restore *is* what this scenario exercises.

The preamble leaves you two screenshots — `00-initial` (before) and `01-restored`
(the clean restored page, drawer closed). You'll judge `01-restored` below.

## Verify (structural — `browser_evaluate`)

1. **Tiles rendered:** `document.querySelectorAll('.newtab-site').length` === `9`
   — the fixture's nine tiles.
2. **Grid dimensions:** `document.querySelectorAll('.newtab-cell').length` === `16`
   — the fixture's 4×4 grid applied (a default profile shows 9; 16 confirms the
   restore changed the grid).
3. **Fixture content present:** the set of `.newtab-title` texts includes at
   least one known fixture title — e.g. one contains `finews.ch` and one
   contains `Tages-Anzeiger`. This proves it's the *fixture's* tiles, not some
   default set.
4. **Wallpaper applied (mandatory):** `document.body.style.backgroundImage` must
   contain `firefox-settings-attachments.cdn.mozilla.net` — the fixture's
   Mozilla-CDN wallpaper, restored as a pref and applied **live** (no reload). An
   empty string or `none` is a **failure** (the restore did not carry the
   wallpaper through). This is a required assertion, not an observation.

## Visual judgment

- Read the `01-restored` screenshot inline. Judge **both**:
  - **Layout:** the nine tiles are visible in a clean grid — no overlap, no
    blank/empty render, no catastrophic layout break.
  - **Wallpaper:** the Mozilla-CDN background image is visibly rendered behind
    the tiles (not a plain/blank background). If the structural wallpaper
    assertion passed but the image isn't visible in the screenshot, say so —
    that's a finding.
- Pass = tiles laid out cleanly **and** the wallpaper is visibly present.

## Output

- `report.json` — the four structural assertions above plus the visual verdict.
- `summary.md` — one short paragraph: lead with the verdict, then what the grid
  and wallpaper looked like.
