# Default UI and first-run capture

A freshly installed extension on the seeded environment: confirm the default
layout and chrome, then exercise the auto-thumbnail + favicon capture by opening
a few tiles. The board ships with a few pinned favourites that already carry
startup-captured imagery; the capture check below targets the **history-derived
(non-pinned)** tiles that start bare and proves capture as a delta (count rises
above the recorded baseline).

Skip the restore preamble. `browser_navigate` to the new-tab page and take a
`00-initial` screenshot, then work through the parts below.

Capture is triggered with `browser_capture_tiles` (it opens the tile URLs and
returns you to the new-tab page) — you stay on the extension origin throughout
(`moz-extension://` on Firefox, `chrome-extension://` on Chrome).

## Part A — default layout and chrome (structural, `browser_evaluate`)

1. **Default grid:** `document.querySelectorAll('.newtab-cell').length` === `9`
   (the default 3×3).
2. **Single Edit button (Board A — no masthead/wordmark/padlock):**
   `const e = document.querySelector('#options-toggle'); return !!e && e.textContent.trim() === 'Edit' && !document.querySelector('#ntt-masthead') && !document.querySelector('#ntt-wordmark') && !document.querySelector('#locked-toggle');`
   === `true`.
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

8. **Baseline — most history tiles are bare:** record the baseline thumbnail count
   on non-pinned tiles **as `B`**, and confirm there are bare tiles left to capture:
   - `B` = `[...document.querySelectorAll('.newtab-site:not([pinned]) .newtab-thumbnail')].filter(t => getComputedStyle(t).backgroundImage.includes('url')).length`
   - assert **bare count ≥ 2**:
     `[...document.querySelectorAll('.newtab-site:not([pinned]) .newtab-thumbnail')].filter(t => !getComputedStyle(t).backgroundImage.includes('url')).length` >= `2`.

   Do **not** assert `B === 0`. A default pin URL that is *also* a heavily-seeded
   history URL (e.g. `developer.mozilla.org`) can surface as a non-pinned history
   tile and inherit the startup-captured thumbnail by URL, so `B` may be small but
   non-zero. The capture check below proves the behaviour as a **delta** (`> B`) on
   the tiles that start bare — which is the real signal.

Now exercise capture. First confirm UI pinning still works, then capture the bare
history tiles:

- **Pin a tile:** open the drawer (`#options-toggle`), click `[data-drawer-tab="tile"]`,
  type the URL and pin it through the UI:
  - `browser_evaluate`: `const i = document.querySelector('#options-pinURL-input'); i.value = 'https://github.com/'; i.dispatchEvent(new Event('input', {bubbles:true})); return i.value;`
  - **pin via the button's own click handler:** `browser_evaluate`
    `document.querySelector('#options-pinURL').click(); return true;` then close the
    drawer (`#options-toggle`). (Use the JS `.click()` here, not a real pointer click —
    dispatching `input` opens the autocomplete dropdown, which overlays the `Add`
    button and can swallow a physical click.)
  - **Confirm the pin landed (match the root tile, not the repo pin):** `browser_evaluate`
    `return [...document.querySelectorAll('.newtab-link')].some(a => { try { const u = new URL(a.href); return u.hostname === 'github.com' && u.pathname === '/'; } catch { return false; } });`
    should be `true`. If it's `false`, retry the pin once. (A substring
    `includes('github.com')` would false-positive against the default repo pin
    `github.com/perdrizat/newtabtools` — match the exact root path instead.)
- **Collect the bare tiles to open:** `browser_evaluate` — target non-pinned tiles
  that currently have **no** thumbnail, so capture demonstrably produces *new* imagery:
  `return [...document.querySelectorAll('.newtab-site:not([pinned])')].filter(s => { const t = s.querySelector('.newtab-thumbnail'); return t && !getComputedStyle(t).backgroundImage.includes('url'); }).map(s => s.querySelector('.newtab-link') && s.querySelector('.newtab-link').href).filter(Boolean).slice(0, 3);`
- **Trigger capture:** call `browser_capture_tiles` with those URLs. It opens each
  (background script captures the visible tab on load — cookies were accepted during
  seeding, so pages are clean) and returns you to the new-tab page.

Then assert (the grid has re-rendered; if a thumbnail/favicon hasn't appeared yet,
wait briefly and re-check once):

9. **Screenshots captured on history tiles (delta):** the non-pinned thumbnail count
   `[...document.querySelectorAll('.newtab-site:not([pinned]) .newtab-thumbnail')].filter(t => getComputedStyle(t).backgroundImage.includes('url')).length`
   is now **> `B`** (the baseline from assertion 8) — opening the bare history tiles
   produced real page thumbnails.
10. **Favicons collected on history tiles:**
    `[...document.querySelectorAll('.newtab-site:not([pinned]) .ntt-favicon img')].filter(i => i.src).length` >= `1`.

Take a `01-captured` screenshot of the grid now that some tiles carry thumbnails.

## Visual judgment

- Read `01-captured`. Judge: the opened history tiles now show real page thumbnails
  (not just letter fallbacks) with a small favicon badge — alongside the pinned
  favourites that carried thumbnails from the start — the grid is a clean 3×3, and
  the search bar + single `Edit` button are visible in the titlebar (no wordmark
  or padlock). Pass = thumbnails visible on the opened tiles + clean default layout.

## Output

- `report.json` — assertions 1–10 plus the visual verdict.
- `summary.md` — lead with the verdict, then: the default layout/chrome, the
  history tiles' new-user no-thumbnail state (pins excepted), and that opening the
  history tiles produced thumbnails + favicons.
