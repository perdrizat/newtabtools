/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The new-tab page's single module entry point and boot orchestrator
 * (PAGE_MODULES.md, slice P1; imports made real in slice P5).
 *
 * newTab.html loads exactly one script — `<script type="module"
 * src="page-main.js">` — in place of the former eight classic `<script>`
 * tags. Every one of those eight files now speaks real `import`/`export`;
 * the side-effect-only imports below (for the five files this module
 * doesn't need a binding from) preserve the former script-tag load order as
 * documentation, even though ESM's dependency graph no longer depends on
 * that order for correctness. `newTab.js`/`fx-newTab.js`/`prefs.js` are
 * imported by name instead, since this file calls into them directly below
 * — a plain side-effect import of the same specifier would be a harmless
 * but redundant duplicate (the module graph caches by specifier), so those
 * three lines were replaced rather than kept alongside the named import.
 *
 * chrome-prep C4a (CHROME_PREP.md): `Updater`/`UndoDialog` used to be two of
 * fx-newTab.js's exports; they now live in their own `updater.js`/
 * `undo-dialog.js` modules (fx-newTab.js still imports both for its own
 * Grid/Site/Drag/Drop use). This file's import list grows from eight
 * entries to ten accordingly — `page-module-scope.test.ts`'s derived
 * `PAGE_FILES_IN_LOAD_ORDER` sanity check was updated to match (its
 * start/end invariants — `common.js` first, `fx-newTab.js` last — are
 * unchanged; only the length grew).
 *
 * Decision 3 of record (PAGE_MODULES.md): no page module executes another
 * module's code at its own top level — every cross-module call happens
 * here, in this file's boot sequence below, or later (event handlers,
 * promise callbacks). fx-newTab.js's own top level is definition-only (its
 * former boot trailer — `UndoDialog.init(); newTabTools.startup();
 * pageMessageHandler.flushQueued();` — was hoisted here in P1; the
 * `flushQueued()` call itself was retired in chrome-prep C3a — CHROME_PREP.md
 * — once P5's import cycle made the early-broadcast queue it replayed
 * provably unreachable); newTab.js's and fx-newTab.js's mutual imports of
 * each other (P5) form a legal ESM cycle for the same reason — every
 * cross-reference between them is call-time only, never a top-level read.
 *
 * The `globalThis.X = X;` bridge assignments that survived P5 as TEST-ONLY
 * (for E2E/UAT page-context evaluation) are retired as of chrome-prep C3d
 * (CHROME_PREP.md maintainer directive 1): the E2E/UAT harness now drives the
 * real page via runtime messages, `browser.storage.local`, DOM observation,
 * and synthesized DOM events instead of reading page globals, so every page
 * file's bottom-of-file bridge block is gone. Every cross-reference — page,
 * background, and test — now goes through a real `import`.
 *
 * PAGE_MODULES.md P3 (the dual-scope endgame): prefs.js's `prefsChanged` no
 * longer reaches into the page directly (the old `'newTabTools' in window`
 * branch calling `newTabTools.updateUI`/`Grid.refresh`/`Updater.updateGrid`
 * is gone — see prefs.js's own doc comment for why). `Prefs.onChange(...)`
 * below registers this page's listener AFTER the boot calls, reproducing
 * that old dance exactly at event time (legal per Decision 3 — this runs
 * from a callback, not from any module's top level). The background
 * registers no listener of its own.
 */

import './common.js';
import './icons.js';
import './stats.js';
import './tiles-shim.js';
import { Prefs } from './prefs.js';
import './awesomebar.js';
import { newTabTools } from './newTab.js';
import { UndoDialog } from './undo-dialog.js';
import { Updater } from './updater.js';
import { Grid } from './fx-newTab.js';

UndoDialog.init();

newTabTools.startup();

// PAGE_MODULES.md P3: the page's half of the Prefs.onChange seam (prefs.js's
// own doc comment has the background half of the story). Registered after
// the boot calls above so a pref change firing mid-boot can't race startup().
Prefs.onChange(function(keys) {
	newTabTools.updateUI(keys);
	if (typeof newTabTools._markAutoSaved === 'function') {
		newTabTools._markAutoSaved();
	}
	if (keys.includes('rows') || keys.includes('columns')) {
		Grid.refresh().then(function() {
			if (document.documentElement.hasAttribute('drawer-open')
				&& document.documentElement.getAttribute('drawer-tab') === 'tile') {
				newTabTools.resizeOptionsThumbnail();
			}
		});
	} else if (keys.includes('history')) {
		Updater.updateGrid();
	}
});
