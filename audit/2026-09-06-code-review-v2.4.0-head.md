# Code Review — v2.4.0..HEAD (full-range audit)

**Date:** 2026-09-06
**Scope:** `v2.4.0` → `HEAD` (branch `chrome-port`): 199 files, +17,422/−7,137 — the chrome-prep C-arcs, the Chrome-port D-arcs (D1–D6, D5b), and the D8 wire-codec remediation. Production code only (`webextension/`, `scripts/`, `manifest/`); vendored `lib/zip*` and `_locales` excluded.
**Methodology:** 8 independent finder angles (line-by-line diff scan, removed-behavior audit, cross-file tracer, reuse, simplification, efficiency, altitude, CLAUDE.md conventions), 29 raw candidates deduplicated to 22, each adjudicated by an independent verifier (CONFIRMED / PLAUSIBLE / REFUTED, recall-biased). High effort.

## Executive summary

The range is structurally sound — the removed-behavior sweep explicitly verified that the security boundaries survived the restructuring (restore allow-lists intact plus the new `filters` guard, `onMessage` sender validation kept, `site.js` URL/hex validation preserved, the wire codec covers every Blob/File/Map payload actually on the wire today). The conventions angle found **zero** CLAUDE.md violations.

However, **10 behavioral findings survive verification**, and two of them are user-facing feature outages that the test tiers mask rather than catch: real-user tile drag-and-drop is dead on Chrome, and the toolbar popup's Capture button is a no-op on both platforms. Both should gate the 3.0.0 release. A recurring pattern across findings 1, 5, and the test-masking notes: the E2E/integration tiers exercise synthetic events and fabricated senders, so "126/126 parity" did not protect the trusted-event and popup-sender paths.

## Findings (verified, ranked)

### 1. Tile drag-and-drop is completely broken for real users on Chrome — CONFIRMED (release blocker)

`webextension/drag-drop.js:458` — `DropTargetShim._dragover` dereferences the Firefox-only `dataTransfer.mozSourceNode` unguarded (the JSDoc even types it `mozSourceNode?: Node`). On Chrome every trusted `dragover` throws a TypeError before `preventDefault()`; `Drag.drag` never runs, `_cellLeft`/`_cellTop` stay undefined, `_findDropTarget` builds a NaN rect and never matches a cell — dropping a tile never repositions or repins it. **Why the green suites missed it:** `cell.js:259` routes only `!event.isTrusted` (synthetic) drops into `Drop.drop`, and `tests/e2e/drag-reorder.test.ts` dispatches synthetic `dragstart`/`drop` without ever firing `dragover` — Chrome E2E parity passes while the real-user path is dead.

### 2. Toolbar popup "Capture" button is a silent no-op on both platforms — CONFIRMED

`webextension/lib/messages.js:230` — the `Thumbnails.capture` handler acts only `if (sender.tab)`, but its sole production sender is the action popup (`action.js:37`), and a browser-action popup message carries no `sender.tab` (it isn't a tab context; there are no content scripts). The handler returns without starting a capture session; no error surfaces. `lib/capture.js:133`'s comment names the popup as a live caller, masking the dead path. **Test masking:** `tests/integration/auto-thumbnail.test.ts:812` fabricates `sender = {tab: {id: 42, ...}}`; `action-popup.test.ts` asserts only that the message is sent.

### 3. Restoring a corrupt backup fails with zero user feedback — CONFIRMED

`webextension/newTab.js:676` — `Import:restore` is sent with no callback/`.then`/`.catch`, while `lib/messages.js:331-342` deliberately responds `{ok: false, error}` on a rejected `readZip` ("must report an error, not fail silently"). The only success signal (`Page.restoreComplete`) is broadcast only after writes complete, so the failure case has no page-side path at all: the user believes the restore happened. On Chrome the discarded promise also makes a codec-encoded-File-over-the-cap rejection an unhandled rejection.

### 4. Denying the downloads permission makes backup fail silently — CONFIRMED

`webextension/newTab.js:662` — the options-backup handler passes a zero-argument callback to `api.permissions.request({permissions: ['downloads']}, ...)` and runs `requestBackup()` unconditionally. On denial the background still builds and returns the zip (so the `!response.data` alert path added in audit m3 is not taken), then `api.downloads.download` throws on undefined `api.downloads` and lands in `.catch(console.error)` — no file, no alert, on both platforms. The file's own JSDoc admits the rejection path.

### 5. `unpin()` never deletes a tile whose title/URL was ever edited — CONFIRMED

`webextension/site.js:219` — the keep-record check `Object.keys(link).some(k => !['id','title','url','position'].includes(k))` treats `titleIsUserSet` as meaningful extra data, but `newTab.js` persists it present-but-`false` on the Set-URL (:499-509) and title-remove (:596-602) paths. Unpinning such a tile takes the `putTile` branch instead of `Tiles.removeTile`; the stale record persists in IDB forever, and `tiles-store.js:176`'s `Object.assign(next, mapData)` merges its outdated id/title onto future top-sites entries.

### 6. Drag HTML-escape condition uses `&&` where `||` is needed — CONFIRMED (pre-existing, security-flavored)

`webextension/drag-drop.js:191` — `if (url.includes('"') && url.includes('<'))`: the escape runs only when the URL contains BOTH characters, so a URL with just a double-quote is interpolated raw into the `text/html` drag flavor (`'<a href="' + url + '"'`) — attribute injection into any drop target that renders the HTML flavor (rich-text editors, mail composers). `&` is never escaped on any path. Predates v2.4.0 (traced to upstream), extracted verbatim in C4b — in scope as a touched function.

### 7. The wire codec covers only the page→background direction — CONFIRMED (latent)

`webextension/lib/platform.js:304` — the codec's two chokepoints are the page's `runtime.sendMessage` (api.js) and the background handler registration (lib/messages.js). Background-outbound sends (`broadcastToPages`; platform.js's Proxy does a bare `Reflect.get` with no runtime wrap) and the page's inbound `onMessage` listener (`newTab.js:1810`; `wrapRuntimeForWire` passes `onMessage` through by reference) both bypass it. Safe today only because `broadcastToPages` accepts a bare `@param {string} name` — but no comment at the seam and no test guards the asymmetry. The first payload-carrying broadcast recreates the exact Blob-mangling class Decision 11 was opened to kill: green on Firefox and jsdom, mangled on stable Chrome only.

### 8. Recently-closed age chips mishandle Chrome's `sessions` divergence — PLAUSIBLE

`webextension/titlebar.js:148` — `_formatAge` computes `Math.floor(Date.now()/1000) - lastModified`, assuming Firefox's seconds. Chrome reports milliseconds AND places `lastModified` on the Session, not the tab (the field is destructured from `item.tab` at :251), so on Chrome the value is likely `undefined` → the `if (!lastModified) return ''` guard yields silently blank age chips (rather than the negative ages a ms value would produce). Either way the divergence is unhandled and unnormalized anywhere.

### 9. Backup blob-URL lifecycle: listener race + page-scoped lifetime — PLAUSIBLE

`webextension/backup-download.js:55` — two related defects at one seam. (a) The `onDownloadChanged` listener filters `delta.id !== downloadId`, but `downloadId` is assigned only when `await api.downloads.download(...)` resolves; a terminal event racing that assignment (immediate cancel/'interrupted') is dropped, leaving the multi-MB blob URL and the listener alive for the page lifetime — no other path revokes or deregisters. (b) The D2 move of `URL.createObjectURL` from the background to the page (Chrome SW has no blob URLs) means the URL is now document-scoped with `saveAs: true` and no unload handling: closing the new-tab page while the save dialog is open or the write is in flight can kill the source mid-download, a lifetime v2.4.0's background-scoped URL had.

### 10. Export:backup is one base64 message — large Chrome profiles can't export — PLAUSIBLE (known, partially mitigated)

`webextension/lib/messages.js:326` — the whole zip crosses the wire as a single base64 payload (~33% amplification) with no chunking; `requestBackup`'s own JSDoc names the Chrome message-size cap as a failure mode, mitigated only by a generic "export failed" alert. A profile with hundreds of thumbnails plus a wallpaper can plausibly hit the cap — backup permanently impossible at exactly the profile size where it matters. A chunked wire or a downloads-API path on the SW side would remove the ceiling.

## Secondary findings — verified cleanup backlog (not counted against the top 10)

All CONFIRMED by verification unless noted:

- **Dead dual-shape reads + stale comments** (`newTab.js:535`, `:1691`, `:1747`; `titlebar.js:335`): the `x instanceof Map ? x.get(k) : x[k]` fallbacks predate Decision 11; the codec now guarantees a real Map on both platforms, so the plain-object branches are unreachable and their justifying comments ("a Map response degrades to a plain object") are stale — and the pattern invites copy-paste re-scattering of divergence handling the codec centralized. (A finder's claim that the `:1747` copy misses a null guard was REFUTED — `:1736` has the early return.)
- **Two parallel Chrome stagers** (`scripts/build.mjs:44-64` vs `tests/e2e-chrome/_tools/chrome-env.mjs` `stageDevBuild()`): identical four-step staging, and the copies are already drifting — build.mjs's header still calls the chrome target "DORMANT… unvalidated" and `stage-dev.mjs:17` still advertises the removed structured-clone messaging. Every tier validates `dist/chrome-dev/` while the CWS zip ships from the other, unshared path.
- **The `api` Proxy + its justification comment duplicated near-verbatim** (`api.js:41` / `lib/platform.js:71`): a shared factory in a dual-scope root file is feasible today (`lib/messages.js` already imports `../wire-codec.js`).
- **Host normalization ×4 with four different failure fallbacks** (`site.js:77`, `:96`, `lib/messages.js:265`, `titlebar.js:257`): same `hostname.replace(/^www\./,'')`, four divergent catch semantics ('·', null, raw-URL, skip-row).
- **base64→bytes decode loop duplicated** (`wire-codec.js:190` vs `lib/thumbnail-image.js:165`).
- **UAT env constants re-derived in four files** (`browser-daemon.mjs`, `runner.mjs`, `preflight.mjs`, `daemon-smoke.mjs`: browser/port/health-timeout triple) — cooperating processes that must agree, synchronized only by convention.
- **`newTabURL`/entry-path knowledge ×3** (`tests/uat/_tools/urls.mjs`, `tests/e2e/_helpers.ts:156` byte-identical, `chrome-env.mjs` `NEWTAB_PATH`).
- **Chrome-binary resolution duplicated** (`scripts/rasterize-icons.mjs:51` — self-acknowledged inline copy of `chrome-env.mjs`).
- PLAUSIBLE: `api.js:118` re-derives `location.protocol !== 'chrome-extension:'` raw despite importing `_wireCodecActive` from the file that owns that predicate; `api.js:52` re-wraps `wrapRuntimeForWire(ns.runtime)` on every `api.runtime` access (low-impact — batched call sites); `site.js`'s hand-rolled object-URL lifecycle vs `object-urls.js` (non-trivial: the shared module is deliberately singleton-scoped).

## Refuted (recorded so they aren't re-raised)

- **Live-resolving Proxy overhead** — documented C5 decision of record (per-test global reassignment); cost is one nullish-coalesce + `Reflect.get`; no residual merit.
- **Codec walk needs a wire-name allowlist** — adjudicated a trade-off, not a win: the walk short-circuits on primitives/instances and coupling the name-agnostic codec to the wire-name table would silently mangle any future binary wire missing from the list.

## What was checked and found sound

Restore allow-lists (`safeProtocols`/`safeHexColor`/`safeBackgroundUrl`/`allowedKeys`) survived the export.js→lib/backup.js move intact and gained a `filters` guard; `runtime.onMessage` sender validation kept; `site.js` render-time URL validation preserved; the early-broadcast queue retirement is sound under the ESM cycle ordering; the codec covers every Blob/File/Map payload on the wire today; the `filters-ui.js` Chrome `topSites.get` gap flagged in `common.js`'s comment was actually fixed. Zero CLAUDE.md-convention violations in the range. One residual hygiene note: a stored pre-2.5 `statType` of `rank`/`fresh` is normalized on read (recorded decision) but the stale value round-trips storage and backups forever — restore applies no value check to `statType`, unlike its neighbors.

## Suggested disposition

1. **Before the 3.0.0 D gate:** findings 1-5 (two feature outages, two silent-failure UX holes, one data-hygiene bug); plus an E2E gap-closure task — a trusted-event `dragover` path test and a popup-sender (no `sender.tab`) test, since both outages were masked by harness fidelity, not covered-and-regressed.
2. **With finding 7:** either wrap the remaining two codec directions now (symmetric seam) or land a guard test + seam comment that fails the moment a broadcast carries a payload.
3. **Cleanup backlog:** file as issues; none block release.
