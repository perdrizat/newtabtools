# AMO Listing Copy — NewTab PowerTools

Canonical copy for the addons.mozilla.org listing. Edit this file first, then paste the relevant fields into the AMO Developer Hub at submission. Each version's listing snapshot lives in git; if AMO copy is ever lost or needs to be re-submitted, this file is the source of truth.

---

## Name

> **NewTab PowerTools**

(AMO max: 50 chars · current: 17)

## Summary

> A configurable new tab page for Firefox. Auto-captures tile thumbnails of pages you visit, with full control over the grid, layout, and wallpapers — plus a recently-closed-tabs row for quick restore.

(AMO max: 250 chars · current: 213)

The summary deliberately spells "new tab" with a space so fuzzy search hits both forms (the canonical brand "NewTab" CamelCase and the spaced variant users naturally type).

## Long description (HTML)

```html
<p>NewTab PowerTools replaces Firefox's built-in new tab page with one designed for the sites you actually visit and the layout you actually want. Think of it as <strong>PowerToys for your browser</strong> — extra controls and visual cues the default doesn't expose.</p>

<h3>What's different from Firefox's default</h3>

<ul>
  <li><strong>Tiles you can actually see.</strong> Firefox's shortcuts stay small no matter how few you choose. NewTab PowerTools lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and tiles scale to fill the viewport.</li>
  <li><strong>Tiles that look like the sites they link to.</strong> The extension auto-captures a thumbnail of each top site the way it actually appeared the last time you visited. Firefox's native shortcuts only accept manual image uploads.</li>
  <li><strong>Pixel-level layout control.</strong> Pick exact rows and columns, lock a tile aspect ratio (16:9, 4:3, 1:1, 3:4 portrait, or fill viewport), tune opacity, title size, page margins, and grid spacing.</li>
  <li><strong>Per-domain filter cap.</strong> Cap how many tiles a single host takes — including subdomain wildcards like <code>.example.com</code>. Firefox enforces a hard one-tile-per-domain rule and doesn't expose this.</li>
  <li><strong>Per-tile background color.</strong> Native supports a custom image per tile, but not a custom solid color.</li>
  <li><strong>Recently-closed-tabs row.</strong> A dedicated horizontal row of recently closed tabs sits below the grid for one-click restore.</li>
  <li><strong>Backup and restore.</strong> Export your tiles, thumbnails, and settings to a single backup file. No Firefox Sync required.</li>
</ul>

<h3>Privacy</h3>

<p>All your data — tiles, thumbnails, settings — stays on your device in your browser's local storage. The extension has one outbound connection: to the Mozilla wallpapers service for the curated wallpaper catalog. No telemetry, no analytics, no third-party endpoints. Full privacy policy: <a href="https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md">PRIVACY.md</a>.</p>

<h3>About</h3>

<p>NewTab PowerTools is a continuation fork of Geoff Lankow's New Tab Tools, which the original maintainer placed in read-only mode in 2022. The codebase, the original feature set, and most of what makes the extension worth continuing are Geoff's — this fork carries forward the maintenance, security hardening, and the v2 UI redesign. License (MPL-2.0) explicitly permits the continuation.</p>

<p>Source code, issues, and roadmap: <a href="https://github.com/perdrizat/newtabtools">github.com/perdrizat/newtabtools</a></p>
```

## Category

**Tabs**

(AMO requires exactly one. Other plausible buckets — "Appearance," "Download Management," "Other" — are weaker fits for an extension whose primary surface is the new-tab page.)

## Tags (suggested)

- `new tab page`
- `wallpapers`
- `tiles`
- `thumbnails`
- `productivity`

(Optional; AMO lets up to ~10. Keeping to 5 to avoid tag spam.)

## Support URL

`https://github.com/perdrizat/newtabtools/issues`

(Gated on item 9 — re-opening the issues tracker. Until done, fall back to the support email below.)

## Support Email

`maol@symlink.ch`

## Privacy Policy URL

`https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md`

## Homepage

`https://github.com/perdrizat/newtabtools`

## License (already in manifest)

MPL-2.0

## Versioning

Each AMO upload must have a strictly higher manifest `version` than the previous one. Convention: bump `manifest.json` and `package.json` in lockstep. Semver path from `1.0.0`:

- `1.0.1` — bugfix-only release
- `1.1.0` — new feature
- `2.0.0` — major change (e.g., MV3 migration)

## Reviewer notes

See [`amo-submission-notes.md`](./amo-submission-notes.md). Paste into the AMO Developer Hub's reviewer-notes field at submission.

## Screenshots checklist

(Item 3 of the AMO submission plan; this section is the placeholder where image filenames + captions will live once the screenshots are taken.)

| Slot | File | Caption (≤100 chars) | Status |
|---|---|---|---|
| 1 | `assets/screenshots/01-grid-main.png` | The grid in fill-viewport mode, vivid auto-captured thumbnails on a wallpaper. | TODO |
| 2 | `assets/screenshots/02-settings-drawer.png` | Settings drawer open: rows × columns, tile aspect ratio, spacing, opacity. | TODO |
| 3 | `assets/screenshots/03-add-tile-autocomplete.png` | "Add tile" with autocomplete suggestions from tabs / bookmarks / history. | TODO |
| 4 | `assets/screenshots/04-recently-closed.png` | The recently-closed-tabs row with one-click restore. | TODO |
| 5 | `assets/screenshots/05-domain-filter.png` | Per-domain cap with `.example.com` wildcard in the settings panel. | TODO |

Format: PNG, 1280×800 ideal (AMO accepts 1000×750 minimum). All five should use the UAT fixture (`tests/uat/newtabtools_knowngood.zip`) as the starting state so the screenshots stay reproducible.
