/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The `Tiles` and `Background` models (MODERNIZATION.md, Stage M, slice M2),
 * carved out of tiles.js into a real ES module. All IndexedDB access goes
 * through `withStore()` (lib/db.js) — no raw `db`/transaction identifier
 * exists in this file at all.
 *
 * `Prefs`/`Blocked`/`Filters` (prefs.js) and `compareVersions` (common.js)
 * are dual-scope bridge files (MODERNIZATION.md Decision 2, PAGE_MODULES.md
 * Decision 6) — real `export`s now, imported directly below. Their
 * `globalThis.X = …` bridge assignments are gone as of chrome-prep C3d: the
 * page imports both files for real too, so nothing reads either off
 * `globalThis` anymore.
 */

import { withObjectStore } from './db.js';
import { SAFE_PROTOCOLS } from './constants.js';
import { Blocked, Filters, Prefs } from '../prefs.js';
import { compareVersions } from '../common.js';

/**
 * @typedef {Object} Tile
 * @property {number} [id]
 * @property {string} url
 * @property {string} [title]
 * @property {boolean} [titleIsUserSet] Set/cleared by newTab.js's tile-title
 *   editing (options-title-set/-remove, options-url-set) to distinguish a
 *   user-set title from an auto-derived one. Mirrors tiles-shim.js's
 *   page-side `Tile` typedef (chrome-prep C3c added it there; doc-truth fix
 *   here, interim round between C4b/C4c — this file's storage layer already
 *   round-trips the property untyped, since IndexedDB is schema-less).
 * @property {number} [position]
 * @property {Blob} [image]
 * @property {boolean} [imageIsThumbnail]
 * @property {string} [backgroundColor]
 */

export const Tiles = {
	_ready: false,
	/** @type {string[]} */
	_cache: [],
	/** @type {string[]} */
	_list: [],
	/**
	 * Decide whether a history host is filtered out under the current (mutated)
	 * per-host budget. Exact host keys match only that host; keys with a leading
	 * `.` match the apex and any subdomain. A matched host that still has budget
	 * decrements it; at zero it is dropped. `filters` is mutated in place (the
	 * caller passes a fresh `Filters.getList()` copy).
	 * @param {string} host
	 * @param {Record<string, number>} filters  host→remaining-limit
	 * @param {string[]} dotFilters  the `.`-prefixed keys of `filters`
	 * @returns {boolean} true ⇒ drop this host
	 */
	_hostFilteredOut(host, filters, dotFilters) {
		let match = host in filters ? host : dotFilters.find(
			f => host == f.substring(1) || host.endsWith(f)
		);
		if (!match) {
			return false;
		}
		if (filters[match] === 0) {
			return true;
		}
		filters[match]--;
		return false;
	},
	ensureReady() {
		let promise = this._ready ? Promise.resolve(null) : this.getGridTiles();
		return promise.then(() => {
			return { cache: this._cache, list: this._list };
		});
	},
	/**
	 * @param {string} url
	 * @returns {boolean}
	 */
	isPinned(url) {
		return this._list.includes(url);
	},
	getAll() {
		return withObjectStore('tiles', 'readonly', store => new Promise((resolve, reject) => {
			let op = store.getAll();
			op.onsuccess = () => resolve(op.result);
			op.onerror = reject;
		}));
	},
	// Internal rename from `getAllTiles` (M2, MODERNIZATION.md Decision 3):
	// the WIRE message name 'Tiles.getAllTiles' stays frozen — lib/messages.js's
	// dispatch case keeps that name and calls this method under its new name.
	// tiles-shim.js (page-side proxy) also keeps `getAllTiles` — it mirrors
	// the wire name, not this internal one.
	getGridTiles() {
		let count = Prefs.rows * Prefs.columns;
		return withObjectStore('tiles', 'readonly', store => new Promise(resolve => {
			let op = store.getAll();
			op.onsuccess = async () => {
				// `_ready` is set only on a successful read (M2 supersedes the
				// tiles.js §2.2 fix) — a throwing/rejected read below never
				// leaves it stuck true with an empty list.
				this._ready = true;
				let links = [];
				let urlMap = new Map();
				this._list.length = 0;

				for (let t of op.result) {
					if ('position' in t) {
						if (this._list.includes(t.url)) {
							console.error('This URL appears twice: ' + t.url);
							continue;
						}
						links[t.position] = t;
						this._list.push(t.url);
					}
					urlMap.set(t.url, t);
				}

				if (!Prefs.history) {
					this._cache = links.map(l => l.url);
					resolve(links.slice(0, count));
					return;
				}

				let {version} = await browser.runtime.getBrowserInfo();
				let options;
				if (compareVersions(version, '63.0a1') >= 0) {
					options = { limit: 100, onePerDomain: false, includeBlocked: true };
				} else {
					options = { providers: ['places'] };
				}
				let r = await browser.topSites.get(options);
				let urls = this._list.slice();
				let filters = Filters.getList();
				let dotFilters = Object.keys(filters).filter(f => f[0] == '.');
				let remaining = r.filter(s => {
					if (Blocked.isBlocked(s.url)) {
						return false;
					}
					let url = new URL(s.url);
					if (!SAFE_PROTOCOLS.includes(url.protocol)) {
						return false;
					}

					let isNew = !urls.includes(s.url);
					if (isNew) {
						if (Tiles._hostFilteredOut(url.host, filters, dotFilters)) {
							return false;
						}
						urls.push(s.url);
					} else {
						// If we pin a tile we've never visited, it has no title.
						let t = urlMap.get(s.url);
						if (t && !('title' in t)) {
							t.title = s.title;
						}
					}
					return isNew;
				});

				// Add some extras for thumbnail generation of tiles that might get promoted.
				let extraCount = count + 25;
				for (let i = 0; i < extraCount && remaining.length > 0; i++) {
					if (!links[i]) {
						let next = remaining.shift();
						if (next) {
							let mapData = urlMap.get(next.url);
							if (mapData) {
								// `next` comes from browser.topSites.get() (a typed
								// MostVisitedURL) — merge in the stored tile's extra
								// fields (title override, custom image, etc.).
								Object.assign(next, mapData);
							}
							links[i] = next;
						} else {
							break;
						}
					}
				}

				this._cache = links.map(l => l.url);
				resolve(links.slice(0, count));
			};
		}));
	},
	/**
	 * @param {string} url
	 * @returns {Promise<Tile|null>}
	 */
	getTile(url) {
		return withObjectStore('tiles', 'readonly', store => new Promise((resolve, reject) => {
			let op = store.index('url').get(url);
			op.onsuccess = () => resolve(op.result || null);
			op.onerror = reject;
		}));
	},
	/**
	 * @param {Tile} tile
	 * @returns {Promise<IDBValidKey>}
	 */
	putTile(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return withObjectStore('tiles', 'readwrite', store => new Promise((resolve, reject) => {
			let op = store.put(tile);
			op.onsuccess = () => resolve(op.result);
			op.onerror = reject;
		}));
	},
	/**
	 * @param {Tile} tile
	 * @returns {Promise<void>}
	 */
	removeTile(tile) {
		let index = this._list.indexOf(tile.url);
		while (index > -1) {
			this._list.splice(index, 1);
			index = this._list.indexOf(tile.url);
		}
		return withObjectStore('tiles', 'readwrite', store => new Promise((resolve, reject) => {
			// removeTile is only ever called with an existing (already-saved,
			// so id-bearing) tile — `id` is optional on the Tile typedef only
			// because a not-yet-saved tile doesn't have one yet.
			let op = store.delete(/** @type {IDBValidKey} */ (tile.id));
			op.onsuccess = () => resolve(undefined);
			op.onerror = reject;
		}));
	},
	/**
	 * @returns {Promise<void>}
	 */
	clear() {
		return withObjectStore('tiles', 'readwrite', store => new Promise((resolve, reject) => {
			let op = store.clear();
			op.onsuccess = () => resolve(undefined);
			op.onerror = reject;
		}));
	},
	/**
	 * Resolves with `undefined` if the URL was already pinned (no-op); a
	 * pinned tile's IDBValidKey (from the underlying putTile()) otherwise —
	 * lib/messages.js's 'Tiles.pinTile' handler sends this value straight back
	 * to the caller as the new tile's id.
	 * @param {string} title
	 * @param {string} url
	 * @returns {Promise<IDBValidKey|undefined>}
	 */
	pinTile(title, url) {
		if (this.isPinned(url)) {
			return Promise.resolve(undefined);
		}
		return withObjectStore('tiles', 'readonly', store => new Promise(resolve => {
			store.getAll().onsuccess = function() {
				let p = 0;
				for (let tile of this.result.filter((/** @type {Tile} */ t) => 'position' in t).sort((/** @type {Tile} */ a, /** @type {Tile} */ b) => (a.position ?? 0) - (b.position ?? 0))) {
					if (p != tile.position) {
						break;
					}
					p++;
				}
				Tiles.putTile({title, url, position: p}).then(resolve);
			};
		}));
	}
};

export const Background = {
	/**
	 * @returns {Promise<Blob|null>}
	 */
	getBackground() {
		return withObjectStore('background', 'readonly', store => new Promise(resolve => {
			store.getAll().onsuccess = function() {
				resolve(this.result[0] || null);
			};
		}));
	},
	/**
	 * @param {Blob|null} file
	 * @returns {Promise<void>}
	 */
	setBackground(file) {
		return withObjectStore('background', 'readwrite', store => new Promise(resolve => {
			store.clear().onsuccess = function() {
				if (file) {
					store.add(file).onsuccess = function() {
						resolve(undefined);
					};
				} else {
					resolve(undefined);
				}
			};
		}));
	}
};
