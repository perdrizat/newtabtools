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
// chrome-prep C4a (CHROME_PREP.md): Transformation/Updater/UndoDialog moved
// out to their own modules (transformation.js/updater.js/undo-dialog.js);
// this file still calls into all three (Grid/Site/Drag/Drop use
// Transformation/Updater, Site uses UndoDialog) — a legal ESM cycle under
// Decision 3 (every reference is call-time only, inside a method body).
import { Transformation } from './transformation.js';
import { Updater } from './updater.js';
import { UndoDialog } from './undo-dialog.js';
// chrome-prep C4b (CHROME_PREP.md): Drag/Drop/DropTargetShim/DropPreview
// moved out to drag-drop.js; this file still calls into Drag/Drop (Cell's
// and Site's handleEvent) and DropTargetShim (Page._init) — a legal ESM
// cycle under Decision 3 (every reference is call-time only, inside a
// method body). `DropPreview` has no remaining call site in THIS file (only
// `Drop`, now in drag-drop.js, calls it), so it isn't imported here.
import { Drag, Drop, DropTargetShim } from './drag-drop.js';

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
 *
 * chrome-prep C4a (CHROME_PREP.md): gained a real `export` (previously
 * module-local) so transformation.js/updater.js/undo-dialog.js can reference
 * it as a type via `import('./fx-newTab.js').Cell` — a JSDoc `@typedef` is
 * importable either way, but a plain constructor function needs a real
 * `export` for TS's `import()` type query to resolve it. No behavior change.
 * @constructor
 * @param {typeof Grid} grid
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

// chrome-prep C4b (CHROME_PREP.md): `Drag`/`Drop`/`DropTargetShim`/
// `DropPreview` (+ their shared `DELAY_REARRANGE_MS` constant) moved out to
// `drag-drop.js` — imported below, right after this file's own `Cell`
// definition, for `Page`/`Cell`'s call-time-only use (Decision 3).

// page-modules P1 (PAGE_MODULES.md, Decision 3): the former top-level boot
// trailer here (`UndoDialog.init(); newTabTools.startup();
// pageMessageHandler.flushQueued();`) moved to page-main.js — it was this
// file's one violation of "no page module executes another module's code at
// its own top level" (it reached into newTabTools/pageMessageHandler, both
// from newTab.js). fx-newTab.js's top level is now definition-only.

