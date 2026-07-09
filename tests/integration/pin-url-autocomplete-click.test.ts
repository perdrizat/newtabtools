/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test for the Stage H1 case-trap fix (MODERNIZATION.md, audit
 * 2026-07-09-mv3-inventory.md §2.1): the pin-URL autocomplete dropdown's
 * window-level click handler in `newTab.js` walks up from `event.target` to
 * the containing `<li>` via `while (target.nodeName != 'li')`. Under XHTML
 * (the pre-Stage-H2 parser) `nodeName` was lowercase so this worked; under
 * the HTML parser (`newTab.html`, landed in Stage H2) `nodeName` is
 * uppercase (`'LI'`), so an unfixed loop would never match, walk past the
 * `<li>` to `document`, and throw on `null.parentNode`.
 *
 * jsdom (the fast-tier environment) already parses as HTML by default
 * (audit §3.2), so real DOM elements created here naturally have uppercase
 * `nodeName` — no simulation needed; this is what made the test genuinely
 * red against the unfixed source, and it now also matches the real
 * production parser post-H2.
 *
 * Extracts the actual click-handler function literally from `newTab.js` (not
 * a reimplementation) so the test tracks the real code path.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractClickHandler(source: string): string {
	const marker = 'window.addEventListener(\'click\', ';
	const markerIdx = source.indexOf(marker);
	if (markerIdx === -1) { throw new Error('pinURLAutocomplete click handler registration not found'); }
	const start = markerIdx + marker.length;
	const braceStart = source.indexOf('{', start);
	let depth = 0;
	let i = braceStart;
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('pin-URL autocomplete window click handler — nodeName case-safety (Stage H1)', () => {
	let handler: (event: any) => void;
	let ul: HTMLElement;
	let li: HTMLElement;
	let span: HTMLElement;
	let blockedLi: HTMLElement;
	let input: HTMLElement;
	let setPinURLInputValue: ReturnType<typeof vi.fn>;
	let autocomplete: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading the real click handler for a behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const extracted = extractClickHandler(source);
		const code = `var _pinURLClickHandler = ${extracted};`;
		vm.runInThisContext(code, { filename: 'pin-url-click-harness.js' });
		handler = (globalThis as any)._pinURLClickHandler;
	});

	beforeEach(() => {
		document.body.innerHTML = '';
		ul = document.createElement('ul');
		li = document.createElement('li');
		li.dataset.url = 'https://example.com/';
		span = document.createElement('span');
		li.appendChild(span);
		blockedLi = document.createElement('li');
		blockedLi.id = 'options-pinURL-blocked';
		ul.appendChild(li);
		ul.appendChild(blockedLi);
		document.body.appendChild(ul);
		(ul as any).hidden = false;

		input = document.createElement('input');
		document.body.appendChild(input);

		setPinURLInputValue = vi.fn();
		autocomplete = vi.fn();

		(globalThis as any).newTabTools = {
			pinURLInput: input,
			pinURLAutocomplete: ul,
			pinURLBlocked: blockedLi,
			autocomplete,
			setPinURLInputValue,
		};

		// Confirm the jsdom fixture actually reproduces the HTML-parser case
		// (uppercase nodeName), which is also what the real production page
		// (`newTab.html`, post-H2) hits — otherwise this test would pass for
		// the wrong reason.
		expect(li.nodeName).toBe('LI');
	});

	it('resolves a click on a nested span up to its containing <li> without throwing', () => {
		const event = { button: 0, target: span, stopPropagation: vi.fn() };
		expect(() => handler(event)).not.toThrow();
		expect(setPinURLInputValue).toHaveBeenCalledWith('https://example.com/');
	});

	it('resolves a click directly on the <li> itself (zero-iteration walk)', () => {
		const event = { button: 0, target: li, stopPropagation: vi.fn() };
		expect(() => handler(event)).not.toThrow();
		expect(setPinURLInputValue).toHaveBeenCalledWith('https://example.com/');
	});

	it('does not fill the input when the resolved <li> is the blocked placeholder', () => {
		const event = { button: 0, target: blockedLi, stopPropagation: vi.fn() };
		expect(() => handler(event)).not.toThrow();
		expect(setPinURLInputValue).not.toHaveBeenCalled();
	});
});
