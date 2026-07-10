/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

export const Tiles = {
	_list: [],
	isPinned(url) {
		return this._list.includes(url);
	},
	getAllTiles() { // NOTE: misleading name — mirrors the FROZEN wire message name 'Tiles.getAllTiles' (MODERNIZATION.md Decision 3); the background-side store method was renamed to getGridTiles in M2 (lib/tiles-store.js), but this page-side proxy keeps its own name since it's the wire name, not an internal one.
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({ name: 'Tiles.getAllTiles' }, response => {
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
	getTile(url) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.getTile', url }, resolve);
		});
	},
	putTile(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.putTile', tile }, function(id) {
				tile.id = id;
				resolve(id);
			});
		});
	},
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
	setBackground(file) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.setBackground', file }, resolve);
		});
	},
};

// page-modules P2 (PAGE_MODULES.md): Tiles/Background are real exports now,
// but the globalThis bridges SURVIVE — newTab.js/fx-newTab.js still read them
// as bare identifiers (they stay vm-loaded classic scripts until P5) and
// E2E/UAT page-context evaluation reads them off globalThis too (TEST-ONLY
// thereafter, once the last production consumer migrates). Background in
// particular remains a *production* bridge, not TEST-ONLY, until P5.
globalThis.Tiles = Tiles;
globalThis.Background = Background;
