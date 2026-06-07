# Title bar (Board A)

Verify the main titlebar elements (DESIGNv2_REVIEW §1, §4). Board A is a minimal
bar reading left→right: `[recently-closed chips — flex to fill] [search] [Edit]`.
There is no wordmark, no padlock, no cogwheel, no clock — a single `Edit` button
is the one action. Recently-closed chips carry page-level identity: a real site
favicon (letter-block fallback), the page title, and the registrable domain
(no `www.`).

Use the standard preamble (navigate to the new-tab page, `00-initial`
screenshot). `browser_evaluate` runs via `executeScript` — always `return`.

**Precondition — ensure the search box is shown.** The titlebar search is a user
pref (`titleBarSearch`, on by default) and an earlier scenario in a full run may
have toggled it off; the Board A layout being verified here includes it. Enable
it and wait for it to lay out before the order check:
`browser_evaluate` → `(window).Prefs.titleBarSearch = true; return true;` then poll
(`browser_evaluate`) until `return !document.getElementById('ntt-search').hidden`
is `true` (~5s budget).

## Verify (structural — `browser_evaluate`)

1. **Single Edit button, no legacy chrome.**
   ```js
   return {
     edit: (() => { const e = document.getElementById('options-toggle'); return e ? e.textContent.trim() : null; })(),
     wordmark: !!document.getElementById('ntt-wordmark'),
     masthead: !!document.getElementById('ntt-masthead'),
     buttons: !!document.getElementById('ntt-titlebar-buttons'),
     padlock: !!document.getElementById('locked-toggle'),
     clock: !!document.getElementById('ntt-clock'),
   }
   ```
   Pass = `edit === "Edit"` and every other field is `false`.

2. **Titlebar order is recent → search → Edit.**
   ```js
   return (() => {
     const ids = ['ntt-titlebar-recent', 'ntt-search', 'options-toggle'];
     const xs = ids.map(id => document.getElementById(id).getBoundingClientRect().left);
     return xs[0] <= xs[1] && xs[1] <= xs[2];
   })()
   ```
   Pass = `true` (recent leftmost, Edit rightmost).

3. **Recent chips carry favicon + name + registrable domain.** The seeded
   recently-closed row has cards:
   ```js
   return [...document.querySelectorAll('.ntt-recent-card')].slice(0, 8).map(c => ({
     hasFav: !!c.querySelector('.ntt-recent-favicon'),
     name: (c.querySelector('.ntt-recent-name')||{}).textContent || '',
     domain: (c.querySelector('.ntt-recent-url')||{}).textContent || '',
   }))
   ```
   Pass = at least one card; every card `hasFav` true, has a non-empty `name`,
   and a `domain` that does **not** start with `www.` and contains no `/`
   (registrable domain, not a path/title suffix).

4. **Equal padding on the sides + top (§1).**
   ```js
   return (() => {
     const s = getComputedStyle(document.getElementById('ntt-titlebar'));
     return { top: s.paddingTop, left: s.paddingLeft, right: s.paddingRight };
   })()
   ```
   Pass = `top === left === right` and non-zero (the existing S/M/L spacing
   system drives them; values are not hard-coded to a single number).

5. **Edit opens the drawer.** `browser_click` `#options-toggle`, then:
   ```js
   return document.documentElement.hasAttribute('drawer-open')
   ```
   Pass = `true`. (Close it again with `browser_click` `#options-toggle` or
   leave it — note the state for the next step.)

## Visual judgment

- Read `00-initial`. Judge the bar reads as Board A: recently-closed chips on the
  left (each leading with a real favicon, a readable title, and a muted domain
  line), the search box, and a single `Edit` button at the right. Confirm there
  is **no** wordmark, padlock, cogwheel, or clock, and the chips fill the row
  rather than leaving a large dead gap.
- Pass = minimal Board A bar + page-level chip identity (favicon + domain) +
  single Edit action.

## Output

- `report.json` — the five structural assertions plus the visual verdict.
- `summary.md` — lead with the verdict; describe the bar's contents left→right,
  how the recent chips read (favicon, title, domain — flag any `www.` or path
  leakage), and confirm the legacy wordmark/padlock/cogwheel are gone.
