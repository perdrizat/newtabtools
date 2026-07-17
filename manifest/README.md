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
  `theme_icons` (Firefox's `browser.theme`-driven icon switching — the theme
  decision of record in [`CONTRIBUTING.md`](../CONTRIBUTING.md)), and
  `permissions` including `menus` (Firefox's dynamic per-tile context menu —
  the menus decision of record, same place).
- **`chrome.json`** — the Chrome MV3 overlay, **validated** by the
  [`CHROME.md`](../CHROME.md) program: Chrome E2E parity (124/126 run + 2
  SW-lifecycle tests skipped on Chrome, GH #23), Chrome UAT (11/11), and the
  10-check smoke all run against the manifest this file builds. It diverges from
  `firefox.json` in exactly the ways
  chrome-prep's C0/C5 decisions already called out: `background` uses the
  MV3 module `service_worker` form instead of the event-page `scripts` form;
  `action` has no `theme_icons` (Chrome gets `default_icon` only — no
  automatic theme-driven icon switching; `syncActionIconWithTheme` does it
  imperatively instead, wired for real on Chrome per CHROME.md D4, a no-op only
  on Firefox where `theme_icons` handles it declaratively); no
  `browser_specific_settings`; `permissions`
  omits `menus` (Chrome ships with no context-menu capability at all, not even
  a degraded static one — Decision 1's "in-tile action row IS the Chrome
  interaction").

  A few more fields that only make sense on the Chrome side (CHROME.md D4):

  - **`icons` / `action.default_icon` are PNG size maps, not SVG.** Chrome's
    manifest icon keys don't accept SVG. `icons` is `{"16", "32", "48", "128"}`
    pointing at pre-rasterized PNGs; `action.default_icon` is `{"16", "32"}`
    pointing at the `tools-light` glyph only (no dark variant — Chrome has no
    `theme_icons`, so there's nothing to switch between; the eventual
    `action.setIcon` dark-mode wiring is a `lib/platform.js` concern, not a
    manifest one). Both PNG sets are produced by the checked-in
    `scripts/rasterize-icons.mjs` (puppeteer-core + Chrome for Testing, zero
    new dependencies) into `assets/chrome-icons/` at the repo root — not
    under `webextension/`, so the Firefox artifact (built straight from
    `webextension/`) stays byte-identical. `scripts/build.mjs`'s chrome
    target copies those PNGs into the staged build's `images/` directory
    after copying `webextension/` wholesale, since `manifest/chrome.json`
    overriding `icons` takes the whole key per the shallow-merge rule above —
    it can't reach into base.json's SVG-only `icons` map.
  - **`minimum_chrome_version: "148"`** — CHROME.md Decision 10's floor:
    148 is where `message_serialization` shipped (below), the binding
    API requirement; every other per-API floor is far older.
  - **`message_serialization: "structured_clone"`** (CHROME.md Decision 10)
    — opts Chrome's extension messaging into the structured-clone
    algorithm, so the thumbnail/favicon wire responses (`Map`s of `Blob`s)
    cross intact instead of degrading to `{}` under JSON serialization.
    Chrome-only key: Firefox messaging is structured-clone natively and
    must NOT carry the key (web-ext lint would flag it, and there's
    nothing to opt into).
  - **`incognito: "spanning"`** is stated explicitly even though it's
    Chrome's default. `chrome_url_overrides` doesn't apply in incognito
    windows regardless (Chrome never lets an extension override the
    incognito new-tab page), so this has no behavioral effect either way —
    it's recorded so the choice reads as deliberate rather than an
    accidental omission, since JSON has no comments to carry that rationale
    inline.
  - **CSP stays unchanged for Chrome.** `base.json`'s `content_security_policy`
    includes `connect-src https://firefox.settings.services.mozilla.com` (the
    wallpaper catalog fetch) — this is a plain `fetch()` call, identical on
    Chrome, so the same CSP is kept rather than forked per-target (CHROME.md
    D4 review item).
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

# Chrome build — the validated store artifact (CHROME.md D1–D6). Stages a copy
# of webextension/ under dist/chrome-build/, copies assets/chrome-icons/*.png
# into its images/, overwrites its manifest.json with the merged Chrome overlay,
# zips via web-ext build, then removes the staging directory. The resulting
# dist/newtab_powertools-chrome.zip is exercised by the Chrome runtime tier
# (E2E parity, UAT, smoke). For MANUAL "Load unpacked" testing use
# `pnpm chrome:stage` instead — it stages an unpacked build to dist/chrome-dev/
# (see CHROME.md "Manual testing in Chrome").
pnpm build chrome

# Regenerate assets/chrome-icons/*.png after editing
# webextension/images/icon.svg or tools-light.svg (requires Chrome for
# Testing — pnpm chrome:provision — or $CHROME_BIN):
node scripts/rasterize-icons.mjs
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
  `browser_specific_settings`, no `theme_icons`, no `menus` permission,
  PNG `icons`/`action.default_icon` size maps, `minimum_chrome_version`,
  `incognito`).
