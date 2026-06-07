# High-contrast theme validation

A validation pass (DESIGNv2_REVIEW §8) — not new design. After the v2 redesign,
confirm the High-contrast theme still holds up: (a) the tile title overlay band
keeps titles legible over light AND dark thumbnails, (b) the danger red stays
distinct against the HC background, (c) the focus ring stays visible.

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

4. **Danger role resolves to a colour** (used by the destructive buttons + the
   trend-down stat). Open the drawer → Advanced, then:
   ```js
   return getComputedStyle(document.getElementById('options-reset-all')).color
   ```
   Pass = a real colour (not transparent) — the danger tone is applied in HC.
   Close the drawer afterwards.

## Visual judgment (the core of §8)

- `browser_take_screenshot` named `hc-board`, `browser_read_screenshot` it. Judge
  in the High-contrast theme:
  - **Overlay legibility:** every tile title is clearly readable where it sits,
    including over light/white-topped thumbnails (the band gives the white text a
    floor). Flag any title that washes out.
  - **Danger distinctness:** if any danger-tinted control is visible, it reads as
    distinct against the HC background (note if the dark danger tone looks weak).
- Open the drawer → Advanced, `browser_take_screenshot` named `hc-advanced`, read
  it. Judge: the Reset/Restore danger buttons and the toggles/controls remain
  legible and distinct in HC.
- Focus the search box (`browser_evaluate`:
  `document.getElementById('ntt-search-input').focus(); return true;`),
  `browser_take_screenshot` named `hc-focus`, read it. Judge: a visible focus ring
  is present on the focused field.
- Pass = overlay AAA-legible + danger distinct + focus ring visible in HC.

## Output

- `report.json` — assertions 2–4 plus the three visual verdicts (overlay, danger,
  focus ring).
- `summary.md` — lead with the verdict; for each of overlay legibility, danger
  distinctness, and focus-ring visibility, say whether HC holds or needs a bump
  (e.g. the dark danger tone). This is advisory validation, not redesign.
