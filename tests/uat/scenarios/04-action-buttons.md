# Tile action buttons

On hover, a tile shows a row of action buttons across its top. The row must be
hidden at rest, appear on hover, stay inside the tile, and not cover the tile's
title.

Skip the restore preamble. `browser_navigate` to the new-tab page and take a
`00-initial` screenshot (resting state, no hover).

Target the first tile: `.newtab-cell:nth-child(1) .newtab-site`. Its parts are
`.ntt-actions` (the action row) and `.newtab-title` (the bottom overlay).

## Verify — resting state (structural, `browser_evaluate`)

1. **Action row hidden at rest:**
   `getComputedStyle(document.querySelector('.newtab-cell:nth-child(1) .ntt-actions')).opacity`
   === `'0'`.

## Verify — hover state (structural)

Hover the tile with `browser_hover` on `.newtab-cell:nth-child(1) .newtab-site`,
then assert (each as a single `return`-ing expression):

2. **Action row appears:**
   `getComputedStyle(document.querySelector('.newtab-cell:nth-child(1) .ntt-actions')).opacity`
   === `'1'`.
3. **Action buttons rendered:**
   `document.querySelectorAll('.newtab-cell:nth-child(1) .ntt-actions .ntt-action-btn').length`
   >= `1`.
4. **Buttons sit above the title (no occlusion):**
   ```
   const s = document.querySelector('.newtab-cell:nth-child(1) .newtab-site');
   const btns = [...s.querySelectorAll('.ntt-action-btn')];
   const t = s.querySelector('.newtab-title').getBoundingClientRect();
   const lowest = Math.max(...btns.map(b => b.getBoundingClientRect().bottom));
   return lowest <= t.top;
   ```
   must be `true`.
5. **Buttons stay inside the tile:**
   ```
   const s = document.querySelector('.newtab-cell:nth-child(1) .newtab-site');
   const r = s.getBoundingClientRect();
   return [...s.querySelectorAll('.ntt-action-btn')].every(b => {
     const x = b.getBoundingClientRect();
     return x.left >= r.left - 1 && x.right <= r.right + 1 && x.top >= r.top - 1 && x.bottom <= r.bottom + 1;
   });
   ```
   must be `true`.

## Evidence + visual judgment

- Take a `02-hover` screenshot while the tile is hovered. Read it inline and judge:
  the action buttons are visible along the top edge of the hovered tile, the tile's
  title is still fully readable at the bottom, and the buttons are a small overlay
  rather than a full-tile cover. Pass = action row visible **and** title legible
  **and** no large-area occlusion.

## Output

- `report.json` — the five structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict, then describe the hover state: where the
  action row sits and whether it occludes the title.
