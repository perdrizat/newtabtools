# Edit / Done mode — design elements

Verify the design elements of edit mode (DESIGNv2_REVIEW §2, refined). Opening the
drawer IS edit mode: the board unlocks, the titlebar button reads `Done`
(copper-filled), the page wallpaper dims so gaps go calm, and:

- **Pinned tiles** show a persistent action row + a centred drag handle — and **no
  dashed outline** (the handle already signals "movable").
- The **one tile open in the Tile tab** gets a single **copper selection ring** with
  a white-separator halo — the only border that carries unique info.
- **Non-pinned candidate slots** get a **dashed** border (= "add here") + a centred
  **"+ Pin tile"** chip over the *full* (un-dimmed, opaque) thumbnail — no wallpaper
  bleed.

Closing returns to the clean locked board with the button back to `Edit`.

Use the standard preamble (navigate, `00-initial` screenshot). `browser_evaluate`
runs via `executeScript` — always `return`. Use real `browser_hover` / `browser_click`.

## Setup — pin a tile so the pinned affordances have something to attach to

The board ships with pinned favourites, but pin one more explicitly so we exercise
the flow:

1. `browser_hover` `.newtab-site:not([pinned])` (reveals its hover row).
2. `browser_click` `.newtab-site:not([pinned]) .ntt-action-btn[data-action="pin"]`.
3. Confirm: `browser_evaluate`
   `return document.querySelectorAll('.newtab-site[pinned]').length >= 1` → `true`.

## Verify — entering edit mode (structural)

4. **Edit opens the drawer + enters edit mode.** `browser_click` `#options-toggle`, then:
   ```js
   return {
     drawerOpen: document.documentElement.hasAttribute('drawer-open'),
     locked: document.documentElement.hasAttribute('locked'),
     btn: document.getElementById('options-toggle').textContent.trim(),
   }
   ```
   Pass = `drawerOpen` true, `locked` false, `btn === "Done"`.

5. **Done button fills copper.**
   ```js
   return getComputedStyle(document.getElementById('options-toggle')).backgroundColor
   ```
   Pass = a non-transparent colour (the accent fill), not the resting surface.

6. **The page wallpaper dims in edit mode.**
   ```js
   return getComputedStyle(document.getElementById('background-fake')).filter
   ```
   Pass = the filter contains `brightness(` with a value < 1 (wallpaper calmed).

## Verify — pinned tile + selection ring (structural)

7. **Pinned tile: drag handle + action row, NO dashed outline.**
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
   Pass = `outline !== "dashed"`, `handle === "flex"`, `actions === "1"`.

8. **Clicking a tile body opens the Tile dialog prefilled + draws the selection
   ring.** First switch to a NON-Tile tab to prove the click switches tabs:
   `browser_click` `[data-drawer-tab="page"]`. Then click the pinned tile's body
   (not an action button): `browser_click` `.newtab-site[pinned] .newtab-link`. Then:
   ```js
   return (() => {
     const t = document.querySelector('.newtab-site[data-selected="true"]');
     if (!t) { return 'none-selected'; }
     const bs = getComputedStyle(t).boxShadow;
     return {
       tab: document.documentElement.getAttribute('drawer-tab'),
       editorVisible: !document.getElementById('options-tile').hidden,
       selected: true,
       ring: bs !== 'none' && /rgb/.test(bs),
     };
   })()
   ```
   Pass = `tab === "tile"` (the click opened the Tile menu from the Page tab),
   `editorVisible` true (prefilled for this tile — edit URL / thumbnail / bg colour),
   `selected` true, and `ring` true (the one selected tile draws the copper + halo
   ring). Drag-to-Move is separate and unaffected.

## Verify — candidate slot + "+ Pin tile" behavior (structural)

9. **Candidate slot: dashed border + "+ Pin tile" chip, thumbnail NOT dimmed.**
   ```js
   return (() => {
     const t = document.querySelector('.newtab-site:not([pinned])');
     if (!t) { return 'no-candidate'; }
     return {
       outline: getComputedStyle(t).outlineStyle,
       addTile: getComputedStyle(t.querySelector('.ntt-add-tile')).display,
       chip: !!t.querySelector('.ntt-add-tile-chip'),
       thumbOpacity: parseFloat(getComputedStyle(t.querySelector('.newtab-thumbnail')).opacity),
     };
   })()
   ```
   Pass = `outline === "dashed"`, `addTile === "flex"`, `chip === true`, and
   `thumbOpacity === 1` (full thumbnail — no wallpaper-bleed dim).

10. **"+ Pin tile" pins immediately + opens the Tile menu (§7).** Capture a
    candidate's URL, click its "+ Pin tile", then assert it pinned and is now the
    selected tile in the Tile tab:
    ```js
    return (() => {
      const t = document.querySelector('.newtab-site:not([pinned])');
      return t ? (t.querySelector('.newtab-link') || {}).href || t.dataset.url || null : null;
    })()
    ```
    Remember that URL. `browser_click` `.newtab-site:not([pinned]) .ntt-add-tile`, then:
    ```js
    return (() => {
      const url = arguments_url; // substitute the URL captured above
      const site = [...document.querySelectorAll('#newtab-grid .newtab-site')]
        .find(s => ((s.querySelector('a.newtab-link') || {}).href) === url);
      return {
        pinned: !!(site && site.hasAttribute('pinned')),
        tileTab: document.documentElement.getAttribute('drawer-tab') === 'tile',
        selected: !!(site && site.getAttribute('data-selected') === 'true'),
      };
    })()
    ```
    (Inline the captured URL string in place of `arguments_url`.) Pass = `pinned`
    true, `tileTab` true, `selected` true — the label and behaviour agree.

## Verify — leaving edit mode (structural)

11. **Done/close returns to the clean locked board.** `browser_click`
    `#options-toggle`, then:
    ```js
    return {
      drawerOpen: document.documentElement.hasAttribute('drawer-open'),
      locked: document.documentElement.hasAttribute('locked'),
      btn: document.getElementById('options-toggle').textContent.trim(),
      handleGone: getComputedStyle(document.querySelector('.newtab-site[pinned] .ntt-drag-handle')).display,
    }
    ```
    Pass = `drawerOpen` false, `locked` true, `btn === "Edit"`, `handleGone === "none"`.

## Visual judgment (one backstop screenshot)

- Re-enter edit mode (`browser_click` `#options-toggle`) and re-select a pinned tile
  (Tile tab → click it), `browser_take_screenshot` named `edit-mode`, and
  `browser_read_screenshot` it. Judge: the drawer is open on the right; the board
  behind it shows the refined edit state — the **selected** tile has a single copper
  ring with a white halo (readable on its thumbnail), pinned tiles show the centred
  drag handle + action row with **no** dashed outline, candidate slots show a dashed
  border + a "+ Pin tile" chip over a full (not muddy) thumbnail, the wallpaper is
  dimmed, and the titlebar button reads `Done` and is copper. The destructive ✕ reads
  as a cooler red, clearly distinct from the copper.
- Pass = one coherent edit state; the selection ring is the unmistakable "editing
  this" cue; copper (movable/add) vs cooler-red (delete) stay distinct; no occlusion.

## Output

- `report.json` — assertions 3–11 plus the visual verdict.
- `summary.md` — lead with the verdict; describe the selection ring, the pinned
  affordances (no dashed), the candidate "+ Pin tile" slots (full thumbnail), the
  wallpaper dim, the "+ Pin tile" immediate-pin behaviour, and the clean exit.
