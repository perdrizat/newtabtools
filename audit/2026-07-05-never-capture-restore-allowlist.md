# 2026-07-05 — Security boundary: restore allow-list gains `neverCaptureHosts`

## Summary

The never-capture privacy feature (GH #1) adds a user-configurable list of hosts
whose tabs are never auto-screenshotted, persisted under the `chrome.storage.local`
key `neverCaptureHosts`. For the list to survive profile migration it must round-trip
through backup/restore, which required adding `neverCaptureHosts` to the restore
allow-list (`allowedKeys`) in `webextension/export.js` (`readZip`).

Per repo-root `CLAUDE.md` ("Security-boundary changes require explicit acknowledgement"),
allow-list additions in `export.js` are a designated boundary change and require this
written acknowledgement (a)–(d).

## (a) What boundary moved

`readZip`'s `allowedKeys` grows by one entry, `neverCaptureHosts`. A restored backup
zip can now write this pref into `chrome.storage.local`. Export needs no change —
`makeZip` already serialises all of `storage.local` minus `thumbnailSize`/`version`,
so the key rides along automatically; only the restore-side gate widened.

## (b) Why the previous boundary was inadequate

Excluding the key from restore would silently drop a user's anti-capture protections
exactly when they migrate profiles — the single setting a privacy-conscious user most
needs to survive a restore. A never-capture list that doesn't persist is a privacy
foot-gun.

## (c) New threat model

A crafted backup can inject arbitrary entries into `neverCaptureHosts`. The effects are
**privacy-increasing and data-destructive only**:

1. suppression of thumbnail capture for the named hosts, and
2. deletion of already-stored thumbnails/favicons (and stripping of auto-captured
   tile images) for those hosts on restore.

Worst case is a nuisance denial-of-service of the thumbnail feature — bounded, visible
in the Advanced-tab list, trivially removable, and reversible by revisiting the sites
after removal. The values are **never** used as URLs, code, or CSS; they feed only
string comparison against `new URL(x).hostname`.

## (d) Compensating controls

- **Restore-time validation** (`readZip`): the value must be an `Array`; each entry is
  run through `Filters.normalizeHost` with any `:port` stripped, must match the
  plausible-host shape `/^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/`, is deduped, and anything
  non-conforming is dropped (a non-array value drops the whole key).
- **Second-layer validation** in `Prefs.parsePrefs` on every load: array-of-non-empty-
  strings or ignored.
- **UI rendering** of the list is `textContent`-only (no `innerHTML`, attribute, or CSS
  interpolation), matching the existing `filters` row rendering.
- **Restore purge ordering:** the purge for restored hosts runs *after* tiles are
  restored, so a backup's own auto-captured tile images for a listed host are stripped
  rather than re-inserted — the never-capture invariant holds across the restore
  boundary.

## Test coverage

- `tests/integration/backup-restore.test.ts` — validation (non-strings / bad patterns /
  non-array dropped, normalization, dedupe), per-entry purge invocation, and
  replace-not-merge parity with `blocked`/`filters`.
- `tests/e2e/backup-restore.test.ts` — `neverCaptureHosts` survives a full
  backup→restore round-trip.

## Precedent

This is the acknowledgement the `2026-05-31` CSP-widening review called for as a
commit-time gate (see [`audit/2026-05-31-csp-tightening.md`](2026-05-31-csp-tightening.md));
recording it here at commit time is exactly that gate applied.
