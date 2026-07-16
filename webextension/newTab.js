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
//
// chrome-prep C4d (CHROME_PREP.md): seven leaf modules split out of this
// file's former body (theme.js, wallpaper.js, titlebar.js,
// autosave-indicator.js, filters-ui.js, object-urls.js, ui-refs.js) — this
// residual controller now calls their exported functions directly instead
// of the former `this.X` methods; none of the seven ever imports this file
// back (fan-out only), so this import list grows without adding a new
// cycle edge of its own (titlebar.js/filters-ui.js each import grid.js,
// which already cycles back to this file — see their own header comments).
import { AwesomeBar } from './awesomebar.js';
import { Background, Tiles } from './tiles-shim.js';
import { TileStats } from './stats.js';
import { Blocked, Filters, NeverCapture, Prefs } from './prefs.js';
import { getString, isValidURL } from './common.js';
import { Grid } from './grid.js';
import { Page } from './page.js';
import { Updater } from './updater.js';
import { getThemedImageURL, updateThemeColours } from './theme.js';
import { refreshBackgroundImage, openWallpaperPicker, closeWallpaperPicker, resetWallpaper } from './wallpaper.js';
import { _initTitlebar, refreshRecent } from './titlebar.js';
import { _initAutoSaveIndicator } from './autosave-indicator.js';
import { fillFilterUI, fillNeverCaptureUI } from './filters-ui.js';
import { uiRefs, populateUiRefs } from './ui-refs.js';
import { _freshObjectURL, _dropObjectURL } from './object-urls.js';
import { api } from './api.js';

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

// chrome-prep C4d (CHROME_PREP.md): the `WallpaperRecord`/`RawWallpaperRecord`
// typedefs (fetchFirefoxWallpapers/renderWallpaperGrid/selectWallpaper) and
// `SessionTab` (refreshRecent's destructure) moved WITH their owning
// functions to wallpaper.js/titlebar.js respectively (types travel with
// their dominant consumer, the C4a precedent) — no longer declared here.

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
	// chrome-prep C4d (CHROME_PREP.md): `_wallpaperCache`/`_theme`/
	// `_titlebarResizeObserver`/`_recentCardCount`/`_recentFaviconURLs`/
	// `_autoSavedAt`/`_autoSaveTickInterval`/`_objectURLs` all moved WITH
	// their owning functions to wallpaper.js/theme.js/titlebar.js/
	// autosave-indicator.js/object-urls.js as explicit module state — no
	// longer declared on this object.
	/** @type {number | null} */
	_selectedSiteIndex: null,

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
	//
	// chrome-prep C4d (CHROME_PREP.md): `backgroundFake`/
	// `removeBackgroundButton`/`recentList`/`optionsFilter`/
	// `optionsFilterHostAutocomplete`/`optionsNeverCaptureList` moved OFF this
	// literal (and off the `uiElements` table below) onto ui-refs.js's
	// `uiRefs` object instead — the six ids an extracted leaf module
	// actually reads (ui-refs.js's own header comment has the full
	// rationale + the uiElements-vs-uiRefs choice this arc made). This
	// object keeps every OTHER ref (residual-only) exactly as before.
	/** @type {HTMLLinkElement} */
	darkIcons: /** @type {HTMLLinkElement} */ (/** @type {unknown} */ (null)),
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
	/** @type {HTMLElement} */
	drawerEl: /** @type {HTMLElement} */ (/** @type {unknown} */ (null)),
	/** @type {HTMLInputElement} */
	optionsFilterHost: /** @type {HTMLInputElement} */ (/** @type {unknown} */ (null)),
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
				api.history.search({ text: url, startTime: 0 }, /** @param {browser.history.HistoryItem[]} results */ results => {
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

			getThemedImageURL(type, 'dark').then(url => {
				/** @type {HTMLElement} */ (option.querySelector('.autocomplete-icon')).style.backgroundImage = /** @type {string} */ (url ? `url(${url})` : null);
			});
			urls.push(item.url);
		};

		api.tabs.query({}, /** @param {browser.tabs.Tab[]} tabs */ tabs => {
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

			api.bookmarks.getTree(/** @param {browser.bookmarks.BookmarkTreeNode[]} tree */ tree => {
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

				api.history.search({
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
			// Chrome enforces the user-gesture rule strictly for permissions.request
			// — this call must stay synchronous inside the click handler; don't
			// defer it behind an `await` (audit §traps).
			api.permissions.request({permissions: ['bookmarks', 'history']}, /** @param {boolean} succeeded */ (succeeded) => {
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
			api.runtime.sendMessage({
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
			openWallpaperPicker();
			break;
		case 'options-bg-remove':
			resetWallpaper();
			break;
		case 'historytiles-filter': {
			// Toggle the filter panel (it starts hidden); only (re)populate when
			// opening so a second click cleanly collapses it.
			let opening = uiRefs.optionsFilter.hidden;
			uiRefs.optionsFilter.hidden = !opening;
			target.setAttribute('aria-expanded', String(opening));
			if (opening) {
				fillFilterUI();
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
			fillFilterUI(host);
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
				api.runtime.sendMessage({name: 'Thumbnails.purgeHost', host}, () => {
					Grid.refresh().then(() => this.getThumbnails());
				});
				this.optionsNeverCaptureHost.value = '';
				fillNeverCaptureUI();
			});
			return;
		}
		case 'options-backup':
			// Chrome enforces the user-gesture rule strictly for permissions.request
			// — this call must stay synchronous inside the click handler; don't
			// defer it behind an `await` (audit §traps).
			api.permissions.request({permissions: ['downloads']}, function() {
				api.runtime.sendMessage({name: 'Export:backup'});
			});
			return;
		case 'options-restore':
			// Restore overwrites the whole setup — require an explicit inline
			// Confirm/Cancel (§7) rather than acting on the first click.
			this._showConfirm('options-restore-confirm-row');
			return;
		case 'options-restore-confirm': {
			let input = /** @type {HTMLInputElement} */ (document.getElementById('options-restore-file'));
			api.runtime.sendMessage({name: 'Import:restore', file: /** @type {FileList} */ (input.files)[0]});
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
			fillFilterUI();
			return;
		}

		if (classList.contains('ntt-nevercapture-remove')) {
			// Remove the entry from the never-capture list (no purge — the user is
			// only un-suppressing auto-capture, not deleting existing screenshots).
			let entry = target.dataset.entry || '';
			NeverCapture.remove(entry).then(() => {
				fillNeverCaptureUI();
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
			let target = /** @type {Element} */ (api.menus.getTargetElement(/** @type {number} */ (info.targetElementId)));
			let site = /** @type {SiteNode | null} */ (target.closest('.newtab-site'));
			let pinned = site && /** @type {Site} */ (site._newtabSite).isPinned;

			api.menus.update('edit', { visible: !!site });
			api.menus.update('pin', { visible: !!site && !pinned });
			api.menus.update('unpin', { visible: /** @type {boolean | undefined} */ (!!site && pinned) });
			api.menus.update('block', { visible: !!site });
			api.menus.refresh();
		}
	},
	/** @param {browser.menus.OnClickData} info */
	contextMenuOnClick(info) {
		let target = /** @type {Element} */ (api.menus.getTargetElement(/** @type {number} */ (info.targetElementId)));
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

				let thumbnailURL = _freshObjectURL('editorThumb', /** @type {Blob} */ (link.image));
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
	// chrome-prep C4d (CHROME_PREP.md): `_objectURLs`/`_freshObjectURL`/
	// `_dropObjectURL` moved to object-urls.js; `refreshBackgroundImage`/
	// `fetchFirefoxWallpapers`/`openWallpaperPicker`/`closeWallpaperPicker`/
	// `renderWallpaperGrid`/`selectWallpaper`/`resetWallpaper` moved to
	// wallpaper.js; `parseColour`/`updateThemeColours`/`getThemedImageURL`
	// moved to theme.js. This residual controller imports their exported
	// functions (top of file) and calls them directly at every former
	// `this.X`/`newTabTools.X` call site below.
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
			updateThemeColours();
			// chrome-prep D2 slice 2 (decision of record: `prefers-color-scheme`
			// is the base, `browser.theme` is a Firefox bonus — Chrome has no
			// `theme` namespace at all). Gated like the existing `'menus' in
			// api` precedent below: on Firefox this still registers/removes
			// exactly as before this slice; on Chrome nothing is registered
			// (the `prefers-color-scheme` base above already renders unthemed).
			if ('theme' in api) {
				if (theme === 'system') {
					api.theme.onUpdated.addListener(updateThemeColours);
				} else {
					api.theme.onUpdated.removeListener(updateThemeColours);
				}
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
			refreshBackgroundImage();
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
			refreshRecent();
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
			refreshRecent();
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
			if (uiRefs.optionsNeverCaptureList) {
				fillNeverCaptureUI();
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
	// chrome-prep C4d (CHROME_PREP.md): `_initTitlebar`/`_layoutTitlebar`/
	// `_formatAge`/`refreshRecent` + `computeTitlebarSlots` moved to
	// titlebar.js (imported at top of file); called directly at every
	// former `this.X`/`newTabTools.X` call site below.
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
			api.runtime.sendMessage({ name: 'Tiles.clear' }, () => resolve());
		}));
		await /** @type {Promise<void>} */ (new Promise(resolve => {
			api.runtime.sendMessage({ name: 'Thumbnails.clear' }, () => resolve());
		}));
		await /** @type {Promise<void>} */ (new Promise(resolve => {
			api.runtime.sendMessage({ name: 'Background.setBackground', file: null }, () => resolve());
		}));
		// Blocked + Filters + NeverCapture live inside chrome.storage.local, so
		// clearing it wipes them along with prefs. We zero the in-memory copies
		// too so anything reading them before reload sees the cleared state.
		Blocked._list = [];
		Filters._list = Object.create(null);
		NeverCapture.clear();
		await new Promise(resolve => api.storage.local.clear(resolve));
		// Reload so every component picks up the cleared state from a
		// known-clean start.
		location.reload();
	},
	// chrome-prep C4d (CHROME_PREP.md): `formatRelativeTime`/
	// `_renderAutoSavedIndicator`/`_markAutoSaved`/`_initAutoSaveIndicator`
	// moved to autosave-indicator.js. `_initAutoSaveIndicator` is imported
	// at top of file (called once from startup() below); `_markAutoSaved`
	// is no longer a `newTabTools` method at all — page-main.js's `Prefs.
	// onChange` listener now imports it directly from autosave-indicator.js
	// (see page-main.js's own updated import).
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
			_dropObjectURL('editorThumb');
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
			let thumbnailURL = _freshObjectURL('editorThumb', confirmedSite.link.image);
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
			_dropObjectURL('editorThumb');
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
			// Stats other than `none` need the optional `history` permission.
			// Request it now (we are in a user-gesture handler).
			if (pref === 'statType' && raw !== 'none') {
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
		if (typeof api === 'undefined' || !api.permissions) {
			return;
		}
		// Firefox loses the user-gesture context across async callbacks, so
		// we must call `request` synchronously from the click handler. The
		// request itself short-circuits when the permission is already
		// granted (`accepted` will be true with no prompt shown). Chrome
		// enforces this same user-gesture rule strictly too (audit §traps) —
		// don't defer this call behind an `await` on either platform.
		api.permissions.request({ permissions: ['history'] }, /** @param {boolean} accepted */ accepted => {
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
			refreshRecent();
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
		if (name === 'advanced' && typeof fillNeverCaptureUI === 'function') {
			fillNeverCaptureUI();
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
	// chrome-prep C4d (CHROME_PREP.md): `computeTitlebarSlots` moved to
	// titlebar.js alongside `_layoutTitlebar` (its only caller) — no
	// residual call site references it directly.
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
	// chrome-prep C4d (CHROME_PREP.md): `fillFilterUI`/`fillNeverCaptureUI`
	// moved to filters-ui.js (imported at top of file); called directly at
	// every former `this.X`/`newTabTools.X` call site (optionsOnClick/
	// updateUI/switchDrawerTab above).
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
			n.textContent = api.runtime.getManifest().version;
		});

		Prefs.init().then(() => {
			// Everything is loaded. Initialize the New Tab Page.
			Page.init();
			_initTitlebar();
			AwesomeBar.init({ tilesSource: () => Grid.sites });
			_initAutoSaveIndicator();
			newTabTools.updateUI();
			refreshBackgroundImage();

			api.sessions.onChanged.addListener(function() {
				refreshRecent();
			});

			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
				if (Prefs.theme === 'system') {
					newTabTools.updateUI(['theme']);
				}
			});

			// Forget about visiting this page. It shouldn't be in the history.
			// Maybe if bug 1322304 is ever fixed we could remove this.
			api.permissions.contains({permissions: ['history']}, /** @param {boolean} contains */ contains => {
				if (contains) {
					api.history.deleteUrl({ url: location.href });
					this.pinURLBlocked.hidden = true;
				}
			});
		}).catch(console.error);
	},
	getThumbnails() {
		api.runtime.sendMessage({
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
		api.runtime.sendMessage({ name: 'Thumbnails.getFavicons', urls }, /** @param {Map<string, Blob | string> | undefined} favicons */ function(favicons) {
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
		refreshBackgroundImage();
		Grid.refresh().then(() => newTabTools.getThumbnails());
		break;
	}
	return false;
}

api.runtime.onMessage.addListener(pageMessageHandler);

(function() {
	// chrome-prep C4d (CHROME_PREP.md): `updateThemeColours` is now a plain
	// theme.js function with no `this` — the former `.bind(newTabTools)`
	// rebind is gone (it's imported directly and used as-is below/in
	// updateUI). `populateUiRefs` fills the six ids ui-refs.js's leaf
	// modules read (moved OFF the `uiElements` table below — see ui-refs.js's
	// own header comment).
	populateUiRefs({
		backgroundFake: 'background-fake',
		removeBackgroundButton: 'options-bg-remove',
		recentList: 'ntt-titlebar-recent',
		optionsFilter: 'options-filter',
		optionsFilterHostAutocomplete: 'host-autocomplete',
		optionsNeverCaptureList: 'options-nevercapture-list',
	});
	let uiElements = {
		'darkIcons': 'dark-icons',
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
		'drawerEl': 'ntt-drawer',
		'optionsFilterHost': 'options-filter-host',
		'optionsFilterCount': 'options-filter-count',
		'optionsFilterSet': 'options-filter-set',
		'optionsNeverCapture': 'options-nevercapture',
		'optionsNeverCaptureHost': 'options-nevercapture-host',
		'optionsNeverCaptureAdd': 'options-nevercapture-add',
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
		closeWallpaperPicker();
	});
	/** @type {HTMLElement} */ (document.getElementById('wallpaper-reset')).addEventListener('click', function() {
		resetWallpaper();
	});
	/** @type {HTMLInputElement} */ (document.getElementById('wallpaper-upload')).addEventListener('change', /** @this {HTMLInputElement} */ function() {
		// `.files` is `FileList | null` (null only for non-file inputs —
		// this is a real `type="file"` input) — cast, not a fix.
		let files = /** @type {FileList} */ (this.files);
		if (files.length) {
			let file = files[0];
			Prefs.backgroundUrl = '';
			Background.setBackground(file).then(() => {
				refreshBackgroundImage();
				closeWallpaperPicker();
			});
		}
	});

	// chrome-prep C5b (CHROME_PREP.md, Decision 1 / audit §5): Chrome has no
	// `menus` namespace — gate the registration (and, transitively,
	// `contextMenuShowing`/`contextMenuOnClick`, which can only ever run via
	// these listeners) so a Chrome build registers nothing instead of
	// throwing here. Firefox always has `menus`, so this still registers
	// exactly as before this slice on the real gate.
	if ('menus' in api) {
		api.menus.onShown.addListener(newTabTools.contextMenuShowing);
		api.menus.onClicked.addListener(newTabTools.contextMenuOnClick);
	}

	window.addEventListener('keydown', function(event) {
		if (event.key == 'Escape') {
			// No null-check (existing assumption: always present in
			// newTab.html) — cast, not a fix.
			if (!/** @type {HTMLElement} */ (document.getElementById('wallpaper-picker')).hidden) {
				closeWallpaperPicker();
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
		refreshRecent();
		newTabTools.applyTileAspect();
	});
})();

