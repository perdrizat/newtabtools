# Restore and verify

**Goal:** the comprehensive pilot — after the standard restore, check the grid
structure tile-by-tile, confirm the About section reports the right brand and
version, and judge two screenshots (the grid and the open Advanced drawer). This
exercises the full assertion vocabulary (structural + content + visual) the way a
real scenario will.

Follow the **standard preamble** from the `uat-scenario` skill (open drawer →
Advanced → restore → close drawer). It leaves you two screenshots — `00-initial`
(before) and `01-restored` (the clean restored page, drawer closed). The drawer
is **closed** after the preamble; this scenario re-opens it for the About shot.

## Verify — grid structure (structural, `browser_evaluate`)

1. **Tiles:** `document.querySelectorAll('.newtab-site').length` === `9`.
2. **Grid dimensions:** `document.querySelectorAll('.newtab-cell').length` === `16`
   (the fixture's 4×4 grid).
3. **Spacing pref applied:** `document.documentElement.getAttribute('spacing')`
   === `'medium'`.
4. **Wallpaper applied (mandatory):** `document.body.style.backgroundImage` must
   contain `firefox-settings-attachments.cdn.mozilla.net` — the fixture's
   Mozilla-CDN wallpaper, restored and applied **live** (no reload). An empty
   string or `none` is a **failure**, not an observation.

## Verify — tile content by position (structural, `browser_evaluate`)

Cells render in fixture-position order (position 0 first). Read
`document.querySelectorAll('.newtab-cell')[N].querySelector('.newtab-title')?.textContent`
and assert it **contains** the expected fragment:

- position **0** contains `finews.ch`
- position **4** contains `DayDeal`
- position **8** contains `LinkedIn`

These prove it's the fixture's own tiles in the expected layout, not a default set.

## Verify — About section (structural, `browser_evaluate`)

The About block lives at `#options-about` in the Advanced panel. Its elements are
in the DOM whether or not the drawer is open, so read these now (drawer still
closed from the preamble):

1. **Version is live, not hard-coded:**
   `document.querySelector('[data-version-slot]').textContent` ===
   `chrome.runtime.getManifest().version` (compare the two in one expression; do
   not hard-code a version number).
2. **Brand:** `document.querySelector('#options-about [data-message="extensionName"]').textContent`
   === `'NewTab PowerTools'`.
3. **GitHub link:** `document.querySelector('#options-about a[data-message="github"]').getAttribute('href')`
   === `'https://github.com/perdrizat/newtabtools'`.

## Verify — About is visible (open the drawer)

Now open the drawer: click `#options-toggle`, then `[data-drawer-tab="advanced"]`.
Leave it open for the rest of the scenario (don't click `#options-toggle` again —
that closes it).

4. **About fully visible without scrolling:** *before scrolling*, assert the About
   block is fully within the viewport — `const r = document.querySelector('#options-about').getBoundingClientRect();`
   then `r.top >= 0 && r.bottom <= window.innerHeight` is `true`. At the standard
   Full HD viewport the whole Advanced panel fits; if About falls below the fold
   that's a layout regression.

## Evidence + visual judgment

- **Restored grid** — judge the preamble's `01-restored` screenshot (drawer
  closed): the 9 tiles sit in a clean 4×4 grid (rows of 4 / 4 / 1), no overlap,
  no clipping, titles legible, **and** the Mozilla-CDN wallpaper is visibly
  rendered behind them (not a plain/blank background). Pass = clean layout **and**
  visible wallpaper.
- **About panel** — with the drawer already open on Advanced (from the step
  above), take a screenshot `02-about`, read it inline, and judge: the About text
  (brand + version + links) is readable against the drawer background — flag any
  contrast or truncation problems. "NewTab PowerTools v<version>" and the three
  links should be visible.

## Output

- Report (JSON) at the prologue's report path — every structural assertion above
  plus the two visual verdicts.
- Summary (markdown) at the prologue's summary path — lead with the verdict, then
  what the restored page (grid + wallpaper) and the About panel looked like.
