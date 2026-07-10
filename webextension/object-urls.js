/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): extracted verbatim from newTab.js's
// `_objectURLs`/`_freshObjectURL`/`_dropObjectURL` — object-URL hygiene
// (audit 2026-06-10 §4.3): blob URLs are only freed on document unload, so
// repeated-render sites revoke their prior URL before creating a
// replacement (site.js's refreshThumbnail pattern). Genuinely shared
// plumbing between wallpaper.js and newTab.js's own tile-editing code
// (setThumbnail/removeThumbnail/the selectedSiteIndex setter) — made
// explicit module state instead of hidden `this` state, a leaf with no
// imports of its own. Each key names one owner surface (e.g. 'background',
// 'editorThumb') — never stash a URL another surface still displays.
//
// Kept as the same plain `Record<string, string>` the original code used.
// The arc's own design note (CHROME_PREP.md's C4d entry) calls this "the
// _objectURLs Map" in prose — read as descriptive (a key->value store),
// not a mandate to rewrite it onto a real ES `Map`: doing so would turn
// `_freshObjectURL`/`_dropObjectURL`'s bodies into a rewrite (`.get`/`.set`/
// `.delete` calls) that this slice's purity regime doesn't sanction — only
// `this.X` -> module-state/module-function rewrites are. Reported here,
// not silently "fixed".

/** @type {Record<string, string>} */
const _objectURLs = {};

/**
 * @param {string} key
 * @param {Blob} blob
 * @returns {string}
 */
export function _freshObjectURL(key, blob) {
	_dropObjectURL(key);
	let url = URL.createObjectURL(blob);
	_objectURLs[key] = url;
	return url;
}

/** @param {string} key */
export function _dropObjectURL(key) {
	if (_objectURLs[key]) {
		URL.revokeObjectURL(_objectURLs[key]);
		delete _objectURLs[key];
	}
}
