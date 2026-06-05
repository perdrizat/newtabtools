# Default UI and first-run capture

A freshly installed extension on the seeded environment: confirm the default
layout and chrome, then exercise the auto-thumbnail + favicon capture by opening
a few tiles.

Skip the restore preamble. `browser_navigate` to the new-tab page and take a
`00-initial` screenshot, then work through the parts below.

Capture is triggered with `browser_capture_tiles` (it opens the tile URLs and
returns you to the new-tab page) — you stay on `moz-extension://` throughout.

## Part A — default layout and chrome (structural, `browser_evaluate`)

1. **Default grid:** `document.querySelectorAll('.newtab-cell').length` === `9`
   (the default 3×3).
2. **Masthead/logo present:** `!!document.querySelector('#ntt-masthead')` === `true`.
3. **Search present:** `const i = document.querySelector('#ntt-search-input'); return !!i && i.placeholder.length > 0` === `true`.
4. **Drawer opens on toggle:** click `#options-toggle`, then assert
   `document.documentElement.hasAttribute('drawer-open')` === `true`. Click
   `#options-toggle` again to close it; assert it's `false`.

## Part B — About metadata (structural)

The About block (`#options-about`, in the Advanced panel) is in the DOM whether or
not the drawer is open. Read (drawer closed):

5. **Version is live:** `document.querySelector('[data-version-slot]').textContent`
   === `chrome.runtime.getManifest().version` (compare both in one expression; do
   not hard-code a number).
6. **Brand:** `document.querySelector('#options-about [data-message="extensionName"]').textContent`
   === `'NewTab PowerTools'`.
7. **GitHub link:** `document.querySelector('#options-about a[data-message="github"]').getAttribute('href')`
   === `'https://github.com/perdrizat/newtabtools'`.

## Part C — capture + favicon collection

8. **No thumbnails before opening anything (new-user state):**
   `[...document.querySelectorAll('.newtab-thumbnail')].filter(t => getComputedStyle(t).backgroundImage.includes('url')).length`
   === `0`.

Now exercise capture across a pinned and unpinned tile:

- **Pin a tile:** open the drawer (`#options-toggle`), click `[data-drawer-tab="tile"]`,
  type the URL and pin it through the UI:
  - `browser_evaluate`: `const i = document.querySelector('#options-pinURL-input'); i.value = 'https://github.com/'; i.dispatchEvent(new Event('input', {bubbles:true})); return i.value;`
  - click `#options-pinURL`, then close the drawer (`#options-toggle`).
  - **Confirm the pin landed:** `browser_evaluate`
    `return [...document.querySelectorAll('.newtab-link')].some(a => (a.href||'').includes('github.com'));`
    should be `true`. If it's `false` (the click didn't register), retry the pin once.
- **Collect the URLs to open:** `browser_evaluate` — the tile URL is on the child
  anchor, not the `.newtab-site` div:
  `return [...document.querySelectorAll('.newtab-site .newtab-link')].slice(0, 3).map(a => a.href).filter(Boolean);`
  — this includes the just-pinned tile plus unpinned history tiles.
- **Trigger capture:** call `browser_capture_tiles` with those URLs. It opens each
  (background script captures the visible tab on load — cookies were accepted during
  seeding, so pages are clean) and returns you to the new-tab page.

Then assert (the grid has re-rendered; if a thumbnail/favicon hasn't appeared yet,
wait briefly and re-check once):

9. **Screenshots captured:**
   `[...document.querySelectorAll('.newtab-thumbnail')].filter(t => getComputedStyle(t).backgroundImage.includes('url')).length`
   >= `1` — opening the tiles produced real page thumbnails (was 0 in assertion 8).
10. **Favicons collected:**
    `[...document.querySelectorAll('.ntt-favicon img')].filter(i => i.src).length` >= `1`.

Take a `01-captured` screenshot of the grid now that some tiles carry thumbnails.

## Visual judgment

- Read `01-captured`. Judge: the opened tiles now show real page thumbnails (not
  just letter fallbacks) with a small favicon badge, the grid is a clean 3×3, the
  logo and search bar are visible in the titlebar. Pass = thumbnails visible on the
  opened tiles + clean default layout.

## Output

- `report.json` — assertions 1–10 plus the visual verdict.
- `summary.md` — lead with the verdict, then: the default layout/chrome, the
  new-user no-thumbnail state, and that opening tiles produced thumbnails + favicons.
