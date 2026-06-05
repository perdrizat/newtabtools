# Environment init

Verify the seeded environment the daemon builds at startup: Firefox history was
seeded (so the default grid fills from `topSites`), the recently-closed row is
populated from real article visits, and — because the extension is installed
*after* seeding — no thumbnails exist yet.

Skip the restore preamble. Just `browser_navigate` to the new-tab page and take a
`00-initial` screenshot, then assert against the live page.

## Verify (structural — `browser_evaluate`)

1. **Default grid size:** `document.querySelectorAll('.newtab-cell').length` === `9`
   (the default 3×3 grid).
2. **Grid filled from history:** `document.querySelectorAll('.newtab-site').length`
   >= `5` — the seeded history surfaced through `topSites` and populated the grid.
3. **Recently-closed populated:** `document.querySelectorAll('.ntt-recent-card').length`
   >= `1` — the article tabs the daemon opened and closed appear in the row.
4. **No thumbnails yet (new-user state):**
   `[...document.querySelectorAll('.newtab-thumbnail')].filter(t => getComputedStyle(t).backgroundImage.includes('url')).length`
   === `0` — nothing was captured, because the extension loaded after seeding.

## Visual judgment

- Read the `00-initial` screenshot. Judge: the grid is populated (tiles present,
  showing letter/colour fallbacks rather than page thumbnails), the recently-closed
  row sits in the titlebar with one or more cards, and the layout is clean. Pass =
  populated grid + recent row visible + no broken layout.

## Output

- `report.json` — the four structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict, then describe the seeded state: how many
  tiles filled, how many recent cards, and confirm no thumbnails are present.
