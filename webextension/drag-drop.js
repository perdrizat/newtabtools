/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4b (CHROME_PREP.md): extracted verbatim (C3b typed the
// `Drag`/`Drop`/`DropTargetShim`/`DropPreview` singletons before this slice
// moved them; no rewrite, per the arc's slicing rule) plus their shared
// `DELAY_REARRANGE_MS` constant. The four are one subsystem (mutual coupling:
// `Drop`/`DropTargetShim` read `Drag`'s dragged-site state, `Drop` calls
// `DropPreview.rearrange`), so they move together rather than split further.
// `Grid`/`newTabTools` are real, call-time-only references back into files
// that in turn import THIS file (page.js's `Page`, cell.js's `Cell`, site.js's
// `Site` call `Drag.start`/`Drag.end`/`Drag.draggedSite`/`Drop.enter`/
// `Drop.exit`/`Drop.drop`/`DropTargetShim.init`) — a legal ESM cycle under
// Decision 3 (PAGE_MODULES.md): every reference below is inside a method
// body, never a top-level read. `Transformation`/`Updater` are sibling
// modules extracted in C4a; this file is a second importer of both (no new
// cycle between them — neither transformation.js nor updater.js imports this
// file, though transformation.js imports `Drag` FROM here — see its own
// updated header comment). chrome-prep C4c (CHROME_PREP.md): `Grid` moved out
// to grid.js (this import's specifier changes accordingly); `Site`/`Cell`/
// `NttRect`/`SiteNode` moved out to site.js/cell.js/cell.js/site.js.
import { Grid } from './grid.js';
import { newTabTools } from './newTab.js';
import { Prefs } from './prefs.js';
import { Transformation } from './transformation.js';
import { Updater } from './updater.js';
import { el } from './dom.js';

/**
 * `Site`/`SiteNode` stay owned by site.js, `Cell`/`NttRect` by cell.js (still
 * read by stayers there — `Grid`/`Cell`/`Site` themselves), so per the arc's
 * typedef-ownership rule they're referenced here via
 * `import('./site.js' | './cell.js').X`, same as transformation.js/updater.js's
 * own typedef blocks.
 * @typedef {import('./site.js').Site} Site
 * @typedef {import('./cell.js').Cell} Cell
 * @typedef {import('./cell.js').NttRect} NttRect
 * @typedef {import('./site.js').SiteNode} SiteNode
 */

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
export var DropTargetShim = {
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

		// A site was successfully dropped. `_lastDropTarget` can genuinely be
		// `null` here (no cell found under the drop point) — `_dispatchEvent`
		// dereferences `target.node` unconditionally, so this used to be a
		// TypeError path (chrome-prep C3b typing finding, report-only;
		// adjudicated and fixed in the chrome-prep interim round between
		// C4b/C4c): guard and early-return instead of dispatching a 'drop'
		// event with no target.
		if (!this._lastDropTarget) {
			return;
		}
		this._dispatchEvent(event, 'drop', this._lastDropTarget);
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
export var DropPreview = {
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
