# Restore a backup

Restore the known-good backup zip through the UI and confirm it applies live —
tiles, grid size, spacing, and wallpaper all change with no page reload.

Run the **restore preamble** from the `uat-scenario` skill (navigate → open drawer
→ Advanced → upload the fixture into `#options-restore-file` → click
`#options-restore` then confirm via `#options-restore-confirm` → wait for the grid
to repopulate → close drawer). It leaves a
`00-initial` (before) and `01-restored` (after) screenshot; you'll judge
`01-restored`.

## Verify (structural — `browser_evaluate`)

1. **Grid:** `document.querySelectorAll('.newtab-cell').length` === `16` — the
   fixture's 4×4 grid (a default profile shows 9 cells, so 16 proves the restore
   changed the grid).
2. **Tiles populated:** `document.querySelectorAll('.newtab-site').length` >= `9` —
   the fixture's nine tiles (the remaining cells fill from the seeded history, so
   the count is typically 16; assert at least the fixture's nine).
3. **Spacing pref applied:** `document.documentElement.getAttribute('spacing')`
   === `'medium'`.
4. **Wallpaper applied live:** `document.body.style.backgroundImage` contains
   `firefox-settings-attachments.cdn.mozilla.net` — the fixture's Mozilla-CDN
   wallpaper, applied as a pref with no reload. Empty / `none` is a failure.
5. **Fixture tiles present (by content):**
   ```
   const titles = [...document.querySelectorAll('.newtab-title')].map(t => t.textContent);
   return titles.some(t => t.includes('finews')) && titles.some(t => t.includes('DayDeal')) && titles.some(t => t.includes('LinkedIn'));
   ```
   must be `true` — these are the fixture's own tiles, not a default set.

## Visual judgment

- Read `01-restored`. Judge: the nine tiles sit in a clean 4×4 grid (rows of
  4 / 4 / 1), no overlap or clipping, titles legible, **and** the Mozilla-CDN
  wallpaper is visibly rendered behind them. Pass = clean layout **and** visible
  wallpaper.

## Output

- `report.json` — the five structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict, then what the restored grid and wallpaper
  looked like.
