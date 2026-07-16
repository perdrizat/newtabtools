/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): `fillFilterUI`/`fillNeverCaptureUI`
// extracted verbatim from newTab.js. `uiRefs.optionsFilter`/`uiRefs.
// optionsFilterHostAutocomplete`/`uiRefs.optionsNeverCaptureList` replace
// the former `this.optionsFilter`/`this.optionsFilterHostAutocomplete`/
// `this.optionsNeverCaptureList` reads (ui-refs.js) — the first and third
// are also read by newTab.js's own residual code (optionsOnClick/updateUI),
// which now reads the same `uiRefs` object instead of a second, duplicate
// ref. `getString` is imported directly from common.js instead of via
// `newTabTools`/`this`; `topSitesOptions` (chrome-prep C5b) replaces this
// file's own former `compareVersions`-based `topSites.get()` options branch,
// shared with lib/tiles-store.js's identical (formerly duplicated) logic.
// `Grid.sites` is read call-time only
// (inside fillFilterUI), extending the existing newTab.js<->grid.js<->
// site.js cycle (grid.js imports newTab.js) with one more call-time-only
// edge — this
// file itself never imports newTab.js and never calls updateUI.
import { Grid } from './grid.js';
import { Filters, NeverCapture } from './prefs.js';
import { getString, topSitesOptions } from './common.js';
import { el } from './dom.js';
import { uiRefs } from './ui-refs.js';
import { api } from './api.js';

/**
 * `Site`, the site.js constructor-function this file reads via
 * `Grid.sites[...]` — a type-only import (erased at compile time, so
 * reading it here is NOT a top-level read of the site.js cycle binding;
 * Decision 3 only restricts VALUE reads).
 * @typedef {import('./site.js').Site} Site
 */

/** @param {string} [highlightHost] */
export async function fillFilterUI(highlightHost) {
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
	let table = /** @type {HTMLTableElement} */ (uiRefs.optionsFilter.querySelector('table'));
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
		/** @type {HTMLElement} */ (row.cells[2].querySelector('span')).textContent = k in filters ? filters[k] : getString('filter_unlimited');
		// An explicit remove (✕) on real filter rows only — appended into the
		// limit cell so it doesn't add a column that would overflow the drawer.
		// Pinned-only rows (a pinned tile with no limit) have no filter to
		// remove; those are managed by unpinning on the board.
		if (k in filters) {
			/** @type {HTMLButtonElement} */ (row.querySelector('.minus-button')).disabled = false;
			let removeBtn = el('button', 'ntt-filter-remove', '✕');
			removeBtn.title = getString('filter_remove');
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

	if (uiRefs.optionsFilterHostAutocomplete.childElementCount === 0) {
		let options = await topSitesOptions(api);
		/** @param {browser.topSites.MostVisitedURL[]} sites */
		let handleSites = sites => {
			for (let s of sites.reduce((carry, site) => {
				let {protocol, host} = new URL(site.url);
				if (host && ['http:', 'https:', 'ftp:'].includes(protocol) && !carry.includes(host)) {
					carry.push(host);
				}
				return carry;
			}, /** @type {string[]} */ ([])).sort()) {
				let option = el('option', undefined, s);
				uiRefs.optionsFilterHostAutocomplete.appendChild(option);
			}
		};
		// Chrome rejects ANY 2-argument api.topSites.get() call — even
		// get(undefined, callback) — with "No matching signature", thrown
		// synchronously (verified empirically, CHROME.md D3); only the
		// 1-argument callback form works there. `topSitesOptions(api)`
		// resolving `undefined` IS the Chrome-path signal (see its own doc
		// comment in common.js) — branch on that instead of the 2-arg Firefox
		// call topSitesOptions's caller has always made.
		if (options === undefined) {
			api.topSites.get(handleSites);
		} else {
			api.topSites.get(options, handleSites);
		}
	}
}

export function fillNeverCaptureUI() {
	// Render the never-capture host list — mirrors fillFilterUI's style but
	// uses a flat div list instead of a table (no pinned-count column needed).
	let container = uiRefs.optionsNeverCaptureList;
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
		removeBtn.title = getString('nevercapture_remove');
		removeBtn.dataset.entry = entry;
		row.appendChild(text);
		row.appendChild(removeBtn);
		container.appendChild(row);
	}
}
