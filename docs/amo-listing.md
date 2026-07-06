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

```markdown
NewTab PowerTools replaces Firefox's built-in new tab page with one designed for the sites you actually visit and the layout you actually want. Think of it as **PowerToys for your browser** — extra controls and visual cues the default doesn't expose.

### What's different from Firefox's default

- **Tiles you can actually see.** Firefox's shortcuts stay small no matter how few you choose. NewTab PowerTools lets you pick a fixed grid — 2 × 3, 4 × 6, whatever fits — and tiles scale to fill the viewport.
- **Tiles that look like the sites they link to.** The extension auto-captures a thumbnail of each top site the way it actually appeared the last time you visited. Firefox's native shortcuts only accept manual image uploads.
- **Pixel-level layout control.** Pick exact rows and columns, lock a tile aspect ratio (16:9, 4:3, 1:1, 3:4 portrait, or fill viewport), tune opacity, title size, page margins, and grid spacing.
- **Per-domain filter cap.** Cap how many tiles a single host takes — including subdomain wildcards like `.example.com`. Firefox enforces a hard one-tile-per-domain rule and doesn't expose this.
- **Per-tile background color.** Native supports a custom image per tile, but not a custom solid color.
- **Never-capture list.** Exclude any site from auto-thumbnail capture — one click on a tile, or manage the list in the Advanced drawer (exact host, or `.example.com` for subdomains). Adding a host also deletes captures already stored for it. Keep banking, webmail, and intranets out of your tile imagery and backups.
- **Recently-closed-tabs row.** A dedicated horizontal row of recently closed tabs sits below the grid for one-click restore.
- **Backup and restore.** Export your tiles, thumbnails, and settings to a single backup file. No Firefox Sync required.

### Privacy

All your data — tiles, thumbnails, settings — stays on your device in your browser's local storage. Thumbnail capture never runs in private windows, and a per-site **never-capture list** lets you exclude any host (banking, webmail, intranets) from capture entirely. The extension has one outbound connection: to the Mozilla wallpapers service for the curated wallpaper catalog. No telemetry, no analytics, no third-party endpoints. Full privacy policy: [PRIVACY.md](https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md).

### About

NewTab PowerTools is a continuation fork of Geoff Lankow's New Tab Tools, which the original maintainer placed in read-only mode in 2022. The codebase, the original feature set, and most of what makes the extension worth continuing are Geoff's — this fork carries forward the maintenance, security hardening, and the v2 UI redesign. License (MPL-2.0) explicitly permits the continuation.

Source code, issues, and roadmap: [github.com/perdrizat/newtabtools](https://github.com/perdrizat/newtabtools)
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
- `privacy`

(Optional; AMO lets up to ~10. Keeping the list tight to avoid tag spam.)

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

Eight shots, native 2400×1800 PNG. AMO shows the first as the primary; order them so a 4×4 hero leads. Captions ≤100 chars.

| Slot | File | Caption | Status |
|---|---|---|---|
| 1 | `assets/screenshots/01-grid-4x4-medium-light.png` | A 4×4 grid of your sites, auto-captured thumbnails on a wallpaper. | Captured |
| 2 | `assets/screenshots/02-grid-4x4-medium-dark.png` | The same grid in dark theme — follows your Firefox theme or set it yourself. | Captured |
| 3 | `assets/screenshots/03-grid-3x3-maxi-light.png` | Go big: fewer columns, large spacing, margins and rounded corners. | Captured |
| 4 | `assets/screenshots/04-grid-3x3-maxi-dark.png` | The large-tile layout in dark theme. | Captured |
| 5 | `assets/screenshots/05-add-tile-autocomplete.png` | "Add tile" with autocomplete suggestions from your open tabs. | Captured |
| 6 | `assets/screenshots/06-settings-drawer.png` | Settings drawer: rows × columns, tile aspect ratio, spacing, opacity. | Captured |
| 7 | `assets/screenshots/07-domain-filter.png` | Per-domain cap with a `.subdomain` wildcard in the settings panel. | Captured |

Format: PNG, native **2400×1800** (AMO's maximum resolution).

Reproducible via `node scripts/amo-screenshots.mjs` (needs `FIREFOX_BIN` + `pnpm build`). The script reproduces a real user's new tab: it **pins only the top 5 favourites** and lets the rest of the grid **fill from browsing history** (Firefox topSites). To get real thumbnails it browses the curated site list in **three passes** — two fast passes build frecency so each site enters topSites, then a re-render folds topSites into the extension's auto-capture cache, and a final pass (dismissing cookie banners, settling) triggers the captures. Thumbnails live in IndexedDB keyed by URL, so they re-attach to every layout. It then opens/closes deep article tabs (distinct from the tile homepages, so they survive the recently-closed row's tile-dedup filter) to populate the recently-closed row and the add-tile autocomplete, captures the feature shots, and renders the hero gallery **last** (when thumbnail coverage is highest) — 4×4 medium and 3×3 "maxi" (large spacing/margin/radius) grids in light and dark themes on different wallpapers.

Tiles are popular, recognizable, tech-leaning US + international news/community/shopping (GitHub, Hacker News, Stack Overflow, Steam, Wikipedia pinned; The Verge, TechCrunch, MDN, BBC, Tom's Hardware, Hackaday, Heise, CoinDesk, Bitcoin Magazine, Linux Hardware Reviews filling from history). Sites that bot-block headless (Amazon, YouTube, Newegg) or use un-dismissable cookie walls are deliberately omitted. Typical result: a flawless 16/16 grid carrying real thumbnails. Edit the `SITES`, `RECENT_TABS`, and `OPEN_TABS` lists in `tests/uat/_tools/browser-daemon.mjs` to adjust.
