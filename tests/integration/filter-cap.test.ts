/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: per-domain filter cap with subdomain wildcards.
 * Phase 1 slot 13 of the migration plan (MIGRATION.md).
 *
 * Tests both the filter application logic in `tiles.js` (getAllTiles'
 * topSites callback) and the filter UI wiring in `newTab.js`
 * (optionsOnClick filter-set, plus/minus buttons, fillFilterUI).
 *
 * The core filter-matching logic lives inside `Tiles.getAllTiles`'s
 * `chrome.topSites.get` callback in `tiles.js`. Since this is deeply
 * embedded, we test it by invoking `getAllTiles` with mocked topSites.
 *
 * Characterizes:
 *   - Exact host filter: caps tiles from that domain
 *   - Dot-prefix wildcard: matches subdomains (e.g. ".example.com"
 *     matches "sub.example.com" and "example.com")
 *   - Filter count decrement: each matched tile decrements the cap
 *   - Filter at zero: blocks the tile entirely
 *   - UI: options-filter-set calls Filters.setFilter + updateGrid
 *   - UI: plus/minus buttons adjust filter count
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const TILES_PATH = path.resolve(__dirname, '../../webextension/tiles.js');
const COMMON_PATH = path.resolve(__dirname, '../../webextension/common.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) {throw new Error(`${methodName} not found`);}
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') {depth++;}
		else if (source[i] === '}') { depth--; if (depth === 0) {return source.substring(start, i + 1);} }
	}
	throw new Error('Unbalanced braces');
}

// ==================== Filter UI wiring tests ====================

describe('Filter cap UI — newTab.js (Phase 1 slot 13)', () => {
	let harness: any;

	beforeAll(() => {
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const optionsOnClick = extractMethod(source, 'optionsOnClick');

		globalThis.Prefs = { rows: 3, columns: 3, versionLastAck: new Date(0) };
		globalThis.Filters = { setFilter: vi.fn() };
		globalThis.Updater = { updateGrid: vi.fn() };
		globalThis.Tiles = { putTile: vi.fn().mockResolvedValue(1), getTile: vi.fn() };
		globalThis.Background = { setBackground: vi.fn().mockResolvedValue(undefined) };
		globalThis.Grid = { cells: [{ index: 0, containsPinnedSite: () => false }] };

		const code = `var newTabTools = { ${optionsOnClick}, hideOptions() {}, showOptionsExtra() {}, fillFilterUI() {}, refreshBackgroundImage() { return Promise.resolve(); }, setPinURLInputValue() {}, autocomplete() {}, getString(k) { return k; } };`;
		vm.runInThisContext(code, { filename: 'filter-ui-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		harness.selectedSite = {
			link: { url: 'https://example.com', title: 'Example' },
			addTitle: vi.fn(),
			thumbnail: { style: {} },
		};
		harness.optionsFilterHost = { value: 'example.com', focus: vi.fn(), checkValidity: vi.fn(() => true) };
		harness.optionsFilterCount = { value: '3' };
		harness.optionsFilterSet = { disabled: false };
		harness.optionsPane = { querySelector: vi.fn() };
		harness.pinURLInput = { checkValidity: vi.fn(() => true), value: '', focus: vi.fn() };
		harness.pinURLBlocked = { hidden: false };
		harness._selectedSiteIndex = 0;
		harness.siteURLInput = { value: '' };
		harness.setTitleInput = { value: '' };
		harness.setSavedThumbInput = { files: [] };
		harness.setBgColourInput = { value: '', click: vi.fn() };
		harness.setBgColourDisplay = { style: {} };
		harness.setBgColourButton = { disabled: false };
		harness.resetBgColourButton = { disabled: false };
		harness.saveCurrentThumbButton = { disabled: false };
		harness.removeSavedThumbButton = { disabled: false };
		harness.siteThumbnail = { style: {} };
		harness.setBackgroundInput = { files: [] };
		harness.updateNotice = { hidden: false, dataset: { version: '1.0' } };
		harness.setThumbnail = vi.fn();
		harness.removeThumbnail = vi.fn();
	});

	it('options-filter-set calls Filters.setFilter with host and count', () => {
		harness.optionsFilterHost.value = 'news.example.com';
		harness.optionsFilterCount.value = '5';
		harness.optionsOnClick({ target: { id: 'options-filter-set', disabled: false, classList: { contains: vi.fn(() => false) } } });
		expect(Filters.setFilter).toHaveBeenCalledWith('news.example.com', 5);
	});

	it('options-filter-set calls Updater.updateGrid', () => {
		harness.optionsOnClick({ target: { id: 'options-filter-set', disabled: false, classList: { contains: vi.fn(() => false) } } });
		expect(Updater.updateGrid).toHaveBeenCalled();
	});

	it('options-filter-set clears inputs and disables set button', () => {
		harness.optionsOnClick({ target: { id: 'options-filter-set', disabled: false, classList: { contains: vi.fn(() => false) } } });
		expect(harness.optionsFilterHost.value).toBe('');
		expect(harness.optionsFilterCount.value).toBe('');
		expect(harness.optionsFilterSet.disabled).toBe(true);
		expect(harness.optionsFilterHost.focus).toHaveBeenCalled();
	});

	it('options-filter-set calls fillFilterUI with highlighted host', () => {
		harness.optionsFilterHost.value = 'test.com';
		harness.fillFilterUI = vi.fn();
		harness.optionsOnClick({ target: { id: 'options-filter-set', disabled: false, classList: { contains: vi.fn(() => false) } } });
		expect(harness.fillFilterUI).toHaveBeenCalledWith('test.com');
	});

	it('plus-button increments filter count and calls setFilter', () => {
		const unpinnedSpan = { textContent: '3' };
		const minusButton = { disabled: false };
		const row = {
			cells: [
				{ textContent: 'example.com' },
				{ textContent: '2' },
				{ querySelector: vi.fn(() => unpinnedSpan) },
			],
		};
		const event = {
			target: {
				id: '',
				disabled: false,
				classList: { contains: vi.fn((cls: string) => cls === 'plus-button') },
				parentNode: { parentNode: row },
			},
		};
		row.cells[2].querySelector = vi.fn(() => unpinnedSpan);
		(row as any).querySelector = vi.fn(() => minusButton);
		harness.optionsOnClick(event);
		expect(Filters.setFilter).toHaveBeenCalledWith('example.com', 4);
		expect(Updater.updateGrid).toHaveBeenCalled();
	});

	it('minus-button decrements filter count and calls setFilter', () => {
		const unpinnedSpan = { textContent: '3' };
		const minusButton = { disabled: false };
		const row = {
			cells: [
				{ textContent: 'example.com' },
				{ textContent: '2' },
				{ querySelector: vi.fn(() => unpinnedSpan) },
			],
		};
		const event = {
			target: {
				id: '',
				disabled: false,
				classList: { contains: vi.fn((cls: string) => cls === 'minus-button') },
				parentNode: { parentNode: row },
			},
		};
		row.cells[2].querySelector = vi.fn(() => unpinnedSpan);
		(row as any).querySelector = vi.fn(() => minusButton);
		harness.optionsOnClick(event);
		expect(Filters.setFilter).toHaveBeenCalledWith('example.com', 2);
	});

	it('minus-button at zero shows filter_unlimited text and disables minus', () => {
		const unpinnedSpan = { textContent: '0' };
		const minusButton = { disabled: false };
		const row = {
			cells: [
				{ textContent: 'example.com' },
				{ textContent: '1' },
				{ querySelector: vi.fn(() => unpinnedSpan) },
			],
		};
		const event = {
			target: {
				id: '',
				disabled: false,
				classList: { contains: vi.fn((cls: string) => cls === 'minus-button') },
				parentNode: { parentNode: row },
			},
		};
		row.cells[2].querySelector = vi.fn(() => unpinnedSpan);
		(row as any).querySelector = vi.fn(() => minusButton);
		harness.optionsOnClick(event);
		expect(unpinnedSpan.textContent).toBe('filter_unlimited');
		expect(minusButton.disabled).toBe(true);
		expect(Filters.setFilter).toHaveBeenCalledWith('example.com', -1);
	});

	it('minus-button returns early when count is already unlimited (NaN)', () => {
		const unpinnedSpan = { textContent: 'filter_unlimited' };
		const row = {
			cells: [
				{ textContent: 'example.com' },
				{ textContent: '1' },
				{ querySelector: vi.fn(() => unpinnedSpan) },
			],
		};
		const event = {
			target: {
				id: '',
				disabled: false,
				classList: { contains: vi.fn((cls: string) => cls === 'minus-button') },
				parentNode: { parentNode: row },
			},
		};
		harness.optionsOnClick(event);
		expect(Filters.setFilter).not.toHaveBeenCalled();
	});

	it('plus-button from unlimited starts at 0 (NaN → -1 + 1 = 0)', () => {
		const unpinnedSpan = { textContent: 'filter_unlimited' };
		const minusButton = { disabled: true };
		const row = {
			cells: [
				{ textContent: 'example.com' },
				{ textContent: '1' },
				{ querySelector: vi.fn(() => unpinnedSpan) },
			],
		};
		const event = {
			target: {
				id: '',
				disabled: false,
				classList: { contains: vi.fn((cls: string) => cls === 'plus-button') },
				parentNode: { parentNode: row },
			},
		};
		row.cells[2].querySelector = vi.fn(() => unpinnedSpan);
		(row as any).querySelector = vi.fn(() => minusButton);
		harness.optionsOnClick(event);
		expect(Filters.setFilter).toHaveBeenCalledWith('example.com', 0);
		expect(unpinnedSpan.textContent).toBe(0);
	});
});

// ==================== Filter matching logic tests ====================

describe('Filter matching — tiles.js getAllTiles (Phase 1 slot 13)', () => {
	let Tiles: any;

	beforeAll(() => {
		const commonSrc = fs.readFileSync(COMMON_PATH, 'utf8');
		const tilesSrc = fs.readFileSync(TILES_PATH, 'utf8');

		// Provide globals
		globalThis.Blocked = { isBlocked: vi.fn(() => false) };
		globalThis.Filters = {
			_list: Object.create(null),
			getList() { return Object.assign(Object.create(null), this._list); },
			setFilter: vi.fn(),
		};
		globalThis.Prefs = { rows: 3, columns: 3, history: true };

		(globalThis as any).browser = {
			runtime: { getBrowserInfo: vi.fn().mockResolvedValue({ version: '128.0' }) },
		};
		chrome.topSites = { get: vi.fn() } as any;

		// Mock IDB
		const stores: Record<string, any[]> = { tiles: [], background: [], thumbnails: [] };
		function makeOp<T>(resultFn: () => T) {
			const op = { result: undefined as T | undefined, onsuccess: null as ((this: typeof op) => void) | null, onerror: null as ((e: unknown) => void) | null };
			Promise.resolve().then(() => { op.result = resultFn(); if (op.onsuccess) {op.onsuccess.call(op);} });
			return op;
		}
		function makeObjectStore(name: string) {
			return {
				getAll: vi.fn(() => makeOp(() => [...stores[name]])),
				get: vi.fn((key: any) => makeOp(() => stores[name].find((r: any) => r.id === key || r.url === key))),
				add: vi.fn((record: any) => makeOp(() => { stores[name].push(record); return record.id; })),
				put: vi.fn((record: any) => makeOp(() => { const idx = stores[name].findIndex((r: any) => r.id === record.id); if (idx >= 0) {stores[name][idx] = record;} else {stores[name].push(record);} return record.id; })),
				delete: vi.fn((key: any) => makeOp(() => { const idx = stores[name].findIndex((r: any) => r.id === key); if (idx >= 0) {stores[name].splice(idx, 1);} })),
				clear: vi.fn(() => makeOp(() => { stores[name].length = 0; })),
				index: vi.fn(() => ({ getAll: vi.fn(() => makeOp(() => [...stores[name]])) })),
			};
		}
		(globalThis as any).db = {
			transaction: vi.fn((_stores: string[], _mode?: string) => ({
				objectStore: vi.fn((name: string) => makeObjectStore(name)),
			})),
		};

		vm.runInThisContext(commonSrc, { filename: 'common.js' });
		vm.runInThisContext(tilesSrc, { filename: 'tiles.js' });
		Tiles = (globalThis as any).Tiles;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Tiles._cache = null;
		(globalThis as any).Filters._list = Object.create(null);
		(globalThis as any).Blocked.isBlocked.mockReturnValue(false);
	});

	function setupTopSites(sites: Array<{ url: string; title: string }>) {
		(chrome.topSites.get as any).mockImplementation((_opts: any, cb: any) => {
			// topSitesCallback captured but not directly tested here.
			cb(sites);
		});
	}

	it('exact host filter at 0 blocks all tiles from that domain', async () => {
		Filters._list['example.com'] = 0;
		setupTopSites([
			{ url: 'https://example.com/page1', title: 'Page 1' },
			{ url: 'https://example.com/page2', title: 'Page 2' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getAllTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://example.com/page1');
		expect(urls).not.toContain('https://example.com/page2');
		expect(urls).toContain('https://other.com/');
	});

	it('exact host filter at 1 allows only one tile from that domain', async () => {
		Filters._list['example.com'] = 1;
		setupTopSites([
			{ url: 'https://example.com/page1', title: 'Page 1' },
			{ url: 'https://example.com/page2', title: 'Page 2' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getAllTiles();
		const exampleUrls = result.filter((s: any) => s).map((s: any) => s.url).filter((u: string) => u.includes('example.com'));
		expect(exampleUrls).toHaveLength(1);
	});

	it('dot-prefix wildcard matches subdomains', async () => {
		Filters._list['.example.com'] = 0;
		setupTopSites([
			{ url: 'https://sub.example.com/', title: 'Sub' },
			{ url: 'https://deep.sub.example.com/', title: 'Deep' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getAllTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://sub.example.com/');
		expect(urls).not.toContain('https://deep.sub.example.com/');
		expect(urls).toContain('https://other.com/');
	});

	it('dot-prefix wildcard also matches bare domain (without leading dot)', async () => {
		Filters._list['.example.com'] = 0;
		setupTopSites([
			{ url: 'https://example.com/', title: 'Bare' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getAllTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://example.com/');
	});

	it('no filter allows all tiles through', async () => {
		setupTopSites([
			{ url: 'https://a.com/', title: 'A' },
			{ url: 'https://b.com/', title: 'B' },
		]);
		const result = await Tiles.getAllTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).toContain('https://a.com/');
		expect(urls).toContain('https://b.com/');
	});

	it('blocked sites are filtered out regardless of domain filter', async () => {
		(globalThis as any).Blocked.isBlocked.mockImplementation((url: string) => url === 'https://evil.com/');
		setupTopSites([
			{ url: 'https://evil.com/', title: 'Evil' },
			{ url: 'https://good.com/', title: 'Good' },
		]);
		const result = await Tiles.getAllTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://evil.com/');
		expect(urls).toContain('https://good.com/');
	});

	it('non-http protocols are filtered out', async () => {
		setupTopSites([
			{ url: 'chrome://settings', title: 'Settings' },
			{ url: 'about:blank', title: 'Blank' },
			{ url: 'https://ok.com/', title: 'OK' },
		]);
		const result = await Tiles.getAllTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('chrome://settings');
		expect(urls).not.toContain('about:blank');
		expect(urls).toContain('https://ok.com/');
	});
});
