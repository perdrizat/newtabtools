# Edit / Done mode — design elements

Verify the design elements of edit mode across both the main page and the drawer
(DESIGNv2_REVIEW §2). Opening the drawer IS edit mode: the board unlocks, the
titlebar button reads `Done` (copper-filled), pinned tiles show a persistent
action row + a centred drag handle + a dashed accent outline, and auto
(non-pinned) tiles fade back to offer "+ Add tile". Closing returns to the clean
locked board with the button back to `Edit`.

Use the standard preamble (navigate to the new-tab page, `00-initial`
screenshot). `browser_evaluate` runs via `executeScript` — always `return`. Use
real `browser_hover` for hover states and `browser_click` for clicks.

## Setup — pin a tile so the pinned affordances have something to attach to

The seeded grid is auto (history) tiles. Pin one so edit mode has a pinned tile:

1. `browser_hover` `.newtab-site` (reveals its hover row).
2. `browser_click` `.newtab-site .ntt-action-btn[data-action="pin"]`.
3. Confirm: `browser_evaluate`
   `return document.querySelectorAll('.newtab-site[pinned]').length >= 1` → `true`.
   (If `false`, retry the hover+click once.)

## Verify — entering edit mode (structural)

4. **Edit opens the drawer + enters edit mode.** `browser_click` `#options-toggle`,
   then:
   ```js
   return {
     drawerOpen: document.documentElement.hasAttribute('drawer-open'),
     locked: document.documentElement.hasAttribute('locked'),
     btn: document.getElementById('options-toggle').textContent.trim(),
     drawerVisible: getComputedStyle(document.getElementById('ntt-drawer')).getPropertyValue('aria-hidden') !== 'true' || document.getElementById('ntt-drawer').getAttribute('aria-hidden') === 'false',
   }
   ```
   Pass = `drawerOpen` true, `locked` false, `btn === "Done"`, drawer not aria-hidden.

5. **Done button fills copper.**
   ```js
   return getComputedStyle(document.getElementById('options-toggle')).backgroundColor
   ```
   Pass = a non-transparent colour (the accent fill), not the resting surface.

6. **Pinned tile affordances.**
   ```js
   return (() => {
     const t = document.querySelector('.newtab-site[pinned]');
     if (!t) { return 'no-pinned'; }
     return {
       outline: getComputedStyle(t).outlineStyle,
       handle: getComputedStyle(t.querySelector('.ntt-drag-handle')).display,
       actions: getComputedStyle(t.querySelector('.ntt-actions')).opacity,
     };
   })()
   ```
   Pass = `outline === "dashed"`, `handle === "flex"` (centred drag handle shown),
   `actions === "1"` (persistent action row).

7. **Auto-tile affordances.**
   ```js
   return (() => {
     const t = document.querySelector('.newtab-site:not([pinned])');
     if (!t) { return 'no-auto'; }
     return {
       addTile: getComputedStyle(t.querySelector('.ntt-add-tile')).display,
       faded: parseFloat(getComputedStyle(t.querySelector('.newtab-thumbnail')).opacity) < 1,
     };
   })()
   ```
   Pass = `addTile === "flex"` ("+ Add tile" shown) and `faded === true`.

## Verify — leaving edit mode (structural)

8. **Done/close returns to the clean locked board.** `browser_click`
   `#options-toggle` again, then:
   ```js
   return {
     drawerOpen: document.documentElement.hasAttribute('drawer-open'),
     locked: document.documentElement.hasAttribute('locked'),
     btn: document.getElementById('options-toggle').textContent.trim(),
     handleGone: getComputedStyle(document.querySelector('.newtab-site[pinned] .ntt-drag-handle')).display,
   }
   ```
   Pass = `drawerOpen` false, `locked` true, `btn === "Edit"`, `handleGone === "none"`.

## Visual judgment

- Re-enter edit mode (`browser_click` `#options-toggle`), `browser_take_screenshot`
  named `edit-mode`, and `browser_read_screenshot` it. Judge against the drawer
  mock: the configuration drawer is open on the right; the board behind it shows
  edit affordances — the pinned tile has a copper dashed outline with a centred
  drag handle and a top-right action row whose ✕ is red; the auto tiles are faded
  with a centred "+ Add tile"; the titlebar button reads `Done` and is copper.
- Pass = drawer + board read as one coherent edit state, two colours (copper
  movable / red delete), no occlusion or broken layout.

## Output

- `report.json` — assertions 3–8 plus the visual verdict.
- `summary.md` — lead with the verdict; describe the edit-mode affordances on
  both pinned and auto tiles, the Done button, and that closing restored the
  clean locked board.
