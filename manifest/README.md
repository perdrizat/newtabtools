# Two-target manifest authoring (chrome-prep C6)

This directory is the **source** for `webextension/manifest.json`. Never
hand-edit `webextension/manifest.json` directly — edit the base file or the
relevant overlay here, then regenerate (`node scripts/sync-version.mjs`, or
just run `pnpm build`, which does it as a prebuild step).

## Files

- **`base.json`** — fields that are byte-for-byte identical across every
  target: `name`, `description`, `icons`, `chrome_url_overrides`,
  `host_permissions`, `optional_permissions`, `default_locale`,
  `manifest_version`, `content_security_policy`.
- **`firefox.json`** — the Firefox-only overlay. This is the LIVE, shipping
  target: `browser_specific_settings` (AMO id/min-version/data-collection
  attestation), `background` in the event-page form
  (`scripts: ["lib/background-main.js"]` + `type: "module"`), `action` WITH
  `theme_icons` (Firefox's `browser.theme`-driven icon switching — Decision 2
  in [`CHROME_PREP.md`](../CHROME_PREP.md)), and `permissions` including
  `menus` (Firefox's dynamic per-tile context menu — Decision 1).
- **`chrome.json`** — a **dormant** Chrome MV3 overlay. Nothing in this
  project's test matrix (fast tests, E2E, UAT) exercises it — it exists so a
  future Chrome port (see CHROME_PREP.md "What the Chrome port then reduces
  to") only has to fork a handful of seam files, not invent a manifest from
  scratch. It diverges from `firefox.json` in exactly the ways
  chrome-prep's C0/C5 decisions already called out: `background` uses the
  MV3 module `service_worker` form instead of the event-page `scripts` form;
  `action` has no `theme_icons` (Chrome gets `default_icon` only — no
  automatic theme-driven icon switching, matching C5b's `syncActionIconWithTheme`
  Chrome-dormant no-op stub); no `browser_specific_settings`; `permissions`
  omits `menus` (Chrome ships with no context-menu capability at all, not even
  a degraded static one — Decision 1's "in-tile action row IS the Chrome
  interaction").
- **`../scripts/build-manifest.mjs`** — the merge implementation (also a
  sibling of `../scripts/sync-version.mjs`).

## Merge semantics — read this before editing an overlay

The merge is **shallow, top-level-key only**: `{ ...base, ...overlay }`. An
overlay key **replaces** the base key wholesale; there is **no recursive/deep
merge**. If a nested field differs between targets (e.g. `action.theme_icons`),
the **whole top-level key** (`action`) is fully declared in each overlay that
diverges — it is not enough to override just the nested field. This is a
deliberate trade-off: a little JSON gets duplicated across `firefox.json` and
`chrome.json` (e.g. both declare their own full `permissions` array, both
declare their own full `action` object), but editing one overlay can never
silently reach into a nested structure another target still depends on.

Output key order is deterministic (`CANONICAL_KEY_ORDER` in
`build-manifest.mjs`), independent of the source files' own key order, so
regeneration is diff-clean.

## Version

`package.json` stays the single source of truth for `version`. **Neither**
`base.json` **nor any overlay carries a `"version"` field at all** —
`build-manifest.mjs` reads `package.json` directly at merge time and injects
the value. This keeps the manifest-authoring sources themselves stateless
with respect to versioning, so there is nothing to keep in sync by hand.

`scripts/sync-version.mjs` regenerates and writes `webextension/manifest.json`
(the Firefox target) from `base.json` + `firefox.json` + `package.json`'s
current version. It runs in two places:

- the `pnpm version` lifecycle script — after `package.json` is bumped, so
  the version commit/tag already carries a matching regenerated manifest;
- the `pnpm build` prebuild step — a belt-and-braces resync.

## Regenerating / building

```bash
# Regenerate webextension/manifest.json in place (what pnpm version and
# pnpm build already do for you — you normally don't need to run this by hand)
node scripts/sync-version.mjs

# Firefox build (default target) — byte-identical to the pre-C6 build:
# regenerate the manifest, then `web-ext build` straight from webextension/
# (no staging copy; source == shipped holds).
pnpm build
pnpm build firefox

# Chrome build — DORMANT. Stages a copy of webextension/ under
# dist/chrome-build/, overwrites its manifest.json with the merged Chrome
# overlay, zips via web-ext build, then removes the staging directory. The
# resulting dist/newtab_powertools-chrome.zip is unvalidated beyond "the
# build succeeded" — there is no Chrome runtime anywhere in this project's
# CI/E2E/UAT yet.
pnpm build chrome
```

## Guard test

`tests/unit/manifest-authoring.test.ts` (chrome-prep C6) is the regression
guard:

- `mergeManifest('firefox')` deep-equals the committed
  `webextension/manifest.json` — catches both a hand-edit of the generated
  file and drift between `base.json`/`firefox.json`;
- the merge is deterministic;
- the Chrome overlay merges into a structurally honest MV3 manifest
  (`manifest_version: 3`, `background.service_worker`, no
  `browser_specific_settings`, no `theme_icons`, no `menus` permission).
