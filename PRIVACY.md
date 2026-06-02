# Privacy Policy

**NewTab PowerTools** is a Firefox extension that replaces the new-tab page with a configurable grid of tiles. This document describes what the extension does with your data.

## What stays on your device

Everything you see in the extension is stored locally in your browser's `IndexedDB` and `storage.local`:

- **Tiles** — the URLs, titles, custom images, and per-tile colors you pin.
- **Auto-captured thumbnails** — when you visit a top site, the extension captures a screenshot of the visible page and stores it as the tile thumbnail.
- **Settings** — your grid layout, theme, wallpaper choice, opacity, filter rules, and other preferences.
- **Optional reads** — if you grant the `bookmarks`, `history`, or `downloads` permissions, the extension reads them to power autocomplete in the "Add tile" dialog. These reads happen locally; results are never sent anywhere.

## What leaves your device

One destination only: **`https://firefox.settings.services.mozilla.com`** — the Mozilla Remote Settings service that provides the curated wallpaper catalog. The request fetches wallpaper metadata; it sends nothing identifying about you (no account, no telemetry, no browsing history). The extension's Content Security Policy (declared in `webextension/manifest.json`) prohibits any other outbound connection.

NewTab PowerTools does **not**:

- Send telemetry, analytics, or crash reports.
- Contact any third-party server.
- Share your tiles, thumbnails, or browsing data with anyone.
- Use cloud sync. (Firefox Sync's add-on sync may carry your settings between your own devices if you've enabled it in Firefox itself — that's Mozilla's mechanism, not ours.)

## Retention and removal

- **While installed:** tiles and thumbnails persist until you remove them via the extension's UI (the "Remove" / "Block" / "Remove thumbnail" controls), or until the auto-cleanup threshold removes thumbnails that haven't been accessed recently.
- **Backup/Restore:** if you export a backup zip via Options → Backup, your tiles, thumbnails, and settings are written to a file *you control* and stored where *you decide*. Treat the file like a screenshot — it contains the visible state of pages you visited.
- **Uninstall:** removing the extension deletes the local IndexedDB and `storage.local` data Firefox associates with it.

## Source code and verification

NewTab PowerTools is open source under the Mozilla Public License 2.0. The full source is at <https://github.com/perdrizat/newtabtools>. The manifest's `browser_specific_settings.gecko.data_collection_permissions` value is `["none"]`, matching this policy.

## Contact

Issues and questions: <https://github.com/perdrizat/newtabtools/issues>.

---

*Last updated: 2026-06-02. If this policy changes, the change will be noted in `CHANGELOG.md` and a new dated version of this file will be committed.*
