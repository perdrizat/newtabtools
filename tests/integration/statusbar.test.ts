/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: statusbar — _updateStatusBar + titleBarStatus pref
 * (Phase 2-2).
 *
 * Extracts `_updateStatusBar` and the `titleBarStatus` branch of `updateUI`
 * from newTab.js via `vm.runInThisContext`. Exercises tile counting against
 * a fake Grid.sites array and verifies the right-aligned summary text.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

describe('Statusbar — _updateStatusBar', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const _updateStatusBar = extractMethod(source, '_updateStatusBar');

		const code = `var _statusbarHarness = { ${_updateStatusBar} };`;
		vm.runInThisContext(code, { filename: 'statusbar-harness.js' });
		harness = (globalThis as any)._statusbarHarness;
	});

	beforeEach(() => {
		document.body.innerHTML = `
			<div id="ntt-statusbar">
				<div id="ntt-statusbar-hints"></div>
				<div id="ntt-statusbar-summary">
					<span id="ntt-statusbar-tilecount"></span>
				</div>
			</div>
		`;
		(globalThis as any).Prefs = { rows: 3, columns: 3 };
	});

	afterEach(() => {
		document.body.innerHTML = '';
		delete (globalThis as any).Grid;
		delete (globalThis as any).Prefs;
	});

	it('writes "N tiles · RxC" with non-null site count', () => {
		(globalThis as any).Grid = { sites: [
			{ url: 'a' }, { url: 'b' }, null, { url: 'c' }, null, null, null, null, null,
		] };
		harness._updateStatusBar();
		const text = document.getElementById('ntt-statusbar-tilecount')!.textContent || '';
		expect(text).toContain('3 tiles');
		expect(text).toContain('3×3');
	});

	it('counts zero tiles when sites array is empty', () => {
		(globalThis as any).Grid = { sites: [null, null, null, null] };
		(globalThis as any).Prefs = { rows: 2, columns: 2 };
		harness._updateStatusBar();
		const text = document.getElementById('ntt-statusbar-tilecount')!.textContent || '';
		expect(text).toContain('0 tiles');
		expect(text).toContain('2×2');
	});

	it('reflects current grid dimensions', () => {
		(globalThis as any).Grid = { sites: [{ url: 'a' }] };
		(globalThis as any).Prefs = { rows: 4, columns: 6 };
		harness._updateStatusBar();
		const text = document.getElementById('ntt-statusbar-tilecount')!.textContent || '';
		expect(text).toContain('4×6');
	});

	it('does not throw when Grid is undefined', () => {
		(globalThis as any).Grid = undefined;
		expect(() => harness._updateStatusBar()).not.toThrow();
	});
});

describe('Statusbar — titleBarStatus pref', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateUI = extractMethod(source, 'updateUI');

		(globalThis as any).Prefs = {
			theme: 'light', locked: false,
			rows: 3, columns: 3, opacity: 80,
			margin: ['small', 'small', 'small', 'small'],
			spacing: 'small', titleSize: 'small', tileAspect: 'fill',
			history: true, recent: true,
			titleBarWordmark: true, titleBarSearch: false,
			titleBarClock: true, titleBarStatus: true,
		};
		(globalThis as any).browser = {
			theme: {
				getCurrent: vi.fn().mockResolvedValue({ colors: {} }),
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			extension: { getURL: vi.fn((p: string) => `moz-extension://fake/${p}`) },
		};

		const code = `var newTabTools = { ${updateUI}, updateThemeColours() {}, resizeOptionsThumbnail() {}, refreshRecent() {}, applyTileAspect() {}, _updateThemeToggleIcon() {}, _updateStatusBar() {}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} } };`;
		vm.runInThisContext(code, { filename: 'statusbar-pref-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		document.body.innerHTML = `
			<div id="ntt-statusbar"></div>
		`;
		(globalThis as any).Prefs.titleBarStatus = true;
		document.documentElement.hasAttribute = vi.fn(() => true);
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('hides statusbar when titleBarStatus is false', () => {
		(globalThis as any).Prefs.titleBarStatus = false;
		harness.updateUI(['titleBarStatus']);
		expect(document.getElementById('ntt-statusbar')!.hidden).toBe(true);
	});

	it('shows statusbar when titleBarStatus is true', () => {
		(globalThis as any).Prefs.titleBarStatus = true;
		// Start hidden to verify show path
		document.getElementById('ntt-statusbar')!.hidden = true;
		harness.updateUI(['titleBarStatus']);
		expect(document.getElementById('ntt-statusbar')!.hidden).toBe(false);
	});
});

describe('Statusbar — gapMap defaults (Phase 2-2 §2.2)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateUI = extractMethod(source, 'updateUI');

		(globalThis as any).Prefs = {
			theme: 'light', locked: false,
			rows: 3, columns: 3, opacity: 80,
			margin: ['small', 'small', 'small', 'small'],
			spacing: 'small', titleSize: 'small', tileAspect: 'fill',
			history: true, recent: true,
		};
		(globalThis as any).browser = {
			theme: {
				getCurrent: vi.fn().mockResolvedValue({ colors: {} }),
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			extension: { getURL: vi.fn((p: string) => `moz-extension://fake/${p}`) },
		};

		const code = `var newTabTools = { ${updateUI}, updateThemeColours() {}, resizeOptionsThumbnail() {}, refreshRecent() {}, applyTileAspect() {}, _updateThemeToggleIcon() {}, _updateStatusBar() {}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} } };`;
		vm.runInThisContext(code, { filename: 'statusbar-gapmap-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		document.querySelector = vi.fn(() => ({ value: '', style: {}, classList: { remove: vi.fn(), add: vi.fn() } })) as any;
		document.querySelectorAll = vi.fn(() => []) as any;
		document.getElementById = vi.fn(() => ({ disabled: false, hidden: false })) as any;
		document.documentElement.setAttribute = vi.fn();
		document.documentElement.removeAttribute = vi.fn();
		document.documentElement.style.setProperty = vi.fn();
		document.documentElement.style.getPropertyValue = vi.fn(() => '');
		document.documentElement.hasAttribute = vi.fn(() => true);
	});

	it('spacing=medium sets --ntt-gap to 18px (matches token default)', () => {
		(globalThis as any).Prefs.spacing = 'medium';
		harness.updateUI(['spacing']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--ntt-gap', '18px');
	});

	it('spacing=small sets --ntt-gap to 10px', () => {
		(globalThis as any).Prefs.spacing = 'small';
		harness.updateUI(['spacing']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--ntt-gap', '10px');
	});

	it('spacing=large sets --ntt-gap to 28px', () => {
		(globalThis as any).Prefs.spacing = 'large';
		harness.updateUI(['spacing']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--ntt-gap', '28px');
	});
});
