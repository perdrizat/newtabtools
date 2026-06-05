# Config changes apply live

Change a few settings through the drawer and confirm each takes effect
immediately, with no page reload.

Skip the restore preamble. `browser_navigate` to the new-tab page, take a
`00-initial` screenshot, then open the drawer: click `#options-toggle` (the Page
panel is active by default).

## Verify — each change applies live (structural, `browser_evaluate`)

1. **Columns:** click `.ntt-segmented[data-pref="columns"] button[data-value="5"]`,
   then assert `document.querySelectorAll('.newtab-cell').length` === `15` — the grid
   reflowed to 5 columns × 3 rows (was 9).
2. **Theme:** click `.ntt-theme-cards button[data-value="dark"]`, then assert
   `document.documentElement.getAttribute('theme')` === `'dark'`.
3. **Search toggle:** click `button.ntt-toggle[data-pref="titleBarSearch"]`, then
   assert `document.querySelector('#ntt-search').hidden` === `true` — the search bar
   is hidden.

With the drawer **still open** on the Page panel, take a `01-config-drawer`
screenshot — it shows the config controls and the reconfigured grid behind them.
Then close the drawer (click `#options-toggle`) and take a `02-reconfigured`
screenshot of the unobstructed grid.

## Visual judgment

- Read `01-config-drawer`. Judge: the config drawer is open showing the grid
  (columns/rows), theme, and titlebar controls, with the changed settings reflected
  (5 columns selected, dark theme card active, search toggle off). Then read
  `02-reconfigured`: the unobstructed page shows a wider grid (5 across), dark theme,
  and no search bar. Pass = the drawer is visibly captured **and** all three changes
  are reflected, with the layout still clean (no overlap/clipping).

## Output

- `report.json` — the three structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict, then describe the reconfigured page: column
  count, theme, and the hidden search bar.
