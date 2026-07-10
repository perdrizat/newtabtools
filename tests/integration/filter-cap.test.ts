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
import { Tiles } from '../../webextension/lib/tiles-store.js';
import { _resetForTests } from '../../webextension/lib/db.js';
// Aliased: the file's other describe block ("Filter cap UI") relies on the
// BARE `Filters`/`Prefs`/`Blocked` identifiers resolving to its own
// per-describe `globalThis.X = {...}` stand-ins (via the ambient `declare
// global` fallback) — a same-named top-level import would shadow that for
// the whole file. Only the "Filter matching" describe below (which drives
// lib/tiles-store.js, now a real importer of these) needs the real
// singletons, so it uses these aliases explicitly.
import { Prefs as RealPrefs, Blocked as RealBlocked, Filters as RealFilters } from '../../webextension/prefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

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
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const optionsOnClick = extractMethod(source, 'optionsOnClick');

		globalThis.Prefs = { rows: 3, columns: 3 };
		globalThis.Filters = {
			setFilter: vi.fn(),
			// default normalizer: trim/lowercase/`*.`→`.` (overridden per-test where needed)
			normalizeHost: (v: string) => String(v).trim().toLowerCase().replace(/^\*\./, '.'),
		};
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

	// The host is normalized on set (so exact matching actually fires): a pasted
	// URL / mixed case / `*.` wildcard becomes the canonical key.
	it('options-filter-set stores the NORMALIZED host', () => {
		(globalThis as any).Filters.normalizeHost = (v: string) => v.trim().toLowerCase().replace(/^\*\./, '.');
		harness.optionsFilterHost.value = '  WWW.LinkedIn.COM ';
		harness.optionsFilterCount.value = '2';
		harness.optionsOnClick({ target: { id: 'options-filter-set', disabled: false, classList: { contains: vi.fn(() => false) } } });
		expect(Filters.setFilter).toHaveBeenCalledWith('www.linkedin.com', 2);
	});

	it('ntt-filter-remove deletes the filter (setFilter host, -1) and refreshes', () => {
		harness.fillFilterUI = vi.fn();
		const row = { cells: [{ textContent: 'www.linkedin.com' }] };
		const event = {
			target: {
				id: '',
				disabled: false,
				classList: { contains: vi.fn((cls: string) => cls === 'ntt-filter-remove') },
				closest: vi.fn(() => row),
			},
		};
		harness.optionsOnClick(event);
		expect(Filters.setFilter).toHaveBeenCalledWith('www.linkedin.com', -1);
		expect(Updater.updateGrid).toHaveBeenCalled();
		expect(harness.fillFilterUI).toHaveBeenCalled();
	});

	it('historytiles-filter toggles the panel open/closed and fills only on open', () => {
		harness.fillFilterUI = vi.fn();
		harness.optionsFilter = { hidden: true };
		const btn = { id: 'historytiles-filter', disabled: false, classList: { contains: vi.fn(() => false) }, setAttribute: vi.fn() };
		// first click → opens + fills
		harness.optionsOnClick({ target: btn });
		expect(harness.optionsFilter.hidden).toBe(false);
		expect(btn.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');
		expect(harness.fillFilterUI).toHaveBeenCalledTimes(1);
		// second click → closes, no re-fill
		harness.optionsOnClick({ target: btn });
		expect(harness.optionsFilter.hidden).toBe(true);
		expect(btn.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
		expect(harness.fillFilterUI).toHaveBeenCalledTimes(1);
	});
});

// ==================== Filter matching logic tests ====================

/**
 * MODERNIZATION.md slice M2: migrated from `vm.runInThisContext`-loading
 * tiles.js (with a directly-poked `globalThis.db` mock) to a native `import`
 * of the real lib/tiles-store.js (getGridTiles, the M2 rename of
 * getAllTiles) + lib/db.js. The `stores.tiles` IDB backing was always empty
 * across every test in this describe (nothing here ever populates it — the
 * dataset comes entirely from the topSites mock), so the same empty-store
 * mock instance is reused across tests via a mocked `indexedDB.open()`;
 * `_resetForTests()` forces each test's first `withStore()` call to reopen.
 */
describe('Filter matching — lib/tiles-store.js getGridTiles (Phase 1 slot 13)', () => {
	beforeAll(() => {
		// PAGE_MODULES.md P3: lib/tiles-store.js now imports Prefs/Blocked/
		// Filters/compareVersions for real (rather than reading
		// getPrefs()/getBlocked()/getFilters()/getCompareVersions() off
		// globalThis at call time), so replacing `globalThis.X` with a fresh
		// stand-in object here would no longer reach it — mutate the real
		// prefs.js/common.js singletons in place instead. `Filters.getList()`'s
		// real implementation already does exactly what the old mock did, and
		// the real `compareVersions('128.0', '63.0a1')` (see the mocked
		// `getBrowserInfo()` below) resolves the same way the old `() => 1`
		// stub did, so neither needs stubbing anymore.
		RealPrefs.rows = 3;
		RealPrefs.columns = 3;
		RealPrefs.history = true;
		RealBlocked.isBlocked = vi.fn(() => false);
		RealFilters._list = Object.create(null);

		(globalThis as any).browser = {
			runtime: { getBrowserInfo: vi.fn().mockResolvedValue({ version: '128.0' }) },
			topSites: { get: vi.fn() },
		};

		// Mock IDB (stores stay empty for the reason in the doc comment above)
		const stores: Record<string, any[]> = { tiles: [], background: [], thumbnails: [] };
		function makeOp<T>(resultFn: () => T) {
			const op = { result: undefined as T | undefined, onsuccess: null as ((this: any) => void) | null, onerror: null as ((e: unknown) => void) | null };
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
		const mockDb = {
			objectStoreNames: { contains: () => true },
			createObjectStore: () => {},
			close: () => {},
			transaction: vi.fn((_storeNames: string | string[], _mode?: string) => ({
				objectStore: vi.fn((name: string) => makeObjectStore(name)),
			})),
		};
		const openMock = vi.fn(() => {
			const handlers: Record<string, Function> = {};
			const req: Record<string, unknown> = {};
			for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
				Object.defineProperty(req, prop, {
					set(cb: Function) { handlers[prop] = cb; },
					configurable: true,
				});
			}
			Promise.resolve().then(() => {
				handlers.onsuccess && handlers.onsuccess.call({ result: mockDb });
			});
			return req;
		});
		(globalThis as any).indexedDB = { open: openMock };
	});

	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		Tiles._cache = [];
		RealFilters._list = Object.create(null);
		(RealBlocked.isBlocked as any).mockReturnValue(false);
	});

	function setupTopSites(sites: Array<{ url: string; title: string }>) {
		((globalThis as any).browser.topSites.get as any).mockResolvedValue(sites);
	}

	it('exact host filter at 0 blocks all tiles from that domain', async () => {
		RealFilters._list['example.com'] = 0;
		setupTopSites([
			{ url: 'https://example.com/page1', title: 'Page 1' },
			{ url: 'https://example.com/page2', title: 'Page 2' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://example.com/page1');
		expect(urls).not.toContain('https://example.com/page2');
		expect(urls).toContain('https://other.com/');
	});

	it('exact host filter at 1 allows only one tile from that domain', async () => {
		RealFilters._list['example.com'] = 1;
		setupTopSites([
			{ url: 'https://example.com/page1', title: 'Page 1' },
			{ url: 'https://example.com/page2', title: 'Page 2' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getGridTiles();
		const exampleUrls = result.filter((s: any) => s).map((s: any) => s.url).filter((u: string) => u.includes('example.com'));
		expect(exampleUrls).toHaveLength(1);
	});

	it('dot-prefix wildcard matches subdomains', async () => {
		RealFilters._list['.example.com'] = 0;
		setupTopSites([
			{ url: 'https://sub.example.com/', title: 'Sub' },
			{ url: 'https://deep.sub.example.com/', title: 'Deep' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://sub.example.com/');
		expect(urls).not.toContain('https://deep.sub.example.com/');
		expect(urls).toContain('https://other.com/');
	});

	it('dot-prefix wildcard also matches bare domain (without leading dot)', async () => {
		RealFilters._list['.example.com'] = 0;
		setupTopSites([
			{ url: 'https://example.com/', title: 'Bare' },
			{ url: 'https://other.com/', title: 'Other' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://example.com/');
	});

	it('no filter allows all tiles through', async () => {
		setupTopSites([
			{ url: 'https://a.com/', title: 'A' },
			{ url: 'https://b.com/', title: 'B' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).toContain('https://a.com/');
		expect(urls).toContain('https://b.com/');
	});

	it('blocked sites are filtered out regardless of domain filter', async () => {
		(RealBlocked.isBlocked as any).mockImplementation((url: string) => url === 'https://evil.com/');
		setupTopSites([
			{ url: 'https://evil.com/', title: 'Evil' },
			{ url: 'https://good.com/', title: 'Good' },
		]);
		const result = await Tiles.getGridTiles();
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
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('chrome://settings');
		expect(urls).not.toContain('about:blank');
		expect(urls).toContain('https://ok.com/');
	});

	// Exact-host narrowness (the behaviour the user wants): an exact-host filter
	// must NOT spill onto other subdomains, and a bare apex filter must NOT catch
	// `www.`. The dot-prefix form is the only way to span subdomains.
	it('exact host filter limits ONLY that host, not other subdomains', async () => {
		RealFilters._list['www.linkedin.com'] = 2;
		setupTopSites([
			{ url: 'https://www.linkedin.com/feed/', title: 'Feed' },
			{ url: 'https://www.linkedin.com/jobs/', title: 'Jobs' },
			{ url: 'https://www.linkedin.com/in/me', title: 'Me' },
			{ url: 'https://m.linkedin.com/', title: 'Mobile' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		const www = urls.filter((u: string) => u.includes('www.linkedin.com'));
		expect(www).toHaveLength(2);
		// m.linkedin.com is a different host — untouched by the www filter.
		expect(urls).toContain('https://m.linkedin.com/');
	});

	it('bare apex filter does NOT catch the www subdomain', async () => {
		RealFilters._list['linkedin.com'] = 0;
		setupTopSites([
			{ url: 'https://linkedin.com/', title: 'Apex' },
			{ url: 'https://www.linkedin.com/feed/', title: 'WWW' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).not.toContain('https://linkedin.com/');
		expect(urls).toContain('https://www.linkedin.com/feed/');
	});

	it('two filters decrement independently (multi-host independence)', async () => {
		RealFilters._list['a.com'] = 1;
		RealFilters._list['b.com'] = 1;
		setupTopSites([
			{ url: 'https://a.com/1', title: 'A1' },
			{ url: 'https://a.com/2', title: 'A2' },
			{ url: 'https://b.com/1', title: 'B1' },
			{ url: 'https://b.com/2', title: 'B2' },
		]);
		const result = await Tiles.getGridTiles();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls.filter((u: string) => u.includes('a.com'))).toHaveLength(1);
		expect(urls.filter((u: string) => u.includes('b.com'))).toHaveLength(1);
	});

	// Direct unit tests of the extracted match-and-decrement predicate.
	describe('Tiles._hostFilteredOut predicate', () => {
		const dot = (f: Record<string, number>) => Object.keys(f).filter(k => k[0] === '.');

		it('exact host hit decrements; drops at zero', () => {
			const f = { 'www.linkedin.com': 2 };
			expect(Tiles._hostFilteredOut('www.linkedin.com', f, dot(f))).toBe(false);
			expect(f['www.linkedin.com']).toBe(1);
			expect(Tiles._hostFilteredOut('www.linkedin.com', f, dot(f))).toBe(false);
			expect(Tiles._hostFilteredOut('www.linkedin.com', f, dot(f))).toBe(true);
		});

		it('exact host filter does not match a different subdomain', () => {
			const f = { 'www.linkedin.com': 0 };
			expect(Tiles._hostFilteredOut('m.linkedin.com', f, dot(f))).toBe(false);
		});

		it('bare apex filter does not match www', () => {
			const f = { 'linkedin.com': 0 };
			expect(Tiles._hostFilteredOut('www.linkedin.com', f, dot(f))).toBe(false);
			expect(Tiles._hostFilteredOut('linkedin.com', f, dot(f))).toBe(true);
		});

		it('dot-prefix wildcard matches apex and any subdomain', () => {
			const f = { '.linkedin.com': 0 };
			expect(Tiles._hostFilteredOut('linkedin.com', f, dot(f))).toBe(true);
			expect(Tiles._hostFilteredOut('www.linkedin.com', f, dot(f))).toBe(true);
			expect(Tiles._hostFilteredOut('deep.sub.linkedin.com', f, dot(f))).toBe(true);
		});

		it('no matching filter lets the host through', () => {
			const f = { 'other.com': 0 };
			expect(Tiles._hostFilteredOut('example.com', f, dot(f))).toBe(false);
		});
	});
});

// ==================== Host normalization tests ====================

describe('Filter host normalization — prefs.js Filters.normalizeHost', () => {
	// PAGE_MODULES.md P3: prefs.js has a real `export` now — `vm.runInThisContext`
	// can no longer parse it. Natively imports the real module singleton
	// instead (crib: prefs-persistence.test.ts).
	let Filters: any;

	beforeAll(async () => {
		(globalThis as any).chrome = (globalThis as any).chrome || {};
		(globalThis as any).chrome.storage = { local: { set: vi.fn(), get: vi.fn() } };
		({ Filters } = await import('../../webextension/prefs.js'));
	});

	it('trims and lowercases', () => {
		expect(Filters.normalizeHost('  WWW.LinkedIn.COM ')).toBe('www.linkedin.com');
	});

	it('extracts the host from a pasted URL (scheme + path)', () => {
		expect(Filters.normalizeHost('https://www.linkedin.com/feed/')).toBe('www.linkedin.com');
	});

	it('maps a leading *. wildcard to the leading-dot form', () => {
		expect(Filters.normalizeHost('*.linkedin.com')).toBe('.linkedin.com');
	});

	it('strips a trailing FQDN dot but preserves a leading wildcard dot', () => {
		expect(Filters.normalizeHost('linkedin.com.')).toBe('linkedin.com');
		expect(Filters.normalizeHost('.linkedin.com')).toBe('.linkedin.com');
	});

	it('strips a bare host/path remainder', () => {
		expect(Filters.normalizeHost('www.linkedin.com/jobs')).toBe('www.linkedin.com');
	});

	it('returns empty string for unusable input', () => {
		expect(Filters.normalizeHost('   ')).toBe('');
		expect(Filters.normalizeHost('')).toBe('');
	});
});
