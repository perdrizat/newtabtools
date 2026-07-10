/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): the shared UI-element refs the extracted
// leaf modules (wallpaper.js/titlebar.js/filters-ui.js — theme.js and
// autosave-indicator.js need none) read call-time only. The
// NewTabToolsPageRefs pattern (newTab.js's own doc comment) generalized to a
// standalone module: a typed refs object populated once by newTab.js's boot
// IIFE, from the same id -> field table shape that IIFE already builds for
// its own (residual-only) `uiElements` loop.
//
// Deliberately narrow (C3c precedent, same restraint as
// NewTabToolsPageRefs): only the six ids an extracted leaf actually reads
// live here — every other uiElements ref stays declared directly on
// newTab.js's own NewTabToolsObject literal and populated by its own
// `uiElements` loop. newTab.js's own doc comment records the choice: this
// file exists ALONGSIDE `uiElements`, not instead of it (the smaller honest
// diff — see CHROME_PREP.md's C4d completion note for the full rationale).
//
// `optionsFilter`/`optionsNeverCaptureList` are read by BOTH a leaf
// (filters-ui.js) and residual code (newTab.js's optionsOnClick/updateUI) —
// those two residual call sites now read this same object instead of
// keeping a second, duplicate `this.X` ref for the same DOM node.

/**
 * @typedef {Object} UiRefs
 * @property {HTMLElement} backgroundFake
 * @property {HTMLButtonElement} removeBackgroundButton
 * @property {HTMLElement} recentList
 * @property {HTMLElement} optionsFilter
 * @property {HTMLElement} optionsFilterHostAutocomplete
 * @property {HTMLElement} optionsNeverCaptureList
 */

/** @type {UiRefs} */
export const uiRefs = /** @type {any} */ ({
	backgroundFake: null,
	removeBackgroundButton: null,
	recentList: null,
	optionsFilter: null,
	optionsFilterHostAutocomplete: null,
	optionsNeverCaptureList: null,
});

/**
 * Populates every `uiRefs` field from newTab.html's ids. Called once by
 * newTab.js's boot IIFE, from a `{fieldName: elementId}` table entry set —
 * the same shape as (and, for these six keys, previously part of) that
 * IIFE's own `uiElements` table.
 * @param {Record<string, string>} table fieldName -> element id
 */
export function populateUiRefs(table) {
	for (let key in table) {
		let value = table[key];
		/** @type {Record<string, HTMLElement | null>} */ (/** @type {unknown} */ (uiRefs))[key] = document.getElementById(value);
	}
}
