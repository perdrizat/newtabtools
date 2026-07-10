/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// page-modules P5 (PAGE_MODULES.md): real imports replace the former
// `/* exported */`/`/* globals */` headers. `newTabTools` comes from
// newTab.js, which forms a legal ESM cycle with this file (Decision 3) —
// every reference below is call-time only (inside methods/callbacks), never
// a top-level read. (chrome-prep C3b incident, 2026-07-10: the first cut of
// this slice broke exactly that rule — an aliased import re-exposed as a
// typed top-level `const` read the cycle binding while it was still in TDZ,
// so raw module loading threw `ReferenceError: … before initialization` and
// the page never booted in real Firefox, invisible to the vite-transformed
// fast tier. The intersection type now lives ON newTab.js's export instead
// — the prefs.js `PrefsAccessors` pattern — and
// tests/unit/raw-module-eval.test.ts is the permanent tripwire for this
// class.) `pageMessageHandler` (also exported by newTab.js) is not
// referenced by this file's code (only by a comment describing the P1
// trailer hoist), so it is deliberately not imported here — see the P4
// precedent (PAGE_MODULES.md) for trusting actual usage over the plan draft.
import { newTabTools } from './newTab.js';
import { Blocked, NeverCapture, Prefs } from './prefs.js';
import { NttIcons } from './icons.js';
import { Tiles } from './tiles-shim.js';
import { TileStats } from './stats.js';
import { el } from './dom.js';

// chrome-prep C3b (CHROME_PREP.md): central typedefs for this file, grouped
// here rather than scattered at first use.

/**
 * The persisted tile/link shape a `Site` wraps. Reused from tiles-shim.js
 * (the leaf this file already imports `Tiles` from — see its `Tile`
 * typedef, mirroring lib/tiles-store.js's background-side model) rather
 * than duplicated here.
 * @typedef {import('./tiles-shim.js').Tile} Link
 */

/**
 * `newTabTools`'s object literal (newTab.js) is the base method surface;
 * newTab.js's post-literal IIFE adds UI-element refs (`page`,
 * `databaseError`, …) at runtime. The export in newTab.js carries the full
 * intersection type (`NewTabToolsPageRefs`, declared there — the prefs.js
 * `PrefsAccessors` pattern), so the plain cycle import above already sees
 * `newTabTools.page`/`.databaseError`/`.selectedSiteIndex` — no local alias
 * or top-level read needed (and none allowed: Decision 3, see the header
 * comment).
 */

/**
 * `DOMRect`-shaped position record used throughout the grid/drag/drop code
 * below. `Transformation`/the shim just below monkey-patch `isEmpty()`/
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

/**
 * `Transformation.freezeSitePosition`/`unfreezeSitePosition`/`slideSiteTo`
 * temporarily add/remove an own `index` property on a `Site` instance while
 * its node is absolute-positioned mid-drag/rearrange. It's a different
 * object (`Transformation`) doing the assigning, so it falls outside TS's
 * constructor-function inference (which only merges a class's own
 * constructor/prototype assignments) — this typedef intersects the extra
 * shape on at the three call sites that touch it. `'index' in site` is what
 * they branch on; the property's presence, not its value, is the signal.
 * @typedef {Object} SiteIndexState
 * @property {number} [index]
 */

/**
 * Expando back-reference from a cell's DOM node to its `Cell` wrapper
 * (`Cell`'s constructor sets `node._newtabCell = this`). Not part of
 * `lib.dom.d.ts`'s `HTMLElement`, hence the local alias — `HTMLElement`
 * (not the plain `Element` the constructor receives) because every real
 * cell/site node is one, and callers read `.style`/`.offsetWidth`/etc.
 * @typedef {HTMLElement & { _newtabCell?: Cell }} CellNode
 */

/**
 * Expando back-reference from a site's DOM node to its `Site` wrapper
 * (`Site`'s constructor sets `node._newtabSite = this`). See `CellNode`
 * above for why this is `HTMLElement`-based rather than `Element`-based.
 * @typedef {HTMLElement & { _newtabSite?: Site }} SiteNode
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
 * This singleton allows to transform the grid by repositioning a site's node
 * in the DOM and by showing or hiding the node. It additionally provides
 * convenience methods to work with a site's DOM node.
 */
export var Transformation = {
	/**
	   * Gets a DOM node's position.
	   * @param {Element} node The DOM node.
	   * @return {NttRect} A Rect instance with the position.
	   */
	getNodePosition(node) {
		let {left, top, width, height} = node.getBoundingClientRect();
		let {offsetLeft, offsetTop} = /** @type {HTMLElement} */ (newTabTools.page.firstElementChild);
		return /** @type {NttRect} */ (/** @type {unknown} */ (new DOMRect(left - offsetLeft, top - offsetTop, width, height)));
	},

	/**
	   * Fades a given node from zero to full opacity.
	   * @param {HTMLElement} node The node to fade.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	fadeNodeIn(node, callback) {
		this._setNodeOpacity(node, 1, function() {
			// Clear the style property.
			node.style.opacity = '';

			if (callback) {
				callback();
			}
		});
	},

	/**
	   * Fades a given node from full to zero opacity.
	   * @param {HTMLElement} node The node to fade.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	fadeNodeOut(node, callback) {
		this._setNodeOpacity(node, 0, callback);
	},

	/**
	   * Fades a given site from zero to full opacity.
	   * @param {Site} site The site to fade.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	showSite(site, callback) {
		this.fadeNodeIn(site.node, callback);
	},

	/**
	   * Fades a given site from full to zero opacity.
	   * @param {Site} site The site to fade.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	hideSite(site, callback) {
		this.fadeNodeOut(site.node, callback);
	},

	/**
	   * Allows to set a site's position.
	   * @param {Site} site The site to re-position.
	   * @param {{left: number, top: number}} position The desired position for the given site.
	   */
	setSitePosition(site, position) {
		let style = site.node.style;
		let {top, left} = position;

		style.top = top + 'px';
		style.left = left + 'px';
	},

	/**
	   * Freezes a site in its current position by positioning it absolute.
	   * @param {Site & SiteIndexState} site The site to freeze.
	   */
	freezeSitePosition(site) {
		if (this._isFrozen(site)) {
			return;
		}

		let first = /** @type {NttRect} */ (Grid.cells[0].position);
		let style = site.node.style;
		style.width = first.width + 'px';
		style.height = first.height + 'px';

		site.node.setAttribute('frozen', 'true');
		site.index = /** @type {Cell} */ (site.cell).index;
		this.setSitePosition(site, /** @type {NttRect} */ (Grid.cells[site.index].position));
	},

	/**
	   * Unfreezes a site by removing its absolute positioning.
	   * @param {Site & SiteIndexState} site The site to unfreeze.
	   */
	unfreezeSitePosition(site) {
		if (!this._isFrozen(site)) {
			return;
		}

		let style = site.node.style;
		style.left = style.top = style.width = style.height = '';
		site.node.removeAttribute('frozen');
		delete site.index;
	},

	/**
	   * Slides the given site to the target node's position.
	   * @param {Site & SiteIndexState} site The site to move.
	   * @param {Cell} target The slide target.
	   * @param {{unfreeze?: boolean, callback?: () => void}} [options] Set of options (see below).
	   *        unfreeze - unfreeze the site after sliding
	   *        callback - the callback to call when finished
	   */
	slideSiteTo(site, target, options) {
		let self = this;
		let callback = options && options.callback;

		function finish() {
			if (options && options.unfreeze) {
				self.unfreezeSitePosition(site);
			}

			if (callback) {
				callback();
			}
		}

		let currentIndex = 'index' in site ? site.index : /** @type {Cell} */ (site.cell).index;

		// Nothing to do here if the positions already match.
		if (currentIndex == target.index) {
			finish();
		} else {
			this.setSitePosition(site, /** @type {NttRect} */ (target.position));
			site.index = target.index;
			this._whenTransitionEnded(site.node, ['left', 'top'], finish);
		}
	},

	/**
	   * Rearranges a given array of sites and moves them to their new positions or
	   * fades in/out new/removed sites.
	   * @param {Array<Site | null | undefined>} sites An array of sites to rearrange.
	   * @param {{unfreeze?: boolean, callback?: () => void}} [options] Set of options (see below).
	   *        unfreeze - unfreeze the site after rearranging
	   *        callback - the callback to call when finished
	   */
	rearrangeSites(sites, options) {
		/** @type {Promise<void>[]} */
		let batch = [];
		let cells = Grid.cells;
		let callback = options && options.callback;
		let unfreeze = options && options.unfreeze;

		sites.forEach(/** @this {typeof Transformation} */ function(site, index) {
			// Do not re-arrange empty cells or the dragged site.
			if (!site || site == Drag.draggedSite) {
				return;
			}

			batch.push(new Promise(resolve => {
				if (!cells[index]) {
					// The site disappeared from the grid, hide it.
					this.hideSite(site, resolve);
				} else if (this._getNodeOpacity(site.node) != /** @type {unknown} */ (1)) {
					// The site disappeared before but is now back, show it.
					this.showSite(site, resolve);
				} else {
					// The site's position has changed, move it around.
					this._moveSite(site, index, {unfreeze, callback: resolve});
				}
			}));
		}, this);

		if (callback) {
			Promise.all(batch).then(callback);
		}
	},

	/**
	   * Listens for the 'transitionend' event on a given node and calls the given
	   * callback.
	   * @param {HTMLElement} node The node that is transitioned.
	   * @param {string[]} properties The properties we'll wait to be transitioned.
	   * @param {() => void} callback The callback to call when finished.
	   */
	_whenTransitionEnded(node, properties, callback) {
		let props = new Set(properties);
		node.addEventListener('transitionend', function onEnd(e) {
			if (props.has(e.propertyName)) {
				node.removeEventListener('transitionend', onEnd);
				callback();
			}
		});
	},

	/**
	   * Gets a given node's opacity value.
	   * @param {Element} node The node to get the opacity value from.
	   * @return {string} The node's opacity value.
	   */
	_getNodeOpacity(node) {
		let cstyle = window.getComputedStyle(node);
		return cstyle.getPropertyValue('opacity');
	},

	/**
	   * Sets a given node's opacity.
	   * @param {HTMLElement} node The node to set the opacity value for.
	   * @param {number} opacity The opacity value to set.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	_setNodeOpacity(node, opacity, callback) {
		// The DOM setter for `style.opacity` (like `setProperty`) coerces a
		// non-string value to a string itself at the WebIDL boundary — casting
		// through `unknown` here documents that instead of inserting a
		// `String(...)` call that would (redundantly) do it a second time.
		if (this._getNodeOpacity(node) == /** @type {unknown} */ (opacity)) {
			if (callback) {
				callback();
			}
		} else {
			if (callback) {
				this._whenTransitionEnded(node, ['opacity'], callback);
			}

			node.style.opacity = /** @type {string} */ (/** @type {unknown} */ (opacity));
		}
	},

	/**
	   * Moves a site to the cell with the given index.
	   * @param {Site} site The site to move.
	   * @param {number} index The target cell's index.
	   * @param {{unfreeze?: boolean, callback?: () => void}} [options] Options that are directly passed to slideSiteTo().
	   */
	_moveSite(site, index, options) {
		this.freezeSitePosition(site);
		requestAnimationFrame(function() {
			// Do this at the end of the event loop to ensure a CSS change happens.
			Transformation.slideSiteTo(site, Grid.cells[index], options);
		});
	},

	/**
	   * Checks whether a site is currently frozen.
	   * @param {Site} site The site to check.
	   * @return {boolean} Whether the given site is frozen.
	   */
	_isFrozen(site) {
		return site.node.hasAttribute('frozen');
	}
};

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

/**
 * This singleton represents the grid that contains all sites.
 */
export var Grid = {
	/**
	   * The DOM node of the grid.
	   * @type {HTMLElement | null}
	   */
	_node: null,
	get node() { return /** @type {HTMLElement} */ (this._node); },

	/**
	   * The cached DOM fragment for sites.
	   * @type {Element | null}
	   */
	_siteFragment: null,

	/**
	   * All cells contained in the grid.
	   * @type {Cell[] | null}
	   */
	_cells: null,
	get cells() { return /** @type {Cell[]} */ (this._cells); },

	/**
	   * All sites contained in the grid's cells. Sites may be empty.
	   */
	get sites() { return this.cells.map(cell => cell.site); },

	// Tells whether the grid has already been initialized.
	get ready() { return !!this._node; },

	/**
	   * Initializes the grid.
	   */
	init() {
		this._node = document.getElementById('newtab-grid');
		this._createSiteFragment();
		this._render();
	},

	/**
	   * Creates a new site in the grid.
	   * @param {Link} link The new site's link.
	   * @param {Cell} cell The cell that will contain the new site.
	   * @return {Site} The newly created site.
	   */
	createSite(link, cell) {
		let node = cell.node;
		node.appendChild(/** @type {Element} */ (this._siteFragment).cloneNode(true));
		return new Site(/** @type {Element} */ (node.firstElementChild), link);
	},

	/**
	   * Refreshes the grid and re-creates all sites.
	   * @return {Promise<void>}
	   */
	refresh() {
		// Remove all sites.
		this.cells.forEach(function(cell) {
			let node = cell.node;
			let child = node.firstElementChild;

			if (child) {
				node.removeChild(child);
			}
		}, this);

		// Render the grid again.
		return this._render();
	},

	/**
	   * Locks the grid to block all pointer events.
	   */
	lock() {
		this.node.setAttribute('locked', 'true');
	},

	/**
	   * Unlocks the grid to allow all pointer events.
	   */
	unlock() {
		this.node.removeAttribute('locked');
	},

	/**
	   * Creates the newtab grid as a flat list of cells (CSS Grid handles rows).
	   */
	_renderGrid() {
		let cell = el('div', 'newtab-cell');

		/** @type {HTMLElement} */ (this._node).innerHTML = '';
		// `setProperty`'s WebIDL binding coerces a non-string value itself;
		// casting through `unknown` documents that instead of inserting a
		// `String(...)` call that would (redundantly) do it a second time.
		/** @type {HTMLElement} */ (this._node).style.setProperty('--ntt-cols', /** @type {string} */ (/** @type {unknown} */ (Prefs.columns)));
		/** @type {HTMLElement} */ (this._node).style.setProperty('--ntt-rows', /** @type {string} */ (/** @type {unknown} */ (Prefs.rows)));

		let total = Prefs.rows * Prefs.columns;
		for (let i = 0; i < total; i++) {
			/** @type {HTMLElement} */ (this._node).appendChild(/** @type {Node} */ (cell.cloneNode(true)));
		}

		let cellElements = this.node.querySelectorAll('.newtab-cell');
		this._cells = [...cellElements].map(cellEl => new Cell(this, cellEl));

		requestAnimationFrame(this.cacheCellPositions);
	},

	cacheCellPositions() {
		if (!Grid.cells || Grid.cells.length === 0) {
			return;
		}
		for (let c of Grid.cells) {
			c.position = Transformation.getNodePosition(c.node);
		}

		let firstCell = Grid.cells[0].node;
		let size = Math.max(firstCell.offsetWidth, firstCell.offsetHeight, 150) * 2;
		if (size != Prefs.thumbnailSize) {
			Prefs.thumbnailSize = size;
		}
	},

	/**
	   * Creates the DOM fragment that is re-used when creating sites.
	   */
	_createSiteFragment() {
		let template = /** @type {HTMLTemplateElement} */ (document.getElementById('newtab-site'));
		this._siteFragment = /** @type {Element} */ (/** @type {Element} */ (template.content.firstElementChild).cloneNode(true));
	},

	/**
	   * Renders the sites, creates all sites and puts them into their cells.
	   * @return {Promise<void>}
	   */
	_renderSites() {
		let cells = this.cells;

		// Put sites into the cells.
		return Tiles.getAllTiles().then(links => {
			let length = Math.min(links.length, cells.length);

			for (let i = 0; i < length; i++) {
				let link = links[i];
				if (link) {
					this.createSite(link, cells[i]);
				}
			}
		}).then(function() {
			newTabTools.getThumbnails();
		}, function() {
			console.error('Failed to get tiles');
			newTabTools.page.style.display = 'none';

			let list = /** @type {HTMLElement} */ (newTabTools.databaseError.querySelector('ul'));

			let message = newTabTools.getString('database_error_cookies', '$1').split('$1');
			let item = document.createElement('li');
			let code = el('code', undefined, chrome.runtime.getURL(''));
			item.appendChild(document.createTextNode(message[0]));
			item.appendChild(code);
			item.appendChild(document.createTextNode(message[1]));
			list.appendChild(item);

			message = newTabTools.getString('database_error_indexeddb').split('`');
			item = document.createElement('li');
			while (message.length) {
				let next = message.shift();
				item.appendChild(document.createTextNode(/** @type {string} */ (next)));

				next = message.shift();
				if (next) {
					code = el('code', undefined, next);
					item.appendChild(code);
				}
			}
			list.appendChild(item);

			newTabTools.databaseError.style.display = 'block';
		});
	},

	/**
	   * Renders the grid.
	   * @return {Promise<void>}
	   */
	_render() {
		if (this._shouldRenderGrid()) {
			this._renderGrid();
		}

		return this._renderSites();
	},

	_shouldRenderGrid() {
		let cellsLength = /** @type {HTMLElement} */ (this._node).querySelectorAll('.newtab-cell').length;
		return cellsLength != (Prefs.rows * Prefs.columns);
	}
};

/**
 * This class manages a cell's DOM node (not the actually cell content, a site).
 * It's mostly read-only, i.e. all manipulation of both position and content
 * aren't handled here.
 * @constructor
 * @param {typeof Grid} grid
 * @param {Element} node
 * @this {Cell}
 */
function Cell(grid, node) {
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
	   * @type {typeof Grid | null}
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
		let index = /** @type {typeof Grid} */ (this._grid).cells.indexOf(this);

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

// Fallback glyph for tiles/recent-cards with no thumbnail or favicon. This is
// deliberately a SINGLE uppercase letter (the host's first character), matching
// how Firefox and Chrome render fallback favicons. Multi-letter initials were
// considered for the v2 redesign and declined: deriving good 2-letter initials
// from a bare domain is heuristic and reads worse than one strong letter. Keep
// it single-letter — `.ntt-logo-glyph` is sized for exactly one character.
/**
 * @param {string} url
 * @returns {string}
 */
function siteGlyph(url) {
	try {
		let hostname = new URL(url).hostname.replace(/^www\./, '');
		return hostname.charAt(0).toUpperCase();
	} catch (ex) {
		return '·';
	}
}

/**
 * Deterministic hue (0-359) derived from a URL's hostname. Same host always
 * maps to the same hue. Falls back to null when the URL can't be parsed.
 *
 * Used by `Site._renderLogoFallback` so each domain-letter fallback tile
 * gets a distinct brand color instead of a uniform grey.
 * @param {string} url
 * @returns {number | null}
 */
function siteHue(url) {
	let host;
	try {
		host = new URL(url).hostname.replace(/^www\./, '');
	} catch (ex) {
		return null;
	}
	if (!host) {
		return null;
	}
	let h = 0;
	for (let i = 0; i < host.length; i++) {
		h = ((h * 31) + host.charCodeAt(i)) | 0;
	}
	return ((h % 360) + 360) % 360;
}

/**
 * Resolve a CSS brand color for a tile's fallback rendering. Order of
 * precedence:
 *   1. `link.backgroundColor` if the user set one explicitly (validated as
 *      a hex color).
 *   2. Domain-hash → hsl(...) so each hostname gets a stable distinct tone.
 *   3. `#666` neutral grey if the URL can't be parsed.
 * @param {Link} [link]
 * @returns {string}
 */
function siteBrandColor(link) {
	let raw = link && link.backgroundColor;
	if (raw && /^#[0-9a-f]{3,8}$/i.test(raw)) {
		return raw;
	}
	let hue = link ? siteHue(link.url) : null;
	if (hue == null) {
		return '#666';
	}
	// OKLCH instead of HSL: perceptually-uniform lightness/chroma across
	// hues, so white glyph text on the surround has consistent contrast no
	// matter which hostname hashed to which hue.
	return `oklch(65% 0.13 ${hue})`;
}

/**
 * This class represents a site that is contained in a cell and can be pinned,
 * moved around or deleted.
 * @constructor
 * @param {Element} node
 * @param {Link} link
 * @this {Site}
 */
export function Site(node, link) {
	this._node = /** @type {SiteNode} */ (node);
	this._node._newtabSite = this;

	this._link = link;

	this._render();
	this._addEventHandlers();
}

Site.prototype = {
	/**
	   * The site's DOM node.
	   * @this {Site}
	   */
	get node() { return this._node; },

	/**
	   * The site's link.
	   * @this {Site}
	   */
	get link() { return this._link; },

	/**
	   * The url of the site's link.
	   * @this {Site}
	   */
	get url() { return this.link.url; },

	/**
	   * The title of the site's link.
	   * @this {Site}
	   */
	get title() { return this.link.title; },

	/**
	   * The site's parent cell.
	   * @this {Site}
	   */
	get cell() {
		let parentNode = /** @type {CellNode | null} */ (this.node.parentNode);
		return parentNode && parentNode._newtabCell;
	},

	/** @this {Site} */
	get thumbnail() {
		return /** @type {HTMLElement} */ (this._querySelector('.newtab-thumbnail'));
	},

	/** @this {Site} */
	get overlay() {
		return this._querySelector('.ntt-overlay');
	},

	/**
	   * Pins the site on its current or a given index.
	   * @param {number} [index] The pinned index (optional).
	   */
	pin(index) {
		if (typeof index == 'undefined') {
			index = /** @type {Cell} */ (this.cell).index;
		}

		this.updateAttributes(true);
		this._link.position = index;
		Tiles.putTile(this._link);
	},

	/**
	   * Unpins the site and calls the given callback when done.
	   */
	unpin() {
		if (this.isPinned) {
			this.updateAttributes(false);

			let op;
			if (Object.keys(this._link).some(k => !['id', 'title', 'url', 'position'].includes(k))) {
				delete this._link.position;
				op = Tiles.putTile(this._link);
			} else {
				op = Tiles.removeTile(this._link).then(() => {
					delete this._link.id;
					delete this._link.position;
				});
			}

			op.then(() => {
				Updater.updateGrid();
			});
		}
	},

	/**
	   * Checks whether this site is pinned.
	   * @return {boolean} Whether this site is pinned.
	   * @this {Site}
	   */
	get isPinned() {
		return Tiles.isPinned(this._link.url);
	},

	/**
	   * Blocks the site (removes it from the grid) and calls the given callback
	   * when done.
	   * @returns {Promise<void>}
	   */
	async block() {
		if (!Blocked.isBlocked(this._link.url)) {
			UndoDialog.show(this);
			await Blocked.block(this._link.url);

			if (this.isPinned) {
				await Tiles.removeTile(this._link);
			}

			Updater.updateGrid();
		}
	},

	/**
	   * Gets the DOM node specified by the given query selector.
	   * @param {string} selector The query selector.
	   * @return {Element | null} The DOM node we found.
	   */
	_querySelector(selector) {
		return this.node.querySelector(selector);
	},

	/**
	   * Updates attributes for all nodes which status depends on this site being
	   * pinned or unpinned.
	   * @param {boolean} pinned Whether this site is now pinned or unpinned.
	   */
	updateAttributes(pinned) {
		if (pinned) {
			this._node.setAttribute('pinned', 'true');
		} else {
			this._node.removeAttribute('pinned');
		}
		let pinBtn = this._querySelector('.ntt-action-btn[data-action="pin"]');
		if (pinBtn) {
			pinBtn.setAttribute('title', newTabTools.getString(pinned ? 'tile_unpin' : 'tile_pin'));
			// Swap the SVG icon to match the new state so the affordance
			// flips immediately on toggle. Lucide-style `pin-off` (diagonal
			// slash) reads as "click to unpin".
			let nextIcon = pinned ? 'unpin' : 'pin';
			pinBtn.setAttribute('data-icon', nextIcon);
			let existing = pinBtn.firstElementChild;
			let svg = NttIcons.create(nextIcon, 16);
			if (svg) {
				if (existing) {
					pinBtn.replaceChild(svg, existing);
				} else {
					pinBtn.appendChild(svg);
				}
			}
		}
	},

	/**
	 * Flips the never-capture button icon/title and toggles the node attribute
	 * to match the new listed state. Modeled on updateAttributes (pin swap).
	 * @param {boolean} listed Whether the site is now in the never-capture list.
	 */
	updateNeverCaptureButton(listed) {
		if (listed) {
			this._node.setAttribute('never-capture', 'true');
		} else {
			this._node.removeAttribute('never-capture');
		}
		let btn = this._querySelector('.ntt-action-btn[data-action="never-capture"]');
		if (btn) {
			let nextIcon = listed ? 'camera' : 'camera-off';
			let nextTitle = listed ? 'tile_allow_capture' : 'tile_never_capture';
			btn.setAttribute('data-icon', nextIcon);
			btn.setAttribute('title', newTabTools.getString(nextTitle));
			let existing = btn.firstElementChild;
			let svg = NttIcons.create(nextIcon, 16);
			if (svg) {
				if (existing) {
					btn.replaceChild(svg, existing);
				} else {
					btn.appendChild(svg);
				}
			}
		}
	},

	/**
	   * Renders the site's data (fills the HTML fragment).
	   */
	_render() {
		if (this.isPinned) {
			this.updateAttributes(true);
		}
		this.refreshThumbnail();
		this.addTitle();
		this._renderActions();
		this._renderFavicon();
		this._renderStatChip();
	},

	_renderStatChip() {
		let chip = this._querySelector('.ntt-stat-chip');
		if (!chip) {
			return;
		}
		let statType = Prefs.statType;
		if (statType === 'none') {
			chip.textContent = '';
			chip.removeAttribute('data-stat-fresh');
			return;
		}
		let rank = this.cell ? this.cell.index + 1 : null;
		TileStats.compute(this.url, statType, /** @type {number} */ (rank)).then((/** @type {{type: string, value: string, dir?: string} | null} */ stat) => {
			if (!stat) {
				chip.textContent = '';
				chip.removeAttribute('data-stat-fresh');
				return;
			}
			if (stat.type === 'trend') {
				chip.removeAttribute('data-stat-fresh');
				chip.textContent = (stat.dir === 'up' ? '↑' : '↓') + stat.value;
			} else if (stat.type === 'rank') {
				chip.removeAttribute('data-stat-fresh');
				chip.textContent = '#' + stat.value;
			} else if (stat.type === 'fresh') {
				chip.textContent = '';
				chip.setAttribute('data-stat-fresh', '');
			} else {
				chip.removeAttribute('data-stat-fresh');
				chip.textContent = stat.value;
			}
		});
	},

	addTitle() {
		let url = this.url;
		let title = this.title || url;
		let tooltip = title == url ? title : title + '\n' + url;

		let titleElement = /** @type {HTMLElement} */ (this.node.querySelector('.newtab-title'));
		titleElement.textContent = title;

		let link = /** @type {HTMLAnchorElement} */ (this._querySelector('.newtab-link'));
		link.setAttribute('title', tooltip);
		try {
			if (['http:', 'https:', 'ftp:'].includes(new URL(url).protocol)) {
				link.setAttribute('href', url);
			} else {
				link.setAttribute('href', '#');
			}
		} catch (ex) {
			link.setAttribute('href', '#');
		}
	},

	_renderFavicon() {
		let favicon = /** @type {HTMLElement} */ (this._querySelector('.ntt-favicon'));
		if (!favicon) {
			return;
		}
		let rawColor = this.link.backgroundColor || '#666';
		let brandColor = /^#[0-9a-f]{3,8}$/i.test(rawColor) ? rawColor : '#666';
		favicon.style.backgroundColor = brandColor;
		favicon.textContent = siteGlyph(this.url);
	},

	_renderActions() {
		let container = this._querySelector('.ntt-actions');
		if (!container || container.children.length > 0) {
			return;
		}
		// At-rest affordance: a single kebab that the hover row replaces (§3c).
		let kebab = this._querySelector('.ntt-actions-kebab');
		if (kebab && kebab.children.length === 0) {
			let kebabIcon = NttIcons.create('kebab', 16);
			if (kebabIcon) {
				kebab.appendChild(kebabIcon);
			}
		}
		// Edit-mode affordances (§2): a centred drag handle (shown on pinned tiles
		// while editing) and an "Add tile" prompt (shown on auto tiles while
		// editing). CSS keeps both hidden outside edit mode (`:root[drawer-open]`).
		let dragHandle = this._querySelector('.ntt-drag-handle');
		if (dragHandle && dragHandle.children.length === 0) {
			let grip = NttIcons.create('grip', 18);
			if (grip) {
				dragHandle.appendChild(grip);
			}
		}
		let addTile = this._querySelector('.ntt-add-tile');
		if (addTile && !addTile.querySelector('.ntt-add-tile-chip')) {
			// The label is an opaque chip so it reads over any thumbnail (the slot
			// keeps its real thumbnail under a light scrim — no opacity dim).
			let chip = el('span', 'ntt-add-tile-chip', newTabTools.getString('tile_add'));
			addTile.textContent = '';
			addTile.appendChild(chip);
		}
		// §3c order: Edit URL · Never-capture · Pin/Unpin · Remove. "Open in new tab"
		// was dropped — clicking the tile already opens it (middle-/⌘-click for
		// a new tab).
		let neverCaptureActive = NeverCapture.matches(this.url);
		if (neverCaptureActive) {
			this._node.setAttribute('never-capture', 'true');
		} else {
			this._node.removeAttribute('never-capture');
		}
		let actions = [
			{ action: 'edit', icon: 'edit', title: 'tile_edit_url' },
			{ action: 'never-capture', icon: neverCaptureActive ? 'camera' : 'camera-off', title: neverCaptureActive ? 'tile_allow_capture' : 'tile_never_capture' },
			{ action: 'pin', icon: this.isPinned ? 'unpin' : 'pin', title: this.isPinned ? 'tile_unpin' : 'tile_pin' },
			{ action: 'remove', icon: 'close', title: 'tile_block' },
		];

		for (let def of actions) {
			let btn = el('button', 'ntt-action-btn');
			btn.setAttribute('type', 'button');
			btn.setAttribute('data-action', def.action);
			btn.setAttribute('data-icon', def.icon);
			btn.setAttribute('title', newTabTools.getString(def.title));
			let icon = NttIcons.create(def.icon, 16);
			if (icon) {
				btn.appendChild(icon);
			}
			container.appendChild(btn);
		}
	},

	refreshThumbnail() {
		let thumbnail = this.thumbnail;
		if (this.link.image) {
			if (this._thumbnailObjectURL) {
				URL.revokeObjectURL(this._thumbnailObjectURL);
			}
			let thumbnailURL = URL.createObjectURL(this.link.image);
			this._thumbnailObjectURL = thumbnailURL;
			thumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			// `style.backgroundColor`'s setter is `[LegacyNullToEmptyString]`,
			// so assigning `null` behaves like `''` at the DOM level — but the
			// cast preserves the original `null` value at the JS-level
			// assignment rather than substituting a different literal.
			thumbnail.style.backgroundColor = /** @type {string} */ (/** @type {unknown} */ (this.link.backgroundColor || null));
			if (this.link.imageIsThumbnail) {
				thumbnail.classList.remove('custom-thumbnail');
			} else {
				thumbnail.classList.add('custom-thumbnail');
			}
			let fallback = thumbnail.querySelector('.ntt-logo-fallback');
			if (fallback) {
				fallback.remove();
			}
		} else {
			thumbnail.style.backgroundImage = /** @type {string} */ (/** @type {unknown} */ (null));
			thumbnail.classList.remove('custom-thumbnail');
			this._renderLogoFallback();
		}
	},

	_renderLogoFallback() {
		let thumbnail = this.thumbnail;
		if (thumbnail.querySelector('.ntt-logo-fallback')) {
			return;
		}
		let brandColor = siteBrandColor(this.link);

		let fallback = el('div', 'ntt-logo-fallback');
		fallback.style.setProperty('--ntt-brand', brandColor);

		let glyphEl = el('div', 'ntt-logo-glyph', siteGlyph(this.url));
		fallback.appendChild(glyphEl);

		thumbnail.appendChild(fallback);
	},

	/**
	 * Swap the letter glyph inside the existing logo-fallback for a real
	 * favicon `<img>`. Called from `newTabTools.getFavicons` once the
	 * background returns a favicon for this site's URL — either a cached
	 * `data:`-favicon Blob (turned into an object URL) or a remote favicon URL
	 * string (used directly as the `<img src>`, governed by `img-src https:`,
	 * no fetch). Safe to call even if the fallback has since been replaced by a
	 * screenshot — guards on the glyph element's presence.
	 * @param {Blob | string | null | undefined} favicon
	 */
	applyFavicon(favicon) {
		if (!favicon) {
			return;
		}
		// Two render targets: the big centred glyph that shows only when no
		// screenshot has been captured yet (`.ntt-logo-fallback`), and the
		// small badge in the bottom overlay that's always present
		// (`.ntt-favicon`). Updating both means the captured favicon is
		// visible even after a screenshot has covered the fallback.
		let fallback = this._querySelector('.ntt-logo-fallback');
		let badge = this._querySelector('.ntt-favicon');
		if (!fallback && !badge) {
			return;
		}
		// A Blob (cached data: favicon) becomes an object URL we own + revoke;
		// a string is a remote favicon URL we point <img> at directly.
		let src;
		if (typeof favicon === 'string') {
			src = favicon;
		} else {
			if (this._faviconObjectURL) {
				URL.revokeObjectURL(this._faviconObjectURL);
			}
			this._faviconObjectURL = URL.createObjectURL(favicon);
			src = this._faviconObjectURL;
		}

		if (fallback) {
			let glyph = fallback.querySelector('.ntt-logo-glyph');
			if (glyph) {
				let img = /** @type {HTMLImageElement} */ (el('img', 'ntt-logo-favicon'));
				img.src = src;
				img.alt = '';
				fallback.replaceChild(img, glyph);
			}
		}
		if (badge) {
			badge.textContent = '';
			/** @type {HTMLElement} */ (badge).style.backgroundColor = '#fff';
			let img = document.createElement('img');
			img.src = src;
			img.alt = '';
			badge.appendChild(img);
		}
	},

	/**
	   * Adds event handlers for the site and its buttons.
	   */
	_addEventHandlers() {
		// Register drag-and-drop event handlers.
		this._node.addEventListener('dragstart', this);
		this._node.addEventListener('dragend', this);
		this._node.addEventListener('click', this);
	},

	/**
	   * Handles site click events.
	   * @param {MouseEvent} event
	   */
	_onClick(event) {
		let target = /** @type {Element} */ (event.target);
		let actionBtn = target.closest('.ntt-action-btn');
		if (actionBtn) {
			event.preventDefault();
			let action = actionBtn.getAttribute('data-action');
			switch (action) {
			case 'remove':
				this.block().catch(e => console.error('Site.block failed:', e));
				break;
			case 'pin':
				if (this.isPinned) {
					this.unpin();
				} else {
					this.pin();
				}
				break;
			case 'never-capture': {
				// Derive host (port-less, matching NeverCapture semantics); bail
				// silently on non-parseable URLs.
				let host;
				try {
					host = new URL(this.link.url).hostname;
				} catch (_) {
					break;
				}
				if (NeverCapture.matches(this.link.url)) {
					// Currently listed — remove and flip button back.
					NeverCapture.remove(host);
					this.updateNeverCaptureButton(false);
				} else {
					// Not listed — add, purge stored screenshots, flip button.
					// No undo toast by design: purged screenshots must not be
					// restorable; toggle-off does not recapture (next visit does).
					NeverCapture.add(host);
					chrome.runtime.sendMessage({ name: 'Thumbnails.purgeHost', host }, () => {
						Grid.refresh().then(() => newTabTools.getThumbnails());
					});
					this.updateNeverCaptureButton(true);
				}
				break;
			}
			case 'edit':
				newTabTools.openDrawer();
				newTabTools.switchDrawerTab('tile');
				if (this.cell) {
					newTabTools.selectedSiteIndex = this.cell.index;
				}
				break;
			}
			return;
		}

		// "+ Pin tile" (§7): clicking a candidate's add-tile slot pins it
		// immediately (same effect as the Pin action) AND opens the Add-tile (Tile)
		// menu with the now-pinned tile selected — so label and behaviour agree.
		if (target.closest('.ntt-add-tile')) {
			event.preventDefault();
			let cellIndex = this.cell ? this.cell.index : null;
			if (!this.isPinned) {
				this.pin();
			}
			newTabTools.openDrawer();
			newTabTools.switchDrawerTab('tile');
			if (cellIndex != null) {
				newTabTools.selectedSiteIndex = cellIndex;
			}
			return;
		}

		// Edit mode: clicking a tile body (anywhere but an action button / the
		// "+ Pin tile" slot, both handled above) opens the Tile dialog PREFILLED for
		// this tile — so the user can edit its URL, thumbnail, or background colour.
		// Works from any drawer tab (not just the Tile tab); drag-to-Move is separate
		// (the drag handler distinguishes a click from a drag).
		let docEl = document.documentElement;
		if (docEl.hasAttribute('drawer-open')) {
			event.preventDefault();
			if (this.cell) {
				newTabTools.openDrawer();
				newTabTools.switchDrawerTab('tile');
				newTabTools.selectedSiteIndex = this.cell.index;
			}
			return;
		}

		if (target.classList.contains('newtab-link') ||
		target.closest('.newtab-link') ||
		target.closest('.ntt-overlay')) {
			return;
		}
	},

	/**
	   * Handles all site events.
	   * @param {MouseEvent | DragEvent} event
	   */
	handleEvent(event) {
		switch (event.type) {
		case 'click':
			this._onClick(event);
			break;
		case 'dragstart':
			if (Prefs.locked) {
				event.preventDefault();
			} else {
				Drag.start(this, /** @type {DragEvent} */ (event));
			}
			break;
		case 'dragend':
			Drag.end(this, /** @type {DragEvent} */ (event));
			break;
		}
	}
};

/**
 * This singleton implements site dragging functionality.
 */
export var Drag = {
	/**
	   * The site offset to the drag start point.
	   * @type {number | null}
	   */
	_offsetX: null,
	/** @type {number | null} */
	_offsetY: null,

	/**
	   * The site that is dragged.
	   * @type {Site | null}
	   */
	_draggedSite: null,
	get draggedSite() { return this._draggedSite; },

	/**
	   * The cell width/height at the point the drag started.
	   * @type {number | null}
	   */
	_cellWidth: null,
	/** @type {number | null} */
	_cellHeight: null,
	get cellWidth() { return /** @type {number} */ (this._cellWidth); },
	get cellHeight() { return /** @type {number} */ (this._cellHeight); },

	/**
	   * The drag image's current position, set by `drag()` and read by
	   * `DropTargetShim._findDropTarget`.
	   * @type {number | undefined}
	   */
	_cellLeft: undefined,
	/** @type {number | undefined} */
	_cellTop: undefined,

	/**
	   * Start a new drag operation.
	   * @param {Site} site The site that's being dragged.
	   * @param {DragEvent} event The 'dragstart' event.
	   */
	start(site, event) {
		this._draggedSite = site;

		// Refresh the cell position cache — it was last updated on init /
		// window resize, but the grid also shifts when the drawer opens or
		// closes (push-layout) and we never get a resize event for that.
		Grid.cacheCellPositions();

		// Mark nodes as being dragged.
		let selector = '.newtab-site, .ntt-actions, .newtab-thumbnail';
		let parentCell = /** @type {Element} */ (site.node.parentNode);
		let nodes = parentCell.querySelectorAll(selector);
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].setAttribute('dragged', 'true');
		}

		parentCell.setAttribute('dragged', 'true');

		this._setDragData(site, event);

		// Store the cursor offset.
		let node = site.node;
		let rect = node.getBoundingClientRect();
		let {offsetLeft, offsetTop} = /** @type {HTMLElement} */ (newTabTools.page.firstElementChild);
		this._offsetX = event.clientX - rect.left + offsetLeft;
		this._offsetY = event.clientY - rect.top + offsetTop;

		// Store the cell dimensions.
		let cellNode = /** @type {Cell} */ (site.cell).node;
		this._cellWidth = cellNode.offsetWidth;
		this._cellHeight = cellNode.offsetHeight;

		let style = site.node.style;
		style.width = this._cellWidth + 'px';
		style.height = this._cellHeight + 'px';
		site.node.setAttribute('frozen', 'true');
	},

	/**
	   * Handles the 'drag' event.
	   * @param {Site} site The site that's being dragged.
	   * @param {DragEvent} event The 'drag' event.
	   */
	drag(site, event) {
		// Get the viewport size.
		let {clientWidth, clientHeight} = document.documentElement;
		let {offsetLeft, offsetTop} = /** @type {HTMLElement} */ (newTabTools.page.firstElementChild);

		// We'll want a padding of 5px.
		let border = 5;

		// Enforce minimum constraints to keep the drag image inside the window.
		let left = Math.max(event.clientX - /** @type {number} */ (this._offsetX), border - offsetLeft);
		let top = Math.max(event.clientY - /** @type {number} */ (this._offsetY), border - offsetTop);

		// Enforce maximum constraints to keep the drag image inside the window.
		left = Math.min(left, clientWidth - this.cellWidth - border - offsetLeft);
		top = Math.min(top, clientHeight - this.cellHeight - border - offsetTop);

		// Update the drag image's position.
		Transformation.setSitePosition(site, {left, top});
		this._cellLeft = left;
		this._cellTop = top;
	},

	/**
	   * Ends the current drag operation.
	   * @param {Site} site The site that's being dragged.
	   * @param {DragEvent} [_event] The 'dragend' event — unused (also true
	   *   of the pre-typing code: the original JSDoc documented an `event`
	   *   param the function never actually declared); declared here to
	   *   match the real call contract (`Site.handleEvent` always passes it)
	   *   rather than narrowed to 1 argument.
	   */
	end(site, _event) {
		void _event;
		let nodes = Grid.node.querySelectorAll('[dragged]');
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].removeAttribute('dragged');
		}

		// Slide the dragged site back into its cell if it didn't move.
		// Transformation_rearrangeSites will fix it if it did move.
		if (!Drop._lastDropTarget || Drop._lastDropTarget.index === /** @type {Cell} */ (site.cell).index) {
			Transformation.slideSiteTo(site, /** @type {Cell} */ (site.cell), {unfreeze: true});
		}

		Drop._lastDropTarget = null;
		this._draggedSite = null;
	},

	/**
	   * Initializes the drag data for the current drag operation.
	   * @param {Site} site The site that's being dragged.
	   * @param {DragEvent} event The 'dragstart' event.
	   */
	_setDragData(site, event) {
		let {url, title} = site;

		let dt = /** @type {DataTransfer} */ (event.dataTransfer);
		let dtAny = /** @type {DataTransfer & {mozCursor?: string}} */ (dt);
		dtAny.mozCursor = 'default';
		dt.effectAllowed = 'move';
		dt.setData('text/plain', url);
		dt.setData('text/uri-list', url);
		dt.setData('text/x-moz-url', url + '\n' + title);
		if (url.includes('"') && url.includes('<')) {
			url = url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
		dt.setData('text/html', '<a href="' + url + '">' + url + '</a>');

		// Create and use an empty drag element. We don't want to use the default
		// drag image with its default opacity.
		let dragElement = el('div', 'newtab-drag');
		let scrollbox = /** @type {Element} */ (document.getElementById('newtab-scrollbox'));
		scrollbox.appendChild(dragElement);
		dt.setDragImage(dragElement, 0, 0);

		// After the 'dragstart' event has been processed we can remove the
		// temporary drag element from the DOM.
		setTimeout(function() { scrollbox.removeChild(dragElement); }, 0);
	}
};

// A little delay that prevents the grid from being too sensitive when dragging
// sites around.
const DELAY_REARRANGE_MS = 100;

/**
 * This singleton implements site dropping functionality.
 */
export var Drop = {
	/**
	   * The last drop target.
	   * @type {Cell | null}
	   */
	_lastDropTarget: null,

	/** @type {ReturnType<typeof setTimeout> | null} */
	_rearrangeTimeout: null,

	/**
	   * Handles the 'dragenter' event.
	   * @param {Cell} cell The drop target cell.
	   * @param {DragEvent} [_event] The 'dragenter' event — unused; every real
	   *   call site (`Cell.handleEvent`) passes it, so it's declared here to
	   *   match the actual call contract rather than narrowed to 1 argument.
	   */
	enter(cell, _event) {
		void _event;
		this._delayedRearrange(cell);
	},

	/**
	   * Handles the 'dragexit' event.
	   * @param {Cell} cell The drop target cell.
	   * @param {DragEvent} event The 'dragexit' event.
	   */
	exit(cell, event) {
		let dtAny = /** @type {(DataTransfer & {mozUserCancelled?: boolean}) | null} */ (event.dataTransfer);
		if (dtAny && !dtAny.mozUserCancelled) {
			this._delayedRearrange();
		} else {
			// The drag operation has been cancelled.
			this._cancelDelayedArrange();
			this._rearrange();
		}
	},

	/**
	   * Handles the 'drop' event.
	   * @param {Cell} cell The drop target cell.
	   * @param {DragEvent} [_event] The 'drop' event — unused; every real call
	   *   site (`Cell.handleEvent`) passes it, so it's declared here to match
	   *   the actual call contract rather than narrowed to 1 argument.
	   */
	drop(cell, _event) {
		void _event;
		// The cell that is the drop target could contain a pinned site. We need
		// to find out where that site has gone and re-pin it there.
		if (cell.containsPinnedSite()) {
			this._repinSitesAfterDrop(cell);
		}

		// Pin the dragged or insert the new site.
		this._pinDraggedSite(cell);

		this._cancelDelayedArrange();

		// Update the grid and move all sites to their new places.
		Updater.updateGrid();
	},

	/**
	   * Re-pins all pinned sites in their (new) positions.
	   * @param {Cell} cell The drop target cell.
	   */
	_repinSitesAfterDrop(cell) {
		let sites = DropPreview.rearrange(cell);

		// Filter out pinned sites.
		let pinnedSites = sites.filter(function(site) {
			return site && site.isPinned;
		});

		// Re-pin all shifted pinned cells.
		pinnedSites.forEach(function(site) { /** @type {Site} */ (site).pin(sites.indexOf(site)); }, this);
	},

	/**
	   * Pins the dragged site in its new place.
	   * @param {Cell} cell The drop target cell.
	   */
	_pinDraggedSite(cell) {
		let index = cell.index;
		let draggedSite = Drag.draggedSite;

		if (draggedSite) {
			// Pin the dragged site at its new place.
			if (cell != draggedSite.cell) {
				draggedSite.pin(index);
			}
		}
	},

	/**
	   * Time a rearrange with a little delay.
	   * @param {Cell} [cell] The drop target cell.
	   */
	_delayedRearrange(cell) {
		// The last drop target didn't change so there's no need to re-arrange.
		if (this._lastDropTarget == cell) {
			return;
		}

		let self = this;

		function callback() {
			self._rearrangeTimeout = null;
			self._rearrange(cell);
		}

		this._cancelDelayedArrange();
		this._rearrangeTimeout = setTimeout(callback, DELAY_REARRANGE_MS);

		// Store the last drop target. (Cast, not a rewrite: `cell` is
		// optional/`undefined`-typed here, but the original assigned it
		// as-is — preserved via cast rather than substituting `null`.)
		this._lastDropTarget = /** @type {Cell | null} */ (cell);
	},

	/**
	   * Cancels a timed rearrange, if any.
	   */
	_cancelDelayedArrange() {
		if (this._rearrangeTimeout) {
			clearTimeout(this._rearrangeTimeout);
			this._rearrangeTimeout = null;
		}
	},

	/**
	   * Rearrange all sites in the grid depending on the current drop target.
	   * @param {Cell} [cell] The drop target cell.
	   */
	_rearrange(cell) {
		let sites = Grid.sites;

		// We need to rearrange the grid only if there's a current drop target.
		if (cell) {
			sites = DropPreview.rearrange(cell);
		}

		Transformation.rearrangeSites(sites, {unfreeze: !cell});
	}
};

/**
 * This singleton provides a custom drop target detection. We need this because
 * the default DnD target detection relies on the cursor's position. We want
 * to pick a drop target based on the dragged site's position.
 */
var DropTargetShim = {
	/**
	   * Cache for the position of all cells, cleaned after drag finished.
	   * @type {Array<{cell: Cell, rect: NttRect}> | null}
	   */
	_cellPositions: null,

	/**
	   * The last drop target that was hovered.
	   * @type {Cell | null}
	   */
	_lastDropTarget: null,

	/**
	   * Initializes the drop target shim.
	   */
	init() {
		Grid.node.addEventListener('dragstart', this, true);
	},

	/**
	   * Add all event listeners needed during a drag operation.
	   */
	_addEventListeners() {
		Grid.node.addEventListener('dragend', this);

		let docElement = document.documentElement;
		docElement.addEventListener('dragover', this);
		docElement.addEventListener('dragenter', this);
		docElement.addEventListener('drop', this);
	},

	/**
	   * Remove all event listeners that were needed during a drag operation.
	   */
	_removeEventListeners() {
		Grid.node.removeEventListener('dragend', this);

		let docElement = document.documentElement;
		docElement.removeEventListener('dragover', this);
		docElement.removeEventListener('dragenter', this);
		docElement.removeEventListener('drop', this);
	},

	/**
	   * Handles all shim events.
	   * @param {DragEvent} event
	   */
	handleEvent(event) {
		if (Prefs.locked) {
			return;
		}

		switch (event.type) {
		case 'dragstart':
			this._dragstart(event);
			break;
		case 'dragenter':
			event.preventDefault();
			break;
		case 'dragover':
			this._dragover(event);
			break;
		case 'drop':
			this._drop(event);
			break;
		case 'dragend':
			this._dragend(event);
			break;
		}
	},

	/**
	   * Handles the 'dragstart' event.
	   * @param {DragEvent} event The 'dragstart' event.
	   */
	_dragstart(event) {
		if (/** @type {Element} */ (event.target).classList.contains('newtab-link')) {
			Grid.lock();
			this._addEventListeners();
		}
	},

	/**
	   * Handles the 'dragover' event.
	   * @param {DragEvent} event The 'dragover' event.
	   */
	_dragover(event) {
		// XXX bug 505521 - Use the dragover event to retrieve the
		//                  current mouse coordinates while dragging.
		let dt = /** @type {DataTransfer & {mozSourceNode?: Node}} */ (event.dataTransfer);
		let sourceNode = /** @type {SiteNode} */ (/** @type {Node} */ (dt.mozSourceNode).parentNode);
		Drag.drag(/** @type {Site} */ (sourceNode._newtabSite), event);

		// Find the current drop target, if there's one.
		this._updateDropTarget(event);

		// If we have a valid drop target,
		// let the drag-and-drop service know.
		if (this._lastDropTarget) {
			event.preventDefault();
		}
	},

	/**
	   * Handles the 'drop' event.
	   * @param {DragEvent} event The 'drop' event.
	   */
	_drop(event) {
		// We're accepting all drops.
		event.preventDefault();

		// Make sure to determine the current drop target
		// in case the dragover event hasn't been fired.
		this._updateDropTarget(event);

		// A site was successfully dropped. NOTE (chrome-prep C3b typing
		// finding, report-only): `_lastDropTarget` can genuinely be `null`
		// here (no cell found under the drop point) — `_dispatchEvent`
		// dereferences `target.node` unconditionally, so this is a
		// pre-existing possible-null-dereference the type system surfaces;
		// cast rather than silently adding a guard, per this slice's
		// no-behavior-change rule.
		this._dispatchEvent(event, 'drop', /** @type {Cell} */ (this._lastDropTarget));
	},

	/**
	   * Handles the 'dragend' event.
	   * @param {DragEvent} event The 'dragend' event.
	   */
	_dragend(event) {
		if (this._lastDropTarget) {
			let dtAny = /** @type {(DataTransfer & {mozUserCancelled?: boolean}) | null} */ (event.dataTransfer);
			if (dtAny && dtAny.mozUserCancelled) {
				// The drag operation was cancelled.
				this._dispatchEvent(event, 'dragexit', this._lastDropTarget);
				this._dispatchEvent(event, 'dragleave', this._lastDropTarget);
			}

			// Clean up.
			this._lastDropTarget = null;
			this._cellPositions = null;
		}

		Grid.unlock();
		this._removeEventListeners();
	},

	/**
	   * Tries to find the current drop target and will fire
	   * appropriate dragenter, dragexit, and dragleave events.
	   * @param {DragEvent} event The current drag event.
	   */
	_updateDropTarget(event) {
		// Let's see if we find a drop target.
		let target = this._findDropTarget();

		if (target != this._lastDropTarget) {
			if (this._lastDropTarget) { // We left the last drop target.
				this._dispatchEvent(event, 'dragexit', this._lastDropTarget);
			}
			if (target) { // We're now hovering a (new) drop target.
				this._dispatchEvent(event, 'dragenter', target);
			}
			if (this._lastDropTarget) { // We left the last drop target.
				this._dispatchEvent(event, 'dragleave', this._lastDropTarget);
			}
			this._lastDropTarget = target;
		}
	},

	/**
	   * Determines the current drop target by matching the dragged site's position
	   * against all cells in the grid.
	   * @return {Cell | null} The currently hovered drop target or null.
	   */
	_findDropTarget() {
		// These are the minimum intersection values - we want to use the cell if
		// the site is >= 50% hovering its position.
		let minWidth = Drag.cellWidth / 2;
		let minHeight = Drag.cellHeight / 2;

		let cellPositions = this._getCellPositions();
		let rect = /** @type {NttRect} */ (/** @type {unknown} */ (new DOMRect(Drag._cellLeft, Drag._cellTop, Drag.cellWidth, Drag.cellHeight)));

		// Compare each cell's position to the dragged site's position.
		for (let i = 0; i < cellPositions.length; i++) {
			let inter = rect.intersect(cellPositions[i].rect);

			// If the intersection is big enough we found a drop target.
			if (inter.width >= minWidth && inter.height >= minHeight) {
				return cellPositions[i].cell;
			}
		}

		// No drop target found.
		return null;
	},

	/**
	   * Gets the positions of all cell nodes.
	   * @return {Array<{cell: Cell, rect: NttRect}>} The (cached) cell positions.
	   */
	_getCellPositions() {
		if (this._cellPositions) {
			return this._cellPositions;
		}

		return this._cellPositions = Grid.cells.filter(function(cell) {
			return !cell.node.hasAttribute('dragged');
		}).map(function(cell) {
			return {cell, rect: /** @type {NttRect} */ (cell.position)};
		});
	},

	/**
	   * Dispatches a custom DragEvent on the given target node.
	   * @param {DragEvent} event The source event.
	   * @param {string} type The event type.
	   * @param {Cell} target The target node that receives the event.
	   */
	_dispatchEvent({dataTransfer}, type, target) {
		let node = target.node;
		let event = new DragEvent(type, {dataTransfer});
		node.dispatchEvent(event);
	}
};

/**
 * This singleton provides the ability to re-arrange the current grid to
 * indicate the transformation that results from dropping a cell at a certain
 * position.
 */
var DropPreview = {
	/**
	   * Rearranges the sites currently contained in the grid when a site would be
	   * dropped onto the given cell.
	   * @param {Cell} cell The drop target cell.
	   * @return {Array<Site | null | undefined>} The re-arranged array of sites.
	   */
	rearrange(cell) {
		let sites = Grid.sites;

		// Insert the dragged site into the current grid.
		this._insertDraggedSite(sites, cell);

		// After the new site has been inserted we need to correct the positions
		// of all pinned tabs that have been moved around.
		this._repositionPinnedSites(sites, cell);

		return sites;
	},

	/**
	   * Inserts the currently dragged site into the given array of sites.
	   * @param {Array<Site | null | undefined>} sites The array of sites to insert into.
	   * @param {Cell} cell The drop target cell.
	   */
	_insertDraggedSite(sites, cell) {
		let dropIndex = cell.index;
		let draggedSite = Drag.draggedSite;

		// We're currently dragging a site.
		if (draggedSite) {
			let dragCell = /** @type {Cell} */ (draggedSite.cell);
			let dragIndex = dragCell.index;

			// Move the dragged site into its new position.
			if (dragIndex != dropIndex) {
				sites.splice(dragIndex, 1);
				sites.splice(dropIndex, 0, draggedSite);
			}
			// We're handling an external drag item.
		} else {
			sites.splice(dropIndex, 0, null);
		}
	},

	/**
	   * Correct the position of all pinned sites that might have been moved to
	   * different positions after the dragged site has been inserted.
	   * @param {Array<Site | null | undefined>} sites The array of sites containing the dragged site.
	   * @param {Cell} cell The drop target cell.
	   */
	_repositionPinnedSites(sites, cell) {
		// Collect all pinned sites.
		let pinnedSites = this._filterPinnedSites(sites, cell);

		// Correct pinned site positions.
		pinnedSites.forEach(function(site) {
			let cellIndex = /** @type {Cell} */ (site.cell).index;
			sites[sites.indexOf(site)] = sites[cellIndex];
			sites[cellIndex] = site;
		}, this);

		// There might be a pinned cell that got pushed out of the grid, try to
		// sneak it in by removing a lower-priority cell.
		if (this._hasOverflowedPinnedSite(sites, cell)) {
			this._repositionOverflowedPinnedSite(sites, cell);
		}
	},

	/**
	   * Filter pinned sites out of the grid that are still on their old positions
	   * and have not moved.
	   * @param {Array<Site | null | undefined>} sites The array of sites to filter.
	   * @param {Cell} cell The drop target cell.
	   * @return {Site[]} The filtered array of sites.
	   */
	_filterPinnedSites(sites, cell) {
		let draggedSite = Drag.draggedSite;

		// When dropping on a cell that contains a pinned site make sure that all
		// pinned cells surrounding the drop target are moved as well.
		let range = this._getPinnedRange(cell);

		return /** @type {Site[]} */ (sites.filter(function(site) {
			// The site must be valid, pinned and not the dragged site.
			if (!site || site == draggedSite || !site.isPinned) {
				return false;
			}

			let index = /** @type {Cell} */ (site.cell).index;

			// If it's not in the 'pinned range' it's a valid pinned site.
			return (index > range.end || index < range.start);
		}));
	},

	/**
	   * Determines the range of pinned sites surrounding the drop target cell.
	   * @param {Cell} cell The drop target cell.
	   * @return {{start: number, end: number}} The range of pinned cells.
	   */
	_getPinnedRange(cell) {
		let dropIndex = cell.index;
		let range = {start: dropIndex, end: dropIndex};

		// We need a pinned range only when dropping on a pinned site.
		if (cell.containsPinnedSite()) {
			// let links = PinnedLinks.links;

			// Find all previous siblings of the drop target that are pinned as well.
			while (range.start && Grid.cells[range.start - 1].containsPinnedSite()) {
				range.start--;
			}

			let maxEnd = Grid.cells.length - 1;

			// Find all next siblings of the drop target that are pinned as well.
			while (range.end < maxEnd && Grid.cells[range.end + 1].containsPinnedSite()) {
				range.end++;
			}
		}

		return range;
	},

	/**
	   * Checks if the given array of sites contains a pinned site that has
	   * been pushed out of the grid.
	   * @param {Array<Site | null | undefined>} sites The array of sites to check.
	   * @param {Cell} cell The drop target cell.
	   * @return {boolean} Whether there is an overflowed pinned cell.
	   */
	_hasOverflowedPinnedSite(sites, cell) {
		// If the drop target isn't pinned there's no way a pinned site has been
		// pushed out of the grid so we can just exit here.
		if (!cell.containsPinnedSite()) {
			return false;
		}

		let cells = Grid.cells;

		// No cells have been pushed out of the grid, nothing to do here.
		if (sites.length <= cells.length) {
			return false;
		}

		let overflowedSite = sites[cells.length];

		// Nothing to do if the site that got pushed out of the grid is not pinned.
		// Cast, not a rewrite: preserves the original's fall-through to
		// `overflowedSite` itself when falsy, rather than a coerced `false`.
		return /** @type {boolean} */ (overflowedSite && overflowedSite.isPinned);
	},

	/**
	   * We have a overflowed pinned site that we need to re-position so that it's
	   * visible again. We try to find a lower-priority cell (empty or containing
	   * an unpinned site) that we can move it to.
	   * @param {Array<Site | null | undefined>} sites The array of sites.
	   * @param {Cell} cell The drop target cell.
	   */
	_repositionOverflowedPinnedSite(sites, cell) {
		// Try to find a lower-priority cell (empty or containing an unpinned site).
		let index = this._indexOfLowerPrioritySite(sites, cell);

		if (index > -1) {
			let cells = Grid.cells;
			let dropIndex = cell.index;

			// Move all pinned cells to their new positions to let the overflowed
			// site fit into the grid.
			for (let i = index + 1, lastPosition = index; i < sites.length; i++) {
				if (i != dropIndex) {
					sites[lastPosition] = sites[i];
					lastPosition = i;
				}
			}

			// Finally, remove the overflowed site from its previous position.
			sites.splice(cells.length, 1);
		}
	},

	/**
	   * Finds the index of the last cell that is empty or contains an unpinned
	   * site. These are considered to be of a lower priority.
	   * @param {Array<Site | null | undefined>} sites The array of sites.
	   * @param {Cell} cell The drop target cell.
	   * @return {number} The cell's index.
	   */
	_indexOfLowerPrioritySite(sites, cell) {
		let cells = Grid.cells;
		let dropIndex = cell.index;

		// Search (beginning with the last site in the grid) for a site that is
		// empty or unpinned (an thus lower-priority) and can be pushed out of the
		// grid instead of the pinned site.
		for (let i = cells.length - 1; i >= 0; i--) {
			// The cell that is our drop target is not a good choice.
			if (i == dropIndex) {
				continue;
			}

			let site = sites[i];

			// We can use the cell only if it's empty or the site is un-pinned.
			if (!site || !site.isPinned) {
				return i;
			}
		}

		return -1;
	}
};

/**
 * This singleton provides functionality to update the current grid to a new
 * set of pinned and blocked sites. It adds, moves and removes sites.
 */
export var Updater = {
	/**
	   * Updates the current grid according to its pinned and blocked sites.
	   * This removes old, moves existing and creates new sites to fill gaps.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	updateGrid(callback) {
		// let links = NewTabToolsLinks.getLinks().slice(0, Grid.cells.length);
		Tiles.getAllTiles().then(links => {
			// Find all sites that remain in the grid.
			let sites = this._findRemainingSites(links);

			let self = this;

			// Remove sites that are no longer in the grid.
			this._removeLegacySites(sites, function() {
				// Freeze all site positions so that we can move their DOM nodes around
				// without any visual impact.
				self._freezeSitePositions(sites);

				// Move the sites' DOM nodes to their new position in the DOM. This will
				// have no visual effect as all the sites have been frozen and will
				// remain in their current position.
				self._moveSiteNodes(sites);

				// Now it's time to animate the sites actually moving to their new
				// positions.
				self._rearrangeSites(sites, function() {
					// Try to fill empty cells and finish.
					self._fillEmptyCells(links, callback);

					// Update other pages that might be open to keep them synced.
					// AllPages.update(Page);
				});
			});
		});
	},

	fastUpdateGrid() {
		// let links = NewTabToolsLinks.getLinks().slice(0, Grid.cells.length);
		Tiles.getAllTiles().then((/** @type {Array<Link | undefined>} */ links) => {
			// Find all sites that remain in the grid.
			let sites = this._findRemainingSites(links);

			// Remove sites that are no longer in the grid.
			this._removeLegacySites(sites, () => {
				// Try to fill empty cells and finish.
				this._fillEmptyCells(links);
			});
		});
	},

	/**
	   * Takes an array of links and tries to correlate them to sites contained in
	   * the current grid. If no corresponding site can be found (i.e. the link is
	   * new and a site will be created) then just set it to null.
	   * @param {Array<Link | undefined>} links The array of links to find sites for.
	   * @return {Array<Site | null | undefined>} Array of sites mapped to the given links (can contain null values).
	   */
	_findRemainingSites(links) {
		/** @type {Record<string, Site>} */
		let map = {};

		// Create a map to easily retrieve the site for a given URL.
		Grid.sites.forEach(function(site) {
			if (site) {
				map[site.url] = site;
			}
		});

		// Map each link to its corresponding site, if any. (Cast, not a
		// rewrite: the original boolean-chain can return `false` as well as
		// `undefined`/`null`/a `Site` — every consumer only ever checks
		// truthiness or array membership, never discriminates `false` from
		// the other falsy values, so the declared element type omits it.)
		return /** @type {Array<Site | null | undefined>} */ (links.map(function(link) {
			return link && (link.url in map) && map[link.url];
		}));
	},

	/**
	   * Freezes the given sites' positions.
	   * @param {Array<Site | null | undefined>} sites The array of sites to freeze.
	   */
	_freezeSitePositions(sites) {
		sites.forEach(function(site) {
			if (site) {
				Transformation.freezeSitePosition(site);
			}
		});
	},

	/**
	   * Moves the given sites' DOM nodes to their new positions.
	   * @param {Array<Site | null | undefined>} sites The array of sites to move.
	   */
	_moveSiteNodes(sites) {
		let cells = Grid.cells;

		// Truncate the given array of sites to not have more sites than cells.
		// This can happen when the user drags a bookmark (or any other new kind
		// of link) onto the grid.
		sites = sites.slice(0, cells.length);

		sites.forEach(function(site, index) {
			let cell = cells[index];
			let cellSite = cell.site;

			// The site's position didn't change.
			if (!site || cellSite != site) {
				let cellNode = cell.node;

				// Empty the cell if necessary.
				if (cellSite) {
					cellNode.removeChild(cellSite.node);
				}

				// Put the new site in place, if any.
				if (site) {
					cellNode.appendChild(site.node);
				}
			}
		}, this);
	},

	/**
	   * Rearranges the given sites and slides them to their new positions.
	   * @param {Array<Site | null | undefined>} sites The array of sites to re-arrange.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	_rearrangeSites(sites, callback) {
		let options = {callback, unfreeze: true};
		Transformation.rearrangeSites(sites, options);
	},

	/**
	   * Removes all sites from the grid that are not in the given links array or
	   * exceed the grid.
	   * @param {Array<Site | null | undefined>} sites The array of sites remaining in the grid.
	   * @param {() => void} callback The callback to call when finished.
	   */
	_removeLegacySites(sites, callback) {
		/** @type {Promise<void>[]} */
		let batch = [];

		// Delete sites that were removed from the grid.
		Grid.sites.forEach(function(site) {
			// The site must be valid and not in the current grid.
			if (!site || sites.includes(site)) {
				return;
			}

			batch.push(new Promise(resolve => {
				// Fade out the to-be-removed site.
				Transformation.hideSite(site, function() {
					let node = site.node;

					// Remove the site from the DOM.
					node.remove();
					resolve();
				});
			}));
		});

		Promise.all(batch).then(callback);
	},

	/**
	   * Tries to fill empty cells with new links if available.
	   * @param {Array<Link | undefined>} links The array of links.
	   * @param {() => void} [callback] The callback to call when finished.
	   */
	_fillEmptyCells(links, callback) {
		let {cells, sites} = Grid;

		// Find empty cells and fill them.
		Promise.all(sites.map((site, index) => {
			if (site || !links[index]) {
				return null;
			}

			return new Promise((/** @type {(value?: void) => void} */ resolve) => {
				// Create the new site and fade it in.
				let site = Grid.createSite(/** @type {Link} */ (links[index]), cells[index]);

				// Set the site's initial opacity to zero. (`style.opacity`'s
				// WebIDL setter coerces a non-string value itself — cast
				// through `unknown` to document that instead of assigning a
				// literal `'0'` string, which would be a different value at
				// the JS-level assignment even though the DOM ends up the same.)
				site.node.style.opacity = /** @type {string} */ (/** @type {unknown} */ (0));

				// Flush all style changes for the dynamically inserted site to make
				// the fade-in transition work.
				window.getComputedStyle(site.node).opacity;
				Transformation.showSite(site, resolve);
			});
		})).then(function() {
			newTabTools.getThumbnails();
		}).then(callback).catch(console.error);
	}
};

/**
 * Dialog allowing to undo the removal of single site or to completely restore
 * the grid's original state.
 */
export var UndoDialog = {
	/**
	   * The undo dialog's timeout in miliseconds.
	   */
	HIDE_TIMEOUT_MS: 15000,

	/**
	   * Contains undo information.
	   * @type {{index: number, wasPinned: boolean, blockedLink: Link, timeout: ReturnType<typeof setTimeout>} | null}
	   */
	_undoData: null,

	/** @type {HTMLElement} */
	_undoContainer: /** @type {any} */ (undefined),
	/** @type {HTMLElement} */
	_undoButton: /** @type {any} */ (undefined),
	/** @type {HTMLElement} */
	_undoCloseButton: /** @type {any} */ (undefined),
	/** @type {HTMLElement} */
	_undoRestoreButton: /** @type {any} */ (undefined),

	/**
	   * Initializes the undo dialog.
	   */
	init() {
		this._undoContainer = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-container'));
		this._undoContainer.addEventListener('click', this);
		this._undoButton = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-button'));
		this._undoCloseButton = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-close-button'));
		this._undoRestoreButton = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-restore-button'));
	},

	/**
	   * Shows the undo dialog.
	   * @param {Site} site The site that just got removed.
	   */
	show(site) {
		if (this._undoData) {
			clearTimeout(this._undoData.timeout);
		}

		this._undoData = {
			index: /** @type {Cell} */ (site.cell).index,
			wasPinned: site.isPinned,
			blockedLink: site.link,
			timeout: setTimeout(this.hide.bind(this), this.HIDE_TIMEOUT_MS)
		};

		this._undoContainer.removeAttribute('undo-disabled');
		this._undoButton.removeAttribute('tabindex');
		this._undoCloseButton.removeAttribute('tabindex');
		this._undoRestoreButton.removeAttribute('tabindex');

		newTabTools.trimRecent();
	},

	/**
	   * Hides the undo dialog.
	   */
	hide() {
		if (!this._undoData) {
			return;
		}

		clearTimeout(this._undoData.timeout);
		this._undoData = null;
		this._undoContainer.setAttribute('undo-disabled', 'true');
		this._undoButton.setAttribute('tabindex', '-1');
		this._undoCloseButton.setAttribute('tabindex', '-1');
		this._undoRestoreButton.setAttribute('tabindex', '-1');

		newTabTools.trimRecent();
	},

	/**
	   * The undo dialog event handler.
	   * @param {Event} event The event to handle.
	   */
	handleEvent(event) {
		switch (/** @type {Element} */ (event.target).id) {
		case 'newtab-undo-button':
			this._undo();
			break;
		case 'newtab-undo-restore-button':
			this._undoAll();
			break;
		case 'newtab-undo-close-button':
			this.hide();
			break;
		}
	},

	/**
	   * Undo the last blocked site.
	   * @returns {Promise<void>}
	   */
	async _undo() {
		if (!this._undoData) {
			return;
		}

		let {wasPinned, blockedLink} = this._undoData;
		await Blocked.unblock(blockedLink.url);

		if (wasPinned) {
			Tiles.putTile(blockedLink);
		}

		Updater.updateGrid();
		this.hide();
	},

	/**
	   * Undo all blocked sites.
	   * @returns {Promise<void>}
	   */
	async _undoAll() {
		await Blocked.clear();
		Updater.updateGrid();
		this.hide();
	}
};

// page-modules P1 (PAGE_MODULES.md, Decision 3): the former top-level boot
// trailer here (`UndoDialog.init(); newTabTools.startup();
// pageMessageHandler.flushQueued();`) moved to page-main.js — it was this
// file's one violation of "no page module executes another module's code at
// its own top level" (it reached into newTabTools/pageMessageHandler, both
// from newTab.js). fx-newTab.js's top level is now definition-only.

