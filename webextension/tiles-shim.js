/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

export const Tiles = {
	/** @type {string[]} */
	_list: [],
	/** @param {string} url */
	isPinned(url) {
		return this._list.includes(url);
	},
	getAllTiles() { // NOTE: misleading name — mirrors the FROZEN wire message name 'Tiles.getAllTiles' (MODERNIZATION.md Decision 3); the background-side store method was renamed to getGridTiles in M2 (lib/tiles-store.js), but this page-side proxy keeps its own name since it's the wire name, not an internal one.
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({ name: 'Tiles.getAllTiles' }, /** @param {{tiles: any, list: string[]}|null} response */ response => {
				if (response === null) {
					reject();
					return;
				}
				let { tiles, list } = response;
				this._list = list;
				resolve(tiles);
			});
		});
	},
	/** @param {string} url */
	getTile(url) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.getTile', url }, resolve);
		});
	},
	/** @param {{url: string, id?: number}} tile */
	putTile(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.putTile', tile }, /** @param {number} id */ function(id) {
				tile.id = id;
				resolve(id);
			});
		});
	},
	/** @param {{url: string}} tile */
	removeTile(tile) {
		let index = this._list.indexOf(tile.url);
		while (index > -1) {
			this._list.splice(index, 1);
			index = this._list.indexOf(tile.url);
		}
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.removeTile', tile }, resolve);
		});
	}
};

export const Background = {
	getBackground() {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.getBackground' }, resolve);
		});
	},
	/** @param {File|Blob} file */
	setBackground(file) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.setBackground', file }, resolve);
		});
	},
};

// page-modules P5 (PAGE_MODULES.md): Tiles/Background are real exports,
// consumed by real imports (newTab.js, fx-newTab.js). TEST-ONLY BRIDGE: these
// assignments survive solely for E2E/UAT page-context evaluation and any
// fast-tier suite still reading a bare identifier off a computed-path dynamic
// import. Cast through `any` on the way out — same reason as prefs.js's
// bridge assignments (PAGE_MODULES.md P3): without it, TypeScript's
// checked-JS infers the full internal shape as the ambient global from this
// assignment, overriding tests/integration/globals.d.ts's deliberately loose
// `declare global { var Tiles: any; var Background: any; }` and breaking
// every test-only partial mock of Tiles/Background across the suite.
globalThis.Tiles = /** @type {any} */ (Tiles);
globalThis.Background = /** @type {any} */ (Background);
