/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals UndoDialog, newTabTools, pageMessageHandler */

/**
 * The new-tab page's single module entry point and boot orchestrator
 * (PAGE_MODULES.md, slice P1).
 *
 * newTab.html now loads exactly one script — `<script type="module"
 * src="page-main.js">` — in place of the former eight classic `<script>`
 * tags. Each of those eight files (side-effect-imported below, in today's
 * exact load order) still uses classic-script syntax internally (no
 * `import`/`export` — the vm test harness that loads them individually
 * depends on that staying true until P2–P5 convert them one at a time), but
 * now runs as a real ES module, so a plain top-level `var X = …` no longer
 * lands on `globalThis` the way it did as a classic script. Every file that
 * other files (or E2E/UAT page-context evaluation) need to reach as a bare
 * identifier therefore ends with an explicit `globalThis.X = X;` bridge
 * assignment — see the comment at the end of each of the eight files.
 * `common.js`/`prefs.js` already had this form permanently (the dual-scope
 * bridge, PAGE_MODULES.md's predecessor arc); the other six gained it here.
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
 * The globalThis bridge above is a staged, P1-only mechanism. P2–P5 replace
 * each file's `globalThis.X = X;` with a real `export`, and this file's
 * side-effect imports become named imports as each file's slice lands —
 * until then, `UndoDialog`/`newTabTools`/`pageMessageHandler` below are read
 * as bare identifiers that resolve through `globalThis` (hence the eslint
 * globals directive above instead of a named import).
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
