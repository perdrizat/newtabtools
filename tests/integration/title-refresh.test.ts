/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression tests for title-refresh behaviour. Two distinct rules:
 *
 *   1. `Set Title` in the per-tile editor marks `link.titleIsUserSet = true`
 *      so subsequent screenshot refreshes don't overwrite the user's title.
 *   2. `Set URL` clears the existing title (since it belonged to the old
 *      URL) and consults `historyTitleFor` to populate a fresh one.
 *
 * (The per-tile refresh button was removed in slice 3 of the tile redesign.
 * Its on-demand "pull a fresh title from history" side effect went with it —
 * there is no general replacement; titles now refresh only on Set-URL (rule 2
 * above) and on first-pin of a title-less tile via Tiles.getAllTiles. This was
 * an accepted consequence of removing the button.)
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { isValidURL } from '../../webextension/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
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

describe('historyTitleFor — resilient against missing history permission', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'historyTitleFor');
		// chrome-prep C5a (CHROME_PREP.md): `historyTitleFor` now reads the
		// module-level `api` namespace leaf instead of a bare `chrome.*`
		// reference — declared here as a live-resolving stand-in (mirrors
		// webextension/api.js's own Proxy) so each test's `globalThis.chrome`
		// override below still takes effect at call time.
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var _historyHarness = { ${body} };`;
		vm.runInThisContext(code, { filename: 'history-title-harness.js' });
		harness = (globalThis as any)._historyHarness;
	});

	it('resolves to the matching entry\'s title when chrome.history returns a hit', async () => {
		(globalThis as any).chrome = {
			history: {
				search: vi.fn((_q: any, cb: any) => cb([
					{ url: 'https://example.com/', title: 'Example Domain' },
				])),
			},
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		const title = await harness.historyTitleFor('https://example.com/');
		expect(title).toBe('Example Domain');
	});

	it('resolves to null when the URL is not in history', async () => {
		(globalThis as any).chrome = {
			history: { search: vi.fn((_q: any, cb: any) => cb([])) },
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		expect(await harness.historyTitleFor('https://example.com/')).toBeNull();
	});

	it('resolves to null when chrome.history.search throws (no permission)', async () => {
		(globalThis as any).chrome = {
			history: { search: () => { throw new Error('no permission'); } },
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		expect(await harness.historyTitleFor('https://example.com/')).toBeNull();
	});
});

describe('Set Title (options-title-set) marks titleIsUserSet', () => {
	let harness: any;
	let selectedSite: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'optionsOnClick');
		const normalize = extractMethod(source, 'normalizePinURL');
		// `isValidURL` (newTab.js) is now a one-line delegate to common.js's
		// real `isValidURL` export (P2-P5 review finding 1, revised
		// remediation, 2026-07-10) — vm.runInThisContext shares this file's
		// real globalThis, so the delegate's bare-identifier call resolves as
		// long as the real function is exposed there first (below).
		const isValid = extractMethod(source, 'isValidURL');
		const historyTitleFor = extractMethod(source, 'historyTitleFor');

		(globalThis as any).Tiles = { putTile: vi.fn().mockResolvedValue(1), getTile: vi.fn() };
		(globalThis as any).Prefs = { rows: 3, columns: 3 };
		(globalThis as any).Filters = { setFilter: vi.fn() };
		(globalThis as any).Updater = { updateGrid: vi.fn() };
		(globalThis as any).Background = { setBackground: vi.fn().mockResolvedValue(undefined) };
		(globalThis as any).Grid = { cells: [{ index: 0, containsPinnedSite: () => false }] };
		(globalThis as any).chrome = { history: { search: (_q: any, cb: any) => cb([]) } };
		(globalThis as any).browser = (globalThis as any).chrome;
		(globalThis as any).isValidURL = isValidURL;

		// chrome-prep C5a (CHROME_PREP.md): `optionsOnClick`/`historyTitleFor`'s
		// extracted bodies now read the module-level `api` namespace leaf
		// instead of a bare `chrome.*` reference — declared here as a
		// live-resolving stand-in (mirrors webextension/api.js's own Proxy).
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var newTabTools = { ${body}, ${normalize}, ${isValid}, ${historyTitleFor}, fillFilterUI() {}, refreshBackgroundImage() { return Promise.resolve(); }, setPinURLInputValue() {} };`;
		vm.runInThisContext(code, { filename: 'title-set-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		selectedSite = {
			link: { url: 'https://example.com', title: 'Old Title' },
			addTitle: vi.fn(),
		};
		harness.selectedSite = selectedSite;
		harness.setTitleInput = { value: 'New Custom Title' };
	});

	it('writes the title AND sets `titleIsUserSet = true`', () => {
		harness.optionsOnClick({ target: { id: 'options-title-set', disabled: false, classList: { contains: () => false } } });
		expect(selectedSite.link.title).toBe('New Custom Title');
		expect(selectedSite.link.titleIsUserSet).toBe(true);
	});
});

describe('Set URL clears title, calls historyTitleFor, applies fresh title', () => {
	let harness: any;
	let selectedSite: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'optionsOnClick');
		const normalize = extractMethod(source, 'normalizePinURL');
		// `isValidURL` (newTab.js) is now a one-line delegate to common.js's
		// real `isValidURL` export (P2-P5 review finding 1, revised
		// remediation, 2026-07-10) — vm.runInThisContext shares this file's
		// real globalThis, so the delegate's bare-identifier call resolves as
		// long as the real function is exposed there first (below).
		const isValid = extractMethod(source, 'isValidURL');
		const historyTitleFor = extractMethod(source, 'historyTitleFor');

		(globalThis as any).Tiles = { putTile: vi.fn().mockResolvedValue(1), getTile: vi.fn() };
		(globalThis as any).Prefs = { rows: 3, columns: 3 };
		(globalThis as any).isValidURL = isValidURL;

		// chrome-prep C5a (CHROME_PREP.md): `optionsOnClick`/`historyTitleFor`'s
		// extracted bodies now read the module-level `api` namespace leaf
		// instead of a bare `chrome.*` reference — declared here as a
		// live-resolving stand-in (mirrors webextension/api.js's own Proxy) so
		// each test's `globalThis.chrome` override below still takes effect at
		// call time.
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var newTabTools = { ${body}, ${normalize}, ${isValid}, ${historyTitleFor}, fillFilterUI() {}, refreshBackgroundImage() { return Promise.resolve(); }, setPinURLInputValue() {} };`;
		vm.runInThisContext(code, { filename: 'url-set-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		selectedSite = {
			link: { url: 'https://old.example/', title: 'Old Title', titleIsUserSet: true },
			addTitle: vi.fn(),
		};
		harness.selectedSite = selectedSite;
		harness.siteURLInput = { value: 'new.example/' };
		harness.setTitleInput = { value: '' };
		harness.siteURL = { textContent: '' };
	});

	it('normalises the URL, clears the old title, resets titleIsUserSet, then resolves via history', async () => {
		(globalThis as any).chrome = {
			history: { search: vi.fn((_q: any, cb: any) => cb([
				{ url: 'https://new.example/', title: 'Fresh History Title' },
			])) },
		};
		(globalThis as any).browser = (globalThis as any).chrome;

		harness.optionsOnClick({ target: { id: 'options-url-set', disabled: false, classList: { contains: () => false } } });
		// Flush the historyTitleFor microtask + cb chain.
		await new Promise(r => setTimeout(r, 0));

		expect(selectedSite.link.url).toBe('https://new.example/');
		expect(selectedSite.link.titleIsUserSet).toBe(false);
		expect(selectedSite.link.title).toBe('Fresh History Title');
		expect(harness.setTitleInput.value).toBe('Fresh History Title');
	});

	it('with no history match, the title stays empty (cleared) — user can Set Title next', async () => {
		(globalThis as any).chrome = {
			history: { search: vi.fn((_q: any, cb: any) => cb([])) },
		};
		(globalThis as any).browser = (globalThis as any).chrome;

		harness.optionsOnClick({ target: { id: 'options-url-set', disabled: false, classList: { contains: () => false } } });
		await new Promise(r => setTimeout(r, 0));

		expect(selectedSite.link.url).toBe('https://new.example/');
		expect(selectedSite.link.titleIsUserSet).toBe(false);
		// `delete link.title` removed the property; nothing put it back.
		expect(selectedSite.link.title).toBeUndefined();
	});
});

// NOTE: The 'Tile refresh action' describe block was removed in slice 3 of the
// tile redesign. The per-tile refresh button (case 'refresh' in _onClick) was
// deleted; its on-demand title-refresh-from-history side effect was not
// replaced (accepted consequence — see header). The title-refresh-via-Set-URL
// path is still tested above.
