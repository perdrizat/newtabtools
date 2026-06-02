# AMO Submission Notes — Reviewer-Facing

This document collects the context AMO reviewers typically ask for. Paste the relevant sections into the Developer Hub's reviewer-notes field at submission time.

## Source-code disclosure

Most of the codebase is plain JavaScript with JSDoc type annotations. There is **no transpilation, bundling, or minification step** in our build:

- `pnpm build` runs `web-ext build` on `webextension/`, which packages the source files as-is into a `.zip` (treated as `.xpi`). No source transformation occurs.
- The submitted `.xpi` is byte-identical (modulo zip metadata) to what a reviewer can produce by checking out the git tag matching the submitted version and running `pnpm build`.
- The full source tree is public at <https://github.com/perdrizat/newtabtools>.

**One vendored library is minified:** `webextension/lib/zip.js` is the minified distribution of `@zip.js/zip.js` v2.8.26 (BSD-3-Clause), used to read and write user-exported backup zips. Its provenance is recorded in the file header:

```
/*
 * @zip.js/zip.js v2.8.26 — zip-core.min.js
 * Source: https://github.com/gildas-lormeau/zip.js
 * License: BSD-3-Clause
 * Installed as devDependency; copied via: pnpm update-zip
 */
```

The `update-zip` npm script in `package.json` shows exactly how the file is regenerated from the upstream npm package — the minified file is copied unchanged from `node_modules/@zip.js/zip.js/dist/zip-core.min.js` with a header prepended. Reviewers can reproduce the file by running `pnpm install && pnpm update-zip` against a checkout of the same git tag.

## `<all_urls>` permission — why we need it

`<all_urls>` is granted as a required permission in `webextension/manifest.json`. It is used exclusively to support **auto-thumbnail capture** of pages the user visits:

- The background script (`webextension/background.js`) listens for `webNavigation.onCompleted` for top-frame loads.
- When the loaded URL matches a tile in the user's grid, the background calls `chrome.tabs.captureVisibleTab(...)` to take a screenshot of the visible viewport (no script injection, no DOM access).
- The captured PNG is resized and stored in IndexedDB as the tile's thumbnail.

Specifics:

- **No content scripts.** The auto-thumbnail rewrite (git commit `da13254`, 2026-05-11) replaced the legacy `drawWindow` content-script approach with `captureVisibleTab`. No JavaScript is injected into visited pages.
- **No external transmission.** Captures are stored locally in IndexedDB. They are never sent off-device. The extension's CSP (`webextension/manifest.json` → `content_security_policy`) restricts outbound `connect-src` to the Mozilla wallpapers service only, which receives no thumbnail data.
- **Incognito excluded.** Background skips capture for incognito tabs.
- **Why `<all_urls>` and not `activeTab`?** Auto-capture must fire on `webNavigation.onCompleted` regardless of whether the user is interacting with the tab (background tabs, opening pinned sites, etc.). `activeTab` requires a user gesture per tab; the auto-thumbnail feature cannot work under that constraint.

Detailed security review of this path: `audit/2026-05-04-security-review.md` §2.6 (pre-rewrite analysis) and the rewrite commit `da13254`. The May 31 CSP-tightening audit (`audit/2026-05-31-csp-tightening.md`) re-validates that no outbound channel for thumbnail data exists.

## Permission inventory

Required (in `permissions`):

| Permission | Purpose |
|---|---|
| `<all_urls>` | `tabs.captureVisibleTab` for auto-thumbnails (see above). Read-only on visited pages; no DOM access. |
| `idle` | Schedule background cleanup of stale thumbnails when the user is idle. |
| `menus` | Right-click context menu on tiles (pin / unpin / edit / remove). |
| `search` | "Add tile" autocomplete reads the user's configured search engines for suggestions. |
| `sessions` | Powers the recently-closed-tabs row with one-click restore. |
| `storage` | Stores user preferences (`storage.local`). |
| `tabs` | Reads tab metadata for auto-thumbnail trigger and "Add tile" autocomplete from open tabs. |
| `topSites` | Default-grid generation (when the user hasn't pinned tiles). |
| `webNavigation` | Listens for `onCompleted` to trigger auto-thumbnail capture. |
| `webRequest` | Observational only — used to detect network-idle for the multi-stage capture timing. No request modification. |

Optional (in `optional_permissions`, requested at use time when the user opens the relevant feature):

| Permission | Purpose |
|---|---|
| `bookmarks` | "Add tile" autocomplete reads bookmarks for suggestions. |
| `downloads` | "Backup" button uses `downloads.download` to save the export zip. |
| `history` | "Add tile" autocomplete reads history for suggestions. |

## Data-collection declaration

`manifest.json` declares `browser_specific_settings.gecko.data_collection_permissions: { "required": ["none"] }`. The full rationale is in `PRIVACY.md` at the repo root and on the AMO listing's Privacy Policy URL. Summary: no telemetry, no analytics, no third-party endpoints, no user data ever leaves the device except for the single outbound request to the Mozilla wallpapers service (which receives nothing identifying about the user).

## Project history and lineage

NewTab PowerTools is a continuation fork of Geoff Lankow's (`darktrojan`) New Tab Tools, which the upstream maintainer placed in read-only mode. License (MPL-2.0) explicitly permits this continuation. The fork uses a new AMO ID (`newtabtools@symlink.ch`) to avoid collision with the upstream listing. The README at <https://github.com/perdrizat/newtabtools#readme> credits the original work.

## Reviewer can reach me at

- GitHub Issues: <https://github.com/perdrizat/newtabtools/issues>
- AMO Developer Hub messaging (the `maol@symlink.ch` account)
