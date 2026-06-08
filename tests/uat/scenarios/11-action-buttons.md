# Tile action buttons

At rest a tile shows a single kebab; on hover the kebab is replaced by a row of
action buttons across its top. The row must be hidden at rest, appear on hover,
stay inside the tile, and not cover the tile's title (§3c).

Skip the restore preamble. `browser_navigate` to the new-tab page and take a
`00-initial` screenshot (resting state, no hover).

Target the first tile: `.newtab-cell:nth-child(1) .newtab-site`. Its parts are
`.ntt-actions-kebab` (the rest affordance), `.ntt-actions` (the hover row), and
`.newtab-title` (the bottom overlay).

## Verify — resting state (structural, `browser_evaluate`)

1. **Action row hidden at rest:**
   `getComputedStyle(document.querySelector('.newtab-cell:nth-child(1) .ntt-actions')).opacity`
   === `'0'`.
1b. **Kebab shown at rest:**
   `getComputedStyle(document.querySelector('.newtab-cell:nth-child(1) .ntt-actions-kebab')).opacity`
   === `'1'`.

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
6. **The destructive ✕ is the standout filled button.** While hovered:
   ```
   const cell = document.querySelector('.newtab-cell:nth-child(1) .newtab-site');
   const x = cell.querySelector('.ntt-action-btn[data-action="remove"]');
   const other = cell.querySelector('.ntt-action-btn[data-action="edit"], .ntt-action-btn[data-action="pin"], .ntt-action-btn[data-action="refresh"]');
   const cs = getComputedStyle(x), co = getComputedStyle(other);
   return {
     filled: cs.backgroundColor !== co.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
     larger: parseFloat(cs.width) > parseFloat(co.width),
     separators: cs.boxShadow !== 'none',
   };
   ```
   Pass = `filled` true (solid alarm-red fill, unlike the neutral trio), `larger`
   true (~2px bigger), `separators` true (the white ring + drop shadow box-shadow).

## Evidence + visual judgment

- Take a `02-hover` screenshot while the tile is hovered. Read it inline and judge:
  the action buttons are visible along the top edge of the hovered tile, the tile's
  title is still fully readable at the bottom, and the buttons are a small overlay
  rather than a full-tile cover. **The ✕ reads as a solid alarm-red button with a
  white icon — clearly distinct from the copper accent — standing out from the
  neutral edit/refresh/pin trio (which sit on a small dark scrim); the ✕ stays
  legible whatever the thumbnail behind it.** Pass = action row visible, title
  legible, no large-area occlusion, and the ✕ is the obvious destructive control.

## Output

- `report.json` — the seven structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict, then describe the hover state: where the
  action row sits, whether it occludes the title, and whether the ✕ reads as the
  standout destructive control (filled alarm-red, ring + shadow) vs the neutral trio.
