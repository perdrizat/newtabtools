/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Grid, Prefs, Updater, UndoDialog, newTabTools, pageMessageHandler */

/**
 * The new-tab page's single module entry point and boot orchestrator
 * (PAGE_MODULES.md, slice P1).
 *
 * newTab.html now loads exactly one script — `<script type="module"
 * src="page-main.js">` — in place of the former eight classic `<script>`
 * tags. Each of those eight files (side-effect-imported below, in today's
 * exact load order) now runs as a real ES module, so a plain top-level
 * `var X = …` no longer lands on `globalThis` the way it did as a classic
 * script. As of P2 (PAGE_MODULES.md), icons.js/stats.js/tiles-shim.js use
 * real `export` syntax internally; awesomebar.js/newTab.js/fx-newTab.js/
 * action.js still use classic-script syntax (no `import`/`export` — the vm
 * test harness that loads them individually depends on that staying true
 * until their own P4/P5 slices convert them). Every file that other files
 * (or E2E/UAT page-context evaluation) need to reach as a bare identifier
 * therefore ends with an explicit `globalThis.X = X;` bridge assignment —
 * see the comment at the end of each of the eight files — regardless of
 * whether that file also now has a real `export`; `common.js`/`prefs.js`
 * already had this form permanently (the dual-scope bridge, PAGE_MODULES.md's
 * predecessor arc); the other six gained it in P1.
 *
 * Decision 3 of record (PAGE_MODULES.md): no page module executes another
 * module's code at its own top level — every cross-module call happens
 * here, in this file's boot sequence below, or later (event handlers,
 * promise callbacks). Before this slice, fx-newTab.js's own top level
 * unconditionally ran `UndoDialog.init(); newTabTools.startup();
 * pageMessageHandler.flushQueued();` at the bottom of the file — the one
 * violation of that rule, and only a violation because it reached across
 * files (into newTabTools/pageMessageHandler, both defined in newTab.js).
 * That trailer is hoisted here, unchanged in substance; fx-newTab.js's top
 * level is now definition-only.
 *
 * The globalThis bridge above is a staged mechanism, retired file-by-file as
 * each one's slice lands. P2 (PAGE_MODULES.md, revised 2026-07-10) gave
 * icons.js/stats.js/tiles-shim.js real `export`s — `NttIcons`/`TileStats`/
 * `Tiles`/`Background` are now genuinely exported values, not just
 * `globalThis` properties — but their consumers (awesomebar.js, newTab.js,
 * fx-newTab.js) are still vm-loaded classic scripts until P4/P5 and so still
 * read them as bare identifiers; the imports below therefore stay
 * side-effect-only (a named-but-unused import would only trip
 * `no-unused-vars`) rather than becoming named imports. `UndoDialog`/
 * `newTabTools`/`pageMessageHandler` below are read as bare identifiers that
 * resolve through `globalThis` (hence the eslint globals directive above
 * instead of a named import); that becomes a real import only once
 * newTab.js/fx-newTab.js convert in P5.
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
import './prefs.js';
import './awesomebar.js';
import './newTab.js';
import './fx-newTab.js';

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
