/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): the wallpaper cache/picker/apply
// functions extracted verbatim from newTab.js: `refreshBackgroundImage`
// (apply), `fetchFirefoxWallpapers` (cache), `openWallpaperPicker`/
// `closeWallpaperPicker`/`renderWallpaperGrid`/`selectWallpaper`/
// `resetWallpaper` (picker). `_wallpaperCache` (newTab.js's former
// `this._wallpaperCache`) becomes explicit module state. `uiRefs.
// backgroundFake`/`uiRefs.removeBackgroundButton` replace the former
// `this.backgroundFake`/`this.removeBackgroundButton` reads (ui-refs.js);
// `_freshObjectURL`/`_dropObjectURL` replace `this._freshObjectURL`/
// `this._dropObjectURL` (object-urls.js, genuinely shared with newTab.js's
// own tile-editing code). A leaf module: never imports newTab.js, never
// calls updateUI — newTab.js's `updateUI`/optionsOnClick call these
// functions directly instead.
import { Prefs } from './prefs.js';
import { Background } from './tiles-shim.js';
import { getString } from './common.js';
import { el } from './dom.js';
import { uiRefs } from './ui-refs.js';
import { _freshObjectURL, _dropObjectURL } from './object-urls.js';
import { isMozillaWallpaperCatalogAvailable } from './api.js';

/**
 * Cached Firefox wallpaper catalogue (memoized by fetchFirefoxWallpapers).
 * @type {WallpaperRecord[] | undefined}
 */
let _wallpaperCache;

/**
 * Hardcoded solid-colour palette shown on Chrome instead of the live Mozilla
 * catalogue (CHROME.md D8 finding 2): a 2026-07-18 snapshot of the live
 * catalogue's `solid-colors` category records. Mozilla's attachment CDN
 * rejects Chrome User-Agents server-side (406), so Chrome can never load the
 * catalogue's photo attachments — `isMozillaWallpaperCatalogAvailable`
 * gates the whole live fetch off for Chrome and `fetchFirefoxWallpapers`
 * hands back this list instead, at zero network cost. Upload Image and No
 * Background remain separate drawer controls, unaffected by this fallback.
 * @type {WallpaperRecord[]}
 */
const CHROME_SOLID_WALLPAPERS = [
	{ title: 'blue', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#76C1FF' },
	{ title: 'light-blue', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#D4E7F6' },
	{ title: 'light-purple', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#D3A3F3' },
	{ title: 'light-green', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#DAE8E0' },
	{ title: 'green', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#A8DF8E' },
	{ title: 'beige', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#EDD5B8' },
	{ title: 'yellow', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#FFF7B2' },
	{ title: 'orange', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#FEBE5E' },
	{ title: 'pink', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#FA87CC' },
	{ title: 'light-pink', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#F4DBE9' },
	{ title: 'red', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#9D242D' },
	{ title: 'dark-blue', theme: 'dark', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#031A3E' },
	{ title: 'dark-purple', theme: 'dark', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#450A54' },
	{ title: 'dark-green', theme: 'dark', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#19310D' },
	{ title: 'brown', theme: 'light', category: 'solid-colors', backgroundPosition: 'center center', solidColor: '#401F00' },
];

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

export function refreshBackgroundImage() {
	// CDN wallpaper takes priority over IDB blob. Apply the
	// `background_position` Firefox publishes alongside each record so
	// e.g. "top left" wallpapers anchor at the corner the photographer
	// composed for. Solid-colour records fill the page instead.
	document.body.style.backgroundPosition =
		uiRefs.backgroundFake.style.backgroundPosition = Prefs.backgroundPosition || 'center center';
	document.body.style.backgroundColor = Prefs.backgroundColor || '';
	if (Prefs.backgroundUrl) {
		document.body.style.backgroundImage =
			uiRefs.backgroundFake.style.backgroundImage = 'url("' + Prefs.backgroundUrl + '")';
		_dropObjectURL('background');
		uiRefs.removeBackgroundButton.disabled = false;
		return Promise.resolve();
	}
	if (Prefs.backgroundColor) {
		document.body.style.backgroundImage = uiRefs.backgroundFake.style.backgroundImage = '';
		_dropObjectURL('background');
		uiRefs.removeBackgroundButton.disabled = false;
		return Promise.resolve();
	}

	return Background.getBackground().then(background => {
		if (!background) {
			document.body.style.backgroundImage = uiRefs.backgroundFake.style.backgroundImage = /** @type {string} */ (/** @type {unknown} */ (null));
			_dropObjectURL('background');
			uiRefs.removeBackgroundButton.disabled = true;
			uiRefs.removeBackgroundButton.blur();
			return;
		}

		document.body.style.backgroundImage =
			uiRefs.backgroundFake.style.backgroundImage = 'url("' + _freshObjectURL('background', /** @type {Blob} */ (background)) + '")';
		uiRefs.removeBackgroundButton.disabled = false;
	});
}

export async function fetchFirefoxWallpapers() {
	if (_wallpaperCache) {
		return _wallpaperCache;
	}
	if (!isMozillaWallpaperCatalogAvailable()) {
		// Chrome path (CHROME.md D8 finding 2): the attachment CDN 406s Chrome
		// UAs, so skip the network entirely — zero outbound requests by design.
		_wallpaperCache = CHROME_SOLID_WALLPAPERS;
		return _wallpaperCache;
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
	_wallpaperCache = wallpapers;
	return wallpapers;
}

export function openWallpaperPicker() {
	// No null-check on either lookup below (existing assumption: both
	// ids are always present in newTab.html) — cast, not a fix.
	let picker = /** @type {HTMLElement} */ (document.getElementById('wallpaper-picker'));
	picker.hidden = false;
	fetchFirefoxWallpapers().then(wallpapers => {
		renderWallpaperGrid(wallpapers);
		if (!isMozillaWallpaperCatalogAvailable()) {
			appendCollectionsNote();
		}
	}).catch(() => {
		let grid = /** @type {HTMLElement} */ (document.getElementById('wallpaper-grid'));
		grid.textContent = getString('wallpaper_error');
	});
}

/**
 * Chrome-only footer under the solid palette (maintainer decision
 * 2026-07-18, superseding the vendored-CC0-set follow-up): Chrome ships NO
 * photo wallpapers of its own — users who want one follow this link to a
 * curated free collection (Unsplash's editorial Wallpapers topic; Unsplash
 * License, free to use, no attribution required), download an image, and
 * add it via the existing Upload Image control. A plain user-initiated
 * link, so the "zero outbound network requests on Chrome" property of the
 * degraded picker still holds. Appended into #wallpaper-grid AFTER
 * renderWallpaperGrid (which clears the grid on every open, so reopening
 * never duplicates the note).
 * @returns {void}
 */
function appendCollectionsNote() {
	let grid = /** @type {HTMLElement} */ (document.getElementById('wallpaper-grid'));
	let note = el('p', 'wallpaper-collections-note', getString('wallpaper_collections_lead') + ' ');
	let link = document.createElement('a');
	link.href = 'https://unsplash.com/t/wallpapers';
	link.target = '_blank';
	link.rel = 'noopener';
	link.textContent = getString('wallpaper_collections_link');
	note.appendChild(link);
	grid.appendChild(note);
}

export function closeWallpaperPicker() {
	/** @type {HTMLElement} */ (document.getElementById('wallpaper-picker')).hidden = true;
}

/** @param {WallpaperRecord[]} wallpapers */
export function renderWallpaperGrid(wallpapers) {
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
				selectWallpaper(wp);
			});
			row.appendChild(thumb);
		}
		grid.appendChild(row);
	}
}

/** @param {WallpaperRecord | string} wallpaperOrUrl */
export function selectWallpaper(wallpaperOrUrl) {
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
			uiRefs.backgroundFake.style.backgroundPosition = position;
		if (solidColor) {
			document.body.style.backgroundColor = solidColor;
			document.body.style.backgroundImage =
				uiRefs.backgroundFake.style.backgroundImage = '';
		} else {
			document.body.style.backgroundColor = '';
			document.body.style.backgroundImage =
				uiRefs.backgroundFake.style.backgroundImage = 'url("' + url + '")';
		}
		uiRefs.removeBackgroundButton.disabled = false;

		// Update selected state in grid. Match on whichever identity the
		// clicked record has: image records carry dataset.url, solid-colour
		// swatches carry dataset.solidColor (a url-only match left solid
		// swatches permanently unmarked — latent since the picker gained
		// solid records, surfaced by Chrome's all-solid degraded picker,
		// CHROME.md D8 finding 2 slice).
		let thumbs = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.wallpaper-thumb'));
		for (let t of thumbs) {
			if ((url && t.dataset.url === url) || (solidColor && t.dataset.solidColor === solidColor)) {
				t.setAttribute('selected', '');
			} else {
				t.removeAttribute('selected');
			}
		}
	});
}

export function resetWallpaper() {
	Prefs.backgroundUrl = '';
	Prefs.backgroundPosition = 'center center';
	Prefs.backgroundColor = '';
	Background.setBackground().then(() => {
		refreshBackgroundImage();
		let thumbs = document.querySelectorAll('.wallpaper-thumb');
		for (let t of thumbs) {
			t.removeAttribute('selected');
		}
	});
}
