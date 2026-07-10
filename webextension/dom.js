/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Page-side DOM-builder leaf (chrome-prep C2, CHROME_PREP.md).
 *
 * Dedups the near-identical
 * `let x = document.createElement(tag); x.className = c; x.textContent = t;`
 * boilerplate repeated across newTab.js/site.js/grid.js/awesomebar.js
 * (Stage-H review §8 backlog item; site.js/grid.js were part of one page
 * monolith at the time, later split up in chrome-prep C4). Pure
 * `document.createElement` wrapper — no event
 * wiring, no attribute loops, no children — so it only replaces the narrow
 * "create + optional className + optional textContent" shape; blocks that
 * set other attributes, branch on conditions, or build children stay as
 * hand-written `document.createElement` calls (force-fitting those would
 * obscure rather than clarify).
 */

/**
 * Create an element, optionally setting its class and text content.
 *
 * `className`/`text` are each independently optional: pass `undefined` (or
 * omit the argument) to leave the corresponding DOM property untouched at
 * its default. An explicit empty string (`''`) is a distinct, valid value
 * and IS assigned — callers that want a `class=""` attribute or empty text
 * node get one; only an omitted/`undefined` argument skips the assignment.
 *
 * @param {string} tag - Tag name, e.g. `'div'`.
 * @param {string} [className] - Value for `element.className`. Omit/`undefined` to skip.
 * @param {string} [text] - Value for `element.textContent`. Omit/`undefined` to skip.
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
	let element = document.createElement(tag);
	if (className !== undefined) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}
