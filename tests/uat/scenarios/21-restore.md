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

6. **Restore file picker is themed (not a native grey widget).** Re-open the drawer
   → Advanced (`browser_click` `#options-toggle`, then `[data-drawer-tab="advanced"]`),
   then:
   ```js
   return (() => {
     const input = document.getElementById('options-restore-file');
     const label = document.querySelector('label[for="options-restore-file"]');
     const nameEl = document.querySelector('.ntt-file-name');
     return {
       inputHidden: input.offsetWidth <= 1 && input.offsetHeight <= 1,
       labelThemed: !!label && getComputedStyle(label).borderTopStyle === 'solid',
       fileName: nameEl ? nameEl.textContent : '',
     };
   })()
   ```
   Pass = `inputHidden` true and `labelThemed` true — the "Choose file…" control is a
   themed `<label>` matching the drawer buttons, with the native input hidden;
   `fileName` shows the restored fixture's filename. Take a `02-restore-control`
   screenshot and `browser_read_screenshot` it.

## Visual judgment

- Read `01-restored`. Judge: the nine tiles sit in a clean 4×4 grid (rows of
  4 / 4 / 1), no overlap or clipping, titles legible, **and** the Mozilla-CDN
  wallpaper is visibly rendered behind them. Pass = clean layout **and** visible
  wallpaper.
- Read `02-restore-control`. Judge: the Restore row's "Choose file…" control is a
  themed button (matches the other drawer buttons in the active theme — not a native
  system-grey file widget), with the selected filename shown in themed type beside it.

## Output

- `report.json` — the six structural assertions plus the two visual verdicts.
- `summary.md` — lead with the verdict, then what the restored grid + wallpaper
  looked like, and that the Restore file control is themed (not native).
