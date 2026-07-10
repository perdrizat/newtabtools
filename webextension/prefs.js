/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Dual-scope bridge file (PAGE_MODULES.md Decision 2/6): `Prefs`/`Blocked`/
 * `Filters`/`NeverCapture` are real `export`s, consumed by real `import`s
 * from both scopes — `lib/background-main.js` and its background-side
 * consumers (`lib/tiles-store.js`, `lib/capture.js`, `lib/backup.js`,
 * `lib/messages.js`) on one side, `newTab.js`/`grid.js`/`site.js`/`cell.js`/
 * `awesomebar.js` on the page side. The four `globalThis.X = …` bridge
 * assignments that
 * survived through PAGE_MODULES.md (TEST-ONLY, for E2E/UAT page-context
 * evaluation) are retired as of chrome-prep C3d: the E2E/UAT harness now
 * drives the real page via messages/storage/DOM instead of reading page
 * globals, so nothing reads these off `globalThis` anymore — see
 * `tests/integration/module-scope.test.ts`'s negative assertion.
 *
 * The old direct-coupling branch in `prefsChanged` — sniffing
 * `'newTabTools' in window` and calling `newTabTools.updateUI`/
 * `Grid.refresh`/`Updater.updateGrid` directly — is gone. A real import in
 * that direction would drag the page into the background's module graph
 * (PAGE_MODULES.md Decision 6, the design problem the slice exists to
 * solve). `Prefs.onChange(listener)` replaces it: `prefsChanged` invokes
 * every registered listener with the array of changed pref names — the same
 * information the old branch consumed. The page registers its listener in
 * `page-main.js`, after the boot calls, reproducing the old dance exactly;
 * the background registers none. This file is now scope-pure — no reference
 * to `newTabTools`/`Grid`/`Updater`/`window` remains below.
 */

/**
 * `Prefs.init()` wires one getter + setter per name in its `names` list via
 * `__defineGetter__`/`__defineSetter__` — real accessor properties at
 * runtime, but not literal properties on the object below, so plain
 * inference can't see them. Declared here and intersected onto the exported
 * `Prefs` binding (below the object literal) so every consumer — a real
 * `import`, or the ambient `globalThis.Prefs` merge TypeScript's checked-JS
 * global-augmentation picks up from the `globalThis.Prefs = …` assignment at
 * the bottom of this file — sees the real shape.
 * @typedef {Object} PrefsAccessors
 * @property {string} theme
 * @property {number} opacity
 * @property {number} rows
 * @property {number} columns
 * @property {string[]} margin
 * @property {string} spacing
 * @property {string} titleSize
 * @property {string} tileAspect
 * @property {string} statType
 * @property {boolean} titleBarSearch
 * @property {string} actionIconSize
 * @property {boolean} tileActions
 * @property {string} tileRadius
 * @property {boolean} locked
 * @property {boolean} history
 * @property {boolean} recent
 * @property {number} thumbnailSize
 * @property {string} backgroundUrl
 * @property {string} backgroundPosition
 * @property {string} backgroundColor
 * @property {string|number} version
 */

const PrefsObject = {
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
	/** @type {string|number} */
	_version: -1,

	/** @type {Array<(keys: string[]) => void>} */
	_listeners: [],

	/**
	 * Register a listener to be invoked with the array of changed pref names
	 * whenever `prefsChanged` applies a non-trivial storage change (skipped
	 * for a thumbnailSize-only change, same as before this seam existed).
	 * The page registers its updateUI/refresh dance here (page-main.js); the
	 * background registers none.
	 * @param {(keys: string[]) => void} listener
	 * @returns {void}
	 */
	onChange(listener) {
		this._listeners.push(listener);
	},

	/**
	 * @returns {Promise<void>} Resolves once the initial storage read has
	 *   been applied via parsePrefs.
	 */
	async init() {
		// Prune keys for features removed during the v2 redesign so they don't
		// linger in storage or ride along in backups. `parsePrefs` already
		// ignores unknown keys, so this is housekeeping, not correctness.
		// Fire-and-forget: failure is logged, never surfaced to callers.
		browser.storage.local.remove(['toolbarIcon', 'titleBarClock', 'titleBarWordmark', 'titleBarStatus']).catch(console.error);

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

		// `__defineGetter__`/`__defineSetter__` are legacy Annex B methods, not
		// declared by the `ES2020`/`DOM` libs this project types against — cast
		// through `any` rather than widen `tsconfig.json`'s `lib` for two calls.
		let self = /** @type {any} */ (this);
		for (let n of names) {
			self.__defineGetter__(n, () => self['_' + n]);
			self.__defineSetter__(n, /** @param {unknown} value */ function(value) {
				/** @type {Record<string, unknown>} */
				let obj = {};
				obj[n] = value;
				// Fire-and-forget: failure is logged, never surfaced to callers.
				browser.storage.local.set(obj).catch(console.error);
			});
		}

		// Registered synchronously here — not after the storage.local.get
		// await below — so it's live the instant init() runs, rather than
		// only once that async read resolves. init() itself is called
		// synchronously at lib/background-main.js's top level, so this keeps
		// every respawn's listener registration synchronous top-to-bottom
		// (MV3 event-page respawn hygiene; see MV3_MIGRATION.md).
		chrome.storage.onChanged.addListener(this.prefsChanged.bind(this));

		let prefs = await browser.storage.local.get();
		this.parsePrefs(prefs);
	},
	/** @param {Record<string, any>} prefs */
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
		// Same shape as the per-tile `backgroundColor` validator in lib/backup.js.
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
		// Re-sync whenever the key is present in this change set. A removal
		// (newValue null/undefined, e.g. a storage reset) clears the in-memory
		// list so it stops suppressing captures the user no longer opted out of;
		// a present-but-corrupt (non-array) value is ignored, leaving the list
		// unchanged.
		if ('neverCaptureHosts' in prefs) {
			let value = prefs.neverCaptureHosts;
			if (Array.isArray(value)) {
				NeverCapture._list = value.filter(h => typeof h === 'string' && h.length > 0);
			} else if (value == null) {
				NeverCapture._list = [];
			}
		}
		if ('version' in prefs && typeof prefs.version == 'number' || typeof prefs.version == 'string') {
			this._version = prefs.version;
		}
	},
	/** @param {Record<string, {newValue: any, oldValue: any}>} changes */
	prefsChanged(changes) {
		/** @type {Record<string, any>} */
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

		for (let listener of this._listeners) {
			listener(keys);
		}
	},
};

/** @type {typeof PrefsObject & PrefsAccessors} */
export const Prefs = /** @type {any} */ (PrefsObject);

export const Blocked = {
	/** @type {string[]} */
	_list: [],
	/**
	 * Persist the current list. Never rejects — a write failure is logged
	 * and swallowed, matching the old callback-style behaviour (which never
	 * surfaced `runtime.lastError` either).
	 * @returns {Promise<void>}
	 */
	_saveList() {
		return browser.storage.local.set({ 'blocked': this._list }).catch(console.error);
	},
	/** @param {string} url */
	block(url) {
		this._list.push(url);
		return this._saveList();
	},
	/** @param {string} url */
	unblock(url) {
		let index = this._list.indexOf(url);
		if (index >= 0) {
			this._list.splice(index, 1);
		}
		return this._saveList();
	},
	/** @param {string} url */
	isBlocked(url) {
		return this._list.includes(url);
	},
	clear() {
		this._list.length = 0;
		return this._saveList();
	}
};

export const Filters = {
	_list: Object.create(null),
	// Fire-and-forget: failure is logged, never surfaced to callers.
	_saveList() {
		browser.storage.local.set({ 'filters': this._list }).catch(console.error);
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
	/**
	 * @param {string} host
	 * @param {number} limit
	 */
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

/**
 * NeverCapture — per-host opt-out list for auto-thumbnail capture.
 *
 * Entry format mirrors Tiles._hostFilteredOut:
 *   'example.com'  — exact host match only
 *   '.example.com' — matches the apex host AND any subdomain
 *
 * The list is persisted under the storage key 'neverCaptureHosts'.
 */
export const NeverCapture = {
	/** @type {string[]} */
	_list: [],

	/**
	 * Persist the current list to storage.local. Never rejects — a write
	 * failure is logged and swallowed, matching the old callback-style
	 * behaviour (which never surfaced `runtime.lastError` either).
	 * @returns {Promise<void>}
	 */
	_saveList() {
		return browser.storage.local.set({ 'neverCaptureHosts': this._list }).catch(console.error);
	},

	/**
	 * Canonicalise user input into a port-less host pattern. Runs
	 * Filters.normalizeHost (trims, lowercases, extracts host from a pasted URL,
	 * maps `*.x.com` → `.x.com`) then strips any trailing `:port` — the canonical
	 * entry is a bare hostname, matching how matches() keys on URL.hostname.
	 * @param {string} input
	 * @returns {string}
	 */
	_normalize(input) {
		return Filters.normalizeHost(input).replace(/:\d+$/, '');
	},

	/**
	 * Return a shallow copy of the host-pattern list.
	 * Callers may mutate the copy freely without affecting internal state.
	 * @returns {string[]}
	 */
	getList() {
		return this._list.slice();
	},

	/**
	 * Return the stored entry that matches `host`, or undefined if none.
	 * Exact entries match only the identical host; dot-prefixed entries match
	 * the apex and all subdomains (same rule as Tiles._hostFilteredOut).
	 * @param {string} host
	 * @returns {string | undefined}
	 */
	matchingEntry(host) {
		let dotEntries = this._list.filter(e => e.startsWith('.'));
		return this._list.includes(host) ? host : dotEntries.find(
			e => host === e.substring(1) || host.endsWith(e)
		);
	},

	/**
	 * Return true when the URL's hostname (port-less) is covered by any entry.
	 * Returns false on unparseable URLs and when the list is empty.
	 * @param {string} url
	 * @returns {boolean}
	 */
	matches(url) {
		try {
			let host = new URL(url).hostname;
			return this.matchingEntry(host) !== undefined;
		} catch (e) {
			return false;
		}
	},

	/**
	 * Return true when `host` is covered by `pattern`.
	 * Helper exposed for lib/capture.js's purgeNeverCaptureHost cursor passes.
	 * @param {string} host
	 * @param {string} pattern
	 * @returns {boolean}
	 */
	hostMatchesPattern(host, pattern) {
		if (pattern.startsWith('.')) {
			return host === pattern.substring(1) || host.endsWith(pattern);
		}
		return host === pattern;
	},

	/**
	 * Add a host pattern to the list.
	 * Normalizes `input` to a port-less host pattern. Empty / garbage input and
	 * already-listed hosts are no-ops. Always returns a Promise so callers can
	 * chain `.then()` unconditionally.
	 * @param {string} input
	 * @returns {Promise<void>}
	 */
	add(input) {
		let host = this._normalize(input);
		if (!host || this._list.includes(host)) {
			return Promise.resolve();
		}
		this._list.push(host);
		return this._saveList();
	},

	/**
	 * Remove the entry that covers `input` from the list.
	 * First normalizes `input` to a host pattern, then removes the matching
	 * stored entry (which may differ — e.g. input 'a.example.com' removes
	 * the stored entry '.example.com' if that pattern covers the host).
	 * @param {string} input
	 * @returns {Promise<void>}
	 */
	remove(input) {
		let host = this._normalize(input);
		let entry = host ? this.matchingEntry(host) : undefined;
		// Fall back to exact match against the raw normalized value in case
		// no matchingEntry logic applies (direct pattern removal).
		if (entry === undefined) {
			entry = this._list.includes(host) ? host : undefined;
		}
		if (entry !== undefined) {
			let index = this._list.indexOf(entry);
			if (index >= 0) {
				this._list.splice(index, 1);
			}
		}
		return this._saveList();
	},

	/**
	 * Clear the entire list and persist.
	 * @returns {Promise<void>}
	 */
	clear() {
		this._list.length = 0;
		return this._saveList();
	},
};

