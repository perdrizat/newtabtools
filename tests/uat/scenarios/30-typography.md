# Typography role discipline

Verify the basic typographic requirements from the design review (§6): monospace
is reserved for genuinely tabular-numeric or keyboard-key content, while all
textual content (URLs, domains, captions, helper/explanatory copy) is the UI
sans. Italics are gone entirely — they were the least-legible combination in the
UI. Hierarchy comes from weight/size/colour within one family.

Use the standard preamble (navigate to the new-tab page, `00-initial`
screenshot). `browser_evaluate` runs via Selenium `executeScript`, so every
probe must `return` its value. `getComputedStyle(...).fontFamily` returns the
declared stack — the UI sans resolves to a `message-box, …, sans-serif` stack
and the mono role to a `…monospace` stack, so a substring test for `mono` cleanly
separates the two roles.

## Verify (structural — `browser_evaluate`)

1. **Recently-closed domain is sans, not mono.** The seeded recent row has cards:
   ```js
   return (() => {
     const el = document.querySelector('.ntt-recent-url');
     if (!el) { return 'no-recent-url'; }
     return getComputedStyle(el).fontFamily.toLowerCase();
   })()
   ```
   Pass = a string that does **not** contain `mono` (and is not `no-recent-url`).

2. **Helper / explanatory copy is sans and upright.** Check `.ntt-form-group-help`
   (present in the DOM even with the drawer closed):
   ```js
   return (() => {
     const el = document.querySelector('.ntt-form-group-help');
     const s = getComputedStyle(el);
     return { family: s.fontFamily.toLowerCase(), style: s.fontStyle };
   })()
   ```
   Pass = `family` does not contain `mono` **and** `style === 'normal'` (no italic).

3. **Stat numbers keep monospace** (tabular numerics). The stat-chip span exists
   per tile even when empty:
   ```js
   return (() => {
     const el = document.querySelector('.ntt-stat-chip');
     if (!el) { return 'no-stat-chip'; }
     return getComputedStyle(el).fontFamily.toLowerCase();
   })()
   ```
   Pass = a string that **contains** `mono`.

4. **Keyboard hint keeps monospace** (key convention). Check `.ntt-search-kbd`
   (the `/` hint in the search box):
   ```js
   return (() => {
     const el = document.querySelector('.ntt-search-kbd');
     if (!el) { return 'no-kbd'; }
     return getComputedStyle(el).fontFamily.toLowerCase();
   })()
   ```
   Pass = a string that **contains** `mono`.

5. **No inline italics in the drawer copy.** Open the drawer (`#options-toggle`),
   switch to Advanced (`[data-drawer-tab="advanced"]`), then:
   ```js
   return [...document.querySelectorAll('#ntt-drawer-body *')]
     .filter(el => getComputedStyle(el).fontStyle === 'italic').length
   ```
   Pass = `0`.

## Visual judgment

- With the Advanced tab open, `browser_take_screenshot` named `advanced-type`,
  then `browser_read_screenshot` it. Judge: the helper/explanatory lines (backup
  description, restore/reset warnings, filter helptext) read as **upright UI
  sans** — no italic slant, no monospaced "code" look. The section labels and the
  body copy differ by weight/colour, not by typeface.
- Also read `00-initial`: judge the recently-closed chips — the domain line reads
  as calm sans, consistent with the title above it, not a techy monospace string.
- Pass = textual content is sans + upright; only stat numbers / key hints remain
  monospaced.

## Output

- `report.json` — the five structural assertions plus the two visual verdicts.
- `summary.md` — lead with the verdict, then describe how the drawer copy and the
  recent-chip domains read (family, slant), and confirm stat/key elements kept
  their monospace.
