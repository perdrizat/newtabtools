# Code Review — Modernization Stage H (XHTML → HTML5 conversion)

**Date:** 2026-07-09
**Branch:** `modernization-h`
**Scope:** `git diff e0e55f5..HEAD` (Stage M completion → Stage H close-out):
H1 case-trap fixes, H2 markup conversion + rename touchpoints, H3
`createElementNS` collapse, H4 tooling/docs sweep. Companion to
[`2026-07-09-modernization-m-code-review.md`](2026-07-09-modernization-m-code-review.md).
**Effort:** medium (8 finder angles × ≤6 candidates → 1-vote verify; the
parsing-semantics angle ground-truthed its claims by jsdom-parsing the shipped
file rather than reasoning from the diff).

---

## Verdict

**No live correctness bug found.** The conversion is complete and correct on
every load-bearing axis, each verified independently:

- **No non-void self-closing tags remain** — the 9 template `<span/>`s and the
  `<button/>` (the whole H2 risk) are all expanded; remaining `/>` forms are
  void elements or inside `<svg>` (valid HTML5).
- **Template semantics correct.** All three `<template>`s (`#newtab-site`, the
  pinURL autocomplete, the filter table) are consumed via `.content` — correct
  for HTML's inert-fragment model. A real jsdom parse confirms the filter
  `<table>` gets no foster-parenting or phantom `<tbody>`: `tBodies[0]` and the
  template `<tr>` (3 cells, no implied wrapper) land exactly where the code
  expects.
- **Case-trap sweep exhaustive.** Only three `nodeName`/`tagName` comparison
  sites exist in page JS: `newTab.js:2415` (fixed with `.toLowerCase()`, plus a
  new regression test), `awesomebar.js:167` (already lowercase-safe), and
  `drawerOnChange` (rewritten to dispatch on `target.type`). No unfixed
  lowercase-literal comparison remains; all CSS element selectors are
  case-insensitive-safe.
- **Namespace collapse clean.** All ~26 collapsed `createElementNS` calls were
  HTML elements; `icons.js`'s SVG creation is byte-identical (still namespaced);
  zero references to the deleted `HTML_NAMESPACE`/`HTML_NS` consts survive.
- **Rename complete.** Every functional touchpoint (manifest, `NEW_TAB_URL`,
  e2e helper, 5 UAT tools, amo-screenshots, i18n scripts, ~16 test path
  constants) points at `newTab.html`; the only remaining `.xhtml` strings are
  historical docs/comments. No boolean-attribute traps (`hidden="false"` etc.)
  in the markup; script order (common.js first, newTab.js before fx-newTab.js)
  preserved.
- **No security boundary moved.** Manifest CSP/permissions byte-identical
  except `version` and the `chrome_url_overrides` filename. No CLAUDE.md
  convention violations; the one new source-`readFileSync` test carries the
  required `ntt/no-source-grep` justification.

The findings below are latent fragility, test-coverage narrowing, and cleanup —
ranked by what a maintainer should act on first.

---

## Findings

### 1. Pin-URL autocomplete click walk is unbounded — `closest('li')` fixes the class, not just the case  — *latent, fix-adjacent*
**File:** `webextension/newTab.js:2415`
**Category:** correctness (latent) · severity: low-medium
**Converged on by 3 of 8 angles independently.**

```js
while (target.nodeName.toLowerCase() != 'li') {
    target = target.parentNode;
}
```

The H1 `.toLowerCase()` fix is correct and necessary (under the HTML parser
`nodeName` is `'LI'`; unfixed, every autocomplete click would have walked past
the `<li>` to `document` and thrown). But the loop still has no termination
guard: the preceding `compareDocumentPosition(...CONTAINED_BY)` check only
proves the click target is inside the `<ul>`, not that an `<li>` ancestor
exists. If the dropdown ever gains a non-`<li>` direct child (a header row, a
wrapper div), a click on it walks to `document`, then `null.nodeName` throws —
and the new regression test (`pin-url-autocomplete-click.test.ts`) only feeds
targets that DO resolve to an `<li>`, so it green-lights the fragile version.

**Fix (deeper, smaller):** `let target = event.target.closest('li');` —
natively case-insensitive, returns `null` (guardable) instead of throwing,
deletes the loop. Verdict: **CONFIRMED** (latent — trigger requires a future
markup change).

### 2. The XML parse-error safety net is gone; only the tile template has a structural replacement  — *coverage narrowing*
**File:** `tests/e2e/loads-cleanly.test.ts:42-64`
**Category:** test-coverage · severity: medium (process), zero (runtime)

Under XHTML, one malformed tag anywhere in the page yellow-screened the whole
document, so the old XML-parse-error assertion guarded every line of markup.
HTML5 never parse-errors — it silently mis-nests. The replacement test is good
(doctype, standards mode, zero console errors, grid cells render) but cannot
detect silent mis-nesting, and the structural guard added in
`tile-redesign.test.ts` covers only the `#newtab-site` template. The drawer
body, wallpaper picker, and the two anonymous `<template>`s have no
well-formedness net: a future self-closed `<span/>` there would swallow its
siblings and ship green through the fast tier (jsdom parses HTML the same
"wrong" way Firefox does — agreement, not detection).

**Mitigation options:** (a) a lint-grade check that rejects `<tag …/>` for
non-void, non-SVG elements in `newTab.html` (cheap, catches the whole class at
commit time); (b) extend the structural-parity idiom to the other templates.
Full UAT remains the backstop, but it's manual-tier. Verdict: **CONFIRMED**.

### 3. `drawer-layout` range-input regression test asserts a code path production no longer has  — *inert test*
**File:** `tests/integration/drawer-layout.test.ts:283`
**Category:** test-coverage · severity: low

The test forces `tagName` to lowercase to "simulate old XHTML semantics", but
`drawerOnChange` (`newTab.js:1636`) was rewritten to dispatch on
`target.type === 'range'` and never reads `tagName`. The guard it claims to
provide is inert — a reintroduced `tagName`-based branch would not be caught.
Delete the case-simulation or rewrite it against what the handler actually
reads. Verdict: **CONFIRMED**.

### 4. Orphan debug SVG carried verbatim into the new markup  — *cleanup (pre-existing)*
**File:** `webextension/newTab.html:442`
**Category:** simplification · severity: low

```html
<svg xmlns="http://www.w3.org/2000/svg">
    <path fill="none" stroke="#f0f" stroke-width="4" />
</svg>
```

The `<path>` has no `d` — it draws nothing; the magenta `#f0f` is a
debug/proof color. Verified unreferenced: no JS queries a bare `svg`/`path`
(icons.js builds its own namespaced SVGs), and the global
`svg { position: fixed; display: none }` rule (`newTab.css:1205`) hides it —
that rule's per-component overrides (`.ntt-drag-handle svg`, `.ntt-action-btn
svg`, …) are what re-show the real icons. Carried from the XHTML era
(pre-existing, not a Stage-H introduction), but H2's "keep markup verbatim"
discipline was the moment to drop it. Removing the node is safe; the global
CSS rule can stay (it still guards icon SVGs before their component rules
apply). Verdict: **CONFIRMED** (cleanup).

### 5. `newTab.html` path duplicated across ~16 test files — the rename itself demonstrated the cost  — *cleanup*
**File:** `tests/integration/tile-redesign.test.ts:13` (and ~15 siblings)
**Category:** simplification · severity: low

Each migrated test re-derives
`path.resolve(__dirname, '../../webextension/newTab.html')` +
`fs.readFileSync(...)` by hand; naming drifts (`html`/`markup`/`source`/
`realHtml`). This very diff is the evidence of the cost: the H2 rename touched
every copy. `tests/integration/_helpers.ts` already exists as the harness
home — one exported `readNewTabHtml()` (and optionally a
`parseNewTabDocument()` for the DOMParser users) collapses the duplication so
the next rename touches one line. Verdict: **CONFIRMED** (cleanup).

### 6. Tile-template structural guard hardcodes the full child manifest  — *cleanup / test-maintenance*
**File:** `tests/integration/tile-redesign.test.ts:1196`
**Category:** test-design · severity: low

The (valuable) mis-nesting guard pins an 8-element `expectedSiblingClasses`
array, child-index assertions (`site.children[7]`), and a verbatim `oldMarkup`
copy of the pre-H2 self-closed template. Any legitimate template edit
(add/remove/reorder a span) breaks the test and forces a hand-sync; the
embedded `oldMarkup` string will drift from reality. The invariant that
actually catches the bug class is flat-sibling structure (no span swallowed
another) — assert that (e.g. every `.newtab-site > *` child count vs a
recursive descendant count), not the exact class manifest. Verdict:
**CONFIRMED** (cleanup).

### 7. Page filename is a magic string; two avoidable clusters remain  — *cleanup*
**File:** `webextension/lib/background-main.js:69`, `tests/e2e/_helpers.ts`, 5 UAT tools
**Category:** simplification · severity: low

Post-rename, `'newTab.html'` appears at ~26 sites. Most are irreducible
(manifest JSON, test fixture paths), but two clusters are not: (a) the runtime
has it in exactly two places — the manifest and
`chrome.runtime.getURL('newTab.html')` in `background-main.js`; a
`NEW_TAB_PAGE` export from `lib/constants.js` (whose docstring names exactly
this dedup pattern) halves that. (b) six harness files each rebuild
`` `moz-extension://${uuid}/newTab.html` `` — one shared `newTabURL(uuid)`
helper ends that drift risk. Verdict: **CONFIRMED** (cleanup).

### 8. Post-collapse DOM-construction idiom is inconsistent  — *cleanup, future-backlog*
**File:** `webextension/newTab.js:1350` (and ~37 sibling blocks)
**Category:** simplification · severity: low

The collapse left ~37 near-identical `createElement` + `className` (+ text)
blocks across three files, with two competing text idioms:
`el.appendChild(document.createTextNode(x))` (newTab.js, fx-newTab.js) vs
`el.textContent = x` (awesomebar.js) — equivalent on fresh elements, so the
verbose form is pure noise. A tiny page-scope `el(tag, className, text?)`
builder (mirroring `icons.js`'s SVG `el()`) is the natural refactor — **but**
as a separate change: folding it into Stage H would have widened a
deliberately mechanical diff's blast radius. Recorded here as backlog, with the
`textContent` normalization as the low-risk first step. Verdict: **CONFIRMED**
(cleanup, deferred by design).

---

## Also noted (not elevated)

- **jsdom cannot catch a Firefox-only parse divergence.** The fast tier's
  parser agrees with Gecko on every construct checked, which is why it passes —
  and why it can never *detect* a divergence. `pnpm test:e2e` (and UAT for
  markup edits) is the only real guard; this is already project policy
  (CONTRIBUTING "Always run E2E"), reaffirmed here because Stage H makes the
  page's parser the thing under test.
- **The efficiency angle found nothing** — `createElement` is if anything
  cheaper than `createElementNS`; no hot-path batching changed.
- **H3's judgement to keep `icons.js` namespaced while deleting
  `HTML_NAMESPACE` sharpens the HTML-vs-SVG distinction** — the one remaining
  `createElementNS` in the page is now exactly the one that must exist.

## Security boundary check

No boundary moved. CSP directives, `permissions`, `host_permissions`,
`optional_permissions` byte-identical to the Stage M baseline; only `version`
(→3.0.0) and the `chrome_url_overrides` filename changed. No validation was
removed; the `nodeName` change is a case fix, not a check removal.
