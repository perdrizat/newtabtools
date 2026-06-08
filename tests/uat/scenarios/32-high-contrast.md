# High-contrast theme validation

A validation pass (DESIGNv2_REVIEW §8) — not new design. After the v2 redesign,
confirm the High-contrast theme still holds up: (a) the tile title overlay band
keeps titles legible over light AND dark thumbnails, (b) the destructive ✕ reads as
the single filled red action button (the manual HC theme keeps the alarm-red hue;
the white ring + icon carry legibility on black — only true OS forced-colors falls
back to a hueless inverted treatment), (c) the focus ring stays visible.

Use the standard preamble (navigate, `00-initial`). `browser_evaluate` must
`return`.

## Setup — real thumbnails + high-contrast theme

1. Capture a few thumbnails so overlay legibility can be judged over real pages:
   ```js
   return [...document.querySelectorAll('.newtab-site .newtab-link')].slice(0, 6).map(a => a.href)
   ```
   Pass those URLs to `browser_capture_tiles`, wait ~2s.
2. Switch to High-contrast: `browser_click` `#options-toggle` (open drawer),
   `browser_click` `[data-drawer-tab="page"]`, `browser_click`
   `.ntt-theme-cards button[data-value="contrast"]`. Then assert:
   ```js
   return document.documentElement.getAttribute('theme')
   ```
   Pass = `"contrast"`. Then `browser_click` `#options-toggle` to close the drawer.

## Verify (structural)

3. **Overlay keeps a solid dark floor + title shadow.**
   ```js
   return {
     bg: getComputedStyle(document.querySelector('.ntt-overlay')).backgroundImage,
     shadow: getComputedStyle(document.querySelector('.newtab-title')).textShadow,
   }
   ```
   Pass = `bg` contains `gradient` and `shadow` is a non-`none` text-shadow.

4. **Danger role resolves to a colour** (the drawer Reset/Restore buttons use the
   alarm-red `#cc1633` hue). Open the drawer → Advanced, then:
   ```js
   return getComputedStyle(document.getElementById('options-reset-all')).color
   ```
   Pass = a real colour (not transparent).

5. **Tile action ✕ is the single filled red button (manual HC theme keeps the hue).**
   The manual high-contrast theme controls its own palette, so the destructive ✕
   renders as a filled red button (white icon + white ring keep it legible on black)
   — the one filled button among the outlined neutral trio. The drawer is open (edit
   mode) so the pinned-tile action row is present:
   ```js
   return (() => {
     const x = document.querySelector('.ntt-action-btn[data-action="remove"]');
     const other = document.querySelector('.ntt-action-btn[data-action="pin"], .ntt-action-btn[data-action="edit"], .ntt-action-btn[data-action="refresh"]');
     if (!x || !other) { return 'no-action-row'; }
     const bg = getComputedStyle(x).backgroundColor;
     return { differs: bg !== getComputedStyle(other).backgroundColor, xBg: bg };
   })()
   ```
   Pass = `differs` true and `xBg` is a red fill (not black/transparent) — the ✕ is
   the standout destructive control, with the white ring/icon carrying legibility.
   (True OS `@media (forced-colors: active)` is separate: there the OS strips custom
   colour and the ✕ falls back to a system-colour inverted treatment.) Close the
   drawer afterwards.

## Visual judgment (the core of §8)

- `browser_take_screenshot` named `hc-board`, `browser_read_screenshot` it. Judge
  in the High-contrast theme:
  - **Overlay legibility:** every tile title is clearly readable where it sits,
    including over light/white-topped thumbnails (the band gives the white text a
    floor). Flag any title that washes out.
  - **Destructive ✕ (HC):** enter edit mode and look at a pinned tile's action row —
    the ✕ reads as the single **filled red** button among the outlined neutral trio,
    with a white icon + white ring keeping it legible on the black ground. The drawer
    Reset/Restore buttons share the same alarm red. Flag only if genuinely illegible.
- Open the drawer → Advanced, `browser_take_screenshot` named `hc-advanced`, read
  it. Judge: the Reset/Restore danger buttons and the toggles/controls remain
  legible and distinct in HC.
- Focus the search box (`browser_evaluate`:
  `document.getElementById('ntt-search-input').focus(); return true;`),
  `browser_take_screenshot` named `hc-focus`, read it. Judge: a visible focus ring
  is present on the focused field.
- Pass = overlay AAA-legible + danger distinct + focus ring visible in HC.

## Output

- `report.json` — assertions 2–5 plus the three visual verdicts (overlay, danger,
  focus ring).
- `summary.md` — lead with the verdict; for each of overlay legibility, danger by
  treatment (the ✕ is the inverted action button, not a hue cue), and focus-ring
  visibility, say whether HC holds. This is advisory validation, not redesign.
