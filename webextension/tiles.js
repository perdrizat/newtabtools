/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Bridge shim (MODERNIZATION.md, Stage M, slice M2 — Decision 2). The
 * `Tiles`/`Background` models now live in lib/tiles-store.js as a real ES
 * module; this file's only job is exposing them on `globalThis` for the
 * other bridge-mode background file (background.js) that reads
 * `Tiles`/`Background` as bare identifiers and can't use `import` syntax
 * until its own carve-up (M5). lib/backup.js (M4) reads them via a real
 * `import` straight from lib/tiles-store.js instead of through this shim.
 */

import { Tiles, Background } from './lib/tiles-store.js';

globalThis.Tiles = Tiles;
globalThis.Background = Background;
