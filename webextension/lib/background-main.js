/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Background entry point (MODERNIZATION.md, Stage M, slice M1).
 *
 * manifest.json's `background` is `{"scripts": ["lib/background-main.js"],
 * "type": "module"}` — a single ES-module entry replacing the old six-file
 * classic-script array. This file does nothing but side-effect-import the
 * same six files, in the exact order the manifest used to list them, so
 * every top-level listener registration and init call still runs
 * synchronously top-to-bottom on import, unchanged from before.
 *
 * Why side-effect imports instead of real `import`/`export` bindings: the
 * six files still use the globalThis bridge (MODERNIZATION.md Decision 2)
 * — each converts its top-level `var X = …` / `function X() {}` cross-file
 * symbol (audit/2026-07-09-mv3-inventory.md §1.9) to `globalThis.X = …`
 * instead of a real ES `export`. That form works identically whether the
 * file is loaded as a classic `<script>` (prefs.js and common.js are also
 * loaded that way, from newTab.xhtml, and must keep working there
 * unchanged) or side-effect-imported from here. A sibling file that reads
 * `Prefs`/`Tiles`/`db`/etc. via a bare identifier finds it on `globalThis`
 * either way. Real `import { X } from …` bindings are not used because
 * `prefs.js`/`common.js` can't gain `export` syntax without breaking their
 * classic-script page load.
 *
 * M2 (MODERNIZATION.md, "the readiness redesign") adds two more real-module
 * -> globalThis bridges: `withStore` (lib/db.js) and `SAFE_PROTOCOLS`
 * (lib/constants.js). Both are needed by
 * background.js, which stays bridge-mode (no `import` syntax) until its own
 * carve-up in M3/M5 — same reason tiles.js keeps the `Tiles`/`Background`
 * bridge itself instead of doing it here. These two are small enough, and
 * have no natural existing shim file of their own (unlike Tiles/Background's
 * tiles.js), that bridging them directly in this file — rather than adding
 * two more single-purpose "-global.js" files — is the more readable choice;
 * revisit if a third such bridge shows up. Textual position relative to
 * `../background.js` below doesn't matter for correctness: ES module
 * evaluation runs every one of this file's OWN imports (including
 * background.js) to completion before any of this file's own body
 * statements — including these `globalThis.X = …` lines — execute, so they
 * are guaranteed to land before any asynchronous listener callback in
 * background.js can possibly run, regardless of where they're written here.
 *
 * M3 (MODERNIZATION.md, "carve the capture pipeline into real ES modules")
 * adds lib/capture.js's exports the same way: `getTZDateString`,
 * `resetNetworkIdleTimer`, `disarmNetworkIdle`, `startCaptureSession`,
 * `removeCaptureSession`, `addPendingCapture`, `takePendingCapture`,
 * `removePendingCapture`, `purgeNeverCaptureHost` (which moves here from
 * being defined directly by background.js — it's now a real export of
 * lib/capture.js instead of a `globalThis.purgeNeverCaptureHost = …`
 * assignment inside background.js). Every one of these is read LAZILY by
 * background.js — from inside a message-handler case or another listener's
 * callback body, never at background.js's own top level — so the same
 * "bridge in this file's trailing body, order doesn't matter" reasoning
 * above applies to all of them. The one exception, `resetNetworkIdleTimer`,
 * IS referenced at background.js's top level (the three
 * `chrome.webRequest.*.addListener(resetNetworkIdleTimer, …)` calls); rather
 * than special-case its bridge ordering, background.js wraps it in a local
 * closure at each call site (see that file's own comment) so the identifier
 * lookup itself is deferred to first use, same as everything else here.
 *
 * M4 (MODERNIZATION.md, "backup/export module") adds `lib/backup.js`'s
 * `makeZip`/`readZip` the same way. The former `lib/zip-global.js` bridge
 * (which gave the old export.js a `globalThis.zip` to read) is gone — M1's
 * pulled-forward zip ESM vendoring is now consumed directly by lib/backup.js
 * via a real `import * as zip from './zip/zip-core.js'`, so there is no more
 * globalThis-bridged `zip` anywhere; `zip.configure(...)` moved to
 * lib/backup.js's own top level. `makeZip`/`readZip` are read LAZILY by
 * background.js (from inside the `Export:backup`/`Import:restore`
 * message-handler cases, never at top level), so the same "bridge in this
 * file's trailing body, order doesn't matter" reasoning as the M3 paragraph
 * above applies.
 *
 * No other logic lives in this file — M5 consolidates listener registration
 * here for real; this slice only flips the loading mechanism plus these
 * bridge assignments, otherwise behavior-identical.
 */

import '../common.js';
import '../tiles.js';
import '../prefs.js';
import { withStore } from './db.js';
import { SAFE_PROTOCOLS } from './constants.js';
import {
	getTZDateString,
	resetNetworkIdleTimer,
	disarmNetworkIdle,
	startCaptureSession,
	removeCaptureSession,
	addPendingCapture,
	takePendingCapture,
	removePendingCapture,
	purgeNeverCaptureHost,
} from './capture.js';
import { makeZip, readZip } from './backup.js';
import '../background.js';

globalThis.withStore = withStore;
globalThis.SAFE_PROTOCOLS = SAFE_PROTOCOLS;
globalThis.getTZDateString = getTZDateString;
globalThis.resetNetworkIdleTimer = resetNetworkIdleTimer;
globalThis.disarmNetworkIdle = disarmNetworkIdle;
globalThis.startCaptureSession = startCaptureSession;
globalThis.removeCaptureSession = removeCaptureSession;
globalThis.addPendingCapture = addPendingCapture;
globalThis.takePendingCapture = takePendingCapture;
globalThis.removePendingCapture = removePendingCapture;
globalThis.purgeNeverCaptureHost = purgeNeverCaptureHost;
globalThis.makeZip = makeZip;
globalThis.readZip = readZip;
