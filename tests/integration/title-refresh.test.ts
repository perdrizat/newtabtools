/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression tests for title-refresh behaviour. Three distinct rules:
 *
 *   1. `Set Title` in the per-tile editor marks `link.titleIsUserSet = true`
 *      so subsequent screenshot refreshes don't overwrite the user's title.
 *   2. `Set URL` clears the existing title (since it belonged to the old
 *      URL) and consults `historyTitleFor` to populate a fresh one.
 *   3. The tile-action `refresh` button (the action row's circular arrow)
 *      also pulls a fresh title from history — but ONLY when
 *      `link.titleIsUserSet` is falsy.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const FX_PATH = path.resolve(__dirname, '../../webextension/fx-newTab.js');

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
		const code = `var _historyHarness = { ${body} };`;
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
		const title = await harness.historyTitleFor('https://example.com/');
		expect(title).toBe('Example Domain');
	});

	it('resolves to null when the URL is not in history', async () => {
		(globalThis as any).chrome = {
			history: { search: vi.fn((_q: any, cb: any) => cb([])) },
		};
		expect(await harness.historyTitleFor('https://example.com/')).toBeNull();
	});

	it('resolves to null when chrome.history.search throws (no permission)', async () => {
		(globalThis as any).chrome = {
			history: { search: () => { throw new Error('no permission'); } },
		};
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
		const isValid = extractMethod(source, 'isValidURL');
		const historyTitleFor = extractMethod(source, 'historyTitleFor');

		(globalThis as any).Tiles = { putTile: vi.fn().mockResolvedValue(1), getTile: vi.fn() };
		(globalThis as any).Prefs = { rows: 3, columns: 3 };
		(globalThis as any).Filters = { setFilter: vi.fn() };
		(globalThis as any).Updater = { updateGrid: vi.fn() };
		(globalThis as any).Background = { setBackground: vi.fn().mockResolvedValue(undefined) };
		(globalThis as any).Grid = { cells: [{ index: 0, containsPinnedSite: () => false }] };
		(globalThis as any).chrome = { history: { search: (_q: any, cb: any) => cb([]) } };

		const code = `var newTabTools = { ${body}, ${normalize}, ${isValid}, ${historyTitleFor}, fillFilterUI() {}, refreshBackgroundImage() { return Promise.resolve(); }, setPinURLInputValue() {} };`;
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
		const isValid = extractMethod(source, 'isValidURL');
		const historyTitleFor = extractMethod(source, 'historyTitleFor');

		(globalThis as any).Tiles = { putTile: vi.fn().mockResolvedValue(1), getTile: vi.fn() };
		(globalThis as any).Prefs = { rows: 3, columns: 3 };

		const code = `var newTabTools = { ${body}, ${normalize}, ${isValid}, ${historyTitleFor}, fillFilterUI() {}, refreshBackgroundImage() { return Promise.resolve(); }, setPinURLInputValue() {} };`;
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

		harness.optionsOnClick({ target: { id: 'options-url-set', disabled: false, classList: { contains: () => false } } });
		await new Promise(r => setTimeout(r, 0));

		expect(selectedSite.link.url).toBe('https://new.example/');
		expect(selectedSite.link.titleIsUserSet).toBe(false);
		// `delete link.title` removed the property; nothing put it back.
		expect(selectedSite.link.title).toBeUndefined();
	});
});

describe('Tile refresh action — refreshes title only when not user-set', () => {
	let onClickBody: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(FX_PATH, 'utf8');
		onClickBody = extractMethod(source, '_onClick');
	});

	function buildSiteHarness(linkExtras: Record<string, unknown>) {
		const tilePut = vi.fn();
		const historyTitleFor = vi.fn().mockResolvedValue('Fresh From History');
		const addTitle = vi.fn();
		const link = { url: 'https://example.com/', title: 'Old Title', ...linkExtras };
		const site: any = {
			link,
			addTitle,
			cell: { index: 0 },
		};
		(globalThis as any).Tiles = { putTile: tilePut };
		(globalThis as any).chrome = {
			runtime: { sendMessage: vi.fn() },
			permissions: undefined,
		};
		(globalThis as any).newTabTools = {
			historyTitleFor,
			selectedSite: null,
			setTitleInput: { value: '' },
		};
		// Build a per-call invoker — re-evaluating onClickBody as a function
		// the test can call against the mocked site.
		const code = `var _siteShell = { ${onClickBody} };`;
		vm.runInThisContext(code, { filename: 'site-onclick-harness.js' });
		const shell = (globalThis as any)._siteShell;
		return {
			invokeRefresh() {
				const target = document.createElement('div');
				target.classList.add('ntt-action-btn');
				target.setAttribute('data-action', 'refresh');
				shell._onClick.call(site, {
					target,
					preventDefault() {},
				});
			},
			historyTitleFor,
			tilePut,
			addTitle,
			link,
		};
	}

	it('with titleIsUserSet=false, refreshes the title from history', async () => {
		const { invokeRefresh, historyTitleFor, tilePut, addTitle, link } = buildSiteHarness({});
		invokeRefresh();
		await new Promise(r => setTimeout(r, 0));
		expect(historyTitleFor).toHaveBeenCalledWith('https://example.com/');
		expect(link.title).toBe('Fresh From History');
		expect(addTitle).toHaveBeenCalled();
		expect(tilePut).toHaveBeenCalledWith(link);
	});

	it('with titleIsUserSet=true, does NOT touch the title (user-set wins)', async () => {
		const { invokeRefresh, historyTitleFor, tilePut, addTitle, link } = buildSiteHarness({ titleIsUserSet: true });
		invokeRefresh();
		await new Promise(r => setTimeout(r, 0));
		expect(historyTitleFor).not.toHaveBeenCalled();
		expect(link.title).toBe('Old Title');
		expect(addTitle).not.toHaveBeenCalled();
		expect(tilePut).not.toHaveBeenCalled();
	});

	it('still triggers the screenshot capture (`Thumbnails.capture` message) in either case', async () => {
		const { invokeRefresh } = buildSiteHarness({ titleIsUserSet: true });
		invokeRefresh();
		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.capture', url: 'https://example.com/' })
		);
	});
});
