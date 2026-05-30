/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported AwesomeBar */
/* globals Grid, NttIcons, Prefs, newTabTools */

/**
 * Awesome bar (Phase 4-3). Wires the titlebar search box into a dropdown that
 * searches the user's tiles, bookmarks, and history, plus a "search the web"
 * fallback through the default engine. The result model (`buildResults`) and
 * the cursor math (`nextIndex`) are pure and unit-tested; everything else is
 * DOM / WebExtension glue installed by `init()` (called from newTabTools
 * startup — the module does not self-init so it loads cleanly under test).
 */
var AwesomeBar = {
	HTML_NS: 'http://www.w3.org/1999/xhtml',

	// Per-section human labels for the dropdown headers.
	SECTION_LABELS: {
		top: 'Top match',
		match: 'Bookmarks & tiles',
		history: 'History',
		web: 'Search the web',
	},

	// ---- pure result model -------------------------------------------------

	/**
	 * Build the ordered, de-duplicated, sectioned result list for `query`.
	 *
	 * @param {string} query Raw search text.
	 * @param {{tiles?, bookmarks?, history?}} sources Arrays of {url, title}.
	 * @param {{limit?: number}} [opts] Per-section cap for match/history.
	 * @returns {Array<{section, type, title, url, query?}>}
	 *   `section` ∈ top|match|history|web, `type` ∈ tile|bookmark|history|search.
	 *   Always ends with exactly one `type:'search'` web entry. Empty array for
	 *   a blank query.
	 */
	buildResults(query, sources, opts) {
		let q = (query || '').trim();
		if (!q) {
			return [];
		}
		let limit = (opts && opts.limit) || 6;
		let terms = q.toLowerCase().split(/\s+/).filter(Boolean);
		let matches = item => {
			let hay = ((item.title || '') + ' ' + (item.url || '')).toLowerCase();
			return terms.every(t => hay.includes(t));
		};

		// Priority order tile > bookmark > history; first writer per URL wins.
		let seen = new Set();
		let take = (list, type) => {
			let out = [];
			for (let item of (list || [])) {
				if (!item || !item.url || seen.has(item.url) || !matches(item)) {
					continue;
				}
				seen.add(item.url);
				out.push({ type, title: item.title || item.url, url: item.url });
			}
			return out;
		};

		let tiles = take(sources && sources.tiles, 'tile');
		let bookmarks = take(sources && sources.bookmarks, 'bookmark');
		let history = take(sources && sources.history, 'history');

		let results = [];

		// Top match: the single highest-priority local hit, promoted out of its
		// section so it is never shown twice.
		let matchPool = tiles.concat(bookmarks);
		let top = matchPool.shift() || history.shift() || null;
		if (top) {
			results.push({ section: 'top', type: top.type, title: top.title, url: top.url });
		}

		for (let m of matchPool.slice(0, limit)) {
			results.push({ section: 'match', type: m.type, title: m.title, url: m.url });
		}
		for (let h of history.slice(0, limit)) {
			results.push({ section: 'history', type: h.type, title: h.title, url: h.url });
		}

		results.push({ section: 'web', type: 'search', title: q, url: null, query: q });
		return results;
	},

	/**
	 * Wrap-around cursor for Up/Down navigation. `delta` is +1 (down) or -1
	 * (up). From no-selection (-1) a Down lands on the first item and an Up on
	 * the last. Returns -1 when the list is empty.
	 */
	nextIndex(current, count, delta) {
		if (count <= 0) {
			return -1;
		}
		if (current < 0) {
			return delta > 0 ? 0 : count - 1;
		}
		return (current + delta + count) % count;
	},

	// ---- DOM / browser glue ------------------------------------------------

	_results: [],
	_index: -1,
	_queryToken: 0,
	_permChecked: false,
	_hasHistoryBookmarks: false,

	init() {
		this.input = document.getElementById('ntt-search-input');
		this.searchBox = document.getElementById('ntt-search');
		if (!this.input || !this.searchBox) {
			return;
		}

		// Dropdown anchored under the search box.
		this.dropdown = document.createElementNS(this.HTML_NS, 'div');
		this.dropdown.id = 'ntt-awesomebar';
		this.dropdown.hidden = true;
		this.searchBox.appendChild(this.dropdown);

		this.input.addEventListener('input', () => this._query(this.input.value));
		this.input.addEventListener('focus', () => {
			this._checkPermission();
			if (this.input.value.trim()) {
				this._query(this.input.value);
			}
		});
		this.input.addEventListener('keydown', e => this._onKeydown(e));
		// Keep the input focused while clicking a result (mousedown would blur
		// it first and close the dropdown before the click lands).
		this.dropdown.addEventListener('mousedown', e => e.preventDefault());
		this.dropdown.addEventListener('click', e => this._onResultClick(e));
		this.input.addEventListener('blur', () => {
			// Defer so an in-flight result click can run first.
			setTimeout(() => this.close(), 150);
		});

		// `/` focuses search from anywhere on the page. Capture phase so we
		// preempt Firefox's Quick Find before it swallows the key.
		document.addEventListener('keydown', e => this._onGlobalKey(e), true);
	},

	_checkPermission() {
		if (this._permChecked) {
			return;
		}
		this._permChecked = true;
		try {
			chrome.permissions.contains({ permissions: ['bookmarks', 'history'] }, granted => {
				this._hasHistoryBookmarks = !!granted;
			});
		} catch (e) {
			this._hasHistoryBookmarks = false;
		}
	},

	_onGlobalKey(event) {
		if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		let active = document.activeElement;
		let tag = active && active.tagName ? active.tagName.toLowerCase() : '';
		if (active === this.input || tag === 'input' || tag === 'textarea' || (active && active.isContentEditable)) {
			return;
		}
		if (typeof Prefs !== 'undefined' && Prefs && Prefs.titleBarSearch === false) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.input.focus();
	},

	_onKeydown(event) {
		switch (event.key) {
		case 'ArrowDown':
		case 'ArrowUp':
			if (!this._results.length) {
				return;
			}
			event.preventDefault();
			this._select(this.nextIndex(this._index, this._results.length, event.key === 'ArrowDown' ? 1 : -1));
			break;
		case 'Enter': {
			let result = this._results[this._index] || this._results[0];
			if (result) {
				event.preventDefault();
				this._activate(result, event.ctrlKey || event.metaKey);
			}
			break;
		}
		case 'Escape':
			if (!this.dropdown.hidden) {
				event.preventDefault();
				event.stopPropagation();
			}
			this.input.value = '';
			this.close();
			this.input.blur();
			break;
		}
	},

	_query(value) {
		let q = (value || '').trim();
		if (!q) {
			this.close();
			return;
		}
		let token = ++this._queryToken;
		Promise.all([this._tiles(q), this._bookmarks(q), this._history(q)]).then(([tiles, bookmarks, history]) => {
			if (token !== this._queryToken) {
				return; // a newer query superseded this one
			}
			this._render(this.buildResults(q, { tiles, bookmarks, history }));
		});
	},

	_tiles() {
		let out = [];
		if (typeof Grid !== 'undefined' && Grid && Grid.sites) {
			for (let s of Grid.sites) {
				if (s && s.url) {
					out.push({ url: s.url, title: s.title || s.url });
				}
			}
		}
		return Promise.resolve(out);
	},

	_bookmarks(q) {
		return new Promise(resolve => {
			try {
				chrome.bookmarks.search(q, results => {
					resolve((results || [])
						.filter(b => b.url)
						.map(b => ({ url: b.url, title: b.title || b.url })));
				});
			} catch (e) {
				resolve([]);
			}
		});
	},

	_history(q) {
		return new Promise(resolve => {
			try {
				chrome.history.search({ text: q, startTime: 0, maxResults: 12 }, results => {
					resolve((results || [])
						.filter(h => h.url)
						.map(h => ({ url: h.url, title: h.title || h.url })));
				});
			} catch (e) {
				resolve([]);
			}
		});
	},

	_iconFor(type) {
		let name = { tile: 'grid', bookmark: 'bookmark', history: 'history', search: 'search' }[type] || 'search';
		if (typeof NttIcons !== 'undefined' && NttIcons.create) {
			return NttIcons.create(name, 15);
		}
		let span = document.createElementNS(this.HTML_NS, 'span');
		return span;
	},

	_render(results) {
		this._results = results;
		this._index = -1;
		while (this.dropdown.firstChild) {
			this.dropdown.removeChild(this.dropdown.firstChild);
		}
		if (!results.length) {
			this.close();
			return;
		}

		let rowIndex = 0;
		let lastSection = null;
		for (let r of results) {
			if (r.section !== lastSection) {
				lastSection = r.section;
				let header = document.createElementNS(this.HTML_NS, 'div');
				header.className = 'ntt-awesomebar-section';
				header.textContent = this.SECTION_LABELS[r.section] || r.section;
				this.dropdown.appendChild(header);
			}

			let row = document.createElementNS(this.HTML_NS, 'div');
			row.className = 'ntt-awesomebar-row';
			row.dataset.index = String(rowIndex++);
			if (r.section === 'top') {
				row.classList.add('top');
			}
			row.appendChild(this._iconFor(r.type));

			let text = document.createElementNS(this.HTML_NS, 'span');
			text.className = 'ntt-awesomebar-text';
			let title = document.createElementNS(this.HTML_NS, 'span');
			title.className = 'ntt-awesomebar-title';
			title.textContent = r.type === 'search' ? `Search the web for “${r.query}”` : r.title;
			text.appendChild(title);
			if (r.url) {
				let url = document.createElementNS(this.HTML_NS, 'span');
				url.className = 'ntt-awesomebar-url';
				url.textContent = r.url;
				text.appendChild(url);
			}
			row.appendChild(text);
			this.dropdown.appendChild(row);
		}

		this.dropdown.hidden = false;
		document.documentElement.setAttribute('awesomebar-open', '');
		this._select(0);
	},

	_select(index) {
		this._index = index;
		let rows = this.dropdown.querySelectorAll('.ntt-awesomebar-row');
		for (let row of rows) {
			row.classList.toggle('selected', Number(row.dataset.index) === index);
		}
	},

	_onResultClick(event) {
		let row = event.target.closest ? event.target.closest('.ntt-awesomebar-row') : null;
		if (!row) {
			return;
		}
		let result = this._results[Number(row.dataset.index)];
		if (result) {
			this._activate(result, event.ctrlKey || event.metaKey);
		}
	},

	_activate(result, newTab) {
		if (result.type === 'search') {
			try {
				browser.search.search({
					query: result.query,
					disposition: newTab ? 'NEW_TAB' : 'CURRENT_TAB',
				});
			} catch (e) {
				// Fallback: hand the query to the address bar's default engine
				// by navigating the current tab to a search URL is not possible
				// without the engine; swallow rather than throw.
				console.error('awesomebar: web search failed', e);
			}
			this.close();
			return;
		}

		let url = result.url;
		if (typeof newTabTools !== 'undefined' && newTabTools.isValidURL && !newTabTools.isValidURL(url)) {
			return;
		}
		if (newTab) {
			chrome.tabs.create({ url });
		} else {
			chrome.tabs.update({ url });
		}
		this.close();
	},

	close() {
		if (this.dropdown) {
			this.dropdown.hidden = true;
			while (this.dropdown.firstChild) {
				this.dropdown.removeChild(this.dropdown.firstChild);
			}
		}
		this._results = [];
		this._index = -1;
		if (typeof document !== 'undefined' && document.documentElement) {
			document.documentElement.removeAttribute('awesomebar-open');
		}
	},
};
