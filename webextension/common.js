/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Dual-scope bridge file (PAGE_MODULES.md Decision 2/6 — permanent, revised
 * 2026-07-10): `compareVersions` is a real `export` now, consumed by real
 * `import`s from `lib/tiles-store.js` (the background read path). The
 * `globalThis.compareVersions = …` assignment below SURVIVES this slice —
 * newTab.js/fx-newTab.js/awesomebar.js still read it as a bare identifier
 * (they stay vm-loaded classic scripts until P4/P5), and E2E/UAT
 * page-context evaluation reads it off `globalThis` too (TEST-ONLY
 * thereafter, once the last production consumer migrates).
 * @param {string|number} a
 * @param {string|number} b
 * @returns {number}
 */
export function compareVersions(a, b) {
	/**
	 * @param {string|number} name
	 * @returns {Array<string|number>}
	 */
	function splitApart(name) {
		var parts = [];
		var lastIsDigit = false;
		var part = '';
		for (let c of name.toString()) {
			let currentIsDigit = c >= '0' && c <= '9';
			if (c == '.' || lastIsDigit != currentIsDigit) {
				if (part) {
					parts.push(lastIsDigit ? parseInt(part, 10) : part);
				}
				part = c == '.' ? '' : c;
			} else {
				part += c;
			}
			lastIsDigit = currentIsDigit;
		}
		if (part) {
			parts.push(lastIsDigit ? parseInt(part, 10) : part);
		}
		return parts;
	}
	/**
	 * @param {string|number|undefined} x
	 * @param {string|number|undefined} y
	 * @returns {number}
	 */
	function compareParts(x, y) {
		let xType = typeof x;
		let yType = typeof y;

		switch (xType) {
		case yType:
			if (x == y) {
				return 0;
			}
			// xType === yType here (the switch matched), and the 'undefined'
			// case is already handled above by the `x == y` check (undefined ==
			// undefined) — so both are actually comparable string|number values;
			// TS can't follow that from the switch alone.
			return (/** @type {string|number} */ (x)) < (/** @type {string|number} */ (y)) ? -1 : 1;
		case 'string':
			return -1;
		case 'undefined':
			if (yType == 'number') {
				return y === 0 ? 0 : -1;
			}
			return 1;
		case 'number':
			return x === 0 && yType == 'undefined' ? 0 : 1;
		}
		return 0;
	}
	let aParts = splitApart(a);
	let bParts = splitApart(b);
	for (let i = 0; i <= aParts.length || i <= bParts.length; i++) {
		let comparison = compareParts(aParts[i], bParts[i]);
		if (comparison !== 0) {
			return comparison;
		}
	}
	return 0;
}

// Cast through `any`: see prefs.js's matching bridge-assignment comment for
// why (checked-JS's ambient-global-from-assignment inference otherwise
// overrides tests/integration/globals.d.ts's deliberately loose `any`).
globalThis.compareVersions = /** @type {any} */ (compareVersions);

/**
 * Look up a localized string from `_locales/<lang>/messages.json`, with
 * optional positional `$1`/`$2`/… substitutions. Extracted from newTab.js's
 * `newTabTools` object (P2-P5 review finding 1, revised remediation,
 * 2026-07-10): it is a generic i18n leaf, not something that belongs to "the
 * page controller" — moving it here lets awesomebar.js (and any future page
 * consumer) `import` it directly instead of reaching into the monolith or a
 * `globalThis` bridge. `newTabTools.getString` is now a one-line delegate to
 * this function. Note: `lib/platform.js` has its own, separate i18n wrappers
 * for the background scope (the Chrome-fork seam) — this is the page-side
 * utility; the slight overlap is deliberate, not duplication to dedupe.
 * @param {string} name Message key.
 * @param {...(string|undefined)} substitutions Positional substitution
 *   values ($1, $2, …). `undefined` is tolerated (a caller building a
 *   substitution from an optional field, e.g. awesomebar.js's search-prompt
 *   query) — `chrome.i18n.getMessage` treats it the same as omitting it.
 * @returns {string}
 */
export function getString(name, ...substitutions) {
	return chrome.i18n.getMessage(name, substitutions);
}

/**
 * Whether `url` parses and uses an allow-listed protocol (`ftp:`/`http:`/
 * `https:`). Extracted from newTab.js's `newTabTools` object alongside
 * `getString` (P2-P5 review finding 1, revised remediation, 2026-07-10) — a
 * protocol-allowlist guard with no dependency on the page controller.
 * `newTabTools.isValidURL` is now a one-line delegate to this function.
 * Tolerant of non-string/unparseable input (returns `false` rather than
 * throwing), which is why callers may pass a nullable `url`.
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isValidURL(url) {
	try {
		return ['ftp:', 'http:', 'https:'].includes(new URL(/** @type {string} */ (url)).protocol);
	} catch (ex) {
		return false;
	}
}
