# Environment init

Verify the seeded environment the daemon builds at startup: Firefox history was
seeded (so the default grid fills from `topSites`), the recently-closed row is
populated from real article visits, and the history-derived (non-pinned) tiles
carry no thumbnails — because the extension is installed *after* seeding, nothing
was captured for them. The default **pinned** favourites are the exception: the
daemon captures their screenshots + favicons once at startup, so they do show
imagery (don't count them as "no thumbnail" tiles).

Skip the restore preamble. Just `browser_navigate` to the new-tab page and take a
`00-initial` screenshot, then assert against the live page.

## Verify (structural — `browser_evaluate`)

1. **Default grid size:** `document.querySelectorAll('.newtab-cell').length` === `9`
   (the default 3×3 grid).
2. **Grid filled from history:** `document.querySelectorAll('.newtab-site').length`
   >= `5` — the seeded history surfaced through `topSites` and populated the grid.
3. **Recently-closed populated:** `document.querySelectorAll('.ntt-recent-card').length`
   >= `1` — the article tabs the daemon opened and closed appear in the row.
4. **No thumbnails on history tiles (new-user state):**
   `[...document.querySelectorAll('.newtab-site:not([pinned]) .newtab-thumbnail')].filter(t => getComputedStyle(t).backgroundImage.includes('url')).length`
   === `0` — nothing was captured for the history-derived tiles, because the
   extension loaded after seeding. (Pinned favourites are excluded — they carry
   startup-captured imagery by design.)

## Visual judgment

- Read the `00-initial` screenshot. Judge: the grid is populated — the pinned
  favourites show real page thumbnails + favicons while the history-derived tiles
  show letter/colour fallbacks — the recently-closed row sits in the titlebar with
  one or more cards, and the layout is clean. Pass = populated grid + recent row
  visible + no broken layout.

## Output

- `report.json` — the four structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict, then describe the seeded state: how many
  tiles filled, how many recent cards, and confirm the history tiles carry no
  thumbnails while the pinned favourites do.
