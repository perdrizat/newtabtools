# Chrome Web Store Submission Notes

Everything a CWS reviewer / the Developer Dashboard forms need, in the shape the
dashboard asks for it. The Chrome sibling of
[`amo-submission-notes.md`](./amo-submission-notes.md). Where a section mirrors
the AMO note it says so; Chrome-specific inversions (service worker vs event
page, `minimum_chrome_version`, per-permission justification boxes, the Privacy
practices tab) are called out.

Submitted as the CWS half of the **3.0.0** dual-store release
([`CHROME.md`](../CHROME.md) D7). A **new** CWS item under a fresh listing, not
an ID transfer.

---

## Single purpose

> NewTab PowerTools replaces the browser's new tab page with a configurable grid of the user's top sites, each shown with an auto-captured thumbnail. Every permission serves that one purpose.

## Build process & code readability (reviewer notes)

Mirrors the AMO note:

- **No transpilation, bundling, or minification.** The extension runs exactly as written. The uploaded zip is produced by `pnpm build chrome`, which stages `webextension/`, swaps in the merged Chrome manifest (`manifest/base.json` + `manifest/chrome.json`), copies the PNG icons, and zips — no code transform.
- **No minified files.** `webextension/lib/zip/` vendors `@zip.js/zip.js`'s unminified, unbundled ESM "core" build verbatim (a ~20-file tree plus `zip-core.js` + hand-written `zip-core.d.ts` types), reproduced by `pnpm install && pnpm update-zip`. `webextension/lib/backup.js` consumes it via a plain `import * as zip from './zip/zip-core.js'`.
- **No remote code.** All executable code ships in the package. The extension's CSP (`script-src 'self'`) forbids loading remote scripts. The single outbound network request (below) fetches wallpaper **data**, never code.
- Full source, MPL-2.0: <https://github.com/perdrizat/newtabtools>.

## Manifest & background (differs from AMO)

- Manifest V3. **On Chrome the background is a service worker** (`background: {"service_worker": "lib/background-main.js", "type": "module"}`) — this is the inverse of the Firefox build, which uses a non-persistent event page. The same `lib/background-main.js` entry and the same ES-module background tree run on both; platform differences are isolated behind a small `api` capability seam (`webextension/lib/platform.js`). All event listeners are registered synchronously at the top level so they survive service-worker suspend/respawn.
- **`minimum_chrome_version: 148`.** A conservative recent-stable floor. The extension passes `Blob`s and `Map`s of `Blob`s (thumbnails, favicons, the backup zip) across `runtime.sendMessage` via an in-package JSON-safe codec (`webextension/wire-codec.js` — base64-tagged payloads over Chrome's standard JSON message serialization; no special manifest keys, no channel-gated features). The manifest declares no `message_serialization` key.
- No content scripts anywhere.

## Permission justifications (paste one per dashboard box)

CWS requires a justification for **each** permission and for the host
permission, and rejects blank boxes. Each below is exercised in the shipped code
(verified against `webextension/`):

| Permission | Justification |
|---|---|
| `storage` | Persist the user's tiles, auto-captured thumbnails, settings, and the transient pending-capture queue locally (IndexedDB + `storage.local` + `storage.session`). Nothing is transmitted. |
| `topSites` | Populate the new-tab grid from the user's most-visited sites — the core feature. |
| `tabs` | Read the visible tab's URL/title/favicon to key a thumbnail capture, capture the visible tab (`tabs.captureVisibleTab`), and offer open tabs as suggestions in the "Add tile" dialog. |
| `sessions` | Power the recently-closed-tabs row below the grid (`sessions.getRecentlyClosed`) and one-click restore (`sessions.restore`). |
| `search` | The "search the web" action in the new-tab search/awesome bar (`search.query`). |
| `webNavigation` | Detect when a page in the user's grid finishes loading (`webNavigation.onCompleted`) to trigger its thumbnail capture. |
| `webRequest` | Network-idle heuristic only: reset a short per-tab timer on network activity so a capture waits until the page has settled (a better thumbnail). Read-only observation — the extension never blocks, redirects, or modifies any request (no `webRequestBlocking`). **Why not `activeTab`?** Captures also run for **background** tabs that were queued while inactive and complete later; `activeTab` is scoped to a user gesture on the current tab and can't observe those. |
| `idle` | Run the once-per-day cleanup of stale thumbnails when the browser goes idle (`idle.onStateChanged`), so cleanup never competes with active browsing. |
| **`<all_urls>` (host permission)** | Auto-thumbnail capture of the pages the user has in their grid: on `webNavigation.onCompleted` for a grid URL, `tabs.captureVisibleTab()` grabs the visible page. **No content scripts are injected.** Captures are stored locally and never transmitted. Capture **never runs in incognito windows**, and a per-site **never-capture list** lets the user exclude any host (adding one also purges captures already stored for it). The capture path checks the grant with `permissions.contains(...)` first and silently no-ops if the user has revoked it — nothing else depends on it. |

**Optional permissions** (requested at runtime, only if the user opts in — declared under `optional_permissions`, so no upfront justification box, but for completeness):

| Optional permission | Use |
|---|---|
| `bookmarks` | Autocomplete suggestions in the "Add tile" dialog, from the user's bookmarks. |
| `history` | Autocomplete suggestions in the "Add tile" dialog, from the user's history. |
| `downloads` | Save the exported backup zip via the browser's Save-As dialog. |

## Privacy practices tab (data-use disclosures)

- **Remote code:** **No** — the extension does not use remote code.
- **Data handled:** The extension handles, **entirely on the user's device (never transmitted)**: *Website content* (screenshots of pages the user visits, stored as tile thumbnails) and *Web activity* (the browser's top-sites list, and — only if the user grants the optional `history`/`bookmarks` permissions — those, for add-tile autocomplete). None of this is sent off the device.
- **Data collection/transmission:** The extension transmits **no user data**. Its one outbound connection is to Mozilla's public Remote Settings service (`https://firefox.settings.services.mozilla.com`) to fetch the curated **wallpaper catalog**; that request carries no account, no identifiers, and no browsing data. The CSP forbids any other outbound connection.
- **Required certifications** (all true):
  - I do **not** sell or transfer user data to third parties (outside approved use cases).
  - I do **not** use or transfer user data for purposes unrelated to the item's single purpose.
  - I do **not** use or transfer user data to determine creditworthiness or for lending.
- **Privacy policy URL:** `https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md`

## Project history

Active continuation fork of Geoff Lankow's "New Tab Tools" (original listing in
read-only mode since 2022). New CWS listing under `newtabtools@symlink.ch`;
license MPL-2.0 permits the continuation.
