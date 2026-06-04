# Tile hover — action row must not occlude content

**Goal:** the bug class this tier exists for. On hover a tile shows an action-button
row across its top. It must appear when hovered, stay *inside* the tile, and must
**not** cover the tile's title — the original "overlay occludes the thumbnail/title"
regression. Pure structural assertions can't catch "looks covered", so this leans
on a hover-state screenshot judged inline.

Run the **standard preamble** (restore the fixture). The preamble's `01-restored`
screenshot is the resting state (drawer closed, no hover) — keep it; you'll
contrast it with the hover state.

Target the tile at **position 5** (the QoQa tile, which has a real thumbnail):
selector `.newtab-cell:nth-child(6) .newtab-site`. Its parts are
`.ntt-actions` (the action row) and `.newtab-title` (bottom overlay).

## Verify — resting state (structural, `browser_evaluate`)

1. **Action row hidden at rest:** before hovering,
   `getComputedStyle(document.querySelector('.newtab-cell:nth-child(6) .ntt-actions')).opacity`
   === `'0'` — at rest the row is invisible, so nothing covers the thumbnail.

## Verify — hover state (structural)

Hover the tile with `browser_hover` on `.newtab-cell:nth-child(6) .newtab-site`,
then assert (each as a single `return`-ing expression):

2. **Action row appears:**
   `getComputedStyle(document.querySelector('.newtab-cell:nth-child(6) .ntt-actions')).opacity`
   === `'1'`.
3. **Action buttons rendered:**
   `document.querySelectorAll('.newtab-cell:nth-child(6) .ntt-actions .ntt-action-btn').length`
   is `>= 1`.
4. **Buttons do not cover the title (the occlusion check):** measure the *visible
   buttons*, not the `.ntt-actions` container — the container can be larger than
   the buttons (even full-tile and transparent), so its rect overlapping the title
   doesn't mean anything is visually covered. Assert the lowest button sits above
   the title:
   ```
   const s = document.querySelector('.newtab-cell:nth-child(6) .newtab-site');
   const btns = [...s.querySelectorAll('.ntt-action-btn')];
   const t = s.querySelector('.newtab-title').getBoundingClientRect();
   const lowest = Math.max(...btns.map(b => b.getBoundingClientRect().bottom));
   return lowest <= t.top;
   ```
   must be `true`. If a button overlaps the title vertically, that's the occlusion bug.
5. **Buttons stay inside the tile:** every action button is within the tile's
   bounds (no overflow) — compare each `.ntt-action-btn` rect to the
   `.newtab-site` rect:
   ```
   const s = document.querySelector('.newtab-cell:nth-child(6) .newtab-site');
   const r = s.getBoundingClientRect();
   return [...s.querySelectorAll('.ntt-action-btn')].every(b => {
     const x = b.getBoundingClientRect();
     return x.left >= r.left - 1 && x.right <= r.right + 1 && x.top >= r.top - 1 && x.bottom <= r.bottom + 1;
   });
   ```
   must be `true`.

## Evidence + visual judgment

- Take a screenshot `02-hover` while the tile is hovered. Read it inline and judge:
  - the action buttons are visible along the **top edge** of the hovered tile,
  - the tile's **title is still fully readable** at the bottom (not covered),
  - the thumbnail is still largely visible (the row is a small corner overlay, not
    a full-tile cover).
  - Pass = action row visible **and** title legible **and** no large-area occlusion.
  - Fail = the row covers the title, spans most of the tile, or the title/thumbnail
    is obscured.
- Contrast with the resting `01-restored` shot (no action row) if helpful.

## Output

- Report (JSON) at the prologue's report path — the five structural assertions plus
  the visual verdict.
- Summary (markdown) at the prologue's summary path — lead with the verdict, then
  describe the hover state: where the action row sits and whether it occludes the
  title or thumbnail.
