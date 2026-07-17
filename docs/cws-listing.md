# Chrome Web Store Listing Copy — NewTab PowerTools

Canonical copy for the Chrome Web Store (CWS) listing. Edit this file first,
then paste the relevant fields into the CWS Developer Dashboard at submission.
The Chrome sibling of [`amo-listing.md`](./amo-listing.md); shared prose is kept
in sync, Chrome-specific fields (single purpose, per-permission justifications,
privacy-practice disclosures, screenshot dimensions) are called out below.

Ships as part of the **3.0.0** dual-store release (AMO + CWS simultaneously, per
[`CHROME.md`](../CHROME.md) D7). A fresh CWS item, not a transfer.

---

## Name

> **NewTab PowerTools**

(CWS max: 75 chars · current: 17)

## Summary / short description

> A configurable new tab page. Auto-captures tile thumbnails of pages you visit, with full control over the grid, layout, and wallpapers.

(CWS "summary" max: **132 chars** — shorter than AMO's 250, so this is trimmed;
current: 131. Drops the "recently-closed row" clause AMO's summary carries.)

## Category

**Workflow & Planning**

(CWS's closest bucket for a new-tab productivity surface. "Tools" is the
fallback. CWS has no dedicated "Tabs" category like AMO.)

## Detailed description (CWS max 16,000 chars)

```markdown
NewTab PowerTools replaces Chrome's built-in new tab page with one designed for the sites you actually visit and the layout you actually want. Think of it as PowerToys for your browser — extra controls and visual cues the default doesn't expose.

What's different from Chrome's default new tab

- Tiles you can actually see. Chrome's shortcuts stay small and cap at ten. NewTab PowerTools lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and tiles scale to fill the viewport.
- Tiles that look like the sites they link to. The extension auto-captures a thumbnail of each top site the way it actually appeared the last time you visited. Chrome's native shortcuts only show a favicon or a letter.
- Pixel-level layout control. Pick exact rows and columns, lock a tile aspect ratio (16:9, 4:3, 1:1, 3:4 portrait, or fill viewport), tune opacity, title size, page margins, and grid spacing.
- Per-domain filter cap. Cap how many tiles a single host takes — including subdomain wildcards like .example.com.
- Per-tile background color. A custom solid color per tile, in addition to a custom image.
- Never-capture list. Exclude any site from auto-thumbnail capture — one click on a tile, or manage the list in the Advanced drawer (exact host, or .example.com for subdomains). Adding a host also deletes captures already stored for it. Keep banking, webmail, and intranets out of your tile imagery and backups.
- Recently-closed-tabs row. A dedicated horizontal row of recently closed tabs sits below the grid for one-click restore.
- Backup and restore. Export your tiles, thumbnails, and settings to a single backup file. No account, no cloud required.

Privacy

All your data — tiles, thumbnails, settings — stays on your device in your browser's local storage. Thumbnail capture never runs in incognito windows, and a per-site never-capture list lets you exclude any host (banking, webmail, intranets) from capture entirely. The extension has one outbound connection: to Mozilla's public wallpapers service for the curated wallpaper catalog. No telemetry, no analytics, no third-party endpoints, no remote code. Full privacy policy: https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md

About

NewTab PowerTools is a continuation fork of Geoff Lankow's New Tab Tools, which the original maintainer placed in read-only mode in 2022. The codebase, the original feature set, and most of what makes the extension worth continuing are Geoff's — this fork carries forward the maintenance, security hardening, and the v2 UI redesign. License (MPL-2.0) explicitly permits the continuation.

Source code, issues, and roadmap: https://github.com/perdrizat/newtabtools
```

**Diffs from the AMO long description** (keep both in sync when editing):
- "Firefox's built-in new tab page" → "Chrome's built-in new tab page"; the
  two "What's different from Firefox's default" bullets rewritten for Chrome's
  defaults (Chrome caps shortcuts at ten and shows favicon/letter, not the
  Firefox "stays small / manual image upload" framing).
- "private windows" → "incognito windows".
- "No Firefox Sync required" → "No account, no cloud required".
- Added "no remote code" to the Privacy paragraph (a CWS review hot-button).
- Plain text, not HTML — CWS renders the description as plain text with basic
  line breaks (no HTML tags, unlike AMO).

## Single purpose (CWS-required field)

> NewTab PowerTools replaces the browser's new tab page with a configurable grid of the user's top sites, showing an auto-captured thumbnail of each. Every permission and every feature serves that single purpose.

(CWS requires a single-purpose statement; an extension whose permissions don't
map to one clear purpose is rejected. Ours is the new-tab surface.)

## Permissions & privacy

Per-permission justifications and the data-use disclosures for the CWS
"Privacy practices" tab live in [`cws-submission-notes.md`](./cws-submission-notes.md).
Fill every "Justification" box on the dashboard from that file — CWS requires a
justification for **each** permission and for the `<all_urls>` host permission,
and rejects blank ones.

## Privacy Policy URL

`https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md`

(Required by CWS for any item that handles user data. Same policy as AMO;
[`PRIVACY.md`](../PRIVACY.md) is browser-neutral.)

## Support / homepage

- Support URL: `https://github.com/perdrizat/newtabtools/issues`
- Homepage URL: `https://github.com/perdrizat/newtabtools`
- Support email: `maol@symlink.ch`

## Screenshots

**CWS spec differs from AMO.** CWS accepts **1280×800** or 640×400 PNG/JPEG,
1–5 images (AMO used 2400×1800, up to 10). So the AMO shots must be
**re-captured at 1280×800** for CWS — the `scripts/amo-screenshots.mjs`
generator drives the UAT browser daemon at a fixed viewport; point it at Chrome
(the daemon is already `$UAT_BROWSER`-parameterized) and set the capture size to
1280×800, or crop/downscale the existing 2400×1800 masters.

Pick the five strongest from the AMO set (CWS shows the first as primary):

| Slot | Source (AMO master) | Caption (≤ store limit) |
|---|---|---|
| 1 | `01-grid-4x4-medium-light.png` | A 4×4 grid of your sites, auto-captured thumbnails on a wallpaper. |
| 2 | `02-grid-4x4-medium-dark.png` | The same grid in dark theme — follows your system theme. |
| 3 | `03-grid-3x3-maxi-light.png` | Go big: fewer columns, large spacing, margins and rounded corners. |
| 4 | `06-settings-drawer.png` | Settings drawer: rows × columns, tile aspect ratio, spacing, opacity. |
| 5 | `07-domain-filter.png` | Per-domain cap with a `.subdomain` wildcard. |

(Note the dark-theme caption drops the Firefox-specific "or set it yourself"
browser-theme wording — Chrome follows `prefers-color-scheme`, there is no
`browser.theme` picker.)

## Icon

128×128 PNG — `assets/chrome-icons/icon-128.png` (rasterized from `icon.svg` by
`scripts/rasterize-icons.mjs`; CWS requires PNG, not SVG).

## License

MPL-2.0.

## Versioning

CWS, like AMO, requires each upload's manifest `version` to be strictly higher
than the last. `package.json` is the single source of truth; `pnpm build chrome`
mirrors it into the generated `manifest.json`. First CWS upload is **3.0.0**,
matching the simultaneous AMO 3.0.0 upload.
