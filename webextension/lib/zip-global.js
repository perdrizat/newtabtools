/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * ESM → globalThis bridge for the vendored @zip.js/zip.js "core" build
 * (webextension/lib/zip/, see scripts/update-zip.mjs). export.js is a
 * classic-script-shaped file (globalThis bridge, MODERNIZATION.md
 * Decision 2) that reads a `zip` global, not an ES module — this file
 * exists to give it one.
 *
 * Spiked 2026-07-09 (M1 Step 0): the formerly-vendored single-file UMD
 * build (webextension/lib/zip.js, a dist/zip-core.min.js copy) does not
 * reliably set globalThis.zip when loaded as an ES module — its UMD
 * wrapper's CommonJS/AMD/global-object detection is loader-sensitive.
 * Real `import`/`export` syntax has no such ambiguity, so M4's planned
 * ESM re-vendoring was pulled forward into M1.
 *
 * Import this BEFORE '../export.js' in webextension/lib/background-main.js
 * — export.js calls `zip.configure(...)` at its own top level on import.
 */
import * as zip from './zip/zip-core.js';

globalThis.zip = zip;
