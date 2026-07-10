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
 * Decision 3 of record (PAGE_MODULES.md): no page module executes another
 * module's code at its own top level — every cross-module call happens
 * here, in this file's boot sequence below, or later (event handlers,
 * promise callbacks). fx-newTab.js's own top level is definition-only (its
 * former boot trailer — `UndoDialog.init(); newTabTools.startup();
 * pageMessageHandler.flushQueued();` — was hoisted here in P1); newTab.js's
 * and fx-newTab.js's mutual imports of each other (P5) form a legal ESM
 * cycle for the same reason — every cross-reference between them is
 * call-time only, never a top-level read.
 *
 * The remaining `globalThis.X = X;` bridge assignments at the bottom of each
 * page file (see the comment at each file's end) are TEST-ONLY as of P5 —
 * every production cross-reference now goes through a real import; the
 * assignments survive solely for E2E/UAT page-context evaluation and any
 * fast-tier suite still reading a bare identifier off a computed-path
 * dynamic import (PAGE_MODULES.md's TEST-ONLY bridge policy).
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
import { newTabTools, pageMessageHandler } from './newTab.js';
import { Grid, UndoDialog, Updater } from './fx-newTab.js';

UndoDialog.init();

newTabTools.startup();

// The ready signal for any 'Page.updateGrid' / 'Page.restoreComplete'
// broadcast that arrived (and was queued by pageMessageHandler in
// newTab.js) before boot finished — see pageMessageHandler's own comment in
// newTab.js. The old `typeof pageMessageHandler !== 'undefined'` guard
// (dropped here) existed only so fx-newTab.js could also be loaded
// standalone, without newTab.js, by tests/integration/_helpers.ts's
// mountSite() harness; page-main.js always has both.
pageMessageHandler.flushQueued();

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
