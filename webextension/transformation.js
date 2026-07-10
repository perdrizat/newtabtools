/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4a (CHROME_PREP.md): extracted verbatim from fx-newTab.js's
// `Transformation` singleton (C3b typed it there; this slice only moves the
// code — no rewrite, per the arc's slicing rule). `Grid`/`Drag` (still
// defined in fx-newTab.js — Cell/Site/Grid don't move until C4c, Drag/Drop
// don't move until C4b) and `newTabTools` (newTab.js) are real, call-time-only
// references back into files that in turn import THIS file (fx-newTab.js
// imports `Transformation` for its own Grid/Drag/Site use) — a legal ESM
// cycle under Decision 3 (PAGE_MODULES.md): every reference below is inside a
// method body, never a top-level read, so none of these bindings are touched
// before the cycle finishes initializing.
import { Grid, Drag } from './fx-newTab.js';
import { newTabTools } from './newTab.js';

/**
 * `Site & SiteIndexState`'s `SiteIndexState` half — used only by this file's
 * `freezeSitePosition`/`unfreezeSitePosition`/`slideSiteTo` (C3b's own
 * typedef comment explains why it's a separate intersection type rather than
 * a `Site` own-property) — so it moves here with its sole consumer, unlike
 * `NttRect`/`Site`/`Cell`, which stay owned by fx-newTab.js (still read by
 * stayers) and are referenced via `import('./fx-newTab.js').X` below.
 * @typedef {Object} SiteIndexState
 * @property {number} [index]
 */

/**
 * @typedef {import('./fx-newTab.js').Site} Site
 * @typedef {import('./fx-newTab.js').Cell} Cell
 * @typedef {import('./fx-newTab.js').NttRect} NttRect
 */

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
