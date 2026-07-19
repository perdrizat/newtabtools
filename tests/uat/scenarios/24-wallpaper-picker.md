# Wallpaper picker — catalogue vs. Chrome degrade

Open the drawer's wallpaper picker and judge what it actually renders. On
Firefox this is Mozilla's live curated catalogue (real photo thumbnails,
CDN-loaded); on Chrome the picker shows a **hardcoded solid-colour palette**
instead (CHROME.md D8 finding 2 — Mozilla's attachment CDN rejects Chrome
User-Agents server-side with a 406, so Chrome never fetches the catalogue at
all — zero outbound network requests). Upload Image and No Background are
separate controls and unaffected either way.

Skip the restore preamble. `browser_navigate` to the new-tab page, take a
`00-initial` screenshot, then open the drawer (`#options-toggle`) and open the
wallpaper picker (`#options-wallpaper-btn`).

## Verify — picker contents (structural, `browser_evaluate`)

1. **Thumbnails rendered:** `document.querySelectorAll('.wallpaper-thumb').length`
   > `0`.
2. **No error text:** `document.getElementById('wallpaper-grid').textContent`
   does not include `'Unable to load'`.
3. **Platform-appropriate shape** — this assertion branches on which browser the
   daemon is driving:
   - **Chrome:** exactly `15` `.wallpaper-thumb` elements, and
     `document.querySelectorAll('img.wallpaper-thumb').length` === `0` (every
     swatch is a plain colour `DIV`, never an `<img>` — there is nothing to load).
     Additionally the curated-collections link renders below the palette:
     `document.querySelector('.wallpaper-collections-note a').href` ===
     `'https://unsplash.com/t/wallpapers'` (Chrome ships no photo catalogue of
     its own; the link points users at free photos to add via Upload Image).
   - **Firefox:** more than one `.wallpaper-category` heading, and at least one
     `.wallpaper-thumb` is a real `<img>`
     (`document.querySelectorAll('img.wallpaper-thumb').length > 0`).

Take a `01-picker-open` screenshot of the open picker.

## Verify — applying a wallpaper (structural)

4. **Select the first thumbnail and confirm it applies:** `browser_click` the
   first `.wallpaper-thumb`, then assert
   `document.querySelectorAll('.wallpaper-thumb[selected]').length` === `1`.
5. **Page background actually changed:**
   `getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'`
   OR `getComputedStyle(document.body).backgroundImage !== 'none'` — one of the
   two is now set (solid colour on Chrome, CDN image on Firefox).

Close the drawer and take a `02-applied` screenshot of the plain new-tab page
with the wallpaper showing.

## Visual judgment

- Read `01-picker-open`. Judge: the drawer's wallpaper picker is open and shows
  a populated grid of thumbnails with no error text and no broken-image icons
  anywhere. On Firefox the thumbnails should look like real curated photos
  (landscapes/abstracts/etc., grouped under multiple category headings); on
  Chrome they should look like a clean grid of flat colour swatches (no photos,
  no broken-image glyphs — this is the correct degrade, not a bug) with a
  short, legible "Unsplash Wallpapers" link note under the swatches. Either
  way, Upload Image and No Background controls are still present alongside the
  grid.
- Read `02-applied`. Judge: the page background visibly changed to the
  selected wallpaper/colour, filling the page cleanly with no layout glitches,
  no leftover picker chrome, and no broken-image icon anywhere on the page.
- Pass = picker renders correctly for the browser under test (real photos on
  Firefox, solid-colour swatches on Chrome), the selection applies and is
  visibly reflected on the page, and there is no broken-image icon in either
  screenshot.

## Output

- `report.json` — assertions 1–5 plus the visual verdict (record which
  platform-appropriate shape assertion 3 took).
- `summary.md` — lead with the verdict, note which browser was under test and
  whether the catalogue or the solid-colour degrade was shown, and confirm the
  applied wallpaper is visible on the page with no broken images.
