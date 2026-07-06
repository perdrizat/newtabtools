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

## Verify — never-capture group (structural)

The never-capture section in the Advanced tab lets the user manage a list of host
patterns for which the extension will never take automatic screenshots. The group
is `#options-nevercapture` and mirrors the filter panel's visual language.

6b. **Never-capture group heading and controls are visible.**
   ```js
   const group = document.getElementById('options-nevercapture');
   const input = document.getElementById('options-nevercapture-host');
   const addBtn = document.getElementById('options-nevercapture-add');
   return {
     groupVisible: !!group && group.offsetParent !== null,
     inputVisible: !!input && input.offsetParent !== null,
     addBtnVisible: !!addBtn && addBtn.offsetParent !== null,
   }
   ```
   Pass = all three `true`.

6c. **Adding a host via the UI produces a list row with a remove control.**
   ```js
   const input = document.getElementById('options-nevercapture-host');
   const addBtn = document.getElementById('options-nevercapture-add');
   input.value = 'uat-test.example.com';
   input.dispatchEvent(new Event('input', {bubbles: true}));
   addBtn.click();
   return new Promise(resolve => {
     setTimeout(() => {
       const rows = document.querySelectorAll('#options-nevercapture-list .ntt-nevercapture-row');
       const found = Array.from(rows).find(r => {
         const span = r.querySelector('span');
         return span && span.textContent.trim() === 'uat-test.example.com';
       });
       resolve(!!(found && found.querySelector('.ntt-nevercapture-remove')));
     }, 600);
   });
   ```
   Pass = `true` (row appears with a remove control).

6d. **The add-host row is left-aligned to the drawer rhythm (not centered).**
   The input + Add button must sit flush with the group's left edge, like every
   other Advanced control — not floating in the centre.
   ```js
   const row = document.querySelector('#options-nevercapture .options-row');
   const group = document.getElementById('options-nevercapture');
   return {
     justify: getComputedStyle(row).justifyContent,
     // input's left edge within ~2px of the group's content-left edge
     flushLeft: Math.abs(row.getBoundingClientRect().left - group.getBoundingClientRect().left) < 24,
   }
   ```
   Pass = `justify` is `"flex-start"` (or `"start"`) **and** `flushLeft` is `true`.

6e. **The helptext is concise — at most 2 rendered lines.**
   Long explanatory copy that wraps to 3+ lines reads as clutter in the narrow
   drawer. Measure the rendered height against the line height.
   ```js
   const help = document.querySelector('#options-nevercapture .ntt-form-group-help');
   const cs = getComputedStyle(help);
   let lh = parseFloat(cs.lineHeight);
   if (Number.isNaN(lh)) { lh = parseFloat(cs.fontSize) * 1.2; }
   const lines = Math.round(help.getBoundingClientRect().height / lh);
   return { lines, height: Math.round(help.getBoundingClientRect().height), lineHeight: lh };
   ```
   Pass = `lines` ≤ 2. (Report the value even on pass, and flag as an observation
   if it is exactly 2 and visually tight.)

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
  that sits on-system with the steppers. The never-capture group reads like its
  neighbor (the filter group): heading in the same form-group style, a text input
  and primary Add button in a row, and list rows with a tidy ✕ remove control.
  No raw/native form controls survive.
- **Text integrity (i18n):** every label, heading, button, and the filter
  helptext/placeholders are human-readable English. Flag any raw `snake_case`
  message key, blank control, `$1`/`$NAME$`/`__MSG_…__` substitution leftover, or
  text clipped/overflowing its control. Verify the never-capture heading, helptext,
  input placeholder, and Add button are all human-readable (not raw i18n keys).
- Pass = Advanced looks like the same designer as Page; the filter panel is
  left-aligned and on-system (not the old centered layout); the never-capture group
  matches the filter group's visual rhythm; no native controls; clear button hierarchy.

## Output

- `report.json` — assertions 1–9 (including 6b–6e) plus the visual verdict.
- `summary.md` — lead with the verdict; describe the history toggle, the button
  hierarchy, the steppers/table, the filter panel (toggle affordance, ✕ remove,
  left-aligned design language), the never-capture group (heading/input/Add/list
  row with ✕ remove, **left-aligned add-row and ≤2-line helptext**, visually
  consistent with the filter group), and that Reset/Restore gate behind an inline
  confirm (verified non-destructively).
