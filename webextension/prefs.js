/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported Prefs, Blocked, Filters */
/* globals Grid, newTabTools, Updater */

var Prefs = {
	_theme: 'system',
	_opacity: 80,
	_rows: 3,
	_columns: 3,
	_margin: ['medium', 'medium', 'medium', 'medium'],
	_spacing: 'medium',
	_titleSize: 'small',
	_tileAspect: 'fill',
	_statType: 'none',
	_titleBarSearch: true,
	_actionIconSize: 'medium',
	_tileActions: true,
	_tileRadius: 'medium',
	// Board A / Edit mode (§2): the board is locked by default — tiles only move
	// while editing (drawer open). openDrawer unlocks; closeDrawer re-locks.
	_locked: true,
	_history: true,
	_recent: true,
	_thumbnailSize: 600,
	_backgroundUrl: '',
	_backgroundPosition: 'center center',
	_backgroundColor: '',
	_version: -1,

	init() {
		// Prune keys for features removed during the v2 redesign so they don't
		// linger in storage or ride along in backups. `parsePrefs` already
		// ignores unknown keys, so this is housekeeping, not correctness.
		chrome.storage.local.remove(['toolbarIcon', 'titleBarClock', 'titleBarWordmark', 'titleBarStatus']);

		let names = [
			'theme',
			'opacity',
			'rows',
			'columns',
			'margin',
			'spacing',
			'titleSize',
			'tileAspect',
			'statType',
			'titleBarSearch',
			'actionIconSize',
			'tileActions',
			'tileRadius',
			'locked',
			'history',
			'recent',
			'thumbnailSize',
			'backgroundUrl',
			'backgroundPosition',
			'backgroundColor',
			'version'
		];

		for (let n of names) {
			this.__defineGetter__(n, () => this['_' + n]);
			this.__defineSetter__(n, function(value) {
				let obj = {};
				obj[n] = value;
				chrome.storage.local.set(obj);
			});
		}

		return new Promise(resolve => {
			chrome.storage.local.get(prefs => {
				this.parsePrefs(prefs);
				chrome.storage.onChanged.addListener(this.prefsChanged.bind(this));
				resolve();
			});
		});
	},
	parsePrefs(prefs) {
		if (['system', 'light', 'dark', 'contrast'].includes(prefs.theme)) {
			this._theme = prefs.theme;
		}
		if (Number.isInteger(prefs.opacity) && prefs.opacity >= 0 && prefs.opacity <= 100) {
			this._opacity = prefs.opacity;
		}
		if (Number.isInteger(prefs.rows) && prefs.rows >= 1 && prefs.rows <= 20) {
			this._rows = prefs.rows;
		}
		if (Number.isInteger(prefs.columns) && prefs.columns >= 1 && prefs.columns <= 20) {
			this._columns = prefs.columns;
		}
		if (Array.isArray(prefs.margin) && prefs.margin.length == 4) {
			this._margin = prefs.margin;
		}
		if (['small', 'medium', 'large'].includes(prefs.spacing)) {
			this._spacing = prefs.spacing;
		}
		if (['hidden', 'small', 'medium', 'large'].includes(prefs.titleSize)) {
			this._titleSize = prefs.titleSize;
		}
		if (['fill', '16-9', '4-3', '1-1', '3-4'].includes(prefs.tileAspect)) {
			this._tileAspect = prefs.tileAspect;
		}
		if (['none', 'visits', 'last', 'trend', 'rank', 'fresh'].includes(prefs.statType)) {
			this._statType = prefs.statType;
		}
		if ('titleBarSearch' in prefs) {
			this._titleBarSearch = prefs.titleBarSearch !== false;
		}
		if (['small', 'medium', 'large'].includes(prefs.actionIconSize)) {
			this._actionIconSize = prefs.actionIconSize;
		}
		if ('tileActions' in prefs) {
			this._tileActions = prefs.tileActions !== false;
		}
		if (['small', 'medium', 'large'].includes(prefs.tileRadius)) {
			this._tileRadius = prefs.tileRadius;
		}
		if ('locked' in prefs) {
			this._locked = prefs.locked === true;
		}
		if ('history' in prefs) {
			this._history = prefs.history !== false;
		}
		if ('recent' in prefs) {
			this._recent = prefs.recent !== false;
		}
		if (Number.isInteger(prefs.thumbnailSize)) {
			this._thumbnailSize = prefs.thumbnailSize;
		}
		if (typeof prefs.backgroundUrl === 'string') {
			this._backgroundUrl = prefs.backgroundUrl;
		}
		// `background_position` from `newtab-wallpapers-v2` only ever emits
		// these 9 keywords. Anything else (e.g. an arbitrary string from a
		// crafted backup) is dropped on the floor.
		if ([
			'center center', 'center left', 'center right',
			'top left', 'top center', 'top right',
			'bottom left', 'bottom center', 'bottom right',
		].includes(prefs.backgroundPosition)) {
			this._backgroundPosition = prefs.backgroundPosition;
		}
		// Same shape as the per-tile `backgroundColor` validator in export.js.
		if (typeof prefs.backgroundColor === 'string'
			&& (prefs.backgroundColor === '' || /^#[0-9a-f]{3,8}$/i.test(prefs.backgroundColor))) {
			this._backgroundColor = prefs.backgroundColor;
		}
		if (Array.isArray(prefs.blocked)) {
			Blocked._list = prefs.blocked;
		}
		if ('filters' in prefs && typeof prefs.filters == 'object') {
			Filters._list = prefs.filters;
		}
		if ('version' in prefs && typeof prefs.version == 'number' || typeof prefs.version == 'string') {
			this._version = prefs.version;
		}
	},
	prefsChanged(changes) {
		let prefs = Object.create(null);
		for (let [name, change] of Object.entries(changes)) {
			if (change.newValue != change.oldValue) {
				prefs[name] = change.newValue;
			}
		}

		let keys = Object.keys(prefs);
		if (keys.length === 0) {
			return;
		}

		this.parsePrefs(prefs);

		if (keys.length == 1 && keys[0] == 'thumbnailSize') {
			return;
		}

		if ('newTabTools' in window) {
			newTabTools.updateUI(keys);
			if (typeof newTabTools._markAutoSaved === 'function') {
				newTabTools._markAutoSaved();
			}
			if (keys.includes('rows') || keys.includes('columns')) {
				Grid.refresh().then(() => {
					if (document.documentElement.hasAttribute('drawer-open')
						&& document.documentElement.getAttribute('drawer-tab') === 'tile') {
						newTabTools.resizeOptionsThumbnail();
					}
				});
			} else if (keys.includes('history')) {
				Updater.updateGrid();
			}
		}
	},
};

var Blocked = {
	_list: [],
	_saveList() {
		return new Promise(resolve => {
			chrome.storage.local.set({ 'blocked': this._list }, resolve);
		});
	},
	block(url) {
		this._list.push(url);
		return this._saveList();
	},
	unblock(url) {
		let index = this._list.indexOf(url);
		if (index >= 0) {
			this._list.splice(index, 1);
		}
		return this._saveList();
	},
	isBlocked(url) {
		return this._list.includes(url);
	},
	clear() {
		this._list.length = 0;
		return this._saveList();
	}
};

var Filters = {
	_list: Object.create(null),
	_saveList() {
		chrome.storage.local.set({ 'filters': this._list });
	},
	getList() {
		let copy = Object.create(null);
		for (let k of Object.keys(this._list)) {
			copy[k] = this._list[k];
		}
		return copy;
	},
	/**
	 * Canonicalise a user-typed filter host so exact matching reliably fires.
	 * Trims, lowercases, extracts the host from a pasted URL, maps a leading
	 * `*.` wildcard to the leading-dot form (so the common `*.example.com`
	 * convention behaves like the documented `.example.com`), strips a path
	 * remainder and trailing FQDN dots while preserving a single leading
	 * wildcard dot. Returns `''` when nothing usable remains.
	 * @param {string} input
	 * @returns {string}
	 */
	normalizeHost(input) {
		let s = String(input == null ? '' : input).trim();
		if (!s) {
			return '';
		}
		if (/:\/\//.test(s)) {
			try { s = new URL(s).host; } catch (e) { /* not a URL — fall through */ }
		}
		s = s.toLowerCase().replace(/^\*\./, '.').replace(/\/.*$/, '');
		let lead = s.startsWith('.') ? '.' : '';
		return lead + s.replace(/^\.+/, '').replace(/\.+$/, '');
	},
	setFilter(host, limit) {
		if (limit == -1) {
			delete this._list[host];
		} else {
			this._list[host] = limit;
		}
		this._saveList();
	},
	clear() {
		this._list = Object.create(null);
		this._saveList();
	}
};
