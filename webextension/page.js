/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4c (CHROME_PREP.md): extracted verbatim (C3b typed the `Page`
// singleton before this slice moved it; no rewrite, per the arc's slicing
// rule). `Page` was missing from the original
// C4 phase list — it becomes its own small module rather than folding into
// grid.js, since it's a distinct singleton (page-level init/event dispatch,
// not grid state) with its own single consumer (newTab.js's `Page.init()`
// boot call). `Grid`/`Drag`/`DropTargetShim` are real, call-time-only
// references — `Page` is a leaf among the C4c movers (nothing in
// grid.js/cell.js/site.js/drag-drop.js imports `Page` back), so unlike its
// siblings this file starts no new cycle of its own; it only joins the
// pre-existing newTab.js<->page.js cycle (newTab.js's `Page.init()` call is
// call-time only, inside its boot sequence, per Decision 3).
import { Grid } from './grid.js';
import { Drag, DropTargetShim } from './drag-drop.js';

/**
 * This singleton represents the whole 'New Tab Page' and takes care of
 * initializing all its components.
 */
export var Page = {
	/** @type {boolean | undefined} */
	_initialized: undefined,

	/**
	   * Initializes the page.
	   */
	init() {
		this._init();

		addEventListener('resize', Grid.cacheCellPositions);
	},

	/**
	   * Internally initializes the page. This runs only when/if the feature
	   * is/gets enabled.
	   */
	_init() {
		if (this._initialized) {
			return;
		}

		this._initialized = true;

		Grid.init();

		// Initialize the drop target shim.
		DropTargetShim.init();
	},

	/**
	   * Handles all page events.
	   * @param {DragEvent} event
	   */
	handleEvent(event) {
		switch (event.type) {
		case 'dragover':
			if (Drag.draggedSite) {
				event.preventDefault();
			}
			break;
		case 'drop':
			if (Drag.draggedSite) {
				event.preventDefault();
				event.stopPropagation();
			}
			break;
		}
	}
};
