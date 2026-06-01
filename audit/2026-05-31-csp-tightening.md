# 2026-05-31 — CSP tightening: remove the `connect-src https:` wildcard

## Summary

The manifest CSP carried a `connect-src https:` **wildcard** that allowed the
extension (new-tab page + background) to `fetch()` **any** HTTPS origin. This
review removes it. Favicons — the only feature that used it — keep working via a
narrower `img-src https:` (paint-only) plus in-process `data:` decoding.

### Before

```
connect-src 'self' https: https://firefox.settings.services.mozilla.com
img-src     'self' blob: data: https://firefox-settings-attachments.cdn.mozilla.net
```

### After

```
connect-src 'self' https://firefox.settings.services.mozilla.com
img-src     'self' blob: data: https: https://firefox-settings-attachments.cdn.mozilla.net
```

## How the wildcard got there

Added in commit `9c55479` (Phase 3 + 4-5) so `fetchFaviconBlob` (`background.js`)
could `fetch()` arbitrary `tab.favIconUrl`s and cache the bytes as a Blob in the
`thumbnails` IDB store. It was not called out in an `audit/` doc at the time, and
the 2026-05-04 security audit's tightened `connect-src` was silently widened. The
2026-05-31 completion review (§1.1) flagged it.

## Why `connect-src https:` is the wrong boundary for favicons

- `fetch()`-any-HTTPS is a **read** channel: script can read response bodies, so a
  compromised/over-eager code path could exfiltrate or pull arbitrary remote data.
- A favicon only needs to be **painted**, not read. `<img src="https://…">` is
  governed by `img-src`, a strictly weaker capability: the bytes render to a
  cross-origin image the page's script cannot read back (canvas becomes
  tainted — `toDataURL`/`getImageData` throw). It is not a data-exfiltration
  channel.

So we trade a read-anything wildcard for a paint-only one.

## What changed in code

- **`fetchFaviconBlob` (`background.js`)** now caches **only `data:` favicons**
  (decoded in-process via `dataURLtoBlob`, 64 KB cap). The remote-`fetch()`
  branch is removed; it returns `null` for `http(s):` URLs.
- **`pickAndStore`** stores the remote favicon **URL string** (`faviconUrl`)
  on the thumbnails row instead of fetched bytes.
- **`Thumbnails.getFavicons`** returns a `url → (Blob | string)` map.
- **Page side** (`getFavicons` / `Site.applyFavicon`) renders a cached Blob via
  an object URL, or a remote URL string directly as `<img src>` after
  `isValidURL` validation.

Net favicon coverage is **the same or better**: `data:` favicons still cache
(offline-capable); remote favicons now render live for every https favicon,
not just ones that happened to complete a fetch inside the capture window.

## Option B (Firefox favicon cache) — rejected, empirically

Reintroducing a no-network favicon read via `page-icon:` / `moz-page-icon:`
(as the IMPLEMENTATION_PLAN's 4-5 text aspirationally described — it never
actually shipped; git history shows zero commits for it) was probed against
real Firefox ESR 140 from the extension's new-tab context:

```
fetch page-icon:…       → NetworkError (THREW)
fetch moz-page-icon:…   → NetworkError (THREW)
img   page-icon:…       → ERROR
img   moz-page-icon:…   → ERROR
```

These are chrome-privileged internal protocols not exposed to WebExtensions, so
B is not viable. (A second probe under the proposed CSP confirmed a cross-origin
`<img>` favicon renders under `img-src https:` while `fetch()` to the same URL is
blocked — i.e. the boundary genuinely moves.)

## Compensating controls retained

- `<all_urls>` host permission is unchanged — it is load-bearing for the
  auto-screenshot (`captureVisibleTab`) and `webRequest` network-idle timing,
  not for favicons. Out of scope here.
- `firefox.settings.services.mozilla.com` stays explicitly named in
  `connect-src` for the wallpaper-records `fetch()` (`newTab.js`).
- `data:` favicons keep the 64 KB cap; remote favicon URLs are `isValidURL`-gated
  before becoming an `<img src>`.

## Threat model after

The extension can no longer `fetch()` arbitrary HTTPS origins. The remaining
`connect-src` reach is `'self'` + one named Mozilla settings host. Remote images
can be painted but not read. This restores the 2026-05-04 audit's intent.
