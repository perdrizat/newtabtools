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
 * `lib/zip-global.js` (not `../lib/zip.js` — see scripts/update-zip.mjs and
 * that file's own header comment for why) must load before `../export.js`:
 * export.js calls `zip.configure(...)` at its own top level on import.
 *
 * No logic lives in this file — M5 consolidates listener registration here
 * for real; this slice only flips the loading mechanism, behavior-identical.
 */

import '../common.js';
import '../tiles.js';
import '../prefs.js';
import '../background.js';
import './zip-global.js';
import '../export.js';
