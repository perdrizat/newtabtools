/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// page-modules P5 (PAGE_MODULES.md): real imports replace the former
// `/* globals */` header. `Grid` (grid.js) and `Page` (page.js) each form a
// legal ESM cycle with this file (Decision 3) — every cross-reference below
// is call-time only (inside functions/callbacks), never a top-level read, so
// the cycle's evaluation order (grid.js's/page.js's own top level, which
// import this file, finish before this file's top level runs — see
// PAGE_MODULES.md's P5 checklist note) never matters. `Updater` (updater.js,
// chrome-prep C4a, CHROME_PREP.md) is imported directly below too.
import { AwesomeBar } from './awesomebar.js';
import { Background, Tiles } from './tiles-shim.js';
import { NttIcons } from './icons.js';
import { TileStats } from './stats.js';
import { Blocked, Filters, NeverCapture, Prefs } from './prefs.js';
import { compareVersions, getString, isValidURL } from './common.js';
import { Grid } from './grid.js';
import { Page } from './page.js';
import { Updater } from './updater.js';
import { el } from './dom.js';

/**
 * Runtime-added UI-element refs read from OUTSIDE this file (grid.js's and
 * site.js's cycle imports, plus page-main.js). The object literal below is
 * the method surface; the post-literal IIFE at the bottom of this file
 * assigns these three properties (plus every other `uiElements` entry — see
 * the literal's own declared placeholders below, the Cell.prototype
 * `position`/`_grid` convention, cell.js) at runtime, invisible to structural
 * inference of the literal on its own. Declared here and intersected onto the
 * exported `newTabTools` binding (below the literal) — the exact prefs.js
 * `PrefsAccessors` const-impl + typed-export pattern — so grid.js's/site.js's
 * cycle imports see the real shape through their PLAIN import, with no
 * top-level read of the cycle binding on the importing side (PAGE_MODULES.md
 * Decision 3; the chrome-prep C3b TDZ incident is why that matters — see
 * CHROME_PREP.md's C3b entry). Kept deliberately narrow
 * (chrome-prep C3c, CHROME_PREP.md): only the refs an EXTERNAL cycle import
 * actually reads go here — every other `uiElements` ref is declared directly
 * on the object literal instead (so this file's own methods see them too,
 * which an intersection applied only to the export binding never would —
 * `this` inside a method is typed from the literal's own inferred shape).
 * @typedef {Object} NewTabToolsPageRefs
 * @property {HTMLElement} page
 * @property {HTMLElement} databaseError
 * @property {number | null} selectedSiteIndex
 */

/**
 * A tab/bookmark/history item as read by `autocomplete`'s `maybeAddItem` —
 * `browser.tabs.Tab`/`browser.bookmarks.BookmarkTreeNode`/`browser.history.
 * HistoryItem` all declare `title` optional. `maybeAddItem` used to assume it
 * was always present and call `item.title.toLowerCase()` unguarded — a real
 * title-less tab/history entry threw there, killing the whole autocomplete
 * pass (surfaced report-only by chrome-prep C3c's typing pass; fixed per
 * maintainer adjudication, interim round between C4b/C4c: `maybeAddItem`
 * normalizes a missing `title` to `''` at the boundary before using it).
 * `url` stays required — nothing normalizes a missing URL, matching the
 * existing (unguarded) assumption there.
 * @typedef {{url: string, title?: string}} AutocompleteCandidate
 */

/**
 * The persisted tile/link shape — reused from tiles-shim.js (already
 * imported for `Tiles`/`Background`), the same `Link` alias site.js declares
 * for its own copy of this typedef (site.js owns `Link` — see its own
 * typedef-ownership note).
 * @typedef {import('./tiles-shim.js').Tile} Link
 */

/**
 * `Site`, the site.js constructor-function this file reads via
 * `this.selectedSite`/`Grid.sites[...]` — a type-only import (erased at
 * compile time, so reading it here is NOT a top-level read of the site.js
 * cycle binding; Decision 3 only restricts VALUE reads).
 * @typedef {import('./site.js').Site} Site
 */

/**
 * `CellNode`/`SiteNode` — the expando back-reference typedefs `Cell`/`Site`
 * declare for their DOM nodes, reused here (type-only import, same
 * TDZ-safety note as `Site` above) for the context-menu handlers, which walk
 * cell/site DOM structure directly instead of going through `Grid`. Owned by
 * cell.js (`CellNode`) and site.js (`SiteNode`) respectively.
 * @typedef {import('./cell.js').CellNode} CellNode
 * @typedef {import('./site.js').SiteNode} SiteNode
 */

/**
 * A normalized Firefox new-tab wallpaper record — `fetchFirefoxWallpapers`'s
 * output shape (parsed from `RawWallpaperRecord`), consumed by
 * `renderWallpaperGrid`/`selectWallpaper`/`_wallpaperCache`.
 * @typedef {Object} WallpaperRecord
 * @property {string} title
 * @property {string} [theme]
 * @property {string} category
 * @property {string} [attribution]
 * @property {string} backgroundPosition
 * @property {string} [imageUrl]
 * @property {string} [solidColor]
 */

/**
 * One entry of the raw Firefox Remote Settings wallpaper collection JSON
 * (`fetchFirefoxWallpapers`'s fetch response, `json.data`) — untyped over
 * the wire, so this typedef documents only the fields that function reads.
 * @typedef {Object} RawWallpaperRecord
 * @property {string} category
 * @property {string} title
 * @property {string} [theme]
 * @property {string} [attribution]
 * @property {string} [background_position]
 * @property {{location?: string}} [attachment]
 * @property {string} [solid_color]
 */

/**
 * `browser.tabs.Tab` really does carry a `lastModified` timestamp when
 * obtained via the `sessions` API (`browser.sessions.Session.tab`) — real at
 * runtime, missing from `@types/firefox-webext-browser`'s `Tab` interface (a
 * gap in the third-party package). Used by `refreshRecent`'s destructure.
 * @typedef {browser.tabs.Tab & {lastModified?: number}} SessionTab
 */

/**
 * A delegated click/change event's `event.target`, before we know which
 * concrete element type fired it (`optionsOnClick`/`optionsOnChange`/
 * `drawerOnClick`/`drawerOnChange` all listen on the whole drawer or window).
 * Every member here is optional because only some concrete target elements
 * declare it — e.g. reading `.disabled` off a `<div>` target is `undefined`
 * (falsy), which is exactly what the unguarded checks below rely on.
 * @typedef {HTMLElement & {disabled?: boolean, value?: string, checked?: boolean, name?: string, type?: string}} DelegatedEventTarget
 */

const NewTabToolsObject = {
	// Internal state fields assigned via `this.x = …` inside methods below,
	// not visible to the object literal's structural inference unless
	// declared as literal keys up front (the Cell.prototype `position`/`_grid`
	// precedent, cell.js). None of these are read by grid.js/site.js, so
	// they stay off `NewTabToolsPageRefs` — internal to this file only.
	/** @type {number | null} */
	_selectedSiteIndex: null,
	/**
	 * Cached Firefox wallpaper catalogue (memoized by fetchFirefoxWallpapers).
	 * @type {WallpaperRecord[] | undefined}
	 */
	_wallpaperCache: undefined,
	/**
	 * Cached `browser.theme.getCurrent()`/`onUpdated` payload (updateThemeColours).
	 * @type {browser._manifest.ThemeType | null | undefined}
	 */
	_theme: undefined,
	/**
	 * Titlebar recently-closed-row ResizeObserver (_initTitlebar).
	 * @type {ResizeObserver | undefined}
	 */
	_titlebarResizeObserver: undefined,
	/**
	 * Cached recent-card capacity from the last _layoutTitlebar() call.
	 * @type {number | undefined}
	 */
	_recentCardCount: undefined,
	/**
	 * Object URLs created for recently-closed-tab favicon fallbacks
	 * (refreshRecent) — revoked before the next render (§4.3).
	 * @type {string[] | undefined}
	 */
	_recentFaviconURLs: undefined,
	/**
	 * Timestamp of the last auto-save (_markAutoSaved/_renderAutoSavedIndicator).
	 * @type {number | null}
	 */
	_autoSavedAt: null,
	/**
	 * Interval id for the auto-saved-indicator relative-time tick
	 * (_initAutoSaveIndicator). `ReturnType<typeof setInterval>` rather than
	 * `number`: this program's `types` array includes `"node"` alongside
	 * `"dom"` (for the test-side vitest/Node surface), so ambient
	 * `setInterval` resolves to Node's `Timeout`-returning overload here even
	 * though this file runs in the browser page, where it's really a
	 * `number` — deriving the type sidesteps the conflict either way.
	 * @type {ReturnType<typeof setInterval> | undefined}
	 */
	_autoSaveTickInterval: undefined,

	// Runtime-added UI-element refs (the `uiElements` id → `document.
	// getElementById` lookup loop in the post-literal IIFE at the bottom of
	// this file). `page`/`databaseError`/`selectedSiteIndex` are ALSO on
	// `NewTabToolsPageRefs` above (grid.js's/site.js's cycle imports read
	// them). Typed non-null, matching that convention: every method below
	// only ever runs after `startup()` (called once, at the bottom of this
	// file), by which point the IIFE has already populated every ref — same
	// call-time guarantee `NewTabToolsPageRefs` relies on for
	// `page`/`databaseError`. The declared value has to bridge through
	// `unknown` (a direct `null` → non-null-element assertion doesn't
	// type-check — neither type sufficiently overlaps the other); this is the
	// file's placeholder-value idiom (see site.js's `refreshThumbnail`/
	// `Transformation.intersect` casts for the same double-cast shape).
	/** @type {HTMLLinkElement} */
	darkIcons: /** @type {HTMLLinkElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	backgroundFake: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	optionsToggleButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	pinURLBlocked: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	pinURLInput: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	pinURLButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	pinURLAutocomplete: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	siteThumbnail: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	siteURLInput: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	setURLButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	saveCurrentThumbButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	setSavedThumbInput: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	removeSavedThumbButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	setBgColourInput: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	setBgColourDisplay: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	setBgColourButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	resetBgColourButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	editSiteTitleRow: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	setTitleInput: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	setTitleButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	removeBackgroundButton: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	recentList: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	drawerEl: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	optionsFilter: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	optionsFilterHost: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	optionsFilterHostAutocomplete: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	optionsFilterCount: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	optionsFilterSet: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	optionsNeverCapture: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	optionsNeverCaptureHost: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLButtonElement} */
	optionsNeverCaptureAdd: /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLElement} */
	optionsNeverCaptureList: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),

	// P2-P5 review finding 1 (revised remediation, 2026-07-10): the bodies
	// moved to common.js's `getString`/`isValidURL` (shared page-side leaf
	// utilities, importable without dragging this monolith along); these
	// stay as one-line delegates since many internal call sites and tests
	// still use `newTabTools.getString`/`isValidURL`.
	/**
	 * @param {string} name
	 * @param {...string} substitutions
	 * @returns {string}
	 */
	getString(name, ...substitutions) {
		return getString(name, ...substitutions);
	},
	/**
	 * @param {string} url
	 * @returns {boolean}
	 */
	isValidURL(url) {
		return isValidURL(url);
	},
	/**
	 * @param {string} raw
	 * @returns {string}
	 */
	normalizePinURL(raw) {
		let v = (raw || '').trim();
		if (!v) {
			return '';
		}
		// Auto-prepend https:// when the user types a bare domain or path.
		return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
	},
	/**
	 * @param {string} url
	 * @returns {Promise<string | null>}
	 */
	historyTitleFor(url) {
		// Look up the title that Firefox knows for `url` (browsing history).
		// Resolves to a string or null. Never rejects: if the optional
		// `history` permission is not granted, this just returns null.
		return new Promise(resolve => {
			try {
				chrome.history.search({ text: url, startTime: 0 }, /** @param {browser.history.HistoryItem[]} results */ results => {
					let entry = (results || []).find(/** @param {browser.history.HistoryItem} r */ r => r.url === url);
					resolve((entry && entry.title) || null);
				});
			} catch (e) {
				resolve(null);
			}
		});
	},
	autocomplete() {
		let normalized = this.normalizePinURL(this.pinURLInput.value);
		this.pinURLButton.disabled = !this.isValidURL(normalized);
		let value = this.pinURLInput.value;
		if (value.length < 2) {
			this.pinURLAutocomplete.hidden = true;
			while (this.pinURLAutocomplete.lastChild) {
				this.pinURLAutocomplete.lastChild.remove();
			}
			return;
		}
		let valueParts = value.toLowerCase().split(/\s+/);

		let count = 0;
		// Autocomplete `<li>` options carry `dataset.url`/`dataset.title` —
		// `.children` types as bare `Element`, cast to the `HTMLElement` every
		// read below needs (dataset/hidden).
		let options = /** @type {HTMLElement[]} */ (Array.from(this.pinURLAutocomplete.children));
		let urls = options.filter(u => {
			if (u == this.pinURLBlocked) {
				return false;
			}
			// `dataset.url`/`dataset.title` type as `string | undefined`
			// (DOMStringMap); every option here was built by this same
			// function (or the `options-pinURL-blocked` markup, filtered out
			// above), so both are always set in practice — cast, not a guard.
			let url = /** @type {string} */ (u.dataset.url);
			let title = /** @type {string} */ (u.dataset.title);
			let matches = valueParts.every(vp => url.toLowerCase().includes(vp) || title.toLowerCase().includes(vp));
			if (matches) {
				count++;
			}
			u.hidden = count > 10 || !matches;
			return matches;
		}).map(u => /** @type {string} */ (u.dataset.url));

		let exact = options.find(function(u) {
			return u.dataset.url == value;
		});
		if (exact) {
			this.pinURLAutocomplete.insertBefore(exact, this.pinURLAutocomplete.firstChild);
		}

		if (count >= 10) {
			this.pinURLAutocomplete.hidden = false;
			return;
		}

		// No null-check: this template sibling is always present in
		// newTab.html's markup (same unguarded assumption as every other
		// `.content`-reading template lookup in this file/grid.js).
		let template = /** @type {HTMLTemplateElement} */ (newTabTools.pinURLAutocomplete.nextElementSibling);
		/**
		 * @param {AutocompleteCandidate} item
		 * @param {string} type
		 */
		let maybeAddItem = (item, type) => {
			// Boundary normalization (chrome-prep interim fix, C4b/C4c):
			// `title` is optional on all three source shapes
			// (`browser.tabs.Tab`/`BookmarkTreeNode`/`HistoryItem`) — a
			// title-less item used to throw on `item.title.toLowerCase()`
			// below (killing the whole autocomplete pass) and, past that
			// guard, would have stored the literal string `"undefined"` into
			// `dataset.title` (DOMStringMap assignment stringifies its
			// value). Normalize once, here, so every read below sees a plain
			// string.
			let title = item.title || '';
			if (!this.isValidURL(item.url) || urls.includes(item.url)) {
				return;
			}
			if (!valueParts.every(vp => item.url.toLowerCase().includes(vp) || title.toLowerCase().includes(vp))) {
				return;
			}

			let option = /** @type {HTMLElement} */ (/** @type {Element} */ (template.content.firstElementChild).cloneNode(true));
			option.classList.add(type);
			if (Tiles.isPinned(item.url)) {
				option.classList.add('pinned');
			}
			option.dataset.title = /** @type {HTMLElement} */ (option.querySelector('.autocomplete-title')).textContent = title;
			option.dataset.url = /** @type {HTMLElement} */ (option.querySelector('.autocomplete-url')).textContent = item.url;
			if (++count > 10) {
				option.hidden = true;
			}
			if (item.url == value) {
				this.pinURLAutocomplete.insertBefore(option, this.pinURLAutocomplete.firstChild);
			} else {
				this.pinURLAutocomplete.appendChild(option);
			}

			this.getThemedImageURL(type, 'dark').then(url => {
				/** @type {HTMLElement} */ (option.querySelector('.autocomplete-icon')).style.backgroundImage = /** @type {string} */ (url ? `url(${url})` : null);
			});
			urls.push(item.url);
		};

		chrome.tabs.query({}, /** @param {browser.tabs.Tab[]} tabs */ tabs => {
			for (let t of tabs) {
				maybeAddItem(/** @type {AutocompleteCandidate} */ (t), 'tab');
			}

			if (count >= 10) {
				this.pinURLAutocomplete.hidden = false;
				return;
			}

			if (!this.pinURLBlocked.hidden) {
				this.pinURLAutocomplete.appendChild(this.pinURLBlocked);
				this.pinURLAutocomplete.hidden = false;
				return;
			}

			chrome.bookmarks.getTree(/** @param {browser.bookmarks.BookmarkTreeNode[]} tree */ tree => {
				/** @param {browser.bookmarks.BookmarkTreeNode[]} children */
				function traverse(children) {
					for (let c of children) {
						if (c.type == 'folder') {
							// No guard on `c.children` (typed `| undefined`,
							// a folder with none) — existing assumption,
							// unchanged; a real such folder would already
							// throw here (`for…of undefined`) before this
							// slice too. Latent gap, reported not fixed
							// (chrome-prep C3c).
							traverse(/** @type {browser.bookmarks.BookmarkTreeNode[]} */ (c.children));
						} else if (c.type == 'bookmark') {
							maybeAddItem(/** @type {AutocompleteCandidate} */ (c), 'bookmark');
						}
					}
				}

				// No null/empty-array guard on `tree[0].children`: the real
				// bookmarks root always has children (existing assumption,
				// unchanged).
				traverse(/** @type {browser.bookmarks.BookmarkTreeNode[]} */ (tree[0].children));

				if (count >= 10) {
					this.pinURLAutocomplete.hidden = false;
					return;
				}

				chrome.history.search({
					text: value,
					startTime: 0
				}, /** @param {browser.history.HistoryItem[]} result */ result => {
					for (let r of result) {
						maybeAddItem(/** @type {AutocompleteCandidate} */ (r), 'history');
					}
					this.pinURLAutocomplete.hidden = !count;
				});
			});
		});
	},
	/** @param {string} url */
	setPinURLInputValue(url) {
		this.pinURLInput.value = url;
		this.pinURLInput.focus();
		this.pinURLInput.selectionStart = this.pinURLInput.selectionEnd = url.length;
		this.pinURLButton.disabled = !this.pinURLInput.checkValidity() || !this.isValidURL(url);
		this.pinURLAutocomplete.hidden = true;
	},
	get selectedSite() {
		// `_selectedSiteIndex` is `number | null`; indexing an array with
		// `null` at runtime coerces it to the string key `'null'` (never a
		// valid index), so this already evaluates to `undefined` exactly
		// like a genuine out-of-range `number` would — the cast documents
		// that instead of changing the (unguarded) lookup.
		return Grid.sites[/** @type {number} */ (this._selectedSiteIndex)];
	},
	/** @param {MouseEvent} event */
	optionsOnClick(event) {
		// `event.target` is read repeatedly across this delegated handler
		// (attached once on the whole drawer) — cast once, matching
		// site.js's `_onClick`/drag-drop.js's `_dispatchEvent` precedent,
		// rather than re-casting at every read. `DelegatedEventTarget` covers
		// the various optional form-control members read below
		// (`disabled`/`dataset`) that only some concrete target elements
		// actually declare.
		let target = /** @type {DelegatedEventTarget} */ (event.target);
		if (target.disabled) {
			return;
		}
		let {id, classList} = target;
		switch (id) {
		case 'options-pinURL-permissions':
			chrome.permissions.request({permissions: ['bookmarks', 'history']}, /** @param {boolean} succeeded */ (succeeded) => {
				if (succeeded) {
					this.pinURLBlocked.hidden = true;
					this.pinURLInput.focus();
					this.autocomplete();
				}
			});
			return;
		case 'options-pinURL': {
			let pinUrl = this.normalizePinURL(this.pinURLInput.value);
			if (!this.isValidURL(pinUrl)) {
				throw 'URL is invalid';
			}
			Tiles.getTile(pinUrl).then(async tile => {
				if (tile) {
					return tile;
				}
				let historyTitle = await this.historyTitleFor(pinUrl);
				return historyTitle ? { url: pinUrl, title: historyTitle } : { url: pinUrl };
			}).then(tile => {
				// `'position' in tile` narrows `tile` to the `Link` branch
				// but not `tile.position` itself to non-`undefined` (an
				// optional key can be present with an `undefined` value) —
				// existing code never guarded that; cast, not a fix.
				if ('position' in tile && /** @type {number} */ (tile.position) < Prefs.rows * Prefs.columns) {
					return /** @type {number} */ (tile.position);
				}
				let cell = Grid.cells.find(c => !c.containsPinnedSite());
				if (!cell) {
					throw 'No free space';
				}
				/** @type {Link} */ (tile).position = cell.index;
				return Tiles.putTile(/** @type {Link} */ (tile)).then(() => cell.index);
			}).then(pos => new Promise(resolve => {
				Updater.updateGrid(() => resolve(pos));
			})).then(pos => {
				newTabTools.setPinURLInputValue('');
				let site = Grid.sites[pos] || Grid.sites.find(s => s && s.url === pinUrl);
				if (site && site.cell) {
					newTabTools.selectedSiteIndex = site.cell.index;
				}
			}).catch(console.error);
			break;
		}
		case 'options-url-set': {
			let nextUrl = this.normalizePinURL(this.siteURLInput.value);
			if (!this.isValidURL(nextUrl) || !this.selectedSite) {
				return;
			}
			let link = /** @type {Site} */ (this.selectedSite).link;
			link.url = nextUrl;
			delete link.title;
			link.titleIsUserSet = false;
			// Refresh the title from browsing history if available; the
			// user can always override it via Set Title afterwards.
			this.historyTitleFor(nextUrl).then(historyTitle => {
				if (historyTitle) {
					link.title = historyTitle;
				}
				/** @type {Site} */ (this.selectedSite).addTitle();
				Tiles.putTile(link);
				if (this.setTitleInput) {
					this.setTitleInput.value = link.title || '';
				}
			});
			break;
		}
		case 'options-url-remove':
			// Per the redesign, the URL row's Remove deletes/unpins the tile —
			// the same effect as the board's ✕ action.
			if (this.selectedSite && typeof this.selectedSite.block === 'function') {
				this.selectedSite.block().catch(/** @param {unknown} e */ e => console.error('remove tile failed:', e));
			}
			this.selectedSiteIndex = null;
			break;
		case 'options-savethumb':
			let link = /** @type {Site} */ (this.selectedSite).link;
			let siteURL = link.url;
			chrome.runtime.sendMessage({
				name: 'Thumbnails.get',
				urls: [siteURL]
			}, /** @param {Map<string, Blob>} thumbs */ thumbs => {
				let blob = thumbs.get(siteURL);
				if (!blob) {
					return;
				}
				link.image = blob;
				link.imageIsThumbnail = true;
				Tiles.putTile(link);
				this.saveCurrentThumbButton.disabled = true;
				this.removeSavedThumbButton.disabled = false;
			});
			break;
		case 'options-savedthumb-set':
			this.setThumbnail(/** @type {Site} */ (this.selectedSite), URL.createObjectURL(/** @type {FileList} */ (this.setSavedThumbInput.files)[0]));
			this.removeSavedThumbButton.disabled = false;
			break;
		case 'options-savedthumb-remove':
			this.removeThumbnail(/** @type {Site} */ (this.selectedSite));
			this.removeSavedThumbButton.disabled = true;
			break;
		case 'options-savedimg-clear': {
			// Clear the chosen file in the "Choose image" picker (not the applied
			// image — the Pin-row Remove reverts that).
			this.setSavedThumbInput.value = '';
			let setBtn = document.getElementById('options-savedthumb-set');
			if (setBtn) { /** @type {HTMLButtonElement} */ (setBtn).disabled = true; }
			target.disabled = true;
			let row = target.closest('.options-row');
			let nameEl = row && row.querySelector('.ntt-file-name');
			if (nameEl) { nameEl.textContent = this.getString('backup_no_file'); }
			break;
		}
		case 'options-bgcolor-display':
		case 'options-bgcolor-displaybutton':
			this.setBgColourInput.click();
			break;
		case 'options-bgcolor-set':
			/** @type {Site} */ (this.selectedSite).link.backgroundColor = this.setBgColourInput.value;
			Tiles.putTile(/** @type {Site} */ (this.selectedSite).link);
			/** @type {Site} */ (this.selectedSite).thumbnail.style.backgroundColor =
				this.siteThumbnail.style.backgroundColor = this.setBgColourInput.value;
			this.resetBgColourButton.disabled = false;
			break;
		case 'options-bgcolor-reset':
			delete /** @type {Site} */ (this.selectedSite).link.backgroundColor;
			Tiles.putTile(/** @type {Site} */ (this.selectedSite).link);
			/** @type {Site} */ (this.selectedSite).thumbnail.style.backgroundColor =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourInput.value =
				this.setBgColourDisplay.style.backgroundColor = /** @type {string} */ (/** @type {unknown} */ (null));
			this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			break;
		case 'options-title-set':
			/** @type {Site} */ (this.selectedSite).link.title = this.setTitleInput.value;
			/** @type {Site} */ (this.selectedSite).link.titleIsUserSet = true;
			/** @type {Site} */ (this.selectedSite).addTitle();
			Tiles.putTile(/** @type {Site} */ (this.selectedSite).link);
			break;
		case 'options-title-remove': {
			// Clear the custom title → revert to the page's history/auto title.
			if (!this.selectedSite) { return; }
			let tlink = this.selectedSite.link;
			delete tlink.title;
			tlink.titleIsUserSet = false;
			this.historyTitleFor(tlink.url).then(historyTitle => {
				if (historyTitle) { tlink.title = historyTitle; }
				/** @type {Site} */ (this.selectedSite).addTitle();
				Tiles.putTile(tlink);
				if (this.setTitleInput) { this.setTitleInput.value = tlink.title || ''; }
			});
			break;
		}
		case 'options-wallpaper-btn':
			this.openWallpaperPicker();
			break;
		case 'options-bg-remove':
			this.resetWallpaper();
			break;
		case 'historytiles-filter': {
			// Toggle the filter panel (it starts hidden); only (re)populate when
			// opening so a second click cleanly collapses it.
			let opening = this.optionsFilter.hidden;
			this.optionsFilter.hidden = !opening;
			target.setAttribute('aria-expanded', String(opening));
			if (opening) {
				this.fillFilterUI();
			}
			return;
		}
		case 'options-filter-set': {
			// Normalize the host so exact matching reliably fires (trims/lowercases,
			// extracts host from a pasted URL, maps `*.x`→`.x`). Re-derive validity
			// here rather than trusting the button's disabled state.
			let host = Filters.normalizeHost(this.optionsFilterHost.value);
			let count = parseInt(this.optionsFilterCount.value, 10);
			if (!host || isNaN(count)) {
				return;
			}
			Filters.setFilter(host, count);
			Updater.updateGrid();
			this.fillFilterUI(host);
			this.optionsFilterHost.value = '';
			this.optionsFilterCount.value = '';
			this.optionsFilterHost.focus();
			this.optionsFilterSet.disabled = true;
			return;
		}
		case 'options-nevercapture-add': {
			// Normalize the host via the same helper as the history filter (trims,
			// lowercases, extracts host from a full URL, maps `*.x`→`.x`).
			let host = Filters.normalizeHost(this.optionsNeverCaptureHost.value);
			if (!host) {
				return;
			}
			NeverCapture.add(host).then(() => {
				chrome.runtime.sendMessage({name: 'Thumbnails.purgeHost', host}, () => {
					Grid.refresh().then(() => this.getThumbnails());
				});
				this.optionsNeverCaptureHost.value = '';
				this.fillNeverCaptureUI();
			});
			return;
		}
		case 'options-backup':
			chrome.permissions.request({permissions: ['downloads']}, function() {
				chrome.runtime.sendMessage({name: 'Export:backup'});
			});
			return;
		case 'options-restore':
			// Restore overwrites the whole setup — require an explicit inline
			// Confirm/Cancel (§7) rather than acting on the first click.
			this._showConfirm('options-restore-confirm-row');
			return;
		case 'options-restore-confirm': {
			let input = /** @type {HTMLInputElement} */ (document.getElementById('options-restore-file'));
			chrome.runtime.sendMessage({name: 'Import:restore', file: /** @type {FileList} */ (input.files)[0]});
			this._hideConfirm('options-restore-confirm-row');
			return;
		}
		case 'options-restore-cancel':
			this._hideConfirm('options-restore-confirm-row');
			return;
		case 'options-reset-all':
			// Irreversible — inline Confirm/Cancel (§7).
			this._showConfirm('options-reset-confirm-row');
			return;
		case 'options-reset-confirm':
			this._hideConfirm('options-reset-confirm-row');
			this.resetAllSettings();
			return;
		case 'options-reset-cancel':
			this._hideConfirm('options-reset-confirm-row');
			return;
		}

		if (classList.contains('ntt-filter-remove')) {
			// Explicit removal of a filter entry (distinct from stepping the limit
			// down to "Unlimited", which also deletes it). Only filter rows carry
			// this control — pinned-only rows don't (see fillFilterUI).
			let row = /** @type {HTMLTableRowElement} */ (target.closest('tr'));
			Filters.setFilter(/** @type {string} */ (row.cells[0].textContent), -1);
			Updater.updateGrid();
			this.fillFilterUI();
			return;
		}

		if (classList.contains('ntt-nevercapture-remove')) {
			// Remove the entry from the never-capture list (no purge — the user is
			// only un-suppressing auto-capture, not deleting existing screenshots).
			let entry = target.dataset.entry || '';
			NeverCapture.remove(entry).then(() => {
				this.fillNeverCaptureUI();
			});
			return;
		}

		if (classList.contains('plus-button') || classList.contains('minus-button')) {
			let row = /** @type {HTMLTableRowElement} */ (/** @type {Node} */ (target.parentNode).parentNode);
			let unpinned = /** @type {HTMLElement} */ (row.cells[2].querySelector('span'));
			let count = parseInt(/** @type {string} */ (unpinned.textContent), 10);

			if (isNaN(count)) {
				if (classList.contains('minus-button')) {
					return;
				}
				count = -1;
			}
			count += classList.contains('plus-button') ? 1 : -1;
			// `count` (a `number`) assigns fine at runtime — `textContent`'s
			// WebIDL setter stringifies any value — the cast documents that
			// instead of inserting a `String(...)` call that would
			// (redundantly) do it a second time (grid.js's `_renderGrid`
			// precedent for this exact idiom).
			unpinned.textContent = /** @type {string} */ (count == -1 ? this.getString('filter_unlimited') : count);
			/** @type {HTMLButtonElement} */ (row.querySelector('.minus-button')).disabled = count == -1;

			Filters.setFilter(/** @type {string} */ (row.cells[0].textContent), count);
			Updater.updateGrid();
		}
	},
	/** @param {Event} event */
	optionsOnChange(event) {
		let target = /** @type {DelegatedEventTarget} */ (event.target);
		if (target.disabled) {
			return;
		}

		let {name, value, checked} = target;
		// `name` is a plain `string` here (from the destructure above), so it
		// can't be checked against `Prefs`'s precise per-pref accessor types —
		// same shape of problem as the `uiElements` loop above, same fix: a
		// cast that's honest about what each case actually writes, bridged
		// through `unknown` since `Prefs`'s own declared shape (heterogeneous
		// per-property value types) doesn't otherwise overlap with a
		// single-value-type `Record`.
		switch (name) {
		case 'theme':
		case 'spacing':
		case 'titleSize':
		case 'tileAspect':
			/** @type {Record<string, string>} */ (/** @type {unknown} */ (Prefs))[name] = /** @type {string} */ (value);
			break;
		case 'opacity':
		case 'rows':
		case 'columns':
			/** @type {Record<string, number>} */ (/** @type {unknown} */ (Prefs))[name] = parseInt(/** @type {string} */ (value), 10);
			break;
		case 'margin':
			Prefs.margin = /** @type {string} */ (value).split(' ');
			break;
		case 'locked':
		case 'history':
		case 'recent':
			/** @type {Record<string, boolean>} */ (/** @type {unknown} */ (Prefs))[name] = /** @type {boolean} */ (checked);
			break;
		}
	},
	/** @param {browser.menus._OnShownInfo} info */
	contextMenuShowing(info) {
		if (info.contexts.includes('link')) {
			// `getTargetElement` returns `Element | void`; `.closest` on a
			// `SiteNode` (not just `Element`) since `site._newtabSite` is
			// read below — no null/void guard in the existing code, cast
			// rather than fix.
			let target = /** @type {Element} */ (browser.menus.getTargetElement(/** @type {number} */ (info.targetElementId)));
			let site = /** @type {SiteNode | null} */ (target.closest('.newtab-site'));
			let pinned = site && /** @type {Site} */ (site._newtabSite).isPinned;

			browser.menus.update('edit', { visible: !!site });
			browser.menus.update('pin', { visible: !!site && !pinned });
			browser.menus.update('unpin', { visible: /** @type {boolean | undefined} */ (!!site && pinned) });
			browser.menus.update('block', { visible: !!site });
			browser.menus.refresh();
		}
	},
	/** @param {browser.menus.OnClickData} info */
	contextMenuOnClick(info) {
		let target = /** @type {Element} */ (browser.menus.getTargetElement(/** @type {number} */ (info.targetElementId)));
		// No null guard on `.closest` below (existing assumption: the
		// context menu only ever fires from inside a `.newtab-site`) —
		// cast, not a fix.
		let site = /** @type {SiteNode} */ (target.closest('.newtab-site'));

		switch (info.menuItemId) {
		case 'edit':
			let index = 0;
			let cell = /** @type {CellNode} */ (site.parentNode);
			while (cell.previousElementSibling) {
				cell = /** @type {CellNode} */ (cell.previousElementSibling);
				index++;
			}
			let row = /** @type {Element} */ (cell.parentNode);
			while (row.previousElementSibling) {
				row = row.previousElementSibling;
				index += row.childElementCount;
			}

			newTabTools.openDrawer();
			newTabTools.switchDrawerTab('tile');
			newTabTools.selectedSiteIndex = index;
			break;

		case 'pin':
			/** @type {Site} */ (site._newtabSite).pin();
			break;
		case 'unpin':
			/** @type {Site} */ (site._newtabSite).unpin();
			break;
		case 'block':
			/** @type {Site} */ (site._newtabSite).block();
			break;
		case 'options':
			newTabTools.toggleDrawer();
			break;
		}
	},
	/**
	 * @param {Site} site
	 * @param {string} src
	 */
	setThumbnail(site, src) {
		let image = new Image();
		image.onload = function() {
			let thumbnailSize = Prefs.thumbnailSize;
			let scale = Math.min(thumbnailSize / image.width, thumbnailSize / image.height, 1);

			let canvas = document.createElement('canvas');
			// `mozOpaque`/`mozImageSmoothingEnabled` are legacy Firefox-only
			// canvas extensions, not declared by `lib.dom.d.ts` — global-
			// interface augmentation, not expressible from checked JS
			// without a new ambient `.d.ts` (cell.js's `DOMRect` shim
			// precedent).
			// @ts-expect-error — see comment above.
			canvas.mozOpaque = false;
			if ('imageSmoothingEnabled' in canvas) {
				canvas.imageSmoothingEnabled = true;
			} else {
				// @ts-expect-error — see comment above.
				canvas.mozImageSmoothingEnabled = true;
			}
			canvas.width = image.width * scale;
			canvas.height = image.height * scale;
			let ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
			ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
			// The decode-source object URL (file-picker blob) is one-shot —
			// once drawn to the canvas it has no further consumer (§4.3).
			if (src.startsWith('blob:')) {
				URL.revokeObjectURL(src);
			}

			let link = site.link;
			canvas.toBlob(function(blob) {
				// `toBlob`'s callback param is `Blob | null` (encoding could
				// fail); `link.image` is `Blob | undefined` — no guard here
				// existed before this slice either. Cast, not a fix.
				link.image = /** @type {Blob} */ (blob);
				delete link.imageIsThumbnail;
				site.refreshThumbnail();

				let thumbnailURL = newTabTools._freshObjectURL('editorThumb', /** @type {Blob} */ (link.image));
				newTabTools.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
				newTabTools.siteThumbnail.classList.add('custom-thumbnail');
				newTabTools.saveCurrentThumbButton.disabled = true;

				Tiles.putTile(link);
			}, 'image/png');
		};
		image.onerror = function(error) {
			console.error(error);
			if (src.startsWith('blob:')) {
				URL.revokeObjectURL(src);
			}
		};
		image.src = src;
	},
	/** @param {Site} site */
	removeThumbnail(site) {
		let link = site.link;
		delete link.image;
		delete link.imageIsThumbnail;
		site.refreshThumbnail();
		this.siteThumbnail.style.backgroundImage = /** @type {string} */ (/** @type {unknown} */ (null));
		this.siteThumbnail.classList.remove('custom-thumbnail');
		this.getThumbnails();

		Tiles.putTile(link);
	},
	// Object-URL hygiene (audit 2026-06-10 §4.3): blob URLs are only freed on
	// document unload, so repeated-render sites revoke their prior URL before
	// creating a replacement (site.js's refreshThumbnail pattern).
	// Each key names one owner surface (e.g. 'background', 'editorThumb') —
	// never stash a URL another surface still displays.
	/** @type {Record<string, string>} */
	_objectURLs: {},
	/**
	 * @param {string} key
	 * @param {Blob} blob
	 * @returns {string}
	 */
	_freshObjectURL(key, blob) {
		this._dropObjectURL(key);
		let url = URL.createObjectURL(blob);
		this._objectURLs[key] = url;
		return url;
	},
	/** @param {string} key */
	_dropObjectURL(key) {
		if (this._objectURLs[key]) {
			URL.revokeObjectURL(this._objectURLs[key]);
			delete this._objectURLs[key];
		}
	},
	refreshBackgroundImage() {
		// CDN wallpaper takes priority over IDB blob. Apply the
		// `background_position` Firefox publishes alongside each record so
		// e.g. "top left" wallpapers anchor at the corner the photographer
		// composed for. Solid-colour records fill the page instead.
		document.body.style.backgroundPosition =
			this.backgroundFake.style.backgroundPosition = Prefs.backgroundPosition || 'center center';
		document.body.style.backgroundColor = Prefs.backgroundColor || '';
		if (Prefs.backgroundUrl) {
			document.body.style.backgroundImage =
				this.backgroundFake.style.backgroundImage = 'url("' + Prefs.backgroundUrl + '")';
			this._dropObjectURL('background');
			this.removeBackgroundButton.disabled = false;
			return Promise.resolve();
		}
		if (Prefs.backgroundColor) {
			document.body.style.backgroundImage = this.backgroundFake.style.backgroundImage = '';
			this._dropObjectURL('background');
			this.removeBackgroundButton.disabled = false;
			return Promise.resolve();
		}

		return Background.getBackground().then(background => {
			if (!background) {
				document.body.style.backgroundImage = this.backgroundFake.style.backgroundImage = /** @type {string} */ (/** @type {unknown} */ (null));
				this._dropObjectURL('background');
				this.removeBackgroundButton.disabled = true;
				this.removeBackgroundButton.blur();
				return;
			}

			document.body.style.backgroundImage =
				this.backgroundFake.style.backgroundImage = 'url("' + this._freshObjectURL('background', /** @type {Blob} */ (background)) + '")';
			this.removeBackgroundButton.disabled = false;
		});
	},
	async fetchFirefoxWallpapers() {
		if (this._wallpaperCache) {
			return this._wallpaperCache;
		}
		let response = await fetch('https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/newtab-wallpapers-v2/records');
		let json = await response.json();
		let cdnBase = 'https://firefox-settings-attachments.cdn.mozilla.net/';
		let wallpapers = json.data
			.filter(/** @param {RawWallpaperRecord} item */ function(item) {
				if (item.category === 'firefox') { return false; }
				// Image record (has attachment) OR solid-colour record (has solid_color).
				return (item.attachment && item.attachment.location) || item.solid_color;
			})
			.map(/** @param {RawWallpaperRecord} item */ function(item) {
				let record = /** @type {WallpaperRecord} */ ({
					title: item.title,
					theme: item.theme,
					category: item.category,
					attribution: item.attribution,
					// Firefox publishes `background_position` on ~1/3 of
					// records; the rest fall back to centre.
					backgroundPosition: item.background_position || 'center center',
				});
				if (item.attachment && item.attachment.location) {
					record.imageUrl = cdnBase + item.attachment.location;
				}
				if (item.solid_color) {
					record.solidColor = item.solid_color;
				}
				return record;
			});
		this._wallpaperCache = wallpapers;
		return wallpapers;
	},
	openWallpaperPicker() {
		// No null-check on either lookup below (existing assumption: both
		// ids are always present in newTab.html) — cast, not a fix.
		let picker = /** @type {HTMLElement} */ (document.getElementById('wallpaper-picker'));
		picker.hidden = false;
		this.fetchFirefoxWallpapers().then(wallpapers => {
			this.renderWallpaperGrid(wallpapers);
		}).catch(() => {
			let grid = /** @type {HTMLElement} */ (document.getElementById('wallpaper-grid'));
			grid.textContent = this.getString('wallpaper_error');
		});
	},
	closeWallpaperPicker() {
		/** @type {HTMLElement} */ (document.getElementById('wallpaper-picker')).hidden = true;
	},
	/** @param {WallpaperRecord[]} wallpapers */
	renderWallpaperGrid(wallpapers) {
		let grid = /** @type {HTMLElement} */ (document.getElementById('wallpaper-grid'));
		grid.textContent = '';

		/** @type {Record<string, WallpaperRecord[]>} */
		let categories = {};
		for (let wp of wallpapers) {
			if (!categories[wp.category]) {
				categories[wp.category] = [];
			}
			categories[wp.category].push(wp);
		}

		for (let [category, items] of Object.entries(categories)) {
			let heading = el('h3', 'wallpaper-category', category.replace(/-/g, ' '));
			grid.appendChild(heading);

			let row = el('div', 'wallpaper-row');
			for (let wp of items) {
				/** @type {HTMLImageElement | HTMLDivElement | undefined} */
				let thumb;
				if (wp.imageUrl) {
					thumb = document.createElement('img');
					// tsc doesn't narrow `thumb` from the assignment above
					// across this `HTMLImageElement | HTMLDivElement` union
					// (a lib.dom.d.ts narrowing limit, reproduced in
					// isolation) — cast instead of relying on it.
					/** @type {HTMLImageElement} */ (thumb).src = wp.imageUrl;
					thumb.dataset.url = wp.imageUrl;
				} else if (wp.solidColor) {
					// Solid-colour record — render a swatch instead of an <img>
					// since there's no image to load.
					thumb = document.createElement('div');
					thumb.style.backgroundColor = wp.solidColor;
					thumb.dataset.solidColor = wp.solidColor;
				} else {
					continue;
				}
				thumb.className = 'wallpaper-thumb';
				// `.alt` is meaningless on the solid-colour `<div>` branch
				// (harmless no-op expando write, same today as before this
				// slice) — cast, reported not fixed (chrome-prep C3c).
				/** @type {HTMLImageElement} */ (thumb).alt = wp.title;
				if ((wp.imageUrl && Prefs.backgroundUrl === wp.imageUrl)
					|| (wp.solidColor && Prefs.backgroundColor === wp.solidColor)) {
					thumb.setAttribute('selected', '');
				}
				thumb.addEventListener('click', () => {
					this.selectWallpaper(wp);
				});
				row.appendChild(thumb);
			}
			grid.appendChild(row);
		}
	},
	/** @param {WallpaperRecord | string} wallpaperOrUrl */
	selectWallpaper(wallpaperOrUrl) {
		// Accept either a wallpaper record `{imageUrl, backgroundPosition,
		// solidColor}` (current call site) or a bare URL string
		// (back-compat). Solid-colour records take a different rendering
		// path — clear the image URL and write the colour instead.
		let wp = typeof wallpaperOrUrl === 'string'
			? { imageUrl: wallpaperOrUrl, backgroundPosition: 'center center' }
			: wallpaperOrUrl;
		let url = wp.imageUrl || '';
		let position = wp.backgroundPosition || 'center center';
		let solidColor = /** @type {WallpaperRecord} */ (wp).solidColor || '';

		return Background.setBackground().then(() => {
			Prefs.backgroundUrl = url;
			Prefs.backgroundPosition = position;
			Prefs.backgroundColor = solidColor;
			document.body.style.backgroundPosition =
				this.backgroundFake.style.backgroundPosition = position;
			if (solidColor) {
				document.body.style.backgroundColor = solidColor;
				document.body.style.backgroundImage =
					this.backgroundFake.style.backgroundImage = '';
			} else {
				document.body.style.backgroundColor = '';
				document.body.style.backgroundImage =
					this.backgroundFake.style.backgroundImage = 'url("' + url + '")';
			}
			this.removeBackgroundButton.disabled = false;

			// Update selected state in grid
			let thumbs = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.wallpaper-thumb'));
			for (let t of thumbs) {
				if (t.dataset.url === url) {
					t.setAttribute('selected', '');
				} else {
					t.removeAttribute('selected');
				}
			}
		});
	},
	resetWallpaper() {
		Prefs.backgroundUrl = '';
		Prefs.backgroundPosition = 'center center';
		Prefs.backgroundColor = '';
		Background.setBackground().then(() => {
			this.refreshBackgroundImage();
			let thumbs = document.querySelectorAll('.wallpaper-thumb');
			for (let t of thumbs) {
				t.removeAttribute('selected');
			}
		});
	},
	/**
	 * @param {string} str
	 * @returns {{r: number, g: number, b: number} | null}
	 */
	parseColour(str) {
		let parts = /^(hsl|rgb)a?\((\d+),\s*([\d.]+%?),\s*([\d.]+%?)/.exec(str);
		if (parts && parts[1] == 'rgb') {
			return {
				r: parseInt(parts[2], 10),
				g: parseInt(parts[3], 10),
				b: parseInt(parts[4], 10),
			};
		}

		if (parts && parts[1] == 'hsl') {
			let h = parseFloat(parts[2]) / 360;
			let s = parseFloat(parts[3]) / 100;
			let l = parseFloat(parts[4]) / 100;
			let r, g, b;

			if (s == 0){
				r = g = b = l;
			} else {
				/**
				 * @param {number} p
				 * @param {number} q
				 * @param {number} t
				 * @returns {number}
				 */
				function hue2rgb(p, q, t) {
					if (t < 0) {
						t += 1;
					}
					if (t > 1) {
						t -= 1;
					}
					if (t < 1/6) {
						return p + (q - p) * 6 * t;
					}
					if (t < 1/2) {
						return q;
					}
					if (t < 2/3) {
						return p + (q - p) * (2/3 - t) * 6;
					}
					return p;
				}

				let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
				let p = 2 * l - q;
				r = hue2rgb(p, q, h + 1/3);
				g = hue2rgb(p, q, h);
				b = hue2rgb(p, q, h - 1/3);
			}

			return {
				r: Math.round(r * 255),
				g: Math.round(g * 255),
				b: Math.round(b * 255),
			};
		}

		parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(str);
		if (parts) {
			return {
				r: parseInt(parts[1], 16),
				g: parseInt(parts[2], 16),
				b: parseInt(parts[3], 16),
			};
		}

		parts = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(str);
		if (parts) {
			return {
				r: parseInt(parts[1].repeat(2), 16),
				g: parseInt(parts[2].repeat(2), 16),
				b: parseInt(parts[3].repeat(2), 16),
			};
		}

		return null;
	},
	/** @param {browser.theme.ThemeUpdateInfo} [updateInfo] */
	async updateThemeColours(updateInfo) {
		/** @type {Record<string, string | null>} */
		let properties = {
			'--back-opaque': null,
			'--contrast-opaque': null,
			'--contrast-transp': null,
			'--fore-opaque': null,
			'--fore-trans1': null,
			'--fore-transp': null,
			'--page-background': null,
		};

		if (Prefs.theme === 'system') {
			try {
				this._theme = updateInfo ? /** @type {browser._manifest.ThemeType} */ (updateInfo.theme) : await browser.theme.getCurrent();
			} catch (ex) {
				console.debug(ex);
				this._theme = null;
			}
			// Firefox's default theme (and wallpaper-only themes) return colors:
			// null or omit the key entirely. Treat both as "no palette to apply"
			// and fall through to the designed NTT palette in tokens.css.
			let colors = this._theme && this._theme.colors;
			if (colors) {
				// `ThemeColor` can also be an RGB(A) tuple (legacy format);
				// `parseColour` only handles strings and this never guarded
				// against the tuple case — cast, reported not fixed
				// (chrome-prep C3c).
				let back = this.parseColour(/** @type {string} */ (colors.ntp_background || colors.toolbar));
				let fore = this.parseColour(/** @type {string} */ (colors.ntp_text || colors.toolbar_text));

				if (back && fore) {
					properties['--back-opaque'] = `rgb(${back.r}, ${back.g}, ${back.b})`;
					properties['--fore-opaque'] = `rgb(${fore.r}, ${fore.g}, ${fore.b})`;
					properties['--fore-trans1'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, 0.1)`;
					properties['--fore-transp'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, var(--opacity))`;
					properties['--page-background'] = `rgb(${back.r}, ${back.g}, ${back.b})`;

					let brightness = 0.299 * fore.r + 0.587 * fore.g + 0.114 * fore.b;
					if (brightness < 144) {
						properties['--contrast-opaque'] = 'rgb(255, 255, 255)';
						properties['--contrast-transp'] = 'rgba(255, 255, 255, var(--opacity))';
					} else {
						properties['--contrast-opaque'] = 'rgb(0, 0, 0)';
						properties['--contrast-transp'] = 'rgba(0, 0, 0, var(--opacity))';
					}
				}
			}
		} else {
			this._theme = null;
		}

		for (let [key, value] of Object.entries(properties)) {
			document.documentElement.style.setProperty(key, value);
		}

		for (let [selector, name] of Object.entries({
			'.close-button': 'close',
			'button.arrow': 'arrow',
		})) {
			let url = await this.getThemedImageURL(name);
			for (let element of document.querySelectorAll(selector)) {
				/** @type {HTMLElement} */ (element).style.backgroundImage = /** @type {string} */ (url ? `url(${url})` : null);
			}
		}
	},
	/**
	 * @param {string} name
	 * @param {string} [theme]
	 * @returns {Promise<string | null>}
	 */
	async getThemedImageURL(name, theme = Prefs.theme) {
		let effectiveTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
		let fore = document.documentElement.style.getPropertyValue('--fore-opaque');
		let back = document.documentElement.style.getPropertyValue('--back-opaque');

		if (!fore) {
			return null;
		}

		try {
			let request = await fetch(browser.runtime.getURL(`images/${name}-${effectiveTheme}.svg`));
			let content = await request.text();
			content = content.replaceAll('#fff', fore);
			content = content.replaceAll('#1f364c', back);
			return 'data:image/svg+xml;base64,' + btoa(content);
		} catch (ex) {
			console.debug(ex);
			return null;
		}
	},
	/** @param {string[]} [keys] */
	updateUI(keys) {
		/**
		 * @param {string} piece
		 * @param {string} size
		 */
		function setMargin(piece, size) {
			for (let pieceElement of document.querySelectorAll(piece)) {
				pieceElement.classList.remove('medium');
				pieceElement.classList.remove('large');
				if (size == 'medium' || size == 'large') {
					pieceElement.classList.add(size);
				}
			}
		}

		if (!keys || keys.includes('rows')) {
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="rows"]'));
			if (el) { el.value = /** @type {string} */ (/** @type {unknown} */ (Prefs.rows)); }
			this._syncDrawerSegmented('rows', Prefs.rows);
		}

		if (!keys || keys.includes('columns')) {
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="columns"]'));
			if (el) { el.value = /** @type {string} */ (/** @type {unknown} */ (Prefs.columns)); }
			this._syncDrawerSegmented('columns', Prefs.columns);
		}

		if (!keys || keys.includes('theme')) {
			let theme = Prefs.theme;
			let effectiveTheme = theme === 'system'
				? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
				: theme;
			let radio = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="theme"][value="' + theme + '"]'));
			if (radio) { radio.checked = true; }
			document.documentElement.setAttribute('theme', effectiveTheme);
			this.darkIcons.disabled = effectiveTheme == 'light';
			this._syncDrawerSegmented('theme', theme);
			this.updateThemeColours();
			if (theme === 'system') {
				browser.theme.onUpdated.addListener(this.updateThemeColours);
			} else {
				browser.theme.onUpdated.removeListener(this.updateThemeColours);
			}
		}

		if (!keys || keys.includes('locked')) {
			let locked = Prefs.locked;
			let lockedCheckbox = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="locked"]'));
			if (lockedCheckbox) { lockedCheckbox.checked = locked; }
			if (locked) {
				document.documentElement.setAttribute('locked', 'true');
			} else {
				document.documentElement.removeAttribute('locked');
			}
		}

		if (!keys || keys.includes('titleSize')) {
			let titleSize = Prefs.titleSize;
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="titleSize"]'));
			if (el) { el.value = titleSize; }
			document.documentElement.setAttribute('titlesize', titleSize);
			this._syncDrawerToggle('titleSize', titleSize !== 'hidden');
		}

		if (!keys || keys.includes('margin')) {
			let margin = Prefs.margin;
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="margin"]'));
			if (el) { el.value = margin.join(' '); }
			setMargin('#newtab-margin-top', margin[0]);
			setMargin('.newtab-margin-right', margin[1]);
			setMargin('#newtab-margin-bottom', margin[2]);
			setMargin('.newtab-margin-left', margin[3]);
			setMargin('#ntt-titlebar', margin[3]);
			this._syncDrawerSlider('margin', margin[0], { small: 10, medium: 18, large: 28 });
		}

		if (!keys || keys.includes('spacing')) {
			let spacing = Prefs.spacing;
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="spacing"]'));
			if (el) { el.value = spacing; }
			document.documentElement.setAttribute('spacing', spacing);
			let gapMap = { small: 10, medium: 18, large: 28 };
			document.documentElement.style.setProperty('--ntt-gap', ((/** @type {Record<string, number>} */ (gapMap))[spacing] || 18) + 'px');
			this._syncDrawerSlider('spacing', spacing, gapMap);
		}

		if (!keys || keys.includes('tileRadius')) {
			let radiusMap = { small: 4, medium: 10, large: 18 };
			let tileRadius = Prefs.tileRadius;
			document.documentElement.style.setProperty('--ntt-radius', ((/** @type {Record<string, number>} */ (radiusMap))[tileRadius] || 10) + 'px');
			this._syncDrawerSlider('tileRadius', tileRadius, radiusMap);
		}

		if (!keys || keys.includes('actionIconSize')) {
			let actionMap = { small: [22, 11], medium: [33, 16], large: [44, 22] };
			let size = Prefs.actionIconSize;
			let [btn, icon] = (/** @type {Record<string, number[]>} */ (actionMap))[size] || actionMap.medium;
			document.documentElement.style.setProperty('--ntt-action-btn-size', btn + 'px');
			document.documentElement.style.setProperty('--ntt-action-icon-size', icon + 'px');
			this._syncDrawerSegmented('actionIconSize', size);
		}

		if (!keys || keys.includes('tileActions')) {
			document.documentElement.setAttribute('tile-actions', Prefs.tileActions ? 'true' : 'false');
			this._syncDrawerToggle('tileActions', Prefs.tileActions);
		}

		if (!keys || keys.includes('statType')) {
			this._syncDrawerSegmented('statType', Prefs.statType);
		}

		if (!keys || keys.includes('tileAspect')) {
			let tileAspect = Prefs.tileAspect;
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="tileAspect"]'));
			if (el) { el.value = tileAspect; }
			document.documentElement.setAttribute('tileaspect', tileAspect);
			this._syncDrawerSegmented('tileAspect', tileAspect);
		}

		if (!keys || keys.includes('tileAspect') || keys.includes('rows') || keys.includes('columns') || keys.includes('spacing')) {
			this.applyTileAspect();
		}

		// Background prefs (CDN wallpaper URL, solid colour, position) apply on
		// the same live path as every other pref. Without this, a restore — which
		// writes backgroundUrl to storage and fires prefsChanged → updateUI — left
		// the wallpaper unapplied until a manual page reload.
		if (!keys || keys.includes('backgroundUrl') || keys.includes('backgroundColor')
			|| keys.includes('backgroundPosition')) {
			this.refreshBackgroundImage();
		}

		if (!keys || keys.includes('opacity')) {
			let opacity = Prefs.opacity;
			// No null-check (existing assumption: the opacity slider is
			// always present in newTab.html) — cast, not a fix.
			/** @type {HTMLInputElement} */ (document.querySelector('[name="opacity"]')).value = /** @type {string} */ (/** @type {unknown} */ (opacity));
			document.documentElement.style.setProperty('--opacity', /** @type {string} */ (/** @type {unknown} */ (opacity / 100)));
		}

		if (!keys || keys.includes('history')) {
			let history = Prefs.history;
			this._syncDrawerToggle('history', history);
			let filterBtn = document.getElementById('historytiles-filter');
			if (filterBtn) { /** @type {HTMLButtonElement} */ (filterBtn).disabled = !history; }
		}

		if (!keys || keys.includes('recent')) {
			let recent = Prefs.recent;
			let el = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="recent"]'));
			if (el) { el.checked = recent; }
			this._syncDrawerToggle('recent', recent);
			this.refreshRecent();
		}

		if (!keys || keys.includes('titleBarSearch')) {
			let el = document.getElementById('ntt-search');
			if (el) { el.hidden = !Prefs.titleBarSearch; }
			this._syncDrawerToggle('titleBarSearch', Prefs.titleBarSearch);
		}

		// Spacing/margin change the titlebar padding, and the search toggle
		// changes which slots are present — both re-flow the recent row.
		if (!keys || keys.includes('spacing') || keys.includes('margin')
			|| keys.includes('titleBarSearch')) {
			this.refreshRecent();
		}

		// chrome-prep C3d: the `'Grid' in window` sniff that used to guard this
		// (and the five blocks below) was satisfied only by the deleted
		// `globalThis.Grid` bridge — with the bridge gone it silently disabled
		// the branch. `Grid` is a real static import now, always initialized
		// by the time these event-time paths run (Page.init() precedes the
		// first keyed updateUI call), so the sniff is dropped, not replaced.
		if (keys && keys.includes('statType')) {
			for (let site of Grid.sites) {
				if (site) {
					site._renderStatChip();
				}
			}
		}

		if ('cacheCellPositions' in Grid) {
			requestAnimationFrame(Grid.cacheCellPositions);
		}

		if (document.documentElement.hasAttribute('drawer-open')
			&& document.documentElement.getAttribute('drawer-tab') === 'tile') {
			this.resizeOptionsThumbnail();
		}

		if (keys && keys.includes('neverCaptureHosts')) {
			// Re-populate the never-capture drawer panel when the stored list changes
			// (e.g. the per-tile toggle on the grid flips an entry).
			if (this.optionsNeverCaptureList) {
				this.fillNeverCaptureUI();
			}
			// Refresh each rendered tile's never-capture button state.
			if (Grid.sites) {
				Grid.sites.forEach(site => {
					if (site && site.updateNeverCaptureButton) {
						site.updateNeverCaptureButton(NeverCapture.matches(site.url));
					}
				});
			}
		}
	},
	_initTitlebar() {
		let searchEl = document.getElementById('ntt-search');
		if (searchEl) {
			let icon = NttIcons.create('search', 14);
			// `create` returns `null` only for an unknown icon name — 'search'
			// is always valid, but the existing code never guarded this.
			// Cast, not a fix.
			searchEl.insertBefore(/** @type {Element} */ (icon), searchEl.firstChild);
		}
		this._layoutTitlebar();
		// Re-flow the recently-closed row whenever the space available to it
		// actually changes — window resize, spacing / outer-padding changes,
		// the search toggle (hiding the search box widens the row), and the
		// config-drawer push-layout (which animates over ~220ms). The recent
		// container is a greedy flex child, so observing ITS size captures all
		// of those in one signal. A ResizeObserver tracks the settled width
		// continuously, which is far more robust than a one-shot post-transition
		// timer: that timer could fire mid-animation, cap the card count against
		// a transient narrow width, and then never recover once the width
		// settled (the reported "drawer collapses the row and closing it doesn't
		// restore" bug). Re-flowing only changes the cards' width, not the
		// container's, so this never feeds back into itself.
		let recent = document.getElementById('ntt-titlebar-recent');
		if (recent && typeof ResizeObserver !== 'undefined') {
			let scheduled = false;
			this._titlebarResizeObserver = new ResizeObserver(() => {
				if (scheduled) {
					return;
				}
				scheduled = true;
				requestAnimationFrame(() => {
					scheduled = false;
					this.refreshRecent();
				});
			});
			this._titlebarResizeObserver.observe(recent);
		}
		// A web-font swap changes the masthead's width and thus the room left
		// for cards; re-flow once fonts settle so the first paint isn't off by
		// a card.
		if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
			document.fonts.ready.then(() => this.refreshRecent());
		}
	},
	/**
	 * Measure the greedy recently-closed card container and set `--ntt-slot-w`
	 * so the cards shrink to fill it edge-to-edge (see computeTitlebarSlots).
	 * Stashes the recent-card cap on `this._recentCardCount` for refreshRecent.
	 * Returns the slot descriptor so callers can chain.
	 */
	_layoutTitlebar() {
		let titlebar = document.getElementById('ntt-titlebar');
		let recent = document.getElementById('ntt-titlebar-recent');
		if (!titlebar || !recent) {
			this._recentCardCount = 0;
			return { cardCount: 0, slotWidth: 186 };
		}
		// The recent-cards container is a greedy flex child, so the browser has
		// already sized it to exactly the room left after the fixed search box
		// and the content-width masthead — whether the search box is shown,
		// whether the config drawer is open, and at any window width. We just
		// read that settled width. It must be laid out (not display:none) to
		// report a real width AND to keep pinning the masthead right, so the
		// container is always visible — when there are no cards it is simply an
		// empty spacer.
		recent.hidden = false;
		let cs = window.getComputedStyle(titlebar);
		let gap = parseFloat(cs.columnGap || cs.gap) || 10;
		let cardSpace = recent.clientWidth;
		if (!cardSpace || cardSpace < 0) {
			cardSpace = 0;
		}
		let slots = this.computeTitlebarSlots(cardSpace, gap, 186);
		// `recent` pref off → never show cards (the empty greedy container still
		// acts as the spacer that pins the masthead right).
		if (!Prefs.recent) {
			slots.cardCount = 0;
		}
		titlebar.style.setProperty('--ntt-slot-w', slots.slotWidth + 'px');
		this._recentCardCount = slots.cardCount;
		return slots;
	},
	/**
	 * @param {number | undefined} lastModified
	 * @returns {string}
	 */
	_formatAge(lastModified) {
		if (!lastModified) {
			return '';
		}
		let seconds = Math.floor(Date.now() / 1000) - lastModified;
		if (seconds < 60) {
			return seconds + 's';
		}
		let minutes = Math.floor(seconds / 60);
		if (minutes < 60) {
			return minutes + 'm';
		}
		let hours = Math.floor(minutes / 60);
		if (hours < 24) {
			return hours + 'h';
		}
		let days = Math.floor(hours / 24);
		return days + 'd';
	},
	refreshRecent() {
		// Re-flow the titlebar slots first so `_recentCardCount` reflects the
		// current width before we decide how many cards to render.
		let slots = this._layoutTitlebar();
		let cap = slots ? slots.cardCount : 0;
		let strip = this.recentList;
		if (!strip) {
			return;
		}

		if (!Prefs.recent || cap <= 0) {
			// No cards to show, but keep the (empty) container laid out: it is
			// the greedy spacer that pins the masthead to the right edge.
			for (let element of strip.querySelectorAll('.ntt-recent-card')) {
				strip.removeChild(element);
			}
			return;
		}

		chrome.sessions.getRecentlyClosed(/** @param {browser.sessions.Session[]} undoItems */ undoItems => {
			let added = 0;

			for (let element of strip.querySelectorAll('.ntt-recent-card')) {
				strip.removeChild(element);
			}

			// The cards are rebuilt from scratch — revoke the prior render's
			// favicon blob URLs before this render creates new ones (§4.3).
			for (let staleURL of newTabTools._recentFaviconURLs || []) {
				URL.revokeObjectURL(staleURL);
			}
			newTabTools._recentFaviconURLs = [];

			// `this` is typed `GlobalEventHandlers` (matching `onclick`'s
			// declared handler signature, which this function is assigned
			// to below) rather than `HTMLElement` — cast at the one member
			// access that needs it.
			/** @this {GlobalEventHandlers} */
			function card_onclick() {
				chrome.sessions.restore(/** @type {HTMLElement} */ (this).dataset.sessionId);
				return false;
			}

			let tileURLs = new Set();
			if (Grid.sites) {
				for (let site of Grid.sites) {
					if (site && site.url) {
						tileURLs.add(site.url);
					}
				}
			}
			let seen = new Set();
			/** @type {Array<{host: string, fav: HTMLElement}>} */
			let needFavicon = [];

			for (let item of undoItems) {
				if (added >= cap) {
					break;
				}
				if (!item.tab || item.tab.incognito) {
					continue;
				}
				if (item.tab.url && item.tab.url.startsWith('moz-extension://')) {
					continue;
				}
				// Validate the tab URL's protocol before it becomes `card.href`.
				// Middle-click / Ctrl+click bypass the onclick restore handler and
				// navigate the href directly, so a `javascript:`/`data:` session
				// URL must be filtered at this data boundary (mirrors the
				// favIconUrl validation below).
				if (!newTabTools.isValidURL(/** @type {string} */ (item.tab.url))) {
					continue;
				}
				if (tileURLs.has(item.tab.url)) {
					continue;
				}

				// `url` is cast non-optional: the guards above already
				// require a valid, present `item.tab.url` — a fresh
				// destructured binding doesn't inherit that narrowing.
				// `SessionTab` adds `lastModified` (real at runtime — a
				// `browser.sessions`-obtained tab — but missing from
				// `@types/firefox-webext-browser`'s plain `Tab`).
				let {url, title, sessionId, favIconUrl, lastModified} = /** @type {SessionTab & {url: string}} */ (item.tab);
				let displayTitle = title || url;
				let domain;
				try {
					// Registrable-ish domain: drop a leading `www.` so the chip
					// reads `theverge.com`, not `www.theverge.com` (§4).
					domain = new URL(url).hostname.replace(/^www\./, '');
				} catch (e) {
					domain = url;
				}

				let dedup = (title || '') + '\n' + domain;
				if (seen.has(dedup)) {
					continue;
				}
				seen.add(dedup);

				let card = document.createElement('a');
				card.href = url;
				card.className = 'ntt-recent-card';
				// `title` may be `undefined` (Tab.title is optional) — no
				// guard here before this slice either. Cast, not a fix.
				card.title = /** @type {string} */ (!title || title == url ? title : title + '\n' + url);
				card.dataset.sessionId = /** @type {string} */ (sessionId);
				card.onclick = card_onclick;

				let fav = el('span', 'ntt-recent-favicon');
				// Letter fallback from the registrable domain (same logic as the
				// tiles), not the page title — `H` for heise.de, not the headline.
				let glyph = (domain.charAt(0) || displayTitle.charAt(0) || '?').toUpperCase();
				let hue = (url.length * 7 + glyph.charCodeAt(0) * 13) % 360;
				fav.style.backgroundColor = 'hsl(' + hue + ', 50%, 40%)';
				if (favIconUrl && newTabTools.isValidURL(favIconUrl)) {
					let img = document.createElement('img');
					img.onerror = function() { this.remove(); };
					img.src = favIconUrl;
					fav.appendChild(img);
				} else {
					fav.appendChild(document.createTextNode(glyph));
					// No favicon in the session record — try the extension's stored
					// favicon once the row is built. Favicons are per-site, but a
					// recently-closed tab is usually a deep article URL that won't
					// exact-match a stored tile/homepage URL, so match by host.
					needFavicon.push({ host: domain, fav });
				}
				card.appendChild(fav);

				let text = el('span', 'ntt-recent-text');
				let nameEl = el('span', 'ntt-recent-name');
				nameEl.appendChild(document.createTextNode(displayTitle));
				text.appendChild(nameEl);
				let urlEl = el('span', 'ntt-recent-url');
				urlEl.appendChild(document.createTextNode(domain));
				text.appendChild(urlEl);
				card.appendChild(text);

				let age = newTabTools._formatAge(lastModified);
				if (age) {
					let ageEl = el('span', 'ntt-recent-age');
					ageEl.appendChild(document.createTextNode(age));
					card.appendChild(ageEl);
				}

				strip.appendChild(card);
				added++;
			}
			strip.hidden = !added;

			// §3c: cards that fell back to the letter glyph use the extension's
			// stored favicon (collected during tile capture) when one exists —
			// closed-tab session data often carries no favIconUrl. Match by host
			// (favicons are per-site) so a deep article URL reuses the site's
			// stored favicon.
			if (needFavicon.length) {
				let hosts = [...new Set(needFavicon.map(n => n.host).filter(Boolean))];
				chrome.runtime.sendMessage({ name: 'Thumbnails.getFaviconsByHost', hosts }, /** @param {Map<string, Blob | string> | undefined} favicons */ favicons => {
					if (!favicons || typeof favicons.get !== 'function') {
						return;
					}
					for (let { host, fav } of needFavicon) {
						let favicon = host && favicons.get(host);
						/** @type {string | null} */
						let src = null;
						if (favicon instanceof Blob) {
							src = URL.createObjectURL(favicon);
							// `_recentFaviconURLs` was just reset to `[]` above
							// in the enclosing `getRecentlyClosed` callback, but
							// that's a different closure boundary from this
							// nested `sendMessage` callback, so tsc can't carry
							// the narrowing through — cast, not a fix.
							/** @type {string[]} */ (newTabTools._recentFaviconURLs).push(src);
						} else if (typeof favicon === 'string' && newTabTools.isValidURL(favicon)) {
							src = favicon;
						}
						if (!src) {
							continue;
						}
						let img = document.createElement('img');
						img.onerror = function() { this.remove(); };
						img.src = src;
						for (let node of [...fav.childNodes]) {
							if (node.nodeType === Node.TEXT_NODE) {
								node.remove();
							}
						}
						fav.appendChild(img);
					}
				});
			}
		});
	},
	trimRecent() {
	},
	/** @param {string} rowId */
	_showConfirm(rowId) {
		let row = document.getElementById(rowId);
		if (row) { row.hidden = false; }
	},
	/** @param {string} rowId */
	_hideConfirm(rowId) {
		let row = document.getElementById(rowId);
		if (row) { row.hidden = true; }
	},
	async resetAllSettings() {
		// Hard reset: wipe pinned tiles, blocked URLs, history filters and
		// every persisted pref. The inline Confirm/Cancel row (§7) gates this —
		// destructive and irreversible, so there is no window.confirm here.
		// The page-side `Tiles` (tiles-shim.js) is just an IPC façade — no
		// `.clear()` method exists. Route through the background which owns
		// the IDB transaction. Clear the Thumbnails store (captured screenshots
		// + cached favicons of every visited site) and the Background store
		// (uploaded wallpaper) too — a factory reset must not leave a user's
		// browsing imagery on disk.
		// `new Promise(resolve => …)` needs a JSDoc hint to infer `resolve`
		// as the argument-less `() => void` these callbacks call it as.
		await /** @type {Promise<void>} */ (new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.clear' }, () => resolve());
		}));
		await /** @type {Promise<void>} */ (new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Thumbnails.clear' }, () => resolve());
		}));
		await /** @type {Promise<void>} */ (new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.setBackground', file: null }, () => resolve());
		}));
		// Blocked + Filters + NeverCapture live inside chrome.storage.local, so
		// clearing it wipes them along with prefs. We zero the in-memory copies
		// too so anything reading them before reload sees the cleared state.
		Blocked._list = [];
		Filters._list = Object.create(null);
		NeverCapture.clear();
		await new Promise(resolve => chrome.storage.local.clear(resolve));
		// Reload so every component picks up the cleared state from a
		// known-clean start.
		location.reload();
	},
	/**
	 * @param {number} elapsedMs
	 * @returns {string}
	 */
	formatRelativeTime(elapsedMs) {
		// Used by the drawer's auto-save indicator. Returns the localised
		// "just now" / "Nm ago" / "Nh ago" string for the elapsed time.
		if (elapsedMs < 60000) {
			return this.getString('autosaved_relative_now');
		}
		if (elapsedMs < 3600000) {
			let minutes = Math.floor(elapsedMs / 60000);
			return this.getString('autosaved_relative_minutes', String(minutes));
		}
		let hours = Math.floor(elapsedMs / 3600000);
		return this.getString('autosaved_relative_hours', String(hours));
	},
	_renderAutoSavedIndicator() {
		let el = document.getElementById('ntt-drawer-footer-msg');
		if (!el) {
			return;
		}
		if (!this._autoSavedAt) {
			// No real save has happened yet — hide the indicator instead
			// of showing a misleading "just now" on a fresh page.
			el.hidden = true;
			el.textContent = '';
			return;
		}
		el.hidden = false;
		let elapsed = Date.now() - this._autoSavedAt;
		el.textContent = `${this.getString('options_autosaved')} · ${this.formatRelativeTime(elapsed)}`;
	},
	_markAutoSaved() {
		this._autoSavedAt = Date.now();
		this._renderAutoSavedIndicator();
	},
	_initAutoSaveIndicator() {
		// Don't seed `_autoSavedAt` on init — wait for the first real
		// prefs change. The indicator stays hidden until then.
		this._autoSavedAt = null;
		this._renderAutoSavedIndicator();
		if (this._autoSaveTickInterval) {
			clearInterval(this._autoSaveTickInterval);
		}
		// Tick once a minute so the relative timestamp advances without
		// needing further pref activity.
		this._autoSaveTickInterval = setInterval(
			() => this._renderAutoSavedIndicator(),
			60000
		);
	},
	get selectedSiteIndex() {
		return this._selectedSiteIndex;
	},
	/** @param {number | null} index */
	set selectedSiteIndex(index) {
		this._selectedSiteIndex = index;
		let site = (index == null) ? null : this.selectedSite;
		let disabled = site == null;

		// Tile tab empty state — hide edit area + show placeholder when
		// nothing is selected (Phase 3-2).
		let emptyState = /** @type {HTMLElement | null} */ (document.querySelector('[data-tile-empty]'));
		let editArea = document.getElementById('options-tile');
		if (emptyState) { emptyState.hidden = !disabled; }
		if (editArea) { editArea.hidden = disabled; }

		// Move `[data-selected]` from any prior selection to the new one
		// so CSS can draw the copper ring on the active tile.
		if (Grid.sites) {
			for (let s of Grid.sites) {
				if (s && s.node) { s.node.removeAttribute('data-selected'); }
			}
		}
		if (site && site.node) { site.node.setAttribute('data-selected', 'true'); }

		if (disabled) {
			// The fields below need real DOM stubs — bail out early when no
			// tile is selected (the empty state is doing the talking).
			return;
		}
		this.setSavedThumbInput.value = '';
		this.setSavedThumbInput.disabled =
			this.setTitleInput.disabled =
			this.setTitleButton.disabled =
			/** @type {HTMLButtonElement} */ (this.setBgColourDisplay.parentNode).disabled = disabled;

		if (disabled) {
			this._dropObjectURL('editorThumb');
			this.siteThumbnail.style.backgroundImage =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourDisplay.style.backgroundColor = /** @type {string} */ (/** @type {unknown} */ (null));
			this.setTitleInput.value = '';
			this.saveCurrentThumbButton.disabled =
				this.removeSavedThumbButton.disabled =
				this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			return;
		}
		// `disabled` is derived from `site == null` above, so this point is
		// only reached when `site` is non-null — but that invariant lives in
		// a separate boolean, which tsc's control-flow analysis can't
		// correlate back to `site` itself. A fresh binding (rather than
		// reassigning `site`, which ESLint's `no-self-assign` flags as a
		// no-op) documents the invariant for the rest of this method.
		let confirmedSite = /** @type {Site} */ (site);

		if (confirmedSite.link.image) {
			let thumbnailURL = this._freshObjectURL('editorThumb', confirmedSite.link.image);
			this.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			if (confirmedSite.link.imageIsThumbnail) {
				this.siteThumbnail.classList.remove('custom-thumbnail');
			} else {
				this.siteThumbnail.classList.add('custom-thumbnail');
			}
			this.saveCurrentThumbButton.disabled = true;
			this.removeSavedThumbButton.disabled = false;
		} else {
			// Borrowed URL: the tile owns it (s._thumbnailObjectURL) — the
			// editor only drops its own stale preview URL here (§4.3).
			this._dropObjectURL('editorThumb');
			this.siteThumbnail.style.backgroundImage = confirmedSite.thumbnail.style.backgroundImage;
			this.siteThumbnail.classList.remove('custom-thumbnail');
			this.saveCurrentThumbButton.disabled = !this.siteThumbnail.style.backgroundImage;
			this.removeSavedThumbButton.disabled = true;
		}

		// The URL is shown (and edited) in the input; no separate read-only label.
		// The edit row is always available now (editing an auto tile's URL pins it).
		this.siteURLInput.value = confirmedSite.url;
		let backgroundColor = confirmedSite.link.backgroundColor;
		this.siteThumbnail.style.backgroundColor =
			this.setBgColourInput.value =
			this.setBgColourDisplay.style.backgroundColor = /** @type {string} */ (backgroundColor || null);
		this.setBgColourButton.disabled =
			this.resetBgColourButton.disabled = !backgroundColor;
		this.setTitleInput.value = confirmedSite.title || confirmedSite.url;
	},
	/** @param {MouseEvent} event */
	drawerOnClick(event) {
		let target = /** @type {DelegatedEventTarget} */ (event.target);

		// Segmented button click: <button role="radio" data-value="X"> inside
		// `.ntt-segmented[data-pref]` or `.ntt-theme-cards[data-pref]` (theme
		// cards are visually distinct but behave like a radiogroup of
		// segmented buttons).
		let segmented = /** @type {HTMLElement | null} */ (target.closest && (
			target.closest('.ntt-segmented') || target.closest('.ntt-theme-cards')
		));
		// Theme card click: target may be a swatch/label child — find the
		// nearest `[data-value]` ancestor inside the group.
		let valueEl = /** @type {HTMLElement | null} */ (segmented && target.closest('[data-value]'));
		if (segmented && valueEl) {
			let pref = segmented.dataset.pref;
			let raw = valueEl.dataset.value;
			if (pref === 'rows' || pref === 'columns') {
				/** @type {Record<string, number>} */ (/** @type {unknown} */ (Prefs))[pref] = parseInt(/** @type {string} */ (raw), 10);
			} else if (raw === 'true' || raw === 'false') {
				/** @type {Record<string, boolean>} */ (/** @type {unknown} */ (Prefs))[/** @type {string} */ (pref)] = raw === 'true';
			} else {
				/** @type {Record<string, string>} */ (/** @type {unknown} */ (Prefs))[/** @type {string} */ (pref)] = /** @type {string} */ (raw);
			}
			// Stats other than `none` and `rank` need the optional `history`
			// permission. Request it now (we are in a user-gesture handler).
			if (pref === 'statType' && raw !== 'none' && raw !== 'rank') {
				this._ensureHistoryPermission();
			}
			return;
		}

		// Toggle row: a click anywhere inside `.ntt-toggle-row[data-pref]`
		// (button, label, kbd hint) flips the bound pref.
		let toggleRow = /** @type {HTMLElement | null} */ (target.closest && target.closest('.ntt-toggle-row[data-pref]'));
		if (toggleRow) {
			let pref = toggleRow.dataset.pref;
			if (pref === 'titleSize') {
				Prefs.titleSize = Prefs.titleSize === 'hidden' ? 'small' : 'hidden';
			} else {
				/** @type {Record<string, boolean>} */ (/** @type {unknown} */ (Prefs))[/** @type {string} */ (pref)] = !(/** @type {Record<string, boolean>} */ (/** @type {unknown} */ (Prefs))[/** @type {string} */ (pref)]);
			}
			return;
		}

		// Drawer tab button.
		if (target.dataset && target.dataset.drawerTab) {
			this.switchDrawerTab(target.dataset.drawerTab);
			return;
		}

		// Close button.
		if (target.id === 'ntt-drawer-close' || (target.closest && target.closest('#ntt-drawer-close'))) {
			this.closeDrawer();
			return;
		}
	},
	/** @param {Event} event */
	drawerOnChange(event) {
		let target = /** @type {DelegatedEventTarget} */ (event.target);
		// `tagName` is lowercase in XHTML and uppercase in HTML; compare via
		// `target.type` instead since `type === 'range'` is unambiguous.
		if (target.type === 'range' && target.dataset && target.dataset.pref) {
			let pref = target.dataset.pref;
			let idx = parseInt(/** @type {string} */ (target.value), 10);
			let value = ['small', 'medium', 'large'][idx];
			if (!value) {
				return;
			}
			// Realtime label feedback — update the px display in the
			// slider head before the chrome.storage round-trip lands.
			/** @type {Record<string, Record<string, number>>} */
			let pxMaps = {
				spacing: { small: 10, medium: 18, large: 28 },
				margin: { small: 10, medium: 18, large: 28 },
				tileRadius: { small: 4, medium: 10, large: 18 },
			};
			let wrap = target.closest('.ntt-slider-snap');
			let label = wrap && wrap.querySelector('.ntt-slider-value');
			if (label && pxMaps[pref]) {
				label.textContent = pxMaps[pref][value] + 'px';
			}
			if (pref === 'margin') {
				Prefs.margin = [value, value, value, value];
			} else {
				/** @type {Record<string, string>} */ (/** @type {unknown} */ (Prefs))[pref] = value;
			}
			return;
		}
		// Fall through to legacy form handling for relocated <select>, <input>
		// (theme radios, opacity range, tileAspect select, checkboxes).
		this.optionsOnChange(event);
	},
	/**
	 * @param {string} pref
	 * @param {unknown} value
	 */
	_syncDrawerSegmented(pref, value) {
		// Matches `.ntt-segmented` and `.ntt-theme-cards` — both carry
		// `role="radiogroup"` + `data-pref`.
		let group = document.querySelector(`[role="radiogroup"][data-pref="${pref}"]`);
		if (!group || typeof group.querySelectorAll !== 'function') {
			return;
		}
		let str = String(value);
		for (let btn of /** @type {NodeListOf<HTMLElement>} */ (group.querySelectorAll('[data-value]'))) {
			btn.setAttribute('aria-checked', btn.dataset.value === str ? 'true' : 'false');
		}
	},
	/**
	 * @param {string} pref
	 * @param {unknown} value
	 */
	_syncDrawerToggle(pref, value) {
		let toggle = document.querySelector(`.ntt-toggle[data-pref="${pref}"]`);
		if (!toggle || typeof toggle.setAttribute !== 'function') {
			return;
		}
		toggle.setAttribute('aria-checked', value ? 'true' : 'false');
	},
	/**
	 * @param {string} pref
	 * @param {string} value
	 * @param {Record<string, number>} pxMap
	 */
	_syncDrawerSlider(pref, value, pxMap) {
		let wrap = document.querySelector(`.ntt-slider-snap[data-pref="${pref}"]`);
		if (!wrap || typeof wrap.querySelector !== 'function') {
			return;
		}
		let idx = ['small', 'medium', 'large'].indexOf(value);
		if (idx < 0) {
			return;
		}
		let range = /** @type {HTMLInputElement | null} */ (wrap.querySelector('input[type="range"]'));
		if (range) {
			range.value = String(idx);
		}
		let label = wrap.querySelector('.ntt-slider-value');
		if (label) {
			label.textContent = pxMap[value] + 'px';
		}
	},
	_ensureHistoryPermission() {
		if (typeof chrome === 'undefined' || !chrome.permissions) {
			return;
		}
		// Firefox loses the user-gesture context across async callbacks, so
		// we must call `request` synchronously from the click handler. The
		// request itself short-circuits when the permission is already
		// granted (`accepted` will be true with no prompt shown).
		chrome.permissions.request({ permissions: ['history'] }, /** @param {boolean} accepted */ accepted => {
			if (!accepted) {
				return;
			}
			TileStats._hasHistoryPermission = true;
			for (let site of Grid.sites) {
				if (site && typeof site._renderStatChip === 'function') {
					site._renderStatChip();
				}
			}
		});
	},
	openDrawer() {
		document.documentElement.setAttribute('drawer-open', '');
		// Drawer-open IS edit mode (§2): unlock the board so tiles can move and
		// the edit affordances show; the titlebar button becomes "Done". Set the
		// attribute directly (immediate, no storage round-trip) and persist via
		// the pref so the drag guard + a reload agree.
		document.documentElement.removeAttribute('locked');
		Prefs.locked = false;
		if (this._setEditButtonLabel) { this._setEditButtonLabel(true); }
		let drawer = document.getElementById('ntt-drawer');
		if (drawer) {
			drawer.setAttribute('aria-hidden', 'false');
			drawer.focus();
		}
		this._autoSelectFirstTileIfNeeded();
		this._refreshGridPositionsAfterDrawerTransition();
	},
	closeDrawer() {
		document.documentElement.removeAttribute('drawer-open');
		// Closing exits edit mode and re-locks the board (§2).
		document.documentElement.setAttribute('locked', 'true');
		Prefs.locked = true;
		if (this._setEditButtonLabel) { this._setEditButtonLabel(false); }
		let drawer = document.getElementById('ntt-drawer');
		if (drawer) {
			drawer.setAttribute('aria-hidden', 'true');
		}
		this._refreshGridPositionsAfterDrawerTransition();
	},
	/** @param {boolean} editing */
	_setEditButtonLabel(editing) {
		let btn = this.optionsToggleButton;
		if (btn) {
			btn.textContent = this.getString(editing ? 'options_done' : 'options_edit');
		}
	},
	_refreshGridPositionsAfterDrawerTransition() {
		// The drawer's flex-basis/width animates over 220ms. The grid and the
		// titlebar reflow during that animation but no resize event fires, so
		// cached cell positions go stale and the titlebar slot width no longer
		// matches the narrower content area. Re-cache + re-flow the recent row
		// once the transition has settled. (Drag.start also re-caches.)
		setTimeout(() => {
			if (typeof Grid.cacheCellPositions === 'function') {
				Grid.cacheCellPositions();
			}
			this.refreshRecent();
		}, 240);
	},
	toggleDrawer() {
		if (document.documentElement.hasAttribute('drawer-open')) {
			this.closeDrawer();
		} else {
			this.openDrawer();
		}
	},
	/** @param {string} name */
	switchDrawerTab(name) {
		let target = document.querySelector(`[data-drawer-tab="${name}"]`);
		if (!target) {
			return;
		}
		for (let tab of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-drawer-tab]'))) {
			tab.dataset.active = String(tab.dataset.drawerTab === name);
		}
		for (let panel of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-drawer-panel]'))) {
			panel.hidden = panel.dataset.drawerPanel !== name;
		}
		document.documentElement.setAttribute('drawer-tab', name);
		if (name === 'tile') {
			this._autoSelectFirstTileIfNeeded();
		}
		if (name === 'advanced' && typeof this.fillNeverCaptureUI === 'function') {
			this.fillNeverCaptureUI();
		}
	},
	_autoSelectFirstTileIfNeeded() {
		// Only on the Tile tab — Page/Advanced don't depend on a selection.
		// Empty state ("Click a tile to edit") still surfaces when the grid
		// is genuinely empty.
		if (document.documentElement.getAttribute('drawer-tab') !== 'tile') {
			return;
		}
		if (this.selectedSiteIndex != null) {
			return;
		}
		if (!Grid.sites) {
			return;
		}
		let first = Grid.sites.findIndex(s => s && s.node);
		if (first >= 0) {
			this.selectedSiteIndex = first;
		}
	},
	resizeOptionsThumbnail() {
		let node = /** @type {HTMLElement | null} */ (Grid.node.querySelector('.newtab-thumbnail'));
		if (!node || !node.offsetWidth) {
			return;
		}
		let ratio = node.offsetWidth / node.offsetHeight;
		// Drawer is 360px wide with ~32px of padding — keep the preview well
		// inside that envelope so the edit fields don't get crowded.
		if (ratio > 1.6666) {
			this.siteThumbnail.style.width = '200px';
			this.siteThumbnail.style.height = 200 / ratio + 'px';
		} else {
			this.siteThumbnail.style.width = 120 * ratio + 'px';
			this.siteThumbnail.style.height = '120px';
		}
	},
	/**
	 * @param {number} cardSpace
	 * @param {number} gap
	 * @param {number} [full]
	 * @returns {{cardCount: number, slotWidth: number}}
	 */
	computeTitlebarSlots(cardSpace, gap, full = 186) {
		// `cardSpace` is the measured inner width of the recently-closed cards'
		// flex container (a greedy `flex: 1 1 0` child). It already excludes the
		// fixed search box, the content-width masthead and their gaps, so the
		// only job here is: how many cards fit, and how wide is each?
		//
		// Pick the SMALLEST card count whose common width — when the cards are
		// stretched to fill `cardSpace` with their internal gaps — stays at or
		// below `full`, then shrink that width down so the row fills the
		// container edge-to-edge (never grown above `full`). Reading a settled
		// integer `clientWidth` is far more stable than the old approach of
		// hand-subtracting a `getBoundingClientRect()` masthead measurement,
		// which jittered mid drawer-transition and left the row stuck at one
		// card until a reload.
		if (!cardSpace || cardSpace <= 0) {
			return { cardCount: 0, slotWidth: full };
		}
		let cardCount = Math.ceil((cardSpace + gap) / (full + gap));
		if (cardCount < 1) {
			cardCount = 1;
		}
		let slotWidth = Math.floor((cardSpace - (cardCount - 1) * gap) / cardCount);
		if (slotWidth > full) {
			slotWidth = full;
		}
		if (slotWidth < 1) {
			slotWidth = 1;
		}
		return { cardCount, slotWidth };
	},
	/**
	 * @param {number} gridWidth
	 * @param {number} gridHeight
	 * @param {number} rows
	 * @param {number} cols
	 * @param {number} gap
	 * @param {number | null} aspect
	 * @returns {{cellWidth: number, cellHeight: number} | null}
	 */
	computeCellDimensions(gridWidth, gridHeight, rows, cols, gap, aspect) {
		if (aspect == null) {
			return null;
		}
		if (gridWidth <= 0 || gridHeight <= 0 || rows <= 0 || cols <= 0) {
			return null;
		}
		let availW = gridWidth - (cols - 1) * gap;
		let availH = gridHeight - (rows - 1) * gap;
		if (availW <= 0 || availH <= 0) {
			return null;
		}
		let cellWFromWidth = availW / cols;
		let cellHFromWidth = cellWFromWidth / aspect;
		if (cellHFromWidth * rows + (rows - 1) * gap <= gridHeight) {
			return { cellWidth: cellWFromWidth, cellHeight: cellHFromWidth };
		}
		let cellHFromHeight = availH / rows;
		let cellWFromHeight = cellHFromHeight * aspect;
		return { cellWidth: cellWFromHeight, cellHeight: cellHFromHeight };
	},
	applyTileAspect() {
		if (!Grid.node) {
			return;
		}
		let grid = Grid.node;
		// 'fill' uses the existing flex behavior — clear inline vars and exit.
		let map = { 'fill': null, '16-9': 16 / 9, '4-3': 4 / 3, '1-1': 1, '3-4': 3 / 4 };
		let aspect = (/** @type {Record<string, number | null>} */ (map))[Prefs.tileAspect];
		if (aspect == null) {
			grid.style.removeProperty('--cell-width');
			grid.style.removeProperty('--cell-height');
			return;
		}
		let gap = parseInt(getComputedStyle(grid).getPropertyValue('--ntt-gap')) || 18;
		let dims = this.computeCellDimensions(
			grid.clientWidth, grid.clientHeight,
			Prefs.rows, Prefs.columns, gap, aspect
		);
		if (!dims) {
			return;
		}
		grid.style.setProperty('--cell-width', dims.cellWidth + 'px');
		grid.style.setProperty('--cell-height', dims.cellHeight + 'px');
	},
	/** @param {string} [highlightHost] */
	async fillFilterUI(highlightHost) {
		// `s` is guaranteed non-null by the `.filter()` predicate, but a
		// predicate without a `s is Site` type guard doesn't narrow the
		// downstream `.reduce()`'s element type — cast, not a fix.
		let pinned = Grid.sites.filter(s => s && 'position' in s.link).reduce((carry, s) => {
			let host = new URL(/** @type {Site} */ (s).url).host;
			if (!(host in carry)) {
				carry[host] = 0;
			}
			carry[host]++;
			return carry;
		}, Object.create(null));
		let filters = Filters.getList();

		// No null-check on any of the three lookups below (existing
		// assumption: the filter table/template are always present in
		// newTab.html) — cast, not a fix.
		let table = /** @type {HTMLTableElement} */ (newTabTools.optionsFilter.querySelector('table'));
		while (table.tBodies[0].rows.length) {
			table.tBodies[0].rows[0].remove();
		}

		let template = /** @type {HTMLTemplateElement} */ (table.querySelector('template'));
		let last = null;
		for (let k of Object.keys(pinned).concat(Object.keys(filters)).sort()) {
			if (k == last) {
				continue;
			}
			last = k;

			let row = /** @type {HTMLTableRowElement} */ (/** @type {Element} */ (template.content.firstElementChild).cloneNode(true));
			row.cells[0].textContent = k;
			row.cells[1].textContent = pinned[k] || 0;
			/** @type {HTMLElement} */ (row.cells[2].querySelector('span')).textContent = k in filters ? filters[k] : this.getString('filter_unlimited');
			// An explicit remove (✕) on real filter rows only — appended into the
			// limit cell so it doesn't add a column that would overflow the drawer.
			// Pinned-only rows (a pinned tile with no limit) have no filter to
			// remove; those are managed by unpinning on the board.
			if (k in filters) {
				/** @type {HTMLButtonElement} */ (row.querySelector('.minus-button')).disabled = false;
				let removeBtn = el('button', 'ntt-filter-remove', '✕');
				removeBtn.title = this.getString('filter_remove');
				row.cells[2].append(removeBtn);
			}
			table.tBodies[0].append(row);
			if (highlightHost && k == highlightHost) {
				row.animate([
					{'backgroundColor': '#f0ff'},
					{'backgroundColor': '#f0f0'}
				], {duration: 500, fill: 'both'});
			}
		}

		if (this.optionsFilterHostAutocomplete.childElementCount === 0) {
			let {version} = await browser.runtime.getBrowserInfo();
			let options;
			if (compareVersions(version, '63.0a1') >= 0) {
				options = { limit: 100, onePerDomain: false, includeBlocked: true };
			} else {
				options = { providers: ['places'] };
			}
			chrome.topSites.get(options, /** @param {browser.topSites.MostVisitedURL[]} sites */ sites => {
				for (let s of sites.reduce((carry, site) => {
					let {protocol, host} = new URL(site.url);
					if (host && ['http:', 'https:', 'ftp:'].includes(protocol) && !carry.includes(host)) {
						carry.push(host);
					}
					return carry;
				}, /** @type {string[]} */ ([])).sort()) {
					let option = el('option', undefined, s);
					this.optionsFilterHostAutocomplete.appendChild(option);
				}
			});
		}
	},
	fillNeverCaptureUI() {
		// Render the never-capture host list — mirrors fillFilterUI's style but
		// uses a flat div list instead of a table (no pinned-count column needed).
		let container = this.optionsNeverCaptureList;
		if (!container) {
			return;
		}
		while (container.firstChild) {
			container.firstChild.remove();
		}
		for (let entry of NeverCapture.getList()) {
			let row = el('div', 'ntt-nevercapture-row');
			let text = el('span', undefined, entry);  // textContent only — no innerHTML
			let removeBtn = el('button', 'ntt-nevercapture-remove', '✕');
			removeBtn.title = this.getString('nevercapture_remove');
			removeBtn.dataset.entry = entry;
			row.appendChild(text);
			row.appendChild(removeBtn);
			container.appendChild(row);
		}
	},
	startup() {
		if (!window.chrome) {
			// The page couldn't be loaded properly because WebExtensions is too slow. Sad.
			return;
		}

		document.querySelectorAll('[data-message]').forEach(n => {
			/** @type {HTMLElement} */ (n).textContent = newTabTools.getString(/** @type {string} */ (/** @type {HTMLElement} */ (n).dataset.message));
		});
		document.querySelectorAll('[data-placeholder]').forEach(n => {
			/** @type {HTMLInputElement} */ (n).placeholder = newTabTools.getString(/** @type {string} */ (/** @type {HTMLElement} */ (n).dataset.placeholder));
		});
		document.querySelectorAll('[data-title]').forEach(n => {
			/** @type {HTMLElement} */ (n).title = newTabTools.getString(/** @type {string} */ (/** @type {HTMLElement} */ (n).dataset.title));
		});
		document.querySelectorAll('[data-label]').forEach(n => {
			// No null-check on `.parentNode` (existing assumption: every
			// `[data-label]` node in newTab.html has one) — cast, not a fix.
			/** @type {Node} */ (n.parentNode).insertBefore(document.createTextNode(newTabTools.getString(/** @type {string} */ (/** @type {HTMLElement} */ (n).dataset.label))), n.nextSibling);
		});
		document.querySelectorAll('[data-version-slot]').forEach(n => {
			n.textContent = chrome.runtime.getManifest().version;
		});

		Prefs.init().then(() => {
			// Everything is loaded. Initialize the New Tab Page.
			Page.init();
			newTabTools._initTitlebar();
			AwesomeBar.init({ tilesSource: () => Grid.sites });
			newTabTools._initAutoSaveIndicator();
			newTabTools.updateUI();
			newTabTools.refreshBackgroundImage();

			chrome.sessions.onChanged.addListener(function() {
				newTabTools.refreshRecent();
			});

			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
				if (Prefs.theme === 'system') {
					newTabTools.updateUI(['theme']);
				}
			});

			// Forget about visiting this page. It shouldn't be in the history.
			// Maybe if bug 1322304 is ever fixed we could remove this.
			chrome.permissions.contains({permissions: ['history']}, /** @param {boolean} contains */ contains => {
				if (contains) {
					chrome.history.deleteUrl({ url: location.href });
					this.pinURLBlocked.hidden = true;
				}
			});
		}).catch(console.error);
	},
	getThumbnails() {
		chrome.runtime.sendMessage({
			name: 'Thumbnails.get',
			// `s` is guaranteed non-null by the `.filter()` predicate above
			// (no `s is Site` type guard, so `.map()` doesn't see the
			// narrowing) — cast, not a fix.
			urls: Grid.sites.filter(s => s && !s.thumbnail.style.backgroundImage).map(s => /** @type {Site} */ (s).link.url)
		}, /** @param {Map<string, Blob>} thumbs */ function(thumbs) {
			Grid.sites.forEach(s => {
				if (!s) {
					return;
				}
				let link = s.link;
				if (!link.image) {
					let thumb = thumbs.get(link.url);
					if (thumb) {
						// Stash on the site under the same key site.js's
						// refreshThumbnail uses, so whichever path re-renders
						// the tile next revokes the other's URL (§4.3).
						if (s._thumbnailObjectURL) {
							URL.revokeObjectURL(s._thumbnailObjectURL);
						}
						s._thumbnailObjectURL = URL.createObjectURL(thumb);
						let css = 'url(' + s._thumbnailObjectURL + ')';
						s.thumbnail.style.backgroundImage = css;
						let logoFallback = s.thumbnail.querySelector('.ntt-logo-fallback');
						if (logoFallback) {
							logoFallback.remove();
						}

						if (newTabTools.selectedSite == s) {
							newTabTools.siteThumbnail.style.backgroundImage = css;
							newTabTools.saveCurrentThumbButton.disabled = false;
						}
					}
				}
			});
			// After thumbnails settle, pull favicons for any cell that still
			// shows the logo-fallback (i.e. no screenshot found).
			newTabTools.getFavicons();
		});
	},
	getFavicons() {
		// Pull favicons for any tile whose overlay badge (`.ntt-favicon`) is
		// still showing the letter-glyph fallback (no `<img>` yet). This
		// covers both screenshot-covered tiles and fallback-only tiles —
		// the badge in the bottom overlay is visible regardless of whether
		// the centred fallback glyph is showing.
		let urls = Grid.sites
			.filter(s => {
				if (!s || !s._querySelector) { return false; }
				let badge = s._querySelector('.ntt-favicon');
				return badge && !badge.querySelector('img');
			})
			.map(s => /** @type {Site} */ (s).link.url);
		if (!urls.length) {
			return;
		}
		chrome.runtime.sendMessage({ name: 'Thumbnails.getFavicons', urls }, /** @param {Map<string, Blob | string> | undefined} favicons */ function(favicons) {
			if (!favicons || typeof favicons.get !== 'function') {
				return;
			}
			Grid.sites.forEach(s => {
				if (!s || !s.applyFavicon) {
					return;
				}
				let favicon = favicons.get(s.link.url);
				// A Blob is a cached data: favicon; a string is a remote favicon
				// URL — validate it (https/http only) before it becomes an <img src>.
				if (favicon instanceof Blob) {
					s.applyFavicon(favicon);
				} else if (typeof favicon === 'string' && newTabTools.isValidURL(favicon)) {
					s.applyFavicon(favicon);
				}
			});
		});
	}
};

/** @type {typeof NewTabToolsObject & NewTabToolsPageRefs} */
export const newTabTools = /** @type {any} */ (NewTabToolsObject);

/**
 * Page-side broadcast listener — the page's first and only runtime.onMessage
 * listener (Slice A of the MV3 migration: replaces the background's
 * extension.getViews() access to page globals, see MV3_MIGRATION.md).
 *
 * runtime.sendMessage fans out to every extension context, so this listener
 * also receives page→background messages (Tiles.*, Thumbnails.*, …). It must
 * act only on the broadcast Page.* names below and return a falsy value for
 * everything else — returning true or calling sendResponse here would hijack
 * response routing that belongs to the background dispatcher
 * (lib/messages.js).
 *
 * Dispatches directly — no guard, no queue. `Updater`/`Grid` are real
 * ES-module imports (top of this file, from updater.js/grid.js), and
 * PAGE_MODULES.md's P5 import cycle guarantees grid.js's own top-level
 * evaluation completes BEFORE this file's top level reaches the
 * `browser.runtime.onMessage.addListener(pageMessageHandler)` call below —
 * so by the time the listener can ever be invoked, both names are already
 * initialized. The former MV3-review-§4.3/MODERNIZATION.md-M5
 * `typeof … !== 'undefined'` guards and early-broadcast queue (+
 * `flushQueued()` replay) existed for a load-order hazard that no longer
 * exists post-P5; retired as provably-unreachable dead code in chrome-prep
 * C3a (CHROME_PREP.md).
 *
 * @param {{name?: string}} message
 * @returns {boolean} always false — never claims the sendResponse channel
 */
export function pageMessageHandler(message) {
	switch (message && message.name) {
	case 'Page.updateGrid':
		Updater.updateGrid();
		break;
	case 'Page.restoreComplete':
		// A restore just rewrote prefs/tiles/background (lib/backup.js's readZip).
		// Refresh the wallpaper, then rebuild the grid from scratch —
		// `Updater.updateGrid` reuses existing Site instances whose in-memory
		// `_link` still points at pre-restore data, so only `Grid.refresh()`
		// picks up the newly-restored links — and finally pull thumbnails for
		// the rebuilt tiles (`Grid.refresh()` doesn't read the Thumbnails IDB
		// store on its own).
		newTabTools.refreshBackgroundImage();
		Grid.refresh().then(() => newTabTools.getThumbnails());
		break;
	}
	return false;
}

browser.runtime.onMessage.addListener(pageMessageHandler);

(function() {
	newTabTools.updateThemeColours = newTabTools.updateThemeColours.bind(newTabTools);
	let uiElements = {
		'darkIcons': 'dark-icons',
		'backgroundFake': 'background-fake',
		'page': 'newtab-scrollbox', // used in grid.js
		'optionsToggleButton': 'options-toggle',
		'pinURLBlocked': 'options-pinURL-blocked',
		'pinURLInput': 'options-pinURL-input',
		'pinURLButton': 'options-pinURL',
		'pinURLAutocomplete': 'autocomplete',
		'siteThumbnail': 'options-thumbnail',
		'siteURLInput': 'options-url-input',
		'setURLButton': 'options-url-set',
		'saveCurrentThumbButton': 'options-savethumb',
		'setSavedThumbInput': 'options-savedthumb-input',
		'removeSavedThumbButton': 'options-savedthumb-remove',
		'setBgColourInput': 'options-bgcolor-input',
		'setBgColourDisplay': 'options-bgcolor-display',
		'setBgColourButton': 'options-bgcolor-set',
		'resetBgColourButton': 'options-bgcolor-reset',
		'editSiteTitleRow': 'options-edit-title',
		'setTitleInput': 'options-title-input',
		'setTitleButton': 'options-title-set',
		'removeBackgroundButton': 'options-bg-remove',
		'recentList': 'ntt-titlebar-recent',
		'drawerEl': 'ntt-drawer',
		'optionsFilter': 'options-filter',
		'optionsFilterHost': 'options-filter-host',
		'optionsFilterHostAutocomplete': 'host-autocomplete',
		'optionsFilterCount': 'options-filter-count',
		'optionsFilterSet': 'options-filter-set',
		'optionsNeverCapture': 'options-nevercapture',
		'optionsNeverCaptureHost': 'options-nevercapture-host',
		'optionsNeverCaptureAdd': 'options-nevercapture-add',
		'optionsNeverCaptureList': 'options-nevercapture-list',
		'databaseError': 'database-error'
	};
	for (let key in uiElements) {
		let value = (/** @type {Record<string, string>} */ (uiElements))[key];
		// `key` is a plain `string` (from `for…in`), so it can't be checked
		// against `newTabTools`'s precise per-property element types here —
		// same shape of problem as prefs.js's `__defineGetter__` loop, solved
		// the same way: a cast that's honest about what this loop actually
		// writes (an element or `null` from `getElementById`), not an `any`
		// escape hatch. The per-property types above are what every other
		// read in this file sees.
		/** @type {Record<string, HTMLElement | null>} */ (/** @type {unknown} */ (newTabTools))[key] = document.getElementById(value);
	}

	/** @param {KeyboardEvent} event */
	function keyUpHandler(event) {
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.key) > -1) {
			newTabTools.drawerOnChange(event);
		} else if (event.key == 'Escape') {
			newTabTools.closeDrawer();
		}
	}

	newTabTools.optionsToggleButton.addEventListener('click', newTabTools.toggleDrawer.bind(newTabTools));
	newTabTools.pinURLInput.addEventListener('input', newTabTools.autocomplete.bind(newTabTools));
	newTabTools.drawerEl.addEventListener('click', function(event) {
		// Per-tile editing controls (arrows, set-url, set-title, etc.) live
		// inside the Tile panel and are handled by `optionsOnClick`. Form
		// atoms (segmented buttons, toggles, tab buttons) are handled by
		// `drawerOnClick`. They check disjoint sets of targets so order is
		// safe.
		newTabTools.drawerOnClick(event);
		newTabTools.optionsOnClick(event);
	});
	newTabTools.drawerEl.addEventListener('change', newTabTools.drawerOnChange.bind(newTabTools));
	// Range inputs fire `input` continuously during drag; `change` only on
	// release. Realtime drawer feedback (gap / padding / radius sliders)
	// needs the `input` events too.
	newTabTools.drawerEl.addEventListener('input', /** @param {Event} event */ function(event) {
		let target = /** @type {DelegatedEventTarget} */ (event.target);
		if (target.type === 'range' && target.dataset && target.dataset.pref) {
			newTabTools.drawerOnChange(event);
		}
	});
	for (let c of newTabTools.drawerEl.querySelectorAll('select, input[type="range"]')) {
		c.addEventListener('keyup', /** @type {EventListener} */ (/** @type {unknown} */ (keyUpHandler)));
	}
	for (let c of /** @type {NodeListOf<HTMLInputElement>} */ (newTabTools.drawerEl.querySelectorAll('input[type="file"]'))) {
		c.addEventListener('change', function() {
			// `.files` is `FileList | null` (null only for non-file inputs —
			// every `c` here is a real `type="file"` input); no guard existed
			// before this slice either. Cast, not a fix.
			let files = /** @type {FileList} */ (c.files);
			/** @type {HTMLButtonElement} */ (c.nextElementSibling).disabled = !files.length;
			let row = c.parentNode;
			// Themed file controls (e.g. Restore): reflect the chosen filename in the
			// `.ntt-file-name` span beside the styled <label>, since the native input
			// (and its "No file selected." text) is visually hidden.
			let nameEl = row && row.querySelector('.ntt-file-name');
			if (nameEl) {
				nameEl.textContent = files.length
					? files[0].name
					: newTabTools.getString('backup_no_file');
			}
			// The "Choose image" row's Clear button is enabled only with a pending file.
			let clear = row && row.querySelector('#options-savedimg-clear');
			if (clear) { /** @type {HTMLButtonElement} */ (clear).disabled = !files.length; }
		});
	}
	newTabTools.setBgColourInput.addEventListener('change', function() {
		newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
		newTabTools.setBgColourButton.disabled = false;
	});
	newTabTools.optionsFilterCount.addEventListener('keydown', function(event) {
		if (event.key.length == 1 && (event.key < '0' || event.key > '9')) {
			event.preventDefault();
		}
	});
	newTabTools.optionsFilterHost.oninput = newTabTools.optionsFilterCount.oninput = function() {
		newTabTools.optionsFilterSet.disabled = !newTabTools.optionsFilterHost.checkValidity() || !newTabTools.optionsFilterCount.checkValidity();
	};

	// No null-check on any of the three lookups below (existing assumption:
	// all three ids are always present in newTab.html) — cast, not a fix.
	/** @type {HTMLElement} */ (document.getElementById('wallpaper-close')).addEventListener('click', function() {
		newTabTools.closeWallpaperPicker();
	});
	/** @type {HTMLElement} */ (document.getElementById('wallpaper-reset')).addEventListener('click', function() {
		newTabTools.resetWallpaper();
	});
	/** @type {HTMLInputElement} */ (document.getElementById('wallpaper-upload')).addEventListener('change', /** @this {HTMLInputElement} */ function() {
		// `.files` is `FileList | null` (null only for non-file inputs —
		// this is a real `type="file"` input) — cast, not a fix.
		let files = /** @type {FileList} */ (this.files);
		if (files.length) {
			let file = files[0];
			Prefs.backgroundUrl = '';
			Background.setBackground(file).then(() => {
				newTabTools.refreshBackgroundImage();
				newTabTools.closeWallpaperPicker();
			});
		}
	});

	browser.menus.onShown.addListener(newTabTools.contextMenuShowing);
	browser.menus.onClicked.addListener(newTabTools.contextMenuOnClick);

	window.addEventListener('keydown', function(event) {
		if (event.key == 'Escape') {
			// No null-check (existing assumption: always present in
			// newTab.html) — cast, not a fix.
			if (!/** @type {HTMLElement} */ (document.getElementById('wallpaper-picker')).hidden) {
				newTabTools.closeWallpaperPicker();
			} else if (!newTabTools.pinURLAutocomplete.hidden) {
				newTabTools.pinURLAutocomplete.hidden = true;
			} else if (document.documentElement.hasAttribute('drawer-open')) {
				newTabTools.closeDrawer();
			}
		} else if (document.activeElement == newTabTools.pinURLInput) {
			let current = /** @type {HTMLElement | null} */ (newTabTools.pinURLAutocomplete.querySelector('li.current'));
			switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				let items = [...newTabTools.pinURLAutocomplete.querySelectorAll('li:not([hidden]):not(#options-pinURL-blocked)')];
				if (!items.length) {
					return;
				}

				let index = event.key == 'ArrowDown' ? 0 : items.length - 1;
				if (current) {
					current.classList.remove('current');
					let newIndex = items.indexOf(current) + (event.key == 'ArrowDown' ? 1 : -1);
					if (items[newIndex]) {
						index = newIndex;
					}
				}
				items[index].classList.add('current');
				break;
			case 'Enter':
			case 'Tab':
				if (current) {
					newTabTools.setPinURLInputValue(/** @type {string} */ (current.dataset.url));
				}
				newTabTools.pinURLAutocomplete.hidden = true;
				break;
			}
		}
	});
	window.addEventListener('click', function(event) {
		if (event.button != 0) {
			return;
		}
		if (newTabTools.pinURLInput == event.target) {
			if (newTabTools.pinURLAutocomplete.hidden) {
				newTabTools.autocomplete();
			}
			return;
		}
		if (newTabTools.pinURLAutocomplete.hidden) {
			return;
		}
		if (newTabTools.pinURLAutocomplete.compareDocumentPosition(/** @type {Node} */ (event.target)) & Node.DOCUMENT_POSITION_CONTAINED_BY) {
			let target = /** @type {Element} */ (event.target).closest('li');
			if (!target) {
				return;
			}
			if (target != newTabTools.pinURLBlocked) {
				newTabTools.setPinURLInputValue(/** @type {string} */ (target.dataset.url));
			}
			return;
		}
		newTabTools.pinURLAutocomplete.hidden = true;
		event.stopPropagation();
	}, true);
	window.addEventListener('resize', function() {
		newTabTools.refreshRecent();
		newTabTools.applyTileAspect();
	});
})();

