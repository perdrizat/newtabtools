/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4c (CHROME_PREP.md): extracted verbatim (C3b typed the `Grid`
// singleton before this slice moved it; no rewrite, per the arc's slicing
// rule). `Cell`/`Site` (this slice's sibling movers, cell.js/site.js) are
// real VALUE imports — `Grid.createSite`/`_renderGrid` construct them with
// `new` — which makes this file and site.js mutually importing: site.js
// imports `Grid` back (its never-capture click handler calls
// `Grid.refresh()`) — a legal ESM cycle under Decision 3 (PAGE_MODULES.md):
// every cross-reference is call-time only (inside a method/callback body),
// never a top-level read, the same shape as every other cycle this program
// has threaded (newTab.js<->grid.js, newTab.js<->page.js,
// grid.js<->site.js, transformation.js/updater.js/undo-dialog.js/
// drag-drop.js's own cycles with newTab.js).
import { el } from './dom.js';
import { Prefs } from './prefs.js';
import { Transformation } from './transformation.js';
import { Tiles } from './tiles-shim.js';
import { newTabTools } from './newTab.js';
import { Cell } from './cell.js';
import { Site } from './site.js';
import { api } from './api.js';

/**
 * `Link` stays owned by site.js (a `Site` wraps one; `Grid.createSite`'s own
 * `link` parameter is the other real consumer of the shape, per the arc's
 * typedef-ownership rule for shared shapes) — type-only import, erased at
 * compile time.
 * @typedef {import('./site.js').Link} Link
 */

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
			let code = el('code', undefined, api.runtime.getURL(''));
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
