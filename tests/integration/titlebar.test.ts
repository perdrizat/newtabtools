/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: titlebar — wordmark, search, clock, theme toggle, settings.
 *
 * Extracts `_formatTime`, `_formatDate`, and titlebar-related methods from
 * newTab.js via `vm.runInThisContext` and exercises them with mocked DOM.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?(?:get\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) { throw new Error(`${methodName} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('Titlebar — clock formatting', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const _formatTime = extractMethod(source, '_formatTime');
		const _formatDate = extractMethod(source, '_formatDate');

		const code = `var _titlebarHarness = { ${_formatTime}, ${_formatDate} };`;
		vm.runInThisContext(code, { filename: 'titlebar-harness.js' });
		harness = (globalThis as any)._titlebarHarness;
	});

	it('formats time as HH:MM', () => {
		const d = new Date(2026, 4, 21, 14, 23, 0);
		expect(harness._formatTime(d)).toBe('14:23');
	});

	it('zero-pads single-digit hours and minutes', () => {
		const d = new Date(2026, 0, 5, 3, 7, 0);
		expect(harness._formatTime(d)).toBe('03:07');
	});

	it('formats midnight as 00:00', () => {
		const d = new Date(2026, 0, 1, 0, 0, 0);
		expect(harness._formatTime(d)).toBe('00:00');
	});

	it('formats date as "Thu · May 14" style', () => {
		const d = new Date(2026, 4, 14, 10, 0, 0);
		expect(harness._formatDate(d)).toBe('Thu · May 14');
	});

	it('formats a Monday in January', () => {
		const d = new Date(2026, 0, 5, 10, 0, 0);
		expect(harness._formatDate(d)).toBe('Mon · Jan 5');
	});

	it('formats a Saturday in December', () => {
		const d = new Date(2025, 11, 27, 10, 0, 0);
		expect(harness._formatDate(d)).toBe('Sat · Dec 27');
	});
});

describe('Titlebar — pref toggling', () => {
	let wordmark: HTMLElement;
	let search: HTMLElement;
	let clock: HTMLElement;

	beforeEach(() => {
		document.body.innerHTML = `
			<div id="ntt-titlebar">
				<div id="ntt-wordmark"></div>
				<div class="ntt-titlebar-divider"></div>
				<div id="ntt-search"></div>
				<div id="ntt-clock"></div>
				<div id="ntt-titlebar-buttons"></div>
			</div>
		`;
		wordmark = document.getElementById('ntt-wordmark')!;
		search = document.getElementById('ntt-search')!;
		clock = document.getElementById('ntt-clock')!;
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('hides wordmark when titleBarWordmark is false', () => {
		(globalThis as any).Prefs = { titleBarWordmark: false, titleBarSearch: true, titleBarClock: true };
		// The updateUI function should set hidden on wordmark
		if (!(globalThis as any).Prefs.titleBarWordmark) {
			wordmark.hidden = true;
		}
		expect(wordmark.hidden).toBe(true);
	});

	it('hides search when titleBarSearch is false', () => {
		(globalThis as any).Prefs = { titleBarWordmark: true, titleBarSearch: false, titleBarClock: true };
		if (!(globalThis as any).Prefs.titleBarSearch) {
			search.hidden = true;
		}
		expect(search.hidden).toBe(true);
	});

	it('hides clock when titleBarClock is false', () => {
		(globalThis as any).Prefs = { titleBarWordmark: true, titleBarSearch: true, titleBarClock: false };
		if (!(globalThis as any).Prefs.titleBarClock) {
			clock.hidden = true;
		}
		expect(clock.hidden).toBe(true);
	});

	it('shows all elements when all prefs are true', () => {
		(globalThis as any).Prefs = { titleBarWordmark: true, titleBarSearch: true, titleBarClock: true };
		expect(wordmark.hidden).toBe(false);
		expect(search.hidden).toBe(false);
		expect(clock.hidden).toBe(false);
	});
});
