/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit test: `el()` — the page-side DOM-builder leaf (webextension/dom.js).
 *
 * Chrome-prep C2 (CHROME_PREP.md): extracted to dedup the ~26 near-identical
 * `document.createElement(tag); el.className = c; el.textContent = t;`
 * blocks scattered across newTab.js/fx-newTab.js/awesomebar.js. Covers the
 * optional-vs-empty-string distinction the JSDoc calls out: an omitted
 * `className`/`text` argument must NOT touch the property (so it keeps
 * whatever the DOM default is), but an explicit `''` is a valid value that
 * MUST still be assigned.
 */

import { describe, it, expect } from 'vitest';
import { el } from '../../webextension/dom.js';

describe('el() — webextension/dom.js', () => {
	it('creates an element of the requested tag', () => {
		const node = el('div');
		expect(node).toBeInstanceOf(HTMLElement);
		expect(node.tagName.toLowerCase()).toBe('div');
	});

	it('leaves className untouched when omitted', () => {
		const node = el('span');
		expect(node.className).toBe('');
	});

	it('leaves textContent untouched when omitted', () => {
		const node = el('span');
		expect(node.textContent).toBe('');
	});

	it('sets className when provided', () => {
		const node = el('div', 'ntt-widget');
		expect(node.className).toBe('ntt-widget');
	});

	it('sets textContent when provided', () => {
		const node = el('span', undefined, 'hello');
		expect(node.textContent).toBe('hello');
	});

	it('sets both className and textContent when provided', () => {
		const node = el('h3', 'heading', 'Title');
		expect(node.className).toBe('heading');
		expect(node.textContent).toBe('Title');
	});

	it('assigns an explicit empty-string className (distinct from omitted)', () => {
		const node = el('div', '');
		expect(node.className).toBe('');
		expect(node.hasAttribute('class')).toBe(true);
	});

	it('assigns an explicit empty-string textContent (distinct from omitted)', () => {
		const node = el('span', undefined, '');
		expect(node.textContent).toBe('');
	});

	it('returns a plain HTMLElement usable with appendChild/querySelector', () => {
		const parent = el('div', 'parent');
		const child = el('span', 'child', 'x');
		parent.appendChild(child);
		expect(parent.querySelector('.child')?.textContent).toBe('x');
	});
});
