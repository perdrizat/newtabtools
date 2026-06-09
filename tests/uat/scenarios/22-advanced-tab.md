# Advanced tab on-system + confirm steps

Verify the Advanced tab is on-system (DESIGNv2_REVIEW §5) and that irreversible
actions gate behind an inline confirm (§7): no native checkboxes (history is a
copper toggle), a three-tier button hierarchy (ghost / copper primary / danger),
segmented-style steppers, a row-rhythm domain table, and a Reset/Restore that
reveal a Confirm/Cancel row rather than acting on the first click.

Use the standard preamble (navigate, `00-initial`). Open the drawer
(`browser_click` `#options-toggle`) and switch to Advanced
(`browser_click` `[data-drawer-tab="advanced"]`). `browser_evaluate` must
`return`.

## Verify — on-system controls (structural)

1. **No native checkboxes in the drawer.**
   ```js
   return document.querySelectorAll('#ntt-drawer-body input[type="checkbox"]').length
   ```
   Pass = `0`.

2. **History is a copper toggle.**
   ```js
   return !!document.querySelector('.ntt-toggle[data-pref="history"]')
   ```
   Pass = `true`.

3. **Destructive buttons use the danger role; ghost buttons do not.**
   ```js
   return {
     restore: getComputedStyle(document.getElementById('options-restore')).borderTopColor,
     reset: getComputedStyle(document.getElementById('options-reset-all')).borderTopColor,
     backup: getComputedStyle(document.getElementById('options-backup')).borderTopColor,
   }
   ```
   Pass = `restore` and `reset` share a colour (the danger hairline) that differs
   from `backup` (the neutral ghost hairline).

4. **A copper primary exists (open the filter panel first).** The filter panel is
   a toggle that starts hidden, so reveal it: `browser_click` `#historytiles-filter`,
   then:
   ```js
   return getComputedStyle(document.getElementById('options-filter-set')).backgroundColor
   ```
   Pass = a non-transparent fill (the accent), not `rgba(0, 0, 0, 0)`.

## Verify — confirm steps (structural, non-destructive)

5. **Reset reveals a Confirm/Cancel row and does NOT reset on the first click.**
   `browser_click` `#options-reset-all`, then:
   ```js
   return {
     confirmShown: !document.getElementById('options-reset-confirm-row').hidden,
     gridIntact: document.querySelectorAll('.newtab-cell').length,
   }
   ```
   Pass = `confirmShown` true and `gridIntact` unchanged (≥ 9 — nothing was
   wiped). **Do not click Confirm** — we must not wipe the environment.
6. **Cancel dismisses the confirm.** `browser_click` `#options-reset-cancel`, then:
   ```js
   return document.getElementById('options-reset-confirm-row').hidden
   ```
   Pass = `true` (row hidden again, still nothing reset).

## Verify — history-tiles filter (structural)

The "Filter…" button toggles a panel that caps how many unpinned (history) tiles a
domain may show. The panel was opened in assertion 4.

7. **Filter… is a toggle.**
   ```js
   return { hidden: document.getElementById('options-filter').hidden,
            expanded: document.getElementById('historytiles-filter').getAttribute('aria-expanded') }
   ```
   Pass = `hidden` false, `expanded` `"true"`. Then `browser_click`
   `#historytiles-filter` again and re-evaluate — `hidden` true, `expanded`
   `"false"`. Finally `browser_click` `#historytiles-filter` once more to re-open it
   for the remaining checks + screenshot.
8. **Adding a filter shows an explicit ✕ remove on its row.** With the panel open:
   ```js
   const h = document.getElementById('options-filter-host');
   const c = document.getElementById('options-filter-count');
   h.value = 'www.example.com'; c.value = '2';
   h.dispatchEvent(new Event('input', {bubbles:true}));
   c.dispatchEvent(new Event('input', {bubbles:true}));
   document.getElementById('options-filter-set').click();
   const row = [...document.querySelectorAll('#options-filter tbody tr')].find(r => r.cells[0].textContent === 'www.example.com');
   return !!(row && row.querySelector('.ntt-filter-remove'));
   ```
   Pass = `true` (the new filter row carries a ✕ remove control).
9. **The helptext is left-aligned (design language, not centered).**
   ```js
   return getComputedStyle(document.querySelector('#options-filter [data-message="filter_helptext"]')).textAlign
   ```
   Pass = `left` or `start` (not `center`).

## Visual judgment

- With the Advanced tab open **and the filter panel revealed**,
  `browser_take_screenshot` named `advanced`, then `browser_read_screenshot` it.
  Judge: the tab reads like the Page tab — a copper toggle (not a native checkbox)
  for history, buttons with a clear hierarchy (one copper primary, ghost
  secondaries, danger-tinted Reset/Restore), the unpinned-count stepper styled like
  the segmented controls, and the domain table on the drawer's row rhythm. The
  filter panel specifically: its header, helptext, and add-filter row read
  **left-aligned** to the same rhythm (not centered/floating), the "Filter…" toggle
  shows an open/closed affordance (caret), and filter rows carry a tidy ✕ remove
  that sits on-system with the steppers. No raw/native form controls survive.
- **Text integrity (i18n):** every label, heading, button, and the filter
  helptext/placeholders are human-readable English. Flag any raw `snake_case`
  message key, blank control, `$1`/`$NAME$`/`__MSG_…__` substitution leftover, or
  text clipped/overflowing its control.
- Pass = Advanced looks like the same designer as Page; the filter panel is
  left-aligned and on-system (not the old centered layout); no native controls;
  clear button hierarchy.

## Output

- `report.json` — assertions 1–9 plus the visual verdict.
- `summary.md` — lead with the verdict; describe the history toggle, the button
  hierarchy, the steppers/table, the filter panel (toggle affordance, ✕ remove,
  left-aligned design language), and that Reset/Restore gate behind an inline
  confirm (verified non-destructively).
