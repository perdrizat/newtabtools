/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

import { api } from './api.js';

/**
 * Dual-scope bridge file (PAGE_MODULES.md Decision 2/6): `compareVersions` is
 * a real `export`, consumed by real `import`s from `lib/tiles-store.js` (the
 * background read path) and `newTab.js` (the page read path). The
 * `globalThis.compareVersions = …` bridge assignment that survived through
 * PAGE_MODULES.md is retired as of chrome-prep C3d: every production and
 * test consumer now reaches this via a real `import`, so the bridge is gone
 * — see `tests/integration/module-scope.test.ts`'s negative assertion.
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

/**
 * `topSites.get()`'s options shape, shared by `lib/tiles-store.js` (the
 * background read path) and `filters-ui.js` (the page read path) — chrome-prep
 * C5b (CHROME_PREP.md, `audit/2026-07-11-chrome-api-divergence.md` #6). Both
 * call sites used to duplicate this same version-gated branch (one `await`-
 * style, one callback-style — namespace-normalized in C5a but not aligned,
 * per that slice's own note). `runtime.getBrowserInfo` is Firefox-only — a
 * verbatim port would throw on Chrome — so this short-circuits whenever it's
 * absent (Chrome-dormant path) rather than calling it. When it IS present
 * (Firefox, both callers' actual runtime), this keeps the exact pre-existing
 * version-gated branch: the caller's own `api` is passed in rather than
 * imported here, since the two scopes have separate namespace leaves
 * (background's `lib/platform.js`, page's `api.js`) that this dual-scope
 * file cannot import without picking one.
 *
 * CHROME.md D3 slice 3 finding (2026-07-16, real Chrome): the Chrome-absent
 * branch used to return the "modern" Firefox options object
 * (`{limit, onePerDomain, includeBlocked}`) on the (wrong) assumption that
 * Chrome just needed the same shape post-Fx63 Firefox does. It doesn't —
 * `chrome.topSites.get()` NEVER accepts an options argument, not even `{}`;
 * passing one throws `TypeError: Error in invocation of topSites.get
 * (optional function callback): No matching signature.` synchronously. That
 * silently poisoned `lib/tiles-store.js`'s `Tiles._ready`/`_cache` forever
 * (the throw lands inside `getGridTiles()`'s unawaited `IDBRequest.onsuccess
 * = async () => {...}` handler, so it never resolves OR rejects the outer
 * promise — `_ready` was already set `true` moments earlier, so every LATER
 * `ensureReady()` call takes its already-ready fast path and returns the
 * `_cache` frozen at its initial empty value) — which in turn meant no
 * capture session ever started for ANY pinned tile on Chrome. Returning
 * `undefined` here makes the call site's `api.topSites.get(options)` an
 * effectively no-arg call, which Chrome does accept. `filters-ui.js`'s
 * CALLBACK-style call site (`api.topSites.get(options, callback)`) is a
 * separate, still-open Chrome gap this fix does not reach: Chrome's binding
 * rejects that call for having 2 arguments at all, regardless of what the
 * first one is (confirmed empirically: `topSites.get(undefined, callback)`
 * throws the same "No matching signature" error) — fixing it needs an
 * argument-count-aware branch at that call site itself, not just this
 * shared options helper. Out of this arc's scope (D3 is the capture
 * pipeline, not the Filters drawer UI) — flagged here for whichever slice
 * takes on filters-ui.js's Chrome path.
 * @param {any} api The caller's own namespace leaf (`lib/platform.js`'s or
 *   `api.js`'s `api` export).
 * @returns {Promise<{limit: number, onePerDomain: boolean, includeBlocked: boolean}|{providers: string[]}|undefined>}
 */
export async function topSitesOptions(api) {
	if (!('getBrowserInfo' in api.runtime)) {
		return undefined;
	}
	let {version} = await api.runtime.getBrowserInfo();
	if (compareVersions(version, '63.0a1') >= 0) {
		return { limit: 100, onePerDomain: false, includeBlocked: true };
	}
	return { providers: ['places'] };
}

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
	return api.i18n.getMessage(name, substitutions);
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
