# Tile surface

Verify the main tile elements work as designed (DESIGNv2_REVIEW §3): the bottom
title overlay keeps titles legible, the quick-actions affordance is a kebab at
rest that expands to a 4-action row on hover (Edit URL · Reload · Pin/Unpin ·
Remove, no "open in new tab"), the Remove (✕) is the lone destructive action, the
pinned stripe shows when a tile is pinned, and a tile shows at most one stat
(off by default).

Use the standard preamble (navigate to the new-tab page, `00-initial`
screenshot). `browser_evaluate` runs via `executeScript` — always `return` the
value. Hover states need real `browser_hover` (synthetic events won't trigger
CSS `:hover`).

## Verify (structural — `browser_evaluate`)

1. **Kebab at rest, row hidden.** Before hovering:
   ```js
   return (() => {
     const tile = document.querySelector('.newtab-site');
     if (!tile) { return 'no-tile'; }
     return {
       kebab: getComputedStyle(tile.querySelector('.ntt-actions-kebab')).opacity,
       row: getComputedStyle(tile.querySelector('.ntt-actions')).opacity,
     };
   })()
   ```
   Pass = `kebab` is `"1"` and `row` is `"0"`.

2. **Hover reveals the 4-action row.** `browser_hover` the selector `.newtab-site`,
   then:
   ```js
   return (() => {
     const tile = document.querySelector('.newtab-site');
     const btns = [...tile.querySelectorAll('.ntt-actions .ntt-action-btn')];
     return {
       actions: btns.map(b => b.getAttribute('data-action')),
       rowOpacity: getComputedStyle(tile.querySelector('.ntt-actions')).opacity,
     };
   })()
   ```
   Pass = `actions` equals `["edit","refresh","pin","remove"]` (exactly — no
   `"open"`) and `rowOpacity` is `"1"`.

3. **Remove (✕) carries the danger colour.** Still hovered:
   ```js
   return (() => {
     const tile = document.querySelector('.newtab-site');
     const remove = tile.querySelector('.ntt-action-btn[data-action="remove"]');
     const edit = tile.querySelector('.ntt-action-btn[data-action="edit"]');
     return {
       removeColor: getComputedStyle(remove).color,
       editColor: getComputedStyle(edit).color,
     };
   })()
   ```
   Pass = `removeColor` differs from `editColor` (Remove is danger-tinted, the
   others are neutral ink).

4. **Overlay ramps to a solid floor.** `browser_hover` `body` to leave the hover
   state first, then:
   ```js
   return getComputedStyle(document.querySelector('.ntt-overlay')).backgroundImage
   ```
   Pass = a string containing `gradient`.

5. **At most one stat, off by default.** Stat chips render empty when statType is
   `none`:
   ```js
   return [...document.querySelectorAll('.newtab-site')].map(t => {
     const chip = t.querySelector('.ntt-stat-chip');
     return chip ? chip.textContent.trim() : null;
   }).filter(Boolean).length
   ```
   Pass = `0` (no stat text in the default/new-user state).

6. **Pinning shows the stripe.** Pin a *specific* URL via the drawer rather than
   pinning an existing auto tile — pinning a top-sites tile materializes the whole
   visible set into pinned tiles, which muddies the pinned-vs-auto picture. Open
   the drawer (`browser_click` `#options-toggle`), switch to the Tile tab
   (`browser_click` `[data-drawer-tab="tile"]`), set the pin input
   (`browser_evaluate`:
   `const i = document.querySelector('#options-pinURL-input'); i.value = 'https://example.com/'; i.dispatchEvent(new Event('input', {bubbles:true})); return i.value;`),
   `browser_click` `#options-pinURL`, then close the drawer (`browser_click`
   `#options-toggle`). Then:
   ```js
   return (() => {
     const tile = document.querySelector('.newtab-site[pinned]');
     if (!tile) { return 'not-pinned'; }
     return getComputedStyle(tile.querySelector('.ntt-pin-stripe')).display;
   })()
   ```
   Pass = `"block"` (the pinned tile shows its top-edge stripe).

## Visual judgment

- **Overlay legibility (P0).** To judge titles over real thumbnails, first read a
  few grid tile URLs and capture them:
  ```js
  return [...document.querySelectorAll('.newtab-site .newtab-link')].slice(0, 6).map(a => a.href)
  ```
  Pass those URLs to `browser_capture_tiles`, wait ~2s, `browser_take_screenshot`
  named `thumbs`, then `browser_read_screenshot` it. Judge: each tile title is
  readable where it sits — especially any tile whose lower edge is light/white.
  Flag any title that washes out (contrast failure).
- **Hover row.** `browser_hover` `.newtab-site`, `browser_take_screenshot` named
  `hover-row`, read it. Judge: a tidy top-right row of 4 buttons, the ✕ visibly
  red, none of the buttons covering the title at the bottom.
- Pass = titles legible over light thumbnails + a clean 4-button hover row with a
  red ✕, no occlusion.

## Output

- `report.json` — the six structural assertions plus the two visual verdicts.
- `summary.md` — lead with the verdict; describe overlay legibility (call out any
  washed-out title), the hover action row (count, order, red ✕, occlusion), and
  confirm the pinned stripe appeared and no stats showed by default.
