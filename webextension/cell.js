/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4c (CHROME_PREP.md): extracted verbatim (C3b typed the `Cell`
// constructor+prototype before this slice moved it; no rewrite, per the
// arc's slicing rule). The top-of-file `DOMRect`
// prototype shim + its `NttRect` typedef move here too (placement decision,
// not the arc's default "leave with whichever module needs it least
// disruption" — recorded in the C4c report): of the four C4c modules, `Cell`
// is `NttRect`'s only in-file consumer (`position`'s declared type) — `Grid`,
// `Site`, `Page` never reference it directly (`Grid.cacheCellPositions`
// assigns `c.position = Transformation.getNodePosition(c.node)` without a
// local annotation) — so it travels with its dominant consumer, same logic as
// C3b's original single-file placement. `Drag`/`Drop` (still defined in
// drag-drop.js, C4b) are real, call-time-only references back into a file
// that in turn will import THIS file for `Cell` (drag-drop.js's
// `DropTargetShim`/`Drop` methods walk `Cell` nodes) — a legal ESM cycle
// under Decision 3 (PAGE_MODULES.md): every reference below is inside a
// method body, never a top-level read.
import { Drag, Drop } from './drag-drop.js';
import { Prefs } from './prefs.js';

/**
 * `Grid` stays owned by grid.js (C4c: `Grid`/`Site`/`Page` don't move here).
 * Unlike `Site`/`Cell` (constructor functions, whose own name doubles as the
 * instance type under `@constructor` JSDoc), `Grid` is a plain object-literal
 * singleton — its cross-module type reference needs a `typeof` wrapper, same
 * as this file's own in-body annotations used before the split (`typeof
 * Grid` referred to the local binding; now `Grid` is this alias, already
 * carrying that `typeof`, so the three in-body sites below read the bare
 * name instead of re-wrapping it — the one non-mechanical adaptation this
 * move requires, see the C4c report's purity ledger).
 * @typedef {typeof import('./grid.js').Grid} Grid
 */

/**
 * `SiteNode` stays owned by site.js (`Site`'s own expando back-reference
 * typedef) — referenced here (type-only, erased at compile time) because
 * `Cell.prototype.site` reads a cell's first child's `_newtabSite` expando.
 * @typedef {import('./site.js').SiteNode} SiteNode
 */

/**
 * `DOMRect`-shaped position record used throughout the grid/drag/drop code.
 * `Transformation`/the shim just below monkey-patch `isEmpty()`/
 * `intersect()` onto the (native or polyfilled) global `DOMRect.prototype`
 * at this file's top level — real at runtime, but invisible to
 * `lib.dom.d.ts`'s `DOMRect` type. Values built via `new DOMRect(...)` are
 * cast to this local alias instead (global-interface augmentation isn't
 * expressible from a checked .js file without a new ambient .d.ts — see the
 * `@ts-expect-error`s just below).
 * @typedef {Object} NttRect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} right
 * @property {number} bottom
 * @property {() => boolean} isEmpty
 * @property {(other: NttRect) => NttRect} intersect
 */

if (!('DOMRect' in window)) {
	// @ts-expect-error — dead branch on this project's Firefox target
	// (native `DOMRect` has shipped for years; `lib.dom.d.ts`'s non-optional
	// `Window.DOMRect` narrows `window` to `never` inside this guard).
	// Defensive polyfill kept for parity with the original upstream code;
	// not expressible in checked JS without a new ambient .d.ts.
	window.DOMRect = /** @this {NttRect} @param {number} left @param {number} top @param {number} width @param {number} height */ function(left, top, width, height) {
		this.left = left;
		this.top = top;
		this.width = width;
		this.height = height;
		this.right = left + width;
		this.bottom = top + height;
	};
	// @ts-expect-error — see reason above.
	DOMRect.prototype = {};
}

// @ts-expect-error — `DOMRect.prototype` gains `isEmpty`/`intersect` at
// runtime (global-interface augmentation, not expressible from checked JS
// without a new ambient .d.ts); `NttRect` is the local stand-in type used
// everywhere else in this file for values built via `new DOMRect(...)`.
DOMRect.prototype.isEmpty = /** @this {NttRect} */ function() {
	return this.left >= this.right || this.top >= this.bottom;
};

// @ts-expect-error — see reason above.
DOMRect.prototype.intersect = /** @this {NttRect} @param {NttRect} other */ function(other) {
	if (this.isEmpty() || other.isEmpty()) {
		return /** @type {NttRect} */ (/** @type {unknown} */ (new DOMRect(0, 0, 0, 0)));
	}

	let x1 = Math.max(this.left, other.left);
	let x2 = Math.min(this.right, other.right);
	let y1 = Math.max(this.top, other.top);
	let y2 = Math.min(this.bottom, other.bottom);
	// If width or height is 0, the intersection was empty.
	return /** @type {NttRect} */ (/** @type {unknown} */ (new DOMRect(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1))));
};

/**
 * Expando back-reference from a cell's DOM node to its `Cell` wrapper
 * (`Cell`'s constructor sets `node._newtabCell = this`). Not part of
 * `lib.dom.d.ts`'s `HTMLElement`, hence the local alias — `HTMLElement`
 * (not the plain `Element` the constructor receives) because every real
 * cell/site node is one, and callers read `.style`/`.offsetWidth`/etc.
 * @typedef {HTMLElement & { _newtabCell?: Cell }} CellNode
 */

/**
 * This class manages a cell's DOM node (not the actually cell content, a site).
 * It's mostly read-only, i.e. all manipulation of both position and content
 * aren't handled here.
 *
 * chrome-prep C4a (CHROME_PREP.md): gained a real `export` (previously
 * module-local) so sibling modules (transformation.js/updater.js/
 * undo-dialog.js/drag-drop.js, and now cell.js's own movers grid.js/site.js)
 * can reference it as a type via `import('./cell.js').Cell` — a JSDoc
 * `@typedef` is importable either way, but a plain constructor function
 * needs a real `export` for TS's `import()` type query to resolve it. No
 * behavior change.
 * @constructor
 * @param {Grid} grid
 * @param {Element} node
 * @this {Cell}
 */
export function Cell(grid, node) {
	this._grid = grid;
	this._node = /** @type {CellNode} */ (node);
	this._node._newtabCell = this;

	// Register drag-and-drop event handlers.
	['dragenter', 'dragover', 'dragexit', 'drop'].forEach(/** @this {Cell} @param {string} type */ function(type) {
		this._node.addEventListener(type, this);
	}, this);
}

Cell.prototype = {
	/**
	   * The grid.
	   * @type {Grid | null}
	   */
	_grid: null,

	/**
	   * The cell's DOM node.
	   * @this {Cell}
	   */
	get node() { return this._node; },

	/**
	   * Cached position, filled in by `Grid.cacheCellPositions` (a different
	   * object's method — outside TS's constructor-function inference, which
	   * only merges a class's own constructor/prototype assignments — hence
	   * this explicit declaration, matching prefs.js's `_version`/`_listeners`
	   * idiom for the same shape of problem).
	   * @type {NttRect | undefined}
	   */
	position: undefined,

	/**
	   * The cell's offset in the grid.
	   * @this {Cell}
	   */
	get index() {
		let index = /** @type {Grid} */ (this._grid).cells.indexOf(this);

		// Cache this value, overwrite the getter.
		Object.defineProperty(this, 'index', {value: index, enumerable: true});

		return index;
	},

	/**
	   * The previous cell in the grid.
	   * @this {Cell}
	   */
	get previousSibling() {
		let prev = /** @type {CellNode | null} */ (this.node.previousElementSibling);
		let prevCell = prev && prev._newtabCell;

		// Cache this value, overwrite the getter.
		Object.defineProperty(this, 'previousSibling', {value: prevCell, enumerable: true});

		return prevCell;
	},

	/**
	   * The next cell in the grid.
	   * @this {Cell}
	   */
	get nextSibling() {
		let next = /** @type {CellNode | null} */ (this.node.nextElementSibling);
		let nextCell = next && next._newtabCell;

		// Cache this value, overwrite the getter.
		Object.defineProperty(this, 'nextSibling', {value: nextCell, enumerable: true});

		return nextCell;
	},

	/**
	   * The site contained in the cell, if any.
	   * @this {Cell}
	   */
	get site() {
		let firstChild = /** @type {SiteNode | null} */ (this.node.firstElementChild);
		return firstChild && firstChild._newtabSite;
	},

	/**
	   * Checks whether the cell contains a pinned site.
	   * @return {boolean} Whether the cell contains a pinned site.
	   */
	containsPinnedSite() {
		let site = this.site;
		// Cast, not a rewrite: falls through to `site` itself (`null`/
		// `undefined`, not a coerced `false`) when falsy — every caller only
		// checks truthiness.
		return /** @type {boolean} */ (site && site.isPinned);
	},

	/**
	   * Checks whether the cell contains a site (is empty).
	   * @return {boolean} Whether the cell is empty.
	   */
	isEmpty() {
		return !this.site;
	},

	/**
	   * Handles all cell events.
	   * @param {DragEvent} event
	   */
	handleEvent(event) {
		if (!Drag.draggedSite) {
			return;
		}
		if (Prefs.locked) {
			return;
		}

		switch (event.type) {
		case 'dragenter':
			event.preventDefault();
			Drop.enter(this, event);
			break;
		case 'dragover':
			event.preventDefault();
			break;
		case 'dragexit':
			Drop.exit(this, event);
			break;
		case 'drop':
			event.preventDefault();
			if (!event.isTrusted) {
				Drop.drop(this, event);
			}
			break;
		}
	}
};
