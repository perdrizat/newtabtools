/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4a (CHROME_PREP.md): extracted verbatim (C3b typed the
// `Updater` singleton before this slice moved it; no rewrite, per the arc's
// slicing rule). `Grid` and `newTabTools` (newTab.js) are real,
// call-time-only references back into files that in turn import THIS file
// (site.js's Site/drag-drop.js's Drag/Drop call `Updater.updateGrid()`) — a
// legal ESM cycle under Decision 3 (PAGE_MODULES.md): every reference below
// is inside a method body, never a top-level read. `Transformation` is a
// sibling module extracted in the same slice (no cycle between the two —
// transformation.js never imports this file). chrome-prep C4c
// (CHROME_PREP.md): `Grid` moved out to grid.js (this import's specifier
// changes accordingly).
import { Tiles } from './tiles-shim.js';
import { Grid } from './grid.js';
import { newTabTools } from './newTab.js';
import { Transformation } from './transformation.js';

/**
 * `Link` is site.js's own alias of `tiles-shim.js`'s `Tile` type — used
 * by both this mover and stayers there (`Grid.createSite`, `Site`), so per
 * the arc's typedef-ownership rule it stays owned by site.js and is
 * referenced here via `import('./site.js').Link`, same as `Site`.
 * @typedef {import('./site.js').Site} Site
 * @typedef {import('./cell.js').Cell} Cell
 * @typedef {import('./site.js').Link} Link
 */

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
